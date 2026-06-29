const pool = require("../config/db");
const paymentModel = require("../models/payment.model");
const payLaterModel = require("../models/paylater.model");
const phonepeService = require("../services/phonepe.service");
const orderModel = require("../models/order.model");
const { validationResult } = require("express-validator");

/**
 * GET /api/paylater/repayment/outstanding-orders
 * Get all orders where user has outstanding pay later balance to repay
 */
const getOutstandingPayLaterOrders = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(
      `
      SELECT 
        o.id,
        o.order_number,
        o.created_at,
        o.grand_total,
        o.pay_later_used,
        o.payment_split_completed,
        o.selected_payment_method,
        o.status,
        o.pay_later_transaction_id,
        o.updated_at,
        (
          SELECT json_agg(
            json_build_object(
              'id', ps.id,
              'payment_method', ps.payment_method,
              'amount', ps.amount,
              'status', ps.status,
              'completed_at', ps.completed_at
            )
          )
          FROM payment_splits ps
          WHERE ps.order_id = o.id
            AND ps.payment_method = 'PAY_LATER'
            AND ps.status = 'COMPLETED'
        ) as pay_later_split_details,
        (
          SELECT COALESCE(SUM(amount), 0)
          FROM pay_later_transactions
          WHERE order_id = o.id
            AND transaction_type = 'CREDIT'
            AND user_id = $1
        ) as amount_repaid
      FROM orders o
      WHERE o.user_id = $1
        AND o.status = 'PAID'
        AND o.selected_payment_method IN ('MIXED', 'PAY_LATER')
        AND o.pay_later_used > 0
        AND o.payment_split_completed = false
      ORDER BY o.created_at DESC
      `,
      [userId],
    );

    // Calculate remaining amount for each order
    const ordersWithRemaining = rows.map((order) => {
      const payLaterUsed = parseFloat(order.pay_later_used || 0);
      const amountRepaid = parseFloat(order.amount_repaid || 0);
      const remainingAmount = payLaterUsed - amountRepaid;

      return {
        ...order,
        pay_later_used: payLaterUsed,
        amount_repaid: amountRepaid,
        remaining_amount: remainingAmount > 0 ? remainingAmount : 0,
        is_fully_repaid: remainingAmount <= 0,
      };
    });

    // Filter out fully repaid orders
    const outstandingOrders = ordersWithRemaining.filter(
      (order) => order.remaining_amount > 0,
    );

    // Get total outstanding balance across all orders
    const totalOutstanding = outstandingOrders.reduce(
      (sum, order) => sum + order.remaining_amount,
      0,
    );

    // Get user's current pay later details
    const userDetails = await payLaterModel.getUserPayLaterDetails(userId);

    res.status(200).json({
      success: true,
      message: "Outstanding pay later orders fetched successfully",
      data: {
        orders: outstandingOrders,
        summary: {
          total_orders: outstandingOrders.length,
          total_outstanding: totalOutstanding,
          user_available_credit: parseFloat(userDetails?.available_credit || 0),
          user_total_credit_limit: parseFloat(
            userDetails?.total_credit_limit || 0,
          ),
        },
      },
    });
  } catch (err) {
    console.error("Error fetching outstanding pay later orders:", err);
    next(err);
  }
};

/**
 * POST /api/paylater/repayment/initiate
 * Initiate repayment for a specific order using PhonePe
 */
