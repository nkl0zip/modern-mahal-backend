/* backend/migrations/1739500000000_template_to_cart_layered_discount.js */

exports.shim = true;

exports.up = async (pgm) => {
  /**
   * ============================================================
   * 1. Add movement tracking columns to order_template_items
   * ============================================================
   */

  const { rows: templateColumns } = await pgm.db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'order_template_items'
      AND column_name IN ('moved_to_cart_at', 'moved_cart_id');
  `);

  const existingTemplateCols = templateColumns.map((r) => r.column_name);

  if (!existingTemplateCols.includes("moved_to_cart_at")) {
    await pgm.addColumns("order_template_items", {
      moved_to_cart_at: {
        type: "timestamp",
        default: null,
      },
    });
  }

  if (!existingTemplateCols.includes("moved_cart_id")) {
    await pgm.addColumns("order_template_items", {
      moved_cart_id: {
        type: "uuid",
        references: '"cart"',
        onDelete: "set null",
      },
    });

    await pgm.createIndex("order_template_items", "moved_cart_id", {
      name: "order_template_items_moved_cart_id_idx",
    });
  }

  /**
   * ============================================================
   * 2. Add source tracking + layered discounts to cart_items
   * ============================================================
   */

  const { rows: cartItemColumns } = await pgm.db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'cart_items'
      AND column_name IN (
        'source_type',
        'source_template_id',
        'source_template_item_id',
        'manual_discount_amount',
        'coupon_discount_amount'
      );
  `);

  const existingCartItemCols = cartItemColumns.map((r) => r.column_name);

  if (!existingCartItemCols.includes("source_type")) {
    await pgm.addColumns("cart_items", {
      source_type: {
        type: "varchar(20)",
        default: "'DIRECT'",
        notNull: true,
      },
    });

    await pgm.createIndex("cart_items", "source_type", {
      name: "cart_items_source_type_idx",
    });
  }

  if (!existingCartItemCols.includes("source_template_id")) {
    await pgm.addColumns("cart_items", {
      source_template_id: {
        type: "uuid",
        references: '"order_templates"',
        onDelete: "set null",
      },
    });

    await pgm.createIndex("cart_items", "source_template_id", {
      name: "cart_items_source_template_id_idx",
    });
  }

  if (!existingCartItemCols.includes("source_template_item_id")) {
    await pgm.addColumns("cart_items", {
      source_template_item_id: {
        type: "uuid",
        references: '"order_template_items"',
        onDelete: "set null",
      },
    });

    await pgm.createIndex("cart_items", "source_template_item_id", {
      name: "cart_items_source_template_item_id_idx",
    });
  }

  if (!existingCartItemCols.includes("manual_discount_amount")) {
    await pgm.addColumns("cart_items", {
      manual_discount_amount: {
        type: "numeric(10,2)",
        default: 0,
        notNull: true,
      },
    });
  }

  if (!existingCartItemCols.includes("coupon_discount_amount")) {
    await pgm.addColumns("cart_items", {
      coupon_discount_amount: {
        type: "numeric(10,2)",
        default: 0,
        notNull: true,
      },
    });
  }

  /**
   * ============================================================
   * 3. Add coupon reference to cart table
   * ============================================================
   */

  const { rows: cartColumns } = await pgm.db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'cart'
      AND column_name = 'applied_coupon_id';
  `);

  if (cartColumns.length === 0) {
    await pgm.addColumns("cart", {
      applied_coupon_id: {
        type: "uuid",
        references: '"discounts"',
        onDelete: "set null",
      },
    });

    await pgm.createIndex("cart", "applied_coupon_id", {
      name: "cart_applied_coupon_id_idx",
    });
  }
};

exports.down = async (pgm) => {
  /**
   * ============================================================
   * Revert cart coupon reference
   * ============================================================
   */

  await pgm.dropIndex("cart", "cart_applied_coupon_id_idx", {
    ifExists: true,
  });

  await pgm.dropColumns("cart", ["applied_coupon_id"], {
    ifExists: true,
  });

  /**
   * ============================================================
   * Revert cart_items additions
   * ============================================================
   */

  await pgm.dropIndex("cart_items", "cart_items_source_template_item_id_idx", {
    ifExists: true,
  });

  await pgm.dropIndex("cart_items", "cart_items_source_template_id_idx", {
    ifExists: true,
  });

  await pgm.dropIndex("cart_items", "cart_items_source_type_idx", {
    ifExists: true,
  });

  await pgm.dropColumns(
    "cart_items",
    [
      "source_type",
      "source_template_id",
      "source_template_item_id",
      "manual_discount_amount",
      "coupon_discount_amount",
    ],
    { ifExists: true },
  );

  /**
   * ============================================================
   * Revert template movement tracking
   * ============================================================
   */

  await pgm.dropIndex(
    "order_template_items",
    "order_template_items_moved_cart_id_idx",
    { ifExists: true },
  );

  await pgm.dropColumns(
    "order_template_items",
    ["moved_to_cart_at", "moved_cart_id"],
    { ifExists: true },
  );
};
