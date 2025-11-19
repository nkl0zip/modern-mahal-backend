const pool = require("../../config/db");

// Helper function: case-insensitive lookup for mapping
const findIdByName = async (table, name, col = "name") => {
  const query = `SELECT id FROM ${table} WHERE LOWER(${col}) = LOWER($1) LIMIT 1;`;
  const result = await pool.query(query, [name.trim()]);
  return result.rows[0]?.id || null;
};

const createProduct = async (product) => {
  const query = `
    INSERT INTO products 
    (name, brand_id, product_code, description, stock_quantity, quantity_per_unit, price_per_unit, quantity_bundle_max, price_bundle_max, quantity_bundle_ultra, price_bundle_ultra, weight_capacity, product_dimension, warranty)
    VALUES 
    ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *;
  `;

  const values = [
    product.name,
    product.brand_id,
    product.product_code,
    product.description,
    product.stock_quantity,
    product.quantity_per_unit,
    product.price_per_unit,
    product.quantity_bundle_max,
    product.price_bundle_max,
    product.quantity_bundle_ultra,
    product.price_bundle_ultra,
    product.weight_capacity,
    product.product_dimension,
    product.warranty,
  ];
  const result = await pool.query(query, values);
  return result.rows[0];
};

// Insert join table for product-category
async function insertProductCategory(product_id, category_ids) {
  if (!category_ids || category_ids.length === 0) return;
  const query = `
    INSERT INTO product_category (product_id, category_id)
    VALUES ${category_ids.map((_, i) => `($1, $${i + 2})`).join(", ")}
    ON CONFLICT DO NOTHING;
  `;
  await pool.query(query, [product_id, ...category_ids]);
}

// Insert join table for product-color
async function insertProductColor(product_id, color_ids) {
  if (!color_ids || color_ids.length === 0) return;
  const query = `
    INSERT INTO product_color (product_id, color_id)
    VALUES ${color_ids.map((_, i) => `($1, $${i + 2})`).join(", ")}
    ON CONFLICT DO NOTHING;
  `;
  await pool.query(query, [product_id, ...color_ids]);
}

// One-to-many: highlights, alloys, usability, in_box_content, tags
async function insertOneToMany(table, product_id, valuesArr, col) {
  if (!valuesArr || valuesArr.length === 0) return;
  const query = `
    INSERT INTO ${table} (product_id, ${col})
    VALUES ${valuesArr.map((_, i) => `($1, $${i + 2})`).join(", ")};
  `;
  await pool.query(query, [product_id, ...valuesArr]);
}

// Fetch all product details with joins for all attributes
async function getAllProductDetails() {
  const query = `
    SELECT 
      p.id,
      p.name AS "product_name",
      b.name AS "brand",
      p.product_code AS "product_code",
      p.description AS "description",
      p.stock_quantity AS "stock_quantity",
      p.quantity_per_unit AS "quantity_per_unit",
      p.price_per_unit AS "price_per_unit",
      p.quantity_bundle_max AS "quantity_bundle_max",
      p.price_bundle_max AS "price_bundle_max",
      p.quantity_bundle_ultra AS "quantity_bundle_ultra",
      p.price_bundle_ultra AS "price_bundle_ultra",
      p.weight_capacity AS "weight_capacity",
      p.product_dimension AS "product_dimension",
      p.warranty AS "warranty",

      -- Arrays for categories and colors
      ARRAY(
        SELECT c.name
        FROM product_category pc
        JOIN categories c ON pc.category_id = c.id
        WHERE pc.product_id = p.id
      ) AS "product_category",

      ARRAY(
        SELECT cl.name
        FROM product_color pcl
        JOIN colors cl ON pcl.color_id = cl.id
        WHERE pcl.product_id = p.id
      ) AS "colour",

      -- Arrays for one-to-many attributes
      ARRAY(
        SELECT h.text
        FROM highlights h
        WHERE h.product_id = p.id
      ) AS "highlights",

      ARRAY(
        SELECT a.name
        FROM alloys a
        WHERE a.product_id = p.id
      ) AS "alloy",

      ARRAY(
        SELECT u.name
        FROM usability u
        WHERE u.product_id = p.id
      ) AS "usability",

      ARRAY(
        SELECT ibc.name
        FROM in_box_content ibc
        WHERE ibc.product_id = p.id
      ) AS "in_box_content",

      ARRAY(
        SELECT t.name
        FROM tags t
        WHERE t.product_id = p.id
      ) AS "tags"

    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    ORDER BY p.created_at DESC
  `;
  const result = await pool.query(query);
  return result.rows;
}

