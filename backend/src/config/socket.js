const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { jwtSecret } = require("./jwt");
const pool = require("../config/db");

class SocketManager {
  constructor(io) {
    this.io = io;
    this.userSockets = new Map(); // userId -> socketId
    this.templateRooms = new Map(); // templateId -> Set<userId>
    this.socketUsers = new Map(); // socketId -> {userId, userRole}
    this.typingUsers = new Map(); // socketId -> Set<templateId> (tracks which rooms user is typing in)

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

        const decoded = jwt.verify(token, jwtSecret);
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

      this.userSockets.set(socket.userId, socket.id);
      this.socketUsers.set(socket.id, {
        userId: socket.userId,
        userRole: socket.userRole,
      });
      this.typingUsers.set(socket.id, new Set());

      // ── join-template ────────────────────────────────────────────
      socket.on("join-template", async (templateId, callback) => {
        try {
          const { checkTemplateAccess } = require("../models/staff/orderTemplate.model");
          const { getTemplateChats } = require("../models/staff/orderTemplateChat.model");

          const hasAccess = await checkTemplateAccess(
            templateId,
            socket.userId,
            socket.userRole,
          );

          if (!hasAccess) {
            if (callback) callback({ error: "Access denied to template" });
            return;
          }

          socket.join(`template:${templateId}`);

          if (!this.templateRooms.has(templateId)) {
            this.templateRooms.set(templateId, new Set());
          }
          this.templateRooms.get(templateId).add(socket.userId);

          console.log(`User ${socket.userId} joined template:${templateId}`);

          // Deliver recent chat history to the joining user
          const history = await getTemplateChats(templateId, 50, 0);
          // DB returns newest-first — reverse so client gets oldest-first
          const orderedHistory = history.slice().reverse();

          if (callback) callback({ success: true, templateId, history: orderedHistory });

          socket.to(`template:${templateId}`).emit("user-joined", {
            userId: socket.userId,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error("Error joining template:", error);
          if (callback) callback({ error: "Failed to join template room" });
        }
      });

      // ── leave-template ───────────────────────────────────────────
      socket.on("leave-template", (templateId, callback) => {
        try {
          this._leaveTemplateRoom(socket, templateId);
          if (callback) callback({ success: true, templateId });
        } catch (error) {
          console.error("Error leaving template:", error);
          if (callback) callback({ error: "Failed to leave template room" });
        }
      });

      // ── send-message ─────────────────────────────────────────────
      socket.on("send-message", async (data, callback) => {
        try {
          const {
            template_id,
            message,
            message_type = "TEXT",
            attachments = [],
          } = data;

          if (!template_id) {
            if (callback) callback({ error: "Template ID is required" });
            return;
          }

          if (!message && message_type === "TEXT") {
            if (callback) callback({ error: "Message text is required" });
            return;
          }

          const { checkTemplateAccess } = require("../models/staff/orderTemplate.model");

          const template = await checkTemplateAccess(
            template_id,
            socket.userId,
            socket.userRole,
          );

          if (!template) {
            if (callback) callback({ error: "Template not found or access denied" });
            return;
          }

          if (["COMPLETED", "CANCELLED"].includes(template.status)) {
            if (callback) callback({
              error: `Cannot send messages to ${template.status.toLowerCase()} template`,
            });
            return;
          }

          const { addChatMessage, addChatAttachment } = require("../models/staff/orderTemplateChat.model");

          const chatMessage = await addChatMessage({
            template_id,
            sender_id: socket.userId,
            message: message || null,
            message_type,
          });

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
            [chatMessage.id],
          );

          const fullMessage = rows[0];

          if (!fullMessage) {
            if (callback) callback({ error: "Failed to retrieve saved message" });
            return;
          }

          // Broadcast to everyone in the room including sender
          this.io.to(`template:${template_id}`).emit("new-message", {
            message: fullMessage,
            template_id,
          });

          // Unread notification only to others (include names for toast display)
          socket.to(`template:${template_id}`).emit("new-unread", {
            template_id,
            template_title: template.title,
            sender_id: socket.userId,
            sender_name: fullMessage.sender_name,
            count: 1,
          });

          // Directly notify the template owner — their global notification socket is not in the room
          if (template.user_id && String(template.user_id) !== String(socket.userId)) {
            this.sendToUser(template.user_id, "new-unread", {
              template_id,
              template_title: template.title,
              sender_id: socket.userId,
              sender_name: fullMessage.sender_name,
              count: 1,
            });
          }

          if (callback) callback({ success: true, message: fullMessage });
        } catch (error) {
          console.error("Error sending message:", error);
          if (callback) callback({ error: "Failed to send message", details: error.message });
        }
      });

      // ── typing ───────────────────────────────────────────────────
      socket.on("typing", (data) => {
        const { template_id, isTyping } = data;
        if (!template_id) return;

        // Track typing state so we can clean up on disconnect
        const typingSet = this.typingUsers.get(socket.id);
        if (typingSet) {
          if (isTyping) {
            typingSet.add(template_id);
          } else {
            typingSet.delete(template_id);
          }
        }

        socket.to(`template:${template_id}`).emit("user-typing", {
          userId: socket.userId,
          isTyping,
          timestamp: new Date().toISOString(),
        });
      });

      // ── mark-as-read ─────────────────────────────────────────────
      socket.on("mark-as-read", async (data, callback) => {
        try {
          const { template_id, message_ids } = data;

          if (!template_id) {
            if (callback) callback({ error: "Template ID is required" });
            return;
          }

          const { checkTemplateAccess } = require("../models/staff/orderTemplate.model");

          const template = await checkTemplateAccess(
            template_id,
            socket.userId,
            socket.userRole,
          );

          if (!template) {
            if (callback) callback({ error: "Template not found or access denied" });
            return;
          }

          const { markMessagesAsRead } = require("../models/staff/orderTemplateChat.model");

          let updatedCount;
          if (message_ids && message_ids.length > 0) {
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
              [message_ids, template_id, socket.userId],
            );
            updatedCount = rowCount;
          } else {
            updatedCount = await markMessagesAsRead(template_id, socket.userId);
          }

          this.io.to(`template:${template_id}`).emit("messages-read", {
            template_id,
            reader_id: socket.userId,
            count: updatedCount,
            message_ids: message_ids || "all",
          });

          if (callback) callback({ success: true, updated_count: updatedCount });
        } catch (error) {
          console.error("Error marking messages as read:", error);
          if (callback) callback({ error: "Failed to mark messages as read" });
        }
      });

      // ── delete-message ───────────────────────────────────────────
      socket.on("delete-message", async (data, callback) => {
        try {
          const { message_id } = data;

          if (!message_id) {
            if (callback) callback({ error: "Message ID is required" });
            return;
          }

          const { deleteChatMessage } = require("../models/staff/orderTemplateChat.model");

          const deletedMessage = await deleteChatMessage(message_id, socket.userId);

          if (!deletedMessage) {
            if (callback) callback({ error: "Message not found or permission denied" });
            return;
          }

          // Broadcast to everyone in the room including sender
          this.io.to(`template:${deletedMessage.template_id}`).emit("message-deleted", {
            message_id,
            template_id: deletedMessage.template_id,
            deleted_by: socket.userId,
            timestamp: new Date().toISOString(),
          });

          if (callback) callback({ success: true, message: deletedMessage });
        } catch (error) {
          console.error("Error deleting message:", error);
          if (callback) callback({ error: "Failed to delete message" });
        }
      });

      // ── disconnect ───────────────────────────────────────────────
      socket.on("disconnect", () => {
        console.log(`Socket disconnected: ${socket.id} - User: ${socket.userId}`);

        // Clear typing indicators for all rooms this user was typing in
        const typingSet = this.typingUsers.get(socket.id);
        if (typingSet && typingSet.size > 0) {
          for (const templateId of typingSet) {
            socket.to(`template:${templateId}`).emit("user-typing", {
              userId: socket.userId,
              isTyping: false,
              timestamp: new Date().toISOString(),
            });
          }
        }
        this.typingUsers.delete(socket.id);

        if (this.userSockets.get(socket.userId) === socket.id) {
          this.userSockets.delete(socket.userId);
        }

        this.socketUsers.delete(socket.id);

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

  // ── Private helper ─────────────────────────────────────────────
  _leaveTemplateRoom(socket, templateId) {
    socket.leave(`template:${templateId}`);

    const typingSet = this.typingUsers.get(socket.id);
    if (typingSet && typingSet.has(templateId)) {
      typingSet.delete(templateId);
      socket.to(`template:${templateId}`).emit("user-typing", {
        userId: socket.userId,
        isTyping: false,
        timestamp: new Date().toISOString(),
      });
    }

    if (this.templateRooms.has(templateId)) {
      this.templateRooms.get(templateId).delete(socket.userId);
      if (this.templateRooms.get(templateId).size === 0) {
        this.templateRooms.delete(templateId);
      }
    }

    console.log(`User ${socket.userId} left template:${templateId}`);
  }

  // ── Public utilities ───────────────────────────────────────────
  sendToUser(userId, event, data) {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
    }
  }

  sendToTemplate(templateId, event, data) {
    this.io.to(`template:${templateId}`).emit(event, data);
  }

  getOnlineUsers(templateId) {
    const users = this.templateRooms.get(templateId);
    return users ? Array.from(users) : [];
  }

  isUserOnline(userId) {
    return this.userSockets.has(userId);
  }

  getConnectedSockets() {
    return Array.from(this.io.sockets.sockets.keys());
  }

  getSocketByUserId(userId) {
    const socketId = this.userSockets.get(userId);
    return socketId ? this.io.sockets.sockets.get(socketId) : null;
  }
}

// ── Singleton ──────────────────────────────────────────────────
let socketManager = null;

const initializeSocket = (server) => {
  if (socketManager) return socketManager;

  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => callback(null, true),
      credentials: true,
    },
    transports: ["websocket", "polling"],
    allowUpgrades: false,
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  socketManager = new SocketManager(io);
  return socketManager;
};

const getSocketManager = () => {
  if (!socketManager) {
    throw new Error("Socket manager not initialized. Call initializeSocket first.");
  }
  return socketManager;
};

const getIO = () => {
  if (!socketManager) {
    throw new Error("Socket manager not initialized. Call initializeSocket first.");
  }
  return socketManager.io;
};

module.exports = {
  initializeSocket,
  getSocketManager,
  getIO,
  SocketManager,
};
