const pool = require("../config/db");

/* ----------------------------------------
   Ensure cart exists
-----------------------------------------*/
const findOrCreateCartByUser = async (user_id) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const found = await client.query(
      `SELECT * FROM cart WHERE user_id = $1 LIMIT 1`,
      [user_id]
    );

    if (found.rows.length) {
      await client.query("COMMIT");
      return found.rows[0];
    }

    const inserted = await client.query(
      `INSERT INTO cart (user_id) VALUES ($1) RETURNING *`,
      [user_id]
    );

    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/* ----------------------------------------
   Get cart by user
-----------------------------------------*/
const getCartByUser = async (user_id) => {
  const { rows } = await pool.query(
    `SELECT * FROM cart WHERE user_id = $1 LIMIT 1`,
    [user_id]
  );
  return rows[0] || null;
};

/* ----------------------------------------
   Fetch cart items with variant + product
-----------------------------------------*/
const getCartItemsWithProductDetails = async (cart_id) => {
  const query = `
    SELECT
      ci.id AS cart_item_id,
      ci.quantity,
      ci.unit_price_snapshot,
      (ci.quantity * ci.unit_price_snapshot) AS subtotal,

      pv.id AS variant_id,
      pv.sub_code,
      pv.mrp,

      p.id AS product_id,
      p.name AS product_name,
      p.product_code,

      cl.name AS colour,
      f.name AS finish,

      pi.media_url AS product_image

    FROM cart_items ci
    JOIN product_variants pv ON pv.id = ci.variant_id
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN colours cl ON cl.id = pv.colour_id
    LEFT JOIN finishes f ON f.id = pv.finish_id

    LEFT JOIN LATERAL (
      SELECT media_url
      FROM products_image
      WHERE product_id = p.id
        AND display_order = 1
      LIMIT 1
    ) pi ON TRUE

    WHERE ci.cart_id = $1
    ORDER BY ci.created_at DESC;
  `;

  const { rows } = await pool.query(query, [cart_id]);
  return rows;
};

/* ----------------------------------------
   Add or update cart item (VARIANT)
-----------------------------------------*/
const addOrUpdateCartItem = async ({ cart_id, variant_id, quantity }) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0)
      throw { status: 400, message: "Quantity must be positive" };

    // Validate variant & get price
    const variantRes = await client.query(
      `SELECT id, mrp FROM product_variants WHERE id = $1 LIMIT 1`,
      [variant_id]
    );

    if (!variantRes.rows.length)
      throw { status: 404, message: "Variant not found" };

    const variant = variantRes.rows[0];

    // Check if variant already in cart
    const existing = await client.query(
      `
      SELECT * FROM cart_items
      WHERE cart_id = $1 AND variant_id = $2
      LIMIT 1
      `,
      [cart_id, variant_id]
    );

    if (existing.rows.length) {
      const newQty = existing.rows[0].quantity + qty;

      const updated = await client.query(
        `
        UPDATE cart_items
        SET quantity = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *;
        `,
        [newQty, existing.rows[0].id]
      );

      await client.query("COMMIT");
      return updated.rows[0];
    }

    // Insert new cart item
    const inserted = await client.query(
      `
      INSERT INTO cart_items
        (cart_id, variant_id, quantity, unit_price_snapshot)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
      `,
      [cart_id, variant_id, qty, variant.mrp]
    );

    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/* ----------------------------------------
   Update quantity (set)
-----------------------------------------*/
const updateCartItemQuantity = async (cart_item_id, quantity) => {
  const qty = parseInt(quantity, 10);
  if (isNaN(qty) || qty < 0) throw { status: 400, message: "Invalid quantity" };

  if (qty === 0) {
    const { rows } = await pool.query(
      `DELETE FROM cart_items WHERE id = $1 RETURNING *`,
      [cart_item_id]
    );
    return rows[0] || null;
  }

  const { rows } = await pool.query(
    `
    UPDATE cart_items
    SET quantity = $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *;
    `,
    [qty, cart_item_id]
  );

  return rows[0] || null;
};

/* ----------------------------------------
   Remove item
-----------------------------------------*/
const removeCartItem = async (cart_item_id) => {
  const { rows } = await pool.query(
    `DELETE FROM cart_items WHERE id = $1 RETURNING *`,
    [cart_item_id]
  );
  return rows[0] || null;
};

/* ----------------------------------------
   Clear cart
-----------------------------------------*/
const clearCart = async (cart_id) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cart_id]);
    await client.query(
      `UPDATE cart SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
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
