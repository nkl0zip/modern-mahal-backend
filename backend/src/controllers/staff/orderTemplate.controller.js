const {
  createOrderTemplate,
  getTemplateById,
  getUserTemplates,
  getStaffAssignedTemplates,
  updateTemplate,
  softDeleteTemplate,
  finalizeTemplate,
  checkTemplateAccess,
  assignStaffToTemplate,
} = require("../../models/staff/orderTemplate.model");

const {
  getTemplateItems,
} = require("../../models/staff/orderTemplateItem.model");

const {
  getTemplateManualDiscounts,
} = require("../../models/staff/discount.model");

const {
  applyTemplateDiscounts,
  calculateTemplateTotals,
} = require("../../services/discount.service");

const {
  addChatMessage,
  getTemplateChats,
  markMessagesAsRead,
  deleteChatMessage,
  getUnreadMessageCount,
} = require("../../models/staff/orderTemplateChat.model");

const pool = require("../../config/db");

/**
 * POST /api/order-templates
 * Create new order template
 */
const createOrderTemplateHandler = async (req, res, next) => {
  try {
    const current_user_id = req.user.id;
    const user_role = req.user.role;
    const { title, description, user_id, staff_id } = req.body; // user_id is the customer/user for whom template is created

    let template_user_id;

    // If user is creating template for themselves
    if (user_role === "USER") {
      template_user_id = current_user_id;
    }
    // If staff/admin is creating template
    else if (["STAFF", "ADMIN"].includes(user_role)) {
      // Staff MUST provide user_id of the customer
      if (!user_id) {
        return res.status(400).json({
          message: "user_id is required when staff creates a template",
        });
      }

      // Validate that the provided user_id exists and is a USER role (not staff/admin)
      const userCheck = await pool.query(
        `SELECT id, role FROM users WHERE id = $1`,
        [user_id],
      );

      if (userCheck.rows.length === 0) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      if (userCheck.rows[0].role !== "USER") {
        return res.status(400).json({
          message:
            "Cannot create template for staff/admin. user_id must be a regular USER",
        });
      }

      template_user_id = user_id;
    } else {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const template = await createOrderTemplate({
      user_id: template_user_id,
      staff_id: staff_id, // Always null initially
      title: title || null,
      description: description || null,
      created_by: user_role === "USER" ? "USER" : "STAFF",
    });

    return res.status(201).json({
      message: "Order template created successfully",
      template,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/order-templates
 * Get user's order templates
 */
const getUserTemplatesHandler = async (req, res, next) => {
  try {
    const user_id = req.user.id;
    const { status } = req.query;

    let templates;

    if (req.user.role === "USER") {
      templates = await getUserTemplates(user_id, status);
    } else if (req.user.role === "STAFF" || req.user.role === "ADMIN") {
      templates = await getStaffAssignedTemplates(user_id, status);
    } else {
      return res.status(403).json({ message: "Unauthorized" });
    }

    return res.status(200).json({
      message: "Order templates fetched successfully",
      templates,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/order-templates/:template_id
 * Get template details
 */
const getTemplateDetailsHandler = async (req, res, next) => {
  try {
    const { template_id } = req.params;
    const user_id = req.user.id;
    const user_role = req.user.role;

    if (!template_id) {
      return res.status(400).json({ message: "Template ID is required" });
    }

    const template = await checkTemplateAccess(template_id, user_id, user_role);
    // For staff users, check if they are assigned to this template
    if (["STAFF"].includes(user_role) && template.staff_id !== user_id) {
      return res.status(403).json({
        message:
          "Staff is not assigned to this template. Please get assigned first.",
      });
    }
    if (!template) {
      return res
        .status(404)
        .json({ message: "Template not found or access denied" });
    }

    // Get template user & staff details
    const details = await getTemplateById(template_id);

    // Get template items
    const items = await getTemplateItems(template_id);

    // Get chat messages
    const chats = await getTemplateChats(template_id, 20);

    // Mark messages as read for this user
    await markMessagesAsRead(template_id, user_id);

    // Get unread count
    const unreadCount = await getUnreadMessageCount(template_id, user_id);

    // Fetch template-level discounts
    const templateDiscounts = await getTemplateManualDiscounts(
      template_id,
      details.user_id,
    );

    // Apply discounts to items
    const { items: discountedItems, applied_discounts } =
      applyTemplateDiscounts(items, templateDiscounts);

    const { total_original_cost, total_cost, total_discount_amount } =
      calculateTemplateTotals(discountedItems);

    return res.status(200).json({
      message: "Template details fetched successfully",
      template: {
        ...details,
        total_original_cost,
        total_discount_amount,
        total_cost,
        items: discountedItems,
        discounts: applied_discounts,
        chats,
        unread_messages: unreadCount,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/order-templates/:template_id
 * Update template details
 */
const updateTemplateHandler = async (req, res, next) => {
  try {
    const { template_id } = req.params;
    const user_id = req.user.id;
    const user_role = req.user.role;
    const { title, description, status, staff_id } = req.body;

    if (!template_id) {
      return res.status(400).json({ message: "Template ID is required" });
    }

    // Check access
    const template = await checkTemplateAccess(template_id, user_id, user_role);
    // For staff users, check if they are assigned to this template
    if (["STAFF"].includes(user_role) && template.staff_id !== user_id) {
      return res.status(403).json({
        message:
          "Staff is not assigned to this template. Please get assigned first.",
      });
    }
    if (!template) {
      return res
        .status(404)
        .json({ message: "Template not found or access denied" });
    }

    // Validate status if provided
    if (status) {
      const allowedStatuses = ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: `Invalid status. Allowed values: ${allowedStatuses.join(
            ", ",
          )}`,
        });
      }

      // Only staff/admin can change status to COMPLETED or CANCELLED
      if (
        ["COMPLETED", "CANCELLED"].includes(status) &&
        !["STAFF", "ADMIN"].includes(user_role)
      ) {
        return res.status(403).json({
          message: "Only staff/admin can complete or cancel templates",
        });
      }
    }

    // Validate staff assignment
    if (staff_id !== undefined) {
      if (!["STAFF", "ADMIN"].includes(user_role)) {
        return res.status(403).json({
          message: "Only staff/admin can assign staff",
        });
      }
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (staff_id !== undefined) updateData.staff_id = staff_id;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No fields provided for update" });
    }

    const updatedTemplate = await updateTemplate(template_id, updateData);

    return res.status(200).json({
      message: "Template updated successfully",
      template: updatedTemplate,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/order-templates/:template_id
 * Soft delete template
 */
const deleteTemplateHandler = async (req, res, next) => {
  try {
    const { template_id } = req.params;
    const user_id = req.user.id;
    const user_role = req.user.role;

    if (!template_id) {
      return res.status(400).json({ message: "Template ID is required" });
    }

    // Check access
    const template = await checkTemplateAccess(template_id, user_id, user_role);
    // For staff users, check if they are assigned to this template
    if (["STAFF"].includes(user_role) && template.staff_id !== user_id) {
      return res.status(403).json({
        message:
          "Staff is not assigned to this template. Please get assigned first.",
      });
    }
    if (!template) {
      return res
        .status(404)
        .json({ message: "Template not found or access denied" });
    }

    // Only template owner or admin can delete
    if (template.user_id !== user_id && user_role !== "ADMIN") {
      return res.status(403).json({
        message: "Only template owner or admin can delete template",
      });
    }

    const deletedTemplate = await softDeleteTemplate(template_id);

    return res.status(200).json({
      message: "Template deleted successfully",
      template: deletedTemplate,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/order-templates/:template_id/finalize
 * Finalize template (mark as completed)
 */
const finalizeTemplateHandler = async (req, res, next) => {
  try {
    const { template_id } = req.params;
    const user_id = req.user.id;
    const user_role = req.user.role;

    if (!template_id) {
      return res.status(400).json({ message: "Template ID is required" });
    }

    // Check access - only staff/admin can finalize
    if (!["STAFF", "ADMIN"].includes(user_role)) {
      return res.status(403).json({
        message: "Only staff/admin can finalize templates",
      });
    }

    const template = await checkTemplateAccess(template_id, user_id, user_role);
    // For staff users, check if they are assigned to this template
    if (["STAFF"].includes(user_role) && template.staff_id !== user_id) {
      return res.status(403).json({
        message:
          "Staff is not assigned to this template. Please get assigned first.",
      });
    }
    if (!template) {
      return res
        .status(404)
        .json({ message: "Template not found or access denied" });
    }

    // Check if template has items
    const items = await getTemplateItems(template_id);
    if (items.length === 0) {
      return res.status(400).json({
        message: "Cannot finalize empty template. Add items first.",
      });
    }

    const finalizedTemplate = await finalizeTemplate(template_id);

    return res.status(200).json({
      message: "Template finalized successfully",
      template: finalizedTemplate,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/order-templates/:template_id/assign-staff
 * Assign staff to template (ADMIN/STAFF only)
 */
const assignStaffHandler = async (req, res, next) => {
  try {
    const { template_id } = req.params;
    const user_id = req.user.id;
    const user_role = req.user.role;
    const { staff_id } = req.body;

    if (!template_id || !staff_id) {
      return res.status(400).json({
        message: "Template ID and Staff ID are required",
      });
    }

    // Only staff/admin can assign staff
    if (!["STAFF", "ADMIN"].includes(user_role)) {
      return res.status(403).json({
        message: "Only staff/admin can assign staff to templates",
      });
    }

    const template = await checkTemplateAccess(template_id, user_id, user_role);
    // For staff users, check if they are assigned to this template
    /*if (["STAFF"].includes(user_role) && template.staff_id !== user_id) {
      return res.status(403).json({
        message:
          "Staff is not assigned to this template. Please get assigned first.",
      });
    }*/

    const updatedTemplate = await assignStaffToTemplate(template_id, staff_id);

    // Send notification chat message
    await addChatMessage({
      template_id,
      sender_id: user_id,
      message: `Staff assigned to this template`,
      message_type: "TEXT",
    });

    return res.status(200).json({
      message: "Staff assigned successfully",
      template: updatedTemplate,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createOrderTemplateHandler,
  getUserTemplatesHandler,
  getTemplateDetailsHandler,
  updateTemplateHandler,
  deleteTemplateHandler,
  finalizeTemplateHandler,
  assignStaffHandler,
};
