const pool = require("../../config/db");

/**
 * Get all slabs
 */
const getAllSlabs = async (includeInactive = false) => {
  let query = `
    SELECT 
      s.*,
      COUNT(u.id) as user_count,
      COALESCE(SUM(u.total_pay_later_used), 0) as total_pay_later_used
    FROM user_slabs s
    LEFT JOIN users u ON u.slab_id = s.id
  `;

  if (!includeInactive) {
    query += ` WHERE s.is_active = true`;
  }

  query += `
    GROUP BY s.id
    ORDER BY s.rank ASC;
  `;

  const { rows } = await pool.query(query);
  return rows;
};

/**
 * Get slab by ID
 */
const getSlabById = async (slab_id) => {
  const { rows } = await pool.query(
    `
    SELECT 
      s.*,
      COUNT(u.id) as user_count
    FROM user_slabs s
    LEFT JOIN users u ON u.slab_id = s.id
    WHERE s.id = $1
    GROUP BY s.id;
    `,
    [slab_id],
  );
  return rows[0] || null;
};

/**
 * Get slab by rank
 */
const getSlabByRank = async (rank) => {
  const { rows } = await pool.query(
    `SELECT * FROM user_slabs WHERE rank = $1 AND is_active = true`,
    [rank],
  );
  return rows[0] || null;
};

/**
 * Update slab
 */
const updateSlab = async (slab_id, updateData) => {
  const { name, rank, pay_later_limit, description, is_active } = updateData;

  const fields = [];
  const values = [];
  let paramCounter = 1;

  // Get current slab for audit
  const currentSlab = await getSlabById(slab_id);
  if (!currentSlab) {
    throw new Error("Slab not found");
  }

  if (name !== undefined) {
    // Check if name already exists (excluding current slab)
    const existingName = await pool.query(
      `SELECT id FROM user_slabs WHERE name = $1 AND id != $2`,
      [name, slab_id],
    );
    if (existingName.rows.length > 0) {
      throw new Error(`Slab with name "${name}" already exists`);
    }
    fields.push(`name = $${paramCounter}`);
    values.push(name);
    paramCounter++;
  }

  if (rank !== undefined) {
    // Check if rank already exists (excluding current slab)
    const existingRank = await pool.query(
      `SELECT id FROM user_slabs WHERE rank = $1 AND id != $2`,
      [rank, slab_id],
    );
    if (existingRank.rows.length > 0) {
      throw new Error(`Slab with rank ${rank} already exists`);
    }
    fields.push(`rank = $${paramCounter}`);
    values.push(rank);
    paramCounter++;
  }

  if (pay_later_limit !== undefined) {
    if (pay_later_limit < 0) {
      throw new Error("Pay later limit cannot be negative");
    }
    fields.push(`pay_later_limit = $${paramCounter}`);
    values.push(pay_later_limit);
    paramCounter++;
  }

  if (description !== undefined) {
    fields.push(`description = $${paramCounter}`);
    values.push(description);
    paramCounter++;
  }

  if (is_active !== undefined) {
    fields.push(`is_active = $${paramCounter}`);
    values.push(is_active);
    paramCounter++;
  }

  if (fields.length === 0) {
    throw new Error("No fields to update");
  }

  values.push(slab_id);

  const query = `
    UPDATE user_slabs
    SET ${fields.join(", ")}
    WHERE id = $${paramCounter}
    RETURNING *;
  `;

  const { rows } = await pool.query(query, values);
  return rows[0] || null;
};

/**
 * Get default slab (lowest rank)
 */
const getDefaultSlab = async () => {
  const { rows } = await pool.query(
    `SELECT * FROM user_slabs WHERE is_active = true ORDER BY rank DESC LIMIT 1`,
  );
  return rows[0] || null;
};

/**
 * Get user's pay later limit with detailed credit information
 * Always calculates available_credit from slab_limit and outstanding_balance.
 */
