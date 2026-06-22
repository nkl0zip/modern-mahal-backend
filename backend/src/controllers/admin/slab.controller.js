const {
  getAllSlabs,
  getSlabById,
  updateSlab,
  getDefaultSlab,
  getUserPayLaterLimit,
  logSlabActivity,
  getSlabAuditLogs,
  assignSlabToUser,
} = require("../../models/admin/slab.model");

/**
 * GET /api/slabs
 * Get all slabs (Admin/Sub-Admin only)
 */
const getAllSlabsHandler = async (req, res, next) => {
  try {
    const { include_inactive } = req.query;
    const slabs = await getAllSlabs(include_inactive === "true");

    res.status(200).json({
      success: true,
      message: "Slabs fetched successfully",
      slabs,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/slabs/:id
 * Get slab by ID (Admin/Sub-Admin only)
 */
const getSlabByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    const slab = await getSlabById(id);
    if (!slab) {
      return res.status(404).json({
        success: false,
        message: "Slab not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Slab fetched successfully",
      slab,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/slabs/:id
 * Update slab (Admin/Sub-Admin only)
 */
const updateSlabHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, rank, pay_later_limit, description, is_active } = req.body;

    // Check if slab exists
    const existingSlab = await getSlabById(id);
    if (!existingSlab) {
      return res.status(404).json({
        success: false,
        message: "Slab not found",
      });
    }

    if (pay_later_limit !== undefined && pay_later_limit < 0) {
      return res.status(400).json({
        success: false,
        message: "Pay later limit cannot be negative",
      });
    }

    // Prepare update data
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (rank !== undefined) updateData.rank = rank;
    if (pay_later_limit !== undefined)
      updateData.pay_later_limit = pay_later_limit;
    if (description !== undefined) updateData.description = description;
    if (is_active !== undefined) updateData.is_active = is_active;

    const updatedSlab = await updateSlab(id, updateData);

    // Log activity
    await logSlabActivity({
      slab_id: id,
      action: "UPDATE",
      changes: {
        old: existingSlab,
        new: updatedSlab,
      },
      performed_by: req.user.id,
      performed_by_role: req.user.role,
    });

    res.status(200).json({
      success: true,
      message: "Slab updated successfully",
      slab: updatedSlab,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/slabs/default
 * Get default slab (Public)
 */
const getDefaultSlabHandler = async (req, res, next) => {
  try {
    const slab = await getDefaultSlab();

    res.status(200).json({
      success: true,
      message: "Default slab fetched successfully",
      slab,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/slabs/user/pay-later-limit
 * Get user's pay later limit (Authenticated User only)
 */
const getUserPayLaterLimitHandler = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const userInfo = await getUserPayLaterLimit(userId);
    if (!userInfo) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Pay later limit fetched successfully",
      data: {
        user_id: userInfo.user_id,
        user_name: userInfo.user_name,
        user_email: userInfo.user_email,
        slab_id: userInfo.slab_id,
        slab_name: userInfo.slab_name || "No slab assigned",
        slab_rank: userInfo.slab_rank || null,
        pay_later_limit: userInfo.pay_later_limit || 0,
        slab_description: userInfo.slab_description || null,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/slabs/audit-logs
 * Get slab audit logs (Admin/Sub-Admin only)
 */
const getSlabAuditLogsHandler = async (req, res, next) => {
  try {
    const { slab_id, limit = 50, offset = 0 } = req.query;

    const logs = await getSlabAuditLogs(
      slab_id,
      parseInt(limit),
      parseInt(offset),
    );

    res.status(200).json({
      success: true,
      message: "Audit logs fetched successfully",
      logs,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: logs.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * ADMIN / STAFF: Assign slab to a USER
 * Body: { user_id, slab_id }
 */
const assignUserSlabHandler = async (req, res, next) => {
  try {
    const { user_id, slab_id } = req.body;

    if (!user_id || !slab_id) {
      return res.status(400).json({
        message: "user_id and slab_id are required.",
      });
    }

    const updatedUser = await assignSlabToUser(user_id, slab_id);

    return res.status(200).json({
      success: true,
      message: "User slab updated successfully.",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error in assignUserSlabHandler:", error);
    next(error);
  }
};

module.exports = {
  getAllSlabsHandler,
  getSlabByIdHandler,
  updateSlabHandler,
  getDefaultSlabHandler,
  getUserPayLaterLimitHandler,
  getSlabAuditLogsHandler,
  assignUserSlabHandler,
};
