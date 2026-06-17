const express = require("express");
const router = express.Router();
const {
  createBrandHandler,
  getAllBrandsHandler,
  deleteBrandHandler,
  updateBrandHandler,
  getBrandByIdHandler,
} = require("../../controllers/admin/brand.controller");

const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");

// POST /api/brand
// Allowed route for both ADMIN and STAFF
router.post(
  "/",
  authenticateToken,
  requireRole(["ADMIN", "SUB_ADMIN", "STAFF"]),
  createBrandHandler,
);

// GET /api/brand
// Allowed for all Roles
router.get("/", getAllBrandsHandler);

// GET /api/brand/:id
// Allowed for all Roles - Get single brand by ID
router.get("/:id", getBrandByIdHandler);

// DELETE /api/brand/:id
// Allowed only for ADMIN
router.delete(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN", "SUB_ADMIN", "STAFF"]),
  deleteBrandHandler,
);

// PATCH /api/brand/:id
// Allowed by STAFF & ADMIN
router.patch(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN", "SUB_ADMIN", "STAFF"]),
  updateBrandHandler,
);

module.exports = router;
