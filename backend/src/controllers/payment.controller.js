const paymentModel = require("../models/payment.model");
const orderModel = require("../models/order.model");
const phonepeService = require("../services/phonepe.service");
const pool = require("../config/db");
const paymentService = require("../services/payment.service");
const { validationResult } = require("express-validator");
const { uploadToCloudinary } = require("../middlewares/upload.middleware");

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

    // 5. Idempotency: if there's already an INITIATED payment for this split, return it
    const existingInitiated = await paymentModel.getLatestPaymentByOrder(orderId);
    if (existingInitiated && existingInitiated.status === "INITIATED") {
      const initiatedSec = (Date.now() - new Date(existingInitiated.created_at).getTime()) / 1000;
      if (initiatedSec < 300) {
        return res.status(400).json({
          success: false,
          message: "A payment is already in progress for this order. Please wait or retry after 5 minutes.",
        });
      }
    }

    // 6. Use the PhonePe split amount, not the full order total
    const amountToPay = parseFloat(phonepeSplit.amount);

    // 7. Generate merchant transaction ID (unique per attempt)
    const merchantTransactionId = `TXN${Date.now()}${Math.random().toString(36).substring(2, 8)}`;

    // 8. Create payment record (INITIATED) with the split amount
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

    // 9. Link payment to split
    await paymentModel.linkPaymentToSplit(phonepeSplit.id, payment.id);

    // 10. Call PhonePe API with the split amount
    const phonepeResponse = await phonepeService.initiatePayment({
      orderId: order.id,
      amount: amountToPay, // Use split amount
      merchantTransactionId,
      userPhone: req.user.phone,
    });

    // 11. Return redirect URL to frontend
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
  const { response } = req.body;
  const xVerify = req.headers["x-verify"];

  console.log("[WEBHOOK] Received. x-verify present:", !!xVerify, "| response present:", !!response);

  if (!response || !xVerify) {
    console.warn("[WEBHOOK] Missing parameters — response:", !!response, "x-verify:", !!xVerify);
    return res.status(400).send("Missing parameters");
  }

  // 1. Verify signature
  const isValid = phonepeService.verifyCallback(response, xVerify);
  console.log("[WEBHOOK] Signature valid:", isValid);
  if (!isValid) {
    console.error("[WEBHOOK] Signature mismatch. x-verify header:", xVerify);
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

  console.log("[WEBHOOK] Decoded — txnId:", merchantTransactionId, "| state:", state, "| responseCode:", responseCode, "| amount:", amount);

  // 3. Map PhonePe state to our status
  let paymentStatus = "FAILED";
  if (state === "COMPLETED") paymentStatus = "SUCCESS";
  else if (state === "PENDING") paymentStatus = "PENDING";
  console.log("[WEBHOOK] Mapped paymentStatus:", paymentStatus);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 4. Find payment by merchantTransactionId
    const paymentQuery = await client.query(
      "SELECT * FROM payments WHERE gateway_transaction_id = $1 FOR UPDATE",
      [merchantTransactionId],
    );

    if (paymentQuery.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).send("Payment not found");
    }

    const payment = paymentQuery.rows[0];

    // 5. Idempotency: if already processed, just return OK
    console.log("[WEBHOOK] DB payment status:", payment.status, "for payment id:", payment.id);
    if (payment.status === "SUCCESS" || payment.status === "FAILED") {
      console.log("[WEBHOOK] Skipping — already processed as:", payment.status);
      await client.query("COMMIT");
      return res.status(200).send("Already processed");
    }

    // 5b. Amount validation — PhonePe sends amount in paise; verify it matches our record
    if (paymentStatus === "SUCCESS") {
      const expectedPaise = Math.round(parseFloat(payment.amount) * 100);
      if (amount !== expectedPaise) {
        console.error(
          `Webhook amount mismatch for txn ${merchantTransactionId}: expected ${expectedPaise} paise, got ${amount} paise`,
        );
        await client.query("ROLLBACK");
        return res.status(400).send("Amount mismatch");
      }
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

    // 8. If payment successful, update split status
    if (paymentStatus === "SUCCESS") {
      // Find the split linked to this payment
      const splitResult = await client.query(
        `SELECT * FROM payment_splits WHERE payment_id = $1 FOR UPDATE`,
        [payment.id],
      );

      if (splitResult.rows.length > 0) {
        const split = splitResult.rows[0];

        // Update split status
        await client.query(
          `UPDATE payment_splits
           SET status = 'COMPLETED', 
               completed_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [split.id],
        );

        // Update order online_paid
        await client.query(
          `UPDATE orders 
           SET online_paid = online_paid + $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [split.amount, split.order_id],
        );
      }

      // Check completion using the transaction client so uncommitted split updates are visible
      const completionResult = await client.query(
        `SELECT
           COUNT(*) AS total,
           COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed
         FROM payment_splits
         WHERE order_id = $1`,
        [payment.order_id],
      );
      const totalSplits = parseInt(completionResult.rows[0]?.total ?? 0, 10);
      const completedSplits = parseInt(completionResult.rows[0]?.completed ?? 0, 10);
      const allCompleted = totalSplits > 0 && totalSplits === completedSplits;

      if (allCompleted) {
        await client.query(
          `UPDATE orders
           SET
             payment_split_completed = true,
             status = 'PAID',
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
             AND status = 'PENDING'`,
          [payment.order_id],
        );
      }
    }

    console.log("[WEBHOOK] Done. Final status:", paymentStatus, "for txn:", merchantTransactionId);
    await client.query("COMMIT");
    res.status(200).send("OK");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[WEBHOOK] Processing error:", err);
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

// GET /api/payments/status/:orderId
// Intentionally reads only from DB — the webhook is the authoritative status source.
// PhonePe's sandbox status API always returns COMPLETED regardless of payment outcome,
// so querying it here produces wrong results in UAT and is unreliable in production
// during the brief window between redirect and webhook delivery.
const getPaymentStatus = async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;

  try {
    const order = await orderModel.getOrderById(orderId);
    if (!order)
      return res.status(404).json({ success: false, message: "Order not found" });
    if (order.user_id !== userId && req.user.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Fast path: order already finalised by webhook
    if (order.status === "PAID") {
      return res.json({
        success: true,
        data: { orderStatus: "PAID", paymentStatus: "SUCCESS" },
      });
    }

    const latestPayment = await paymentModel.getLatestPaymentByOrder(orderId);
    if (!latestPayment)
      return res.status(404).json({ success: false, message: "No payment found" });

    return res.json({
      success: true,
      data: {
        orderStatus: order.status,
        paymentStatus: latestPayment.status,
        payment: latestPayment,
      },
    });
  } catch (err) {
    console.error("Get payment status error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch payment status" });
  }
};

