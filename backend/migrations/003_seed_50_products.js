/* 003_seed_50_products.js
   Seeds sample brands, categories, colors and 50 demo products:
   - Inserts 5 brands
   - Inserts 8 categories
   - Inserts 6 colors
   - Inserts 50 products with product_code P0001..P0050
   - Associates each product with a random category + random color + 1 main image
*/

exports.up = async (pgm) => {
  const now = new Date().toISOString();

  /* --------------------------------------------------------
     1. Insert BRANDS
  -------------------------------------------------------- */
  await pgm.sql(`
    INSERT INTO brands (id, name, website_url, image, description, created_at, updated_at)
    VALUES
      (gen_random_uuid(), 'ModernMahal Basics', 'https://modernmahal.example', NULL, 'In-house basics', '${now}', '${now}'),
      (gen_random_uuid(), 'HomeWare Co', 'https://homeware.example', NULL, 'Home essentials', '${now}', '${now}'),
      (gen_random_uuid(), 'ProTools', 'https://protools.example', NULL, 'Professional tools', '${now}', '${now}'),
      (gen_random_uuid(), 'FitGear', 'https://fitgear.example', NULL, 'Fitness equipment', '${now}', '${now}'),
      (gen_random_uuid(), 'KitchenCraft', 'https://kitchencraft.example', NULL, 'Kitchen appliances', '${now}', '${now}')
    ON CONFLICT (name) DO NOTHING;
  `);

  /* --------------------------------------------------------
     2. Insert CATEGORIES
  -------------------------------------------------------- */
  await pgm.sql(`
    INSERT INTO categories (id, name, slug, description, created_at, updated_at)
    VALUES
      (gen_random_uuid(), 'Fitness', 'fitness', 'Fitness and gym products', '${now}', '${now}'),
      (gen_random_uuid(), 'Kitchen', 'kitchen', 'Kitchen appliances & accessories', '${now}', '${now}'),
      (gen_random_uuid(), 'Home', 'home', 'Home improvement & decor', '${now}', '${now}'),
      (gen_random_uuid(), 'Tools', 'tools', 'Hardware and tools', '${now}', '${now}'),
      (gen_random_uuid(), 'Electronics', 'electronics', 'Consumer electronics', '${now}', '${now}'),
      (gen_random_uuid(), 'Accessories', 'accessories', 'Small accessories', '${now}', '${now}'),
      (gen_random_uuid(), 'Outdoors', 'outdoors', 'Outdoor gears', '${now}', '${now}'),
      (gen_random_uuid(), 'Office', 'office', 'Office supplies', '${now}', '${now}')
    ON CONFLICT (name) DO NOTHING;
  `);

  /* --------------------------------------------------------
     3. Insert COLORS
  -------------------------------------------------------- */
  await pgm.sql(`
    INSERT INTO colors (id, name, hex_code, created_at)
    VALUES
      (gen_random_uuid(), 'Black', '#000000', '${now}'),
      (gen_random_uuid(), 'White', '#FFFFFF', '${now}'),
      (gen_random_uuid(), 'Red', '#FF0000', '${now}'),
      (gen_random_uuid(), 'Blue', '#0000FF', '${now}'),
      (gen_random_uuid(), 'Silver', '#C0C0C0', '${now}'),
      (gen_random_uuid(), 'Green', '#00FF00', '${now}')
    ON CONFLICT (name) DO NOTHING;
  `);

  /* --------------------------------------------------------
     4. Fetch brand/category/color IDs for linking
  -------------------------------------------------------- */
  const brandsRes = await pgm.db.query(`SELECT id FROM brands;`);
  const categoriesRes = await pgm.db.query(`SELECT id FROM categories;`);
  const colorsRes = await pgm.db.query(`SELECT id FROM colors;`);

  const brandIds = brandsRes.rows.map((r) => r.id);
  const categoryIds = categoriesRes.rows.map((r) => r.id);
  const colorIds = colorsRes.rows.map((r) => r.id);

  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* --------------------------------------------------------
     5. Insert 50 PRODUCTS
  -------------------------------------------------------- */
  for (let i = 1; i <= 50; i++) {
    const productName = `Demo Product ${i}`;
    const productCode = `P${String(i).padStart(4, "0")}`;
    const price = (Math.random() * 1000 + 100).toFixed(2);
    const stock = Math.floor(Math.random() * 200) + 1;

    // Insert product and retrieve ID
    const insertProduct = await pgm.db.query(
      `
      INSERT INTO products 
        (id, name, brand_id, product_code, description, stock_quantity, price_per_unit, created_at, updated_at)
      VALUES 
        (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $7)
      RETURNING id;
      `,
      [
        productName,
        brandIds.length ? rand(brandIds) : null,
        productCode,
        `Description for ${productName}`,
        stock,
        price,
        now,
      ]
    );

    const productId = insertProduct.rows[0].id;

    /* ----------------- Link Category ----------------- */
    if (categoryIds.length > 0) {
      await pgm.db.query(
        `INSERT INTO product_category (product_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
        [productId, rand(categoryIds)]
      );
    }

    /* ----------------- Link Color ----------------- */
    if (colorIds.length > 0) {
      await pgm.db.query(
        `INSERT INTO product_color (product_id, color_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
        [productId, rand(colorIds)]
      );
    }

    /* ----------------- Insert Product Image ----------------- */
    const imgUrl = `https://placehold.co/600x400?text=${encodeURIComponent(
      productName
    )}`;

    await pgm.db.query(
      `
      INSERT INTO products_image 
        (id, product_id, media_url, media_type, display_order, created_at)
      VALUES 
        (gen_random_uuid(), $1, $2, 'image', 1, $3)
      ON CONFLICT DO NOTHING;
      `,
      [productId, imgUrl, now]
    );
  }
};

exports.down = async (pgm) => {
  // Remove all demo images
  await pgm.sql(`
    DELETE FROM products_image 
    WHERE media_url LIKE 'https://placehold.co/600x400?text=Demo%';
  `);

  // Remove product-color links
  await pgm.sql(`
    DELETE FROM product_color
    WHERE product_id IN (SELECT id FROM products WHERE product_code LIKE 'P%');
  `);

  // Remove product-category links
  await pgm.sql(`
    DELETE FROM product_category
    WHERE product_id IN (SELECT id FROM products WHERE product_code LIKE 'P%');
  `);

  // Remove demo products
  await pgm.sql(`
    DELETE FROM products WHERE product_code LIKE 'P%';
  `);
};
