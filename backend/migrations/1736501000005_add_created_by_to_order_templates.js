/* backend/migrations/1736501000005_add_created_by_to_order_templates.js */

exports.shim = true;

exports.up = async (pgm) => {
  const { rows } = await pgm.db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'order_templates'
      AND column_name = 'created_by';
  `);

  if (rows.length === 0) {
    await pgm.addColumns("order_templates", {
      created_by: {
        type: "added_by_type",
        notNull: true,
        default: "USER",
      },
    });

    await pgm.sql(`
      UPDATE order_templates ot
      SET created_by =
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM users u
            WHERE u.id = ot.user_id
              AND u.role IN ('STAFF', 'ADMIN')
          ) THEN 'STAFF'::added_by_type
          ELSE 'USER'::added_by_type
        END
      WHERE ot.created_by = 'USER'::added_by_type;
    `);

    await pgm.createIndex("order_templates", "created_by", {
      name: "order_templates_created_by_idx",
    });
  }
};

exports.down = async (pgm) => {
  await pgm.dropIndex("order_templates", "order_templates_created_by_idx", {
    ifExists: true,
  });

  await pgm.dropColumns("order_templates", ["created_by"], { ifExists: true });
};
