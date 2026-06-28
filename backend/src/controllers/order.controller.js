const orderModel = require("../models/order.model");
const { validationResult } = require("express-validator");
const pool = require("../config/db");

// POST /api/orders/checkout
const checkout = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    shippingAddressId,
    billingAddressId,
    delivery_method_code,
    payment_methods,
    appliedCouponId,
    metadata,
  } = req.body;
  const userId = req.user.id;

  try {
    // Get or create cart for user
    const { findOrCreateCartByUser } = require("../models/cart.model");
    const cart = await findOrCreateCartByUser(userId);

    // Check if cart has items
    const { rows: cartItems } = await pool.query(
      `SELECT COUNT(*) as count FROM cart_items WHERE cart_id = $1`,
      [cart.id],
    );

    if (parseInt(cartItems[0].count) === 0) {
      return res.status(400).json({
        success: false,
        message: "Cart is empty",
      });
    }

    // Validate payment methods
    if (
      !payment_methods ||
      !Array.isArray(payment_methods) ||
      payment_methods.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "At least one payment method is required",
      });
    }

    // For SELF_PICKUP, shipping_address_id is not required
    let finalShippingAddressId = shippingAddressId;

    if (delivery_method_code === "SELF_PICKUP") {
      finalShippingAddressId = null;
    } else if (!shippingAddressId) {
      return res.status(400).json({
        success: false,
        message: "Shipping address is required for this delivery method",
      });
    }

    // Use the createOrderWithDelivery function
    const order = await orderModel.createOrderWithDelivery({
      userId: userId,
      cartId: cart.id,
      shippingAddressId: finalShippingAddressId,
      billingAddressId: billingAddressId || finalShippingAddressId,
      appliedCouponId: appliedCouponId || null,
      deliveryMethodCode: delivery_method_code,
      deliveryData: {
        addressId:
          delivery_method_code === "SELF_PICKUP"
            ? null
            : metadata?.addressId || null,
        addressText:
          delivery_method_code === "SELF_PICKUP"
            ? null
            : metadata?.addressText || null,
        latitude:
          delivery_method_code === "SELF_PICKUP"
            ? null
            : metadata?.latitude || null,
        longitude:
          delivery_method_code === "SELF_PICKUP"
            ? null
            : metadata?.longitude || null,
        notes: metadata?.notes || null,
        storeId:
          delivery_method_code === "SELF_PICKUP"
            ? metadata?.storeId || null
            : null,
        pickupInstructions:
          delivery_method_code === "SELF_PICKUP"
            ? metadata?.pickupInstructions || null
            : null,
        distance: metadata?.distance || 0,
        metadata: metadata || {},
      },
      paymentMethods: payment_methods,
      metadata: metadata || {},
    });

    // Check if any PhonePe splits need payment initiation
    const phonePeSplits = order.payment_splits.filter(
      (s) => s.payment_method === "PHONEPE" && s.status === "PENDING",
    );

    let paymentInitiation = null;
    if (phonePeSplits.length > 0) {
      // Initiate PhonePe payment for the first pending PhonePe split
      const paymentService = require("../services/payment.service");
      const phonepeResult = await paymentService.processPhonePeSplit(
        phonePeSplits[0].split_id,
        order.order.id,
        userId,
        { user_phone: req.user.phone },
      );
      paymentInitiation = phonepeResult;
    }

    res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: {
        order: order.order,
        delivery: order.delivery,
        pickup_details: order.pickup_details,
        payment_splits: order.payment_splits,
        grand_total: order.grand_total,
        payment_initiation: paymentInitiation,
      },
    });
  } catch (err) {
    console.error("Checkout error:", err);
    if (
      err.message.includes("Cart not found") ||
      err.message.includes("Cart is empty") ||
      err.message.includes("Invalid delivery method") ||
      err.message.includes("No active store found for pickup") ||
      err.message.includes("Insufficient pay later credit")
    ) {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/orders/my-orders
const getMyOrders = async (req, res) => {
  const userId = req.user.id;
  const limit = parseInt(req.query.limit) || 10;
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * limit;

  try {
    const orders = await orderModel.getOrdersByUser(userId, limit, offset);
    res.json({
      success: true,
      data: orders,
      pagination: { page, limit },
    });
  } catch (err) {
    console.error("Get my orders error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
};

// GET /api/orders/:orderId
const getOrderDetails = async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const order = await orderModel.getOrderById(orderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }
    // Users can only see their own orders; admins can see any
    if (userRole !== "ADMIN" && order.user_id !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    res.json({ success: true, data: order });
  } catch (err) {
    console.error("Get order details error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch order" });
  }
};

// GET /api/admin/orders (admin only)
const adminGetOrders = async (req, res) => {
  const filters = {
    status: req.query.status,
    payment_status: req.query.payment_status,
    start_date: req.query.start_date,
    end_date: req.query.end_date,
  };
  const limit = parseInt(req.query.limit) || 20;
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * limit;

  try {
    // Fetch orders and summary in parallel
    const [orders, summary] = await Promise.all([
      orderModel.adminGetOrders(filters, limit, offset),
      orderModel.getAdminOrderSummary(filters),
    ]);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: page,
        limit: limit,
      },
      summary: summary,
    });
  } catch (err) {
    console.error("Admin get orders error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
};

// GET /api/admin/orders/search?q=john&page=1&limit=10
const searchOrders = async (req, res) => {
  const { q, limit = 20, page = 1 } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(400).json({
      success: false,
      message: "Search term must be at least 2 characters",
    });
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    // Fetch orders, count, and summary in parallel
    const [orders, total, summary] = await Promise.all([
      orderModel.searchOrders(q.trim(), parseInt(limit), offset),
      orderModel.countSearchOrders(q.trim()),
      orderModel.getSearchOrderSummary(q.trim()),
    ]);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
      summary: summary,
    });
  } catch (err) {
    console.error("Search orders error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to search orders",
    });
  }
};

