const pool = require("../../config/db");

// To insert a Image/Video with display order
const insertProductImage = async ({
  product_id,
  media_url,
  media_type,
  display_order,
}) => {
  const query = `
    INSERT INTO products_image (product_id, media_url, media_type, display_order)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;

  try {
    const result = await pool.query(query, [
      product_id,
      media_url,
      media_type,
      display_order,
    ]);
    return result.rows[0];
  } catch (err) {
    //Check for unique constraints error
    if (err.code === "23505") {
      throw new Error("Display order already exists for this product.");
    }
    throw err;
  }
};

// Fetch images/products for a product, sorted by display_order
const getProductImagesByProductId = async (product_id) => {
  const query = `
    SELECT *
    FROM products_image
    WHERE product_id = $1
    ORDER BY display_order ASC;
  `;
  const result = await pool.query(query, [product_id]);
  return result.rows;
};

module.exports = { insertProductImage, getProductImagesByProductId };
