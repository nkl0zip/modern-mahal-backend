exports.shim = true;

exports.up = async (pgm) => {
  // 1. Order status history table
  await pgm.createTable(
    "order_status_history",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      order_id: {
        type: "uuid",
        notNull: true,
        references: "orders",
        onDelete: "CASCADE",
      },
      old_status: { type: "order_status" },
      new_status: { type: "order_status", notNull: true },
      changed_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
      reason: { type: "text" },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    { ifNotExists: true },
  );

  await pgm.createIndex("order_status_history", "order_id");
  await pgm.createIndex("order_status_history", "changed_by");
  await pgm.createIndex("order_status_history", "created_at");

  // 2. Order notes (internal)
  await pgm.createTable(
    "order_notes",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      order_id: {
        type: "uuid",
        notNull: true,
        references: "orders",
        onDelete: "CASCADE",
      },
      author_id: {
        type: "uuid",
        notNull: true,
        references: "users",
        onDelete: "CASCADE",
      },
      note: { type: "text", notNull: true },
      is_private: { type: "boolean", notNull: true, default: true },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
      updated_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    { ifNotExists: true },
  );

  await pgm.createIndex("order_notes", "order_id");
  await pgm.createIndex("order_notes", "author_id");

  // 3. Return requests
  await pgm.createTable(
    "order_returns",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      order_id: {
        type: "uuid",
        notNull: true,
        references: "orders",
        onDelete: "CASCADE",
      },
      user_id: {
        type: "uuid",
        notNull: true,
        references: "users",
        onDelete: "CASCADE",
      },
      order_item_id: {
        type: "uuid",
        references: "order_items",
        onDelete: "SET NULL",
      },
      reason: { type: "text", notNull: true },
      status: { type: "varchar(20)", notNull: true, default: "PENDING" },
      admin_notes: { type: "text" },
      requested_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
      processed_at: { type: "timestamptz" },
      processed_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
    },
    { ifNotExists: true },
  );

  await pgm.createIndex("order_returns", "order_id");
  await pgm.createIndex("order_returns", "status");

  // 4. Refunds table (linked to payments)
  await pgm.createTable(
    "refunds",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      payment_id: {
        type: "uuid",
        notNull: true,
        references: "payments",
        onDelete: "RESTRICT",
      },
      order_id: {
        type: "uuid",
        notNull: true,
        references: "orders",
        onDelete: "CASCADE",
      },
      amount: { type: "numeric(12,2)", notNull: true, check: "amount > 0" },
      reason: { type: "text" },
      status: { type: "varchar(20)", notNull: true, default: "PENDING" },
      gateway_refund_id: { type: "varchar(100)" },
      processed_at: { type: "timestamptz" },
      processed_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
      metadata: { type: "jsonb", default: "{}" },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
      updated_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    { ifNotExists: true },
  );

  await pgm.createIndex("refunds", "payment_id");
  await pgm.createIndex("refunds", "order_id");
  await pgm.createIndex("refunds", "status");

  // 5. Add tracking columns to orders (if not already present)
  await pgm.addColumns(
    "orders",
    {
      updated_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
      status_change_reason: { type: "text" },
    },
    { ifNotExists: true },
  );

  await pgm.createIndex("orders", "updated_by");

  // 6. Create the trigger function BEFORE creating triggers that use it
  await pgm.db.query(`
    CREATE OR REPLACE FUNCTION log_order_status_change()
    RETURNS TRIGGER AS $$
    BEGIN
      IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, reason)
        VALUES (NEW.id, OLD.status, NEW.status, NEW.updated_by, NEW.status_change_reason);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 7. Triggers for updated_at on order_notes and refunds
  await pgm.createTrigger("order_notes", "update_order_notes_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "update_updated_at_column",
  });

  await pgm.createTrigger("refunds", "update_refunds_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "update_updated_at_column",
  });

  // 8. Trigger to automatically log order status changes
  await pgm.createTrigger("orders", "log_order_status_change", {
    when: "AFTER",
    operation: "UPDATE",
    level: "ROW",
    function: "log_order_status_change", // No parentheses!
  });
};

exports.down = async (pgm) => {
  await pgm.dropTrigger("orders", "log_order_status_change", {
    ifExists: true,
  });
  await pgm.db.query(`DROP FUNCTION IF EXISTS log_order_status_change();`);
  await pgm.dropTable("refunds", { ifExists: true, cascade: true });
  await pgm.dropTable("order_returns", { ifExists: true, cascade: true });
  await pgm.dropTable("order_notes", { ifExists: true, cascade: true });
  await pgm.dropTable("order_status_history", {
    ifExists: true,
    cascade: true,
  });
};
