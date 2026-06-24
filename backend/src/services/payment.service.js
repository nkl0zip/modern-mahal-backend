// services/payment.service.js
const pool = require("../config/db");
const paymentModel = require("../models/payment.model");
const payLaterModel = require("../models/paylater.model");
const phonepeService = require("./phonepe.service");
const { getUserPayLaterDetails } = require("../models/paylater.model");

class PaymentService {
  /**
   * Calculate payment splits for order
   */
  async calculatePaymentSplits(
    orderId,
    userId,
    selectedPaymentMethods,
    client = null,
  ) {
    // Use the provided client or fallback to a new connection
    const useExistingClient = client !== null;
    const db = client || (await pool.connect());

    try {
      // Only begin transaction if we're using our own connection
      if (!useExistingClient) {
        await db.query("BEGIN");
      }

      // Get order details
      const orderResult = await db.query(
        `SELECT grand_total FROM orders WHERE id = $1 AND user_id = $2`,
        [orderId, userId],
      );

      if (orderResult.rows.length === 0) {
        throw new Error("Order not found");
      }

      const grandTotal = parseFloat(orderResult.rows[0].grand_total);
      let remainingAmount = grandTotal;
      const splits = [];

      // Process each payment method
      for (const method of selectedPaymentMethods) {
        let amount = 0;

        if (method.type === "PAY_LATER") {
          // Check user's available pay later credit
          const userDetails = await getUserPayLaterDetails(userId);
          const availableCredit = parseFloat(userDetails.available_credit || 0);

          // User wants to use pay later
          if (method.amount) {
            amount = Math.min(
              parseFloat(method.amount),
              availableCredit,
              remainingAmount,
            );
          } else {
            // Use available credit up to remaining amount
            amount = Math.min(availableCredit, remainingAmount);
          }

          if (amount > 0) {
            splits.push({
              payment_method: "PAY_LATER",
              amount: amount,
              slab_id: userDetails.slab_id,
              metadata: {
                available_credit_before: availableCredit,
              },
            });
            remainingAmount -= amount;
          }
        } else if (method.type === "PHONEPE") {
          // PhonePe payment for remaining amount
          if (remainingAmount > 0) {
            splits.push({
              payment_method: "PHONEPE",
              amount: remainingAmount,
              metadata: {
                is_remaining: true,
              },
            });
            remainingAmount = 0;
          }
        } else if (method.type === "CASH") {
          // Cash payment (admin recorded)
          if (method.amount && method.amount <= remainingAmount) {
            splits.push({
              payment_method: "CASH",
              amount: parseFloat(method.amount),
              metadata: {
                is_admin_recorded: true,
              },
            });
            remainingAmount -= parseFloat(method.amount);
          }
        }
      }

      // Validate total matches grand total
      const totalSplitAmount = splits.reduce((sum, s) => sum + s.amount, 0);
      if (Math.abs(totalSplitAmount - grandTotal) > 0.01) {
        throw new Error(
          `Payment split total (${totalSplitAmount}) does not match order total (${grandTotal})`,
        );
      }

      // Create payment split records - use the same client
      const createdSplits = [];
      for (const split of splits) {
        const created = await this.createPaymentSplitWithClient({
          orderId: orderId,
          paymentMethod: split.payment_method,
          amount: split.amount,
          slabId: split.slab_id || null,
          metadata: split.metadata || {},
          client: db,
        });
        createdSplits.push(created);
      }

      // Update order with selected payment method
      let selectedMethodType = "MIXED";
      if (splits.length === 1) {
        selectedMethodType = splits[0].payment_method;
      }

      await db.query(
        `
        UPDATE orders
        SET selected_payment_method = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        `,
        [selectedMethodType, orderId],
      );

      // Only commit if we started the transaction
      if (!useExistingClient) {
        await db.query("COMMIT");
      }

      return {
        splits: createdSplits,
        total: grandTotal,
        selected_method: selectedMethodType,
      };
    } catch (error) {
      // Only rollback if we started the transaction
      if (!useExistingClient) {
        await db.query("ROLLBACK");
      }
      throw error;
    } finally {
      // Only release if we created our own connection
      if (!useExistingClient && db.release) {
        db.release();
      }
    }
  }

