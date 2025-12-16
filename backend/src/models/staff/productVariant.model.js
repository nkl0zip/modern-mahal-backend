const pool = require("../../config/db");

/**
 * Get variant by ID
 */
const getVariantById = async (variant_id) => {
  const { rows } = await pool.query(
    `SELECT * FROM product_variants WHERE id = $1 LIMIT 1`,
    [variant_id]
  );
  return rows[0] || null;
};

/**
 * Update variant status (ADMIN / STAFF)
 */
const updateVariantStatus = async ({ variant_id, status }) => {
  const { rows } = await pool.query(
    `
    UPDATE product_variants
    SET status = $1
    WHERE id = $2
    RETURNING *;
    `,
    [status, variant_id]
  );

  return rows[0] || null;
};

/**
 * Get all variants of a product (Admin use)
 */
const getVariantsByProduct = async (product_id) => {
  const { rows } = await pool.query(
    `SELECT
      pv.id,
      pv.sub_code,
      pv.mrp,
      pv.status,
      cl.name AS colour,
      f.name AS finish
    FROM product_variants pv
    LEFT JOIN colours cl ON cl.id = pv.colour_id
    LEFT JOIN finishes f ON f.id = pv.finish_id
    WHERE pv.product_id = $1
    ORDER BY pv.created_at DESC;
    `,
    [product_id]
  );

  return rows;
};

module.exports = {
  getVariantById,
  updateVariantStatus,
  getVariantsByProduct,
};
