/* backend/migrations/1737500000001_add_discount_system.js */

exports.shim = true;

exports.up = async (pgm) => {
  /**
   * 1. Create discounts table
   */
  const { rows: discountsTable } = await pgm.db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_name = 'discounts';
  `);

  if (discountsTable.length === 0) {
    await pgm.createTable("discounts", {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },

      type: {
        type: "varchar(20)",
        notNull: true, // COUPON | MANUAL
      },

      discount_mode: {
        type: "varchar(20)",
        notNull: true, // PERCENTAGE | FIXED
      },

      value: {
        type: "numeric(5,2)",
        notNull: true,
      },

      coupon_code: {
        type: "varchar(50)",
        unique: true,
      },

      expires_at: {
        type: "timestamptz",
        notNull: true,
      },

      is_active: {
        type: "boolean",
        notNull: true,
        default: true,
      },

      created_by: {
        type: "uuid",
        notNull: true,
        references: '"users"',
        onDelete: "restrict",
      },

      created_by_role: {
        type: "varchar(20)",
        notNull: true, // ADMIN | STAFF
      },

      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    });

    await pgm.createIndex("discounts", "coupon_code", {
      name: "discounts_coupon_code_idx",
    });

    await pgm.createIndex("discounts", "expires_at", {
      name: "discounts_expires_at_idx",
    });
  }

  /**
   * 2. Create discount_segments table
   */
  const { rows: discountSegmentsTable } = await pgm.db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_name = 'discount_segments';
  `);

  if (discountSegmentsTable.length === 0) {
    await pgm.createTable("discount_segments", {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },

      discount_id: {
        type: "uuid",
        notNull: true,
        references: '"discounts"',
        onDelete: "cascade",
      },

      segment_id: {
        type: "uuid",
        notNull: true,
        references: '"segments"',
        onDelete: "cascade",
      },
    });

    await pgm.createIndex("discount_segments", ["discount_id", "segment_id"], {
      name: "discount_segments_unique_idx",
      unique: true,
    });
  }

  /**
   * 3. Create user_discounts table (for MANUAL discounts)
   */
  const { rows: userDiscountsTable } = await pgm.db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_name = 'user_discounts';
  `);

  if (userDiscountsTable.length === 0) {
    await pgm.createTable("user_discounts", {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },

      discount_id: {
        type: "uuid",
        notNull: true,
        references: '"discounts"',
        onDelete: "cascade",
      },

      user_id: {
        type: "uuid",
        notNull: true,
        references: '"users"',
        onDelete: "cascade",
      },
    });

    await pgm.createIndex("user_discounts", ["discount_id", "user_id"], {
      name: "user_discounts_unique_idx",
      unique: true,
    });
  }

  /**
   * 4. Create discount_activity_logs table
   */
  const { rows: discountLogsTable } = await pgm.db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_name = 'discount_activity_logs';
  `);

  if (discountLogsTable.length === 0) {
    await pgm.createTable("discount_activity_logs", {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },

      discount_id: {
        type: "uuid",
        notNull: true,
        references: '"discounts"',
        onDelete: "cascade",
      },

      action_type: {
        type: "varchar(30)",
        notNull: true, // CREATED | UPDATED | DEACTIVATED | EXPIRED
      },

      performed_by: {
        type: "uuid",
        notNull: true,
        references: '"users"',
        onDelete: "restrict",
      },

      performed_by_role: {
        type: "varchar(20)",
        notNull: true,
      },

      affected_user_id: {
        type: "uuid",
        references: '"users"',
        onDelete: "set null",
      },

      old_value: {
        type: "jsonb",
      },

      new_value: {
        type: "jsonb",
      },

      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    });

    await pgm.createIndex("discount_activity_logs", "discount_id", {
      name: "discount_logs_discount_id_idx",
    });
  }
};

exports.down = async (pgm) => {
  await pgm.dropTable("discount_activity_logs", { ifExists: true });
  await pgm.dropTable("user_discounts", { ifExists: true });
  await pgm.dropTable("discount_segments", { ifExists: true });
  await pgm.dropTable("discounts", { ifExists: true });
};
