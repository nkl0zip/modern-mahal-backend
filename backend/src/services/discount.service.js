/**
 * Apply template-level manual discounts to template items
 */
const applyTemplateDiscounts = (items, discounts) => {
  if (!discounts.length) {
    const updatedItems = items.map((item) => {
      const unitPrice = Number(item.current_mrp);
      const quantity = Number(item.quantity);

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

  const discount = discounts[0];
  const discountSegmentIds = new Set(discount.segments.map((s) => s.id));

  const updatedItems = items.map((item) => {
    const unitPrice = Number(item.current_mrp);
    const quantity = Number(item.quantity);

    const itemSegmentIds = item.segments.map((s) => s.id);

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

    const discountAmountPerUnit = (unitPrice * Number(discount.value)) / 100;

    const discountedUnitPrice = unitPrice - discountAmountPerUnit;

    return {
      ...item,
      original_unit_price: unitPrice.toFixed(2),
      original_total_price: (unitPrice * quantity).toFixed(2),
      discounted_mrp: discountedUnitPrice.toFixed(2),
      discounted_total_price: (discountedUnitPrice * quantity).toFixed(2),
      discount_percentage: discount.value,
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
        segments: discount.segments,
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