  /**
   * Helper method to create payment split with a client
   */
  async createPaymentSplitWithClient({
    orderId,
    paymentMethod,
    amount,
    currency = "INR",
    slabId = null,
    metadata = {},
    client,
  }) {
    const { rows } = await client.query(
      `
      INSERT INTO payment_splits (
        order_id,
        payment_method,
        amount,
        currency,
        status,
        slab_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)
      RETURNING *;
      `,
      [
        orderId,
        paymentMethod,
        amount,
        currency,
        slabId,
        JSON.stringify(metadata),
      ],
    );
    return rows[0];
  }

  /**
   * Process PayLater payment for a split
   */
  async processPayLaterSplit(splitId, orderId, userId) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Get split details with FOR UPDATE lock
      const splitResult = await client.query(
        `SELECT * FROM payment_splits WHERE id = $1 AND order_id = $2 FOR UPDATE`,
        [splitId, orderId],
      );

      if (splitResult.rows.length === 0) {
        throw new Error("Payment split not found");
      }

      const split = splitResult.rows[0];

      if (split.payment_method !== "PAY_LATER") {
        throw new Error("Invalid payment method for this split");
      }

      if (split.status === "COMPLETED") {
        await client.query("COMMIT");
        return { already_completed: true, split };
      }

      // Check user's pay later balance - use FOR UPDATE to lock the user row
      const userResult = await client.query(
        `SELECT pay_later_balance FROM users WHERE id = $1 FOR UPDATE`,
        [userId],
      );

      if (userResult.rows.length === 0) {
        throw new Error("User not found");
      }

      const currentBalance = parseFloat(userResult.rows[0].pay_later_balance);
      const amountToDeduct = parseFloat(split.amount);

      if (currentBalance < amountToDeduct) {
        throw new Error(
          `Insufficient pay later credit. Available: ${currentBalance}, Required: ${amountToDeduct}`,
        );
      }

      // Calculate new balance
      const newBalance = currentBalance - amountToDeduct;

      // Create pay later transaction (DEBIT) - use the client, not pool
      const transactionResult = await client.query(
        `
        INSERT INTO pay_later_transactions (
          user_id, order_id, transaction_type, amount, balance_after,
          payment_method, description, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;
        `,
        [
          userId,
          orderId,
          "DEBIT",
          amountToDeduct,
          newBalance,
          "PAY_LATER",
          `Purchase using pay later - Order #${orderId}`,
          JSON.stringify({
            payment_split_id: splitId,
            order_id: orderId,
            type: "PAY_LATER_PURCHASE",
          }),
        ],
      );

      const transaction = transactionResult.rows[0];

      // Link transaction to split
      await client.query(
        `
        UPDATE payment_splits
        SET 
          pay_later_transaction_id = $1,
          status = 'COMPLETED',
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        `,
        [transaction.id, splitId],
      );

      // Update user's pay later balance
      await client.query(
        `
        UPDATE users
        SET 
          pay_later_balance = $1,
          total_pay_later_used = total_pay_later_used + $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        `,
        [newBalance, amountToDeduct, userId],
      );

      // Update order pay_later_used
      await client.query(
        `
        UPDATE orders
        SET 
          pay_later_used = pay_later_used + $1,
          pay_later_transaction_id = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        `,
        [amountToDeduct, transaction.id, orderId],
      );

      await client.query("COMMIT");

