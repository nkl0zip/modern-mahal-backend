const {
  getVariantById,
  updateVariantStatus,
  getVariantsByProduct,
  updateVariantDetails,
  softDeleteVariant,
  hardDeleteVariant,
  getVariantWithDetails,
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

/**
 * PUT /api/products/variants/:variant_id
 * ADMIN / STAFF - Update variant details
 */
const updateVariantHandler = async (req, res, next) => {
  try {
    const { variant_id } = req.params;
    const {
      colour_id,
      finish_id,
      mrp,
      alloy,
      weight_capacity,
      usability,
      in_box_content,
      tags,
      status,
    } = req.body;

    if (!variant_id)
      return res.status(400).json({ message: "variant_id is required" });

    // Validate variant exists
    const variant = await getVariantById(variant_id);
    if (!variant) {
      return res.status(404).json({ message: "Product variant not found" });
    }

    // Validate MRP if provided
    if (mrp !== undefined && (isNaN(mrp) || mrp < 0)) {
      return res.status(400).json({ message: "MRP must be a positive number" });
    }

    // Validate status if provided
    if (status) {
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
    }

    // Prepare update data
    const updateData = {};
    if (colour_id !== undefined) updateData.colour_id = colour_id;
    if (finish_id !== undefined) updateData.finish_id = finish_id;
    if (mrp !== undefined) updateData.mrp = parseFloat(mrp);
    if (alloy !== undefined) updateData.alloy = alloy;
    if (weight_capacity !== undefined)
      updateData.weight_capacity = weight_capacity;
    if (usability !== undefined) updateData.usability = usability;
    if (in_box_content !== undefined)
      updateData.in_box_content = in_box_content;
    if (tags !== undefined) updateData.tags = tags;
    if (status !== undefined) updateData.status = status;

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No fields provided for update" });
    }

    const updatedVariant = await updateVariantDetails(variant_id, updateData);

    return res.status(200).json({
      message: "Variant updated successfully",
      variant: updatedVariant,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/products/variants/:variant_id/soft-delete
 * ADMIN / STAFF - Soft delete variant (set to DISCONTINUED)
 */
const softDeleteVariantHandler = async (req, res, next) => {
  try {
    const { variant_id } = req.params;

    if (!variant_id)
      return res.status(400).json({ message: "variant_id is required" });

    // Validate variant exists
    const variant = await getVariantById(variant_id);
    if (!variant) {
      return res.status(404).json({ message: "Product variant not found" });
    }

    // Check if already discontinued
    if (variant.status === "DISCONTINUED") {
      return res.status(400).json({
        message: "Variant is already marked as DISCONTINUED",
        variant,
      });
    }

    const deletedVariant = await softDeleteVariant(variant_id);

    return res.status(200).json({
      message: "Variant soft deleted (marked as DISCONTINUED) successfully",
      variant: deletedVariant,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/products/variants/:variant_id
 * ADMIN only - Hard delete variant
 */
const hardDeleteVariantHandler = async (req, res, next) => {
  try {
    const { variant_id } = req.params;
    const { force } = req.query; // Optional force flag

    if (!variant_id)
      return res.status(400).json({ message: "variant_id is required" });

    // Validate variant exists
    const variant = await getVariantById(variant_id);
    if (!variant) {
      return res.status(404).json({ message: "Product variant not found" });
    }

    let deletedVariant;

    if (force === "true") {
      // Force delete regardless of references (ADMIN override)
      deletedVariant = await hardDeleteVariant(variant_id);
    } else {
      // Try normal delete with reference checks
      deletedVariant = await hardDeleteVariant(variant_id);
    }

    return res.status(200).json({
      message: "Variant permanently deleted successfully",
      variant: deletedVariant,
    });
  } catch (err) {
    // Handle reference constraint errors
    if (err.message.includes("Cannot delete variant")) {
      return res.status(400).json({
        message: err.message,
        suggestion: "Use soft delete or remove references first",
      });
    }
    next(err);
  }
};

/**
 * GET /api/products/variants/:variant_id/details
 * ADMIN / STAFF - Get variant with full details
 */
const getVariantDetailsHandler = async (req, res, next) => {
  try {
    const { variant_id } = req.params;

    if (!variant_id)
      return res.status(400).json({ message: "variant_id is required" });

    const variant = await getVariantWithDetails(variant_id);
    if (!variant) {
      return res.status(404).json({ message: "Product variant not found" });
    }

    return res.status(200).json({
      message: "Variant details fetched successfully",
      variant,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  updateVariantStatusHandler,
  getProductVariantsHandler,
  updateVariantHandler,
  softDeleteVariantHandler,
  hardDeleteVariantHandler,
  getVariantDetailsHandler,
};
