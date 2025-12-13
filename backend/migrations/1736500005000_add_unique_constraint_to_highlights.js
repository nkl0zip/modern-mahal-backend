/* backend/migrations/1736492400001_add_unique_constraint_to_highlights.js */
exports.shim = true;

exports.up = async (pgm) => {
  // Optional but recommended: clean up existing duplicates first
  pgm.sql(`
    DELETE FROM highlights a
    USING highlights b
    WHERE a.id > b.id
      AND a.product_id = b.product_id
      AND a.text = b.text;
  `);

  // Add unique constraint
  pgm.addConstraint("highlights", "unique_product_highlight", {
    unique: ["product_id", "text"],
  });
};

exports.down = async (pgm) => {
  pgm.dropConstraint("highlights", "unique_product_highlight", {
    ifExists: true,
  });
};
