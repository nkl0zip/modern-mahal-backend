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
    let total_manual_discount = 0;
    let total_coupon_discount = 0;

    let coupon = null;

    if (cart.applied_coupon_id) {
      const { rows } = await client.query(
        `SELECT * FROM discounts WHERE id = $1 AND type = 'COUPON' AND is_active = true AND expires_at > NOW()`,
        [cart.applied_coupon_id],
      );
      coupon = rows[0] || null;
    }

    for (const item of items) {
      const base_total =
        Number(item.unit_price_snapshot) * Number(item.quantity);

      total_original += base_total;

      let manual_total = 0;
      let coupon_total = 0;

      if (coupon) {
        const eligible = await isVariantEligibleForCoupon(
          item.variant_id,
          coupon.id,
          client,
        );

        if (eligible) {
          const coupon_per_unit = calculateCouponPerUnit(
            Number(item.unit_price_snapshot),
            coupon,
          );

          coupon_total = coupon_per_unit * item.quantity;

          await client.query(
            `
            UPDATE cart_items
            SET coupon_discount_amount = $1
            WHERE id = $2
          `,
            [coupon_per_unit, item.id],
          );
        } else {
          await client.query(
            `
            UPDATE cart_items
            SET coupon_discount_amount = 0
            WHERE id = $1
          `,
            [item.id],
          );
        }
      } else {
        await client.query(
          `
          UPDATE cart_items
          SET coupon_discount_amount = 0
          WHERE id = $1
        `,
          [item.id],
        );
      }

      manual_total =
        Number(item.manual_discount_amount || 0) * Number(item.quantity);

      if (coupon) {
        total_coupon_discount += coupon_total;
      } else {
        total_manual_discount += manual_total;
      }
    }

    const final_total =
      total_original - total_manual_discount - total_coupon_discount;

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
      total_manual_discount,
      total_coupon_discount,
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
 */
const applyCartPricingLogic = async ({ items, coupon = null, user_id }) => {
  if (!items || !items.length) {
    return {
      items: [],
      total_original_cost: 0,
      total_discount_amount: 0,
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
        // Flat distributed proportionally per item
        // (you can later optimize for proportional distribution)
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

    total_discount_amount += itemDiscount;

    return {
      ...item,
      original_subtotal: originalSubtotal,
      discount_amount: itemDiscount,
      discount_source: discountSource,
      final_subtotal: finalSubtotal,
    };
  });

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
    final_total: total_original_cost - total_discount_amount,
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
