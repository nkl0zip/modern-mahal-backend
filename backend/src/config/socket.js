const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

class SocketManager {
  constructor(io) {
    this.io = io;
    this.userSockets = new Map(); // userId -> socketId
    this.templateRooms = new Map(); // templateId -> [userId1, userId2]
    this.socketUsers = new Map(); // socketId -> {userId, userRole}

    this.setupMiddleware();
    this.setupConnectionHandlers();
  }

  setupMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth.token ||
          socket.handshake.headers.authorization?.split(" ")[1];

        if (!token) {
          return next(new Error("Authentication error: Token required"));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id;
        socket.userRole = decoded.role;

        next();
      } catch (error) {
        console.error("Socket authentication error:", error.message);
        next(new Error("Authentication error: Invalid token"));
      }
    });
  }

  setupConnectionHandlers() {
    this.io.on("connection", (socket) => {
      console.log(`Socket connected: ${socket.id} - User: ${socket.userId}`);

      // Store socket information
      this.userSockets.set(socket.userId, socket.id);
      this.socketUsers.set(socket.id, {
        userId: socket.userId,
        userRole: socket.userRole,
      });

      // Handle template room joining
      socket.on("join-template", async (templateId, callback) => {
        try {
          // Dynamically import to avoid circular dependencies
          const {
            checkTemplateAccess,
          } = require("../models/staff/orderTemplate.model");

          const hasAccess = await checkTemplateAccess(
            templateId,
            socket.userId,
            socket.userRole
          );

          if (!hasAccess) {
            if (callback) callback({ error: "Access denied to template" });
            return;
          }

          socket.join(`template:${templateId}`);

          // Store room membership
          if (!this.templateRooms.has(templateId)) {
            this.templateRooms.set(templateId, new Set());
          }
          this.templateRooms.get(templateId).add(socket.userId);

          console.log(`User ${socket.userId} joined template:${templateId}`);

          if (callback) callback({ success: true, templateId });

          // Notify others in the room
          socket.to(`template:${templateId}`).emit("user-joined", {
            userId: socket.userId,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error("Error joining template:", error);
          if (callback) callback({ error: "Failed to join template room" });
        }
      });

      // Handle leave template
      socket.on("leave-template", (templateId, callback) => {
        try {
          socket.leave(`template:${templateId}`);

          // Remove from room membership
          if (this.templateRooms.has(templateId)) {
            this.templateRooms.get(templateId).delete(socket.userId);
            if (this.templateRooms.get(templateId).size === 0) {
              this.templateRooms.delete(templateId);
            }
          }

          console.log(`User ${socket.userId} left template:${templateId}`);

          if (callback) callback({ success: true, templateId });
        } catch (error) {
          console.error("Error leaving template:", error);
          if (callback) callback({ error: "Failed to leave template room" });
        }
      });

      // Handle chat message
      socket.on("send-message", async (data, callback) => {
        try {
          const {
            template_id,
            message,
            message_type = "TEXT",
            attachments = [],
          } = data;

          // Validate input
          if (!template_id) {
            if (callback) callback({ error: "Template ID is required" });
            return;
          }

          if (!message && message_type === "TEXT") {
            if (callback) callback({ error: "Message text is required" });
            return;
          }

          // Dynamically import to avoid circular dependencies
          const {
            checkTemplateAccess,
          } = require("../models/staff/orderTemplate.model");

          // Check access
          const template = await checkTemplateAccess(
            template_id,
            socket.userId,
            socket.userRole
          );

          if (!template) {
            if (callback)
              callback({ error: "Template not found or access denied" });
            return;
          }

          // Check if template is active
          if (["COMPLETED", "CANCELLED"].includes(template.status)) {
            if (callback)
              callback({
                error: `Cannot send messages to ${template.status.toLowerCase()} template`,
              });
            return;
          }

          // Import model
          const {
            addChatMessage,
            addChatAttachment,
          } = require("../models/staff/orderTemplateChat.model");

          // Save message to database
          const chatMessage = await addChatMessage({
            template_id,
            sender_id: socket.userId,
            message: message || null,
            message_type,
          });

          // Save attachments if any
          const savedAttachments = [];
          if (attachments && attachments.length > 0) {
            for (const attachment of attachments) {
              const saved = await addChatAttachment({
                chat_id: chatMessage.id,
                cloudinary_public_id: attachment.public_id || null,
                file_url: attachment.url,
                file_name: attachment.name,
                file_size_bytes: attachment.size,
                mime_type: attachment.type,
                uploaded_by: socket.userId,
              });
              savedAttachments.push(saved);
            }
          }

          // Get full message with sender details
          const { rows } = await pool.query(
            `
            SELECT 
              otc.*,
              u.name as sender_name,
              u.role as sender_role,
              u.avatar_url as sender_avatar,
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

          // Broadcast message to template room
          this.io.to(`template:${template_id}`).emit("new-message", {
            message: fullMessage,
            template_id,
          });

          // Mark as read for sender immediately
          socket.emit("message-read", {
            template_id,
            count: 0, // sender sees it as read
            message_id: chatMessage.id,
          });

          // For other users in room, it's unread
          socket.to(`template:${template_id}`).emit("new-unread", {
            template_id,
            count: 1,
            sender_id: socket.userId,
          });

          if (callback)
            callback({
              success: true,
              message: fullMessage,
            });
        } catch (error) {
          console.error("Error sending message:", error);
          if (callback)
            callback({
              error: "Failed to send message",
              details: error.message,
            });
        }
      });

      // Handle typing indicator
      socket.on("typing", (data) => {
        const { template_id, isTyping } = data;
        if (template_id) {
          socket.to(`template:${template_id}`).emit("user-typing", {
            userId: socket.userId,
            isTyping,
            timestamp: new Date().toISOString(),
          });
        }
      });

      // Handle mark as read
      socket.on("mark-as-read", async (data, callback) => {
        try {
          const { template_id, message_ids } = data;

          if (!template_id) {
            if (callback) callback({ error: "Template ID is required" });
            return;
          }

          // Dynamically import to avoid circular dependencies
          const {
            checkTemplateAccess,
          } = require("../models/staff/orderTemplate.model");

          // Check access
          const template = await checkTemplateAccess(
            template_id,
            socket.userId,
            socket.userRole
          );

          if (!template) {
            if (callback)
              callback({ error: "Template not found or access denied" });
            return;
          }

          const {
            markMessagesAsRead,
          } = require("../models/staff/orderTemplateChat.model");

          let updatedCount;
          if (message_ids && message_ids.length > 0) {
            // Mark specific messages as read
            const { rowCount } = await pool.query(
              `
              UPDATE order_template_chats
              SET is_read = true
              WHERE id = ANY($1)
                AND template_id = $2
                AND sender_id != $3
                AND is_read = false
                AND deleted_at IS NULL
              `,
              [message_ids, template_id, socket.userId]
            );
            updatedCount = rowCount;
          } else {
            // Mark all messages as read
            updatedCount = await markMessagesAsRead(template_id, socket.userId);
          }

          // Emit read receipt
          this.io.to(`template:${template_id}`).emit("messages-read", {
            template_id,
            reader_id: socket.userId,
            count: updatedCount,
            message_ids: message_ids || "all",
          });

          if (callback)
            callback({
              success: true,
              updated_count: updatedCount,
            });
        } catch (error) {
          console.error("Error marking messages as read:", error);
          if (callback) callback({ error: "Failed to mark messages as read" });
        }
      });

      // Handle message deletion
      socket.on("delete-message", async (data, callback) => {
        try {
          const { message_id } = data;

          if (!message_id) {
            if (callback) callback({ error: "Message ID is required" });
            return;
          }

          const {
            deleteChatMessage,
          } = require("../models/staff/orderTemplateChat.model");

          const deletedMessage = await deleteChatMessage(
            message_id,
            socket.userId
          );

          if (!deletedMessage) {
            if (callback)
              callback({ error: "Message not found or permission denied" });
            return;
          }

          // Broadcast deletion to template room
          socket
            .to(`template:${deletedMessage.template_id}`)
            .emit("message-deleted", {
              message_id,
              template_id: deletedMessage.template_id,
              deleted_by: socket.userId,
              timestamp: new Date().toISOString(),
            });

          if (callback)
            callback({
              success: true,
              message: deletedMessage,
            });
        } catch (error) {
          console.error("Error deleting message:", error);
          if (callback) callback({ error: "Failed to delete message" });
        }
      });

      // Handle disconnect
      socket.on("disconnect", () => {
        console.log(
          `Socket disconnected: ${socket.id} - User: ${socket.userId}`
        );

        // Remove from userSockets
        if (this.userSockets.get(socket.userId) === socket.id) {
          this.userSockets.delete(socket.userId);
        }

        // Remove from socketUsers
        this.socketUsers.delete(socket.id);

        // Remove from template rooms
        for (const [templateId, users] of this.templateRooms.entries()) {
          if (users.has(socket.userId)) {
            users.delete(socket.userId);
            if (users.size === 0) {
              this.templateRooms.delete(templateId);
            }
          }
        }
      });
    });
  }

  // Utility method to send notification to specific user
  sendToUser(userId, event, data) {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
    }
  }

  // Utility method to send to template room
  sendToTemplate(templateId, event, data) {
    this.io.to(`template:${templateId}`).emit(event, data);
  }

  // Get online users in a template
  getOnlineUsers(templateId) {
    const users = this.templateRooms.get(templateId);
    return users ? Array.from(users) : [];
  }

  // Check if user is online
  isUserOnline(userId) {
    return this.userSockets.has(userId);
  }

  // Get all connected sockets
  getConnectedSockets() {
    return Array.from(this.io.sockets.sockets.keys());
  }

  // Get socket by user ID
  getSocketByUserId(userId) {
    const socketId = this.userSockets.get(userId);
    return socketId ? this.io.sockets.sockets.get(socketId) : null;
  }
}

// Singleton instance
let socketManager = null;

// Factory function to initialize socket
const initializeSocket = (server) => {
  if (socketManager) {
    return socketManager; // Already initialized
  }

  // Create Socket.io server
  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        // Allow all origins in development, restrict in production
        if (process.env.NODE_ENV === "production") {
          const allowedOrigins = process.env.ALLOWED_ORIGINS
            ? process.env.ALLOWED_ORIGINS.split(",")
            : [];
          if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
          } else {
            callback(new Error("Not allowed by CORS"));
          }
        } else {
          callback(null, true);
        }
      },
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // Create SocketManager instance
  socketManager = new SocketManager(io);

  return socketManager;
};

const getSocketManager = () => {
  if (!socketManager) {
    throw new Error(
      "Socket manager not initialized. Call initializeSocket first."
    );
  }
  return socketManager;
};

const getIO = () => {
  if (!socketManager) {
    throw new Error(
      "Socket manager not initialized. Call initializeSocket first."
    );
  }
  return socketManager.io;
};

module.exports = {
  initializeSocket,
  getSocketManager,
  getIO,
  SocketManager, // Export class for testing if needed
};
