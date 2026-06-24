// models/delivery.model.js
const pool = require("../config/db");
const {
  generateOTP,
  generatePickupId,
  calculateOTPExpiry,
} = require("../utils/otpGenerator");

/**
 * Get all active delivery methods
 */
const getActiveDeliveryMethods = async () => {
  const { rows } = await pool.query(
    `
    SELECT * FROM delivery_methods
    WHERE is_active = true
    ORDER BY display_order ASC;
    `,
  );
  return rows;
};

/**
 * Get delivery method by ID
 */
const getDeliveryMethodById = async (methodId) => {
  const { rows } = await pool.query(
    `SELECT * FROM delivery_methods WHERE id = $1`,
    [methodId],
  );
  return rows[0] || null;
};

/**
 * Get delivery method by code
 */
const getDeliveryMethodByCode = async (code) => {
  const { rows } = await pool.query(
    `SELECT * FROM delivery_methods WHERE code = $1 AND is_active = true`,
    [code],
  );
  return rows[0] || null;
};

/**
 * Create delivery record for order
 */
const createDelivery = async ({
  orderId,
  deliveryMethodId,
  deliveryAddressId = null,
  deliveryAddressText = null,
  deliveryLatitude = null,
  deliveryLongitude = null,
  deliveryNotes = null,
  storePickupLocationId = null,
  pickupInstructions = null,
  deliveryCharge = 0,
  metadata = {},
  client = null, // Add this parameter
}) => {
  // Use the provided client or fallback to pool
  const db = client || pool;

  const { rows } = await db.query(
    `
    INSERT INTO order_deliveries (
      order_id,
      delivery_method_id,
      delivery_status,
      delivery_address_id,
      delivery_address_text,
      delivery_latitude,
      delivery_longitude,
      delivery_notes,
      store_pickup_location_id,
      pickup_instructions,
      delivery_charge,
      metadata
    )
    VALUES ($1, $2, 'PENDING', $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *;
    `,
    [
      orderId,
      deliveryMethodId,
      deliveryAddressId,
      deliveryAddressText,
      deliveryLatitude,
      deliveryLongitude,
      deliveryNotes,
      storePickupLocationId,
      pickupInstructions,
      deliveryCharge,
      JSON.stringify(metadata),
    ],
  );
  return rows[0];
};

/**
 * Generate pickup details for SELF delivery
 */
const generatePickupDetails = async (deliveryId, storeId, client = null) => {
  const pickupId = generatePickupId();
  const pickupOtp = generateOTP();
  const expiryDate = calculateOTPExpiry(7);

  const db = client || pool;

  const { rows } = await db.query(
    `
    UPDATE order_deliveries
    SET 
      pickup_id = $1,
      pickup_otp = $2,
      pickup_otp_expires_at = $3,
      pickup_code_generated_at = CURRENT_TIMESTAMP,
      store_pickup_location_id = $4,
      delivery_status = 'PROCESSING'
    WHERE id = $5
    RETURNING *;
    `,
    [pickupId, pickupOtp, expiryDate, storeId, deliveryId],
  );

  return rows[0];
};

/**
 * Get delivery by ID
 */
const getDeliveryById = async (deliveryId) => {
  const { rows } = await pool.query(
    `
    SELECT 
      d.*,
      dm.name as delivery_method_name,
      dm.code as delivery_method_code,
      s.store_name,
      s.address_line_1,
      s.address_line_2,
      s.city,
      s.state,
      s.pincode,
      s.google_maps_url,
      s.google_maps_embed_url,
      u.name as assigned_staff_name,
      u.email as assigned_staff_email,
      u2.name as verified_by_name
    FROM order_deliveries d
    LEFT JOIN delivery_methods dm ON d.delivery_method_id = dm.id
    LEFT JOIN store_details s ON d.store_pickup_location_id = s.id
    LEFT JOIN users u ON d.assigned_staff_id = u.id
    LEFT JOIN users u2 ON d.pickup_verified_by = u2.id
    WHERE d.id = $1;
    `,
    [deliveryId],
  );
  return rows[0] || null;
};

/**
 * Get delivery by order ID
 */
const getDeliveryByOrderId = async (orderId) => {
  const { rows } = await pool.query(
    `
    SELECT * FROM order_deliveries WHERE order_id = $1;
    `,
    [orderId],
  );
  return rows[0] || null;
};

/**
 * Get delivery by pickup ID
 */
const getDeliveryByPickupId = async (pickupId) => {
  const { rows } = await pool.query(
    `
    SELECT 
      d.*,
      o.order_number,
      o.grand_total,
      o.created_at as order_created_at,
      u.name as customer_name,
      u.email as customer_email,
      u.phone as customer_phone
    FROM order_deliveries d
    JOIN orders o ON d.order_id = o.id
    JOIN users u ON o.user_id = u.id
    WHERE d.pickup_id = $1;
    `,
    [pickupId],
  );
  return rows[0] || null;
};

/**
 * Verify pickup with OTP
 */
