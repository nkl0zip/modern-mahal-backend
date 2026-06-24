exports.shim = true;

exports.up = async (pgm) => {
  await pgm.createTable(
    "delivery_tracking_events",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      delivery_id: {
        type: "uuid",
        notNull: true,
        references: "order_deliveries",
        onDelete: "CASCADE",
      },
      event_type: {
        type: "varchar(50)",
        notNull: true,
      },
      event_description: {
        type: "text",
      },
      event_location: {
        type: "text",
      },
      event_latitude: {
        type: "decimal(10,8)",
      },
      event_longitude: {
        type: "decimal(11,8)",
      },
      event_data: {
        type: "jsonb",
        default: "{}",
      },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
      created_by: {
        type: "uuid",
        references: "users",
        onDelete: "SET NULL",
      },
    },
    { ifNotExists: true },
  );

  // Create indexes
  await pgm.createIndex("delivery_tracking_events", "delivery_id");
  await pgm.createIndex("delivery_tracking_events", "event_type");
  await pgm.createIndex("delivery_tracking_events", "created_at");

  // Add constraint for event_type
  await pgm.sql(`
    ALTER TABLE delivery_tracking_events
    ADD CONSTRAINT delivery_tracking_events_event_type_check
    CHECK (event_type IN ('PICKUP', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'FAILED', 'CANCELLED'));
  `);
};

exports.down = async (pgm) => {
  await pgm.dropTable("delivery_tracking_events", {
    ifExists: true,
    cascade: true,
  });
};
