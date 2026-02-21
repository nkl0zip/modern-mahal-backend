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

// Admin/Staff only routes
router.put(
  "/admin/:orderId/status",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  [
    body("status").isIn(["PENDING", "PAID", "FAILED", "CANCELLED", "REFUNDED"]),
    body("reason").optional().isString(),
  ],
  orderController.updateOrderStatus,
);

router.get(
  "/admin/:orderId/history",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  orderController.getOrderHistory,
);

router.post(
  "/admin/:orderId/notes",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  [body("note").notEmpty(), body("isPrivate").optional().isBoolean()],
  orderController.addOrderNote,
);

router.get(
  "/admin/:orderId/notes",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  orderController.getOrderNotes,
);

router.get(
  "/admin/:orderId/full",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  orderController.getFullOrder,
);

router.post(
  "/admin/:orderId/refund",
  authenticateToken,
  requireRole(["ADMIN"]),
  [
    body("paymentId").isUUID(),
    body("amount").isFloat({ min: 0.01 }),
    body("reason").optional().isString(),
  ],
  orderController.initiateRefund,
);

// Return routes (user and admin)
router.post(
  "/:orderId/return",
  authenticateToken,
  [body("orderItemId").optional().isUUID(), body("reason").notEmpty()],
  orderController.requestReturn,
);

router.put(
  "/admin/returns/:returnId",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  [
    body("status").isIn(["APPROVED", "REJECTED"]),
    body("adminNotes").optional().isString(),
  ],
  orderController.processReturn,
);

module.exports = router;
