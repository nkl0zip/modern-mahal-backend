/* backend/migrations/1736502000000_update_products_image_add_variant.js */
exports.shim = true;

exports.up = async (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // 1) Add variant_id column
  pgm.addColumn("products_image", {
    variant_id: { type: "uuid", notNull: false },
  });

  // 2) Add foreign key
  pgm.sql(`
    ALTER TABLE products_image
    ADD CONSTRAINT products_image_variant_id_fkey
    FOREIGN KEY (variant_id)
    REFERENCES product_variants(id)
    ON DELETE CASCADE;
  `);

  // 3) Drop ANY existing unique constraints on (product_id, display_order)
  //    No loops, no fancy logic, just brute-force safe drops.

  pgm.sql(`
    ALTER TABLE products_image
    DROP CONSTRAINT IF EXISTS products_image_product_id_display_order_key;
  `);

  pgm.sql(`
    ALTER TABLE products_image
    DROP CONSTRAINT IF EXISTS products_image_product_id_display_order_unique;
  `);

  pgm.sql(`
    DROP INDEX IF EXISTS products_image_product_id_display_order_idx;
  `);

  pgm.sql(`
    DROP INDEX IF EXISTS products_image_product_id_display_order_key;
  `);

  pgm.sql(`
    DROP INDEX IF EXISTS products_image_product_id_display_order_unique;
  `);

  // 4) Create NEW partial unique indexes

  // Product-level uniqueness
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_product_level
    ON products_image (product_id, display_order)
    WHERE variant_id IS NULL;
  `);

  // Variant-level uniqueness
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_variant_level
    ON products_image (variant_id, display_order)
    WHERE variant_id IS NOT NULL;
  `);

  // 5) Index for fast variant_id lookup
  pgm.createIndex("products_image", "variant_id", { ifNotExists: true });
};

exports.down = async (pgm) => {
  // Drop new indexes
  pgm.sql(`DROP INDEX IF EXISTS idx_product_images_variant_level;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_product_images_product_level;`);
  pgm.sql(`DROP INDEX IF EXISTS products_image_variant_id_index;`);

  // Drop foreign key
  pgm.sql(`
    ALTER TABLE products_image
    DROP CONSTRAINT IF EXISTS products_image_variant_id_fkey;
  `);

  // Drop column
  pgm.dropColumn("products_image", "variant_id");

  // Optional: restore old constraint (not adding because it may break)
  // pgm.sql(`
  //   ALTER TABLE products_image
  //   ADD CONSTRAINT products_image_product_id_display_order_unique
  //   UNIQUE(product_id, display_order);
  // `);
};
