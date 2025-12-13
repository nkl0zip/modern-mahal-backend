/*
 * This migration is the major part of the updation of products table and addition of product variation according to attributes like colours, finishes, etc.
 * This addition is responsible due to the change of sheet structure and attributes structure.
 */

exports.shim = true;

exports.up = async (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  /* ------------------------------------------------------------
     1. ALTER EXISTING PRODUCTS TABLE
  ------------------------------------------------------------- */

  pgm.addColumns("products", {
    product_type: { type: "text" }, // Sheet: Product
    segment: { type: "text" }, // Sheet: Segment
  });

  // Remove fields no longer needed
  pgm.dropColumns(
    "products",
    [
      "quantity_per_unit",
      "price_per_unit",
      "quantity_bundle_max",
      "price_bundle_max",
      "quantity_bundle_ultra",
      "price_bundle_ultra",
      "product_dimension",
    ],
    { ifExists: true }
  );

  /* ------------------------------------------------------------
     2. REMOVE OLD COLOR SYSTEM
  ------------------------------------------------------------- */

  pgm.dropTable("product_color", { ifExists: true });
  pgm.dropTable("colors", { ifExists: true });

  /* ------------------------------------------------------------
     3. CREATE PRODUCT VARIANTS TABLE
  ------------------------------------------------------------- */

  pgm.createTable("product_variants", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    product_id: {
      type: "uuid",
      notNull: true,
      references: "products(id)",
      onDelete: "CASCADE",
    },
    product_code: { type: "text", notNull: true }, // Sheet: Product Code
    sub_code: { type: "text" }, // Sheet: Sub Code
    colour: { type: "text" }, // Sheet: Colours
    finish: { type: "text" }, // Sheet: Finish
    mrp: { type: "numeric(12,2)" }, // Sheet: MRP
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.createIndex("product_variants", ["product_id"]);
  pgm.createIndex("product_variants", ["product_code"]);
  pgm.createIndex("product_variants", ["sub_code"]);

  /* ------------------------------------------------------------
     4. CLEANUP UNUSED TABLES
  ------------------------------------------------------------- */

  // Tags, alloy, usability, etc remain as is — since sheet still uses them
};

exports.down = async (pgm) => {
  // Reverse operations
  pgm.dropTable("product_variants", { ifExists: true });

  pgm.addColumns("products", {
    quantity_per_unit: "integer",
    price_per_unit: "numeric(12,2)",
    quantity_bundle_max: "integer",
    price_bundle_max: "numeric(12,2)",
    quantity_bundle_ultra: "integer",
    price_bundle_ultra: "numeric(12,2)",
    product_dimension: "text",
  });

  pgm.dropColumns("products", ["product_type", "segment"], { ifExists: true });
};