const getUserPayLaterLimit = async (user_id) => {
  const { rows } = await pool.query(
    `
    SELECT 
      u.id as user_id,
      u.name as user_name,
      u.email as user_email,
      -- Recalculate available_credit from scratch to avoid stale DB values
      GREATEST(0, LEAST(
        s.pay_later_limit,
        s.pay_later_limit - GREATEST(0, (u.total_pay_later_used - u.total_pay_later_repaid))
      )) AS available_credit,
      u.total_pay_later_used as total_used,
      u.total_pay_later_repaid as total_repaid,
      s.id as slab_id,
      s.name as slab_name,
      s.rank as slab_rank,
      s.pay_later_limit as slab_limit,
      s.description as slab_description,
      (u.total_pay_later_used - u.total_pay_later_repaid) as outstanding_balance,
      COALESCE(
        (SELECT SUM(amount) 
         FROM pay_later_transactions 
         WHERE user_id = u.id 
         AND transaction_type = 'DEBIT'
         AND created_at >= CURRENT_DATE - INTERVAL '30 days'
        ), 0
      ) as last_30_days_usage,
      COALESCE(
        (SELECT COUNT(*) 
         FROM pay_later_transactions 
         WHERE user_id = u.id 
         AND transaction_type = 'DEBIT'
         AND created_at >= CURRENT_DATE - INTERVAL '30 days'
        ), 0
      ) as last_30_days_transactions
    FROM users u
    LEFT JOIN user_slabs s ON u.slab_id = s.id
    WHERE u.id = $1
    LIMIT 1;
    `,
    [user_id],
  );
  return rows[0] || null;
};

/**
 * Log slab activity
 */
const logSlabActivity = async ({
  slab_id,
  action,
  changes,
  performed_by,
  performed_by_role,
}) => {
  const { rows } = await pool.query(
    `
    INSERT INTO slab_audit_logs (slab_id, action, changes, performed_by, performed_by_role)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
    `,
    [slab_id, action, changes, performed_by, performed_by_role],
  );
  return rows[0];
};

/**
 * Get slab audit logs
 */
const getSlabAuditLogs = async (slab_id = null, limit = 50, offset = 0) => {
  let query = `
    SELECT 
      l.*,
      u.name as performer_name,
      u.email as performer_email
    FROM slab_audit_logs l
    LEFT JOIN users u ON l.performed_by = u.id
  `;

  const params = [];
  let paramCounter = 1;

  if (slab_id) {
    query += ` WHERE l.slab_id = $${paramCounter}`;
    params.push(slab_id);
    paramCounter++;
  }

  query += ` ORDER BY l.created_at DESC LIMIT $${paramCounter} OFFSET $${paramCounter + 1}`;
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);
  return rows;
};

/**
 * Assign a slab to a user – directly sets balance.
 */
const assignSlabToUser = async (userId, slabId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Get slab details
    const slabResult = await client.query(
      `SELECT * FROM user_slabs WHERE id = $1 AND is_active = true`,
      [slabId],
    );
    if (slabResult.rows.length === 0) {
      throw new Error("Slab not found or inactive");
    }
    const slab = slabResult.rows[0];
    const newSlabLimit = parseFloat(slab.pay_later_limit || 0);

    // 2. Get user with lock
    const userResult = await client.query(
      `SELECT id, pay_later_balance, total_pay_later_used, total_pay_later_repaid, slab_id
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (userResult.rows.length === 0) {
      throw new Error("User not found");
    }
    const user = userResult.rows[0];
    const currentBalance = parseFloat(user.pay_later_balance || 0);
    const totalUsed = parseFloat(user.total_pay_later_used || 0);
    const totalRepaid = parseFloat(user.total_pay_later_repaid || 0);
    const outstandingBalance = totalUsed - totalRepaid;

    // 3. Calculate target balance
    let targetBalance;
    if (outstandingBalance <= 0) {
      targetBalance = newSlabLimit;
    } else {
      targetBalance = Math.max(0, newSlabLimit - outstandingBalance);
    }
    // Cap at slab limit
    if (targetBalance > newSlabLimit) {
      targetBalance = newSlabLimit;
    }

    // 4. Update slab_id AND set pay_later_balance directly to target
    await client.query(
      `UPDATE users
       SET slab_id = $1, pay_later_balance = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [slabId, targetBalance, userId],
    );

    // 5. Log audit (no pay_later_transaction needed)
    await client.query(
      `INSERT INTO slab_audit_logs (slab_id, action, changes, performed_by, performed_by_role)
       VALUES ($1, 'ASSIGN', $2, $3, $4)`,
      [
        slabId,
        JSON.stringify({
          previous_slab_id: user.slab_id,
          new_slab_id: slabId,
          previous_balance: currentBalance,
          new_balance: targetBalance,
          outstanding_balance: outstandingBalance,
          slab_limit: newSlabLimit,
          user_id: userId,
        }),
        userId,
        "ADMIN",
      ],
    );

    await client.query("COMMIT");

    // Return updated user
    const updatedUser = await client.query(
      `SELECT id, name, email, slab_id, pay_later_balance, total_pay_later_used, total_pay_later_repaid
       FROM users WHERE id = $1`,
      [userId],
    );
    return updatedUser.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  getAllSlabs,
  getSlabById,
  getSlabByRank,
  updateSlab,
  getDefaultSlab,
  getUserPayLaterLimit,
  logSlabActivity,
  getSlabAuditLogs,
  assignSlabToUser,
};
