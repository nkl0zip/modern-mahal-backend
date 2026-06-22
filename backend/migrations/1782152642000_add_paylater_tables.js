// migrations/1740000000000-add-paylater-tables.js
exports.shim = true;

exports.up = async (pgm) => {
  // 1. Add pay_later_balance column to users table
  await pgm.addColumns(
    "users",
    {
      pay_later_balance: {
        type: "numeric(12,2)",
        default: 0,
        notNull: true,
        comment: "Current available pay later credit for the user",
      },
      total_pay_later_used: {
        type: "numeric(12,2)",
        default: 0,
        notNull: true,
        comment: "Total pay later amount used (for tracking)",
      },
      total_pay_later_repaid: {
        type: "numeric(12,2)",
        default: 0,
        notNull: true,
        comment: "Total pay later amount repaid",
      },
    },
    { ifNotExists: true },
  );

  // 2. Create pay_later_transactions table
  await pgm.createTable(
    "pay_later_transactions",
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
        onDelete: "CASCADE",
      },
      order_id: {
        type: "uuid",
        references: "orders",
        onDelete: "SET NULL",
      },
      transaction_type: {
        type: "varchar(20)",
        notNull: true,
        comment: "CREDIT, DEBIT, REPAYMENT, ADJUSTMENT",
      },
      amount: {
        type: "numeric(12,2)",
        notNull: true,
        check: "amount > 0",
      },
      balance_after: {
        type: "numeric(12,2)",
        notNull: true,
        comment: "User's pay later balance after this transaction",
      },
      payment_method: {
        type: "varchar(50)",
        comment: "CASH, ONLINE, BANK_TRANSFER, CHEQUE, etc.",
      },
      transaction_id: {
        type: "varchar(100)",
        comment: "External transaction ID for traceability",
      },
      description: {
        type: "text",
      },
      receipt_url: {
        type: "text",
        comment: "Cloudinary URL of uploaded receipt",
      },
      receipt_public_id: {
        type: "text",
        comment: "Cloudinary public ID for the receipt",
      },
      approved_by: {
        type: "uuid",
        references: "users",
        onDelete: "SET NULL",
        comment: "Admin/Sub-Admin who approved the repayment",
      },
      metadata: {
        type: "jsonb",
        default: "{}",
        comment: "Additional metadata",
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

  // 3. Create indexes
  await pgm.createIndex("pay_later_transactions", "user_id");
  await pgm.createIndex("pay_later_transactions", "order_id");
  await pgm.createIndex("pay_later_transactions", "transaction_type");
  await pgm.createIndex("pay_later_transactions", "created_at");
  await pgm.createIndex("pay_later_transactions", "approved_by");

  // 4. Create pay_later_audit_logs table
  await pgm.createTable(
    "pay_later_audit_logs",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      transaction_id: {
        type: "uuid",
        notNull: true,
        references: "pay_later_transactions",
        onDelete: "CASCADE",
      },
      action: {
        type: "varchar(50)",
        notNull: true,
        comment: "CREATED, APPROVED, REJECTED, CANCELLED, UPDATED",
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
      old_data: {
        type: "jsonb",
        default: "{}",
      },
      new_data: {
        type: "jsonb",
        default: "{}",
      },
      ip_address: {
        type: "varchar(45)",
      },
      user_agent: {
        type: "text",
      },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    { ifNotExists: true },
  );

  // 5. Create indexes for audit logs
  await pgm.createIndex("pay_later_audit_logs", "transaction_id");
  await pgm.createIndex("pay_later_audit_logs", "performed_by");
  await pgm.createIndex("pay_later_audit_logs", "created_at");
  await pgm.createIndex("pay_later_audit_logs", "action");

  // 6. Create function to update user pay later balance
  await pgm.sql(`
    CREATE OR REPLACE FUNCTION update_user_pay_later_balance()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Update user's pay later balance
      UPDATE users
      SET 
        pay_later_balance = pay_later_balance + NEW.amount,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = NEW.user_id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 7. Create trigger for automatic balance update
  await pgm.sql(`
    CREATE TRIGGER trg_update_pay_later_balance
    AFTER INSERT ON pay_later_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_user_pay_later_balance();
  `);

  // 8. Add trigger to update updated_at
  await pgm.sql(`
    CREATE TRIGGER update_pay_later_transactions_updated_at
    BEFORE UPDATE ON pay_later_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  // 9. Add foreign key for order_id in orders table for pay_later payments
  // Note: This will be used when pay_later is integrated with orders
  await pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' 
        AND column_name = 'pay_later_transaction_id'
      ) THEN
        ALTER TABLE orders 
        ADD COLUMN pay_later_transaction_id uuid REFERENCES pay_later_transactions(id) ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);
};

exports.down = async (pgm) => {
  // Drop triggers
  await pgm.sql(
    `DROP TRIGGER IF EXISTS trg_update_pay_later_balance ON pay_later_transactions;`,
  );
  await pgm.sql(
    `DROP TRIGGER IF EXISTS update_pay_later_transactions_updated_at ON pay_later_transactions;`,
  );
  await pgm.sql(`DROP FUNCTION IF EXISTS update_user_pay_later_balance();`);

  // Drop tables
  await pgm.dropTable("pay_later_audit_logs", {
    ifExists: true,
    cascade: true,
  });
  await pgm.dropTable("pay_later_transactions", {
    ifExists: true,
    cascade: true,
  });

  // Drop columns from users
  await pgm.dropColumns(
    "users",
    ["pay_later_balance", "total_pay_later_used", "total_pay_later_repaid"],
    { ifExists: true },
  );

  // Drop column from orders
  await pgm.dropColumns("orders", ["pay_later_transaction_id"], {
    ifExists: true,
  });
};
