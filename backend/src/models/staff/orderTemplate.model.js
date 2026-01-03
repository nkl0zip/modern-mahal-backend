const pool = require("../../config/db");

/**
 * Create a new order template
 */
const createOrderTemplate = async ({
  user_id,
  staff_id = null,
  title = null,
  description = null,
  created_by = "USER",
}) => {
  const { rows } = await pool.query(
    `
    INSERT INTO order_templates (user_id, staff_id, title, description, created_by)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
    `,
    [user_id, staff_id, title, description, created_by]
  );
  return rows[0];
};

/**
 * Get template by ID
 */
const getTemplateById = async (template_id) => {
  const { rows } = await pool.query(
    `
    SELECT 
      ot.*,
      u.name as user_name,
      u.email as user_email,
      u.phone as user_phone,
      s.name as staff_name,
      s.email as staff_email
    FROM order_templates ot
    LEFT JOIN users u ON ot.user_id = u.id
    LEFT JOIN users s ON ot.staff_id = s.id
    WHERE ot.id = $1 AND ot.is_deleted = false
    LIMIT 1;
    `,
    [template_id]
  );
  return rows[0] || null;
};

/**
 * Get templates for user
 */
const getUserTemplates = async (user_id, status = null) => {
  let query = `
    SELECT 
      ot.*,
      u.name AS user_name,
      s.name AS staff_name,

      /* counts */
      (
        SELECT COUNT(*)
        FROM order_template_items oti
        WHERE oti.template_id = ot.id
          AND oti.status = 'ACTIVE'
      ) AS item_count,

      (
        SELECT COUNT(*)
        FROM order_template_chats otc
        WHERE otc.template_id = ot.id
          AND otc.deleted_at IS NULL
      ) AS chat_count,

      /* template items (details) */
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', oti.id,
              'template_id', oti.template_id,
              'product_id', oti.product_id,
              'variant_id', oti.variant_id,
              'quantity', oti.quantity,
              'status', oti.status,
              'added_at', oti.added_at,

              'product_name', p.name,
              'product_code', p.product_code,
              'sub_code', pv.sub_code,
              'current_mrp', pv.mrp,
              'colour_name', cl.name,
              'finish_name', f.name,
              'brand_name', b.name,
              'product_image', pi.media_url
            )
            ORDER BY oti.added_at DESC
          )
          FROM order_template_items oti
          JOIN products p ON oti.product_id = p.id
          LEFT JOIN product_variants pv ON oti.variant_id = pv.id
          LEFT JOIN colours cl ON pv.colour_id = cl.id
          LEFT JOIN finishes f ON pv.finish_id = f.id
          LEFT JOIN brands b ON p.brand_id = b.id
          LEFT JOIN LATERAL (
            SELECT media_url
            FROM products_image
            WHERE (product_id = p.id OR variant_id = pv.id)
              AND display_order = 1
            LIMIT 1
          ) pi ON true
          WHERE oti.template_id = ot.id
        ),
        '[]'::json
      ) AS template_items

    FROM order_templates ot
    LEFT JOIN users u ON ot.user_id = u.id
    LEFT JOIN users s ON ot.staff_id = s.id
    WHERE ot.user_id = $1
      AND ot.is_deleted = false
  `;

  const params = [user_id];

  if (status) {
    query += ` AND ot.status = $2`;
    params.push(status);
  }

  query += ` ORDER BY ot.updated_at DESC;`;

  const { rows } = await pool.query(query, params);
  return rows;
};

/**
 * Get templates assigned to staff
 */
