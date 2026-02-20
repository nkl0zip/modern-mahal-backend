const pool = require("../config/db");

/**
 * Generate a unique order number
 * Format: ORD-YYYYMMDD-XXXXX (timestamp + random alphanumeric)
 */
const generateOrderNumber = () => {
  const date = new Date();
  const yyyymmdd = date.toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `ORD-${yyyymmdd}-${random}`;
};

/**
 * Create a new order from the user's cart
 * Uses a transaction to ensure consistency
 */
const createOrderFromCart = async (
  userId,
  shippingAddressId,
  billingAddressId,
  appliedCouponId = null,
  metadata = {},
) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Fetch cart with items (lock cart to prevent changes)
    // 1️⃣ Lock cart row first
    const cartRowResult = await client.query(
      `SELECT id FROM cart WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );

    if (cartRowResult.rows.length === 0) {
      throw new Error("Cart not found or empty");
    }

    const cartId = cartRowResult.rows[0].id;

    // 2️⃣ Lock cart items to prevent race conditions
    await client.query(
      `SELECT id FROM cart_items WHERE cart_id = $1 FOR UPDATE`,
      [cartId],
    );

    // 3️⃣ Fetch cart items
    const cartItemsResult = await client.query(
      `
  SELECT 
    ci.variant_id,
    pv.product_id,
    ci.quantity,
    ci.unit_price_snapshot,
    ci.manual_discount_amount,
    ci.coupon_discount_amount
  FROM cart_items ci
  JOIN product_variants pv ON ci.variant_id = pv.id
  WHERE ci.cart_id = $1
  `,
      [cartId],
    );

    if (cartItemsResult.rows.length === 0) {
      throw new Error("Cart is empty");
    }

    const cartItems = cartItemsResult.rows;

    // 4️⃣ Calculate totals in Node (safer and cleaner)
    let totalAmount = 0;
    let discountAmount = 0;

    for (const item of cartItems) {
      const unitPrice = parseFloat(item.unit_price_snapshot) || 0;
      const manualDiscount = parseFloat(item.manual_discount_amount) || 0;
      const couponDiscount = parseFloat(item.coupon_discount_amount) || 0;
      const quantity = parseInt(item.quantity) || 0;

      const itemTotal = unitPrice * quantity - manualDiscount - couponDiscount;

      totalAmount += itemTotal;
      discountAmount += manualDiscount + couponDiscount;
    }

    // 2. Calculate tax and shipping (example: 5% tax, free shipping)
    const taxRate = 0.05;
    const shippingAmount = 0;
    const taxAmount = Math.round(totalAmount * taxRate * 100) / 100;
    const grandTotal = totalAmount + taxAmount + shippingAmount;

    // 3. Generate order number
    const orderNumber = generateOrderNumber();

    // 4. Insert order
    const insertOrderQuery = `
      INSERT INTO orders (
        user_id, cart_id, order_number, total_amount, discount_amount,
        tax_amount, shipping_amount, grand_total, status,
        shipping_address_id, billing_address_id, applied_coupon_id, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9, $10, $11, $12)
      RETURNING *;
    `;
    const orderValues = [
      userId,
      cartId,
      orderNumber,
      totalAmount,
      discountAmount,
      taxAmount,
      shippingAmount,
      grandTotal,
      shippingAddressId,
      billingAddressId,
      appliedCouponId,
      metadata,
    ];

    const orderResult = await client.query(insertOrderQuery, orderValues);
    const order = orderResult.rows[0];

    // 5. Insert order items
    for (const item of cartItems) {
      const totalPrice =
        item.unit_price_snapshot * item.quantity -
        item.manual_discount_amount -
        item.coupon_discount_amount;
      const insertItemQuery = `
        INSERT INTO order_items (
          order_id, product_id, variant_id, quantity,
          unit_price, discount_amount, total_price
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7);
      `;
      await client.query(insertItemQuery, [
        order.id,
        item.product_id,
        item.variant_id,
        parseInt(item.quantity),
        parseFloat(item.unit_price_snapshot) || 0,
        (parseFloat(item.manual_discount_amount) || 0) +
          (parseFloat(item.coupon_discount_amount) || 0),
        parseFloat(totalPrice) || 0,
      ]);
    }

    // 6. Clear cart (delete cart items, but keep cart record)
    await client.query("DELETE FROM cart_items WHERE cart_id = $1;", [cartId]);

    await client.query("COMMIT");
    return order;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Get order by ID (with items and payments)
 */
const getOrderById = async (orderId) => {
  const query = `
    SELECT
      o.*,
      json_agg(DISTINCT jsonb_build_object(
        'id', oi.id,
        'product_id', oi.product_id,
        'variant_id', oi.variant_id,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'discount_amount', oi.discount_amount,
        'total_price', oi.total_price
      )) as items,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object(
          'id', p.id,
          'payment_gateway', p.payment_gateway,
          'amount', p.amount,
          'status', p.status,
          'gateway_transaction_id', p.gateway_transaction_id,
          'created_at', p.created_at
        )) FILTER (WHERE p.id IS NOT NULL),
        '[]'
      ) as payments
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN payments p ON o.id = p.order_id
    WHERE o.id = $1
    GROUP BY o.id;
  `;
  const { rows } = await pool.query(query, [orderId]);
  return rows[0] || null;
};

/**
 * Get orders by user with pagination
 */
const getOrdersByUser = async (userId, limit = 10, offset = 0) => {
  const query = `
    SELECT
      o.*,
      json_agg(DISTINCT jsonb_build_object(
        'id', oi.id,
        'product_id', oi.product_id,
        'variant_id', oi.variant_id,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'total_price', oi.total_price
      )) as items,
      (
        SELECT jsonb_build_object(
          'status', p.status,
          'gateway_transaction_id', p.gateway_transaction_id,
          'payment_gateway', p.payment_gateway
        )
        FROM payments p
        WHERE p.order_id = o.id
        ORDER BY p.created_at DESC
        LIMIT 1
      ) as latest_payment
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.user_id = $1
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT $2 OFFSET $3;
  `;
  const { rows } = await pool.query(query, [userId, limit, offset]);
  return rows;
};

/**
 * Update order status (used internally)
 */
const updateOrderStatus = async (orderId, status) => {
  const query = `
    UPDATE orders
    SET status = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [status, orderId]);
  return rows[0];
};

