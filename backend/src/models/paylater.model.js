// models/payment/paylater.model.js
const pool = require("../config/db");

/**
 * Get user's pay later credit details
 */
const getUserPayLaterDetails = async (user_id) => {
  const { rows } = await pool.query(
    `
    SELECT 
      u.id as user_id,
      u.name as user_name,
      u.email as user_email,
      u.pay_later_balance as available_credit,
      u.total_pay_later_used as total_used,
      u.total_pay_later_repaid as total_repaid,
      s.id as slab_id,
      s.name as slab_name,
      s.rank as slab_rank,
      s.pay_later_limit as total_credit_limit,
      s.description as slab_description,
      -- Correct outstanding balance calculation
      (u.total_pay_later_used - u.total_pay_later_repaid) as outstanding_balance
    FROM users u
    LEFT JOIN user_slabs s ON u.slab_id = s.id
    WHERE u.id = $1;
    `,
    [user_id],
  );
  return rows[0] || null;
};

/**
 * Create a pay later transaction (CREDIT - adding credit, DEBIT - using credit)
 */
const createPayLaterTransaction = async ({
  user_id,
  order_id = null,
  transaction_type, // 'CREDIT', 'DEBIT', 'REPAYMENT', 'ADJUSTMENT'
  amount,
  payment_method = null,
  transaction_id = null,
  description = null,
  receipt_url = null,
  receipt_public_id = null,
  approved_by = null,
  metadata = {},
}) => {
  // Start a transaction
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Get current balance
    const userResult = await client.query(
      `SELECT pay_later_balance, slab_id FROM users WHERE id = $1 FOR UPDATE`,
      [user_id],
    );

    if (userResult.rows.length === 0) {
      throw new Error("User not found");
    }

    const currentBalance = parseFloat(userResult.rows[0].pay_later_balance);
    const slabId = userResult.rows[0].slab_id;

    // For DEBIT transactions, check if user has enough credit
    if (transaction_type === "DEBIT") {
      if (currentBalance < amount) {
        throw new Error(
          `Insufficient pay later credit. Available: ${currentBalance}, Required: ${amount}`,
        );
      }
    }

    // Calculate new balance
    let newBalance;
    if (transaction_type === "DEBIT") {
      newBalance = currentBalance - amount;
    } else {
      newBalance = currentBalance + amount;
    }

    // Get user's slab limit for validation
    let slabLimit = null;
    if (slabId) {
      const slabResult = await client.query(
        `SELECT pay_later_limit FROM user_slabs WHERE id = $1`,
        [slabId],
      );
      if (slabResult.rows.length > 0) {
        slabLimit = parseFloat(slabResult.rows[0].pay_later_limit);
      }
    }

    // For CREDIT transactions (repayment), ensure balance doesn't exceed slab limit
    if (transaction_type === "CREDIT" && slabLimit !== null) {
      if (newBalance > slabLimit) {
        newBalance = slabLimit; // Cap at slab limit
      }
    }

    // Insert transaction
    const transactionResult = await client.query(
      `
      INSERT INTO pay_later_transactions (
        user_id, order_id, transaction_type, amount, balance_after,
        payment_method, transaction_id, description, receipt_url,
        receipt_public_id, approved_by, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
      `,
      [
        user_id,
        order_id,
        transaction_type,
        amount,
        newBalance,
        payment_method,
        transaction_id,
        description,
        receipt_url,
        receipt_public_id,
        approved_by,
        JSON.stringify(metadata),
      ],
    );

    // Update user's pay later balance
    await client.query(
      `
      UPDATE users
      SET 
        pay_later_balance = $1,
        total_pay_later_used = total_pay_later_used + CASE WHEN $2 = 'DEBIT' THEN $3 ELSE 0 END,
        total_pay_later_repaid = total_pay_later_repaid + CASE WHEN $2 = 'CREDIT' OR $2 = 'REPAYMENT' THEN $3 ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      `,
      [newBalance, transaction_type, amount, user_id],
    );

    await client.query("COMMIT");

    return transactionResult.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get pay later transactions for a user
 */
const getUserPayLaterTransactions = async (user_id, limit = 50, offset = 0) => {
  const { rows } = await pool.query(
    `
    SELECT 
      pt.*,
      u.name as approved_by_name,
      u.email as approved_by_email,
      o.order_number
    FROM pay_later_transactions pt
    LEFT JOIN users u ON pt.approved_by = u.id
    LEFT JOIN orders o ON pt.order_id = o.id
    WHERE pt.user_id = $1
    ORDER BY pt.created_at DESC
    LIMIT $2 OFFSET $3;
    `,
    [user_id, limit, offset],
  );
  return rows;
};

/**
 * Get a specific pay later transaction by ID
 */
const getPayLaterTransactionById = async (transaction_id) => {
  const { rows } = await pool.query(
    `
    SELECT 
      pt.*,
      u.name as approved_by_name,
      u.email as approved_by_email,
      o.order_number
    FROM pay_later_transactions pt
    LEFT JOIN users u ON pt.approved_by = u.id
    LEFT JOIN orders o ON pt.order_id = o.id
    WHERE pt.id = $1;
    `,
    [transaction_id],
  );
  return rows[0] || null;
};

/**
 * Log pay later audit activity
 */
const logPayLaterAudit = async ({
  transaction_id,
  action,
  performed_by,
  performed_by_role,
  old_data = {},
  new_data = {},
  ip_address = null,
  user_agent = null,
}) => {
  const { rows } = await pool.query(
    `
    INSERT INTO pay_later_audit_logs (
      transaction_id, action, performed_by, performed_by_role,
      old_data, new_data, ip_address, user_agent
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *;
    `,
    [
      transaction_id,
      action,
      performed_by,
      performed_by_role,
      JSON.stringify(old_data),
      JSON.stringify(new_data),
      ip_address,
      user_agent,
    ],
  );
  return rows[0];
};

/**
 * Get pay later audit logs
 */
const getPayLaterAuditLogs = async (
  transaction_id = null,
  user_id = null,
  limit = 50,
  offset = 0,
) => {
  let query = `
    SELECT 
      l.*,
      u.name as performer_name,
      u.email as performer_email,
      pt.user_id,
      pt.amount,
      pt.transaction_type
    FROM pay_later_audit_logs l
    LEFT JOIN users u ON l.performed_by = u.id
    LEFT JOIN pay_later_transactions pt ON l.transaction_id = pt.id
    WHERE 1=1
  `;

  const params = [];
  let paramCounter = 1;

  if (transaction_id) {
    query += ` AND l.transaction_id = $${paramCounter}`;
    params.push(transaction_id);
    paramCounter++;
  }

  if (user_id) {
    query += ` AND pt.user_id = $${paramCounter}`;
    params.push(user_id);
    paramCounter++;
  }

  query += ` ORDER BY l.created_at DESC LIMIT $${paramCounter} OFFSET $${paramCounter + 1}`;
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);
  return rows;
};

