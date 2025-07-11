const pool = require("../config/db");

// Insert a new auth method (e.g., EMAIL)
const createAuthMethod = async (userId, provider, providerId = null) => {
  const query = `
    INSERT INTO auth_methods (user_id, provider, provider_id)
    VALUES ($1, $2, $3)
    RETURNING id, provider, provider_id, created_at;
  `;
  const values = [userId, provider, providerId];
  const result = await pool.query(query, values);
  return result.rows[0];
};

// Fetch auth method for a user
const findAuthMethodByUserAndProvider = async (userId, provider) => {
  const query = `
    SELECT * FROM auth_methods
    WHERE user_id = $1 AND provider = $2;
  `;
  const result = await pool.query(query, [userId, provider]);
  return result.rows[0];
};

module.exports = {
  createAuthMethod,
  findAuthMethodByUserAndProvider,
};
