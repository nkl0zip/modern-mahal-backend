const express = require("express");
const router = express.Router();
const {
  createBrandHandler,
  getAllBrandsHandler,
  deleteBrandHandler,
  updateBrandHandler,
} = require("../../controllers/admin/brand.controller");

// POST /api/brand
// Allowed route for both ADMIN and STAFF
router.post("/", createBrandHandler);

// GET /api/brand
// Allowed for all Roles
router.get("/", getAllBrandsHandler);

// DELETE /api/brand/:id
// Allowed only for ADMIN
router.delete("/:id", deleteBrandHandler);

// PATCH /api/brand/:id
// Allowed by STAFF & ADMIN
router.patch("/:id", updateBrandHandler);

module.exports = router;
