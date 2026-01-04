const {
  addChatMessage,
  getTemplateChats,
  markMessagesAsRead,
  deleteChatMessage,
  getUnreadMessageCount,
  addChatAttachment,
  getAttachmentById,
} = require("../../models/staff/orderTemplateChat.model");

const {
  checkTemplateAccess,
} = require("../../models/staff/orderTemplate.model");

const { getSocketManager } = require("../../config/socket");

const pool = require("../../config/db");

/**
 * GET /api/order-templates/:template_id/chats
 * Get template chat messages
 */
const getTemplateChatsHandler = async (req, res, next) => {
  try {
    const { template_id } = req.params;
    const user_id = req.user.id;
    const user_role = req.user.role;
    const { limit = 50, offset = 0 } = req.query;

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

    // Mark messages as read for this user
    await markMessagesAsRead(template_id, user_id);

    const chats = await getTemplateChats(
      template_id,
      parseInt(limit),
      parseInt(offset)
    );
    const unreadCount = await getUnreadMessageCount(template_id, user_id);

    return res.status(200).json({
      message: "Chat messages fetched successfully",
      chats,
      unread_count: unreadCount,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/order-templates/:template_id/chats
 * Send chat message
 */
const sendChatMessageHandler = async (req, res, next) => {
  try {
    const { template_id } = req.params;
    const user_id = req.user.id;
    const user_role = req.user.role;
    const { message, message_type = "TEXT" } = req.body;

    if (!template_id) {
      return res.status(400).json({ message: "Template ID is required" });
    }

    if (!message && message_type === "TEXT") {
      return res.status(400).json({ message: "Message text is required" });
    }

    // Check access
    const template = await checkTemplateAccess(template_id, user_id, user_role);
    if (!template) {
      return res
        .status(404)
        .json({ message: "Template not found or access denied" });
    }

    // Check if template is active
    if (["COMPLETED", "CANCELLED"].includes(template.status)) {
      return res.status(400).json({
        message: `Cannot send messages to ${template.status.toLowerCase()} template`,
      });
    }

    const socketManager = getSocketManager();

    const chatMessage = await addChatMessage({
      template_id,
      sender_id: user_id,
      message: message || null,
      message_type,
    });

    // If there are file attachments in the request, handle them
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await addChatAttachment({
          chat_id: chatMessage.id,
          cloudinary_public_id: file.public_id || null,
          file_url: file.secure_url || file.path,
          file_name: file.originalname,
          file_size_bytes: file.size,
          mime_type: file.mimetype,
          uploaded_by: user_id,
        });
      }
    }

    // Get message with attachments
    const { rows } = await pool.query(
      `
      SELECT 
        otc.*,
        u.name as sender_name,
        u.role as sender_role,
        ARRAY(
          SELECT jsonb_build_object(
            'id', ota.id,
            'file_url', ota.file_url,
            'file_name', ota.file_name,
            'mime_type', ota.mime_type
          )
          FROM order_template_attachments ota
          WHERE ota.chat_id = otc.id
        ) as attachments
      FROM order_template_chats otc
      JOIN users u ON otc.sender_id = u.id
      WHERE otc.id = $1
      LIMIT 1;
      `,
      [chatMessage.id]
    );

    const fullMessage = rows[0];

    // Emit socket event for real-time update
    socketManager.sendToTemplate(template_id, "new-message", {
      message: fullMessage,
      template_id,
    });

    return res.status(201).json({
      message: "Message sent successfully",
      chat: fullMessage,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/order-templates/chats/:chat_id
 * Delete chat message (own messages only)
 */
const deleteChatMessageHandler = async (req, res, next) => {
  try {
    const { chat_id } = req.params;
    const user_id = req.user.id;

    if (!chat_id) {
      return res.status(400).json({ message: "Chat ID is required" });
    }

    const deletedMessage = await deleteChatMessage(chat_id, user_id);
    if (!deletedMessage) {
      return res.status(404).json({
        message:
          "Chat message not found or you don't have permission to delete it",
      });
    }

    const socketManager = getSocketManager();

    socketManager.sendToTemplate(
      deletedMessage.template_id,
      "message-deleted",
      {
        message_id: chat_id,
        template_id: deletedMessage.template_id,
        deleted_by: user_id,
        timestamp: new Date().toISOString(),
      }
    );

    return res.status(200).json({
      message: "Chat message deleted successfully",
      chat: deletedMessage,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/order-templates/:template_id/unread-count
 * Get unread message count
 */
const getUnreadCountHandler = async (req, res, next) => {
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

    const unreadCount = await getUnreadMessageCount(template_id, user_id);

    return res.status(200).json({
      message: "Unread count fetched successfully",
      unread_count: unreadCount,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/order-templates/:template_id/mark-read
 * Mark all messages as read
 */
const markAsReadHandler = async (req, res, next) => {
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

    const updatedCount = await markMessagesAsRead(template_id, user_id);

    // Emit socket event
    const { getSocketManager } = require("../../config/socket");
    const socketManager = getSocketManager();

    socketManager.sendToTemplate(template_id, "messages-read", {
      template_id,
      reader_id: user_id,
      count: updatedCount,
      message_ids: "all",
    });

    return res.status(200).json({
      message: "Messages marked as read successfully",
      updated_count: updatedCount,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getTemplateChatsHandler,
  sendChatMessageHandler,
  deleteChatMessageHandler,
  getUnreadCountHandler,
  markAsReadHandler,
};
