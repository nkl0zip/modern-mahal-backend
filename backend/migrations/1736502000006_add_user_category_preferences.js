/* backend/migrations/1736502000006_add_user_category_preferences.js */

exports.shim = true;

exports.up = async (pgm) => {
  /**
   * 1. Add is_global flag to categories (Tools, Others, etc.)
   */
  const { rows: categoryColumns } = await pgm.db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'categories'
      AND column_name = 'is_global';
  `);

  if (categoryColumns.length === 0) {
    await pgm.addColumns("categories", {
      is_global: {
        type: "boolean",
        notNull: true,
        default: false,
      },
    });

    await pgm.createIndex("categories", "is_global", {
      name: "categories_is_global_idx",
    });
  }

  /**
   * 2. Create user_category_preferences table
   */
  const { rows: tables } = await pgm.db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_name = 'user_category_preferences';
  `);

  if (tables.length === 0) {
    await pgm.createTable("user_category_preferences", {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },

      user_id: {
        type: "uuid",
        notNull: true,
        references: '"users"',
        onDelete: "cascade",
      },

      category_id: {
        type: "uuid",
        notNull: true,
        references: '"categories"',
        onDelete: "cascade",
      },

      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    });

    /**
     * 3. Constraints & Indexes
     */
    await pgm.addConstraint(
      "user_category_preferences",
      "user_category_preferences_unique",
      {
        unique: ["user_id", "category_id"],
      }
    );

    await pgm.createIndex("user_category_preferences", "user_id", {
      name: "user_category_preferences_user_id_idx",
    });

    await pgm.createIndex("user_category_preferences", "category_id", {
      name: "user_category_preferences_category_id_idx",
    });

    /**
     * 4. DB-level enforcement: max 2 categories per USER
     */
    await pgm.sql(`
      CREATE OR REPLACE FUNCTION enforce_max_two_categories_per_user()
      RETURNS trigger AS $$
      BEGIN
        IF (
          SELECT COUNT(*)
          FROM user_category_preferences ucp
          JOIN users u ON u.id = ucp.user_id
          WHERE ucp.user_id = NEW.user_id
            AND u.role = 'USER'
        ) >= 2 THEN
          RAISE EXCEPTION 'A user can select only 2 categories';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pgm.sql(`
      CREATE TRIGGER trg_enforce_max_two_categories
      BEFORE INSERT ON user_category_preferences
      FOR EACH ROW
      EXECUTE FUNCTION enforce_max_two_categories_per_user();
    `);
  }
};

exports.down = async (pgm) => {
  await pgm.sql(`
    DROP TRIGGER IF EXISTS trg_enforce_max_two_categories
    ON user_category_preferences;
  `);

  await pgm.sql(`
    DROP FUNCTION IF EXISTS enforce_max_two_categories_per_user;
  `);

  await pgm.dropTable("user_category_preferences", { ifExists: true });

  await pgm.dropIndex("categories", "categories_is_global_idx", {
    ifExists: true,
  });

  await pgm.dropColumns("categories", ["is_global"], { ifExists: true });
};