// PUT /api/admin/orders/:orderId/status
const updateOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  const { status, reason } = req.body;
  const staffId = req.user.id; // staff/admin

  const validStatuses = ["PENDING", "PAID", "FAILED", "CANCELLED", "REFUNDED"]; // extend as needed
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  try {
    const order = await orderModel.updateOrderStatus(
      orderId,
      status,
      staffId,
      reason,
    );
    res.json({ success: true, data: order });
  } catch (err) {
    console.error("Update order status error:", err);
    if (err.message === "Order not found") {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }
    res
      .status(500)
      .json({ success: false, message: "Failed to update order status" });
  }
};

// GET /api/admin/orders/:orderId/history
const getOrderHistory = async (req, res) => {
  const { orderId } = req.params;
  try {
    const history = await orderModel.getOrderStatusHistory(orderId);
    res.json({ success: true, data: history });
  } catch (err) {
    console.error("Get order history error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch history" });
  }
};

// POST /api/admin/orders/:orderId/notes
const addOrderNote = async (req, res) => {
  const { orderId } = req.params;
  const { note, isPrivate } = req.body;
  const authorId = req.user.id;

  if (!note)
    return res
      .status(400)
      .json({ success: false, message: "Note is required" });

  try {
    const newNote = await orderModel.addOrderNote(
      orderId,
      authorId,
      note,
      isPrivate !== false,
    );
    res.status(201).json({ success: true, data: newNote });
  } catch (err) {
    console.error("Add note error:", err);
    res.status(500).json({ success: false, message: "Failed to add note" });
  }
};

// GET /api/admin/orders/:orderId/notes
const getOrderNotes = async (req, res) => {
  const { orderId } = req.params;
  const includePrivate = req.query.includePrivate === "true"; // admin can see private
  try {
    const notes = await orderModel.getOrderNotes(orderId, includePrivate);
    res.json({ success: true, data: notes });
  } catch (err) {
    console.error("Get notes error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch notes" });
  }
};

// POST /api/orders/:orderId/return (user)
const requestReturn = async (req, res) => {
  const { orderId } = req.params;
  const { orderItemId, reason } = req.body;
  const userId = req.user.id;

  if (!reason)
    return res
      .status(400)
      .json({ success: false, message: "Reason is required" });

  try {
    // Verify order belongs to user
    const order = await orderModel.getOrderById(orderId);
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    if (order.user_id !== userId)
      return res.status(403).json({ success: false, message: "Access denied" });

    const returnRequest = await orderModel.createReturnRequest(
      orderId,
      userId,
      orderItemId,
      reason,
    );
    res.status(201).json({ success: true, data: returnRequest });
  } catch (err) {
    console.error("Return request error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to submit return request" });
  }
};

