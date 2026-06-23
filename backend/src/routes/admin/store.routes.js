const express = require("express");
const {
  createStoreHandler,
  getAllStoresHandler,
  updateStoreHandler,
  getStoreOperatingHoursHandler,
  isStoreOpenHandler,
} = require("../../controllers/admin/store.controller");
const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");
const upload = require("../../middlewares/upload.middleware");

const router = express.Router();

// ============= PUBLIC ROUTES =============

// GET /api/store/operating-hours - Get store operating hours
router.get("/operating-hours", getStoreOperatingHoursHandler);

// GET /api/store/is-open - Check if store is open
router.get("/is-open", isStoreOpenHandler);

// ============= ADMIN ROUTES =============
// All routes below require ADMIN role only

// GET /api/store - Get all stores
router.get("/", authenticateToken, requireRole(["ADMIN"]), getAllStoresHandler);

// POST /api/store/image - Create store with image upload
router.post(
  "/image",
  authenticateToken,
  requireRole(["ADMIN"]),
  upload.single("store_image"),
  createStoreHandler,
);

// PUT /api/store/:id - Update store with image upload
router.put(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN"]),
  upload.single("store_image"),
  updateStoreHandler,
);

module.exports = router;