/**
 * Get pay later summary for admin dashboard
 */
const getPayLaterSummary = async () => {
  const { rows } = await pool.query(`
    SELECT 
      COUNT(DISTINCT id) as total_users_using_paylater,
      COALESCE(SUM(total_pay_later_used), 0) as total_paylater_used,
      COALESCE(SUM(total_pay_later_repaid), 0) as total_paylater_repaid,
      COALESCE(SUM(pay_later_balance), 0) as total_available_credit,
      (
        SELECT COUNT(*) 
        FROM pay_later_transactions 
        WHERE transaction_type = 'DEBIT' 
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      ) as last_30_days_debits,
      (
        SELECT COUNT(*) 
        FROM pay_later_transactions 
        WHERE transaction_type IN ('CREDIT', 'REPAYMENT') 
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      ) as last_30_days_credits,
      (
        SELECT COALESCE(SUM(amount), 0) 
        FROM pay_later_transactions 
        WHERE transaction_type = 'DEBIT' 
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      ) as last_30_days_debit_amount,
      (
        SELECT COALESCE(SUM(amount), 0) 
        FROM pay_later_transactions 
        WHERE transaction_type IN ('CREDIT', 'REPAYMENT') 
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      ) as last_30_days_credit_amount
    FROM users;
  `);
  return rows[0];
};

