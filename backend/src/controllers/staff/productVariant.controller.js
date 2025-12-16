const {
  getVariantById,
  updateVariantStatus,
  getVariantsByProduct,
} = require("../../models/staff/productVariant.model");

/**
 * PATCH /api/products/variants/:variant_id/status
 * ADMIN / STAFF
 */
const updateVariantStatusHandler = async (req, res, next) => {
  try {
    const { variant_id } = req.params;
    const { status } = req.body;

    if (!variant_id)
      return res.status(400).json({ message: "variant_id is required" });

    if (!status) return res.status(400).json({ message: "status is required" });

    const allowedStatuses = [
      "ACTIVE",
      "INACTIVE",
      "OUT_OF_STOCK",
      "DISCONTINUED",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Allowed values: ${allowedStatuses.join(
          ", "
        )}`,
      });
    }

    const variant = await getVariantById(variant_id);
    if (!variant) {
      return res.status(404).json({ message: "Product variant not found" });
    }

    const updated = await updateVariantStatus({ variant_id, status });

    return res.status(200).json({
      message: "Variant status updated successfully",
      variant: updated,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/products/:product_id/variants
 * ADMIN / STAFF
 */
const getProductVariantsHandler = async (req, res, next) => {
  try {
    const { product_id } = req.params;

    if (!product_id)
      return res.status(400).json({ message: "product_id is required" });

    const variants = await getVariantsByProduct(product_id);

    return res.status(200).json({
      message: "Product variants fetched",
      variants,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  updateVariantStatusHandler,
  getProductVariantsHandler,
};
