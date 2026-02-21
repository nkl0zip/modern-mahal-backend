const orderModel = require("../models/order.model");
const { validationResult } = require("express-validator");

// POST /api/orders/checkout
const checkout = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { shippingAddressId, billingAddressId, appliedCouponId, metadata } =
    req.body;
  const userId = req.user.id;

  try {
    const order = await orderModel.createOrderFromCart(
      userId,
      shippingAddressId,
      billingAddressId,
      appliedCouponId,
      metadata || {},
    );
    res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: order,
    });
  } catch (err) {
    console.error("Checkout error:", err);
    if (
      err.message.includes("Cart not found") ||
      err.message.includes("Cart is empty")
    ) {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: "Failed to create order" });
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
    const orders = await orderModel.adminGetOrders(filters, limit, offset);
    res.json({
      success: true,
      data: orders,
      pagination: { page, limit },
    });
  } catch (err) {
    console.error("Admin get orders error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
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

module.exports = {
  checkout,
  getMyOrders,
  getOrderDetails,
  adminGetOrders,
  updateOrderStatus,
  getOrderHistory,
  addOrderNote,
  getOrderNotes,
  requestReturn,
  processReturn,
  initiateRefund,
  getFullOrder,
};
