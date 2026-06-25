const pool = require("../config/db");
const paymentModel = require("../models/payment.model");

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

    // 2. Calculate tax (18% GST on total after discounts) and shipping
    // Note: totalAmount already includes discounts applied
    const TAX_RATE = 0.18; // 18% GST
    const shippingAmount = 0;
    const taxAmount = Math.round(totalAmount * TAX_RATE * 100) / 100;
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
      ) as payments,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object(
          'id', ps.id,
          'payment_method', ps.payment_method,
          'amount', ps.amount,
          'status', ps.status,
          'completed_at', ps.completed_at
        )) FILTER (WHERE ps.id IS NOT NULL),
        '[]'
      ) as payment_splits
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN payments p ON o.id = p.order_id
    LEFT JOIN payment_splits ps ON o.id = ps.order_id
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

/**
 * Update order status and log history
 */
const updateOrderStatus = async (
  orderId,
  newStatus,
  changedBy = null,
  reason = null,
) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get current status
    const { rows: current } = await client.query(
      "SELECT status FROM orders WHERE id = $1 FOR UPDATE",
      [orderId],
    );
    if (current.length === 0) throw new Error("Order not found");
    const oldStatus = current[0].status;

    // Update order
    const updateQuery = `
      UPDATE orders
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *;
    `;
    const { rows } = await client.query(updateQuery, [newStatus, orderId]);
    const updatedOrder = rows[0];

    // Insert into history
    await client.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, oldStatus, newStatus, changedBy, reason],
    );

    await client.query("COMMIT");
    return updatedOrder;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Get order status history
 */
const getOrderStatusHistory = async (orderId) => {
  const query = `
    SELECT h.*, u.name as changed_by_name
    FROM order_status_history h
    LEFT JOIN users u ON h.changed_by = u.id
    WHERE h.order_id = $1
    ORDER BY h.created_at DESC;
  `;
  const { rows } = await pool.query(query, [orderId]);
  return rows;
};

/**
 * Add internal note to order
 */
const addOrderNote = async (orderId, authorId, note, isPrivate = true) => {
  const query = `
    INSERT INTO order_notes (order_id, author_id, note, is_private)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    orderId,
    authorId,
    note,
    isPrivate,
  ]);
  return rows[0];
};

/**
 * Get notes for an order (filter by private flag based on user role)
 */
const getOrderNotes = async (orderId, includePrivate = false) => {
  let query = `SELECT n.*, u.name as author_name
               FROM order_notes n
               LEFT JOIN users u ON n.author_id = u.id
               WHERE n.order_id = $1`;
  if (!includePrivate) {
    query += ` AND n.is_private = false`;
  }
  query += ` ORDER BY n.created_at DESC;`;
  const { rows } = await pool.query(query, [orderId]);
  return rows;
};

/**
 * Create a return request
 */
const createReturnRequest = async (orderId, userId, orderItemId, reason) => {
  const query = `
    INSERT INTO order_returns (order_id, user_id, order_item_id, reason)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    orderId,
    userId,
    orderItemId,
    reason,
  ]);
  return rows[0];
};

/**
 * Update return request status (staff)
 */
