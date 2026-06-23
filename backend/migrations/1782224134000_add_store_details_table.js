exports.shim = true;

exports.up = async (pgm) => {
  // Create store_details table
  await pgm.createTable(
    "store_details",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      store_name: {
        type: "varchar(255)",
        notNull: true,
      },
      store_code: {
        type: "varchar(50)",
        notNull: true,
        unique: true,
      },
      email: {
        type: "varchar(255)",
        notNull: true,
      },
      address_line_1: {
        type: "text",
        notNull: true,
      },
      address_line_2: {
        type: "text",
      },
      city: {
        type: "varchar(100)",
        notNull: true,
      },
      state: {
        type: "varchar(100)",
        notNull: true,
      },
      pincode: {
        type: "varchar(10)",
        notNull: true,
      },
      country: {
        type: "varchar(100)",
        notNull: true,
        default: "India",
      },
      // Map/Location fields
      latitude: {
        type: "numeric(10,8)",
        comment: "Latitude coordinate for the store",
      },
      longitude: {
        type: "numeric(11,8)",
        comment: "Longitude coordinate for the store",
      },
      google_maps_url: {
        type: "text",
        comment: "Full Google Maps URL for the store location",
      },
      google_maps_embed_url: {
        type: "text",
        comment: "Embeddable Google Maps URL for iframe display",
      },
      // Store image
      store_image_url: {
        type: "text",
        comment: "Cloudinary URL of store image",
      },
      store_image_public_id: {
        type: "text",
        comment: "Cloudinary public ID for store image",
      },
      description: {
        type: "text",
        comment: "Store description or additional information",
      },
      operating_hours: {
        type: "jsonb",
        default: "{}",
        comment: "JSON object containing operating hours for each day",
      },
      // Status
      is_active: {
        type: "boolean",
        default: true,
        notNull: true,
      },
      is_pickup_available: {
        type: "boolean",
        default: true,
        notNull: true,
      },
      pickup_instructions: {
        type: "text",
        comment: "Special instructions for self-pickup",
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
  await pgm.createIndex("store_details", "store_code");
  await pgm.createIndex("store_details", "is_active");
  await pgm.createIndex("store_details", "is_pickup_available");

  // Add trigger to update updated_at
  await pgm.sql(`
    CREATE TRIGGER update_store_details_updated_at
    BEFORE UPDATE ON store_details
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  // Add constraint to ensure email is valid
  await pgm.sql(`
    ALTER TABLE store_details
    ADD CONSTRAINT store_details_email_check 
    CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$');
  `);
};

exports.down = async (pgm) => {
  // Drop trigger
  await pgm.sql(
    `DROP TRIGGER IF EXISTS update_store_details_updated_at ON store_details;`,
  );

  // Drop table
  await pgm.dropTable("store_details", { ifExists: true, cascade: true });
};
