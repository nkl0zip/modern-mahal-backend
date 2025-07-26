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
      p.name AS "Product Name",
      b.name AS "Brand",
      p.product_code AS "Product Code",
      p.description AS "Description",
      p.stock_quantity AS "Stock Quantity",
      p.quantity_per_unit AS "Quantity Per Unit",
      p.price_per_unit AS "Price per unit",
      p.quantity_bundle_max AS "Quantity Bundle Max",
      p.price_bundle_max AS "Price Bundle Max",
      p.quantity_bundle_ultra AS "Quantity Bundle Ultra",
      p.price_bundle_ultra AS "Price Bundle Ultra",
      p.weight_capacity AS "Weight Capacity",
      p.product_dimension AS "Product Dimension",
      p.warranty AS "Warranty",

      -- Arrays for categories and colors
      ARRAY(
        SELECT c.name
        FROM product_category pc
        JOIN categories c ON pc.category_id = c.id
        WHERE pc.product_id = p.id
      ) AS "Product Category",

      ARRAY(
        SELECT cl.name
        FROM product_color pcl
        JOIN colors cl ON pcl.color_id = cl.id
        WHERE pcl.product_id = p.id
      ) AS "Colour",

      -- Arrays for one-to-many attributes
      ARRAY(
        SELECT h.text
        FROM highlights h
        WHERE h.product_id = p.id
      ) AS "Highlights",

      ARRAY(
        SELECT a.name
        FROM alloys a
        WHERE a.product_id = p.id
      ) AS "Alloy",

      ARRAY(
        SELECT u.name
        FROM usability u
        WHERE u.product_id = p.id
      ) AS "Usability",

      ARRAY(
        SELECT ibc.name
        FROM in_box_content ibc
        WHERE ibc.product_id = p.id
      ) AS "In Box Content",

      ARRAY(
        SELECT t.name
        FROM tags t
        WHERE t.product_id = p.id
      ) AS "Tags"

    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    ORDER BY p.created_at DESC
  `;
  const result = await pool.query(query);
  return result.rows;
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
      p.name AS "Product Name",
      b.name AS "Brand",
      p.product_code AS "Product Code",
      p.description AS "Description",
      p.stock_quantity AS "Stock Quantity",
      p.quantity_per_unit AS "Quantity Per Unit",
      p.price_per_unit AS "Price per unit",
      p.quantity_bundle_max AS "Quantity Bundle Max",
      p.price_bundle_max AS "Price Bundle Max",
      p.quantity_bundle_ultra AS "Quantity Bundle Ultra",
      p.price_bundle_ultra AS "Price Bundle Ultra",
      p.weight_capacity AS "Weight Capacity",
      p.product_dimension AS "Product Dimension",
      p.warranty AS "Warranty",

      ARRAY(
        SELECT c.name
        FROM product_category pc
        JOIN categories c ON pc.category_id = c.id
        WHERE pc.product_id = p.id
      ) AS "Product Category",

      ARRAY(
        SELECT cl.name
        FROM product_color pcl
        JOIN colors cl ON pcl.color_id = cl.id
        WHERE pcl.product_id = p.id
      ) AS "Colour",

      ARRAY(
        SELECT h.text
        FROM highlights h
        WHERE h.product_id = p.id
      ) AS "Highlights",

      ARRAY(
        SELECT a.name
        FROM alloys a
        WHERE a.product_id = p.id
      ) AS "Alloy",

      ARRAY(
        SELECT u.name
        FROM usability u
        WHERE u.product_id = p.id
      ) AS "Usability",

      ARRAY(
        SELECT ibc.name
        FROM in_box_content ibc
        WHERE ibc.product_id = p.id
      ) AS "In Box Content",

      ARRAY(
        SELECT t.name
        FROM tags t
        WHERE t.product_id = p.id
      ) AS "Tags"

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
    p.product_code AS "Product Code",
    p.price_per_unit AS "Price per unit"
    FROM products p WHERE p.brand_id = $1 ORDER BY p.created_at DESC;
  `;
  const result = await pool.query(query, [brand_id]);
  return result.rows;
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
};
