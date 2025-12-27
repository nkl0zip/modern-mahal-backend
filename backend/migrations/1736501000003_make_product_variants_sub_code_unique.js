/* backend/migrations/1736501000003_make_product_variants_sub_code_unique.js */

exports.shim = true;

exports.up = async (pgm) => {
  // First, handle any existing duplicates by keeping the most recent one
  pgm.sql(`
    WITH duplicates AS (
      SELECT 
        id,
        sub_code,
        product_id,
        ROW_NUMBER() OVER (
          PARTITION BY sub_code 
          ORDER BY created_at DESC
        ) as rn
      FROM product_variants
      WHERE sub_code IS NOT NULL AND sub_code != ''
    )
    DELETE FROM product_variants pv
    USING duplicates d
    WHERE pv.id = d.id 
      AND d.rn > 1;
  `);

  // Add unique constraint on sub_code
  pgm.addConstraint("product_variants", "product_variants_sub_code_unique", {
    unique: "sub_code",
    ifNotExists: true,
  });
};

exports.down = async (pgm) => {
  pgm.dropConstraint("product_variants", "product_variants_sub_code_unique", {
    ifExists: true,
  });
};
