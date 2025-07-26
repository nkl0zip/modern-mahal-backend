const pool = require("../config/db");

// Create User Details - Automatically creates itself when the user authenticates. Only call updateUser route after the user is authenticated
const createUserProfile = async (userId) => {
  const query = `
    INSERT INTO user_profiles (user_id)
    VALUES ($1)
    RETURNING *;
  `;
  const result = await pool.query(query, [userId]);
  return result.rows[0];
};

// Update User Details
const upsertUserProfile = async (
  userId,
  dateOfBirth,
  avatarUrl,
  bio,
  workingEmail
) => {
  const query = `
    INSERT INTO user_profiles (user_id, date_of_birth, avatar_url, bio, working_email)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id) DO UPDATE
    SET date_of_birth = EXCLUDED.date_of_birth,
        avatar_url = EXCLUDED.avatar_url,
        bio = EXCLUDED.bio,
        working_email = EXCLUDED.working_email,
        updated_at = CURRENT_TIMESTAMP
    RETURNING *;
  `;
  const values = [userId, dateOfBirth, avatarUrl, bio, workingEmail];
  const result = await pool.query(query, values);
  return result.rows[0];
};

module.exports = { upsertUserProfile, createUserProfile };
