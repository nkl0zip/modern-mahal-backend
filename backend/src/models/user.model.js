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

// Assign a slab to a user
const assignSlabToUser = async (userId, slabId) => {
  const query = `
    UPDATE users
    SET slab_id = $1
    WHERE id = $2
      AND role = 'USER'
    RETURNING id, name, email, slab_id;
  `;
  const { rows } = await pool.query(query, [slabId, userId]);
  return rows[0] || null;
};

module.exports = {
  createUser,
  findUserByEmail,
  findUserByPhone,
  updateUserPhoneAndVerify,
  updateUser,
  assignSlabToUser,
};
