// routes/delivery.routes.js
const express = require("express");
const {
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
} = require("../controllers/delivery.controller");
const {
  authenticateToken,
  requireRole,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// ============= PUBLIC ROUTES =============
// GET /api/delivery/methods - Get all delivery methods
router.get("/methods", getDeliveryMethods);

// POST /api/delivery/calculate - Calculate delivery charges
router.post("/calculate", authenticateToken, calculateDeliveryCharges);

// GET /api/delivery/pickup/:pickupId - Get delivery by pickup ID (public for OTP verification)
router.get("/pickup/:pickupId", getDeliveryByPickupId);

// ============= AUTHENTICATED USER ROUTES =============
// GET /api/delivery/:deliveryId - Get delivery details
router.get("/:deliveryId", authenticateToken, getDeliveryDetails);

// GET /api/delivery/:deliveryId/tracking - Get tracking events
router.get("/:deliveryId/tracking", authenticateToken, getTrackingEvents);

// ============= ADMIN/SUB-ADMIN/STAFF ROUTES =============
// POST /api/delivery/:deliveryId/pickup/verify - Verify pickup
router.post(
  "/:deliveryId/pickup/verify",
  authenticateToken,
  requireRole(["STAFF", "ADMIN", "SUB_ADMIN"]),
  verifyPickup,
);

// POST /api/delivery/:deliveryId/track - Add tracking event
router.post(
  "/:deliveryId/track",
  authenticateToken,
  requireRole(["STAFF", "ADMIN", "SUB_ADMIN"]),
  addTrackingEvent,
);

// PUT /api/delivery/:deliveryId/status - Update delivery status
router.put(
  "/:deliveryId/status",
  authenticateToken,
  requireRole(["STAFF", "ADMIN", "SUB_ADMIN"]),
  updateDeliveryStatus,
);

// ============= ADMIN/SUB-ADMIN ROUTES =============
// GET /api/delivery/admin/all - Get all deliveries
router.get(
  "/admin/all",
  authenticateToken,
  requireRole(["ADMIN", "SUB_ADMIN"]),
  getAllDeliveries,
);

// PUT /api/delivery/admin/:deliveryId/assign - Assign staff
router.put(
  "/admin/:deliveryId/assign",
  authenticateToken,
  requireRole(["ADMIN", "SUB_ADMIN"]),
  assignStaffToDelivery,
);

module.exports = router;
