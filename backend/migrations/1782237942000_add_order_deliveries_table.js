exports.shim = true;

exports.up = async (pgm) => {
  await pgm.createTable(
    "order_deliveries",
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
      delivery_method_id: {
        type: "uuid",
        notNull: true,
        references: "delivery_methods",
        onDelete: "RESTRICT",
      },
      delivery_status: {
        type: "varchar(30)",
        notNull: true,
        default: "PENDING",
      },
      // SELF Pickup fields
      pickup_id: {
        type: "varchar(20)",
        unique: true,
      },
      pickup_otp: {
        type: "varchar(6)",
      },
      pickup_otp_expires_at: {
        type: "timestamptz",
      },
      pickup_code_generated_at: {
        type: "timestamptz",
      },
      store_pickup_location_id: {
        type: "uuid",
        references: "store_details",
        onDelete: "SET NULL",
      },
      pickup_verified_by: {
        type: "uuid",
        references: "users",
        onDelete: "SET NULL",
      },
      pickup_verified_at: {
        type: "timestamptz",
      },
      pickup_instructions: {
        type: "text",
      },
      // MANUAL/AUTO Delivery fields
      delivery_address_id: {
        type: "uuid",
        references: "user_address",
        onDelete: "SET NULL",
      },
      delivery_address_text: {
        type: "text",
      },
      delivery_latitude: {
        type: "decimal(10,8)",
      },
      delivery_longitude: {
        type: "decimal(11,8)",
      },
      delivery_notes: {
        type: "text",
      },
      // Staff/Auto details
      assigned_staff_id: {
        type: "uuid",
        references: "users",
        onDelete: "SET NULL",
      },
      assigned_at: {
        type: "timestamptz",
      },
      dispatched_at: {
        type: "timestamptz",
      },
      estimated_delivery_time: {
        type: "timestamptz",
      },
      actual_delivery_time: {
        type: "timestamptz",
      },
      // Tracking
      tracking_url: {
        type: "text",
      },
      tracking_id: {
        type: "varchar(100)",
      },
      // Charges
      delivery_charge: {
        type: "decimal(10,2)",
        default: 0,
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
  await pgm.createIndex("order_deliveries", "order_id");
  await pgm.createIndex("order_deliveries", "delivery_status");
  await pgm.createIndex("order_deliveries", "pickup_id");
  await pgm.createIndex("order_deliveries", "pickup_otp");
  await pgm.createIndex("order_deliveries", "assigned_staff_id");
  await pgm.createIndex("order_deliveries", "store_pickup_location_id");
  await pgm.createIndex("order_deliveries", "created_at");

  // Add trigger for updated_at
  await pgm.sql(`
    CREATE TRIGGER update_order_deliveries_updated_at
    BEFORE UPDATE ON order_deliveries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  // Add constraint for delivery_status
  await pgm.sql(`
    ALTER TABLE order_deliveries
    ADD CONSTRAINT order_deliveries_delivery_status_check
    CHECK (delivery_status IN ('PENDING', 'PROCESSING', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'FAILED'));
  `);
};

exports.down = async (pgm) => {
  await pgm.sql(
    `DROP TRIGGER IF EXISTS update_order_deliveries_updated_at ON order_deliveries;`,
  );
  await pgm.dropTable("order_deliveries", { ifExists: true, cascade: true });
};
