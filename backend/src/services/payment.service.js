// services/payment.service.js
const pool = require("../config/db");
const paymentModel = require("../models/payment.model");
const payLaterModel = require("../models/paylater.model");
const phonepeService = require("./phonepe.service");
const { getUserPayLaterDetails } = require("../models/paylater.model");

class PaymentService {
  /**
   * Calculate payment splits from cart (without saving to database)
   * Used before checkout to preview payment distribution
   */
  async calculateCartPaymentSplits({ userId, selectedPaymentMethods }) {
    try {
      // Get user's cart
      const cartResult = await pool.query(
        `SELECT id FROM cart WHERE user_id = $1 LIMIT 1`,
        [userId],
      );

      if (cartResult.rows.length === 0) {
        throw new Error("Cart not found");
      }

      const cartId = cartResult.rows[0].id;

      // Get cart items with pricing
      const cartItemsResult = await pool.query(
        `
      SELECT 
        ci.variant_id,
        pv.product_id,
        ci.quantity,
        ci.unit_price_snapshot,
        ci.manual_discount_amount,
        ci.coupon_discount_amount
      FROM cart_items ci
      JOIN product_variants pv ON ci.variant_id = pv.id
      WHERE ci.cart_id = $1
      `,
        [cartId],
      );

      if (cartItemsResult.rows.length === 0) {
        throw new Error("Cart is empty");
      }

      // Calculate cart totals
      let totalAmount = 0;
      let discountAmount = 0;

      for (const item of cartItemsResult.rows) {
        const unitPrice = parseFloat(item.unit_price_snapshot) || 0;
        const manualDiscount = parseFloat(item.manual_discount_amount) || 0;
        const couponDiscount = parseFloat(item.coupon_discount_amount) || 0;
        const quantity = parseInt(item.quantity) || 0;

        const itemTotal =
          unitPrice * quantity - manualDiscount - couponDiscount;
        totalAmount += itemTotal;
        discountAmount += manualDiscount + couponDiscount;
      }

      // Calculate tax (18% GST on subtotal after discounts)
      const TAX_RATE = 0.18;
      const subtotal = totalAmount - discountAmount;
      const taxAmount = Math.round(subtotal * TAX_RATE * 100) / 100;
      const grandTotal = subtotal + taxAmount;

      // Get user's pay later details
      const userDetails = await getUserPayLaterDetails(userId);
      const availableCredit = parseFloat(userDetails?.available_credit || 0);
      const slabLimit = parseFloat(userDetails?.total_credit_limit || 0);

      // Calculate splits based on selected payment methods
      let remainingAmount = grandTotal;
      const splits = [];
      let usedPayLater = 0;

      // Process PAY_LATER first (if selected)
      const payLaterMethod = selectedPaymentMethods.find(
        (m) => m.type === "PAY_LATER",
      );

      if (payLaterMethod) {
        let payLaterAmount = 0;

        if (payLaterMethod.amount) {
          // User specified an amount
          payLaterAmount = Math.min(
            parseFloat(payLaterMethod.amount),
            availableCredit,
            remainingAmount,
          );
        } else {
          // Use all available credit up to remaining amount
          payLaterAmount = Math.min(availableCredit, remainingAmount);
        }

        if (payLaterAmount > 0) {
          splits.push({
            payment_method: "PAY_LATER",
            amount: payLaterAmount,
            available_credit: availableCredit,
            remaining_credit_after: availableCredit - payLaterAmount,
            slab_limit: slabLimit,
            metadata: {
              available_credit_before: availableCredit,
              slab_limit: slabLimit,
            },
          });
          remainingAmount -= payLaterAmount;
          usedPayLater = payLaterAmount;
        }
      }

      // Process PHONEPE (if selected and remaining amount > 0)
      const phonePeMethod = selectedPaymentMethods.find(
        (m) => m.type === "PHONEPE",
      );

      if (phonePeMethod && remainingAmount > 0) {
        splits.push({
          payment_method: "PHONEPE",
          amount: remainingAmount,
          metadata: {
            is_remaining: true,
            remaining_after_paylater: remainingAmount,
          },
        });
        remainingAmount = 0;
      }

      // Process CASH (if selected and remaining amount > 0)
      const cashMethod = selectedPaymentMethods.find((m) => m.type === "CASH");

      if (cashMethod && cashMethod.amount && remainingAmount > 0) {
        const cashAmount = Math.min(
          parseFloat(cashMethod.amount),
          remainingAmount,
        );
        if (cashAmount > 0) {
          splits.push({
            payment_method: "CASH",
            amount: cashAmount,
            metadata: {
              is_admin_recorded: true,
            },
          });
          remainingAmount -= cashAmount;
        }
      }

      // Validate total matches grand total
      const totalSplitAmount = splits.reduce((sum, s) => sum + s.amount, 0);
      if (Math.abs(totalSplitAmount - grandTotal) > 0.01) {
        throw new Error(
          `Payment split total (${totalSplitAmount}) does not match order total (${grandTotal})`,
        );
      }

      // Determine selected payment method type
      let selectedMethodType = "MIXED";
      if (splits.length === 1) {
        selectedMethodType = splits[0].payment_method;
      }

      // Check if pay-later can cover the full amount
      const canPayFullWithPayLater =
        availableCredit >= grandTotal && usedPayLater > 0;

      return {
        cart_id: cartId,
        grand_total: grandTotal,
        subtotal: subtotal,
        tax_amount: taxAmount,
        tax_rate: TAX_RATE * 100,
        total_discount: discountAmount,
        payment_methods: selectedPaymentMethods,
        selected_method_type: selectedMethodType,
        splits: splits,
        summary: {
          total_to_pay: grandTotal,
          total_split_amount: totalSplitAmount,
          remaining_after_splits: remainingAmount,
          pay_later_used: usedPayLater,
          phonepe_amount:
            splits.find((s) => s.payment_method === "PHONEPE")?.amount || 0,
          cash_amount:
            splits.find((s) => s.payment_method === "CASH")?.amount || 0,
          pay_later_available: availableCredit,
          can_pay_full_with_paylater: canPayFullWithPayLater,
          has_sufficient_balance: usedPayLater <= availableCredit,
        },
        validation: {
          is_valid: remainingAmount === 0,
          errors:
            remainingAmount > 0
              ? [
                  `Payment methods do not cover the full amount. Remaining: ₹${remainingAmount.toFixed(2)}`,
                ]
              : [],
        },
      };
    } catch (error) {
      console.error("Error calculating cart payment splits:", error);
      throw error;
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
