const pool = require("../config/db");

// Get Profile Info
const getUserProfile = async (userId) => {
  const query = `
    SELECT 
      u.name,
      u.email,
      u.role,
      u.is_verified,

      up.user_id,
      up.date_of_birth,
      up.avatar_url,
      up.bio,
      up.created_at AS profile_created_at,
      up.updated_at AS profile_updated_at,
      up.working_email

    FROM users u
    LEFT JOIN user_profiles up
      ON u.id = up.user_id
    WHERE u.id = $1
  `;

  const result = await pool.query(query, [userId]);
  return result.rows[0];
};

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

module.exports = { getUserProfile, upsertUserProfile, createUserProfile };
