const pool = require("../../config/db");

/**
 * Allowed (global) office IPs
 */
const addAllowedIp = async ({ ip_address, description, created_by }) => {
  const q = `
    INSERT INTO allowed_ips (ip_address, description, created_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (ip_address) DO NOTHING
    RETURNING *;
  `;
  const { rows } = await pool.query(q, [
    ip_address,
    description || null,
    created_by || null,
  ]);
  return rows[0] || null;
};

const listAllowedIps = async () => {
  const { rows } = await pool.query(
    `SELECT * FROM allowed_ips ORDER BY created_at DESC;`
  );
  return rows;
};

const deleteAllowedIp = async (id) => {
  const { rows } = await pool.query(
    `DELETE FROM allowed_ips WHERE id = $1 RETURNING *;`,
    [id]
  );
  return rows[0] || null;
};

const findAllowedIp = async (ip_address) => {
  const { rows } = await pool.query(
    `SELECT * FROM allowed_ips WHERE ip_address = $1 LIMIT 1;`,
    [ip_address]
  );
  return rows[0] || null;
};

/**
 * Staff IP requests (pending -> admin approves/rejects)
 */
const createStaffIpRequest = async ({ staff_id, ip_address, reason }) => {
  const q = `
    INSERT INTO staff_ip_requests (staff_id, ip_address, reason)
    VALUES ($1, $2, $3)
    ON CONFLICT (staff_id, ip_address) DO UPDATE
      SET status = EXCLUDED.status, reason = EXCLUDED.reason
    RETURNING *;
  `;
  const { rows } = await pool.query(q, [staff_id, ip_address, reason || null]);
  return rows[0];
};

const getPendingRequests = async () => {
  const q = `
    SELECT r.*, u.name as staff_name, u.email as staff_email
    FROM staff_ip_requests r
    JOIN users u ON r.staff_id = u.id
    WHERE r.status = 'PENDING'
    ORDER BY r.created_at DESC;
  `;
  const { rows } = await pool.query(q);
  return rows;
};

const findStaffIpRequest = async ({ staff_id, ip_address }) => {
  const { rows } = await pool.query(
    `SELECT * FROM staff_ip_requests WHERE staff_id = $1 AND ip_address = $2 LIMIT 1;`,
    [staff_id, ip_address]
  );
  return rows[0] || null;
};

const updateStaffIpRequestStatus = async ({
  request_id,
  status,
  reviewed_by,
}) => {
  const q = `
    UPDATE staff_ip_requests
    SET status = $1, reviewed_by = $2, reviewed_at = NOW()
    WHERE id = $3
    RETURNING *;
  `;
  const { rows } = await pool.query(q, [
    status,
    reviewed_by || null,
    request_id,
  ]);
  return rows[0] || null;
};

/**
 * Staff-per-IP approvals (granted access)
 */
const addStaffIpAccess = async ({
  staff_id,
  ip_address,
  access_level = "RESTRICTED",
  approved_by,
}) => {
  const q = `
    INSERT INTO staff_ip_access (staff_id, ip_address, access_level, approved_by)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (staff_id, ip_address) DO UPDATE
    SET access_level = EXCLUDED.access_level, approved_by = EXCLUDED.approved_by, approved_at = NOW()
    RETURNING *;
  `;
  const { rows } = await pool.query(q, [
    staff_id,
    ip_address,
    access_level,
    approved_by || null,
  ]);
  return rows[0];
};

const findStaffIpAccess = async ({ staff_id, ip_address }) => {
  const { rows } = await pool.query(
    `SELECT * FROM staff_ip_access WHERE staff_id = $1 AND ip_address = $2 LIMIT 1;`,
    [staff_id, ip_address]
  );
  return rows[0] || null;
};

const listStaffIpAccess = async () => {
  const { rows } = await pool.query(
    `SELECT * FROM staff_ip_access ORDER BY created_at DESC;`
  );
  return rows;
};

const deleteStaffIpAccess = async (id) => {
  const { rows } = await pool.query(
    `DELETE FROM staff_ip_access WHERE id = $1 RETURNING *;`,
    [id]
  );
  return rows[0] || null;
};

module.exports = {
  // allowed_ips
  addAllowedIp,
  listAllowedIps,
  deleteAllowedIp,
  findAllowedIp,

  // staff_ip_requests
  createStaffIpRequest,
  getPendingRequests,
  findStaffIpRequest,
  updateStaffIpRequestStatus,

  // staff_ip_access
  addStaffIpAccess,
  findStaffIpAccess,
  listStaffIpAccess,
  deleteStaffIpAccess,
};
