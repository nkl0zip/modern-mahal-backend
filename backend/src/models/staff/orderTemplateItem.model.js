const pool = require("../../config/db");

/**
 * Add item to template
 */
const addItemToTemplate = async ({
  template_id,
  product_id,
  variant_id,
  quantity,
  unit_price_snapshot,
  added_by,
  notes,
}) => {
  const { rows } = await pool.query(
    `
    INSERT INTO order_template_items (
      template_id, product_id, variant_id, quantity, 
      unit_price_snapshot, added_by, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (template_id, product_id, variant_id) 
    DO UPDATE SET 
      quantity = EXCLUDED.quantity,
      unit_price_snapshot = EXCLUDED.unit_price_snapshot
    RETURNING *;
    `,
    [
      template_id,
      product_id,
      variant_id,
      quantity,
      unit_price_snapshot,
      added_by,
      notes,
    ],
  );
  return rows[0];
};

/**
 * Get template items
 */
const getTemplateItems = async (template_id) => {
  const { rows } = await pool.query(
    `
    SELECT 
      oti.*,

      p.name AS product_name,
      p.product_code,

      pv.sub_code,
      pv.mrp AS current_mrp,

      cl.name AS colour_name,
      f.name AS finish_name,
      b.name AS brand_name,

      pi.media_url AS product_image,

      /* Product segments */
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', s.id,
            'name', s.name
          )
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'
      ) AS segments

    FROM order_template_items oti

    JOIN products p 
      ON oti.product_id = p.id

    LEFT JOIN product_variants pv 
      ON oti.variant_id = pv.id

    LEFT JOIN colours cl 
      ON pv.colour_id = cl.id

    LEFT JOIN finishes f 
      ON pv.finish_id = f.id

    LEFT JOIN brands b 
      ON p.brand_id = b.id

    /* Product image (product or variant level) */
    LEFT JOIN LATERAL (
      SELECT media_url 
      FROM products_image 
      WHERE (product_id = p.id OR variant_id = pv.id)
        AND display_order = 1
      LIMIT 1
    ) pi ON true

    /* Product segments */
    LEFT JOIN product_segments ps
      ON ps.product_id = p.id
    LEFT JOIN segments s
      ON s.id = ps.segment_id

    WHERE oti.template_id = $1

    GROUP BY
      oti.id,
      p.id,
      pv.id,
      cl.id,
      f.id,
      b.id,
      pi.media_url

    ORDER BY oti.added_at DESC;
    `,
    [template_id],
  );

  return rows;
};

/**
 * Update item quantity
 */
const updateItemQuantity = async (item_id, quantity) => {
  const { rows } = await pool.query(
    `
    UPDATE order_template_items
    SET 
      quantity = $2,
      last_status_date = CURRENT_TIMESTAMP
    WHERE id = $1 AND status = 'ACTIVE'
    RETURNING *;
    `,
    [item_id, quantity],
  );
  return rows[0] || null;
};

/**
 * Update item status
 */
const updateItemStatus = async (item_id, status, notes = null) => {
  const { rows } = await pool.query(
    `
    UPDATE order_template_items
    SET 
      status = $2,
      last_status_date = CURRENT_TIMESTAMP,
      notes = COALESCE($3, notes)
    WHERE id = $1
    RETURNING *;
    `,
    [item_id, status, notes],
  );
  return rows[0] || null;
};

/**
 * Remove item from template (hard delete)
 */
const removeItemFromTemplate = async (item_id) => {
  const { rows } = await pool.query(
    `
    DELETE FROM order_template_items
    WHERE id = $1
    RETURNING *;
    `,
    [item_id],
  );

  return rows[0] || null;
};

/**
 * Get item with details
 */
const getItemWithDetails = async (item_id) => {
  const { rows } = await pool.query(
    `
    SELECT 
      oti.*,
      p.name as product_name,
      p.product_code,
      pv.sub_code,
      pv.mrp as current_mrp,
      cl.name as colour_name,
      f.name as finish_name,
      pi.media_url as product_image,
      b.name as brand_name,
      ot.user_id as template_user_id,
      ot.staff_id as template_staff_id
    FROM order_template_items oti
    JOIN order_templates ot ON oti.template_id = ot.id
    JOIN products p ON oti.product_id = p.id
    LEFT JOIN product_variants pv ON oti.variant_id = pv.id
    LEFT JOIN colours cl ON pv.colour_id = cl.id
    LEFT JOIN finishes f ON pv.finish_id = f.id
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN LATERAL (
      SELECT media_url 
      FROM products_image 
      WHERE (product_id = p.id OR variant_id = pv.id) 
        AND display_order = 1 
      LIMIT 1
    ) pi ON true
    WHERE oti.id = $1
    LIMIT 1;
    `,
    [item_id],
  );
  return rows[0] || null;
};

module.exports = {
  addItemToTemplate,
  getTemplateItems,
  updateItemQuantity,
  updateItemStatus,
  removeItemFromTemplate,
  getItemWithDetails,
};
