/* backend/migrations/1736501000001_add_status_to_product_variants.js */
exports.shim = true;

exports.up = async (pgm) => {
  // Ensure pgcrypto (already used across project, safe to keep)
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  /* ------------------------------------
     Create ENUM for variant status
  -------------------------------------*/
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'variant_status'
      ) THEN
        CREATE TYPE variant_status AS ENUM (
          'ACTIVE',
          'INACTIVE',
          'OUT_OF_STOCK',
          'DISCONTINUED'
        );
      END IF;
    END$$;
  `);

  /* ------------------------------------
     Add status column to product_variants
  -------------------------------------*/
  pgm.addColumn("product_variants", {
    status: {
      type: "variant_status",
      notNull: true,
      default: "ACTIVE",
    },
  });

  /* ------------------------------------
     Index for fast filtering (listing)
  -------------------------------------*/
  pgm.createIndex("product_variants", ["status"]);
};

exports.down = async (pgm) => {
  // Remove index first
  pgm.dropIndex("product_variants", ["status"], { ifExists: true });

  // Drop column
  pgm.dropColumn("product_variants", "status", { ifExists: true });

  // Drop ENUM (only if no dependency exists)
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'variant_status'
      ) THEN
        DROP TYPE variant_status;
      END IF;
    END$$;
  `);
};