const initiatePayLaterRepayment = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { order_id, amount } = req.body;

    if (!order_id) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than 0",
      });
    }

    // Start transaction
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // 1. Get order details with FOR UPDATE (no JOIN)
      const orderResult = await client.query(
        `
        SELECT 
          o.id,
          o.order_number,
          o.user_id,
          o.pay_later_used,
          o.payment_split_completed,
          o.status,
          o.selected_payment_method,
          o.grand_total
        FROM orders o
        WHERE o.id = $1 AND o.user_id = $2
        FOR UPDATE
        `,
        [order_id, userId],
      );

      if (orderResult.rows.length === 0) {
        throw new Error("Order not found or does not belong to user");
      }

      const order = orderResult.rows[0];

      // 2. Get user details without FOR UPDATE on the join
      // First lock the user row
      const userLockResult = await client.query(
        `
        SELECT id, pay_later_balance, total_pay_later_repaid, total_pay_later_used, slab_id
        FROM users
        WHERE id = $1
        FOR UPDATE
        `,
        [userId],
      );

      if (userLockResult.rows.length === 0) {
        throw new Error("User not found");
      }

      const user = userLockResult.rows[0];

      // 3. Get slab details separately (no FOR UPDATE needed here)
      let slabLimit = null;
      if (user.slab_id) {
        const slabResult = await client.query(
          `
          SELECT pay_later_limit
          FROM user_slabs
          WHERE id = $1
          `,
          [user.slab_id],
        );
        if (slabResult.rows.length > 0) {
          slabLimit = parseFloat(slabResult.rows[0].pay_later_limit);
        }
      }

      // 4. Validate order can be repaid
      if (order.status !== "PAID") {
        throw new Error("Order is not in PAID status");
      }

      if (
        order.selected_payment_method !== "MIXED" &&
        order.selected_payment_method !== "PAY_LATER"
      ) {
        throw new Error("Order does not have pay later payment");
      }

      if (parseFloat(order.pay_later_used) <= 0) {
        throw new Error("No pay later amount to repay");
      }

      if (order.payment_split_completed === true) {
        throw new Error("Order pay later has already been fully repaid");
      }

      // 5. Check how much has already been repaid
      const repaidResult = await client.query(
        `
        SELECT COALESCE(SUM(amount), 0) as total_repaid
        FROM pay_later_transactions
        WHERE order_id = $1
          AND transaction_type = 'CREDIT'
          AND user_id = $2
        `,
        [order_id, userId],
      );

      const alreadyRepaid = parseFloat(repaidResult.rows[0].total_repaid);
      const payLaterUsed = parseFloat(order.pay_later_used);
      const remainingAmount = payLaterUsed - alreadyRepaid;

      // 6. Validate repayment amount
      if (amount > remainingAmount) {
        throw new Error(
          `Repayment amount (${amount}) exceeds remaining balance (${remainingAmount})`,
        );
      }

      // 7. Generate merchant transaction ID
      const merchantTransactionId = `REPAY${Date.now()}${Math.random().toString(36).substring(2, 8)}`;

      // 8. Create payment record
      const payment = await client.query(
        `
        INSERT INTO payments (
          order_id,
          payment_gateway,
          gateway_transaction_id,
          amount,
          currency,
          status,
          gateway_request,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, 'INITIATED', $6, $7)
        RETURNING *;
        `,
        [
          order_id,
          "PHONEPE",
          merchantTransactionId,
          amount,
          "INR",
          JSON.stringify({
            order_id: order_id,
            order_number: order.order_number,
            amount: amount,
            type: "PAY_LATER_REPAYMENT",
            remaining_balance: remainingAmount - amount,
          }),
          JSON.stringify({
            userId: userId,
            user_id: userId, // Add both formats for compatibility
            orderId: order_id,
            type: "PAY_LATER_REPAYMENT",
            repayment_amount: amount,
            remaining_balance: remainingAmount - amount,
            order_number: order.order_number,
          }),
        ],
      );

      const paymentRecord = payment.rows[0];

      // 9. Call PhonePe API
      const userPhoneResult = await client.query(
        `SELECT phone FROM users WHERE id = $1`,
        [userId],
      );

      const userPhone = userPhoneResult.rows[0]?.phone || null;

      const phonepeResponse = await phonepeService.initiatePayment({
        orderId: order_id,
        amount: amount,
        merchantTransactionId: merchantTransactionId,
        userPhone: userPhone,
        redirectMode: "REDIRECT",
        callbackUrl: process.env.PHONEPE_REPAYMENT_CALLBACK_URL,
      });

      // 10. Update payment with gateway request
      await client.query(
        `
        UPDATE payments
        SET gateway_request = gateway_request || $1
        WHERE id = $2
        `,
        [JSON.stringify(phonepeResponse), paymentRecord.id],
      );

      // 11. Create payment event
      await client.query(
        `
        INSERT INTO payment_events (
          payment_id,
          event_type,
          event_data
        )
        VALUES ($1, $2, $3)
        `,
        [
          paymentRecord.id,
          "INITIATED",
          JSON.stringify({
            phonepe_response: phonepeResponse,
            initiated_at: new Date().toISOString(),
          }),
        ],
      );

      await client.query("COMMIT");

      res.status(200).json({
        success: true,
        message: "Repayment initiated successfully",
        data: {
          payment_id: paymentRecord.id,
          order_id: order_id,
          order_number: order.order_number,
          amount: amount,
          remaining_balance: remainingAmount - amount,
          transaction_id: merchantTransactionId,
          redirect_url: phonepeResponse.redirectUrl,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error initiating pay later repayment:", err);
    next(err);
  }
};

/**
 * POST /api/paylater/repayment/webhook
 * Handle PhonePe webhook for pay later repayment
 * This is a public endpoint (no auth)
 */
const handleRepaymentWebhook = async (req, res) => {
  const { response } = req.body;
  const xVerify = req.headers["x-verify"];

  console.log("📥 Repayment webhook received");
  console.log("📝 Headers:", JSON.stringify(req.headers, null, 2));
  console.log("📝 Body keys:", Object.keys(req.body));

  if (!response || !xVerify) {
    console.error("❌ Missing parameters in webhook");
    console.error("response:", response);
    console.error("xVerify:", xVerify);
    return res.status(400).send("Missing parameters");
  }

  // 1. Verify signature
  const isValid = phonepeService.verifyCallback(response, xVerify);
  if (!isValid) {
    console.error("❌ Invalid signature in webhook");
    return res.status(401).send("Invalid signature");
  }
  console.log("✅ Signature verified");

  // 2. Decode payload
  let decoded;
  try {
    decoded = phonepeService.decodeCallbackPayload(response);
    console.log(
      "📦 Decoded webhook payload:",
      JSON.stringify(decoded, null, 2),
    );
  } catch (err) {
    console.error("❌ Failed to decode payload:", err.message);
    return res.status(400).send("Invalid payload");
  }

  const {
    merchantTransactionId,
    transactionId: gatewayTransactionId,
    amount: amountInPaise,
    state,
    responseCode,
  } = decoded.data;

  const amount = amountInPaise / 100;

  console.log(`📊 Payment state: ${state}, TXN ID: ${merchantTransactionId}`);
  console.log(`💰 Amount: ${amount}`);

  // 3. Map PhonePe state to our status
  let paymentStatus = "FAILED";
  if (state === "COMPLETED") {
    paymentStatus = "SUCCESS";
    console.log("✅ Payment is SUCCESS");
  } else if (state === "PENDING") {
    paymentStatus = "PENDING";
    console.log("⏳ Payment is PENDING");
  } else {
    console.log(`❌ Payment is ${state} -> status: ${paymentStatus}`);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    console.log("🔒 Transaction started");

    // 4. Find payment by merchantTransactionId
    console.log(
      `🔍 Looking for payment with gateway_transaction_id: ${merchantTransactionId}`,
    );
    const paymentQuery = await client.query(
      `SELECT * FROM payments WHERE gateway_transaction_id = $1 FOR UPDATE`,
      [merchantTransactionId],
    );

    if (paymentQuery.rows.length === 0) {
      console.error(`❌ Payment not found for TXN: ${merchantTransactionId}`);
      await client.query("ROLLBACK");
      return res.status(404).send("Payment not found");
    }

    const payment = paymentQuery.rows[0];
    console.log(
      `✅ Payment found: ${payment.id}, Current Status: ${payment.status}`,
    );
    console.log(`📋 Payment metadata: ${JSON.stringify(payment.metadata)}`);

    // 5. Idempotency: if already processed, just return OK
    if (payment.status === "SUCCESS" || payment.status === "FAILED") {
      console.log(`⏭️ Payment already processed: ${payment.status}`);
      await client.query("COMMIT");
      return res.status(200).send("Already processed");
    }

    // 6. Insert payment event for audit (always do this)
    await client.query(
      `INSERT INTO payment_events (payment_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [payment.id, `WEBHOOK_${state}`, JSON.stringify(decoded)],
    );
    console.log(`✅ Payment event inserted: WEBHOOK_${state}`);

    // 7. CRITICAL: Update payment status FIRST, before any other logic
    // This ensures that even if subsequent steps fail, the payment status is recorded
    console.log(`🔄 Updating payment status to: ${paymentStatus}`);
    await client.query(
      `UPDATE payments
       SET status = $1,
           gateway_response = gateway_response || $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [paymentStatus, JSON.stringify(decoded), payment.id],
    );
    console.log(`✅ Payment status updated to: ${paymentStatus}`);

    // 8. If payment is NOT SUCCESS, just commit and return
    if (paymentStatus !== "SUCCESS") {
      console.log(`⚠️ Payment not successful, status: ${paymentStatus}`);
      await client.query("COMMIT");
      return res.status(200).send(`Payment status: ${paymentStatus}`);
    }

    // ============================================================
    // 9. PROCESS SUCCESSFUL REPAYMENT (paymentStatus === "SUCCESS")
    // ============================================================
    console.log("🔄 Processing successful repayment...");

    const orderId = payment.order_id;
    console.log(`📦 Order ID from payment: ${orderId}`);

    // Extract userId from metadata - try multiple sources
    let userId = null;
    if (payment.metadata) {
      let metadata = payment.metadata;
      if (typeof metadata === "string") {
        try {
          metadata = JSON.parse(metadata);
        } catch (e) {
          console.log("⚠️ Could not parse metadata string:", e.message);
        }
      }
      console.log(`📋 Parsed metadata: ${JSON.stringify(metadata)}`);

      // Try different metadata formats
      userId = metadata.userId || metadata.user_id || metadata.user || null;

      // If still null, try to get user from order
      if (!userId) {
        console.log("🔄 User ID not in metadata, trying to get from order...");
        const orderUserResult = await client.query(
          `SELECT user_id FROM orders WHERE id = $1`,
          [orderId],
        );
        if (orderUserResult.rows.length > 0) {
          userId = orderUserResult.rows[0].user_id;
          console.log(`👤 User ID from order: ${userId}`);
        }
      } else {
        console.log(`👤 User ID from metadata: ${userId}`);
      }
    }

    if (!userId) {
      console.error("❌ User ID not found in payment metadata or order");
      // Don't throw - just commit and return, but log the error
      await client.query("COMMIT");
      console.error("❌ Repayment processing failed: User ID not found");
      return res.status(200).send("Payment recorded but user ID not found");
    }

    // 10. Get order details with FOR UPDATE
    console.log(`🔍 Getting order: ${orderId}`);
    const orderResult = await client.query(
      `
      SELECT 
        o.id,
        o.user_id,
        o.pay_later_used,
        o.payment_split_completed,
        o.grand_total,
        o.status
      FROM orders o
      WHERE o.id = $1
      FOR UPDATE
      `,
      [orderId],
    );

    if (orderResult.rows.length === 0) {
      console.error(`❌ Order not found: ${orderId}`);
      await client.query("COMMIT");
      console.error("❌ Repayment processing failed: Order not found");
      return res.status(200).send("Payment recorded but order not found");
    }

    const order = orderResult.rows[0];
    console.log(`📦 Order found: ${order.id}`);
    console.log(`📦 Pay Later Used: ${order.pay_later_used}`);
    console.log(`📦 Payment Split Completed: ${order.payment_split_completed}`);

    // 11. Check if order is already fully repaid
    if (order.payment_split_completed === true) {
      console.log(`⏭️ Order already fully repaid: ${orderId}`);
      await client.query("COMMIT");
      return res.status(200).send("Already fully repaid");
    }

    // 12. Get user details with FOR UPDATE
    console.log(`🔍 Getting user: ${userId}`);
    const userResult = await client.query(
      `
      SELECT id, pay_later_balance, total_pay_later_repaid, slab_id
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [userId],
    );

    if (userResult.rows.length === 0) {
      console.error(`❌ User not found: ${userId}`);
      await client.query("COMMIT");
      console.error("❌ Repayment processing failed: User not found");
      return res.status(200).send("Payment recorded but user not found");
    }

    const user = userResult.rows[0];
    console.log(`👤 User found: ${user.id}`);
    console.log(`💰 Current balance: ${user.pay_later_balance}`);
    console.log(`💰 Total repaid: ${user.total_pay_later_repaid}`);

    // 13. Get slab limit separately
    let slabLimit = null;
    if (user.slab_id) {
      const slabResult = await client.query(
        `
        SELECT pay_later_limit
        FROM user_slabs
        WHERE id = $1
        `,
        [user.slab_id],
      );
      if (slabResult.rows.length > 0) {
        slabLimit = parseFloat(slabResult.rows[0].pay_later_limit);
        console.log(`📊 Slab limit: ${slabLimit}`);
      }
    }

    // 14. Calculate remaining amount
    console.log(`🔍 Calculating already repaid amount...`);
    const repaidResult = await client.query(
      `
      SELECT COALESCE(SUM(amount), 0) as total_repaid
      FROM pay_later_transactions
      WHERE order_id = $1
        AND transaction_type = 'CREDIT'
        AND user_id = $2
      `,
      [orderId, userId],
    );

    const alreadyRepaid = parseFloat(repaidResult.rows[0].total_repaid);
    const payLaterUsed = parseFloat(order.pay_later_used || 0);
    const repaymentAmount = parseFloat(amount);
    const remainingAfterThis = payLaterUsed - alreadyRepaid - repaymentAmount;

    console.log(`💰 Pay Later Used: ${payLaterUsed}`);
    console.log(`💰 Already Repaid: ${alreadyRepaid}`);
    console.log(`💰 Repayment Amount: ${repaymentAmount}`);
    console.log(`💰 Remaining After This: ${remainingAfterThis}`);

    // 15. Create pay later transaction (CREDIT)
    const currentBalance = parseFloat(user.pay_later_balance || 0);
    const newBalance = currentBalance + repaymentAmount;

    // Cap at slab limit if exists
    const finalBalance = slabLimit
      ? Math.min(newBalance, slabLimit)
      : newBalance;

    console.log(`💰 Balance: ${currentBalance} → ${finalBalance}`);

    console.log(`🔄 Creating CREDIT transaction...`);
    const transactionResult = await client.query(
      `
      INSERT INTO pay_later_transactions (
        user_id,
        order_id,
        transaction_type,
        amount,
        balance_after,
        payment_method,
        transaction_id,
        description,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
      `,
      [
        userId,
        orderId,
        "CREDIT",
        repaymentAmount,
        finalBalance,
        "PHONEPE",
        gatewayTransactionId,
        `Repayment of ₹${repaymentAmount} for order ${orderId} via PhonePe`,
        JSON.stringify({
          payment_id: payment.id,
          order_id: orderId,
          amount: repaymentAmount,
          balance_before: currentBalance,
          balance_after: finalBalance,
          remaining_after_repayment: remainingAfterThis,
          type: "PAY_LATER_REPAYMENT",
          gateway_transaction_id: gatewayTransactionId,
        }),
      ],
    );

    const transaction = transactionResult.rows[0];
    console.log(`✅ Pay later transaction created: ${transaction.id}`);

    // 16. Update user's pay later balance
    console.log(`🔄 Updating user balance...`);
    await client.query(
      `
      UPDATE users
      SET 
        pay_later_balance = $1,
        total_pay_later_repaid = total_pay_later_repaid + $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      `,
      [finalBalance, repaymentAmount, userId],
    );
    console.log(`✅ User balance updated to: ${finalBalance}`);
    console.log(`✅ Total repaid increased by: ${repaymentAmount}`);

    // 17. If fully repaid, mark payment_split_completed as true
    if (remainingAfterThis <= 0) {
      console.log(`🔄 Order fully repaid! Updating orders table...`);
      await client.query(
        `
        UPDATE orders
        SET 
          payment_split_completed = true,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [orderId],
      );
      console.log(
        `✅ Order marked as fully repaid (payment_split_completed = true)`,
      );

      // Also update payment_splits
      console.log(`🔄 Updating payment_splits metadata...`);
      await client.query(
        `
        UPDATE payment_splits
        SET 
          metadata = metadata || $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE order_id = $2
          AND payment_method = 'PAY_LATER'
        `,
        [
          JSON.stringify({
            fully_repaid_at: new Date().toISOString(),
            fully_repaid: true,
            repayment_transaction_id: transaction.id,
          }),
          orderId,
        ],
      );
      console.log(`✅ Payment splits updated`);
    }

    // 18. Update payment split with repayment info
    console.log(`🔄 Updating payment_split metadata with repayment info...`);
    await client.query(
      `
      UPDATE payment_splits
      SET 
        metadata = metadata || $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE payment_id = $2
      `,
      [
        JSON.stringify({
          repayment_completed: true,
          repayment_transaction_id: transaction.id,
          repayment_amount: repaymentAmount,
          remaining_after_repayment: remainingAfterThis,
          gateway_transaction_id: gatewayTransactionId,
        }),
        payment.id,
      ],
    );
    console.log(`✅ Payment split metadata updated`);

    // 19. Commit the transaction
    await client.query("COMMIT");
    console.log(`🎉 Repayment completed successfully for order ${orderId}`);

    // Send success response
    res.status(200).send("OK");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Repayment webhook error:", err);
    console.error("❌ Error stack:", err.stack);
    res.status(500).send("Internal server error");
  } finally {
    client.release();
  }
};

/**
 * GET /api/paylater/repayment/status/:orderId
 * Get repayment status for an order
 */
const getRepaymentStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    // Get order details
    const order = await orderModel.getOrderById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Get repayment transactions
    const { rows: transactions } = await pool.query(
      `
      SELECT 
        pt.*,
        p.status as payment_status,
        p.gateway_transaction_id,
        p.created_at as payment_created_at
      FROM pay_later_transactions pt
      LEFT JOIN payments p ON pt.transaction_id = p.gateway_transaction_id
      WHERE pt.order_id = $1
        AND pt.transaction_type = 'CREDIT'
      ORDER BY pt.created_at DESC
      `,
      [orderId],
    );

    // Get total repaid
    const totalRepaid = transactions.reduce(
      (sum, t) => sum + parseFloat(t.amount || 0),
      0,
    );

    const payLaterUsed = parseFloat(order.pay_later_used || 0);
    const remainingBalance = payLaterUsed - totalRepaid;

    res.status(200).json({
      success: true,
      message: "Repayment status fetched successfully",
      data: {
        order_id: orderId,
        order_number: order.order_number,
        pay_later_used: payLaterUsed,
        total_repaid: totalRepaid,
        remaining_balance: remainingBalance,
        is_fully_repaid: remainingBalance <= 0,
        payment_split_completed: order.payment_split_completed,
        transactions: transactions.map((t) => ({
          id: t.id,
          amount: parseFloat(t.amount),
          balance_after: parseFloat(t.balance_after),
          payment_method: t.payment_method,
          description: t.description,
          gateway_transaction_id: t.gateway_transaction_id,
          payment_status: t.payment_status,
          created_at: t.created_at,
        })),
      },
    });
  } catch (err) {
    console.error("Error fetching repayment status:", err);
    next(err);
  }
};

module.exports = {
  getOutstandingPayLaterOrders,
  initiatePayLaterRepayment,
  handleRepaymentWebhook,
  getRepaymentStatus,
};
