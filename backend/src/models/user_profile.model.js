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
      up.working_email,

      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', c.id,
            'name', c.name
          )
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'
      ) AS selected_categories

    FROM users u
    LEFT JOIN user_profiles up
      ON u.id = up.user_id
    LEFT JOIN user_category_preferences ucp
      ON u.id = ucp.user_id
    LEFT JOIN categories c
      ON c.id = ucp.category_id

    WHERE u.id = $1
    GROUP BY 
      u.id,
      up.user_id,
      up.date_of_birth,
      up.avatar_url,
      up.bio,
      up.created_at,
      up.updated_at,
      up.working_email;
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

/**
 * Get selected categories for a user
 */
const getUserCategories = async (userId) => {
  const query = `
    SELECT c.id, c.name
    FROM user_category_preferences ucp
    JOIN categories c ON c.id = ucp.category_id
    WHERE ucp.user_id = $1
    ORDER BY ucp.created_at ASC;
  `;
  const { rows } = await pool.query(query, [userId]);
  return rows;
};

/**
 * Assign categories to user (initial assignment only)
 */
const assignUserCategories = async (userId, categoryIds) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const categoryId of categoryIds) {
      await client.query(
        `
        INSERT INTO user_category_preferences (user_id, category_id)
        VALUES ($1, $2);
        `,
        [userId, categoryId]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Update (replace) user categories
 */
const updateUserCategories = async (userId, categoryIds) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM user_category_preferences WHERE user_id = $1`,
      [userId]
    );

    for (const categoryId of categoryIds) {
      await client.query(
        `
        INSERT INTO user_category_preferences (user_id, category_id)
        VALUES ($1, $2);
        `,
        [userId, categoryId]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getUserProfile,
  upsertUserProfile,
  createUserProfile,
  getUserCategories,
  assignUserCategories,
  updateUserCategories,
};
