/**
 * Apply template-level manual discounts to template items
 */
const applyTemplateDiscounts = (items = [], discounts = []) => {
  if (!Array.isArray(items)) items = [];
  if (!Array.isArray(discounts)) discounts = [];

  if (!discounts.length) {
    const updatedItems = items.map((item) => {
      const unitPrice = Number(item.current_mrp || 0);
      const quantity = Number(item.quantity || 0);

      return {
        ...item,
        original_unit_price: unitPrice.toFixed(2),
        original_total_price: (unitPrice * quantity).toFixed(2),
        discounted_mrp: unitPrice.toFixed(2),
        discounted_total_price: (unitPrice * quantity).toFixed(2),
        discount_percentage: 0,
        discount_amount: "0.00",
        total_discount_amount: "0.00",
      };
    });

    return {
      items: updatedItems,
      applied_discounts: [],
    };
  }

  const discount = discounts[0] || null;

  if (!discount) {
    return {
      items,
      applied_discounts: [],
    };
  }

  /* 🔥 SAFETY FIX */
  const discountSegments = Array.isArray(discount.segments)
    ? discount.segments
    : [];

  const discountSegmentIds = new Set(discountSegments.map((s) => s.id));

  const updatedItems = items.map((item) => {
    const unitPrice = Number(item.current_mrp || 0);
    const quantity = Number(item.quantity || 0);

    /* 🔥 SAFETY FIX */
    const itemSegments = Array.isArray(item.segments) ? item.segments : [];

    const itemSegmentIds = itemSegments.map((s) => s.id);

    const isApplicable =
      discountSegmentIds.size === 0 ||
      itemSegmentIds.some((sid) => discountSegmentIds.has(sid));

    if (!isApplicable) {
      return {
        ...item,
        original_unit_price: unitPrice.toFixed(2),
        original_total_price: (unitPrice * quantity).toFixed(2),
        discounted_mrp: unitPrice.toFixed(2),
        discounted_total_price: (unitPrice * quantity).toFixed(2),
        discount_percentage: 0,
        discount_amount: "0.00",
        total_discount_amount: "0.00",
      };
    }

    let discountAmountPerUnit = 0;

    if (discount.discount_mode === "PERCENTAGE") {
      discountAmountPerUnit = (unitPrice * Number(discount.value || 0)) / 100;
    } else if (discount.discount_mode === "FLAT") {
      discountAmountPerUnit = Number(discount.value || 0);
    }

    const discountedUnitPrice = Math.max(unitPrice - discountAmountPerUnit, 0);

    return {
      ...item,
      original_unit_price: unitPrice.toFixed(2),
      original_total_price: (unitPrice * quantity).toFixed(2),
      discounted_mrp: discountedUnitPrice.toFixed(2),
      discounted_total_price: (discountedUnitPrice * quantity).toFixed(2),
      discount_percentage:
        discount.discount_mode === "PERCENTAGE" ? discount.value : 0,
      discount_amount: discountAmountPerUnit.toFixed(2),
      total_discount_amount: (discountAmountPerUnit * quantity).toFixed(2),
    };
  });

  return {
    items: updatedItems,
    applied_discounts: [
      {
        id: discount.id,
        value: discount.value,
        discount_mode: discount.discount_mode,
        expires_at: discount.expires_at,
        segments: discountSegments,
      },
    ],
  };
};

const calculateTemplateTotals = (items) => {
  let originalTotal = 0;
  let discountedTotal = 0;

  for (const item of items) {
    if (item.status === "CANCELLED") continue;

    originalTotal += Number(item.original_total_price);
    discountedTotal += Number(item.discounted_total_price);
  }

  return {
    total_original_cost: originalTotal.toFixed(2),
    total_cost: discountedTotal.toFixed(2),
    total_discount_amount: (originalTotal - discountedTotal).toFixed(2),
  };
};

module.exports = { applyTemplateDiscounts, calculateTemplateTotals };
