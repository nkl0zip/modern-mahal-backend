const pool = require("../config/db");

// Create a new product review - ensuring each user can post only one review per product
const createReview = async ({
  product_id,
  user_id,
  rating,
  review_title,
  review_text,
}) => {
  const query = `
    INSERT INTO product_reviews (product_id, user_id, rating, review_title, review_text)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (product_id, user_id)
    DO UPDATE SET rating = EXCLUDED.rating, review_text = EXCLUDED.review_text, review_date = CURRENT_DATE
    RETURNING *;
  `;
  const values = [product_id, user_id, rating, review_title, review_text];
  const result = await pool.query(query, values);
  return result.rows[0];
};

// Fetch all reviews for a given product
const getReviewsByProduct = async (product_id) => {
  const query = `
    SELECT 
      r.id AS review_id,
      r.rating,
      r.review_title,
      r.review_text,
      r.review_date,
      u.id AS user_id,
      u.name AS user_name,
      up.avatar_url AS user_avatar
    FROM product_reviews r
    JOIN users u ON r.user_id = u.id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE r.product_id = $1
    ORDER BY r.review_date DESC;
  `;
  const result = await pool.query(query, [product_id]);
  return result.rows;
};

// Fetch an average rating and total humber of reviews for a product
const getProductReviewStats = async (product_id) => {
  const query = `
    SELECT 
      COALESCE(ROUND(AVG(rating), 1), 0) AS avg_rating,
      COUNT(*) AS total_reviews,
      COUNT(CASE WHEN rating = 5 THEN 1 END) AS five_star,
      COUNT(CASE WHEN rating = 4 THEN 1 END) AS four_star,
      COUNT(CASE WHEN rating = 3 THEN 1 END) AS three_star,
      COUNT(CASE WHEN rating = 2 THEN 1 END) AS two_star,
      COUNT(CASE WHEN rating = 1 THEN 1 END) AS one_star
    FROM product_reviews
    WHERE product_id = $1;
  `;
  const result = await pool.query(query, [product_id]);
  return result.rows[0];
};

module.exports = { createReview, getReviewsByProduct, getProductReviewStats };
