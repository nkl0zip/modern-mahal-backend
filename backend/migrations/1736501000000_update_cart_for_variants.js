/* backend/migrations/1736501000000_update_cart_for_variants.js */
exports.shim = true;

exports.up = async (pgm) => {
  /* -------------------------------------------------------
     CART ITEMS → VARIANT AWARE
  --------------------------------------------------------*/

  // 1. Add variant_id column
  pgm.addColumn("cart_items", {
    variant_id: {
      type: "uuid",
      references: "product_variants(id)",
      onDelete: "CASCADE",
    },
  });

  // 2. Rename price → unit_price_snapshot
  pgm.renameColumn("cart_items", "price", "unit_price_snapshot");

  // 3. Add price_updated_at (for future price revalidation)
  pgm.addColumn("cart_items", {
    price_updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  // 4. product_options is no longer needed
  pgm.dropColumn("cart_items", "product_options", { ifExists: true });

  // 5. Remove product_id dependency (variant now defines product)
  pgm.dropConstraint("cart_items", "cart_items_product_id_fkey", {
    ifExists: true,
  });
  pgm.dropColumn("cart_items", "product_id");

  // 6. Enforce uniqueness:
  // Same variant should not appear twice in same cart
  pgm.createIndex("cart_items", ["cart_id", "variant_id"], {
    unique: true,
    name: "cart_items_cart_variant_unique",
  });

  // 7. Helpful indexes
  pgm.createIndex("cart_items", ["variant_id"]);
  pgm.createIndex("cart_items", ["cart_id"]);
};

exports.down = async (pgm) => {
  // Reverse indexes
  pgm.dropIndex("cart_items", "cart_items_cart_variant_unique");
  pgm.dropIndex("cart_items", ["variant_id"]);
  pgm.dropIndex("cart_items", ["cart_id"]);

  // Restore product_id
  pgm.addColumn("cart_items", {
    product_id: {
      type: "uuid",
      references: "products(id)",
      onDelete: "CASCADE",
    },
  });

  // Restore product_options
  pgm.addColumn("cart_items", {
    product_options: {
      type: "jsonb",
      default: pgm.func("'{}'::jsonb"),
    },
  });

  // Remove new fields
  pgm.dropColumn("cart_items", "variant_id");
  pgm.dropColumn("cart_items", "price_updated_at");

  // Rename price back
  pgm.renameColumn("cart_items", "unit_price_snapshot", "price");
};
