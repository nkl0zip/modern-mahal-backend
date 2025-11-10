const pool = require("../../config/db");

// Create a staff user in users table (role = 'STAFF')
// Only by ADMIN
const createStaff = async ({
  name,
  email,
  phone,
  password_hash,
  is_verified = true,
}) => {
  const query = `
    INSERT INTO users (name, email, phone, password_hash, role, is_verified)
    VALUES ($1, $2, $3, $4, 'STAFF', $5)
    RETURNING id, name, email, phone, role, is_verified, created_at;
  `;
  const values = [name, email, phone || null, password_hash, is_verified];
  const { rows } = await pool.query(query, values);
  return rows[0];
};

const findStaffByEmail = async (email) => {
  const query = `SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND role = 'STAFF' LIMIT 1`;
  const { rows } = await pool.query(query, [email]);
  return rows[0] || null;
};

const findStaffById = async (id) => {
  const query = `SELECT id, name, email, phone, role, is_verified, created_at FROM users WHERE id = $1 AND role = 'STAFF' LIMIT 1`;
  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
};

const updateStaffPassword = async (staffId, newHashedPassword) => {
  const query = `UPDATE users SET password_hash = $1 WHERE id = $2 AND role = 'STAFF'`;
  await pool.query(query, [newHashedPassword, staffId]);
};

const deleteStaffById = async (staffId) => {
  const query = `DELETE FROM users WHERE id = $1 AND role = 'STAFF' RETURNING id, name, email`;
  const { rows } = await pool.query(query, [staffId]);
  return rows[0] || null;
};

// list staff for admin
const listStaff = async (limit = 50, offset = 0) => {
  const query = `
    SELECT id, name, email, phone, is_verified, created_at
    FROM users
    WHERE role = 'STAFF'
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2;
  `;
  const { rows } = await pool.query(query, [limit, offset]);
  return rows;
};

module.exports = {
  createStaff,
  findStaffByEmail,
  findStaffById,
  updateStaffPassword,
  deleteStaffById,
  listStaff,
};
