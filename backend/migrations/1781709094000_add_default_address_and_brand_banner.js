exports.shim = true;

exports.up = async (pgm) => {
  // 1. Add is_default column using raw SQL with proper transaction handling
  await pgm.db.query(`
    DO $$ 
    BEGIN 
      IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'user_address' 
        AND column_name = 'is_default'
      ) THEN
        ALTER TABLE user_address ADD COLUMN is_default boolean DEFAULT false NOT NULL;
      END IF;
    END $$;
  `);

  // 2. Create unique partial index
  await pgm.db.query(`
    DO $$ 
    BEGIN 
      IF NOT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND indexname = 'idx_unique_default_address_per_user'
      ) THEN
        CREATE UNIQUE INDEX idx_unique_default_address_per_user 
        ON user_address (user_id) 
        WHERE is_default = true;
      END IF;
    END $$;
  `);

  // 3. Add banner_image column
  await pgm.db.query(`
    DO $$ 
    BEGIN 
      IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'brands' 
        AND column_name = 'banner_image'
      ) THEN
        ALTER TABLE brands ADD COLUMN banner_image text;
      END IF;
    END $$;
  `);
};

exports.down = async (pgm) => {
  // Remove banner_image column
  await pgm.db.query(`
    ALTER TABLE brands DROP COLUMN IF EXISTS banner_image;
  `);

  // Remove the unique index
  await pgm.db.query(`
    DROP INDEX IF EXISTS idx_unique_default_address_per_user;
  `);

  // Remove is_default column
  await pgm.db.query(`
    ALTER TABLE user_address DROP COLUMN IF EXISTS is_default;
  `);
};
