const pool = require("../config/db");
const {
  getValidCouponByCode,
  getUserManualDiscounts,
} = require("../models/staff/discount.model");

/**
 * Utility: apply discount value
 */
const applyDiscountValue = (price, discount) => {
  if (discount.discount_mode === "PERCENTAGE") {
    return Math.max(0, price - price * (Number(discount.value) / 100));
  }

  if (discount.discount_mode === "FIXED") {
    return Math.max(0, price - Number(discount.value));
  }

  return price;
};

/**
 * Check if discount applies to product segments
 * Rule:
 * - If discount has NO segment mappings -> applies to ALL
 * - Else product must intersect at least one segment
 */
const isDiscountApplicableToProduct = async (discountId, productId) => {
  // Fetch discount segments
  const discountSegmentsQuery = `
    SELECT segment_id
    FROM discount_segments
    WHERE discount_id = $1;
  `;

  const productSegmentsQuery = `
    SELECT segment_id
    FROM product_segments
    WHERE product_id = $1;
  `;

  const [{ rows: discountSegments }, { rows: productSegments }] =
    await Promise.all([
      pool.query(discountSegmentsQuery, [discountId]),
      pool.query(productSegmentsQuery, [productId]),
    ]);

  // No segment restriction → global discount
  if (discountSegments.length === 0) return true;

  const discountSegmentIds = new Set(discountSegments.map((s) => s.segment_id));

  return productSegments.some((ps) => discountSegmentIds.has(ps.segment_id));
};

/**
 * Resolve best discount for a product
 *
 * Priority:
 * 1. MANUAL (user-specific)
 * 2. COUPON
 * 3. No Discount
 */
const resolveProductDiscount = async ({
  productId,
  basePrice,
  userId = null,
  couponCode = null,
}) => {
  let appliedDiscount = null;
  let finalPrice = basePrice;

  /**
   * Try MANUAL discounts (user-scoped)
   */
  if (userId) {
    const manualDiscounts = await getUserManualDiscounts(userId);

    for (const discount of manualDiscounts) {
      const applicable = await isDiscountApplicableToProduct(
        discount.id,
        productId,
      );

      if (applicable) {
        finalPrice = applyDiscountValue(basePrice, discount);
        appliedDiscount = {
          source: "MANUAL",
          discount_id: discount.id,
          discount_mode: discount.discount_mode,
          value: discount.value,
        };
        return {
          base_price: basePrice,
          final_price: finalPrice,
          applied_discount: appliedDiscount,
        };
      }
    }
  }

  /**
   * Try Coupon Discount
   */
  if (couponCode) {
    const coupon = await getValidCouponByCode(couponCode);

    if (coupon) {
      const applicable = await isDiscountApplicableToProduct(
        coupon.id,
        productId,
      );

      if (applicable) {
        finalPrice = applyDiscountValue(basePrice, coupon);
        appliedDiscount = {
          source: "COUPON",
          discount_id: coupon.id,
          coupon_code: coupon.coupon_code,
          discount_mode: coupon.discount_mode,
          value: coupon.value,
        };
      }
    }
  }

  // Return resolved pricing
  return {
    base_price: basePrice,
    final_price: finalPrice,
    applied_discount: appliedDiscount, // null if none
  };
};

module.exports = {
  resolveProductDiscount,
};
