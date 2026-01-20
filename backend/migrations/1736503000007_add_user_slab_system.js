/* backend/migrations/1736503000007_add_user_slab_system.js */

exports.shim = true;

exports.up = async (pgm) => {
  /**
   * 1. Create user_slabs table (if not exists)
   */
  const { rows: slabTable } = await pgm.db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_name = 'user_slabs';
  `);

  if (slabTable.length === 0) {
    await pgm.createTable("user_slabs", {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },

      name: {
        type: "varchar(50)",
        notNull: true,
        unique: true,
      },

      rank: {
        type: "smallint",
        notNull: true,
        unique: true,
      },

      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    });
  }

  /**
   * 2. Insert default 5 slabs (idempotent)
   */
  await pgm.sql(`
    INSERT INTO user_slabs (name, rank)
    VALUES
      ('Superstar', 1),
      ('Premium', 2),
      ('Gold', 3),
      ('Silver', 4),
      ('Standard', 5)
    ON CONFLICT (rank) DO NOTHING;
  `);

  /**
   * 3. Add slab_id column to users table (if not exists)
   */
  const { rows: slabColumn } = await pgm.db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'slab_id';
  `);

  if (slabColumn.length === 0) {
    await pgm.addColumns("users", {
      slab_id: {
        type: "uuid",
        references: '"user_slabs"',
        onDelete: "set null",
      },
    });

    await pgm.createIndex("users", "slab_id", {
      name: "users_slab_id_idx",
    });
  }

  /**
   * 4. Assign ALL existing USERS to the lowest slab (rank = max)
   */
  await pgm.sql(`
    UPDATE users
    SET slab_id = (
      SELECT id
      FROM user_slabs
      ORDER BY rank DESC
      LIMIT 1
    )
    WHERE role = 'USER'
      AND slab_id IS NULL;
  `);
};

exports.down = async (pgm) => {
  /**
   * Remove slab_id from users
   */
  await pgm.dropIndex("users", "users_slab_id_idx", {
    ifExists: true,
  });

  await pgm.dropColumns("users", ["slab_id"], { ifExists: true });

  /**
   * Drop user_slabs table
   */
  await pgm.dropTable("user_slabs", { ifExists: true });
};
