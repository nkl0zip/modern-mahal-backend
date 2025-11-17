const pool = require("../../config/db");

/**
 * Insert token into blacklist (after logout)
 */
const blacklistToken = async (token, expiresAt) => {
  const q = `
    INSERT INTO token_blacklist (token, expires_at)
    VALUES ($1, $2)
    RETURNING *;
  `;
  const { rows } = await pool.query(q, [token, expiresAt]);
  return rows[0];
};

/**
 * Check if token exists in blacklist table (for access revoke)
 */
const isTokenBlacklisted = async (token) => {
  const q = `
    SELECT 1 FROM token_blacklist
    WHERE token = $1 AND expires_at > NOW()
    LIMIT 1;
  `;
  const { rows } = await pool.query(q, [token]);
  return rows.length > 0;
};

module.exports = { blacklistToken, isTokenBlacklisted };
