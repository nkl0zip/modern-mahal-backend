const express = require("express");
const {
  updateVariantStatusHandler,
  getProductVariantsHandler,
} = require("../../controllers/staff/productVariant.controller");

const router = express.Router();

/**
 * ADMIN / STAFF
 * Get all variants of a product
 * GET: /api/products/variant/:product_id
 */
router.get("/:product_id", getProductVariantsHandler);

/**
 * ADMIN / STAFF
 * Update variant status
 *  PATCH: /api/products/variant/:variant_id/status
 */
router.patch("/:variant_id/status", updateVariantStatusHandler);

module.exports = router;