      return {
        success: true,
        split_id: splitId,
        transaction_id: transaction.id,
        amount: amountToDeduct,
        new_balance: newBalance,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Process PhonePe payment for a split
   */
  async processPhonePeSplit(splitId, orderId, userId, order) {
    // Get split details
    const split = await paymentModel.getPaymentSplitsByOrder(orderId);
    const targetSplit = split.find((s) => s.id === splitId);

    if (!targetSplit) {
      throw new Error("Payment split not found");
    }

    if (targetSplit.payment_method !== "PHONEPE") {
      throw new Error("Invalid payment method for this split");
    }

    // Generate merchant transaction ID
    const merchantTransactionId = `TXN${Date.now()}${Math.random().toString(36).substring(2, 8)}`;

    // Create payment record
    const payment = await paymentModel.createPayment({
      orderId: orderId,
      paymentGateway: "PHONEPE",
      gatewayTransactionId: merchantTransactionId,
      amount: targetSplit.amount,
      currency: "INR",
      gatewayRequest: {
        orderId: orderId,
        amount: targetSplit.amount,
        splitId: splitId,
      },
      metadata: {
        userId: userId,
        splitId: splitId,
        paymentMethod: "PHONEPE",
        isSplit: true,
      },
    });

    // Link payment to split
    await paymentModel.linkPaymentToSplit(splitId, payment.id);

    // Initiate PhonePe payment
    const phonepeResponse = await phonepeService.initiatePayment({
      orderId: orderId,
      amount: targetSplit.amount,
      merchantTransactionId: merchantTransactionId,
      userPhone: order.user_phone,
    });

    return {
      split_id: splitId,
      payment_id: payment.id,
      redirect_url: phonepeResponse.redirectUrl,
      transaction_id: merchantTransactionId,
    };
  }

  /**
   * Process Cash payment for a split (Admin recorded)
   */
  async processCashSplit(splitId, orderId, userId, receiptData, adminId) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Get split details
      const splitResult = await client.query(
        `SELECT * FROM payment_splits WHERE id = $1 AND order_id = $2 FOR UPDATE`,
        [splitId, orderId],
      );

      if (splitResult.rows.length === 0) {
        throw new Error("Payment split not found");
      }

      const split = splitResult.rows[0];

      if (split.payment_method !== "CASH") {
        throw new Error("Invalid payment method for this split");
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
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Process payment webhook for split
   */
  async processPaymentWebhookForSplit(
    merchantTransactionId,
    paymentStatus,
    gatewayResponse,
  ) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Find payment by merchant transaction ID
      const paymentResult = await client.query(
        `SELECT * FROM payments WHERE gateway_transaction_id = $1 FOR UPDATE`,
        [merchantTransactionId],
      );

      if (paymentResult.rows.length === 0) {
        throw new Error("Payment not found");
      }

      const payment = paymentResult.rows[0];

      // Find the split linked to this payment
      const splitResult = await client.query(
        `SELECT * FROM payment_splits WHERE payment_id = $1 FOR UPDATE`,
        [payment.id],
      );

      if (splitResult.rows.length === 0) {
        throw new Error("Payment split not found");
      }

      const split = splitResult.rows[0];

      // Update payment status
      await client.query(
        `
        UPDATE payments
        SET 
          status = $1,
          gateway_response = gateway_response || $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        `,
        [paymentStatus, gatewayResponse, payment.id],
      );

      // If payment successful, update split status
      if (paymentStatus === "SUCCESS") {
        await client.query(
          `
          UPDATE payment_splits
          SET 
            status = 'COMPLETED',
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          `,
          [split.id],
        );

        // Update order online_paid
        await client.query(
          `
          UPDATE orders
          SET 
            online_paid = online_paid + $1,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          `,
          [split.amount, split.order_id],
        );
      }

      await client.query("COMMIT");

      return {
        success: true,
        payment_id: payment.id,
        split_id: split.id,
        order_id: split.order_id,
        status: paymentStatus,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if all splits are completed for an order
   */
  async checkAndFinalizeOrder(orderId) {
    const allCompleted = await paymentModel.areAllSplitsCompleted(orderId);

    if (allCompleted) {
      // Update order status if not already
      await pool.query(
        `
        UPDATE orders
        SET 
          payment_split_completed = true,
          status = CASE 
            WHEN grand_total > 0 AND pay_later_used = grand_total THEN 'PAID'
            ELSE 'PAID'
          END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        AND status = 'PENDING'
        `,
        [orderId],
      );

      return { finalized: true, order_id: orderId };
    }

    return { finalized: false, order_id: orderId };
  }
}

module.exports = new PaymentService();
