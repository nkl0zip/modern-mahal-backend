exports.shim = true;

exports.up = async (pgm) => {
  // Add 'SUB_ADMIN' to user_role enum (safe, does nothing if already present)
  await pgm.db.query(`
    DO $$ 
    BEGIN 
      IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'user_role'::regtype AND enumlabel = 'SUB_ADMIN') THEN
        ALTER TYPE user_role ADD VALUE 'SUB_ADMIN';
      END IF;
    END $$;
  `);

  // Table for storing password reset tokens (sub-admin specific)
  await pgm.createTable(
    "sub_admin_password_resets",
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
      token: { type: "varchar(255)", notNull: true, unique: true },
      expires_at: { type: "timestamptz", notNull: true },
      used: { type: "boolean", notNull: true, default: false },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    { ifNotExists: true },
  );

  await pgm.createIndex("sub_admin_password_resets", "token");
  await pgm.createIndex("sub_admin_password_resets", "user_id");

  // Table for storing OTP codes for 2FA
  await pgm.createTable(
    "sub_admin_otps",
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
      otp_code: { type: "varchar(6)", notNull: true },
      expires_at: { type: "timestamptz", notNull: true },
      attempts: { type: "smallint", notNull: true, default: 0 },
      used: { type: "boolean", notNull: true, default: false },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    { ifNotExists: true },
  );

  await pgm.createIndex("sub_admin_otps", "user_id");
  await pgm.createIndex("sub_admin_otps", "otp_code");
};

exports.down = async (pgm) => {
  await pgm.dropTable("sub_admin_otps", { ifExists: true, cascade: true });
  await pgm.dropTable("sub_admin_password_resets", {
    ifExists: true,
    cascade: true,
  });

  // Remove 'SUB_ADMIN' from enum (PostgreSQL does not support direct removal,
  // but we leave it – re-running up will check existence)
};