// Fetch product details by product ID with joins for all attributes
async function getProductDetailsById(productId) {
  const query = `
    SELECT 
      p.id,
      p.name AS "product_name",
      b.name AS "brand",
      p.product_code AS "product_code",
      p.description AS "description",
      p.stock_quantity AS "stock_quantity",
      p.quantity_per_unit AS "quantity_per_unit",
      p.price_per_unit AS "price_per_unit",
      p.quantity_bundle_max AS "quantity_bundle_max",
      p.price_bundle_max AS "price_bundle_max",
      p.quantity_bundle_ultra AS "quantity_bundle_ultra",
      p.price_bundle_ultra AS "price_bundle_ultra",
      p.weight_capacity AS "weight_capacity",
      p.product_dimension AS "product_dimension",
      p.warranty AS "warranty",

      -- Array of product images/videos as JSON objects
      ARRAY(
        SELECT jsonb_build_object(
          'id', pi.id,
          'media_url', pi.media_url,
          'media_type', pi.media_type,
          'display_order', pi.display_order
        )
        FROM products_image pi
        WHERE pi.product_id = p.id
        ORDER BY pi.display_order ASC
      ) AS "images",

      -- Arrays for categories and colors
      ARRAY(
        SELECT c.name
        FROM product_category pc
        JOIN categories c ON pc.category_id = c.id
        WHERE pc.product_id = p.id
      ) AS "product_category",

      ARRAY(
        SELECT cl.name
        FROM product_color pcl
        JOIN colors cl ON pcl.color_id = cl.id
        WHERE pcl.product_id = p.id
      ) AS "colour",

      -- One-to-many attributes
      ARRAY(SELECT h.text FROM highlights h WHERE h.product_id = p.id) AS "highlights",
      ARRAY(SELECT a.name FROM alloys a WHERE a.product_id = p.id) AS "alloy",
      ARRAY(SELECT u.name FROM usability u WHERE u.product_id = p.id) AS "usability",
      ARRAY(SELECT ibc.name FROM in_box_content ibc WHERE ibc.product_id = p.id) AS "in_box_content",
      ARRAY(SELECT t.name FROM tags t WHERE t.product_id = p.id) AS "tags"

    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.id = $1
    LIMIT 1;
  `;

  const result = await pool.query(query, [productId]);

  // Return null if product not found
  return result.rows.length ? result.rows[0] : null;
}

