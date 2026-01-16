// backend/models/staff/product.model.js
const pool = require("../../config/db");

// Helper: case-insensitive lookup for a record's id by name
const findIdByName = async (table, name, col = "name") => {
  if (!name) return null;
  const query = `SELECT id FROM ${table} WHERE LOWER(${col}) = LOWER($1) LIMIT 1;`;
  const result = await pool.query(query, [name.trim()]);
  return result.rows[0]?.id || null;
};

// Helper: find or create a colour and return id
const findOrCreateColour = async (name, code = null) => {
  if (!name || typeof name !== "string") return null;

  name = name.trim();
  if (!name) return null;

  const selectQ = `SELECT id FROM colours WHERE LOWER(name) = LOWER($1) LIMIT 1;`;
  const sel = await pool.query(selectQ, [name]);
  if (sel.rows.length > 0) return sel.rows[0].id;

  const insertQ = `INSERT INTO colours (name, code) VALUES ($1, $2) RETURNING id;`;
  const ins = await pool.query(insertQ, [name, code]);
  return ins.rows[0].id;
};

// Helper: find or create a finish and return id
const findOrCreateFinish = async (name, code = null) => {
  if (!name || typeof name !== "string") return null;

  name = name.trim();
  if (!name) return null;

  const selectQ = `SELECT id FROM finishes WHERE LOWER(name) = LOWER($1) LIMIT 1;`;
  const sel = await pool.query(selectQ, [name]);
  if (sel.rows.length > 0) return sel.rows[0].id;

  const insertQ = `INSERT INTO finishes (name, code) VALUES ($1, $2) RETURNING id;`;
  const ins = await pool.query(insertQ, [name, code]);
  return ins.rows[0].id;
};

/**
 * Create or return product master by product_code.
 * If a product with same product_code exists, return it.
 * product object may contain:
 *   name, brand_id, product_code, description, segment, warranty
 */
const findOrCreateProductByCode = async (product) => {
  // try find existing by product_code
  const existing = await pool.query(
    `SELECT * FROM products WHERE product_code = $1 LIMIT 1;`,
    [product.product_code]
  );
  if (existing.rows[0]) return existing.rows[0];

  const query = `
    INSERT INTO products
      (name, brand_id, product_code, description, segment, warranty)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *;
  `;
  const values = [
    product.name,
    product.brand_id,
    product.product_code,
    product.description,
    product.segment || null,
    product.warranty || null,
  ];
  const result = await pool.query(query, values);
  return result.rows[0];
};

/**
 * Create a variant row for a given product_id.
 * variantData should include:
 *  sub_code, colour (name), colour_code (optional), finish (name), finish_code,
 *  mrp, alloy, weight_capacity, usability, in_box_content, tags
 */
const createVariant = async (productId, variantData) => {
  // Skip if sub_code is null or empty - variants without sub_code can be duplicated
  if (!variantData.sub_code || variantData.sub_code.trim() === "") {
    console.warn(
      `Variant skipped: No sub_code provided for product ${productId}`
    );
    return null;
  }

  // find/create colour & finish
  let colourId = null;
  if (!variantData.colour_id) {
    colourId = variantData.colour
      ? await findOrCreateColour(variantData.colour, variantData.colour_code)
      : null;
  } else {
    colourId = variantData.colour_id;
  }

  let finishId = null;
  if (!variantData.finish_id) {
    finishId = variantData.finish
      ? await findOrCreateFinish(variantData.finish, variantData.finish_code)
      : null;
  } else {
    finishId = variantData.finish_id;
  }

  const query = `
    INSERT INTO product_variants
      (product_id, sub_code, colour_id, finish_id, mrp, alloy, weight_capacity, usability, in_box_content, tags, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (sub_code) 
    DO UPDATE SET
      product_id = EXCLUDED.product_id,
      colour_id = EXCLUDED.colour_id,
      finish_id = EXCLUDED.finish_id,
      mrp = EXCLUDED.mrp,
      alloy = EXCLUDED.alloy,
      weight_capacity = EXCLUDED.weight_capacity,
      usability = EXCLUDED.usability,
      in_box_content = EXCLUDED.in_box_content,
      tags = EXCLUDED.tags,
      status = EXCLUDED.status
    RETURNING *, 
      (xmax = 0) AS is_new;
  `;
  const values = [
    productId,
    variantData.sub_code.trim(),
    colourId,
    finishId,
    variantData.mrp || null,
    variantData.alloy || null,
    variantData.weight_capacity || null,
    variantData.usability || null,
    variantData.in_box_content || null,
    variantData.tags || null,
    variantData.status,
  ];
  const result = await pool.query(query, values);
  return result.rows[0];
};

