const pool = require("../config/db");
const TicketModel = require("../models/staff/ticket.model");

const TicketService = {
  async createTicket({ user_id, title, type, message, priority, attachment }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const insertTicketSql = `
        INSERT INTO tickets (user_id, title, type, message, priority)
        VALUES ($1, $2, $3, $4, $5) RETURNING *;
      `;
      const { rows } = await client.query(insertTicketSql, [
        user_id,
        title,
        type,
        message,
        priority || null,
      ]);
      const ticket = rows[0];

      // activity: created
      const createActivitySql = `
        INSERT INTO ticket_activity (ticket_id, actor_id, action, action_data)
        VALUES ($1, $2, $3, $4);
      `;
      await client.query(createActivitySql, [
        ticket.id,
        user_id,
        "CREATED",
        { title },
      ]);

      // optionally store attachment (we may already have uploaded to cloudinary in controller)
      if (attachment) {
        const insertAttachSql = `
          INSERT INTO ticket_attachments (ticket_id, uploaded_by, file_url, file_name, file_size_bytes, mime_type, cloudinary_public_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7);
        `;
        await client.query(insertAttachSql, [
          ticket.id,
          user_id,
          attachment.file_url,
          attachment.file_name,
          attachment.file_size_bytes,
          attachment.mime_type,
          attachment.cloudinary_public_id,
        ]);
        // activity: attachment
        await client.query(createActivitySql, [
          ticket.id,
          user_id,
          "ATTACHMENT_ADDED",
          { file_name: attachment.file_name },
        ]);
      }

      await client.query("COMMIT");
      return ticket;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async assignTicket({ ticket_id, staff_id, assigned_by }) {
    // Assign ticket to staff: deactivate current active assignments, end them with resolution_seconds,
    // create new assignment, update tickets.assigned_staff_id and add activity
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // mark previous active assignments ended
      const deactivateSql = `
        UPDATE ticket_assignments
        SET ended_at = CURRENT_TIMESTAMP,
            resolution_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - assigned_at))::bigint,
            active = false
        WHERE ticket_id = $1 AND active = true
        RETURNING *;
      `;
      const deactRes = await client.query(deactivateSql, [ticket_id]);

      // create new assignment
      const createAssignSql = `
        INSERT INTO ticket_assignments (ticket_id, staff_id, assigned_by)
        VALUES ($1, $2, $3)
        RETURNING *;
      `;
      const assignRes = await client.query(createAssignSql, [
        ticket_id,
        staff_id,
        assigned_by || null,
      ]);
      const newAssignment = assignRes.rows[0];

      // update ticket assigned_staff_id
      const updateTicketSql = `
        UPDATE tickets
        SET assigned_staff_id = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *;
      `;
      await client.query(updateTicketSql, [ticket_id, staff_id]);

      // add activity
      const activitySql = `
        INSERT INTO ticket_activity (ticket_id, actor_id, action, action_data)
        VALUES ($1, $2, 'ASSIGNED', $3);
      `;
      await client.query(activitySql, [
        ticket_id,
        assigned_by || null,
        { to: staff_id },
      ]);

      await client.query("COMMIT");
      return newAssignment;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async transferTicket({
    ticket_id,
    from_staff_id,
    to_staff_id,
    transferred_by,
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // End current active assignment(s)
      const endSql = `
        UPDATE ticket_assignments
        SET ended_at = CURRENT_TIMESTAMP,
            resolution_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - assigned_at))::bigint,
            active = false
        WHERE ticket_id = $1 AND active = true
        RETURNING *;
      `;
      await client.query(endSql, [ticket_id]);

      // create new assignment for target staff
      const createAssignSql = `
        INSERT INTO ticket_assignments (ticket_id, staff_id, assigned_by)
        VALUES ($1, $2, $3)
        RETURNING *;
      `;
      const assignRes = await client.query(createAssignSql, [
        ticket_id,
        to_staff_id,
        transferred_by || null,
      ]);
      const newAssignment = assignRes.rows[0];

      // update ticket assigned_staff_id
      const updateTicketSql = `
        UPDATE tickets
        SET assigned_staff_id = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1;
      `;
      await client.query(updateTicketSql, [ticket_id, to_staff_id]);

      // add activity
      const activitySql = `
        INSERT INTO ticket_activity (ticket_id, actor_id, action, action_data)
        VALUES ($1, $2, 'TRANSFERRED', $3);
      `;
      await client.query(activitySql, [
        ticket_id,
        transferred_by || null,
        { from: from_staff_id, to: to_staff_id },
      ]);

      await client.query("COMMIT");
      return newAssignment;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async updateTicketStatus({ ticket_id, status, actor_id }) {
    // If SOLVED: end active assignment, compute assignment resolution_seconds, then sum all assignments and set closed_at and total_resolution_seconds.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (status === "SOLVED") {
        // end active assignments if any
        const endSql = `
          UPDATE ticket_assignments
          SET ended_at = CURRENT_TIMESTAMP,
              resolution_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - assigned_at))::bigint,
              active = false
          WHERE ticket_id = $1 AND active = true
          RETURNING *;
        `;
        await client.query(endSql, [ticket_id]);

        // set ticket status + closed_at
        const updateTicketSql = `
          UPDATE tickets
          SET status = $2, closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *;
        `;
        await client.query(updateTicketSql, [ticket_id, status]);

        // compute total seconds
        const sumSql = `
          SELECT COALESCE(SUM(resolution_seconds),0)::bigint AS total_seconds
          FROM ticket_assignments
          WHERE ticket_id = $1;
        `;
        const sumRes = await client.query(sumSql, [ticket_id]);
        const totalSeconds = sumRes.rows[0].total_seconds || 0;

        const updateTotalSql = `
          UPDATE tickets
          SET total_resolution_seconds = $2
          WHERE id = $1;
        `;
        await client.query(updateTotalSql, [ticket_id, totalSeconds]);
      } else {
        // For other statuses: just update status
        const updateTicketSql = `
          UPDATE tickets
          SET status = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1;
        `;
        await client.query(updateTicketSql, [ticket_id, status]);
      }

      // activity log
      const activitySql = `
        INSERT INTO ticket_activity (ticket_id, actor_id, action, action_data)
        VALUES ($1, $2, 'STATUS_UPDATED', $3);
      `;
      await client.query(activitySql, [
        ticket_id,
        actor_id || null,
        { status },
      ]);

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async addAttachment({
    ticket_id,
    uploaded_by,
    file_url,
    file_name,
    file_size_bytes,
    mime_type,
    cloudinary_public_id,
  }) {
    // simple insertion
    return TicketModel.addAttachment({
      ticket_id,
      uploaded_by,
      file_url,
      file_name,
      file_size_bytes,
      mime_type,
      cloudinary_public_id,
    });
  },

  async getTicketDetail(ticket_id) {
    const ticket = await TicketModel.getTicketById(ticket_id);
    if (!ticket) return null;
    const activities = await TicketModel.getTicketActivities(ticket_id);
    const attachments = await TicketModel.getTicketAttachments(ticket_id);
    return { ticket, activities, attachments };
  },

  async listAllTickets(opts) {
    return TicketModel.listAllTickets(opts);
  },

  async getStaffStats(staff_id) {
    return TicketModel.getStaffStats(staff_id);
  },

  // additional helpers if needed...
};

module.exports = TicketService;
