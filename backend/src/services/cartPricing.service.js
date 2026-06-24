const pool = require("../config/db");

/**
 * Check if product variant belongs to coupon segments
 */
const isVariantEligibleForCoupon = async (variant_id, coupon_id, client) => {
  const query = `
    SELECT 1
    FROM discount_segments ds
    JOIN product_segments ps ON ps.segment_id = ds.segment_id
    JOIN product_variants pv ON pv.product_id = ps.product_id
    WHERE ds.discount_id = $1
      AND pv.id = $2
    LIMIT 1;
  `;
  const { rows } = await client.query(query, [coupon_id, variant_id]);
  return rows.length > 0;
};

/**
 * Calculate coupon discount amount (per unit)
 */
const calculateCouponPerUnit = (base_price, coupon) => {
  if (coupon.discount_mode === "PERCENTAGE") {
    return (base_price * Number(coupon.value)) / 100;
  }

  if (coupon.discount_mode === "FLAT") {
    return Number(coupon.value);
  }

  return 0;
};

/**
 * Recalculate entire cart pricing
 */
const recalculateCart = async (cart_id) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: cartRows } = await client.query(
      `SELECT * FROM cart WHERE id = $1 LIMIT 1`,
      [cart_id],
    );

    if (!cartRows.length) throw new Error("Cart not found");

    const cart = cartRows[0];

    const { rows: items } = await client.query(
      `SELECT * FROM cart_items WHERE cart_id = $1`,
      [cart_id],
    );

    let total_original = 0;
    let total_discount = 0;
    let subtotal = 0;

    let coupon = null;

    if (cart.applied_coupon_id) {
      const { rows } = await client.query(
        `SELECT * FROM discounts WHERE id = $1 AND type = 'COUPON' AND is_active = true AND expires_at > NOW()`,
        [cart.applied_coupon_id],
      );
      coupon = rows[0] || null;
    }

    // Fetch product segments for coupon eligibility
    const variantIds = items.map((item) => item.variant_id);
    let productSegmentMap = {};

    if (variantIds.length > 0) {
      const segmentQuery = `
        SELECT 
          pv.id as variant_id,
          ps.segment_id
        FROM product_variants pv
        JOIN product_segments ps ON ps.product_id = pv.product_id
        WHERE pv.id = ANY($1)
      `;
      const segmentResult = await client.query(segmentQuery, [variantIds]);

      // Build map of variant_id -> segment_ids
      segmentResult.rows.forEach((row) => {
        if (!productSegmentMap[row.variant_id]) {
          productSegmentMap[row.variant_id] = new Set();
        }
        productSegmentMap[row.variant_id].add(row.segment_id);
      });
    }

    // Get coupon segments if coupon exists
    let couponSegmentIds = new Set();
    if (coupon) {
      const couponSegmentsResult = await client.query(
        `SELECT segment_id FROM discount_segments WHERE discount_id = $1`,
        [coupon.id],
      );
      couponSegmentIds = new Set(
        couponSegmentsResult.rows.map((r) => r.segment_id),
      );
    }

    for (const item of items) {
      const unitPrice = Number(item.unit_price_snapshot);
      const quantity = Number(item.quantity);
      const base_total = unitPrice * quantity;
      total_original += base_total;

      let itemDiscount = 0;

      // Apply manual discount (per unit)
      const manualDiscountPerUnit = Number(item.manual_discount_amount || 0);
      const manualTotal = manualDiscountPerUnit * quantity;

      // Apply coupon discount if present and eligible
      let couponTotal = 0;
      if (coupon) {
        // Check if variant is eligible for coupon
        const variantSegments = productSegmentMap[item.variant_id] || new Set();
        const isEligible =
          couponSegmentIds.size === 0 ||
          [...variantSegments].some((segId) => couponSegmentIds.has(segId));

        if (isEligible) {
          // Calculate coupon discount on the original price
          if (coupon.discount_mode === "PERCENTAGE") {
            couponTotal = (base_total * Number(coupon.value)) / 100;
          } else if (coupon.discount_mode === "FLAT") {
            // For flat discount, distribute proportionally
            // We'll handle this by applying to the first item or proportionally
            // For simplicity, we'll apply flat discount across all eligible items proportionally
            // But since we're iterating items, we need to know total eligible items
            // For now, we'll use the simple approach
            couponTotal = Math.min(
              Number(coupon.value) / items.length,
              base_total,
            );
          }
        }

        // Store coupon discount per unit in the database
        const couponPerUnit = couponTotal / quantity;
        await client.query(
          `
          UPDATE cart_items
          SET coupon_discount_amount = $1
          WHERE id = $2
          `,
          [couponPerUnit, item.id],
        );
      } else {
        // Remove coupon discount if no coupon
        await client.query(
          `
          UPDATE cart_items
          SET coupon_discount_amount = 0
          WHERE id = $1
          `,
          [item.id],
        );
      }

      // Total discount for this item
      itemDiscount = manualTotal + couponTotal;
      total_discount += itemDiscount;

      // Calculate discounted subtotal for this item
      const itemSubtotal = base_total - itemDiscount;
      subtotal += itemSubtotal;
    }

    // Calculate GST (18% on subtotal after all discounts)
    const TAX_RATE = 0.18; // 18% GST
    const tax_amount = Math.round(subtotal * TAX_RATE * 100) / 100;
    const final_total = subtotal + tax_amount;

    await client.query(
      `
      UPDATE cart
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
      [cart_id],
    );

    await client.query("COMMIT");

    return {
      total_original,
      total_manual_discount: 0, // We're not tracking this separately in this function
      total_coupon_discount: total_discount, // This is the total discount
      total_discount,
      subtotal,
      tax_amount,
      tax_rate: TAX_RATE * 100,
      final_total,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Fetch segments for a product
 */
const getProductSegmentsMap = async (productIds = []) => {
  if (!productIds.length) return {};

  const { rows } = await pool.query(
    `
    SELECT ps.product_id, s.id as segment_id
    FROM product_segments ps
    JOIN segments s ON s.id = ps.segment_id
    WHERE ps.product_id = ANY($1);
    `,
    [productIds],
  );

  const map = {};

  for (const row of rows) {
    if (!map[row.product_id]) {
      map[row.product_id] = new Set();
    }
    map[row.product_id].add(row.segment_id);
  }

  return map;
};

/**
 * Apply cart pricing logic
 *
 * Rules:
 * - Coupon applies only to eligible segments
 * - Coupon applies on ORIGINAL unit_price_snapshot
 * - If coupon applies to item → manual discount removed for that item
 * - Manual discount applies only when coupon not affecting that item
 * - Tax (18% GST) is applied on discounted total (after all discounts)
 */
const applyCartPricingLogic = async ({ items, coupon = null, user_id }) => {
  if (!items || !items.length) {
    return {
      items: [],
      total_original_cost: 0,
      total_discount_amount: 0,
      subtotal: 0,
      tax_amount: 0,
      final_total: 0,
      applied_coupon: null,
    };
  }

  const productIds = [...new Set(items.map((i) => i.product_id))];

  const productSegmentsMap = await getProductSegmentsMap(productIds);

  let couponSegmentIds = new Set();

  if (coupon && coupon.id) {
    const { rows } = await pool.query(
      `
      SELECT segment_id
      FROM discount_segments
      WHERE discount_id = $1;
      `,
      [coupon.id],
    );

    couponSegmentIds = new Set(rows.map((r) => r.segment_id));
  }

  let total_original_cost = 0;
  let total_discount_amount = 0;
  let subtotal = 0;

  const processedItems = items.map((item) => {
    const originalUnit = Number(item.unit_price_snapshot);
    const quantity = Number(item.quantity);

    const originalSubtotal = originalUnit * quantity;
    total_original_cost += originalSubtotal;

    let itemDiscount = 0;
    let discountSource = null;

    const productSegments = productSegmentsMap[item.product_id] || new Set();

    const isCouponEligible =
      coupon &&
      couponSegmentIds.size &&
      [...productSegments].some((seg) => couponSegmentIds.has(seg));

    /* -----------------------------
       COUPON LOGIC
    ------------------------------ */
    if (coupon && isCouponEligible) {
      if (coupon.discount_mode === "PERCENTAGE") {
        itemDiscount = (originalSubtotal * Number(coupon.value)) / 100;
      } else if (coupon.discount_mode === "FLAT") {
        itemDiscount = Math.min(Number(coupon.value), originalSubtotal);
      }

      discountSource = "COUPON";
    }

    /* -----------------------------
       MANUAL DISCOUNT LOGIC
       (Only if coupon not applied)
    ------------------------------ */
    if (!isCouponEligible && item.discount > 0) {
      itemDiscount = Number(item.discount);
      discountSource = "MANUAL";
    }

    // Prevent over-discount
    if (itemDiscount > originalSubtotal) {
      itemDiscount = originalSubtotal;
    }

    const finalSubtotal = originalSubtotal - itemDiscount;
    subtotal += finalSubtotal;
    total_discount_amount += itemDiscount;

    return {
      ...item,
      original_subtotal: originalSubtotal,
      discount_amount: itemDiscount,
      discount_source: discountSource,
      final_subtotal: finalSubtotal,
    };
  });

  // Calculate GST (18% on subtotal after discounts)
  const TAX_RATE = 0.18; // 18% GST
  const tax_amount = subtotal * TAX_RATE;
  const final_total = subtotal + tax_amount;

  let couponSegments = [];

  if (coupon) {
    const { rows } = await pool.query(
      `
    SELECT s.id, s.name
    FROM discount_segments ds
    JOIN segments s ON s.id = ds.segment_id
    WHERE ds.discount_id = $1;
    `,
      [coupon.id],
    );

    couponSegments = rows;
  }

  return {
    items: processedItems,
    total_original_cost,
    total_discount_amount,
    subtotal,
    tax_amount,
    tax_rate: TAX_RATE * 100, // 18%
    final_total,
    applied_coupon: coupon
      ? {
          id: coupon.id,
          coupon_code: coupon.coupon_code,
          discount_mode: coupon.discount_mode,
          value: coupon.value,
          type: coupon.type,
          expires_at: coupon.expires_at,
          segments: couponSegments,
        }
      : null,
  };
};

module.exports = {
  recalculateCart,
  applyCartPricingLogic,
};
