const {
  createDiscount,
  addDiscountSegments,
  assignDiscountToUser,
  logDiscountActivity,
  listDiscountActivities,
  listDiscountByType,
  getDiscountById,
  toggleDiscountStatus,
  updateDiscount,
  deleteDiscountById,
  listManualDiscountsWithUsers,
} = require("../../models/staff/discount.model");

/**
 * ADMIN / STAFF can only create coupon discount
 */
const createCouponDiscountHandler = async (req, res) => {
  try {
    const {
      coupon_code,
      discount_mode,
      value,
      expires_at,
      segment_ids = [],
    } = req.body;

    if (!coupon_code || !discount_mode || !value || !expires_at) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const discount = await createDiscount({
      type: "COUPON",
      discount_mode,
      value,
      coupon_code,
      expires_at,
      created_by: req.user.id,
      created_by_role: req.user.role,
    });

    await addDiscountSegments(discount.id, segment_ids);

    await logDiscountActivity({
      discountId: discount.id,
      action_type: "CREATED",
      performed_by: req.user.id,
      performed_by_role: req.user.role,
      new_value: discount,
    });

    res.status(201).json({
      message: "Coupon discount created successfully",
      discount,
    });
  } catch (err) {
    console.error("Create Coupon Error: ", err);
    res.status(500).json({ message: "Failed to Create coupon discount" });
  }
};

/**
 * ADMIN / STAFF -> Create manual discount for a USER
 */
const createManualDiscountHandler = async (req, res) => {
  try {
    const {
      user_id,
      discount_mode,
      value,
      expires_at,
      segment_ids = [],
    } = req.body;

    if (!user_id || !discount_mode || !value || !expires_at) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const discount = await createDiscount({
      type: "MANUAL",
      discount_mode,
      value,
      expires_at,
      created_by: req.user.id,
      created_by_role: req.user.role,
    });

    await assignDiscountToUser(discount.id, user_id);
    await addDiscountSegments(discount.id, segment_ids);

    await logDiscountActivity({
      discountId: discount.id,
      action_type: "CREATED",
      performed_by: req.user.id,
      performed_by_role: req.user.role,
      affected_user_id: user_id,
      new_value: discount,
    });

    res.status(201).json({
      message: "Manual discount created successfully",
      discount,
    });
  } catch (err) {
    console.error("Create Manual Discount Error: ", err);
    res.status(500).json({ message: "Failed to create manual discount" });
  }
};

/**
 * List all COUPON discounts
 */
const listCouponDiscountsHandler = async (req, res) => {
  try {
    const discounts = await listDiscountByType("COUPON");
    res.status(200).json({ discounts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch coupon discounts" });
  }
};

/**
 * List all MANUAL discounts
 */
const listManualDiscountsHandler = async (req, res) => {
  try {
    const discounts = await listManualDiscountsWithUsers();
    res.status(200).json({ discounts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch manual discounts" });
  }
};

/**
 * Activate / Deactivate discount
 */
const toggleDiscountHandler = async (req, res) => {
  try {
    const { discount_id } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== "boolean") {
      return res.status(400).json({ message: "is_active must be boolean" });
    }

    const existing = await getDiscountById(discount_id);
    if (!existing) {
      return res.status(404).json({ message: "Discount not found" });
    }

    const updated = await toggleDiscountStatus(discount_id, is_active);

    await logDiscountActivity({
      discountId: discount_id,
      action_type: is_active ? "ACTIVATED" : "DEACTIVATED",
      performed_by: req.user.id,
      performed_by_role: req.user.role,
      old_value: existing,
      new_value: updated,
    });

    res.status(200).json({
      message: "Discount status updated",
      discount: updated,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update discount status" });
  }
};

/**
 * Update coupon discount
 */
const updateCouponDiscountHandler = async (req, res) => {
  try {
    const { discount_id } = req.params;
    const { value, expires_at, coupon_code } = req.body;

    const existing = await getDiscountById(discount_id);
    if (!existing || existing.type !== "COUPON") {
      return res.status(404).json({ message: "Coupon not found" });
    }

    const fieldsToUpdate = {};
    if (value !== undefined) fieldsToUpdate.value = value;
    if (expires_at) fieldsToUpdate.expires_at = expires_at;
    if (coupon_code) fieldsToUpdate.coupon_code = coupon_code;

    if (!Object.keys(fieldsToUpdate).length) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const updated = await updateDiscount(discount_id, fieldsToUpdate);

    await logDiscountActivity({
      discountId: discount_id,
      action_type: "UPDATED",
      performed_by: req.user.id,
      performed_by_role: req.user.role,
      old_value: existing,
      new_value: updated,
    });

    res.status(200).json({
      message: "Coupon updated successfully",
      discount: updated,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update coupon" });
  }
};

/**
 * ADMIN → List all discount activities
 */
const listActivitiesHandler = async (req, res) => {
  try {
    const logs = await listDiscountActivities();
    res.status(200).json({ logs });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch activity logs" });
  }
};

/**
 * ADMIN / STAFF -> Delete Coupon Discount
 */
const deleteCouponDiscountHandler = async (req, res) => {
  try {
    const { discount_id } = req.params;

    const existing = await getDiscountById(discount_id);

    if (!existing || existing.type !== "COUPON") {
      return res.status(404).json({
        message: "Coupon discount not found",
      });
    }

    // Logging activity
    await logDiscountActivity({
      discountId: discount_id,
      action_type: "DELETED",
      performed_by: req.user.id,
      performed_by_role: req.user.role,
      old_value: existing,
      new_value: null,
    });

    const deleted = await deleteDiscountById(discount_id);

    res.status(200).json({
      message: "Coupon discount deleted successfully",
      discount: deleted,
    });
  } catch (err) {
    console.error("Deleted Coupon Error: ", err);
    res.status(500).json({
      message: "Failed to delete coupon discount",
    });
  }
};

module.exports = {
  createCouponDiscountHandler,
  createManualDiscountHandler,
  listCouponDiscountsHandler,
  listManualDiscountsHandler,
  toggleDiscountHandler,
  updateCouponDiscountHandler,
  listActivitiesHandler,
  deleteCouponDiscountHandler,
};