const verifyPickup = async (deliveryId, pickupId, otp, verifiedBy) => {
  const { rows } = await pool.query(
    `
    UPDATE order_deliveries
    SET 
      delivery_status = 'DELIVERED',
      pickup_verified_by = $1,
      pickup_verified_at = CURRENT_TIMESTAMP,
      actual_delivery_time = CURRENT_TIMESTAMP
    WHERE id = $2
      AND pickup_id = $3
      AND pickup_otp = $4
      AND pickup_otp_expires_at > CURRENT_TIMESTAMP
      AND delivery_status = 'PROCESSING'
    RETURNING *;
    `,
    [verifiedBy, deliveryId, pickupId, otp],
  );
  return rows[0] || null;
};

/**
 * Update delivery status
 */
const updateDeliveryStatus = async (deliveryId, status, metadata = {}) => {
  const { rows } = await pool.query(
    `
    UPDATE order_deliveries
    SET 
      delivery_status = $1,
      metadata = metadata || $2,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
    RETURNING *;
    `,
    [status, JSON.stringify(metadata), deliveryId],
  );
  return rows[0] || null;
};

/**
 * Assign staff to delivery
 */
const assignStaffToDelivery = async (deliveryId, staffId) => {
  const { rows } = await pool.query(
    `
    UPDATE order_deliveries
    SET 
      assigned_staff_id = $1,
      assigned_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *;
    `,
    [staffId, deliveryId],
  );
  return rows[0] || null;
};

/**
 * Add delivery tracking event
 */
const addDeliveryTrackingEvent = async ({
  deliveryId,
  eventType,
  eventDescription = null,
  eventLocation = null,
  eventLatitude = null,
  eventLongitude = null,
  eventData = {},
  createdBy = null,
}) => {
  const { rows } = await pool.query(
    `
    INSERT INTO delivery_tracking_events (
      delivery_id,
      event_type,
      event_description,
      event_location,
      event_latitude,
      event_longitude,
      event_data,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *;
    `,
    [
      deliveryId,
      eventType,
      eventDescription,
      eventLocation,
      eventLatitude,
      eventLongitude,
      JSON.stringify(eventData),
      createdBy,
    ],
  );
  return rows[0];
};

/**
 * Get delivery tracking events
 */
const getDeliveryTrackingEvents = async (deliveryId, limit = 50) => {
  const { rows } = await pool.query(
    `
    SELECT 
      e.*,
      u.name as created_by_name
    FROM delivery_tracking_events e
    LEFT JOIN users u ON e.created_by = u.id
    WHERE e.delivery_id = $1
    ORDER BY e.created_at DESC
    LIMIT $2;
    `,
    [deliveryId, limit],
  );
  return rows;
};

/**
 * Get all deliveries with filters (Admin)
 */
const getAllDeliveries = async (filters = {}, limit = 50, offset = 0) => {
  const conditions = [];
  const values = [];
  let paramCounter = 1;

  if (filters.delivery_status) {
    conditions.push(`d.delivery_status = $${paramCounter}`);
    values.push(filters.delivery_status);
    paramCounter++;
  }

  if (filters.delivery_method_id) {
    conditions.push(`d.delivery_method_id = $${paramCounter}`);
    values.push(filters.delivery_method_id);
    paramCounter++;
  }

  if (filters.user_id) {
    conditions.push(`o.user_id = $${paramCounter}`);
    values.push(filters.user_id);
    paramCounter++;
  }

  if (filters.start_date) {
    conditions.push(`d.created_at >= $${paramCounter}`);
    values.push(filters.start_date);
    paramCounter++;
  }

  if (filters.end_date) {
    conditions.push(`d.created_at <= $${paramCounter}`);
    values.push(filters.end_date);
    paramCounter++;
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const query = `
    SELECT 
      d.*,
      dm.name as delivery_method_name,
      dm.code as delivery_method_code,
      o.order_number,
      o.grand_total,
      o.status as order_status,
      u.name as customer_name,
      u.email as customer_email,
      u.phone as customer_phone,
      s.name as assigned_staff_name
    FROM order_deliveries d
    JOIN orders o ON d.order_id = o.id
    JOIN users u ON o.user_id = u.id
    LEFT JOIN delivery_methods dm ON d.delivery_method_id = dm.id
    LEFT JOIN users s ON d.assigned_staff_id = s.id
    ${whereClause}
    ORDER BY d.created_at DESC
    LIMIT $${paramCounter} OFFSET $${paramCounter + 1};
  `;
  values.push(limit, offset);

  const { rows } = await pool.query(query, values);
  return rows;
};

module.exports = {
  getActiveDeliveryMethods,
  getDeliveryMethodById,
  getDeliveryMethodByCode,
  createDelivery,
  generatePickupDetails,
  getDeliveryById,
  getDeliveryByOrderId,
  getDeliveryByPickupId,
  verifyPickup,
  updateDeliveryStatus,
  assignStaffToDelivery,
  addDeliveryTrackingEvent,
  getDeliveryTrackingEvents,
  getAllDeliveries,
};
