const pool = require("../../config/db");
const {
  addItemToTemplate,
  getTemplateItems,
  updateItemQuantity,
  updateItemStatus,
  removeItemFromTemplate,
  getItemWithDetails,
} = require("../../models/staff/orderTemplateItem.model");

const {
  checkTemplateAccess,
} = require("../../models/staff/orderTemplate.model");

/**
 * GET /api/order-templates/:template_id/items
 * Get template items
 */
const getTemplateItemsHandler = async (req, res, next) => {
  try {
    const { template_id } = req.params;
    const user_id = req.user.id;
    const user_role = req.user.role;

    if (!template_id) {
      return res.status(400).json({ message: "Template ID is required" });
    }

    // Check access
    const template = await checkTemplateAccess(template_id, user_id, user_role);
    if (!template) {
      return res
        .status(404)
        .json({ message: "Template not found or access denied" });
    }

    const items = await getTemplateItems(template_id);

    return res.status(200).json({
      message: "Template items fetched successfully",
      items,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/order-templates/:template_id/items
 * Add item to template
 */
const addItemToTemplateHandler = async (req, res, next) => {
  try {
    const { template_id } = req.params;
    const user_id = req.user.id;
    const user_role = req.user.role;
    const { product_id, variant_id, quantity = 1, notes } = req.body;

    if (!template_id || !product_id) {
      return res.status(400).json({
        message: "Template ID and Product ID are required",
      });
    }

    if (quantity <= 0) {
      return res.status(400).json({
        message: "Quantity must be greater than 0",
      });
    }

    // Check access
    const template = await checkTemplateAccess(template_id, user_id, user_role);
    if (!template) {
      return res
        .status(404)
        .json({ message: "Template not found or access denied" });
    }

    // Check if template is editable
    if (["COMPLETED", "CANCELLED"].includes(template.status)) {
      return res.status(400).json({
        message: `Cannot add items to ${template.status.toLowerCase()} template`,
      });
    }

    // Get product/variant price
    let priceQuery = `
      SELECT pv.mrp, p.name as product_name
      FROM products p
      LEFT JOIN product_variants pv ON p.id = pv.product_id AND pv.id = $2
      WHERE p.id = $1
      LIMIT 1;
    `;

    const priceResult = await pool.query(priceQuery, [
      product_id,
      variant_id || null,
    ]);

    if (priceResult.rows.length === 0) {
      return res.status(404).json({
        message: "Product or variant not found",
      });
    }

    const unit_price_snapshot = priceResult.rows[0].mrp || 0;
    const product_name = priceResult.rows[0].product_name;

    // Determine added_by
    const added_by = ["STAFF", "ADMIN"].includes(user_role) ? "STAFF" : "USER";

    const item = await addItemToTemplate({
      template_id,
      product_id,
      variant_id: variant_id || null,
      quantity,
      unit_price_snapshot,
      added_by,
      notes: notes || null,
    });

    // Add chat notification
    const {
      addChatMessage,
    } = require("../../models/staff/orderTemplateChat.model");
    await addChatMessage({
      template_id,
      sender_id: user_id,
      message: `Added ${quantity}x ${product_name} to the template`,
      message_type: "TEXT",
    });

    return res.status(201).json({
      message: "Item added to template successfully",
      item,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/order-templates/items/:item_id/quantity
 * Update item quantity
 */
const updateItemQuantityHandler = async (req, res, next) => {
  try {
    const { item_id } = req.params;
    const user_id = req.user.id;
    const user_role = req.user.role;
    const { quantity } = req.body;

    if (!item_id || quantity === undefined) {
      return res.status(400).json({
        message: "Item ID and Quantity are required",
      });
    }

    if (quantity <= 0) {
      return res.status(400).json({
        message: "Quantity must be greater than 0",
      });
    }

    // Get item with template details
    const item = await getItemWithDetails(item_id);
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    // Check template access
    const template = await checkTemplateAccess(
      item.template_id,
      user_id,
      user_role
    );
    if (!template) {
      return res
        .status(404)
        .json({ message: "Template not found or access denied" });
    }

    // Check if template is editable
    if (["COMPLETED", "CANCELLED"].includes(template.status)) {
      return res.status(400).json({
        message: `Cannot update items in ${template.status.toLowerCase()} template`,
      });
    }

    const updatedItem = await updateItemQuantity(item_id, quantity);

    // Add chat notification if quantity changed significantly
    if (Math.abs(item.quantity - quantity) > 5) {
      const {
        addChatMessage,
      } = require("../../models/staff/orderTemplateChat.model");
      await addChatMessage({
        template_id: item.template_id,
        sender_id: user_id,
        message: `Updated quantity of ${item.product_name} from ${item.quantity} to ${quantity}`,
        message_type: "TEXT",
      });
    }

    return res.status(200).json({
      message: "Item quantity updated successfully",
      item: updatedItem,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/order-templates/items/:item_id/status
 * Update item status
 */
const updateItemStatusHandler = async (req, res, next) => {
  try {
    const { item_id } = req.params;
    const user_id = req.user.id;
    const user_role = req.user.role;
    const { status, notes } = req.body;

    if (!item_id || !status) {
      return res.status(400).json({
        message: "Item ID and Status are required",
      });
    }

    const allowedStatuses = [
      "ACTIVE",
      "CANCELLED",
      "IN_CART",
      "DELIVERED",
      "DELIVERING",
    ];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Allowed values: ${allowedStatuses.join(
          ", "
        )}`,
      });
    }

    // Get item with template details
    const item = await getItemWithDetails(item_id);
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    // Check template access
    const template = await checkTemplateAccess(
      item.template_id,
      user_id,
      user_role
    );
    if (!template) {
      return res
        .status(404)
        .json({ message: "Template not found or access denied" });
    }

    // Only staff/admin can change status to DELIVERED/DELIVERING
    if (
      ["DELIVERED", "DELIVERING"].includes(status) &&
      !["STAFF", "ADMIN"].includes(user_role)
    ) {
      return res.status(403).json({
        message: "Only staff/admin can update delivery status",
      });
    }

    const updatedItem = await updateItemStatus(item_id, status, notes);

    // Add chat notification for status changes (except ACTIVE)
    if (status !== "ACTIVE") {
      const {
        addChatMessage,
      } = require("../../models/staff/orderTemplateChat.model");
      await addChatMessage({
        template_id: item.template_id,
        sender_id: user_id,
        message: `Updated status of ${
          item.product_name
        } to ${status.toLowerCase()}`,
        message_type: "TEXT",
      });
    }

    return res.status(200).json({
      message: "Item status updated successfully",
      item: updatedItem,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/order-templates/items/:item_id
 * Remove item from template
 */
const removeItemFromTemplateHandler = async (req, res, next) => {
  try {
    const { item_id } = req.params;
    const user_id = req.user.id;
    const user_role = req.user.role;

    if (!item_id) {
      return res.status(400).json({ message: "Item ID is required" });
    }

    // Get item with template details
    const item = await getItemWithDetails(item_id);
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    // Check template access
    const template = await checkTemplateAccess(
      item.template_id,
      user_id,
      user_role
    );
    if (!template) {
      return res
        .status(404)
        .json({ message: "Template not found or access denied" });
    }

    // Check if template is editable
    if (["COMPLETED", "CANCELLED"].includes(template.status)) {
      return res.status(400).json({
        message: `Cannot remove items from ${template.status.toLowerCase()} template`,
      });
    }

    const removedItem = await removeItemFromTemplate(item_id);

    // Add chat notification
    const {
      addChatMessage,
    } = require("../../models/staff/orderTemplateChat.model");
    await addChatMessage({
      template_id: item.template_id,
      sender_id: user_id,
      message: `Removed ${item.product_name} from the template`,
      message_type: "TEXT",
    });

    return res.status(200).json({
      message: "Item removed from template successfully",
      item: removedItem,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getTemplateItemsHandler,
  addItemToTemplateHandler,
  updateItemQuantityHandler,
  updateItemStatusHandler,
  removeItemFromTemplateHandler,
};
