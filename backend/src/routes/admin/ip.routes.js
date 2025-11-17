const express = require("express");
const router = express.Router();
const ipCtrl = require("../../controllers/admin/ip.controller");
const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");

/**
 *  All Admin-Only Routes
 * */
router.use(authenticateToken);
router.use(requireRole("ADMIN"));

/**
 * Office IP management
 * */

// To add authorised IPs to the DB
// POST: /api/admin/ips/office
router.post("/office", ipCtrl.addOfficeIpHandler);

// To list Authorised IPs for Staff Login
// GET: /api/admin/ips/office
router.get("/office", ipCtrl.listOfficeIpsHandler);

// To delete Authorised IP for staff Login
// DELETE: /api/admin/ips/office/:id
router.delete("/office/:id", ipCtrl.deleteOfficeIpHandler);

/**
 *
 *
 * Staff IP request admin actions
 */

// List pending requests of IPs from STAFF
// GET: /api/admin/ips/requests/pending
router.get("/requests/pending", ipCtrl.listPendingRequestsHandler);

// Approve STAFF IP requests by ADMIN
// POST: /api/admin/ips/requests/:id/approve
router.post("/requests/:id/approve", ipCtrl.approveRequestHandler);

// Reject STAFF IP requests by ADMIN
// POST: /api/admin/ips/requests/:id/reject
router.post("/requests/:id/reject", ipCtrl.rejectRequestHandler);

/**
 *
 *
 *
 * STAFF-specific access
 */

// List approved IPs of a STAFF
// GET: /api/admin/ips/staff-access/:staff_id?
router.get("/staff-access/:staff_id", ipCtrl.listStaffAccessHandler);

// Remove approved IP of a Staff
// DELETE: /api/admin/ips/staff-access/:id
router.delete("/staff-access/:id", ipCtrl.removeStaffAccessHandler);

module.exports = router;
