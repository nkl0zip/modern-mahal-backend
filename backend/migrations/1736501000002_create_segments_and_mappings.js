/* backend/migrations/1736501000002_create_segments_and_mappings.js */

exports.shim = true;

exports.up = async (pgm) => {
  // Ensure UUID support
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  /* -----------------------------------------------------
     SEGMENTS MASTER TABLE
  ----------------------------------------------------- */
  pgm.createTable("segments", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: {
      type: "text",
      notNull: true,
      unique: true,
    },
    slug: {
      type: "text",
      unique: true,
    },
    description: {
      type: "text",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.createIndex("segments", ["name"]);
  pgm.createIndex("segments", ["slug"]);

  /* -----------------------------------------------------
     CATEGORY ↔ SEGMENT (MANY-TO-MANY)
  ----------------------------------------------------- */
  pgm.createTable("category_segments", {
    category_id: {
      type: "uuid",
      notNull: true,
      references: "categories(id)",
      onDelete: "CASCADE",
    },
    segment_id: {
      type: "uuid",
      notNull: true,
      references: "segments(id)",
      onDelete: "CASCADE",
    },
  });

  pgm.addConstraint("category_segments", "category_segments_unique", {
    unique: ["category_id", "segment_id"],
  });

  pgm.createIndex("category_segments", ["category_id"]);
  pgm.createIndex("category_segments", ["segment_id"]);

  /* -----------------------------------------------------
     PRODUCT ↔ SEGMENT (MANY-TO-MANY)
  ----------------------------------------------------- */
  pgm.createTable("product_segments", {
    product_id: {
      type: "uuid",
      notNull: true,
      references: "products(id)",
      onDelete: "CASCADE",
    },
    segment_id: {
      type: "uuid",
      notNull: true,
      references: "segments(id)",
      onDelete: "CASCADE",
    },
  });

  pgm.addConstraint("product_segments", "product_segments_unique", {
    unique: ["product_id", "segment_id"],
  });

  pgm.createIndex("product_segments", ["product_id"]);
  pgm.createIndex("product_segments", ["segment_id"]);
};

exports.down = async (pgm) => {
  pgm.dropTable("product_segments", { ifExists: true });
  pgm.dropTable("category_segments", { ifExists: true });
  pgm.dropTable("segments", { ifExists: true });
};
