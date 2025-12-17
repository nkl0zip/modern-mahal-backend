const pool = require("../../config/db");

/**
 * Get all segments with categories they belong to
 */
const getAllSegmentsWithCategories = async () => {
  const query = `
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.created_at,
      ARRAY(
        SELECT c.name
        FROM categories c
        JOIN category_segments cs ON cs.category_id = c.id
        WHERE cs.segment_id = s.id
        ORDER BY c.name
      ) AS categories
    FROM segments s
    ORDER BY s.name ASC;
  `;

  const { rows } = await pool.query(query);
  return rows;
};

/**
 * Create a segment
 */
const createSegment = async ({ name, slug, description }) => {
  const { rows } = await pool.query(
    `
    INSERT INTO segments (name, slug, description)
    VALUES ($1, $2, $3)
    RETURNING *;
    `,
    [name, slug, description]
  );

  return rows[0];
};

/**
 * Map segment to categories
 */
const mapSegmentToCategories = async (segment_id, category_ids = []) => {
  if (!category_ids.length) return;

  const values = category_ids.map((_, i) => `($1, $${i + 2})`).join(", ");

  const query = `
    INSERT INTO category_segments (segment_id, category_id)
    VALUES ${values}
    ON CONFLICT DO NOTHING;
  `;

  await pool.query(query, [segment_id, ...category_ids]);
};

/**
 * Delete a segment (cascade removes mappings)
 */
const deleteSegmentById = async (segment_id) => {
  const { rows } = await pool.query(
    `DELETE FROM segments WHERE id = $1 RETURNING *;`,
    [segment_id]
  );
  return rows[0] || null;
};

/**
 * Find category IDs by names
 */
const findCategoryIdsByNames = async (names = []) => {
  if (!names.length) return [];

  const { rows } = await pool.query(
    `
    SELECT id FROM categories
    WHERE LOWER(name) = ANY($1);
    `,
    [names.map((n) => n.toLowerCase())]
  );

  return rows.map((r) => r.id);
};

module.exports = {
  getAllSegmentsWithCategories,
  createSegment,
  mapSegmentToCategories,
  deleteSegmentById,
  findCategoryIdsByNames,
};