// Fetch products by name (partial match) or code (exact match)
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
      p.name AS "product_name",
      b.name AS "brand",
      p.product_code AS "product_code",
      p.description AS "description",
      p.stock_quantity AS "stock_quantity",
      p.quantity_per_unit AS "quantity_per_unit",
      p.price_per_unit AS "price_per_unit",
      p.quantity_bundle_max AS "quantity_bundle_max",
      p.price_bundle_max AS "price_bundle_max",
      p.quantity_bundle_ultra AS "quantity_bundle_ultra",
      p.price_bundle_ultra AS "price_bundle_ultra",
      p.weight_capacity AS "weight_capacity",
      p.product_dimension AS "product_dimension",
      p.warranty AS "warranty",

      ARRAY(
        SELECT c.name
        FROM product_category pc
        JOIN categories c ON pc.category_id = c.id
        WHERE pc.product_id = p.id
      ) AS "product_category",

      ARRAY(
        SELECT cl.name
        FROM product_color pcl
        JOIN colors cl ON pcl.color_id = cl.id
        WHERE pcl.product_id = p.id
      ) AS "colour",

      ARRAY(
        SELECT h.text
        FROM highlights h
        WHERE h.product_id = p.id
      ) AS "highlights",

      ARRAY(
        SELECT a.name
        FROM alloys a
        WHERE a.product_id = p.id
      ) AS "alloy",

      ARRAY(
        SELECT u.name
        FROM usability u
        WHERE u.product_id = p.id
      ) AS "usability",

      ARRAY(
        SELECT ibc.name
        FROM in_box_content ibc
        WHERE ibc.product_id = p.id
      ) AS "in_box_content",

      ARRAY(
        SELECT t.name
        FROM tags t
        WHERE t.product_id = p.id
      ) AS "tags"

    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    ${whereClause}
    ORDER BY p.created_at DESC
  `;
  const result = await pool.query(query, values);
  return result.rows;
}

// Get Product List of a particular Brand
const getBrandsProductList = async (brand_id) => {
  const query = `
    SELECT p.id AS "Product Id",
    p.name AS "Product Name",
    p.product_code AS "product_code",
    p.price_per_unit AS "Price per unit"
    FROM products p WHERE p.brand_id = $1 ORDER BY p.created_at DESC;
  `;
  const result = await pool.query(query, [brand_id]);
  return result.rows;
};

/**
 * Model to fetch products by name (fuzzy) or product_id (exact)
 * Includes product image (display_order = 1), brand info, and essential fields.
 * Paginated Fuzzy Search for products, where each Page holds 20 products
 */
const getProductListBySearch = async ({ name, page = 1, limit = 20 }) => {
  if (!name) return { products: [], total_count: 0 };

  const offset = (page - 1) * limit;

  const searchTerm = name;

  const fuzzyQuery = `
    WITH ProductScores AS (
      SELECT
        p.id,
        p.name,
        p.product_code,
        p.price_per_unit,
        p.brand_id,
        
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
    ),

    Filtered AS (
      SELECT *
      FROM ProductScores
      WHERE score > 0.1
    ),

    CountResult AS (
      SELECT COUNT(*) AS total_count FROM Filtered
    )

    SELECT 
      f.id AS product_id,
      f.name AS product_name,
      f.product_code,
      f.price_per_unit,
      b.name AS brand_name,
      (
        SELECT pi.media_url FROM products_image pi
        WHERE pi.product_id = f.id
        AND pi.display_order = 1 LIMIT 1
      ) AS product_image,
      f.score,
      cr.total_count
    FROM Filtered f
    LEFT JOIN brands b ON f.brand_id = b.id
    CROSS JOIN CountResult cr
    ORDER BY f.score DESC
    LIMIT $2 OFFSET $3;
  `;

  const values = [searchTerm, limit, offset];

  const { rows } = await pool.query(fuzzyQuery, values);

  if (!rows.length) return { products: [], total_count: 0 };

  return {
    products: rows.map((row) => ({
      product_id: row.product_id,
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
 * Product Overview for listing section (non-fuzzy)
 * Returns essential product info only
 */
const getProductOverviewPaginated = async ({ page = 1, limit = 20 }) => {
  const offset = (page - 1) * limit;

  const query = `
    WITH CountResult AS (
      SELECT COUNT(*) AS total_count FROM products
    )
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.product_code,
      p.price_per_unit,
      b.name AS brand_name,
      (
        SELECT pi.media_url FROM products_image pi
        WHERE pi.product_id = p.id AND pi.display_order = 1 LIMIT 1
      ) AS product_image,
      cr.total_count
    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    CROSS JOIN CountResult cr
    ORDER BY p.created_at DESC
    LIMIT $1 OFFSET $2;
  `;

  const { rows } = await pool.query(query, [limit, offset]);

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

// Get Products By Category (name or ID)
const getProductsByCategory = async ({ category_id, category_name }) => {
  if (!category_id && !category_name) return [];

  let query;
  let values;

  // Search by category ID
  if (category_id) {
    query = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.product_code,
        p.price_per_unit,
        b.name AS brand_name,
        (
          SELECT pi.media_url FROM products_image pi
          WHERE pi.product_id = p.id AND pi.display_order = 1
          LIMIT 1
        ) AS product_image
      FROM products p
      JOIN product_category pc ON pc.product_id = p.id
      JOIN categories c ON c.id = pc.category_id
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE c.id = $1
      ORDER BY p.created_at DESC;
    `;
    values = [category_id];
  } else {
    // Search by category NAME
    query = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.product_code,
        p.price_per_unit,
        b.name AS brand_name,
        (
          SELECT pi.media_url FROM products_image pi
          WHERE pi.product_id = p.id AND pi.display_order = 1
          LIMIT 1
        ) AS product_image
      FROM products p
      JOIN product_category pc ON pc.product_id = p.id
      JOIN categories c ON c.id = pc.category_id
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE LOWER(c.name) = LOWER($1)
      ORDER BY p.created_at DESC;
    `;
    values = [category_name];
  }

  const { rows } = await pool.query(query, values);
  return rows;
};

module.exports = {
  findIdByName,
  createProduct,
  insertProductCategory,
  insertProductColor,
  insertOneToMany,
  getAllProductDetails,
  searchProducts,
  getBrandsProductList,
  getProductListBySearch,
  getProductDetailsById,
  getProductsByCategory,
  getProductOverviewPaginated,
};
