// routes/payment/payLaterRepayment.routes.js
const express = require("express");
const { body } = require("express-validator");
const {
  getOutstandingPayLaterOrders,
  initiatePayLaterRepayment,
  handleRepaymentWebhook,
  getRepaymentStatus,
} = require("../controllers/payLaterRepayment.controller");
const { authenticateToken } = require("../middlewares/auth.middleware");

const router = express.Router();

// ============= PUBLIC WEBHOOK =============
// POST /api/paylater/repayment/webhook - PhonePe webhook (no auth)
router.post("/webhook", handleRepaymentWebhook);

// ============= AUTHENTICATED USER ROUTES =============
// GET /api/paylater/repayment/outstanding-orders - Get outstanding orders
router.get(
  "/outstanding-orders",
  authenticateToken,
  getOutstandingPayLaterOrders,
);

// POST /api/paylater/repayment/initiate - Initiate repayment
router.post(
  "/initiate",
  authenticateToken,
  [
    body("order_id").isUUID().withMessage("Valid order ID is required"),
    body("amount")
      .isFloat({ min: 0.01 })
      .withMessage("Amount must be greater than 0"),
  ],
  initiatePayLaterRepayment,
);

// GET /api/paylater/repayment/status/:orderId - Get repayment status
router.get("/status/:orderId", authenticateToken, getRepaymentStatus);

module.exports = router;
