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

module.exports = {
  checkout,
  getMyOrders,
  getOrderDetails,
  adminGetOrders,
};
