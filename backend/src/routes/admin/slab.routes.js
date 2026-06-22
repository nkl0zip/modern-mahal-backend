const express = require("express");
const {
  getAllSlabsHandler,
  getSlabByIdHandler,
  updateSlabHandler,
  getDefaultSlabHandler,
  getUserPayLaterLimitHandler,
  getSlabAuditLogsHandler,
  assignUserSlabHandler,
} = require("../../controllers/admin/slab.controller");
const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");

const router = express.Router();

// ============= PUBLIC ROUTES =============
// GET /api/slabs/default - Get default slab (anyone)
router.get("/default", getDefaultSlabHandler);

// ============= AUTHENTICATED USER ROUTES =============
// GET /api/slabs/user/pay-later-limit - Get user's pay later limit
router.get(
  "/user/pay-later-limit",
  authenticateToken,
  getUserPayLaterLimitHandler,
);

// POST /api/slabs/assign/user
// Only for ADMIN/SUB_ADMIN/STAFF
router.post(
  "/assign/user",
  authenticateToken,
  requireRole(["STAFF", "ADMIN", "SUB_ADMIN"]),
  assignUserSlabHandler,
);

// GET /api/slabs
// Only for ADMIN/SUB_ADMIN/STAFF
router.get(
  "/",
  authenticateToken,
  requireRole(["STAFF", "ADMIN", "SUB_ADMIN"]),
  getAllSlabsHandler,
);

// ============= ADMIN/SUB-ADMIN ROUTES =============
// All routes below require ADMIN or SUB_ADMIN role
router.use(authenticateToken, requireRole(["ADMIN", "SUB_ADMIN"]));

// GET /api/slabs/audit-logs - Get audit logs
router.get("/audit-logs", getSlabAuditLogsHandler);

// GET /api/slabs/:id - Get slab by ID
router.get("/:id", getSlabByIdHandler);

// PUT /api/slabs/:id - Update slab
router.put("/:id", updateSlabHandler);

module.exports = router;
