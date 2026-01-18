const express = require("express");
const {
  createOrderTemplateHandler,
  getUserTemplatesHandler,
  getTemplateDetailsHandler,
  updateTemplateHandler,
  deleteTemplateHandler,
  finalizeTemplateHandler,
  assignStaffHandler,
} = require("../../controllers/staff/orderTemplate.controller");

const {
  getTemplateItemsHandler,
  addItemToTemplateHandler,
  updateItemQuantityHandler,
  updateItemStatusHandler,
  removeItemFromTemplateHandler,
} = require("../../controllers/staff/orderTemplateItem.controller");

const {
  getTemplateChatsHandler,
  sendChatMessageHandler,
  deleteChatMessageHandler,
  getUnreadCountHandler,
  markAsReadHandler,
} = require("../../controllers/staff/orderTemplateChat.controller");

const {
  getAllTemplatesHandler,
  getTemplateStatisticsHandler,
} = require("../../controllers/staff/orderTemplateList.controller");

const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");

const upload = require("../../middlewares/upload.middleware");

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Order Template Routes
router.post("/", createOrderTemplateHandler);
router.get("/", getUserTemplatesHandler);
router.get("/:template_id", getTemplateDetailsHandler);
router.put("/:template_id", updateTemplateHandler);
router.delete("/:template_id", deleteTemplateHandler);
router.post("/:template_id/finalize", finalizeTemplateHandler);
router.post(
  "/:template_id/assign-staff",
  requireRole(["STAFF", "ADMIN"]),
  assignStaffHandler,
);

// Template Items Routes
router.get("/:template_id/items", getTemplateItemsHandler);
router.post("/:template_id/items", addItemToTemplateHandler);
router.put("/items/:item_id/quantity", updateItemQuantityHandler);
router.patch("/items/:item_id/status", updateItemStatusHandler);
router.delete("/items/:item_id", removeItemFromTemplateHandler);

// Template Chat Routes
router.get("/:template_id/chats", getTemplateChatsHandler);
router.post(
  "/:template_id/chats",
  upload.array("attachments", 5),
  sendChatMessageHandler,
);
router.delete("/chats/:chat_id", deleteChatMessageHandler);
router.get("/:template_id/unread-count", getUnreadCountHandler);
router.post("/:template_id/mark-read", markAsReadHandler);

// Template List Routes (ADMIN/STAFF only)
router.get(
  "/admin/all",
  requireRole(["STAFF", "ADMIN"]),
  getAllTemplatesHandler,
);
router.get(
  "/admin/stats",
  requireRole(["STAFF", "ADMIN"]),
  getTemplateStatisticsHandler,
);

module.exports = router;