/**
 * Get outstanding pay later balances
 */
const getOutstandingBalances = async (limit = 50, offset = 0) => {
  const { rows } = await pool.query(
    `
    SELECT 
      u.id as user_id,
      u.name as user_name,
      u.email as user_email,
      u.pay_later_balance as available_credit,
      s.pay_later_limit as slab_limit,
      (s.pay_later_limit - u.pay_later_balance) as outstanding_balance,
      u.total_pay_later_used as total_used,
      u.total_pay_later_repaid as total_repaid,
      s.name as slab_name,
      (
        SELECT COUNT(*) 
        FROM pay_later_transactions 
        WHERE user_id = u.id 
        AND transaction_type = 'DEBIT'
      ) as total_purchases
    FROM users u
    LEFT JOIN user_slabs s ON u.slab_id = s.id
    WHERE u.role = 'USER'
    ORDER BY outstanding_balance DESC
    LIMIT $1 OFFSET $2;
    `,
    [limit, offset],
  );
  return rows;
};

/**
 * Admin records a repayment for a user
 * This bypasses the approval flow since admin is directly recording it
 */
const adminRecordRepayment = async ({
  user_id,
  amount,
  payment_method,
  transaction_id = null,
  description = null,
  receipt_url = null,
  receipt_public_id = null,
  admin_id,
  admin_role,
  metadata = {},
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Get current balance with lock
    const userResult = await client.query(
      `SELECT pay_later_balance, slab_id FROM users WHERE id = $1 FOR UPDATE`,
      [user_id],
    );

    if (userResult.rows.length === 0) {
      throw new Error("User not found");
    }

    const currentBalance = parseFloat(userResult.rows[0].pay_later_balance);
    const slabId = userResult.rows[0].slab_id;

    // Get slab limit
    let slabLimit = null;
    if (slabId) {
      const slabResult = await client.query(
        `SELECT pay_later_limit FROM user_slabs WHERE id = $1`,
        [slabId],
      );
      if (slabResult.rows.length > 0) {
        slabLimit = parseFloat(slabResult.rows[0].pay_later_limit);
      }
    }

    // Calculate new balance
    let newBalance = currentBalance + parseFloat(amount);

    // Cap at slab limit if exists
    if (slabLimit !== null && newBalance > slabLimit) {
      newBalance = slabLimit;
    }

    // Insert transaction - directly approved since admin is recording it
    const transactionResult = await client.query(
      `
      INSERT INTO pay_later_transactions (
        user_id, transaction_type, amount, balance_after,
        payment_method, transaction_id, description, 
        receipt_url, receipt_public_id, approved_by, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
      `,
      [
        user_id,
        "REPAYMENT",
        amount,
        newBalance,
        payment_method,
        transaction_id,
        description ||
          `Repayment of ₹${amount} via ${payment_method} (recorded by admin)`,
        receipt_url,
        receipt_public_id,
        admin_id,
        JSON.stringify({
          ...metadata,
          status: "APPROVED",
          is_admin_recorded: true,
          recorded_by_role: admin_role,
          recorded_at: new Date().toISOString(),
        }),
      ],
    );

    // Update user balance
    await client.query(
      `
      UPDATE users
      SET 
        pay_later_balance = $1,
        total_pay_later_repaid = total_pay_later_repaid + $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      `,
      [newBalance, amount, user_id],
    );

    await client.query("COMMIT");

    return transactionResult.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  getUserPayLaterDetails,
  createPayLaterTransaction,
  getUserPayLaterTransactions,
  getPayLaterTransactionById,
  logPayLaterAudit,
  getPayLaterAuditLogs,
  getPayLaterSummary,
  getOutstandingBalances,
  adminRecordRepayment,
};
