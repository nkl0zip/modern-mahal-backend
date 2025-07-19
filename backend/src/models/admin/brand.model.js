const pool = require("../../config/db");

// CREATE Brand - BY ADMIN/STAFF only
const createBrand = async (
  name,
  website_url,
  image,
  description,
  establishment_date
) => {
  const query = `
    INSERT INTO brands (name, website_url, image, description, establishment_date)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  const values = [name, website_url, image, description, establishment_date];
  const result = await pool.query(query, values);
  return result.rows[0];
};

// Find by name (Unique Name)
const findBrandByName = async (name) => {
  const query = `SELECT * FROM brands WHERE name = $1;`;
  const result = await pool.query(query, [name]);
  return result.rows[0];
};

// Get all Brands
const getAllBrands = async () => {
  const query = `SELECT * FROM brands ORDER BY created_at DESC;`;
  const result = await pool.query(query);
  return result.rows;
};

// DELETE by ID - ONLY BY ADMIN
const deleteBrandById = async (id) => {
  const query = `DELETE FROM brands WHERE id = $1 RETURNING *;`;
  const result = await pool.query(query, [id]);
  return result.rows[0];
};

// Update Brand by ID
const updateBrandById = async (id, updateFields) => {
  // Only update allowed fields
  const allowedFields = [
    "name",
    "website_url",
    "image",
    "description",
    "establishment_date",
  ];
  const keys = Object.keys(updateFields).filter((field) =>
    allowedFields.includes(field)
  );

  if (keys.length === 0) {
    return null; // No valid fields to update
  }

  const setParts = keys.map((field, idx) => `${field} = $${idx + 1}`);
  setParts.push(`updated_at = CURRENT_TIMESTAMP`);

  // Values for placeholders, then id for WHERE clause
  const values = keys.map((key) => updateFields[key]);
  const query = `
    UPDATE brands
    SET ${setParts.join(", ")}
    WHERE id = $${keys.length + 1}
    RETURNING *;
  `;
  values.push(id);

  const result = await pool.query(query, values);
  return result.rows[0];
};

module.exports = {
  createBrand,
  findBrandByName,
  getAllBrands,
  deleteBrandById,
  updateBrandById,
};
