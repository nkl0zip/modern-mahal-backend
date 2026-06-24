const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const paymentController = require("../controllers/payment.controller");
const {
  authenticateToken,
  requireRole,
} = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");

// Public webhook endpoint (no auth)
router.post("/webhook", paymentController.paymentWebhook);
router.post("/webhook/", paymentController.paymentWebhook);

// All other payment routes require authentication
router.use(authenticateToken);

// POST /api/payments/initiate
router.post(
  "/initiate",
  [body("orderId").isUUID().withMessage("Valid order ID is required")],
  paymentController.initiatePayment,
);

// POST /api/payments/retry
router.post(
  "/retry",
  [body("orderId").isUUID().withMessage("Valid order ID is required")],
  paymentController.retryPayment,
);

// GET /api/payments/status/:orderId
router.get("/status/:orderId", paymentController.getPaymentStatus);

// ============= NEW PAYMENT SPLIT ROUTES =============
// POST /api/payments/calculate-split - Calculate payment splits from cart
router.post(
  "/calculate-split",
  authenticateToken,
  [
    body("selected_payment_methods")
      .isArray()
      .withMessage("Payment methods must be an array"),
  ],
  paymentController.calculatePaymentSplits,
);

// POST /api/payments/process-paylater - Process PayLater split
router.post(
  "/process-paylater",
  [
    body("split_id").isUUID().withMessage("Valid split ID is required"),
    body("order_id").isUUID().withMessage("Valid order ID is required"),
  ],
  paymentController.processPayLaterSplit,
);

// POST /api/payments/process-cash - Process Cash split (Admin only)
router.post(
  "/process-cash",
  authenticateToken,
  requireRole(["ADMIN", "SUB_ADMIN"]),
  upload.single("receipt"),
  [
    body("split_id").isUUID().withMessage("Valid split ID is required"),
    body("order_id").isUUID().withMessage("Valid order ID is required"),
    body("user_id").isUUID().withMessage("Valid user ID is required"),
    body("transaction_id").optional().isString(),
  ],
  paymentController.processCashSplit,
);

// GET /api/payments/splits/:orderId - Get payment splits
router.get("/splits/:orderId", paymentController.getPaymentSplits);

// Admin endpoints (optional)
router.get(
  "/admin/payments",
  requireRole(["ADMIN", "STAFF", "SUB_ADMIN"]),
  (req, res) => {
    // You can add an admin endpoint to list all payments if needed
    res.status(501).json({ message: "Not implemented yet" });
  },
);

module.exports = router;