/**
 * Admin: Get all orders with filters
 */
const adminGetOrders = async (filters = {}, limit = 20, offset = 0) => {
  const conditions = [];
  const values = [];

  if (filters.status) {
    conditions.push(`o.status = $${values.length + 1}`);
    values.push(filters.status);
  }
  if (filters.payment_status) {
    conditions.push(
      `EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = $${values.length + 1})`,
    );
    values.push(filters.payment_status);
  }
  if (filters.start_date) {
    conditions.push(`o.created_at >= $${values.length + 1}`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    conditions.push(`o.created_at <= $${values.length + 1}`);
    values.push(filters.end_date);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const query = `
    SELECT
      o.*,
      u.name as user_name,
      u.email as user_email,
      u.phone as user_phone,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'id', p.id,
          'status', p.status,
          'amount', p.amount,
          'gateway_transaction_id', p.gateway_transaction_id,
          'created_at', p.created_at
        ))
        FROM payments p
        WHERE p.order_id = o.id
      ) as payments
    FROM orders o
    JOIN users u ON o.user_id = u.id
    ${whereClause}
    ORDER BY o.created_at DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2};
  `;
  values.push(limit, offset);
  const { rows } = await pool.query(query, values);
  return rows;
};

module.exports = {
  createOrderFromCart,
  getOrderById,
  getOrdersByUser,
  updateOrderStatus,
  adminGetOrders,
};
