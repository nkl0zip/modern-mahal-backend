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

module.exports = {
  createPayment,
  updatePaymentStatus,
  getPaymentByOrderAndTransaction,
  getLatestPaymentByOrder,
  createPaymentEvent,
  hasOrderBeenPaid,
};
