const pool = require("../config/db");

/**
 * Create a new payment record (status = INITIATED)
 */
const createPayment = async ({
  orderId,
  paymentGateway,
  gatewayTransactionId,
  amount,
  currency = "INR",
  gatewayRequest = {},
  metadata = {},
}) => {
  const query = `
    INSERT INTO payments (
      order_id, payment_gateway, gateway_transaction_id, amount,
      currency, status, gateway_request, metadata
    )
    VALUES ($1, $2, $3, $4, $5, 'INITIATED', $6, $7)
    RETURNING *;
  `;
  const values = [
    orderId,
    paymentGateway,
    gatewayTransactionId,
    amount,
    currency,
    gatewayRequest,
    metadata,
  ];
  const { rows } = await pool.query(query, values);
  return rows[0];
};

/**
 * Update payment status and response
 */
const updatePaymentStatus = async (
  paymentId,
  status,
  gatewayResponse = null,
  errorMessage = null,
) => {
  const query = `
    UPDATE payments
    SET status = $1,
        gateway_response = COALESCE($2, gateway_response),
        error_message = $3,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING *;
  `;
  const values = [status, gatewayResponse, errorMessage, paymentId];
  const { rows } = await pool.query(query, values);
  return rows[0];
};

/**
 * Get payment by order ID and gateway transaction ID
 */
const getPaymentByOrderAndTransaction = async (
  orderId,
  gatewayTransactionId,
) => {
  const query = `
    SELECT * FROM payments
    WHERE order_id = $1 AND gateway_transaction_id = $2;
  `;
  const { rows } = await pool.query(query, [orderId, gatewayTransactionId]);
  return rows[0] || null;
};

/**
 * Get latest payment for an order
 */
const getLatestPaymentByOrder = async (orderId) => {
  const query = `
    SELECT * FROM payments
    WHERE order_id = $1
    ORDER BY created_at DESC
    LIMIT 1;
  `;
  const { rows } = await pool.query(query, [orderId]);
  return rows[0] || null;
};

/**
 * Insert payment event (webhook audit)
 */
const createPaymentEvent = async (paymentId, eventType, eventData) => {
  const query = `
    INSERT INTO payment_events (payment_id, event_type, event_data)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [paymentId, eventType, eventData]);
  return rows[0];
};

/**
 * Check if an order already has a successful payment
 */
const hasOrderBeenPaid = async (orderId) => {
  const query = `
    SELECT EXISTS(
      SELECT 1 FROM payments
      WHERE order_id = $1 AND status = 'SUCCESS'
    ) as paid;
  `;
  const { rows } = await pool.query(query, [orderId]);
  return rows[0].paid;
};

/**
 * Create payment split record
 */
const createPaymentSplit = async ({
  orderId,
  paymentMethod,
  amount,
  currency = "INR",
  slabId = null,
  metadata = {},
}) => {
  const { rows } = await pool.query(
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
};

/**
 * Get payment splits by order ID
 */
const getPaymentSplitsByOrder = async (orderId) => {
  const { rows } = await pool.query(
    `
    SELECT 
      ps.*,
      pt.transaction_type as pay_later_type,
      pt.balance_after as pay_later_balance_after,
      p.status as payment_status,
      p.payment_gateway,
      p.gateway_transaction_id
    FROM payment_splits ps
    LEFT JOIN pay_later_transactions pt ON ps.pay_later_transaction_id = pt.id
    LEFT JOIN payments p ON ps.payment_id = p.id
    WHERE ps.order_id = $1
    ORDER BY ps.created_at ASC;
    `,
    [orderId],
  );
  return rows;
};

/**
 * Update payment split status
 */
const updatePaymentSplitStatus = async (splitId, status, metadata = {}) => {
  const { rows } = await pool.query(
    `
    UPDATE payment_splits
    SET 
      status = $1,
      metadata = metadata || $2,
      completed_at = CASE WHEN $1 = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE completed_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
    RETURNING *;
    `,
    [status, JSON.stringify(metadata), splitId],
  );
  return rows[0] || null;
};

/**
 * Link pay later transaction to split
 */
const linkPayLaterToSplit = async (splitId, payLaterTransactionId) => {
  const { rows } = await pool.query(
    `
    UPDATE payment_splits
    SET 
      pay_later_transaction_id = $1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *;
    `,
    [payLaterTransactionId, splitId],
  );
  return rows[0] || null;
};

/**
 * Link payment to split
 */
const linkPaymentToSplit = async (splitId, paymentId) => {
  const { rows } = await pool.query(
    `
    UPDATE payment_splits
    SET 
      payment_id = $1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *;
    `,
    [paymentId, splitId],
  );
  return rows[0] || null;
};

/**
 * Check if all splits are completed for an order
 */
const areAllSplitsCompleted = async (orderId) => {
  const { rows } = await pool.query(
    `
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed
    FROM payment_splits
    WHERE order_id = $1;
    `,
    [orderId],
  );
  if (!rows[0]) return false;
  const total = parseInt(rows[0].total, 10);
  const completed = parseInt(rows[0].completed, 10);
  return total > 0 && total === completed;
};

/**
 * Update payment split with PhonePe payment ID and mark as COMPLETED
 */
const completePhonePeSplit = async (splitId, paymentId) => {
  const { rows } = await pool.query(
    `
    UPDATE payment_splits
    SET 
      payment_id = $1,
      status = 'COMPLETED',
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
      AND payment_method = 'PHONEPE'
    RETURNING *;
    `,
    [paymentId, splitId],
  );
  return rows[0] || null;
};

/**
 * Get order payment summary
 */
const getOrderPaymentSummary = async (orderId) => {
  const { rows } = await pool.query(
    `
    SELECT 
      COALESCE(SUM(CASE WHEN payment_method = 'PAY_LATER' AND status = 'COMPLETED' THEN amount ELSE 0 END), 0) as pay_later_paid,
      COALESCE(SUM(CASE WHEN payment_method = 'PHONEPE' AND status = 'COMPLETED' THEN amount ELSE 0 END), 0) as phonepe_paid,
      COALESCE(SUM(CASE WHEN payment_method = 'CASH' AND status = 'COMPLETED' THEN amount ELSE 0 END), 0) as cash_paid,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN amount ELSE 0 END), 0) as total_paid,
      COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount ELSE 0 END), 0) as total_pending,
      COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed_count,
      COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_count
    FROM payment_splits
    WHERE order_id = $1;
    `,
    [orderId],
  );
  return rows[0] || null;
};

/**
 * Get payment by gateway transaction ID
 */
const getPaymentByGatewayTransactionId = async (gatewayTransactionId) => {
  const { rows } = await pool.query(
    `SELECT * FROM payments WHERE gateway_transaction_id = $1`,
    [gatewayTransactionId],
  );
  return rows[0] || null;
};

module.exports = {
  createPayment,
  updatePaymentStatus,
  getPaymentByOrderAndTransaction,
  getLatestPaymentByOrder,
  createPaymentEvent,
  hasOrderBeenPaid,
  createPaymentSplit,
  getPaymentSplitsByOrder,
  updatePaymentSplitStatus,
  linkPayLaterToSplit,
  linkPaymentToSplit,
  areAllSplitsCompleted,
  completePhonePeSplit,
  getOrderPaymentSummary,
  getPaymentByGatewayTransactionId,
};
