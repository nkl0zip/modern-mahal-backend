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

/**
 * Update variant details (excluding sub_code due to unique constraint)
 */
const updateVariantDetails = async (variant_id, updateData) => {
  const {
    colour_id,
    finish_id,
    mrp,
    alloy,
    weight_capacity,
    usability,
    in_box_content,
    tags,
    status,
  } = updateData;

  // Build dynamic query based on provided fields
  const fields = [];
  const values = [];
  let paramCounter = 1;

  if (colour_id !== undefined) {
    fields.push(`colour_id = $${paramCounter}`);
    values.push(colour_id);
    paramCounter++;
  }

  if (finish_id !== undefined) {
    fields.push(`finish_id = $${paramCounter}`);
    values.push(finish_id);
    paramCounter++;
  }

  if (mrp !== undefined) {
    fields.push(`mrp = $${paramCounter}`);
    values.push(mrp);
    paramCounter++;
  }

  if (alloy !== undefined) {
    fields.push(`alloy = $${paramCounter}`);
    values.push(alloy);
    paramCounter++;
  }

  if (weight_capacity !== undefined) {
    fields.push(`weight_capacity = $${paramCounter}`);
    values.push(weight_capacity);
    paramCounter++;
  }

  if (usability !== undefined) {
    fields.push(`usability = $${paramCounter}`);
    values.push(usability);
    paramCounter++;
  }

  if (in_box_content !== undefined) {
    fields.push(`in_box_content = $${paramCounter}`);
    values.push(in_box_content);
    paramCounter++;
  }

  if (tags !== undefined) {
    fields.push(`tags = $${paramCounter}`);
    values.push(tags);
    paramCounter++;
  }

  if (status !== undefined) {
    fields.push(`status = $${paramCounter}`);
    values.push(status);
    paramCounter++;
  }

  if (fields.length === 1) {
    // Only updated_at was added
    throw new Error("No fields to update");
  }

  values.push(variant_id);

  const query = `
    UPDATE product_variants
    SET ${fields.join(", ")}
    WHERE id = $${paramCounter}
    RETURNING 
      *,
      (SELECT name FROM colours WHERE id = colour_id) AS colour_name,
      (SELECT name FROM finishes WHERE id = finish_id) AS finish_name;
  `;

  const { rows } = await pool.query(query, values);
  return rows[0] || null;
};

/**
 * Soft delete variant (set status to DISCONTINUED or similar)
 * Note: We're using soft delete by changing status instead of hard delete
 * to maintain referential integrity with cart_items, orders, etc.
 */
const softDeleteVariant = async (variant_id) => {
  const { rows } = await pool.query(
    `
    UPDATE product_variants
    SET 
      status = 'DISCONTINUED'
    WHERE id = $1
    RETURNING *;
    `,
    [variant_id]
  );

  return rows[0] || null;
};

/**
 * Hard delete variant (ADMIN only - use with caution)
 * This should only be used for variants that have no references in other tables
 */
const hardDeleteVariant = async (variant_id) => {
  // First check if variant is referenced in cart_items or orders
  const referenceCheck = await pool.query(
    `
    SELECT 
      (SELECT COUNT(*) FROM cart_items WHERE variant_id = $1) as cart_count,
      (SELECT COUNT(*) FROM products_image WHERE variant_id = $1) as image_count
    `,
    [variant_id]
  );

  const { cart_count, image_count } = referenceCheck.rows[0];

  if (cart_count > 0) {
    throw new Error(
      `Cannot delete variant: It is referenced in ${cart_count} cart items`
    );
  }

  if (image_count > 0) {
    throw new Error(
      `Cannot delete variant: It has ${image_count} associated images`
    );
  }

  const { rows } = await pool.query(
    `DELETE FROM product_variants WHERE id = $1 RETURNING *;`,
    [variant_id]
  );

  return rows[0] || null;
};

/**
 * Get variant with full details including product and brand info
 */
const getVariantWithDetails = async (variant_id) => {
  const { rows } = await pool.query(
    `
    SELECT
      pv.*,
      p.name AS product_name,
      p.product_code,
      b.name AS brand_name,
      c.name AS colour_name,
      f.name AS finish_name,
      ARRAY(
        SELECT pi.media_url 
        FROM products_image pi 
        WHERE pi.variant_id = pv.id 
        ORDER BY pi.display_order ASC
      ) AS variant_images,
      (SELECT COUNT(*) FROM cart_items WHERE variant_id = pv.id) AS in_carts_count
    FROM product_variants pv
    JOIN products p ON pv.product_id = p.id
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN colours c ON pv.colour_id = c.id
    LEFT JOIN finishes f ON pv.finish_id = f.id
    WHERE pv.id = $1
    LIMIT 1;
    `,
    [variant_id]
  );

  return rows[0] || null;
};

module.exports = {
  getVariantById,
  updateVariantStatus,
  getVariantsByProduct,
  updateVariantDetails,
  softDeleteVariant,
  hardDeleteVariant,
  getVariantWithDetails,
};
