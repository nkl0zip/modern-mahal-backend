exports.shim = true;

exports.up = async (pgm) => {
  await pgm.createTable(
    "payment_splits",
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
      payment_method: {
        type: "varchar(30)",
        notNull: true,
      },
      amount: {
        type: "decimal(12,2)",
        notNull: true,
      },
      currency: {
        type: "varchar(3)",
        default: "INR",
      },
      status: {
        type: "varchar(30)",
        default: "PENDING",
      },
      // PayLater fields
      pay_later_transaction_id: {
        type: "uuid",
        references: "pay_later_transactions",
        onDelete: "SET NULL",
      },
      slab_id: {
        type: "uuid",
        references: "user_slabs",
        onDelete: "SET NULL",
      },
      // Online payment fields
      payment_id: {
        type: "uuid",
        references: "payments",
        onDelete: "SET NULL",
      },
      // Cash payment fields
      cash_payment_id: {
        type: "uuid",
        references: "payments",
        onDelete: "SET NULL",
      },
      completed_at: {
        type: "timestamptz",
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

  // Create indexes
  await pgm.createIndex("payment_splits", "order_id");
  await pgm.createIndex("payment_splits", "payment_method");
  await pgm.createIndex("payment_splits", "status");
  await pgm.createIndex("payment_splits", "pay_later_transaction_id");
  await pgm.createIndex("payment_splits", "payment_id");

  // Add constraints
  await pgm.sql(`
    ALTER TABLE payment_splits
    ADD CONSTRAINT payment_splits_amount_check
    CHECK (amount > 0);
  `);

  await pgm.sql(`
    ALTER TABLE payment_splits
    ADD CONSTRAINT payment_splits_payment_method_check
    CHECK (payment_method IN ('PAY_LATER', 'PHONEPE', 'CASH'));
  `);

  await pgm.sql(`
    ALTER TABLE payment_splits
    ADD CONSTRAINT payment_splits_status_check
    CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'));
  `);

  // Add trigger for updated_at
  await pgm.sql(`
    CREATE TRIGGER update_payment_splits_updated_at
    BEFORE UPDATE ON payment_splits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
};

exports.down = async (pgm) => {
  await pgm.sql(
    `DROP TRIGGER IF EXISTS update_payment_splits_updated_at ON payment_splits;`,
  );
  await pgm.dropTable("payment_splits", { ifExists: true, cascade: true });
};