const getStaffAssignedTemplates = async (staff_id, status = null) => {
  let query = `
    SELECT 
      ot.*,
      u.name as user_name,
      u.email as user_email,
      u.phone as user_phone,
      (SELECT COUNT(*) FROM order_template_items oti WHERE oti.template_id = ot.id AND oti.status = 'ACTIVE') as item_count,
      (SELECT COUNT(*) FROM order_template_chats otc WHERE otc.template_id = ot.id AND otc.deleted_at IS NULL) as chat_count,
      (SELECT COUNT(*) FROM order_template_chats otc WHERE otc.template_id = ot.id AND otc.is_read = false AND otc.deleted_at IS NULL) as unread_messages
    FROM order_templates ot
    JOIN users u ON ot.user_id = u.id
    WHERE ot.staff_id = $1 AND ot.is_deleted = false
  `;

  const params = [staff_id];

  if (status) {
    query += ` AND ot.status = $2`;
    params.push(status);
  }

  query += ` ORDER BY ot.updated_at DESC;`;

  const { rows } = await pool.query(query, params);
  return rows;
};

/**
 * Update template details
 */
const updateTemplate = async (template_id, updateData) => {
  const { title, description, status, staff_id } = updateData;

  const fields = [];
  const values = [];
  let paramCounter = 1;

  if (title !== undefined) {
    fields.push(`title = $${paramCounter}`);
    values.push(title);
    paramCounter++;
  }

  if (description !== undefined) {
    fields.push(`description = $${paramCounter}`);
    values.push(description);
    paramCounter++;
  }

  if (status !== undefined) {
    fields.push(`status = $${paramCounter}`);
    values.push(status);
    paramCounter++;
  }

  if (staff_id !== undefined) {
    fields.push(`staff_id = $${paramCounter}`);
    values.push(staff_id);
    paramCounter++;
  }

  if (fields.length === 0) {
    throw new Error("No fields to update");
  }

  values.push(template_id);

  const query = `
    UPDATE order_templates
    SET ${fields.join(", ")}
    WHERE id = $${paramCounter} AND is_deleted = false
    RETURNING *;
  `;

  const { rows } = await pool.query(query, values);
  return rows[0] || null;
};

/**
 * Soft delete template
 */
const softDeleteTemplate = async (template_id) => {
  const { rows } = await pool.query(
    `
    UPDATE order_templates
    SET 
      is_deleted = true,
      deleted_at = CURRENT_TIMESTAMP,
      status = 'CANCELLED'
    WHERE id = $1
    RETURNING *;
    `,
    [template_id]
  );
  return rows[0] || null;
};

/**
 * Finalize template (mark as completed)
 */
const finalizeTemplate = async (template_id) => {
  const { rows } = await pool.query(
    `
    UPDATE order_templates
    SET 
      status = 'COMPLETED',
      finalized_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND is_deleted = false
    RETURNING *;
    `,
    [template_id]
  );
  return rows[0] || null;
};

/**
 * Check if user has access to template
 */
const checkTemplateAccess = async (template_id, user_id, user_role) => {
  const { rows } = await pool.query(
    `
    SELECT 
      ot.*,
      CASE 
        WHEN ot.user_id = $2 THEN true
        WHEN ot.staff_id = $2 THEN true
        WHEN $3 = 'ADMIN' THEN true
        ELSE false
      END as has_access
    FROM order_templates ot
    WHERE ot.id = $1 AND ot.is_deleted = false
    LIMIT 1;
    `,
    [template_id, user_id, user_role]
  );

  if (!rows[0]) return null;
  return rows[0].has_access ? rows[0] : null;
};

/**
 * Assign staff to template
 */
const assignStaffToTemplate = async (template_id, staff_id) => {
  const { rows } = await pool.query(
    `
    UPDATE order_templates
    SET staff_id = $2
    WHERE id = $1 AND is_deleted = false
    RETURNING *;
    `,
    [template_id, staff_id]
  );
  return rows[0] || null;
};

module.exports = {
  createOrderTemplate,
  getTemplateById,
  getUserTemplates,
  getStaffAssignedTemplates,
  updateTemplate,
  softDeleteTemplate,
  finalizeTemplate,
  checkTemplateAccess,
  assignStaffToTemplate,
};
