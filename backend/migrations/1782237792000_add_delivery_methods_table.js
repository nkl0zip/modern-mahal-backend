exports.shim = true;

exports.up = async (pgm) => {
  // Create delivery_methods table
  await pgm.createTable(
    "delivery_methods",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      name: {
        type: "varchar(50)",
        notNull: true,
      },
      code: {
        type: "varchar(20)",
        notNull: true,
        unique: true,
      },
      description: {
        type: "text",
      },
      is_active: {
        type: "boolean",
        default: true,
        notNull: true,
      },
      requires_address: {
        type: "boolean",
        default: false,
        notNull: true,
      },
      estimated_delivery_days: {
        type: "integer",
      },
      base_charge: {
        type: "decimal(10,2)",
        default: 0,
      },
      charge_per_km: {
        type: "decimal(10,2)",
        default: 0,
      },
      icon_url: {
        type: "text",
      },
      display_order: {
        type: "integer",
        default: 0,
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
  await pgm.createIndex("delivery_methods", "code");
  await pgm.createIndex("delivery_methods", "is_active");

  // Insert default delivery methods
  await pgm.sql(`
    INSERT INTO delivery_methods (name, code, description, is_active, requires_address, estimated_delivery_days, base_charge, display_order)
    VALUES 
      ('Self Pickup', 'SELF_PICKUP', 'Pick up your order from our store', true, false, 0, 0, 1),
      ('Manual Delivery', 'MANUAL_DELIVERY', 'Delivered by our staff', true, true, 2, 50.00, 2),
      ('Auto Delivery', 'AUTO_DELIVERY', 'Delivered by partner delivery service', true, true, 1, 30.00, 3);
  `);

  // Add trigger for updated_at
  await pgm.sql(`
    CREATE TRIGGER update_delivery_methods_updated_at
    BEFORE UPDATE ON delivery_methods
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
};

exports.down = async (pgm) => {
  await pgm.sql(
    `DROP TRIGGER IF EXISTS update_delivery_methods_updated_at ON delivery_methods;`,
  );
  await pgm.dropTable("delivery_methods", { ifExists: true, cascade: true });
};
