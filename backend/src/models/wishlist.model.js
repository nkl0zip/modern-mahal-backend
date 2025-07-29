const pool = require("../config/db");

// To fetch wishlist of a Wishlist of a specific user
const getUserWishlist = async (userId) => {
  const query = `
    SELECT 
      w.product_id, 
      w.added_at,
      p.name AS product_name, 
      p.product_code, 
      p.price_per_unit,
      pi.media_url AS product_image
    FROM wishlists w
    JOIN products p ON w.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT media_url
      FROM products_image
      WHERE product_id = p.id AND media_type = 'image'
      ORDER BY display_order ASC
      LIMIT 1
    ) pi ON TRUE
    WHERE w.user_id = $1
    ORDER BY w.added_at DESC;
  `;
  const result = await pool.query(query, [userId]);
  return result.rows;
};

// Add a product to the user's Wishlist
const addToWishlist = async (userId, product_id) => {
  const query = `
    INSERT INTO wishlists (user_id, product_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, product_id) DO NOTHING
    RETURNING *;
  `;
  const result = await pool.query(query, [userId, product_id]);
  return result.rows[0];
};

// Remove a product from the user's wishlist
const removeFromWishlist = async (userId, productId) => {
  const query = `
    DELETE FROM wishlists
    WHERE user_id = $1 AND product_id = $2
    RETURNING *;
  `;
  const result = await pool.query(query, [userId, productId]);
  return result.rows[0];
};

module.exports = {
  getUserWishlist,
  addToWishlist,
  removeFromWishlist,
};
