// services/payment.service.js
const pool = require("../config/db");
const paymentModel = require("../models/payment.model");
const payLaterModel = require("../models/paylater.model");
const phonepeService = require("./phonepe.service");
const { getUserPayLaterDetails } = require("../models/paylater.model");

/**
 * Helper: Round amount to 2 decimal places to avoid floating-point issues
 */
const roundAmount = (amount) => {
  return Math.round(parseFloat(amount) * 100) / 100;
};

class PaymentService {
  /**
   * Calculate payment splits from cart (without saving to database)
   * Used before checkout to preview payment distribution
   */
  async calculateCartPaymentSplits({ userId, selectedPaymentMethods }) {
    try {
      // Get user's cart
      const cartResult = await pool.query(
        `SELECT id, applied_coupon_id FROM cart WHERE user_id = $1 LIMIT 1`,
        [userId],
      );

      if (cartResult.rows.length === 0) {
        throw new Error("Cart not found");
      }

      const cartId = cartResult.rows[0].id;
      const appliedCouponId = cartResult.rows[0].applied_coupon_id;

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

      // Get coupon details if applied
      let coupon = null;
      if (appliedCouponId) {
        const couponResult = await pool.query(
          `
        SELECT d.*, COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', s.id,
              'name', s.name
            )
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'
        ) as segments
        FROM discounts d
        LEFT JOIN discount_segments ds ON ds.discount_id = d.id
        LEFT JOIN segments s ON s.id = ds.segment_id
        WHERE d.id = $1 AND d.type = 'COUPON' AND d.is_active = true AND d.expires_at > NOW()
        GROUP BY d.id
        `,
          [appliedCouponId],
        );
        if (couponResult.rows.length > 0) {
          coupon = couponResult.rows[0];
        }
      }

      // Get product segments for coupon eligibility
      const productIds = [
        ...new Set(cartItemsResult.rows.map((item) => item.product_id)),
      ];
      let productSegmentMap = {};

      if (productIds.length > 0) {
        const segmentQuery = `
        SELECT 
          ps.product_id,
          ps.segment_id
        FROM product_segments ps
        WHERE ps.product_id = ANY($1)
      `;
        const segmentResult = await pool.query(segmentQuery, [productIds]);

        segmentResult.rows.forEach((row) => {
          if (!productSegmentMap[row.product_id]) {
            productSegmentMap[row.product_id] = new Set();
          }
          productSegmentMap[row.product_id].add(row.segment_id);
        });
      }

      // Get coupon segments if coupon exists
      let couponSegmentIds = new Set();
      if (coupon) {
        const couponSegmentsResult = await pool.query(
          `SELECT segment_id FROM discount_segments WHERE discount_id = $1`,
          [coupon.id],
        );
        couponSegmentIds = new Set(
          couponSegmentsResult.rows.map((r) => r.segment_id),
        );
      }

      // Calculate cart totals with discounts
      let totalAmount = 0;
      let discountAmount = 0;
      let subtotal = 0;

      for (const item of cartItemsResult.rows) {
        const unitPrice = parseFloat(item.unit_price_snapshot) || 0;
        const manualDiscount = parseFloat(item.manual_discount_amount) || 0;
        const couponDiscount = parseFloat(item.coupon_discount_amount) || 0;
        const quantity = parseInt(item.quantity) || 0;

        const originalTotal = unitPrice * quantity;
        let itemDiscount = 0;

        // Check if coupon applies to this product
        let isCouponEligible = false;
        if (coupon) {
          const productSegments =
            productSegmentMap[item.product_id] || new Set();
          isCouponEligible =
            couponSegmentIds.size === 0 ||
            [...productSegments].some((segId) => couponSegmentIds.has(segId));
        }

        // Apply coupon discount if eligible
        if (isCouponEligible && coupon) {
          if (coupon.discount_mode === "PERCENTAGE") {
            itemDiscount = (originalTotal * Number(coupon.value)) / 100;
          } else if (coupon.discount_mode === "FLAT") {
            itemDiscount = Math.min(Number(coupon.value), originalTotal);
          }
          // Use coupon discount, ignore manual discount for this item
          discountAmount += itemDiscount;
          subtotal += originalTotal - itemDiscount;
        } else {
          // Apply manual discount only (coupon not applicable)
          const itemManualDiscount = manualDiscount * quantity;
          discountAmount += itemManualDiscount;
          subtotal += originalTotal - itemManualDiscount;
          // Also add any existing coupon discount from cart_items if coupon is not applied globally
          if (!coupon) {
            const itemCouponDiscount = couponDiscount * quantity;
            discountAmount += itemCouponDiscount;
            subtotal -= itemCouponDiscount;
          }
        }
      }

      // Calculate tax (18% GST on subtotal after discounts)
      const TAX_RATE = 0.18;
      const taxAmount = roundAmount(subtotal * TAX_RATE);
      const grandTotal = roundAmount(subtotal + taxAmount);

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

      // Get coupon details for response
      let couponDetails = null;
      if (coupon) {
        couponDetails = {
          id: coupon.id,
          coupon_code: coupon.coupon_code,
          discount_mode: coupon.discount_mode,
          value: coupon.value,
          type: coupon.type,
          expires_at: coupon.expires_at,
          segments: coupon.segments || [],
        };
      }

      return {
        cart_id: cartId,
        grand_total: grandTotal,
        subtotal: subtotal,
        tax_amount: taxAmount,
        tax_rate: TAX_RATE * 100,
        total_discount: discountAmount,
        applied_coupon: couponDetails,
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
   * Calculate and create payment splits for an order.
   * PayLater splits are always created as PENDING (no immediate deduction).
   */
  async calculateAndProcessPaymentSplits({
    orderId,
    userId,
    selectedPaymentMethods,
    client = null,
    grandTotal,
  }) {
    const useExistingClient = client !== null;
    const db = client || (await pool.connect());

    try {
      if (!useExistingClient) {
        await db.query("BEGIN");
      }

      let remainingAmount = grandTotal;
      const splits = [];
      let payLaterUsed = 0;

      for (const method of selectedPaymentMethods) {
        let amount = 0;

        if (method.type === "PAY_LATER") {
          const userDetails = await getUserPayLaterDetails(userId);
          const availableCredit = parseFloat(userDetails.available_credit || 0);

          if (method.amount) {
            amount = Math.min(
              parseFloat(method.amount),
              availableCredit,
              remainingAmount,
            );
          } else {
            amount = Math.min(availableCredit, remainingAmount);
          }

          if (amount > 0) {
            // Always create PayLater split as PENDING (no deduction yet)
            const split = await this.createPaymentSplitWithClient({
              orderId,
              paymentMethod: "PAY_LATER",
              amount,
              currency: "INR",
              slabId: userDetails.slab_id,
              metadata: {
                available_credit_before: availableCredit,
                pending: true,
              },
              client: db,
            });

            splits.push({
              payment_method: "PAY_LATER",
              amount: amount,
              slab_id: userDetails.slab_id,
              split_id: split.id,
              status: "PENDING",
              metadata: {
                available_credit_before: availableCredit,
                pending: true,
              },
            });

            payLaterUsed += amount;
            remainingAmount -= amount;
          }
        } else if (method.type === "PHONEPE") {
          if (remainingAmount > 0) {
            const split = await this.createPaymentSplitWithClient({
              orderId,
              paymentMethod: "PHONEPE",
              amount: remainingAmount,
              currency: "INR",
              slabId: null,
              metadata: {
                is_remaining: true,
                remaining_before: remainingAmount,
              },
              client: db,
            });

            splits.push({
              payment_method: "PHONEPE",
              amount: remainingAmount,
              split_id: split.id,
              status: "PENDING",
              metadata: {
                is_remaining: true,
              },
            });

            remainingAmount = 0;
          }
        } else if (method.type === "CASH") {
          if (method.amount && method.amount <= remainingAmount) {
            const cashAmount = parseFloat(method.amount);
            const split = await this.createPaymentSplitWithClient({
              orderId,
              paymentMethod: "CASH",
              amount: cashAmount,
              currency: "INR",
              slabId: null,
              metadata: {
                is_admin_recorded: true,
              },
              client: db,
            });

            splits.push({
              payment_method: "CASH",
              amount: cashAmount,
              split_id: split.id,
              status: "PENDING",
              metadata: {
                is_admin_recorded: true,
              },
            });

            remainingAmount -= cashAmount;
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

      // Determine selected payment method type
      let selectedMethodType = "MIXED";
      if (splits.length === 1) {
        selectedMethodType = splits[0].payment_method;
      }

      // Update order with selected payment method and pay_later_used (set once)
      await db.query(
        `UPDATE orders
       SET selected_payment_method = $1,
           pay_later_used = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
        [selectedMethodType, payLaterUsed, orderId],
      );

      if (!useExistingClient) {
        await db.query("COMMIT");
      }

      return {
        splits: splits,
        total: grandTotal,
        selected_method: selectedMethodType,
        pay_later_used: payLaterUsed,
      };
    } catch (error) {
      if (!useExistingClient) {
        await db.query("ROLLBACK");
      }
      console.error("Error processing payment splits:", error);
      throw error;
    } finally {
      if (!useExistingClient && db.release) {
        db.release();
      }
    }
  }

  /**
   * Process PayLater payment for an order
   * This deducts from user's balance and creates the transaction
   */
  async processPayLaterPayment({
    userId,
    orderId,
    amount,
    slabId = null,
    client = null,
  }) {
    const db = client || (await pool.connect());
    const useExistingClient = client !== null;

    try {
      if (!useExistingClient) {
        await db.query("BEGIN");
      }

      // Round the amount to avoid floating-point issues
      const roundedAmount = Math.round(parseFloat(amount) * 100) / 100;

      // Check user's pay later balance with lock
      const userResult = await db.query(
        `SELECT pay_later_balance, total_pay_later_used, total_pay_later_repaid 
       FROM users WHERE id = $1 FOR UPDATE`,
        [userId],
      );

      if (userResult.rows.length === 0) {
        throw new Error("User not found");
      }

      const currentBalance = parseFloat(userResult.rows[0].pay_later_balance);
      const totalUsed = parseFloat(
        userResult.rows[0].total_pay_later_used || 0,
      );

      if (currentBalance < roundedAmount) {
        throw new Error(
          `Insufficient pay later credit. Available: ${currentBalance}, Required: ${roundedAmount}`,
        );
      }

      const newBalance = currentBalance - roundedAmount;
      const newTotalUsed = totalUsed + roundedAmount;

      // Create pay later transaction (DEBIT)
      const transactionResult = await db.query(
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
          roundedAmount,
          newBalance,
          "PAY_LATER",
          `Purchase using pay later - Order #${orderId}`,
          JSON.stringify({
            order_id: orderId,
            type: "PAY_LATER_PURCHASE",
            amount: roundedAmount,
            balance_before: currentBalance,
            balance_after: newBalance,
          }),
        ],
      );

      const transaction = transactionResult.rows[0];

      // Update user's pay later balance
      await db.query(
        `UPDATE orders
        SET pay_later_used = pay_later_used + $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
        [roundedAmount, orderId],
      );

      // Create payment split record for PAY_LATER
      const splitResult = await this.createPaymentSplitWithClient({
        orderId: orderId,
        paymentMethod: "PAY_LATER",
        amount: roundedAmount,
        currency: "INR",
        slabId: slabId,
        metadata: {
          transaction_id: transaction.id,
          balance_before: currentBalance,
          balance_after: newBalance,
        },
        client: db,
      });

      const split = splitResult;

      // Update split with transaction ID and mark as COMPLETED
      await db.query(
        `
      UPDATE payment_splits
      SET 
        pay_later_transaction_id = $1,
        status = 'COMPLETED',
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
        [transaction.id, split.id],
      );

      if (!useExistingClient) {
        await db.query("COMMIT");
      }

      return {
        split_id: split.id,
        transaction_id: transaction.id,
        amount: roundedAmount,
        new_balance: newBalance,
        total_used: newTotalUsed,
      };
    } catch (error) {
      if (!useExistingClient) {
        await db.query("ROLLBACK");
      }
      console.error("Error processing PayLater payment:", error);
      throw error;
    } finally {
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

      // Round the amount to avoid floating-point issues
      const roundedAmount = Math.round(parseFloat(split.amount) * 100) / 100;

      // Check user's pay later balance - use FOR UPDATE to lock the user row
      const userResult = await client.query(
        `SELECT pay_later_balance FROM users WHERE id = $1 FOR UPDATE`,
        [userId],
      );

      if (userResult.rows.length === 0) {
        throw new Error("User not found");
      }

      const currentBalance = parseFloat(userResult.rows[0].pay_later_balance);

      if (currentBalance < roundedAmount) {
        throw new Error(
          `Insufficient pay later credit. Available: ${currentBalance}, Required: ${roundedAmount}`,
        );
      }

      // Calculate new balance
      const newBalance = currentBalance - roundedAmount;

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
          roundedAmount,
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
        [newBalance, roundedAmount, userId],
      );

      // Update order pay_later_used
      await client.query(
        `UPDATE orders
        SET pay_later_transaction_id = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
        [transaction.id, orderId],
      );

      await client.query("COMMIT");

      return {
        success: true,
        split_id: splitId,
        transaction_id: transaction.id,
        amount: roundedAmount,
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
   * @param {string} splitId - The split ID
   * @param {string} orderId - The order ID
   * @param {string} userId - The user ID
   * @param {object} order - Order details (must have user_phone)
   * @param {object} client - Optional database client (for transactional use)
   */
  async processPhonePeSplit(splitId, orderId, userId, order, client = null) {
    const db = client || (await pool.connect());
    const useExistingClient = client !== null;

    try {
      if (!useExistingClient) {
        await db.query("BEGIN");
      }

      // Get split details within the transaction (with row lock)
      const splitResult = await db.query(
        `SELECT * FROM payment_splits WHERE id = $1 AND order_id = $2 FOR UPDATE`,
        [splitId, orderId],
      );

      if (splitResult.rows.length === 0) {
        throw new Error(
          `Payment split not found for split_id: ${splitId}, order_id: ${orderId}`,
        );
      }

      const targetSplit = splitResult.rows[0];

      if (targetSplit.payment_method !== "PHONEPE") {
        throw new Error(
          `Invalid payment method. Expected PHONEPE, got ${targetSplit.payment_method}`,
        );
      }

      // Round amount to avoid floating-point issues
      const amount = Math.round(parseFloat(targetSplit.amount) * 100) / 100;
      const merchantTransactionId = `TXN${Date.now()}${Math.random().toString(36).substring(2, 8)}`;

      // Insert payment record using the same transaction
      const paymentResult = await db.query(
        `INSERT INTO payments (
        order_id, payment_gateway, gateway_transaction_id, amount,
        currency, status, gateway_request, metadata
      ) VALUES ($1, $2, $3, $4, $5, 'INITIATED', $6, $7)
      RETURNING *`,
        [
          orderId,
          "PHONEPE",
          merchantTransactionId,
          amount,
          "INR",
          JSON.stringify({
            orderId: orderId,
            amount: amount,
            splitId: splitId,
          }),
          JSON.stringify({
            userId: userId,
            splitId: splitId,
            paymentMethod: "PHONEPE",
            isSplit: true,
          }),
        ],
      );

      const payment = paymentResult.rows[0];

      // Link payment to split
      await db.query(
        `UPDATE payment_splits SET payment_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [payment.id, splitId],
      );

      // Insert payment event for audit
      await db.query(
        `INSERT INTO payment_events (payment_id, event_type, event_data)
       VALUES ($1, 'INITIATED', $2)`,
        [
          payment.id,
          JSON.stringify({ initiated_at: new Date().toISOString() }),
        ],
      );

      // Initiate PhonePe payment (external API – cannot be in transaction)
      const phonepeResponse = await phonepeService.initiatePayment({
        orderId: orderId,
        amount: amount,
        merchantTransactionId: merchantTransactionId,
        userPhone: order.user_phone,
      });

      // Update payment with gateway request/response
      await db.query(
        `UPDATE payments SET gateway_request = gateway_request || $1 WHERE id = $2`,
        [JSON.stringify(phonepeResponse), payment.id],
      );

      if (!useExistingClient) {
        await db.query("COMMIT");
      }

      return {
        split_id: splitId,
        payment_id: payment.id,
        redirect_url: phonepeResponse.redirectUrl,
        transaction_id: merchantTransactionId,
      };
    } catch (error) {
      if (!useExistingClient) {
        await db.query("ROLLBACK");
      }
      throw error;
    } finally {
      if (!useExistingClient && db.release) {
        db.release();
      }
    }
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
