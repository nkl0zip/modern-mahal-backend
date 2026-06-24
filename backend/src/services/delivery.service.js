// services/delivery.service.js
const pool = require("../config/db");
const deliveryModel = require("../models/delivery.model");
const {
  generateOTP,
  generatePickupId,
  calculateOTPExpiry,
} = require("../utils/otpGenerator");

class DeliveryService {
  /**
   * Calculate delivery charges for order
   */
  async calculateDeliveryCharges(deliveryMethodId, orderTotal, distance = 0) {
    const method = await deliveryModel.getDeliveryMethodById(deliveryMethodId);
    if (!method) {
      throw new Error("Invalid delivery method");
    }

    let charge = parseFloat(method.base_charge || 0);

    // Add per km charges for non-self deliveries
    if (method.code !== "SELF_PICKUP" && method.charge_per_km > 0) {
      charge += parseFloat(method.charge_per_km) * distance;
    }

    return {
      delivery_method: method.name,
      delivery_charge: charge,
      estimated_days: method.estimated_delivery_days,
    };
  }

  /**
   * Create delivery for order
   */
  async createDeliveryForOrder({
    orderId,
    deliveryMethodCode,
    deliveryData,
    userId,
  }) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Get delivery method
      const method =
        await deliveryModel.getDeliveryMethodByCode(deliveryMethodCode);
      if (!method) {
        throw new Error(`Invalid delivery method: ${deliveryMethodCode}`);
      }

      let deliveryAddressId = null;
      let deliveryAddressText = null;
      let deliveryLatitude = null;
      let deliveryLongitude = null;
      let storePickupLocationId = null;
      let pickupInstructions = null;

      // For SELF_PICKUP, get store details
      if (method.code === "SELF_PICKUP") {
        const storeResult = await client.query(
          `SELECT id FROM store_details WHERE is_active = true ORDER BY created_at DESC LIMIT 1`,
        );

        if (storeResult.rows.length === 0) {
          throw new Error("No active store found for pickup");
        }

        storePickupLocationId = storeResult.rows[0].id;
        pickupInstructions = deliveryData.pickupInstructions || null;
      } else {
        // For MANUAL/AUTO delivery, use provided address
        if (!deliveryData.addressId) {
          throw new Error(
            "Delivery address is required for this delivery method",
          );
        }

        // Verify address belongs to user
        const addressResult = await client.query(
          `SELECT * FROM user_address WHERE id = $1 AND user_id = $2`,
          [deliveryData.addressId, userId],
        );

        if (addressResult.rows.length === 0) {
          throw new Error("Invalid delivery address");
        }

        const address = addressResult.rows[0];
        deliveryAddressId = address.id;
        deliveryAddressText = `${address.address_line_1}, ${address.address_line_2 || ""}, ${address.city}, ${address.state} - ${address.pincode}`;
        deliveryLatitude = deliveryData.latitude || null;
        deliveryLongitude = deliveryData.longitude || null;
      }

      // Calculate delivery charge
      const chargeResult = await this.calculateDeliveryCharges(
        method.id,
        0, // order total will be added later
        deliveryData.distance || 0,
      );

