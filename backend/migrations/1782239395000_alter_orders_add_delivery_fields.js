exports.shim = true;

exports.up = async (pgm) => {
  // Add delivery columns to orders
  await pgm.addColumns(
    "orders",
    {
      delivery_method_id: {
        type: "uuid",
        references: "delivery_methods",
        onDelete: "SET NULL",
      },
      delivery_id: {
        type: "uuid",
        references: "order_deliveries",
        onDelete: "SET NULL",
      },
      selected_payment_method: {
        type: "varchar(30)",
      },
      pay_later_used: {
        type: "decimal(12,2)",
        default: 0,
      },
      online_paid: {
        type: "decimal(12,2)",
        default: 0,
      },
      cash_paid: {
        type: "decimal(12,2)",
        default: 0,
      },
      payment_split_completed: {
        type: "boolean",
        default: false,
      },
      pay_later_transaction_id: {
        type: "uuid",
        references: "pay_later_transactions",
        onDelete: "SET NULL",
      },
    },
    { ifNotExists: true },
  );

  // Add constraints
  await pgm.sql(`
    ALTER TABLE orders
    ADD CONSTRAINT orders_selected_payment_method_check
    CHECK (selected_payment_method IN ('PAY_LATER', 'PHONEPE', 'MIXED', 'CASH'));
  `);

  // Add indexes
  await pgm.createIndex("orders", "delivery_method_id");
  await pgm.createIndex("orders", "delivery_id");
  await pgm.createIndex("orders", "selected_payment_method");
  await pgm.createIndex("orders", "pay_later_transaction_id");

  // Add function to update order status when all splits complete
  await pgm.sql(`
    CREATE OR REPLACE FUNCTION update_order_status_on_split_completion()
    RETURNS TRIGGER AS $$
    DECLARE
      v_order_id UUID;
      v_all_completed BOOLEAN;
      v_order_total DECIMAL(12,2);
      v_completed_total DECIMAL(12,2);
    BEGIN
      v_order_id := NEW.order_id;
      
      -- Check if all splits for this order are completed
      SELECT 
        COUNT(*) = SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END),
        SUM(amount) FILTER (WHERE status = 'COMPLETED')
      INTO v_all_completed, v_completed_total
      FROM payment_splits
      WHERE order_id = v_order_id;
      
      IF v_all_completed THEN
        -- Get order total
        SELECT grand_total INTO v_order_total
        FROM orders
        WHERE id = v_order_id;
        
        -- Update order status and payment completed flag
        UPDATE orders
        SET 
          payment_split_completed = true,
          status = 'PAID',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = v_order_id
        AND status = 'PENDING';
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create trigger for payment split completion
  await pgm.sql(`
    CREATE TRIGGER trg_update_order_on_split_completion
    AFTER UPDATE OF status ON payment_splits
    FOR EACH ROW
    WHEN (NEW.status = 'COMPLETED')
    EXECUTE FUNCTION update_order_status_on_split_completion();
  `);
};

exports.down = async (pgm) => {
  await pgm.sql(
    `DROP TRIGGER IF EXISTS trg_update_order_on_split_completion ON payment_splits;`,
  );
  await pgm.sql(
    `DROP FUNCTION IF EXISTS update_order_status_on_split_completion();`,
  );

  await pgm.dropIndex("orders", "pay_later_transaction_id");
  await pgm.dropIndex("orders", "selected_payment_method");
  await pgm.dropIndex("orders", "delivery_id");
  await pgm.dropIndex("orders", "delivery_method_id");

  await pgm.dropColumns(
    "orders",
    [
      "delivery_method_id",
      "delivery_id",
      "selected_payment_method",
      "pay_later_used",
      "online_paid",
      "cash_paid",
      "payment_split_completed",
      "pay_later_transaction_id",
    ],
    { ifExists: true },
  );
};
