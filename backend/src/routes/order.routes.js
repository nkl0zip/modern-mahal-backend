const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const orderController = require("../controllers/order.controller");
const {
  authenticateToken,
  requireRole,
} = require("../middlewares/auth.middleware");

// All order routes require authentication
router.use(authenticateToken);

// POST /api/orders/checkout
router.post(
  "/checkout",
  [
    body("shippingAddressId")
      .isUUID()
      .withMessage("Valid shipping address ID is required"),
    body("billingAddressId")
      .isUUID()
      .withMessage("Valid billing address ID is required"),
    body("appliedCouponId").optional().isUUID(),
    body("metadata").optional().isObject(),
  ],
  orderController.checkout,
);

// GET /api/orders/my-orders
router.get("/my-orders", orderController.getMyOrders);

// GET /api/orders/:orderId
router.get("/:orderId", orderController.getOrderDetails);

// Admin routes
router.get(
  "/admin/orders",
  requireRole(["ADMIN", "STAFF"]),
  orderController.adminGetOrders,
);

module.exports = router;
