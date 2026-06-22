exports.shim = true;

exports.up = async (pgm) => {
  // 1. Add pay_later_limit column to user_slabs table
  await pgm.addColumns(
    "user_slabs",
    {
      pay_later_limit: {
        type: "numeric(12,2)",
        default: 0,
        notNull: true,
      },
      description: {
        type: "text",
      },
      is_active: {
        type: "boolean",
        default: true,
        notNull: true,
      },
    },
    { ifNotExists: true },
  );

  // 2. Create audit log table for slab changes
  await pgm.createTable(
    "slab_audit_logs",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      slab_id: {
        type: "uuid",
        notNull: true,
        references: "user_slabs",
        onDelete: "CASCADE",
      },
      action: {
        type: "varchar(50)",
        notNull: true,
      },
      changes: {
        type: "jsonb",
        default: "{}",
      },
      performed_by: {
        type: "uuid",
        notNull: true,
        references: "users",
        onDelete: "SET NULL",
      },
      performed_by_role: {
        type: "varchar(20)",
        notNull: true,
      },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    { ifNotExists: true },
  );

  // 3. Create indexes
  await pgm.createIndex("slab_audit_logs", "slab_id");
  await pgm.createIndex("slab_audit_logs", "performed_by");
  await pgm.createIndex("slab_audit_logs", "created_at");

  // 4. Update existing slabs with default values
  // Check if the column exists first
  const columnCheck = await pgm.db.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'user_slabs' 
    AND column_name = 'pay_later_limit';
  `);

  if (columnCheck.rows.length > 0) {
    // Column exists, update it
    await pgm.db.query(`
      UPDATE user_slabs 
      SET 
        pay_later_limit = CASE 
          WHEN rank = 1 THEN 50000
          WHEN rank = 2 THEN 30000
          WHEN rank = 3 THEN 15000
          WHEN rank = 4 THEN 5000
          ELSE 0
        END,
        description = CASE 
          WHEN rank = 1 THEN 'Premium Slab - Highest pay later limit'
          WHEN rank = 2 THEN 'Gold Slab'
          WHEN rank = 3 THEN 'Silver Slab'
          WHEN rank = 4 THEN 'Bronze Slab'
          ELSE 'Base Slab - No pay later limit'
        END
      WHERE pay_later_limit = 0;
    `);
  }
};

exports.down = async (pgm) => {
  // Drop audit log table
  await pgm.dropTable("slab_audit_logs", { ifExists: true, cascade: true });

  // Drop columns from user_slabs
  await pgm.dropColumns(
    "user_slabs",
    ["pay_later_limit", "description", "is_active"],
    {
      ifExists: true,
    },
  );
};
