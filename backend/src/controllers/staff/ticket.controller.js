const TicketService = require("../../services/ticket.service");
const TicketModel = require("../../models/staff/ticket.model");
const pool = require("../../config/db");

const TicketController = {
  // User creates ticket (optionally with a single attachment)
  async createTicket(req, res) {
    try {
      const user = req.user;
      if (!user || !user.id)
        return res.status(401).json({ message: "Unauthorized" });

      const { title, type, message, priority } = req.body;
      if (!title || !message) {
        return res
          .status(400)
          .json({ message: "title and message are required" });
      }

      // attachment handling: multer already uploaded to cloudinary and set req.file
      let attachment = null;
      if (req.file) {
        const f = req.file;
        attachment = {
          file_url: f.path || f.secure_url || f.url,
          file_name: f.originalname || f.filename,
          file_size_bytes: f.size || null,
          mime_type: f.mimetype || null,
          cloudinary_public_id: f.filename || f.public_id || f.public_id,
        };
      }

      const ticket = await TicketService.createTicket({
        user_id: user.id,
        title,
        type: type || "OTHER",
        message,
        priority,
        attachment,
      });

      return res.status(201).json({ message: "Ticket created", ticket });
    } catch (err) {
      console.error("createTicket error:", err);
      return res
        .status(500)
        .json({ message: "Internal server error", error: err.message });
    }
  },

  // Get details for current user's ticket or if staff/admin request, allow access
  async getTicket(req, res) {
    try {
      const user = req.user;
      const ticketId = req.params.id;
      const detail = await TicketService.getTicketDetail(ticketId);
      if (!detail || !detail.ticket)
        return res.status(404).json({ message: "Ticket not found" });

      // if requestor is not admin/staff and not owner, forbid
      if (
        user.role !== "ADMIN" &&
        user.role !== "STAFF" &&
        detail.ticket.user_id !== user.id
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      return res.status(200).json({
        ticket: detail.ticket,
        activities: detail.activities,
        attachments: detail.attachments,
      });
    } catch (err) {
      console.error("getTicket error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  },

  // Get Full TicektDetails by ID
  async getTicketDetailsById(req, res) {
    try {
      const user = req.user;
      if (user.role !== "ADMIN" && user.role !== "STAFF") {
        return res.status(403).json({ message: "Access Denied" });
      }

      const ticketId = req.params.id;
      if (!ticketId) {
        return res.status(400).json({ message: "Ticket ID is required" });
      }

      // Get ticket details with user info
      const ticketDetails = await TicketModel.getTicketDetailsById(ticketId);
      if (!ticketDetails) {
        return res.status(404).json({ message: "Ticket not found" });
      }

      // Get attachments
      const attachments = await TicketModel.getTicketAttachments(ticketId);

      // Get activities
      const activities = await TicketModel.getTicketActivities(ticketId);

      return res.status(200).json({
        ticket: ticketDetails,
        attachments,
        activities,
      });
    } catch (err) {
      console.error("getTicketDetailsById error: ", err);
      return res.status(500).json({
        message: "Internal server error",
        error: err.message,
      });
    }
  },

  // List user's tickets
  async listUserTickets(req, res) {
    try {
      const user = req.user;
      const { limit = 20, offset = 0 } = req.query;
      const tickets = await TicketModel.listUserTickets(user.id, {
        limit: parseInt(limit),
        offset: parseInt(offset),
      });
      return res.status(200).json({ tickets });
    } catch (err) {
      console.error("listUserTickets error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  },

  async deleteTicket(req, res) {
    try {
      const user = req.user;
      const ticketId = req.params.id;
      // soft delete — only owner can delete
      const deleted = await TicketModel.softDeleteTicket(ticketId, user.id);
      if (!deleted)
        return res
          .status(404)
          .json({ message: "Ticket not found or not owned by user" });

      // activity
      await TicketModel.createActivity({
        ticket_id: ticketId,
        actor_id: user.id,
        action: "DELETED",
        action_data: {},
      });

      return res.status(200).json({ message: "Ticket deleted" });
    } catch (err) {
      console.error("deleteTicket error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  },

  // Add attachment to existing ticket (user or staff)
  async addAttachment(req, res) {
    try {
      const user = req.user;
      const ticketId = req.params.id;

      const ticket = await TicketModel.getTicketById(ticketId);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });

      // only owner or staff/admin can add attachments
      if (
        user.role !== "ADMIN" &&
        user.role !== "STAFF" &&
        ticket.user_id !== user.id
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!req.file)
        return res.status(400).json({ message: "No file uploaded" });
      const f = req.file;
      const attachment = await TicketService.addAttachment({
        ticket_id: ticketId,
        uploaded_by: user.id,
        file_url: f.path || f.secure_url || f.url,
        file_name: f.originalname || f.filename,
        file_size_bytes: f.size || null,
        mime_type: f.mimetype || null,
        cloudinary_public_id: f.filename || f.public_id || f.public_id,
      });

      // activity
      await TicketModel.createActivity({
        ticket_id: ticketId,
        actor_id: user.id,
        action: "ATTACHMENT_ADDED",
        action_data: { file_name: attachment.file_name },
      });

      return res.status(201).json({ message: "Attachment added", attachment });
    } catch (err) {
      console.error("addAttachment error:", err);
      return res
        .status(500)
        .json({ message: "Internal server error", error: err.message });
    }
  },

  // ADMIN/STAFF: list all tickets with filters
  async listAllTickets(req, res) {
    try {
      const user = req.user;
      if (user.role !== "ADMIN" && user.role !== "STAFF") {
        return res.status(403).json({ message: "Access denied" });
      }
      const {
        status,
        assigned_staff_id,
        type,
        search,
        limit = 50,
        offset = 0,
      } = req.query;
      const filter = {};
      if (status) filter.status = status;
      if (assigned_staff_id) filter.assigned_staff_id = assigned_staff_id;
      if (type) filter.type = type;
      if (search) filter.search = search;

      const tickets = await TicketModel.listAllTickets({
        filter,
        limit: parseInt(limit),
        offset: parseInt(offset),
      });
      return res.status(200).json({ tickets });
    } catch (err) {
      console.error("listAllTickets error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  },

  // ADMIN/STAFF: assign ticket to staff (or staff can pick up themselves)
  async assignTicket(req, res) {
    try {
      const user = req.user;
      if (user.role !== "ADMIN" && user.role !== "STAFF") {
        return res.status(403).json({ message: "Access denied" });
      }
      const ticketId = req.params.id;
      const { staff_id } = req.body;
      if (!staff_id)
        return res.status(400).json({ message: "staff_id is required" });

      const assignment = await TicketService.assignTicket({
        ticket_id: ticketId,
        staff_id,
        assigned_by: user.id,
      });

      return res.status(200).json({ message: "Ticket assigned", assignment });
    } catch (err) {
      console.error("assignTicket error:", err);
      return res
        .status(500)
        .json({ message: "Internal server error", error: err.message });
    }
  },

  // ADMIN/STAFF: transfer ticket to another staff
  async transferTicket(req, res) {
    try {
      const user = req.user;
      if (user.role !== "ADMIN" && user.role !== "STAFF") {
        return res.status(403).json({ message: "Access denied" });
      }
      const ticketId = req.params.id;
      const { to_staff_id } = req.body;
      if (!to_staff_id)
        return res.status(400).json({ message: "to_staff_id is required" });

      // find current active assignment (to get from_staff_id)
      const active = await TicketModel.getActiveAssignmentForTicket(ticketId);
      const from_staff_id = active ? active.staff_id : null;

      const assignment = await TicketService.transferTicket({
        ticket_id: ticketId,
        from_staff_id,
        to_staff_id,
        transferred_by: user.id,
      });

      return res
        .status(200)
        .json({ message: "Ticket transferred", assignment });
    } catch (err) {
      console.error("transferTicket error:", err);
      return res
        .status(500)
        .json({ message: "Internal server error", error: err.message });
    }
  },

  // ADMIN/STAFF: update ticket status
  async updateStatus(req, res) {
    try {
      const user = req.user;
      if (user.role !== "ADMIN" && user.role !== "STAFF") {
        return res.status(403).json({ message: "Access denied" });
      }
      const ticketId = req.params.id;
      const { status } = req.body;
      const allowed = ["SOLVED", "UNSOLVED", "HOLD", "IN_PROGRESS", "FAILED"];
      if (!allowed.includes(status))
        return res.status(400).json({ message: "Invalid status" });

      // If STAFF, ensure they are assigned to the ticket
      if (user.role === "STAFF") {
        const isAssigned = await TicketModel.checkIfStaffAssigned(
          ticketId,
          user.id
        );

        if (!isAssigned) {
          return res.status(403).json({
            message: "You are not assigned to this ticket",
          });
        }
      }

      await TicketService.updateTicketStatus({
        ticket_id: ticketId,
        status,
        actor_id: user.id,
      });

      return res.status(200).json({ message: "Status updated" });
    } catch (err) {
      console.error("updateStatus error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  },

  async getActivities(req, res) {
    try {
      const user = req.user;
      const ticketId = req.params.id;
      const ticket = await TicketModel.getTicketById(ticketId);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });

      if (
        user.role !== "ADMIN" &&
        user.role !== "STAFF" &&
        ticket.user_id !== user.id
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      const activities = await TicketModel.getTicketActivities(ticketId);
      return res.status(200).json({ activities });
    } catch (err) {
      console.error("getActivities error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  },

  async getAttachments(req, res) {
    try {
      const user = req.user;
      const ticketId = req.params.id;
      const ticket = await TicketModel.getTicketById(ticketId);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });

      if (
        user.role !== "ADMIN" &&
        user.role !== "STAFF" &&
        ticket.user_id !== user.id
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      const attachments = await TicketModel.getTicketAttachments(ticketId);
      return res.status(200).json({ attachments });
    } catch (err) {
      console.error("getAttachments error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  },

  async getStaffStats(req, res) {
    try {
      const user = req.user;
      if (user.role !== "ADMIN" && user.role !== "STAFF") {
        return res.status(403).json({ message: "Access denied" });
      }
      const staffId = req.params.staffId;
      const stats = await TicketModel.getStaffStats(staffId);
      return res.status(200).json({ stats });
    } catch (err) {
      console.error("getStaffStats error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  },
};

module.exports = TicketController;
