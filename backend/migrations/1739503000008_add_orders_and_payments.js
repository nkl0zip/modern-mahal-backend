// backend/migrations/1739503000008_add_orders_and_payments.js

exports.shim = true;

exports.up = async (pgm) => {
  // 1. Create enums if they don't exist (safe idempotent creation)
  await pgm.db.query(`
    DO $$ BEGIN
      CREATE TYPE order_status AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  await pgm.db.query(`
    DO $$ BEGIN
      CREATE TYPE payment_status AS ENUM ('INITIATED', 'SUCCESS', 'FAILED', 'PENDING', 'REFUNDED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  // 2. Create orders table (with ifNotExists to be idempotent)
  await pgm.createTable(
    "orders",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      user_id: {
        type: "uuid",
        notNull: true,
        references: "users",
        onDelete: "RESTRICT", // prevent deletion of user if orders exist
      },
      cart_id: {
        type: "uuid",
        references: "cart",
        onDelete: "SET NULL", // keep order even if cart is deleted
      },
      order_number: {
        type: "varchar(50)",
        notNull: true,
        unique: true, // human‑readable unique order ID
      },
      total_amount: {
        type: "numeric(12,2)",
        notNull: true,
        check: "total_amount >= 0",
      },
      discount_amount: {
        type: "numeric(12,2)",
        notNull: true,
        default: 0,
        check: "discount_amount >= 0",
      },
      tax_amount: {
        type: "numeric(12,2)",
        notNull: true,
        default: 0,
        check: "tax_amount >= 0",
      },
      shipping_amount: {
        type: "numeric(12,2)",
        notNull: true,
        default: 0,
        check: "shipping_amount >= 0",
      },
      grand_total: {
        type: "numeric(12,2)",
        notNull: true,
        check: "grand_total >= 0",
      },
      status: {
        type: "order_status",
        notNull: true,
        default: "PENDING",
      },
      shipping_address_id: {
        type: "uuid",
        references: "user_address",
        onDelete: "SET NULL",
      },
      billing_address_id: {
        type: "uuid",
        references: "user_address",
        onDelete: "SET NULL",
      },
      applied_coupon_id: {
        type: "uuid",
        references: "discounts",
        onDelete: "SET NULL",
      },
      metadata: {
        type: "jsonb",
        default: "{}",
      },
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

  // 3. Create order_items table
  await pgm.createTable(
    "order_items",
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
        onDelete: "CASCADE", // delete items if order is deleted
      },
      product_id: {
        type: "uuid",
        notNull: true,
        references: "products",
        onDelete: "RESTRICT",
      },
      variant_id: {
        type: "uuid",
        references: "product_variants",
        onDelete: "SET NULL",
      },
      quantity: {
        type: "integer",
        notNull: true,
        check: "quantity > 0",
      },
      unit_price: {
        type: "numeric(10,2)",
        notNull: true,
        check: "unit_price >= 0",
      },
      discount_amount: {
        type: "numeric(10,2)",
        notNull: true,
        default: 0,
        check: "discount_amount >= 0",
      },
      total_price: {
        type: "numeric(10,2)",
        notNull: true,
        check: "total_price >= 0",
      },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    { ifNotExists: true },
  );

  // 4. Create payments table
  await pgm.createTable(
    "payments",
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
        onDelete: "RESTRICT", // do not delete order while payments exist
      },
      payment_gateway: {
        type: "varchar(20)",
        notNull: true,
      },
      gateway_transaction_id: {
        type: "varchar(100)",
        unique: true,
      },
      amount: {
        type: "numeric(12,2)",
        notNull: true,
        check: "amount >= 0",
      },
      currency: {
        type: "varchar(3)",
        notNull: true,
        default: "INR",
      },
      status: {
        type: "payment_status",
        notNull: true,
        default: "INITIATED",
      },
      gateway_request: {
        type: "jsonb",
      },
      gateway_response: {
        type: "jsonb",
      },
      error_message: {
        type: "text",
      },
      metadata: {
        type: "jsonb",
        default: "{}",
      },
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

  // 5. Create payment_events table for webhook auditing (optional but recommended)
  await pgm.createTable(
    "payment_events",
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
        onDelete: "CASCADE",
      },
      event_type: {
        type: "varchar(50)",
        notNull: true,
      },
      event_data: {
        type: "jsonb",
        notNull: true,
      },
      processed_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    { ifNotExists: true },
  );

  // 6. Indexes for performance
  await pgm.createIndex("orders", "user_id");
  await pgm.createIndex("orders", "order_number");
  await pgm.createIndex("orders", "status");
  await pgm.createIndex("orders", "created_at");

  await pgm.createIndex("order_items", "order_id");
  await pgm.createIndex("order_items", "product_id");

  await pgm.createIndex("payments", "order_id");
  await pgm.createIndex("payments", "gateway_transaction_id");
  await pgm.createIndex("payments", "status");

  await pgm.createIndex("payment_events", "payment_id");

  // 7. Triggers to automatically update `updated_at` columns
  // (the function `update_updated_at_column` exists from the main schema)
  await pgm.createTrigger("orders", "update_orders_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "update_updated_at_column",
  });

  await pgm.createTrigger("payments", "update_payments_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "update_updated_at_column",
  });
};

exports.down = async (pgm) => {
  // Remove triggers first
  await pgm.dropTrigger("orders", "update_orders_updated_at", {
    ifExists: true,
  });
  await pgm.dropTrigger("payments", "update_payments_updated_at", {
    ifExists: true,
  });

  // Drop tables in reverse dependency order
  await pgm.dropTable("payment_events", { ifExists: true, cascade: true });
  await pgm.dropTable("payments", { ifExists: true, cascade: true });
  await pgm.dropTable("order_items", { ifExists: true, cascade: true });
  await pgm.dropTable("orders", { ifExists: true, cascade: true });

  // Drop the enums
  await pgm.db.query(`DROP TYPE IF EXISTS order_status;`);
  await pgm.db.query(`DROP TYPE IF EXISTS payment_status;`);
};