// PUT /api/admin/returns/:returnId (staff approve/reject)
const processReturn = async (req, res) => {
  const { returnId } = req.params;
  const { status, adminNotes } = req.body;
  const staffId = req.user.id;

  if (!["APPROVED", "REJECTED"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  try {
    const updated = await orderModel.updateReturnStatus(
      returnId,
      status,
      staffId,
      adminNotes,
    );
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Process return error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to process return" });
  }
};

// POST /api/admin/orders/:orderId/refund (staff initiate refund)
const initiateRefund = async (req, res) => {
  const { orderId } = req.params;
  const { paymentId, amount, reason } = req.body;
  const staffId = req.user.id;

  if (!paymentId || !amount || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "Valid payment ID and amount required",
    });
  }

  try {
    // Optionally verify payment belongs to order
    const refund = await orderModel.createRefund(
      paymentId,
      orderId,
      amount,
      reason,
      staffId,
    );
    res.status(201).json({ success: true, data: refund });
  } catch (err) {
    console.error("Initiate refund error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to initiate refund" });
  }
};

// GET /api/admin/orders/:orderId/full (get all details)
const getFullOrder = async (req, res) => {
  const { orderId } = req.params;
  try {
    const order = await orderModel.getFullOrderDetails(orderId);
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    res.json({ success: true, data: order });
  } catch (err) {
    console.error("Get full order error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch order details" });
  }
};

/**
 * GET /api/orders/:orderId/pickup-details
 * Get pickup details for SELF delivery
 */
const getPickupDetails = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const order = await orderModel.getOrderById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (userRole !== "ADMIN" && order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Get delivery details
    const deliveryModel = require("../models/delivery.model");
    const delivery = await deliveryModel.getDeliveryByOrderId(orderId);

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found for this order",
      });
    }

    // Check if it's SELF pickup
    const method = await deliveryModel.getDeliveryMethodById(
      delivery.delivery_method_id,
    );
    if (!method || method.code !== "SELF_PICKUP") {
      return res.status(400).json({
        success: false,
        message: "This order is not a SELF pickup order",
      });
    }

    // Get store details
    const storeResult = await pool.query(
      `
      SELECT 
        s.store_name,
        s.address_line_1,
        s.address_line_2,
        s.city,
        s.state,
        s.pincode,
        s.google_maps_url,
        s.google_maps_embed_url,
        s.pickup_instructions,
        s.operating_hours
      FROM store_details s
      WHERE s.id = $1
      `,
      [delivery.store_pickup_location_id],
    );

    res.status(200).json({
      success: true,
      message: "Pickup details fetched successfully",
      data: {
        order: {
          order_number: order.order_number,
          created_at: order.created_at,
          grand_total: order.grand_total,
        },
        pickup: {
          pickup_id: delivery.pickup_id,
          pickup_otp: delivery.pickup_otp,
          expires_at: delivery.pickup_otp_expires_at,
          status: delivery.delivery_status,
        },
        store: storeResult.rows[0] || null,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/orders/:orderId/pickup/verify
 * User verifies pickup with OTP (shows OTP to user for verification)
 * This is for the customer to view their OTP, actual verification is done by staff
 */
const verifyPickup = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { pickup_id, otp } = req.body;
    const userId = req.user.id;

    // Check if order belongs to user
    const order = await orderModel.getOrderById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Get delivery
    const deliveryModel = require("../models/delivery.model");
    const delivery = await deliveryModel.getDeliveryByOrderId(orderId);

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // Verify OTP (this is just for validation, actual verification is done by staff)
    if (delivery.pickup_id !== pickup_id || delivery.pickup_otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid pickup ID or OTP",
      });
    }

    if (delivery.pickup_otp_expires_at < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please contact support.",
      });
    }

    res.status(200).json({
      success: true,
      message:
        "OTP verified successfully. Please proceed to the store for pickup.",
      data: {
        pickup_id: delivery.pickup_id,
        verified: true,
        store_name: delivery.store_name,
        address:
          `${delivery.address_line_1 || ""} ${delivery.address_line_2 || ""}`.trim(),
        city: delivery.city,
        state: delivery.state,
        pincode: delivery.pincode,
        google_maps_url: delivery.google_maps_url,
        pickup_instructions: delivery.pickup_instructions,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  checkout,
  getMyOrders,
  getOrderDetails,
  adminGetOrders,
  searchOrders,
  updateOrderStatus,
  getOrderHistory,
  addOrderNote,
  getOrderNotes,
  requestReturn,
  processReturn,
  initiateRefund,
  getFullOrder,
  getPickupDetails,
  verifyPickup,
};
