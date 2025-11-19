const pool = require("../config/db");

// Ensure that user has a cart. If not, then create
const findOrCreateCartByUser = async (user_id) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const findQ = `SELECT * FROM cart WHERE user_id = $1 LIMIT 1;`;
    const found = await client.query(findQ, [user_id]);

    if (found.rows.length > 0) {
      await client.query("COMMIT");
      return found.rows[0];
    }

    const insertQ = `INSERT INTO cart (user_id) VALUES ($1) RETURNING *;`;
    const inserted = await client.query(insertQ, [user_id]);
    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// GET CART BY USER
const getCartByUser = async (userId) => {
  try {
    const query = `
      SELECT id AS cart_id, user_id, created_at, updated_at
      FROM cart
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    const { rows } = await pool.query(query, [userId]);

    return rows.length ? rows[0] : null;
  } catch (err) {
    console.error("Error fetching cart:", err);
    throw err; // rethrow so the caller can handle it
  }
};

// GET Cart items with product details + main image
const getCartItemsWithProductDetails = async (cart_id) => {
  const q = `
    SELECT 
      ci.id AS cart_item_id,
      ci.product_id,
      ci.quantity,
      ci.price,
      ci.discount,
      ci.product_options,
      p.name AS product_name,
      p.product_code,
      p.price_per_unit AS current_price,
      pi.media_url AS product_image,
      (ci.quantity * ci.price) AS subtotal
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT media_url
      FROM products_image
      WHERE product_id = p.id AND media_type = 'image'
      ORDER BY display_order ASC
      LIMIT 1
    ) pi ON TRUE
    WHERE ci.cart_id = $1
    ORDER BY ci.created_at DESC;
  `;
  const { rows } = await pool.query(q, [cart_id]);
  return rows;
};

// Add or Update items in cart (Variant-Aware)
const addOrUpdateCartItem = async ({
  cart_id,
  product_id,
  quantity,
  product_options = {},
}) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Validate product exists and get current price & stock quantity if needed
    const prod = await client.query(
      `SELECT id AS cart_item_id, price_per_unit FROM products WHERE id = $1 LIMIT 1;`,
      [product_id]
    );
    if (prod.rows.length === 0) {
      throw { status: 404, message: "Product not found" };
    }

    const product = prod.rows[0];
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      throw { status: 400, message: "Quantity must be a positive number" };
    }

    // Important: Compare product_id + options
    const findQ = `
      SELECT * FROM cart_items
      WHERE cart_id = $1 
        AND product_id = $2
        AND product_options = $3
      LIMIT 1;
    `;
    const found = await client.query(findQ, [
      cart_id,
      product_id,
      product_options,
    ]);

    if (found.rows.length > 0) {
      // Merge quantities for identical variants
      const existing = found.rows[0];
      const newQty = existing.quantity + qty;

      const updateQ = `
        UPDATE cart_items
        SET quantity = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING 
        id AS cart_item_id,
        cart_id,
        product_id,
        quantity,
        price,
        discount,
        product_options,
        created_at,
        updated_at;
      `;

      // const updateQ = `UPDATE cart_items SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`;
      const updated = await client.query(updateQ, [newQty, existing.id]);

      await client.query("COMMIT");
      return updated.rows[0];
    }

    // Insert new unique variant item
    const insertQ = `
      INSERT INTO cart_items 
        (cart_id, product_id, quantity, price, discount, product_options)
      VALUES ($1, $2, $3, $4, 0, $5)
      RETURNING *;
    `;
    const inserted = await client.query(insertQ, [
      cart_id,
      product_id,
      qty,
      product.price_per_unit,
      product_options,
    ]);

    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// UPDATE ITEM QUANTITY (SET)
const updateCartItemQuantity = async (cart_item_id, newQuantity) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const qty = parseInt(newQuantity, 10);
    if (isNaN(qty) || qty < 0)
      throw { status: 400, message: "Quantity invalid." };

    if (qty === 0) {
      const delQ = `DELETE FROM cart_items WHERE id = $1 RETURNING *;`;
      const delRes = await client.query(delQ, [cart_item_id]);
      await client.query("COMMIT");
      return delRes.rows[0] || null;
    }

    const updateQ = `
  UPDATE cart_items
  SET quantity = $1, updated_at = CURRENT_TIMESTAMP
  WHERE id = $2
  RETURNING
    id AS cart_item_id,
    cart_id,
    product_id,
    quantity,
    price,
    discount,
    product_options,
    created_at,
    updated_at;
`;
    const { rows } = await client.query(updateQ, [qty, cart_item_id]);
    await client.query("COMMIT");
    return rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// REMOVE CART ITEM
const removeCartItem = async (cart_item_id) => {
  const query = `DELETE FROM cart_items WHERE id = $1 RETURNING *;`;
  const { rows } = await pool.query(query, [cart_item_id]);
  return rows[0] || null;
};

// CLEAR ENTIRE CART
const clearCart = async (cart_id) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM cart_items WHERE cart_id = $1;`, [cart_id]);
    await client.query(
      `UPDATE cart SET updated_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [cart_id]
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  findOrCreateCartByUser,
  getCartByUser,
  getCartItemsWithProductDetails,
  addOrUpdateCartItem,
  updateCartItemQuantity,
  removeCartItem,
  clearCart,
};
