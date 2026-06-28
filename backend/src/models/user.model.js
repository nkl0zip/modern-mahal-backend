const pool = require("../config/db");

const createUser = async (
  name,
  email,
  passwordHash,
  phone,
  isVerified = false,
) => {
  // Force isVerified to boolean true/false (avoids DEFAULT)
  isVerified = Boolean(isVerified);

  const query = `
    INSERT INTO users (name, email, password_hash, phone, is_verified)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, email, phone, role, is_verified, created_at;
  `;
  const values = [name, email, passwordHash, phone, isVerified]; // is_verified false by default
  const result = await pool.query(query, values);
  return result.rows[0];
};

const findUserByEmail = async (email) => {
  const query = `SELECT * FROM users WHERE email = $1;`;
  const result = await pool.query(query, [email]);
  return result.rows[0];
};

const findUserByPhone = async (phone) => {
  const query = `SELECT * FROM users WHERE phone = $1;`;
  const result = await pool.query(query, [phone]);
  return result.rows[0];
};

// Update phone and is_verified for user
const updateUserPhoneAndVerify = async (userId, phone) => {
  const query = `
    UPDATE users
    SET phone = $1, is_verified = true, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING id, name, email, phone, role, is_verified, created_at;
  `;

  const values = [phone, userId];
  const result = await pool.query(query, values);
  return result.rows[0];
};

// for updating user profile with name, and email
const updateUser = async (userId, name) => {
  const query = `
    UPDATE users
    SET name = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING id, name, email, phone, role, is_verified;
  `;
  const result = await pool.query(query, [name, userId]);
  return result.rows[0];
};

/**
 * Get user with slab details
 */
const getUserWithSlab = async (userId) => {
  const query = `
    SELECT 
      u.*,
      s.id as slab_id,
      s.name as slab_name,
      s.rank as slab_rank,
      s.pay_later_limit,
      s.description as slab_description
    FROM users u
    LEFT JOIN user_slabs s ON u.slab_id = s.id
    WHERE u.id = $1
    LIMIT 1;
  `;
  const { rows } = await pool.query(query, [userId]);
  return rows[0] || null;
};

const findUserById = async (userId) => {
  const query = `SELECT * FROM users WHERE id = $1 LIMIT 1;`;
  const result = await pool.query(query, [userId]);
  return result.rows[0];
};

module.exports = {
  createUser,
  findUserByEmail,
  findUserByPhone,
  findUserById,
  updateUserPhoneAndVerify,
  updateUser,
  getUserWithSlab,
};
