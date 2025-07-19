const pool = require("../../config/db");

// To create a Category - ONLY BY ADMIN
const createCategory = async (name, slug, description) => {
  const query = `
    INSERT INTO categories (name, slug, description)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;
  const values = [name, slug, description];
  const result = await pool.query(query, values);
  return result.rows[0];
};

// Find by name or slug
const findCategoryByNameOrSlug = async (name, slug) => {
  const query = `
    SELECT * FROM categories WHERE name = $1 OR slug = $2;`;
  const result = await pool.query(query, [name, slug]);
  return result.rows[0];
};

// Get all Categories
const getAllCategories = async () => {
  const query = `SELECT * FROM categories ORDER BY created_at DESC;`;
  const result = await pool.query(query);
  return result.rows;
};

// DELETE by ID - Only by ADMIN
const deleteCategoryById = async (id) => {
  const query = `DELETE FROM categories WHERE id = $1 RETURNING *;`;
  const result = await pool.query(query, [id]);
  return result.rows[0];
};

module.exports = {
  createCategory,
  findCategoryByNameOrSlug,
  getAllCategories,
  deleteCategoryById,
};
