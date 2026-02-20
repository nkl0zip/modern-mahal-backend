const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const paymentController = require("../controllers/payment.controller");
const {
  authenticateToken,
  requireRole,
} = require("../middlewares/auth.middleware");

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

// Admin endpoints (optional)
router.get("/admin/payments", requireRole(["ADMIN", "STAFF"]), (req, res) => {
  // You can add an admin endpoint to list all payments if needed
  res.status(501).json({ message: "Not implemented yet" });
});

module.exports = router;
