// controllers/delivery.controller.js
const deliveryModel = require("../models/delivery.model");
const deliveryService = require("../services/delivery.service");
const orderModel = require("../models/order.model");

/**
 * GET /api/delivery/methods
 * Get all active delivery methods
 */
const getDeliveryMethods = async (req, res, next) => {
  try {
    const methods = await deliveryModel.getActiveDeliveryMethods();

    res.status(200).json({
      success: true,
      message: "Delivery methods fetched successfully",
      data: methods,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/delivery/calculate
 * Calculate delivery charges
 */
const calculateDeliveryCharges = async (req, res, next) => {
  try {
    const { delivery_method_code, order_total, distance = 0 } = req.body;

    if (!delivery_method_code) {
      return res.status(400).json({
        success: false,
        message: "Delivery method code is required",
      });
    }

    const method =
      await deliveryModel.getDeliveryMethodByCode(delivery_method_code);
    if (!method) {
      return res.status(404).json({
        success: false,
        message: "Invalid delivery method",
      });
    }

    const charges = await deliveryService.calculateDeliveryCharges(
      method.id,
      order_total || 0,
      distance,
    );

    res.status(200).json({
      success: true,
      message: "Delivery charges calculated successfully",
      data: {
        method_code: method.code,
        method_name: method.name,
        ...charges,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/delivery/:deliveryId
 * Get delivery details
 */
const getDeliveryDetails = async (req, res, next) => {
  try {
    const { deliveryId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const delivery = await deliveryModel.getDeliveryById(deliveryId);
    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // Check authorization
    const order = await orderModel.getOrderById(delivery.order_id);
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

    res.status(200).json({
      success: true,
      message: "Delivery details fetched successfully",
      data: delivery,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/delivery/pickup/:pickupId
 * Get delivery by pickup ID
 */
const getDeliveryByPickupId = async (req, res, next) => {
  try {
    const { pickupId } = req.params;

    const delivery = await deliveryModel.getDeliveryByPickupId(pickupId);
    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found for this pickup ID",
      });
    }

    res.status(200).json({
      success: true,
      message: "Delivery details fetched successfully",
      data: delivery,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/delivery/:deliveryId/pickup/verify
 * Verify pickup with OTP (Admin/Staff only)
 */
const verifyPickup = async (req, res, next) => {
  try {
    const { deliveryId } = req.params;
    const { pickup_id, otp } = req.body;
    const userId = req.user.id;

    if (!pickup_id || !otp) {
      return res.status(400).json({
        success: false,
        message: "Pickup ID and OTP are required",
      });
    }

    const delivery = await deliveryService.verifyPickupWithOTP(
      deliveryId,
      pickup_id,
      otp,
      userId,
    );

    res.status(200).json({
      success: true,
      message: "Pickup verified successfully",
      data: {
        delivery_id: delivery.id,
        order_id: delivery.order_id,
        pickup_verified_by: delivery.pickup_verified_by,
        pickup_verified_at: delivery.pickup_verified_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/delivery/:deliveryId/track
 * Add tracking event (Admin/Staff only)
 */
const addTrackingEvent = async (req, res, next) => {
  try {
    const { deliveryId } = req.params;
    const {
      event_type,
      event_description,
      event_location,
      event_latitude,
      event_longitude,
      event_data,
    } = req.body;
    const userId = req.user.id;

    if (!event_type) {
      return res.status(400).json({
        success: false,
        message: "Event type is required",
      });
    }

    const validEventTypes = [
      "PICKUP",
      "IN_TRANSIT",
      "ARRIVED",
      "DELIVERED",
      "FAILED",
      "CANCELLED",
    ];
    if (!validEventTypes.includes(event_type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid event type. Must be one of: ${validEventTypes.join(", ")}`,
      });
    }

    const event = await deliveryModel.addDeliveryTrackingEvent({
      deliveryId,
      eventType: event_type,
      eventDescription: event_description || null,
      eventLocation: event_location || null,
      eventLatitude: event_latitude || null,
      eventLongitude: event_longitude || null,
      eventData: event_data || {},
      createdBy: userId,
    });

    res.status(201).json({
      success: true,
      message: "Tracking event added successfully",
      data: event,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/delivery/:deliveryId/tracking
 * Get delivery tracking events
 */
const getTrackingEvents = async (req, res, next) => {
  try {
    const { deliveryId } = req.params;
    const { limit = 50 } = req.query;

    const events = await deliveryModel.getDeliveryTrackingEvents(
      deliveryId,
      parseInt(limit),
    );

    res.status(200).json({
      success: true,
      message: "Tracking events fetched successfully",
      data: events,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/deliveries/:deliveryId/status
 * Update delivery status (Admin/Staff only)
 */
const updateDeliveryStatus = async (req, res, next) => {
  try {
    const { deliveryId } = req.params;
    const { status, metadata } = req.body;
    const userId = req.user.id;

    const validStatuses = [
      "PROCESSING",
      "DISPATCHED",
      "IN_TRANSIT",
      "DELIVERED",
      "CANCELLED",
      "FAILED",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const delivery = await deliveryService.updateDeliveryStatusWithTracking(
      deliveryId,
      status,
      metadata || {},
      userId,
    );

    res.status(200).json({
      success: true,
      message: "Delivery status updated successfully",
      data: delivery,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/deliveries/:deliveryId/assign
 * Assign staff to delivery (Admin only)
 */
const assignStaffToDelivery = async (req, res, next) => {
  try {
    const { deliveryId } = req.params;
    const { staff_id } = req.body;
    const userId = req.user.id;

    if (!staff_id) {
      return res.status(400).json({
        success: false,
        message: "Staff ID is required",
      });
    }

    const delivery = await deliveryService.assignStaffToDelivery(
      deliveryId,
      staff_id,
      userId,
    );

    res.status(200).json({
      success: true,
      message: "Staff assigned to delivery successfully",
      data: delivery,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/deliveries
 * Get all deliveries with filters (Admin/Staff only)
 */
const getAllDeliveries = async (req, res, next) => {
  try {
    const {
      delivery_status,
      delivery_method_id,
      user_id,
      start_date,
      end_date,
      limit = 50,
      offset = 0,
    } = req.query;

    const deliveries = await deliveryModel.getAllDeliveries(
      {
        delivery_status,
        delivery_method_id,
        user_id,
        start_date,
        end_date,
      },
      parseInt(limit),
      parseInt(offset),
    );

    res.status(200).json({
      success: true,
      message: "Deliveries fetched successfully",
      data: deliveries,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: deliveries.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDeliveryMethods,
  calculateDeliveryCharges,
  getDeliveryDetails,
  getDeliveryByPickupId,
  verifyPickup,
  addTrackingEvent,
  getTrackingEvents,
  updateDeliveryStatus,
  assignStaffToDelivery,
  getAllDeliveries,
};
