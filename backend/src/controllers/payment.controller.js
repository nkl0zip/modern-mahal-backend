const paymentModel = require("../models/payment.model");
const orderModel = require("../models/order.model");
const phonepeService = require("../services/phonepe.service");
const pool = require("../config/db");
const paymentService = require("../services/payment.service");
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

    // 3. Get the PhonePe payment split for this order
    const splits = await paymentModel.getPaymentSplitsByOrder(orderId);
    const phonepeSplit = splits.find(
      (s) => s.payment_method === "PHONEPE" && s.status === "PENDING",
    );

    if (!phonepeSplit) {
      return res.status(400).json({
        success: false,
        message:
          "No pending PhonePe payment split found for this order. Please check payment methods.",
      });
    }

    // 4. Check if PhonePe split is already paid
    if (phonepeSplit.status === "COMPLETED") {
      return res.status(400).json({
        success: false,
        message: "PhonePe payment for this order is already completed",
      });
    }

    // 5. Use the PhonePe split amount, not the full order total
    const amountToPay = parseFloat(phonepeSplit.amount);

    // 6. Generate merchant transaction ID (unique per attempt)
    const merchantTransactionId = `TXN${Date.now()}${Math.random().toString(36).substring(2, 8)}`;

    // 7. Create payment record (INITIATED) with the split amount
    const payment = await paymentModel.createPayment({
      orderId: order.id,
      paymentGateway: "PHONEPE",
      gatewayTransactionId: merchantTransactionId,
      amount: amountToPay, // Use split amount, not full total
      currency: "INR",
      gatewayRequest: {
        orderId: order.id,
        amount: amountToPay,
        splitId: phonepeSplit.id,
      },
      metadata: {
        initiatedBy: userId,
        splitId: phonepeSplit.id,
        paymentMethod: "PHONEPE",
        isSplit: true,
      },
    });

    // 8. Link payment to split
    await paymentModel.linkPaymentToSplit(phonepeSplit.id, payment.id);

    // 9. Call PhonePe API with the split amount
    const phonepeResponse = await phonepeService.initiatePayment({
      orderId: order.id,
      amount: amountToPay, // Use split amount
      merchantTransactionId,
      userPhone: req.user.phone,
    });

    // 10. Return redirect URL to frontend
    res.json({
      success: true,
      message: "Payment initiated",
      data: {
        paymentId: payment.id,
        redirectUrl: phonepeResponse.redirectUrl,
        transactionId: merchantTransactionId,
        amount: amountToPay,
        splitId: phonepeSplit.id,
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
    // In the webhook, when payment is successful, update the split status
    if (paymentStatus === "SUCCESS") {
      // Update order status
      await client.query(
        `UPDATE orders SET status = 'PAID', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [payment.order_id],
      );

      // Update the PhonePe split status (the split is already linked to payment)
      await client.query(
        `UPDATE payment_splits 
     SET status = 'COMPLETED', 
         completed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE payment_id = $1`,
        [payment.id],
      );

      // Update order online_paid
      await client.query(
        `UPDATE orders 
     SET online_paid = online_paid + $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
        [payment.amount, payment.order_id],
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

    // Get the PhonePe payment split
    const splits = await paymentModel.getPaymentSplitsByOrder(orderId);
    const phonepeSplit = splits.find(
      (s) => s.payment_method === "PHONEPE" && s.status === "PENDING",
    );

    if (!phonepeSplit) {
      return res.status(400).json({
        success: false,
        message: "No pending PhonePe payment split found for this order",
      });
    }

    // Check latest payment status
    const latestPayment = await paymentModel.getLatestPaymentByOrder(orderId);
    if (latestPayment && latestPayment.status === "PENDING") {
      return res
        .status(400)
        .json({ success: false, message: "Previous payment still pending" });
    }

    // Proceed to initiate new payment with split amount
    const merchantTransactionId = `TXN${Date.now()}${Math.random().toString(36).substring(2, 8)}`;
    const payment = await paymentModel.createPayment({
      orderId: order.id,
      paymentGateway: "PHONEPE",
      gatewayTransactionId: merchantTransactionId,
      amount: parseFloat(phonepeSplit.amount), // Use split amount
      currency: "INR",
      gatewayRequest: {
        orderId: order.id,
        amount: parseFloat(phonepeSplit.amount),
        splitId: phonepeSplit.id,
        retry: true,
      },
      metadata: {
        initiatedBy: userId,
        retry: true,
        splitId: phonepeSplit.id,
      },
    });

    // Link payment to split
    await paymentModel.linkPaymentToSplit(phonepeSplit.id, payment.id);

    const phonepeResponse = await phonepeService.initiatePayment({
      orderId: order.id,
      amount: parseFloat(phonepeSplit.amount), // Use split amount
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
        amount: parseFloat(phonepeSplit.amount),
        splitId: phonepeSplit.id,
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

/**
 * POST /api/payments/calculate-split
 * Calculate payment splits for an order
 */
const calculatePaymentSplits = async (req, res, next) => {
  try {
    const { order_id, selected_payment_methods } = req.body;
    const userId = req.user.id;

    if (!order_id) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    if (
      !selected_payment_methods ||
      !Array.isArray(selected_payment_methods) ||
      selected_payment_methods.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "At least one payment method is required",
      });
    }

    // Validate payment methods
    const validMethods = ["PAY_LATER", "PHONEPE", "CASH"];
    for (const method of selected_payment_methods) {
      if (!validMethods.includes(method.type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid payment method: ${method.type}`,
        });
      }
    }

    const splits = await paymentService.calculatePaymentSplits(
      order_id,
      userId,
      selected_payment_methods,
    );

    res.status(200).json({
      success: true,
      message: "Payment splits calculated successfully",
      data: splits,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/payments/process-paylater
 * Process PayLater payment for a split
 */
const processPayLaterSplit = async (req, res, next) => {
  try {
    const { split_id, order_id } = req.body;
    const userId = req.user.id;

    if (!split_id || !order_id) {
      return res.status(400).json({
        success: false,
        message: "Split ID and Order ID are required",
      });
    }

    const result = await paymentService.processPayLaterSplit(
      split_id,
      order_id,
      userId,
    );

    res.status(200).json({
      success: true,
      message: "PayLater payment processed successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/payments/process-cash
 * Process Cash payment for a split (Admin only)
 */
const processCashSplit = async (req, res, next) => {
  const client = await pool.connect();

  const { split_id, order_id, user_id, transaction_id } = req.body;
  const adminId = req.user.id;

  try {
    await client.query("BEGIN");

    // Get split details
    const splitResult = await client.query(
      `SELECT * FROM payment_splits WHERE id = $1 AND order_id = $2 FOR UPDATE`,
      [split_id, order_id],
    );

    if (splitResult.rows.length === 0) {
      throw new Error("Payment split not found");
    }

    const split = splitResult.rows[0];

    // Allow CASH to be used for any pending split
    // Instead of requiring CASH payment method, we can process any split as cash
    // This is useful for admin recording cash payments against any split
    if (split.status === "COMPLETED") {
      throw new Error("This split is already completed");
    }

    // If the split is not CASH, we still allow it but log a warning
    if (split.payment_method !== "CASH") {
      console.log(
        `Warning: Processing non-CASH split (${split.payment_method}) as CASH payment`,
      );
    }

    // Create payment record for cash
    const payment = await client.query(
      `
      INSERT INTO payments (
        order_id,
        payment_gateway,
        amount,
        currency,
        status,
        metadata
      )
      VALUES ($1, 'CASH', $2, 'INR', 'SUCCESS', $3)
      RETURNING *;
      `,
      [
        orderId,
        split.amount,
        JSON.stringify({
          receipt_url: receiptData.receipt_url,
          receipt_public_id: receiptData.receipt_public_id,
          recorded_by: adminId,
          payment_method: "CASH",
          transaction_id: receiptData.transaction_id || null,
          original_split_method: split.payment_method,
        }),
      ],
    );

    // Update split status
    await client.query(
      `
      UPDATE payment_splits
      SET 
        cash_payment_id = $1,
        status = 'COMPLETED',
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP,
        metadata = metadata || $2
      WHERE id = $3
      `,
      [
        payment.rows[0].id,
        JSON.stringify({
          receipt_url: receiptData.receipt_url,
          recorded_by: adminId,
          recorded_at: new Date().toISOString(),
          payment_method: "CASH",
        }),
        splitId,
      ],
    );

    // Update order cash_paid
    await client.query(
      `
      UPDATE orders
      SET 
        cash_paid = cash_paid + $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [split.amount, orderId],
    );

    await client.query("COMMIT");

    return {
      success: true,
      split_id: splitId,
      payment_id: payment.rows[0].id,
      amount: split.amount,
      original_payment_method: split.payment_method,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/**
 * GET /api/payments/splits/:orderId
 * Get payment splits for an order
 */
const getPaymentSplits = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Verify order belongs to user
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

    const splits = await paymentModel.getPaymentSplitsByOrder(orderId);

    res.status(200).json({
      success: true,
      message: "Payment splits fetched successfully",
      data: splits,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  initiatePayment,
  paymentWebhook,
  retryPayment,
  getPaymentStatus,
  calculatePaymentSplits,
  processPayLaterSplit,
  processCashSplit,
  getPaymentSplits,
};
