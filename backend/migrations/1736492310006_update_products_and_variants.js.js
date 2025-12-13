/* backend/migrations/)1736492310006_update_products_and_variants.js */
exports.shim = true;

exports.up = async (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // ---- NEW TABLE: colours ----
  pgm.createTable("colours", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "varchar(255)", notNull: true },
    code: { type: "varchar(50)" },
  });
  pgm.createIndex("colours", ["name"]);

  // ---- NEW TABLE: finishes ----
  pgm.createTable("finishes", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "varchar(255)", notNull: true },
    code: { type: "varchar(50)" },
  });
  pgm.createIndex("finishes", ["name"]);

  pgm.dropTable("product_variants", { ifExists: true });

  // ---- NEW TABLE: product_variants ----
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
    sub_code: { type: "varchar(255)" },

    colour_id: {
      type: "uuid",
      references: "colours(id)",
      onDelete: "SET NULL",
    },
    finish_id: {
      type: "uuid",
      references: "finishes(id)",
      onDelete: "SET NULL",
    },

    mrp: { type: "numeric(10,2)" },

    alloy: { type: "varchar(255)" },
    weight_capacity: { type: "varchar(255)" },
    usability: { type: "varchar(255)" },
    in_box_content: { type: "varchar(255)" },
    tags: { type: "varchar(255)" },

    created_at: {
      type: "timestamp",
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.createIndex("product_variants", ["product_id"]);
  pgm.createIndex("product_variants", ["sub_code"]);
  pgm.createIndex("product_variants", ["colour_id"]);
  pgm.createIndex("product_variants", ["finish_id"]);
};

exports.down = async (pgm) => {
  pgm.dropTable("product_variants", { ifExists: true });
  pgm.dropTable("finishes", { ifExists: true });
  pgm.dropTable("colours", { ifExists: true });
};