      // Create delivery record
      const delivery = await client.query(
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
          method.id,
          deliveryAddressId,
          deliveryAddressText,
          deliveryLatitude,
          deliveryLongitude,
          deliveryData.notes || null,
          storePickupLocationId,
          pickupInstructions,
          chargeResult.delivery_charge,
          JSON.stringify({
            estimated_days: chargeResult.estimated_days,
            ...deliveryData.metadata,
          }),
        ],
      );

      // Update order with delivery ID
      await client.query(
        `
        UPDATE orders
        SET 
          delivery_method_id = $1,
          delivery_id = $2,
          shipping_amount = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        `,
        [method.id, delivery.rows[0].id, chargeResult.delivery_charge, orderId],
      );

      // For SELF_PICKUP, generate pickup details
      if (method.code === "SELF_PICKUP") {
        const pickupDetails = await this.generatePickupDetails(
          delivery.rows[0].id,
          storePickupLocationId,
        );

        await client.query("COMMIT");
        return {
          delivery: pickupDetails,
          method: method,
          type: "SELF_PICKUP",
          pickup_details: {
            pickup_id: pickupDetails.pickup_id,
            pickup_otp: pickupDetails.pickup_otp,
            expiry: pickupDetails.pickup_otp_expires_at,
          },
        };
      }

      await client.query("COMMIT");

      return {
        delivery: delivery.rows[0],
        method: method,
        type: method.code === "MANUAL_DELIVERY" ? "MANUAL" : "AUTO",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Generate pickup details for SELF delivery
   */
  async generatePickupDetails(deliveryId, storeId) {
    const pickupId = generatePickupId();
    const pickupOtp = generateOTP();
    const expiryDate = calculateOTPExpiry(7);

    const { rows } = await pool.query(
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
  }

  /**
   * Verify pickup with OTP
   */
  async verifyPickupWithOTP(deliveryId, pickupId, otp, verifiedBy) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Verify pickup
      const result = await client.query(
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

      if (result.rows.length === 0) {
        throw new Error("Invalid pickup ID, OTP, or pickup has expired");
      }

      const delivery = result.rows[0];

      // Update order status to PAID (since order is already paid, keep it as PAID)
      // Or you could add a new status like 'COMPLETED' to the enum
      // For now, keep it as PAID since the order is already paid
      await client.query(
        `
      UPDATE orders
      SET status = 'PAID', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
        [delivery.order_id],
      );

      // Log in order status history - use PAID instead of DELIVERED
      await client.query(
        `
      INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, reason)
      VALUES ($1, $2, $3, $4, $5)
      `,
        [
          delivery.order_id,
          "PAID", // old_status
          "PAID", // new_status - keep as PAID since DELIVERED doesn't exist
          verifiedBy,
          "Order picked up from store (verified with OTP)",
        ],
      );

      // Add tracking event
      await client.query(
        `
      INSERT INTO delivery_tracking_events (
        delivery_id,
        event_type,
        event_description,
        created_by
      )
      VALUES ($1, $2, $3, $4)
      `,
        [delivery.id, "DELIVERED", "Order picked up from store", verifiedBy],
      );

      await client.query("COMMIT");
      return delivery;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Assign staff to delivery (MANUAL only)
   */
  async assignStaffToDelivery(deliveryId, staffId, assignedBy) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Verify staff exists and has STAFF role
      const staffResult = await client.query(
        `SELECT id FROM users WHERE id = $1 AND role IN ('STAFF', 'ADMIN', 'SUB_ADMIN')`,
        [staffId],
      );

      if (staffResult.rows.length === 0) {
        throw new Error("Invalid staff member");
      }

      const delivery = await client.query(
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

      if (delivery.rows.length === 0) {
        throw new Error("Delivery not found");
      }

      // Add tracking event
      await client.query(
        `
        INSERT INTO delivery_tracking_events (
          delivery_id,
          event_type,
          event_description,
          created_by
        )
        VALUES ($1, $2, $3, $4)
        `,
        [deliveryId, "PICKUP", `Assigned to staff: ${staffId}`, assignedBy],
      );

      await client.query("COMMIT");
      return delivery.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update delivery status with tracking
   */
  async updateDeliveryStatusWithTracking(
    deliveryId,
    status,
    metadata = {},
    userId = null,
  ) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Update delivery status
      const delivery = await client.query(
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

      if (delivery.rows.length === 0) {
        throw new Error("Delivery not found");
      }

      // Add tracking event
      const eventDescriptions = {
        PROCESSING: "Order is being processed",
        DISPATCHED: "Order has been dispatched",
        IN_TRANSIT: "Order is in transit",
        DELIVERED: "Order has been delivered",
        CANCELLED: "Order delivery has been cancelled",
        FAILED: "Delivery failed",
      };

      await client.query(
        `
      INSERT INTO delivery_tracking_events (
        delivery_id,
        event_type,
        event_description,
        created_by
      )
      VALUES ($1, $2, $3, $4)
      `,
        [deliveryId, status, eventDescriptions[status] || status, userId],
      );

      // If delivered, update order status - use PAID since DELIVERED is not in enum
      if (status === "DELIVERED") {
        // Update order status to PAID (or you can add DELIVERED to enum)
        await client.query(
          `
        UPDATE orders
        SET status = 'PAID', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
          [delivery.rows[0].order_id],
        );

        // Add to order status history
        await client.query(
          `
        INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, reason)
        VALUES ($1, $2, $3, $4, $5)
        `,
          [
            delivery.rows[0].order_id,
            "PAID",
            "PAID",
            userId,
            "Order delivered successfully",
          ],
        );
      }

      await client.query("COMMIT");
      return delivery.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new DeliveryService();
