const express = require("express");
const router = express.Router();

const {
  createCouponDiscountHandler,
  createManualDiscountHandler,
  listCouponDiscountsHandler,
  listManualDiscountsHandler,
  toggleDiscountHandler,
  updateCouponDiscountHandler,
  listActivitiesHandler,
  deleteCouponDiscountHandler,
  deleteManualDiscountHandler,
  applyCouponHandler,
  removeCouponHandler,
} = require("../../controllers/staff/discount.controller");

const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");

/**
 * ADMIN/STAFF routes
 */
// To create a coupon discount
// POST: /api/discount/coupon
router.post(
  "/coupon",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  createCouponDiscountHandler,
);

// To create a manual discount
// POST: /api/discount/manual
router.post(
  "/manual",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  createManualDiscountHandler,
);

/**
 * Listing Coupons by ADMIN/STAFF
 * GET: /api/discount/coupons
 */
router.get(
  "/coupons",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  listCouponDiscountsHandler,
);

/**
 * Listing Manual Discounts by ADMIN/STAFF
 * GET: /api/discount/manual
 */
router.get(
  "/manual",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  listManualDiscountsHandler,
);

/**
 * Toggle a Discount as ACTIVE | INACTIVE by ADMIN/STAFF
 * PATCH: /api/discount/:discount_id/status
 */
router.patch(
  "/:discount_id/status",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  toggleDiscountHandler,
);

/**
 * Update a Discount by ADMIN/STAFF
 * PATCH: /api/discount/coupon/:discount_id
 */
router.patch(
  "/coupon/:discount_id",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  updateCouponDiscountHandler,
);

/**
 * List all Activity Logs (ADMIN ONLY)
 * GET: /api/discount/activities
 */
router.get(
  "/activities",
  authenticateToken,
  requireRole("ADMIN"),
  listActivitiesHandler,
);

/**
 * Delete Coupon Discount by ADMIN
 * DELETE: /api/discount/coupon/:discount_id
 */
router.delete(
  "/coupon/:discount_id",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  deleteCouponDiscountHandler,
);

/**
 * Delete Manual Discount by ADMIN/STAFF
 * DELETE: /api/discount/manual/:discount_id
 */
router.delete(
  "/manual/:discount_id",
  authenticateToken,
  requireRole(["ADMIN", "STAFF"]),
  deleteManualDiscountHandler,
);

/**
 * Apply Coupon to Cart
 * POST: /api/discount/apply-coupon
 */
router.post("/apply-coupon", authenticateToken, applyCouponHandler);

/**
 * Remove Coupon from Cart
 * POST: /api/discount/remove-coupon
 */
router.post("/remove-coupon", authenticateToken, removeCouponHandler);

module.exports = router;
