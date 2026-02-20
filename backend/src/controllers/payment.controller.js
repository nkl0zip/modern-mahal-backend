const paymentModel = require("../models/payment.model");
const orderModel = require("../models/order.model");
const phonepeService = require("../services/phonepe.service");
const pool = require("../config/db");
const { validationResult } = require("express-validator");

// POST /api/payments/initiate
const initiatePayment = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { orderId } = req.body;
  const userId = req.user.id;

  try {
    // 1. Fetch order and verify it belongs to user and is PENDING
    const order = await orderModel.getOrderById(orderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }
    if (order.user_id !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (order.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Order cannot be paid (already processed)",
      });
    }

    // 2. Check if order already has a successful payment
    const alreadyPaid = await paymentModel.hasOrderBeenPaid(orderId);
    if (alreadyPaid) {
      return res
        .status(400)
        .json({ success: false, message: "Order already paid" });
    }

    // 3. Generate merchant transaction ID (unique per attempt)
    const merchantTransactionId = `TXN${Date.now()}${Math.random().toString(36).substring(2, 8)}`;

    // 4. Create payment record (INITIATED)
    const payment = await paymentModel.createPayment({
      orderId: order.id,
      paymentGateway: "PHONEPE",
      gatewayTransactionId: merchantTransactionId,
      amount: order.grand_total,
      currency: "INR",
      gatewayRequest: { orderId: order.id, amount: order.grand_total },
      metadata: { initiatedBy: userId },
    });

    // 5. Call PhonePe API
    const phonepeResponse = await phonepeService.initiatePayment({
      orderId: order.id,
      amount: order.grand_total,
      merchantTransactionId,
      userPhone: req.user.phone,
    });

    // 6. Return redirect URL to frontend
    res.json({
      success: true,
      message: "Payment initiated",
      data: {
        paymentId: payment.id,
        redirectUrl: phonepeResponse.redirectUrl,
        transactionId: merchantTransactionId,
      },
    });
  } catch (err) {
    console.error("Initiate payment error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to initiate payment" });
  }
};

// POST /api/payments/webhook (public, no auth)
const paymentWebhook = async (req, res) => {
  const { response } = req.body; // PhonePe sends { response: base64encoded }
  const xVerify = req.headers["x-verify"];

  if (!response || !xVerify) {
    return res.status(400).send("Missing parameters");
  }

  // 1. Verify signature
  const isValid = phonepeService.verifyCallback(response, xVerify);
  if (!isValid) {
    return res.status(401).send("Invalid signature");
  }

  // 2. Decode payload
  const decoded = phonepeService.decodeCallbackPayload(response);
  const {
    merchantTransactionId,
    transactionId: gatewayTransactionId,
    amount,
    state,
    responseCode,
  } = decoded.data;

  // 3. Map PhonePe state to our status
  let paymentStatus = "FAILED";
  if (state === "COMPLETED") paymentStatus = "SUCCESS";
  else if (state === "PENDING") paymentStatus = "PENDING";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 4. Find payment by merchantTransactionId (our gateway_transaction_id)
    const paymentQuery = await client.query(
      "SELECT * FROM payments WHERE gateway_transaction_id = $1 FOR UPDATE",
      [merchantTransactionId],
    );
    if (paymentQuery.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).send("Payment not found");
    }
    const payment = paymentQuery.rows[0];

    // 5. Idempotency: if already processed (SUCCESS or FAILED), just return OK
    if (payment.status === "SUCCESS" || payment.status === "FAILED") {
      await client.query("COMMIT");
      return res.status(200).send("Already processed");
    }

    // 6. Update payment record
    await client.query(
      `UPDATE payments
       SET status = $1,
           gateway_response = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [paymentStatus, decoded, payment.id],
    );

    // 7. Insert payment event for audit
    await client.query(
      `INSERT INTO payment_events (payment_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [payment.id, `WEBHOOK_${state}`, decoded],
    );

    // 8. If payment successful, update order status to PAID
    if (paymentStatus === "SUCCESS") {
      await client.query(
        `UPDATE orders SET status = 'PAID', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [payment.order_id],
      );
    }

    await client.query("COMMIT");
    res.status(200).send("OK");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Webhook processing error:", err);
    res.status(500).send("Internal server error");
  } finally {
    client.release();
  }
};

// POST /api/payments/retry
const retryPayment = async (req, res) => {
  const { orderId } = req.body;
  const userId = req.user.id;

  try {
    const order = await orderModel.getOrderById(orderId);
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    if (order.user_id !== userId)
      return res.status(403).json({ success: false, message: "Access denied" });

    // Check if order is already paid
    const alreadyPaid = await paymentModel.hasOrderBeenPaid(orderId);
    if (alreadyPaid) {
      return res
        .status(400)
        .json({ success: false, message: "Order already paid" });
    }

    // Check latest payment status: if it's still PENDING or FAILED, allow retry
    const latestPayment = await paymentModel.getLatestPaymentByOrder(orderId);
    if (latestPayment && latestPayment.status === "PENDING") {
      return res
        .status(400)
        .json({ success: false, message: "Previous payment still pending" });
    }

    // Proceed to initiate new payment (reuse initiate logic)
    // We can simply call the same initiate function or duplicate code
    const merchantTransactionId = `TXN${Date.now()}${Math.random().toString(36).substring(2, 8)}`;
    const payment = await paymentModel.createPayment({
      orderId: order.id,
      paymentGateway: "PHONEPE",
      gatewayTransactionId: merchantTransactionId,
      amount: order.grand_total,
      currency: "INR",
      gatewayRequest: {
        orderId: order.id,
        amount: order.grand_total,
        retry: true,
      },
      metadata: { initiatedBy: userId, retry: true },
    });

    const phonepeResponse = await phonepeService.initiatePayment({
      orderId: order.id,
      amount: order.grand_total,
      merchantTransactionId,
      userPhone: req.user.phone,
    });

    res.json({
      success: true,
      message: "Payment retry initiated",
      data: {
        paymentId: payment.id,
        redirectUrl: phonepeResponse.redirectUrl,
        transactionId: merchantTransactionId,
      },
    });
  } catch (err) {
    console.error("Retry payment error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to retry payment" });
  }
};

// GET /api/payments/status/:orderId (optional polling endpoint)
const getPaymentStatus = async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;

  try {
    const order = await orderModel.getOrderById(orderId);
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    if (order.user_id !== userId && req.user.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const latestPayment = await paymentModel.getLatestPaymentByOrder(orderId);
    if (!latestPayment) {
      return res
        .status(404)
        .json({ success: false, message: "No payment found" });
    }

    res.json({
      success: true,
      data: {
        orderStatus: order.status,
        paymentStatus: latestPayment.status,
        payment: latestPayment,
      },
    });
  } catch (err) {
    console.error("Get payment status error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch payment status" });
  }
};

module.exports = {
  initiatePayment,
  paymentWebhook,
  retryPayment,
  getPaymentStatus,
};
