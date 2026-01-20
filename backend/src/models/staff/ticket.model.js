const pool = require("../../config/db");

const TicketModel = {
  async createTicket({ user_id, title, type, message, priority }) {
    const sql = `
      INSERT INTO tickets (user_id, title, type, message, priority)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [
      user_id,
      title,
      type,
      message,
      priority || null,
    ]);
    return rows[0];
  },

  async getTicketById(id) {
    const sql = `SELECT * FROM tickets WHERE id = $1 AND is_deleted = false;`;
    const { rows } = await pool.query(sql, [id]);
    return rows[0];
  },

  async listUserTickets(user_id, { limit = 20, offset = 0 } = {}) {
    const sql = `
      SELECT * FROM tickets
      WHERE user_id = $1 AND is_deleted = false
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    const { rows } = await pool.query(sql, [user_id, limit, offset]);
    return rows;
  },

  async softDeleteTicket(id, user_id) {
    const sql = `
      UPDATE tickets
      SET is_deleted = true, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [id, user_id]);
    return rows[0];
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
    const sql = `
      INSERT INTO ticket_attachments (ticket_id, uploaded_by, file_url, file_name, file_size_bytes, mime_type, cloudinary_public_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [
      ticket_id,
      uploaded_by || null,
      file_url,
      file_name || null,
      file_size_bytes || null,
      mime_type || null,
      cloudinary_public_id || null,
    ]);
    return rows[0];
  },

  async createActivity({ ticket_id, actor_id, action, action_data = {} }) {
    const sql = `
      INSERT INTO ticket_activity (ticket_id, actor_id, action, action_data)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [
      ticket_id,
      actor_id || null,
      action,
      action_data,
    ]);
    return rows[0];
  },

  async createAssignment({ ticket_id, staff_id, assigned_by }) {
    const sql = `
      INSERT INTO ticket_assignments (ticket_id, staff_id, assigned_by)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [
      ticket_id,
      staff_id,
      assigned_by || null,
    ]);
    return rows[0];
  },

  async endAssignment(assignmentId) {
    // set ended_at, calculate resolution_seconds
    const sql = `
      UPDATE ticket_assignments
      SET ended_at = CURRENT_TIMESTAMP,
          resolution_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - assigned_at))::bigint,
          active = false
      WHERE id = $1 AND active = true
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [assignmentId]);
    return rows[0];
  },

  async deactivateActiveAssignmentsForTicket(ticket_id) {
    const sql = `
      UPDATE ticket_assignments
      SET ended_at = CURRENT_TIMESTAMP,
          resolution_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - assigned_at))::bigint,
          active = false
      WHERE ticket_id = $1 AND active = true
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [ticket_id]);
    return rows;
  },

  async updateTicketAssignedStaff(ticket_id, staff_id) {
    const sql = `
      UPDATE tickets
      SET assigned_staff_id = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [ticket_id, staff_id]);
    return rows[0];
  },

  async getTicketsByAssignedStaff(staff_id) {
    const sql = `
      SELECT * FROM tickets WHERE assigned_staff_id = $1 ORDER BY created_at DESC;
    `;
    const { rows } = await pool.query(sql, [staff_id]);
    return rows;
  },

  async checkIfStaffAssigned(ticket_id, staff_id) {
    const sql = `
    SELECT 1
    FROM tickets
    WHERE id = $1
      AND assigned_staff_id = $2;
  `;
    const { rowCount } = await pool.query(sql, [ticket_id, staff_id]);
    return rowCount > 0;
  },

  async updateTicketStatus(ticket_id, status, closed = false) {
    const sql = `
      UPDATE tickets
      SET status = $2,
          closed_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE closed_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [ticket_id, status, closed]);
    return rows[0];
  },

  async getTicketsByAssignedStaff({
    staff_id,
    filter = {},
    limit = 50,
    offset = 0,
  } = {}) {
    const conditions = ["t.is_deleted = false", "t.assigned_staff_id = $1"];

    const params = [staff_id];
    let idx = 2;

    if (filter.status) {
      conditions.push(`t.status = $${idx++}`);
      params.push(filter.status);
    }

    if (filter.type) {
      conditions.push(`t.type = $${idx++}`);
      params.push(filter.type);
    }

    if (filter.search) {
      conditions.push(`(t.title ILIKE $${idx} OR t.message ILIKE $${idx})`);
      params.push(`%${filter.search}%`);
      idx++;
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const sql = `
    SELECT
      t.id,
      t.title,
      t.type,
      t.status,
      t.priority,
      t.created_at,
      t.updated_at,
      t.user_id,
      t.assigned_staff_id,
      staff.name AS staff_name,
      up.avatar_url,
      COUNT(*) OVER() AS total_count
    FROM tickets t
    LEFT JOIN user_profiles up ON t.user_id = up.user_id
    LEFT JOIN users staff ON t.assigned_staff_id = staff.id
    ${where}
    ORDER BY t.created_at DESC
    LIMIT $${idx++} OFFSET $${idx++};
  `;

    params.push(limit, offset);

    const { rows } = await pool.query(sql, params);

    return {
      total: rows.length ? Number(rows[0].total_count) : 0,
      tickets: rows.map(({ total_count, ...ticket }) => ticket),
    };
  },

  async getAssignmentsSumSeconds(ticket_id) {
    const sql = `
      SELECT COALESCE(SUM(resolution_seconds),0)::bigint as total_seconds
      FROM ticket_assignments
      WHERE ticket_id = $1;
    `;
    const { rows } = await pool.query(sql, [ticket_id]);
    return rows[0].total_seconds;
  },

  async updateTicketTotalResolutionSeconds(ticket_id, seconds) {
    const sql = `
      UPDATE tickets
      SET total_resolution_seconds = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [ticket_id, seconds]);
    return rows[0];
  },

  async listAllTickets({ filter = {}, limit = 50, offset = 0 } = {}) {
    // Basic filter support (status, assigned_staff_id, type)
    const conditions = ["t.is_deleted = false"];
    const params = [];
    let idx = 1;

    if (filter.status) {
      conditions.push(`t.status = $${idx++}`);
      params.push(filter.status);
    }
    if (filter.assigned_staff_id) {
      conditions.push(`t.assigned_staff_id = $${idx++}`);
      params.push(filter.assigned_staff_id);
    }
    if (filter.type) {
      conditions.push(`t.type = $${idx++}`);
      params.push(filter.type);
    }
    if (filter.search) {
      conditions.push(`(t.title ILIKE $${idx} OR t.message ILIKE $${idx})`);
      params.push(`%${filter.search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `
      SELECT
      t.id,
      t.title,
      t.type,
      t.status,
      t.priority,
      t.created_at,
      t.user_id,
      t.assigned_staff_id,
      staff.name as staff_name,
      up.avatar_url,
      COUNT(*) OVER() AS total_count
      FROM tickets t
      LEFT JOIN user_profiles up ON t.user_id = up.user_id
      LEFT JOIN users staff ON t.assigned_staff_id = staff.id
      ${where}
      ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx++};
    `;
    params.push(limit, offset);
    const { rows } = await pool.query(sql, params);
    return {
      total: rows.length ? Number(rows[0].total_count) : 0,
      tickets: rows.map(({ total_count, ...ticket }) => ticket),
    };
  },

  async getTicketDetailsById(ticket_id) {
    const sql = `
      SELECT 
      t.id,
      t.user_id,
      u.name as user_name,
      u.phone as phone_number,
      u.email as email_address,
      up.working_email as work_email_address,
      t.title,
      t.type,
      t.status,
      t.priority,
      t.created_at,
      t.updated_at,
      t.message,
      t.assigned_staff_id,
      staff.name as staff_name
      FROM tickets t
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN user_profiles up ON t.user_id = up.user_id
      LEFT JOIN users staff ON t.assigned_staff_id = staff.id
      WHERE t.id = $1 AND t.is_deleted = false;
    `;

    const { rows } = await pool.query(sql, [ticket_id]);
    return rows[0];
  },

  async getTicketActivities(ticket_id) {
    const sql = `
      SELECT * FROM ticket_activity
      WHERE ticket_id = $1
      ORDER BY created_at ASC;
    `;
    const { rows } = await pool.query(sql, [ticket_id]);
    return rows;
  },

  async getTicketAttachments(ticket_id) {
    const sql = `
      SELECT * FROM ticket_attachments
      WHERE ticket_id = $1
      ORDER BY created_at ASC;
    `;
    const { rows } = await pool.query(sql, [ticket_id]);
    return rows;
  },

  async getStaffStats(staff_id) {
    // solved and unsolved counts and avg resolution
    const sql = `
      SELECT
        SUM(CASE WHEN t.status = 'SOLVED' THEN 1 ELSE 0 END) as solved_count,
        SUM(CASE WHEN t.status != 'SOLVED' THEN 1 ELSE 0 END) as unsolved_count,
        CASE WHEN SUM(CASE WHEN t.status = 'SOLVED' THEN 1 ELSE 0 END) = 0 THEN NULL
             ELSE AVG(t.total_resolution_seconds)::numeric END as avg_resolution_seconds
      FROM tickets t
      WHERE t.assigned_staff_id = $1;
    `;
    const { rows } = await pool.query(sql, [staff_id]);
    return rows[0];
  },

  // Additional helper: create activity in the same transaction scope (not necessary but convenience)
};

module.exports = TicketModel;