/**
 * POST /api/payments/calculate-split
 * Calculate payment splits from cart (pre-checkout)
 * No database entries are created
 */
const calculatePaymentSplits = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { selected_payment_methods } = req.body;

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
          message: `Invalid payment method: ${method.type}. Valid methods: ${validMethods.join(", ")}`,
        });
      }

      // Validate PAY_LATER amount if provided
      if (method.type === "PAY_LATER" && method.amount) {
        if (isNaN(method.amount) || method.amount <= 0) {
          return res.status(400).json({
            success: false,
            message: "PAY_LATER amount must be a positive number",
          });
        }
      }

      // Validate CASH amount if provided
      if (method.type === "CASH" && method.amount) {
        if (isNaN(method.amount) || method.amount <= 0) {
          return res.status(400).json({
            success: false,
            message: "CASH amount must be a positive number",
          });
        }
      }
    }

    // Calculate splits from cart
    const result = await paymentService.calculateCartPaymentSplits({
      userId,
      selectedPaymentMethods: selected_payment_methods,
    });

    res.status(200).json({
      success: true,
      message: "Payment splits calculated successfully",
      data: result,
    });
  } catch (err) {
    console.error("Calculate payment splits error:", err);
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
  const { split_id, order_id, user_id, transaction_id } = req.body;
  const adminId = req.user.id;

  // Upload receipt to Cloudinary if provided
  let receiptData = { receipt_url: null, receipt_public_id: null, transaction_id: transaction_id || null };
  if (req.file) {
    try {
      const uploadResult = await uploadToCloudinary(req.file, "payment-receipts");
      receiptData.receipt_url = uploadResult.secure_url;
      receiptData.receipt_public_id = uploadResult.public_id;
    } catch (uploadErr) {
      console.error("Receipt upload failed:", uploadErr);
      return res.status(500).json({ success: false, message: "Failed to upload receipt" });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get split details with row lock
    const splitResult = await client.query(
      `SELECT * FROM payment_splits WHERE id = $1 AND order_id = $2 FOR UPDATE`,
      [split_id, order_id],
    );

    if (splitResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Payment split not found" });
    }

    const split = splitResult.rows[0];

    if (split.status === "COMPLETED") {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "This split is already completed" });
    }

    if (split.payment_method !== "CASH") {
      console.log(
        `Warning: Processing non-CASH split (${split.payment_method}) as CASH payment`,
      );
    }

    // Create payment record
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
        order_id,
        split.amount,
        JSON.stringify({
          receipt_url: receiptData.receipt_url,
          receipt_public_id: receiptData.receipt_public_id,
          recorded_by: adminId,
          payment_method: "CASH",
          transaction_id: receiptData.transaction_id,
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
        split_id,
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
      [split.amount, order_id],
    );

    // Check if all splits are completed and finalise order (use client to see uncommitted changes)
    const completionResult = await client.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed
       FROM payment_splits
       WHERE order_id = $1`,
      [order_id],
    );
    const totalSplits = parseInt(completionResult.rows[0]?.total ?? 0, 10);
    const completedSplits = parseInt(completionResult.rows[0]?.completed ?? 0, 10);

    if (totalSplits > 0 && totalSplits === completedSplits) {
      await client.query(
        `UPDATE orders
         SET
           payment_split_completed = true,
           status = 'PAID',
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND status = 'PENDING'`,
        [order_id],
      );
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      split_id: split_id,
      payment_id: payment.rows[0].id,
      amount: split.amount,
      original_payment_method: split.payment_method,
      receipt_url: receiptData.receipt_url,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
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
