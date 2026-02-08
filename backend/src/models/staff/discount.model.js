const pool = require("../../config/db");

/**
 * Create a discount (COUPON OR MANUAL)
 */
const createDiscount = async ({
  type,
  discount_mode,
  value,
  coupon_code = null,
  expires_at,
  created_by,
  created_by_role,
}) => {
  const query = `
    INSERT INTO discounts (
      type,
      discount_mode,
      value,
      coupon_code,
      expires_at,
      created_by,
      created_by_role
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *;
  `;

  const values = [
    type,
    discount_mode,
    value,
    coupon_code,
    expires_at,
    created_by,
    created_by_role,
  ];

  const { rows } = await pool.query(query, values);
  return rows[0];
};

/**
 * Attach discount to segments
 */
const addDiscountSegments = async (discountId, segmentIds = []) => {
  if (!segmentIds.length) return;

  const values = segmentIds.map((_, i) => `($1, $${i + 2})`).join(",");

  const query = `
    INSERT INTO discount_segments (discount_id, segment_id)
    VALUES ${values}
    ON CONFLICT DO NOTHING;
  `;

  await pool.query(query, [discountId, ...segmentIds]);
};

/**
 * Attach MANUAL discount to a user
 */
const assignDiscountToUser = async (discountId, userId, templateId = null) => {
  const query = `
    INSERT INTO user_discounts (discount_id, user_id, template_id)
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING;
  `;
  await pool.query(query, [discountId, userId, templateId]);
};

/**
 * Log discount activity
 */
const logDiscountActivity = async ({
  discountId,
  discount_id,
  action_type,
  performed_by,
  performed_by_role,
  affected_user_id = null,
  old_value = null,
  new_value = null,
}) => {
  const finalDiscountId = discount_id || discountId;

  if (!finalDiscountId) {
    throw new Error("logDiscountActivity: discount_id is required");
  }

  const query = `
    INSERT INTO discount_activity_logs (
      discount_id,
      action_type,
      performed_by,
      performed_by_role,
      affected_user_id,
      old_value,
      new_value
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7);
  `;

  await pool.query(query, [
    finalDiscountId,
    action_type,
    performed_by,
    performed_by_role,
    affected_user_id,
    old_value,
    new_value,
  ]);
};

/**
 * Validate coupon code
 */
const getValidCouponByCode = async (couponCode) => {
  const query = `
    SELECT *
    FROM discounts
    WHERE coupon_code = $1
      AND type = 'COUPON'
      AND is_active = true
      AND expires_at > NOW();
  `;
  const { rows } = await pool.query(query, [couponCode]);
  return rows[0] || null;
};

/**
 * Fetch applicable manual discounts for user
 */
const getUserManualDiscounts = async (userId) => {
  const query = `
    SELECT d.*
    FROM discounts d
    JOIN user_discounts ud ON ud.discount_id = d.id
    WHERE ud.user_id = $1
      AND d.type = 'MANUAL'
      AND d.is_active = true
      AND d.expires_at > NOW();
  `;
  const { rows } = await pool.query(query, [userId]);
  return rows;
};

/**
 * List discounts by Type
 */
const listDiscountByType = async (type) => {
  const query = `
    SELECT
      d.*,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', s.id,
            'name', s.name
          )
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'
      ) AS segments
    FROM discounts d
    LEFT JOIN discount_segments ds
      ON ds.discount_id = d.id
    LEFT JOIN segments s
      ON s.id = ds.segment_id
    WHERE d.type = $1
    GROUP BY d.id
    ORDER BY d.created_at DESC;
  `;

  const { rows } = await pool.query(query, [type]);
  return rows;
};

/**
 * Get discount by ID
 */
const getDiscountById = async (discountId) => {
  const query = `SELECT * FROM discounts WHERE id = $1;`;
  const { rows } = await pool.query(query, [discountId]);
  return rows[0] || null;
};

/**
 * Update discount
 */
const updateDiscount = async (discountId, fields) => {
  const keys = Object.keys(fields);
  if (!keys.length) return null;

  const updates = keys.map((key, idx) => `${key} = $${idx + 2}`);

  const query = `
    UPDATE discounts
    SET ${updates.join(", ")}
    WHERE id = $1
    RETURNING *;
  `;

  const values = [discountId, ...Object.values(fields)];
  const { rows } = await pool.query(query, values);
  return rows[0] || null;
};

/**
 * Activate / Deactivate discount
 */
const toggleDiscountStatus = async (discountId, isActive) => {
  const query = `
    UPDATE discounts
    SET is_active = $2
    WHERE id = $1
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [discountId, isActive]);
  return rows[0] || null;
};

/**
 * List activity logs (ADMIN only)
 */
const listDiscountActivities = async () => {
  const query = `
    SELECT *
    FROM discount_activity_logs
    ORDER BY created_at DESC;
  `;
  const { rows } = await pool.query(query);
  return rows;
};

/**
 * Delete discount by ID
 * NOTE: Only intended for COUPON discounts
 */
const deleteDiscountById = async (discountId) => {
  const query = `
  DELETE FROM discounts
  WHERE id = $1
  RETURNING *`;
  const { rows } = await pool.query(query, [discountId]);
  return rows[0] || null;
};

/**
 * Get User that is assigned to a Coupon
 */
const listManualDiscountsWithUsers = async () => {
  const query = `
    SELECT
      d.*,

      /* Assigned users + template */
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'user_id', ud.user_id,
            'template_id', ud.template_id
          )
        ) FILTER (WHERE ud.user_id IS NOT NULL),
        '[]'
      ) AS assigned_users,

      /* Segments */
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', s.id,
            'name', s.name
          )
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'
      ) AS segments

    FROM discounts d
    LEFT JOIN user_discounts ud ON ud.discount_id = d.id
    LEFT JOIN discount_segments ds ON ds.discount_id = d.id
    LEFT JOIN segments s ON s.id = ds.segment_id

    WHERE d.type = 'MANUAL'
    GROUP BY d.id
    ORDER BY d.created_at DESC;
  `;

  const { rows } = await pool.query(query);
  return rows;
};

const deleteManualDiscountById = async (discountId) => {
  const query = `
    DELETE FROM discounts
    WHERE id = $1 AND type = 'MANUAL'
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [discountId]);
  return rows[0] || null;
};

/**
 * Get manual discounts assigned to a template
 */
const getTemplateManualDiscounts = async (template_id, user_id) => {
  const query = `
    SELECT
      d.*,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', s.id,
            'name', s.name
          )
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'
      ) AS segments
    FROM discounts d
    JOIN user_discounts ud ON ud.discount_id = d.id
    LEFT JOIN discount_segments ds ON ds.discount_id = d.id
    LEFT JOIN segments s ON s.id = ds.segment_id
    WHERE d.type = 'MANUAL'
      AND d.is_active = true
      AND d.expires_at > NOW()
      AND ud.user_id = $2
      AND (
        ud.template_id = $1
        OR ud.template_id IS NULL
      )
    GROUP BY d.id
    ORDER BY d.created_at DESC;
  `;

  const { rows } = await pool.query(query, [template_id, user_id]);
  return rows;
};

module.exports = {
  createDiscount,
  addDiscountSegments,
  assignDiscountToUser,
  logDiscountActivity,
  getValidCouponByCode,
  getUserManualDiscounts,
  listDiscountByType,
  getDiscountById,
  updateDiscount,
  toggleDiscountStatus,
  listDiscountActivities,
  deleteDiscountById,
  listManualDiscountsWithUsers,
  deleteManualDiscountById,
  getTemplateManualDiscounts,
};