// Insert join table for product-category (unchanged)
async function insertProductCategory(product_id, category_ids) {
  if (!category_ids || category_ids.length === 0) return;
  const query = `
    INSERT INTO product_category (product_id, category_id)
    VALUES ${category_ids.map((_, i) => `($1, $${i + 2})`).join(", ")}
    ON CONFLICT DO NOTHING;
  `;
  await pool.query(query, [product_id, ...category_ids]);
}

// Generic insert for product-level highlights
async function insertProductHighlights(product_id, highlightsArr) {
  if (!highlightsArr || highlightsArr.length === 0) return;
  const query = `
    INSERT INTO highlights (product_id, text)
    VALUES ${highlightsArr
      .map((_, i) => `($1, $${i + 2})`)
      .join(", ")} ON CONFLICT (product_id, text) DO NOTHING;
  `;
  await pool.query(query, [product_id, ...highlightsArr]);
}

/**
 * Fetch all products with their variants.
 * Returns product-level fields plus an array 'variants' with variant objects.
 */
async function getAllProductDetails() {
  const query = `
    SELECT
      p.id,
      p.name AS product_name,
      b.name AS brand,
      p.product_code,
      p.description,
      p.segment,
      p.warranty,
      ARRAY(
        SELECT c.name
        FROM product_category pc
        JOIN categories c ON pc.category_id = c.id
        WHERE pc.product_id = p.id
      ) AS product_category,
      ARRAY(
        SELECT s.name
        FROM product_segments ps
        JOIN segments s ON ps.segment_id = s.id
        WHERE ps.product_id = p.id
      ) AS segments,
      ARRAY(
        SELECT jsonb_build_object(
          'id', v.id,
          'sub_code', v.sub_code,
          'mrp', v.mrp,
          'alloy', v.alloy,
          'usability', v.usability,
          'in_box_content', v.in_box_content,
          'tags', v.tags,
          'status', v.status,
          'attributes', ARRAY[
            jsonb_build_object(
              'colour', (SELECT name FROM colours WHERE id = v.colour_id),
              'finish', (SELECT name FROM finishes WHERE id = v.finish_id),
              'weight_capacity', v.weight_capacity
            )
          ]
        )
        FROM product_variants v
        WHERE v.product_id = p.id
        ORDER BY v.created_at ASC
      ) AS variants,
      ARRAY(
        SELECT jsonb_build_object(
          'id', pi.id,
          'media_url', pi.media_url,
          'media_type', pi.media_type,
          'display_order', pi.display_order,
          'variant_id', pi.variant_id
        )
        FROM products_image pi
        WHERE pi.product_id = p.id
        ORDER BY pi.display_order ASC
      ) AS images,
      ARRAY(
        SELECT h.text
        FROM highlights h
        WHERE h.product_id = p.id
      ) AS highlights
    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    ORDER BY p.created_at DESC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

/**
 * Fetch a product by id, with variants and images
 */
async function getProductDetailsById(productId) {
  const query = `
    SELECT
      p.id,
      p.name AS product_name,
      b.name AS brand,
      p.product_code,
      p.description,
      p.segment,
      p.warranty,
      ARRAY(
        SELECT c.name
        FROM product_category pc
        JOIN categories c ON pc.category_id = c.id
        WHERE pc.product_id = p.id
      ) AS product_category,
      ARRAY(
        SELECT s.name
        FROM product_segments ps
        JOIN segments s ON ps.segment_id = s.id
        WHERE ps.product_id = p.id
      ) AS segments,
      ARRAY(
        SELECT jsonb_build_object(
          'id', v.id,
          'sub_code', v.sub_code,
          'mrp', v.mrp,
          'alloy', v.alloy,
          'usability', v.usability,
          'in_box_content', v.in_box_content,
          'tags', v.tags,
          'status', v.status,
          'attributes', ARRAY[
            jsonb_build_object(
              'colour', (SELECT name FROM colours WHERE id = v.colour_id),
              'finish', (SELECT name FROM finishes WHERE id = v.finish_id),
              'weight_capacity', v.weight_capacity
            )
          ]
        )
        FROM product_variants v
        WHERE v.product_id = p.id
        ORDER BY v.created_at ASC
      ) AS variants,
      ARRAY(
        SELECT jsonb_build_object(
          'id', pi.id,
          'media_url', pi.media_url,
          'media_type', pi.media_type,
          'display_order', pi.display_order,
          'variant_id', pi.variant_id
        )
        FROM products_image pi
        WHERE pi.product_id = p.id
        ORDER BY pi.display_order ASC
      ) AS images,
      ARRAY(
        SELECT h.text
        FROM highlights h
        WHERE h.product_id = p.id
      ) AS highlights
    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.id = $1
    LIMIT 1;
  `;

  const result = await pool.query(query, [productId]);
  return result.rows.length ? result.rows[0] : null;
}

/**
 * Search products by product name (like) or by product_code (exact).
 * Returns product-level info with a small 'variants' preview (first variant).
 */
async function searchProducts({ name, code }) {
  let whereClause = "";
  let values = [];

  if (code) {
    whereClause = "WHERE p.product_code = $1";
    values = [code];
  } else if (name) {
    whereClause = "WHERE LOWER(p.name) LIKE $1";
    values = [`%${name.toLowerCase()}%`];
  }

  const query = `
    SELECT
      p.id,
      p.name AS product_name,
      b.name AS brand,
      p.product_code,
      p.description,
      (
        SELECT jsonb_build_object(
          'id', v.id,
          'sub_code', v.sub_code,
          'mrp', v.mrp,
          'colour', (SELECT name FROM colours WHERE id = v.colour_id),
          'finish', (SELECT name FROM finishes WHERE id = v.finish_id)
        ) FROM product_variants v WHERE v.product_id = p.id ORDER BY v.created_at ASC LIMIT 1
      ) AS primary_variant,
      (
        SELECT pi.media_url FROM products_image pi WHERE pi.product_id = p.id AND pi.display_order = 1 LIMIT 1
      ) AS product_image
    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    ${whereClause}
    ORDER BY p.created_at DESC;
  `;
  const result = await pool.query(query, values);
  return result.rows;
}

/**
 * Brand product list (overview) - returns product + primary variant mrp and image
 */
const getBrandsProductList = async ({ brand_id, page = 1, limit = 20 }) => {
  if (!brand_id) return { products: [], total_count: 0, brand_name: null };
  const offset = (page - 1) * limit;

  const query = `
    WITH BrandInfo AS (
      SELECT name AS brand_name FROM brands WHERE id = $1 LIMIT 1
    ),
    FilteredProducts AS (
      SELECT
        p.id,
        p.name,
        p.product_code,
        (
          SELECT v.mrp FROM product_variants v WHERE v.product_id = p.id ORDER BY v.created_at ASC LIMIT 1
        ) AS price_per_unit,
        (
          SELECT pi.media_url FROM products_image pi WHERE pi.product_id = p.id AND (pi.variant_id IS NULL OR pi.variant_id IN (
             SELECT id FROM product_variants pv WHERE pv.product_id = p.id LIMIT 1
          )) AND pi.display_order = 1 LIMIT 1
        ) AS product_image
      FROM products p
      WHERE p.brand_id = $1
    ),
    CountResult AS (
      SELECT COUNT(*) AS total_count FROM FilteredProducts
    )
    SELECT
      fp.id AS product_id,
      fp.name AS product_name,
      fp.product_code,
      fp.price_per_unit,
      fp.product_image,
      b.brand_name,
      cr.total_count
    FROM FilteredProducts fp
    CROSS JOIN BrandInfo b
    CROSS JOIN CountResult cr
    ORDER BY fp.name ASC
    LIMIT $2 OFFSET $3;
  `;
  const { rows } = await pool.query(query, [brand_id, limit, offset]);
  if (!rows.length) return { products: [], total_count: 0, brand_name: null };

  return {
    brand_name: rows[0].brand_name,
    products: rows.map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      product_code: row.product_code,
      price_per_unit: row.price_per_unit,
      product_image: row.product_image,
    })),
    total_count: parseInt(rows[0].total_count, 10),
  };
};

/**
 * Fuzzy search / paginated list - still searches the product master but ranks by product name/description/brand/category
 * Returns primary variant price and image as overview fields to preserve old API contract.
 */
const getProductListBySearch = async ({
  name,
  page = 1,
  limit = 20,
  user = null,
}) => {
  if (!name) return { products: [], total_count: 0 };

  const offset = (page - 1) * limit;
  const searchTerm = name;

  const values = [searchTerm, limit, offset];
  let categoryFilter = "";

  /**
   * Apply category restriction ONLY for USER
   */
  if (user && user.role === "USER") {
    categoryFilter = `
      AND p.id IN (
        SELECT pc.product_id
        FROM product_category pc
        JOIN categories c ON c.id = pc.category_id
        WHERE
          c.is_global = TRUE
          OR pc.category_id IN (
            SELECT category_id
            FROM user_category_preferences
            WHERE user_id = $4
          )
      )
    `;
    values.push(user.id);
  }

  const fuzzyQuery = `
    WITH ProductScores AS (
      SELECT
        p.id,
        p.name,
        p.product_code,
        p.brand_id,
        (
          SELECT v.id
          FROM product_variants v
          WHERE v.product_id = p.id
          ORDER BY v.created_at ASC
          LIMIT 1
        ) AS variant_id,
        GREATEST(
          similarity(p.name, $1),
          similarity(p.description, $1),
          COALESCE(similarity(b.name, $1), 0),
          COALESCE((
            SELECT MAX(similarity(c.name, $1))
            FROM categories c
            JOIN product_category pc ON c.id = pc.category_id
            WHERE pc.product_id = p.id
          ), 0)
        ) AS score
      FROM products p
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE 1=1
      ${categoryFilter}
    ),
    Filtered AS (
      SELECT * FROM ProductScores WHERE score > 0.1
    ),
    CountResult AS (
      SELECT COUNT(*) AS total_count FROM Filtered
    )
    SELECT
      f.id AS product_id,
      f.variant_id,
      f.name AS product_name,
      f.product_code,
      b.name AS brand_name,
      (
        SELECT v.mrp
        FROM product_variants v
        WHERE v.product_id = f.id
        ORDER BY v.created_at ASC
        LIMIT 1
      ) AS price_per_unit,
      (
        SELECT pi.media_url
        FROM products_image pi
        WHERE pi.product_id = f.id
          AND pi.display_order = 1
        LIMIT 1
      ) AS product_image,
      f.score,
      cr.total_count
    FROM Filtered f
    LEFT JOIN brands b ON f.brand_id = b.id
    CROSS JOIN CountResult cr
    ORDER BY f.score DESC
    LIMIT $2 OFFSET $3;
  `;

  const { rows } = await pool.query(fuzzyQuery, values);

  if (!rows.length) return { products: [], total_count: 0 };

  return {
    products: rows.map((row) => ({
      product_id: row.product_id,
      variant_id: row.variant_id,
      product_name: row.product_name,
      product_code: row.product_code,
      price_per_unit: row.price_per_unit,
      brand_name: row.brand_name,
      product_image: row.product_image,
      score: row.score,
    })),
    total_count: parseInt(rows[0].total_count, 10),
  };
};

/**
 * Overview paginated listing: returns product masters with primary variant price and image
 */
const getProductOverviewPaginated = async ({
  page = 1,
  limit = 20,
  user = null,
}) => {
  const offset = (page - 1) * limit;

  const values = [limit, offset];
  let whereClause = "";

  /**
   * Apply restriction ONLY for logged-in USER
   */
  if (user && user.role === "USER") {
    whereClause = `
      WHERE EXISTS (
        SELECT 1
        FROM product_category pc
        JOIN categories c ON c.id = pc.category_id
        LEFT JOIN user_category_preferences ucp
          ON ucp.category_id = c.id
         AND ucp.user_id = $3
        WHERE pc.product_id = p.id
          AND (
            c.is_global = TRUE
            OR ucp.user_id IS NOT NULL
          )
      )
    `;
    values.push(user.id);
  }

  const query = `
    WITH FilteredProducts AS (
      SELECT p.id
      FROM products p
      ${whereClause}
    ),
    CountResult AS (
      SELECT COUNT(*) AS total_count FROM FilteredProducts
    )
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.product_code,
      (
        SELECT v.id
        FROM product_variants v
        WHERE v.product_id = p.id
        ORDER BY v.created_at ASC
        LIMIT 1
      ) AS variant_id,
      (
        SELECT v.mrp
        FROM product_variants v
        WHERE v.product_id = p.id
        ORDER BY v.created_at ASC
        LIMIT 1
      ) AS price_per_unit,
      b.name AS brand_name,
      (
        SELECT pi.media_url
        FROM products_image pi
        WHERE pi.product_id = p.id
          AND pi.display_order = 1
        LIMIT 1
      ) AS product_image,
      cr.total_count
    FROM products p
    JOIN FilteredProducts fp ON fp.id = p.id
    LEFT JOIN brands b ON p.brand_id = b.id
    CROSS JOIN CountResult cr
    ORDER BY p.created_at DESC
    LIMIT $1 OFFSET $2;
  `;

  const { rows } = await pool.query(query, values);

  if (!rows.length) {
    return { products: [], total_count: 0 };
  }

  return {
    products: rows.map((row) => ({
      product_id: row.product_id,
      variant_id: row.variant_id,
      product_name: row.product_name,
      product_code: row.product_code,
      price_per_unit: row.price_per_unit,
      brand_name: row.brand_name,
      product_image: row.product_image,
    })),
    total_count: parseInt(rows[0].total_count, 10),
  };
};

/**
 * Get products by category (overview). Returns product master + primary variant price/image
 */
const getProductsByCategory = async ({
  category_id,
  category_name,
  page = 1,
  limit = 20,
}) => {
  if (!category_id && !category_name) return { products: [], total_count: 0 };
  const offset = (page - 1) * limit;
  let whereClause = "";
  let values = [];
  if (category_id) {
    whereClause = `WHERE c.id = $1`;
    values.push(category_id);
  } else {
    whereClause = `WHERE LOWER(c.name) = LOWER($1)`;
    values.push(category_name);
  }

  const paginatedQuery = `
    WITH FilteredProducts AS (
      SELECT
        p.id,
        p.name,
        p.product_code,
        (
          SELECT v.mrp FROM product_variants v WHERE v.product_id = p.id ORDER BY v.created_at ASC LIMIT 1
        ) AS price_per_unit,
        p.brand_id,
        (
          SELECT pi.media_url FROM products_image pi WHERE pi.product_id = p.id AND pi.display_order = 1 LIMIT 1
        ) AS product_image
      FROM products p
      JOIN product_category pc ON pc.product_id = p.id
      JOIN categories c ON c.id = pc.category_id
      ${whereClause}
    ),
    CountResult AS (
      SELECT COUNT(*) AS total_count FROM FilteredProducts
    )
    SELECT
      fp.id AS product_id,
      fp.name AS product_name,
      fp.product_code,
      fp.price_per_unit,
      b.name AS brand_name,
      fp.product_image,
      cr.total_count
    FROM FilteredProducts fp
    LEFT JOIN brands b ON fp.brand_id = b.id
    CROSS JOIN CountResult cr
    ORDER BY fp.name ASC
    LIMIT $2 OFFSET $3;
  `;

  const { rows } = await pool.query(paginatedQuery, [...values, limit, offset]);
  if (!rows.length) return { products: [], total_count: 0 };

  return {
    products: rows.map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      product_code: row.product_code,
      price_per_unit: row.price_per_unit,
      brand_name: row.brand_name,
      product_image: row.product_image,
    })),
    total_count: parseInt(rows[0].total_count, 10),
  };
};

// Find segment id by name (case-insensitive)
const findSegmentIdByName = async (name) => {
  if (!name) return null;

  const query = `
    SELECT id FROM segments
    WHERE LOWER(name) = LOWER($1)
    LIMIT 1;
  `;
  const { rows } = await pool.query(query, [name.trim()]);
  return rows[0]?.id || null;
};

// Insert product-segment mapping
const insertProductSegments = async (product_id, segment_ids) => {
  if (!segment_ids || segment_ids.length === 0) return;

  const values = segment_ids.map((_, i) => `($1, $${i + 2})`).join(", ");

  const query = `
    INSERT INTO product_segments (product_id, segment_id)
    VALUES ${values}
    ON CONFLICT DO NOTHING;
  `;

  await pool.query(query, [product_id, ...segment_ids]);
};

const getProductsBySegment = async ({
  segment_id,
  segment_name,
  page = 1,
  limit = 20,
}) => {
  const offset = (page - 1) * limit;

  let whereClause = "";
  let values = [];

  if (segment_id) {
    whereClause = "WHERE s.id = $1";
    values.push(segment_id);
  } else {
    whereClause = "WHERE LOWER(s.name) = LOWER($1)";
    values.push(segment_name);
  }

  const query = `
    WITH FilteredProducts AS (
      SELECT
        p.id,
        p.name,
        p.product_code,
        (
          SELECT v.id
          FROM product_variants v
          WHERE v.product_id = p.id
          ORDER BY v.created_at ASC
          LIMIT 1
        ) AS variant_id,
        (
          SELECT v.mrp
          FROM product_variants v
          WHERE v.product_id = p.id
          ORDER BY v.created_at ASC
          LIMIT 1
        ) AS price_per_unit,
        p.brand_id,
        (
          SELECT pi.media_url
          FROM products_image pi
          WHERE pi.product_id = p.id
          AND pi.display_order = 1
          LIMIT 1
        ) AS product_image
      FROM products p
      JOIN product_segments ps ON ps.product_id = p.id
      JOIN segments s ON s.id = ps.segment_id
      ${whereClause}
    ),
    CountResult AS (
      SELECT COUNT(*) AS total_count FROM FilteredProducts
    )
    SELECT
      fp.id AS product_id,
      fp.name AS product_name,
      fp.product_code,
      fp.price_per_unit,
      fp.variant_id,
      b.name AS brand_name,
      fp.product_image,
      cr.total_count
    FROM FilteredProducts fp
    LEFT JOIN brands b ON fp.brand_id = b.id
    CROSS JOIN CountResult cr
    ORDER BY fp.name ASC
    LIMIT $2 OFFSET $3;
  `;

  const { rows } = await pool.query(query, [...values, limit, offset]);

  if (!rows.length) return { products: [], total_count: 0 };

  return {
    products: rows.map((r) => ({
      product_id: r.product_id,
      variant_id: r.variant_id,
      product_name: r.product_name,
      product_code: r.product_code,
      price_per_unit: r.price_per_unit,
      brand_name: r.brand_name,
      product_image: r.product_image,
    })),
    total_count: parseInt(rows[0].total_count, 10),
  };
};

/**
 * Variant-level paginated overview for Admin & Staff
 * Returns all variants sorted by product_code (ASC), then sub_code (ASC)
 */
const getVariantsOverviewPaginated = async ({ page = 1, limit = 20 }) => {
  const offset = (page - 1) * limit;

  const query = `
  WITH VariantData AS (
    SELECT
      p.id AS product_id,
      v.id AS variant_id,
      p.name AS product_name,
      p.product_code,
      v.sub_code,
      v.created_at,
      b.name AS brand,
      p.segment,
      v.status,
      v.mrp AS price,
      (
        SELECT ARRAY_AGG(DISTINCT c.name)
        FROM product_category pc
        JOIN categories c ON pc.category_id = c.id
        WHERE pc.product_id = p.id
      ) AS categories
    FROM product_variants v
    JOIN products p ON v.product_id = p.id
    LEFT JOIN brands b ON p.brand_id = b.id
  ),
  CountResult AS (
    SELECT COUNT(*) AS total_count FROM VariantData
  )
  SELECT
    vd.*,
    cr.total_count
  FROM VariantData vd
  CROSS JOIN CountResult cr
  ORDER BY vd.product_code ASC, vd.sub_code ASC
  LIMIT $1 OFFSET $2;
`;

  const { rows } = await pool.query(query, [limit, offset]);

  if (!rows.length) {
    return { variants: [], total_count: 0 };
  }

  return {
    variants: rows.map((row) => ({
      product_id: row.product_id,
      variant_id: row.variant_id,
      product_name: row.product_name,
      product_code: row.product_code,
      sub_code: row.sub_code,
      created_at: row.created_at,
      brand: row.brand,
      segment: row.segment,
      available_quantity: row.reserved_quantity
        ? Math.max(0, row.reserved_quantity)
        : 0,
      status: row.status,
      price: row.price,
      category: row.categories || [],
    })),
    total_count: parseInt(rows[0].total_count, 10),
  };
};

/**
 * Update product details (name, description, brand_id, warranty)
 * Does not update product_code (should remain unique and constant)
 */
const updateProductDetails = async (product_id, updateData) => {
  const { name, brand_id, description, warranty } = updateData;

  // Build dynamic query based on provided fields
  const fields = [];
  const values = [];
  let paramCounter = 1;

  if (name !== undefined) {
    fields.push(`name = $${paramCounter}`);
    values.push(name);
    paramCounter++;
  }

  if (brand_id !== undefined) {
    fields.push(`brand_id = $${paramCounter}`);
    values.push(brand_id);
    paramCounter++;
  }

  if (description !== undefined) {
    fields.push(`description = $${paramCounter}`);
    values.push(description);
    paramCounter++;
  }

  if (warranty !== undefined) {
    fields.push(`warranty = $${paramCounter}`);
    values.push(warranty);
    paramCounter++;
  }

  // Always update the updated_at timestamp
  fields.push(`updated_at = CURRENT_TIMESTAMP`);

  if (fields.length === 1) {
    // Only updated_at was added
    throw new Error("No fields to update");
  }

  values.push(product_id);

  const query = `
    UPDATE products
    SET ${fields.join(", ")}
    WHERE id = $${paramCounter}
    RETURNING 
      *,
      (SELECT name FROM brands WHERE id = products.brand_id) AS brand_name;
  `;

  const { rows } = await pool.query(query, values);
  return rows[0] || null;
};

/**
 * Update product categories (replace existing categories)
 */
const updateProductCategories = async (product_id, category_ids) => {
  // Start transaction to ensure atomic update
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Delete existing categories
    await client.query("DELETE FROM product_category WHERE product_id = $1", [
      product_id,
    ]);

    // Insert new categories if provided
    if (category_ids && category_ids.length > 0) {
      const values = category_ids.map((_, i) => `($1, $${i + 2})`).join(", ");
      const query = `
        INSERT INTO product_category (product_id, category_id)
        VALUES ${values}
        ON CONFLICT DO NOTHING;
      `;
      await client.query(query, [product_id, ...category_ids]);
    }

    // Get updated category names
    const { rows } = await client.query(
      `SELECT c.name 
       FROM categories c
       JOIN product_category pc ON c.id = pc.category_id
       WHERE pc.product_id = $1`,
      [product_id]
    );

    await client.query("COMMIT");

    return rows.map((row) => row.name);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Update product segments (replace existing segments)
 */
const updateProductSegments = async (product_id, segment_ids) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Delete existing segments
    await client.query("DELETE FROM product_segments WHERE product_id = $1", [
      product_id,
    ]);

    // Insert new segments if provided
    if (segment_ids && segment_ids.length > 0) {
      const values = segment_ids.map((_, i) => `($1, $${i + 2})`).join(", ");
      const query = `
        INSERT INTO product_segments (product_id, segment_id)
        VALUES ${values}
        ON CONFLICT DO NOTHING;
      `;
      await client.query(query, [product_id, ...segment_ids]);
    }

    // Get updated segment names
    const { rows } = await client.query(
      `SELECT s.name 
       FROM segments s
       JOIN product_segments ps ON s.id = ps.segment_id
       WHERE ps.product_id = $1`,
      [product_id]
    );

    await client.query("COMMIT");

    return rows.map((row) => row.name);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Soft delete product (mark all variants as DISCONTINUED)
 * We don't delete from products table to maintain referential integrity
 */
const softDeleteProduct = async (product_id) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Mark all variants as DISCONTINUED
    const { rows: variants } = await client.query(
      `UPDATE product_variants 
       SET status = 'DISCONTINUED'
       WHERE product_id = $1
       RETURNING id, sub_code`,
      [product_id]
    );

    // Get product info before any deletion
    const { rows: productRows } = await client.query(
      `SELECT p.*, b.name as brand_name 
       FROM products p 
       LEFT JOIN brands b ON p.brand_id = b.id 
       WHERE p.id = $1`,
      [product_id]
    );

    if (productRows.length === 0) {
      throw new Error("Product not found");
    }

    await client.query("COMMIT");

    return {
      product: productRows[0],
      updated_variants: variants,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Hard delete product (ADMIN only - use with extreme caution)
 * Deletes product and all associated data
 */
const hardDeleteProduct = async (product_id) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Check if product has any active cart items
    const cartCheck = await client.query(
      `SELECT COUNT(*) as count 
       FROM cart_items ci
       JOIN product_variants pv ON ci.variant_id = pv.id
       WHERE pv.product_id = $1`,
      [product_id]
    );

    if (parseInt(cartCheck.rows[0].count) > 0) {
      throw new Error(
        `Cannot delete product: Variants are in ${cartCheck.rows[0].count} cart items`
      );
    }

    // Check if product has any orders (you might have an orders table)
    // Add order check here if you have an orders table

    // Get product info before deletion for response
    const { rows: productRows } = await client.query(
      `SELECT * FROM products WHERE id = $1`,
      [product_id]
    );

    if (productRows.length === 0) {
      throw new Error("Product not found");
    }

    // Delete in correct order to respect foreign keys
    // 1. Delete from highlights
    await client.query("DELETE FROM highlights WHERE product_id = $1", [
      product_id,
    ]);

    // 2. Delete from tags
    await client.query("DELETE FROM tags WHERE product_id = $1", [product_id]);

    // 3. Delete from alloys
    await client.query("DELETE FROM alloys WHERE product_id = $1", [
      product_id,
    ]);

    // 4. Delete from usability
    await client.query("DELETE FROM usability WHERE product_id = $1", [
      product_id,
    ]);

    // 5. Delete from in_box_content
    await client.query("DELETE FROM in_box_content WHERE product_id = $1", [
      product_id,
    ]);

    // 6. Delete images (need to check for variant-specific images first)
    await client.query("DELETE FROM products_image WHERE product_id = $1", [
      product_id,
    ]);

    // 7. Delete product-category associations
    await client.query("DELETE FROM product_category WHERE product_id = $1", [
      product_id,
    ]);

    // 8. Delete product-segment associations
    await client.query("DELETE FROM product_segments WHERE product_id = $1", [
      product_id,
    ]);

    // 9. Delete variants (cascades to variant-specific images)
    await client.query("DELETE FROM product_variants WHERE product_id = $1", [
      product_id,
    ]);

    // 10. Delete wishlist entries
    await client.query("DELETE FROM wishlists WHERE product_id = $1", [
      product_id,
    ]);

    // 11. Delete product reviews
    await client.query("DELETE FROM product_reviews WHERE product_id = $1", [
      product_id,
    ]);

    // 12. Finally delete the product
    const { rows: deletedProduct } = await client.query(
      "DELETE FROM products WHERE id = $1 RETURNING *",
      [product_id]
    );

    await client.query("COMMIT");

    return deletedProduct[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  findIdByName,
  findOrCreateProductByCode,
  createVariant,
  insertProductCategory,
  insertProductHighlights,
  getAllProductDetails,
  searchProducts,
  getBrandsProductList,
  getProductListBySearch,
  getProductDetailsById,
  getProductsByCategory,
  getProductOverviewPaginated,
  findOrCreateColour,
  findOrCreateFinish,
  findSegmentIdByName,
  insertProductSegments,
  getProductsBySegment,
  getVariantsOverviewPaginated,
  updateProductDetails,
  updateProductCategories,
  updateProductSegments,
  softDeleteProduct,
  hardDeleteProduct,
};