const updateReturnStatus = async (
  returnId,
  status,
  processedBy,
  adminNotes = null,
) => {
  const query = `
    UPDATE order_returns
    SET status = $1,
        processed_by = $2,
        processed_at = CURRENT_TIMESTAMP,
        admin_notes = COALESCE($3, admin_notes)
    WHERE id = $4
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    status,
    processedBy,
    adminNotes,
    returnId,
  ]);
  return rows[0];
};

/**
 * Get returns for an order
 */
const getOrderReturns = async (orderId) => {
  const query = `
    SELECT r.*, u.name as user_name, pb.name as processed_by_name
    FROM order_returns r
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN users pb ON r.processed_by = pb.id
    WHERE r.order_id = $1
    ORDER BY r.requested_at DESC;
  `;
  const { rows } = await pool.query(query, [orderId]);
  return rows;
};

/**
 * Create a refund (initiated by staff)
 */
const createRefund = async (
  paymentId,
  orderId,
  amount,
  reason,
  processedBy,
  metadata = {},
) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert refund record
    const insertQuery = `
      INSERT INTO refunds (payment_id, order_id, amount, reason, processed_by, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const { rows } = await client.query(insertQuery, [
      paymentId,
      orderId,
      amount,
      reason,
      processedBy,
      metadata,
    ]);
    const refund = rows[0];

    // Optionally, call payment gateway refund API here (if integrated)
    // For now, just mark as processed
    await client.query(
      `UPDATE refunds SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [refund.id],
    );

    // Update order status? Possibly to REFUNDED if full refund
    // You might want to check if total refunded amount equals order grand_total

    await client.query("COMMIT");
    return refund;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Get refunds for an order
 */
const getOrderRefunds = async (orderId) => {
  const query = `
    SELECT r.*, p.payment_gateway, p.gateway_transaction_id, u.name as processed_by_name
    FROM refunds r
    JOIN payments p ON r.payment_id = p.id
    LEFT JOIN users u ON r.processed_by = u.id
    WHERE r.order_id = $1
    ORDER BY r.created_at DESC;
  `;
  const { rows } = await pool.query(query, [orderId]);
  return rows;
};

/**
 * Get full order details with all related data
 */
const getFullOrderDetails = async (orderId) => {
  const order = await getOrderById(orderId);
  if (!order) return null;

  const [history, notes, returns, refunds] = await Promise.all([
    getOrderStatusHistory(orderId),
    getOrderNotes(orderId, true),
    getOrderReturns(orderId),
    getOrderRefunds(orderId),
  ]);

  return {
    ...order,
    status_history: history,
    notes,
    returns,
    refunds,
  };
};

/**
 * Create order from cart with proper flow:
 * 1. Create order
 * 2. Create order items
 * 3. Process payment
 * 4. Create delivery
 * 5. Update order with delivery info
 * 6. Generate pickup details if SELF
 */
const createOrderWithDelivery = async ({
  userId,
  cartId,
  shippingAddressId = null,
  billingAddressId = null,
  appliedCouponId = null,
  deliveryMethodCode,
  deliveryData = {},
  paymentMethods = [],
  metadata = {},
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ============================================
    // STEP 1: Lock cart and get items
    // ============================================
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
      FOR UPDATE
      `,
      [cartId],
    );

    if (cartItemsResult.rows.length === 0) {
      throw new Error("Cart is empty");
    }

    // ============================================
    // STEP 2: Calculate totals with discounts
    // ============================================
    let totalAmount = 0;
    let discountAmount = 0;
    let totalManualDiscount = 0;
    let totalCouponDiscount = 0;

    // Get coupon details if applied
    let coupon = null;
    if (appliedCouponId) {
      const couponResult = await client.query(
        `
    SELECT d.*, COALESCE(
      json_agg(
        DISTINCT jsonb_build_object(
          'id', s.id,
          'name', s.name
        )
      ) FILTER (WHERE s.id IS NOT NULL),
      '[]'
    ) as segments
    FROM discounts d
    LEFT JOIN discount_segments ds ON ds.discount_id = d.id
    LEFT JOIN segments s ON s.id = ds.segment_id
    WHERE d.id = $1 AND d.type = 'COUPON' AND d.is_active = true AND d.expires_at > NOW()
    GROUP BY d.id
    `,
        [appliedCouponId],
      );
      if (couponResult.rows.length > 0) {
        coupon = couponResult.rows[0];
      }
    }

    // Get product segments for coupon eligibility
    const productIds = [
      ...new Set(cartItemsResult.rows.map((item) => item.product_id)),
    ];
    let productSegmentMap = {};

    if (productIds.length > 0 && coupon) {
      const segmentQuery = `
    SELECT 
      ps.product_id,
      ps.segment_id
    FROM product_segments ps
    WHERE ps.product_id = ANY($1)
  `;
      const segmentResult = await client.query(segmentQuery, [productIds]);

      segmentResult.rows.forEach((row) => {
        if (!productSegmentMap[row.product_id]) {
          productSegmentMap[row.product_id] = new Set();
        }
        productSegmentMap[row.product_id].add(row.segment_id);
      });
    }

    // Get coupon segments if coupon exists
    let couponSegmentIds = new Set();
    if (coupon) {
      const couponSegmentsResult = await client.query(
        `SELECT segment_id FROM discount_segments WHERE discount_id = $1`,
        [coupon.id],
      );
      couponSegmentIds = new Set(
        couponSegmentsResult.rows.map((r) => r.segment_id),
      );
    }

    for (const item of cartItemsResult.rows) {
      const unitPrice = parseFloat(item.unit_price_snapshot) || 0;
      const manualDiscount = parseFloat(item.manual_discount_amount) || 0;
      const couponDiscount = parseFloat(item.coupon_discount_amount) || 0;
      const quantity = parseInt(item.quantity) || 0;

      const originalTotal = unitPrice * quantity;
      let itemDiscount = 0;

      // Check if coupon applies to this product
      let isCouponEligible = false;
      if (coupon) {
        const productSegments = productSegmentMap[item.product_id] || new Set();
        isCouponEligible =
          couponSegmentIds.size === 0 ||
          [...productSegments].some((segId) => couponSegmentIds.has(segId));
      }

      // Apply coupon discount if eligible
      if (isCouponEligible && coupon) {
        if (coupon.discount_mode === "PERCENTAGE") {
          itemDiscount = (originalTotal * Number(coupon.value)) / 100;
        } else if (coupon.discount_mode === "FLAT") {
          itemDiscount = Math.min(Number(coupon.value), originalTotal);
        }
        discountAmount += itemDiscount;
        totalCouponDiscount += itemDiscount;
        totalAmount += originalTotal - itemDiscount;
      } else {
        // Apply manual discount only (coupon not applicable)
        const itemManualDiscount = manualDiscount * quantity;
        discountAmount += itemManualDiscount;
        totalManualDiscount += itemManualDiscount;
        totalAmount += originalTotal - itemManualDiscount;

        // Also add any existing coupon discount from cart_items if coupon is not applied globally
        if (!coupon) {
          const itemCouponDiscount = couponDiscount * quantity;
          discountAmount += itemCouponDiscount;
          totalCouponDiscount += itemCouponDiscount;
          totalAmount -= itemCouponDiscount;
        }
      }
    }

    // ============================================
    // STEP 3: Get delivery method and calculate charges
    // ============================================
    const deliveryMethod = await client.query(
      `SELECT * FROM delivery_methods WHERE code = $1 AND is_active = true`,
      [deliveryMethodCode],
    );

    if (deliveryMethod.rows.length === 0) {
      throw new Error("Invalid delivery method");
    }

    const method = deliveryMethod.rows[0];
    let deliveryCharge = parseFloat(method.base_charge || 0);

    // Add distance charges if applicable
    if (method.code !== "SELF_PICKUP" && deliveryData.distance) {
      deliveryCharge +=
        parseFloat(method.charge_per_km || 0) * deliveryData.distance;
    }

    // ============================================
    // STEP 4: Calculate tax (18% GST on subtotal after discounts)
    // ============================================
    const TAX_RATE = 0.18;
    const subtotal = totalAmount;
    const taxAmount = Math.round(subtotal * TAX_RATE * 100) / 100;
    const grandTotal = subtotal + deliveryCharge + taxAmount;

    // ============================================
    // STEP 5: Validate shipping address (only for non-SELF)
    // ============================================
    let finalShippingAddressId = shippingAddressId;

    if (method.code === "SELF_PICKUP") {
      // For SELF delivery, shipping_address_id should be NULL
      finalShippingAddressId = null;
    } else if (!shippingAddressId) {
      throw new Error("Shipping address is required for this delivery method");
    }

    // ============================================
    // STEP 6: Generate order number
    // ============================================
    const orderNumber = generateOrderNumber();

    // ============================================
    // STEP 7: Insert order (PENDING status)
    // ============================================
    const orderResult = await client.query(
      `
      INSERT INTO orders (
        user_id, cart_id, order_number, total_amount, discount_amount,
        tax_amount, shipping_amount, grand_total, status,
        shipping_address_id, billing_address_id, applied_coupon_id, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9, $10, $11, $12)
      RETURNING *;
      `,
      [
        userId,
        cartId,
        orderNumber,
        totalAmount,
        discountAmount,
        taxAmount,
        deliveryCharge,
        grandTotal,
        finalShippingAddressId,
        billingAddressId,
        appliedCouponId,
        JSON.stringify(metadata),
      ],
    );

    const order = orderResult.rows[0];

    // ============================================
    // STEP 8: Insert order items
    // ============================================
    for (const item of cartItemsResult.rows) {
      const totalPrice =
        item.unit_price_snapshot * item.quantity -
        item.manual_discount_amount -
        item.coupon_discount_amount;

      await client.query(
        `
        INSERT INTO order_items (
          order_id, product_id, variant_id, quantity,
          unit_price, discount_amount, total_price
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7);
        `,
        [
          order.id,
          item.product_id,
          item.variant_id,
          parseInt(item.quantity),
          parseFloat(item.unit_price_snapshot) || 0,
          (parseFloat(item.manual_discount_amount) || 0) +
            (parseFloat(item.coupon_discount_amount) || 0),
          parseFloat(totalPrice) || 0,
        ],
      );
    }

    // ============================================
    // STEP 9: Process Payment
    // ============================================
    const paymentService = require("../services/payment.service");

    // Calculate and create payment splits
    const paymentSplitsResult =
      await paymentService.calculateAndProcessPaymentSplits({
        orderId: order.id,
        userId: userId,
        selectedPaymentMethods: paymentMethods,
        client: client,
        grandTotal: grandTotal,
      });

    // ============================================
    // STEP 10: Create Delivery (only after payment)
    // ============================================
    const deliveryModel = require("./delivery.model");

    let delivery = null;
    let pickupDetails = null;

    // Create delivery record
    delivery = await deliveryModel.createDelivery({
      orderId: order.id,
      deliveryMethodId: method.id,
      deliveryAddressId:
        method.code === "SELF_PICKUP" ? null : deliveryData.addressId || null,
      deliveryAddressText:
        method.code === "SELF_PICKUP" ? null : deliveryData.addressText || null,
      deliveryLatitude:
        method.code === "SELF_PICKUP" ? null : deliveryData.latitude || null,
      deliveryLongitude:
        method.code === "SELF_PICKUP" ? null : deliveryData.longitude || null,
      deliveryNotes: deliveryData.notes || null,
      storePickupLocationId:
        method.code === "SELF_PICKUP" ? deliveryData.storeId || null : null,
      pickupInstructions:
        method.code === "SELF_PICKUP"
          ? deliveryData.pickupInstructions || null
          : null,
      deliveryCharge: deliveryCharge,
      metadata: {
        estimated_days: method.estimated_delivery_days,
        ...deliveryData.metadata,
      },
      client: client,
    });

    // ============================================
    // STEP 11: Update order with delivery info
    // ============================================
    await client.query(
      `
      UPDATE orders
      SET 
        delivery_method_id = $1,
        delivery_id = $2,
        shipping_amount = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      `,
      [method.id, delivery.id, deliveryCharge, order.id],
    );

    // ============================================
    // STEP 12: For SELF_PICKUP, generate pickup details
    // ============================================
    if (method.code === "SELF_PICKUP") {
      const storeResult = await client.query(
        `SELECT id FROM store_details WHERE is_active = true ORDER BY created_at DESC LIMIT 1`,
      );

      if (storeResult.rows.length === 0) {
        throw new Error("No active store found for pickup");
      }

      const pickupResult = await deliveryModel.generatePickupDetails(
        delivery.id,
        storeResult.rows[0].id,
        client,
      );

      pickupDetails = {
        pickup_id: pickupResult.pickup_id,
        pickup_otp: pickupResult.pickup_otp,
        expires_at: pickupResult.pickup_otp_expires_at,
      };
    }

    // ============================================
    // STEP 13: Update order status based on payment
    // ============================================
    // Check if all splits are completed
    const allCompleted = await paymentModel.areAllSplitsCompleted(order.id);

    if (allCompleted) {
      // If all payment splits are completed, mark order as PAID
      await client.query(
        `
        UPDATE orders
        SET 
          payment_split_completed = true,
          status = 'PAID',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [order.id],
      );
    }

    // ============================================
    // STEP 14: Clear cart (only after order is placed)
    // ============================================
    await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cartId]);

    await client.query("COMMIT");

    return {
      order,
      delivery,
      pickup_details: pickupDetails,
      payment_splits: paymentSplitsResult.splits,
      grand_total: grandTotal,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Order creation failed:", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  createOrderFromCart,
  getOrderById,
  getOrdersByUser,
  updateOrderStatus,
  adminGetOrders,
  getOrderStatusHistory,
  addOrderNote,
  getOrderNotes,
  createReturnRequest,
  updateReturnStatus,
  getOrderReturns,
  createRefund,
  getOrderRefunds,
  getFullOrderDetails,
  createOrderWithDelivery,
};
