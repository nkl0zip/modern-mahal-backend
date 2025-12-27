const express = require("express");
const {
  updateVariantStatusHandler,
  getProductVariantsHandler,
  updateVariantHandler,
  softDeleteVariantHandler,
  hardDeleteVariantHandler,
  getVariantDetailsHandler,
} = require("../../controllers/staff/productVariant.controller");

const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");

const router = express.Router();

/**
 * ADMIN / STAFF
 * Get all variants of a product
 * GET: /api/products/variant/:product_id
 */
router.get("/:product_id", getProductVariantsHandler);

/**
 * ADMIN / STAFF
 * Get variant with full details
 * GET: /api/products/variant/:variant_id/details
 */
router.get("/:variant_id/details", getVariantDetailsHandler);

/**
 * ADMIN / STAFF
 * Update variant status
 *  PATCH: /api/products/variant/:variant_id/status
 */
router.patch("/:variant_id/status", updateVariantStatusHandler);

/**
 * ADMIN / STAFF
 * Update variant details
 * PUT: /api/products/variant/:variant_id
 */
router.put("/:variant_id", updateVariantHandler);

/**
 * ADMIN / STAFF
 * Soft delete variant (mark as DISCONTINUED)
 * PATCH: /api/products/variant/:variant_id/soft-delete
 */
router.patch("/:variant_id/soft-delete", softDeleteVariantHandler);

/**
 * ADMIN ONLY
 * Hard delete variant (permanent)
 * DELETE: /api/products/variant/:variant_id
 */
router.delete(
  "/:variant_id",
  authenticateToken,
  requireRole("ADMIN"),
  hardDeleteVariantHandler
);

module.exports = router;
