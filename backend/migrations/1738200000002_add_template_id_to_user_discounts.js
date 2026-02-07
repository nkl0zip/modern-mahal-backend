/* backend/migrations/1738200000002_add_template_id_to_user_discounts.js */

exports.shim = true;

exports.up = async (pgm) => {
  /**
   * Add template_id column to user_discounts table (if not exists)
   */
  const { rows: columnExists } = await pgm.db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'user_discounts'
      AND column_name = 'template_id';
  `);

  if (columnExists.length === 0) {
    await pgm.addColumns("user_discounts", {
      template_id: {
        type: "uuid",
        references: '"order_templates"',
        onDelete: "set null",
      },
    });

    await pgm.createIndex("user_discounts", "template_id", {
      name: "user_discounts_template_id_idx",
    });
  }
};

exports.down = async (pgm) => {
  /**
   * Remove template_id column from user_discounts
   */
  await pgm.dropIndex("user_discounts", "user_discounts_template_id_idx", {
    ifExists: true,
  });

  await pgm.dropColumns("user_discounts", ["template_id"], {
    ifExists: true,
  });
};
