const express = require("express");
const router = express.Router();

const TicketController = require("../../controllers/staff/ticket.controller");
const upload = require("../../middlewares/ticketUpload.middleware");
const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");

/**
 * User routes
 */
// To create a new Ticket by a user
// POST: "/api/tickets/"
router.post(
  "/",
  authenticateToken,
  upload.single("attachment"), // optional file field name: 'attachment'
  (req, res) => TicketController.createTicket(req, res)
);

// To get a Ticket by TicketId
// GET: /api/tickets/:id
router.get("/:id", authenticateToken, (req, res) =>
  TicketController.getTicket(req, res)
);
router.get("/", authenticateToken, (req, res) =>
  TicketController.listUserTickets(req, res)
);
router.delete("/:id", authenticateToken, (req, res) =>
  TicketController.deleteTicket(req, res)
);

// Add attachment to an existing ticket (user or staff)
// POST: /api/tickets/:id/attachments
router.post(
  "/:id/attachments",
  authenticateToken,
  upload.single("attachment"),
  (req, res) => TicketController.addAttachment(req, res)
);

/*
 * Staff/Admin routes
 */
// list all tickets - Allowed by Staff and Admin
// GET: /api/tickets/admin/all
router.get(
  "/admin/all",
  authenticateToken,
  (req, res, next) => {
    // require staff or admin
    if (req.user.role === "STAFF" || req.user.role === "ADMIN") return next();
    return res.status(403).json({ message: "Access denied" });
  },
  (req, res) => TicketController.listAllTickets(req, res)
);

// assign to staff (admin/staff)
// PATCH: /api/tickets/admin/:id/assign
router.patch(
  "/admin/:id/assign",
  authenticateToken,
  (req, res, next) => {
    if (req.user.role === "STAFF" || req.user.role === "ADMIN") return next();
    return res.status(403).json({ message: "Access denied" });
  },
  (req, res) => TicketController.assignTicket(req, res)
);

// transfer a ticket to another STAFF - Allowed to Staff & Admin
// PATCH: /api/tickets/admin/:id/transfer
router.patch(
  "/admin/:id/transfer",
  authenticateToken,
  (req, res, next) => {
    if (req.user.role === "STAFF" || req.user.role === "ADMIN") return next();
    return res.status(403).json({ message: "Access denied" });
  },
  (req, res) => TicketController.transferTicket(req, res)
);

// update status of a ticket - By Admin & Staff
// PATCH: /api/tickets/admin/:id/status
router.patch(
  "/admin/:id/status",
  authenticateToken,
  (req, res, next) => {
    if (req.user.role === "STAFF" || req.user.role === "ADMIN") return next();
    return res.status(403).json({ message: "Access denied" });
  },
  (req, res) => TicketController.updateStatus(req, res)
);

// get activities
// GET: /api/tickets/:id/activities
router.get("/:id/activities", authenticateToken, (req, res) =>
  TicketController.getActivities(req, res)
);

// get attachments in a Ticket
// GET: /api/tickets/:id/attachments
router.get("/:id/attachments", authenticateToken, (req, res) =>
  TicketController.getAttachments(req, res)
);

// staff stats - Allowed by Both Admin & Staff
// GET: /api/tickets/admin/stats/:staffId
router.get(
  "/admin/stats/:staffId",
  authenticateToken,
  (req, res, next) => {
    if (req.user.role === "STAFF" || req.user.role === "ADMIN") return next();
    return res.status(403).json({ message: "Access denied" });
  },
  (req, res) => TicketController.getStaffStats(req, res)
);

// getDetailsById - Allowed by Both Admin & staff
// GET: /api/tickets/details/:id
router.get(
  "/details/:id",
  authenticateToken,
  requireRole(["STAFF", "ADMIN"]),
  (req, res) => TicketController.getTicketDetailsById(req, res)
);

module.exports = router;
