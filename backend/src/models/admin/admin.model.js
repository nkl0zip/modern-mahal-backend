const pool = require("../../config/db");
const bcrypt = require("bcryptjs");

// Creating Admin if does not exists
const ensureAdminAccount = async () => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME;

    if (!adminEmail || !adminPassword) {
      console.error("ADMIN_EMAIL or ADMIN_PASSWORD missing in .env");
      return;
    }

    // Check if admin already exists
    const checkQuery = `SELECT id FROM users WHERE email = $1 AND role = 'ADMIN' LIMIT 1`;
    const { rows } = await pool.query(checkQuery, [adminEmail]);

    if (rows.length > 0) {
      console.log("Admin already exists: ", adminEmail);
      return;
    }

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(adminPassword, saltRounds);

    const insertQuery = `
      INSERT INTO users (name, email, password_hash, role, is_verified)
      VALUES ($1, $2, $3, 'ADMIN', TRUE)
      RETURNING id, name, email, role;
    `;
    const result = await pool.query(insertQuery, [
      adminName,
      adminEmail,
      hashedPassword,
    ]);
    console.log("Admin account created: ", result.rows[0].email);
  } catch (error) {
    console.error("Error creating admin: ", error);
  }
};

// Find admin by email
const findAdminByEmail = async (email) => {
  const query = `SELECT * FROM users WHERE email = $1 AND role = 'ADMIN' LIMIT 1`;
  const result = await pool.query(query, [email]);
  return result.rows[0];
};

// Find admin by ID
const findAdminById = async (id) => {
  const query = `SELECT * FROM users WHERE id = $1 AND role = 'ADMIN' LIMIT 1`;
  const result = await pool.query(query, [id]);
  return result.rows[0];
};

// Update admin password
const updateAdminPassword = async (email, newHashedPassword) => {
  const query = `UPDATE users SET password_hash = $1 WHERE email = $2 AND role = 'ADMIN'`;
  await pool.query(query, [newHashedPassword, email]);
};

/**
 * TOTP Methods - 2FA
 */
const enableTotp = async (userId, secret) => {
  await pool.query(
    `UPDATE users SET totp_secret = $1, totp_enabled = true WHERE id = $2 AND role = 'ADMIN'`,
    [secret, userId],
  );
};

const getTotpSecret = async (userId) => {
  const { rows } = await pool.query(
    `SELECT totp_secret FROM users WHERE id = $1 AND role = 'ADMIN'`,
    [userId],
  );
  return rows[0]?.totp_secret;
};

const isTotpEnabled = async (userId) => {
  const { rows } = await pool.query(
    `SELECT totp_enabled FROM users WHERE id = $1 AND role = 'ADMIN'`,
    [userId],
  );
  return rows[0]?.totp_enabled === true;
};

const saveBackupCodes = async (userId, codes) => {
  await pool.query(
    `UPDATE users SET totp_backup_codes = $1 WHERE id = $2 AND role = 'ADMIN'`,
    [JSON.stringify(codes), userId],
  );
};

const verifyBackupCode = async (userId, code) => {
  const { rows } = await pool.query(
    `SELECT totp_backup_codes FROM users WHERE id = $1 AND role = 'ADMIN'`,
    [userId],
  );
  const codes = rows[0]?.totp_backup_codes || [];
  const index = codes.indexOf(code);
  if (index !== -1) {
    codes.splice(index, 1);
    await pool.query(
      `UPDATE users SET totp_backup_codes = $1 WHERE id = $2 AND role = 'ADMIN'`,
      [JSON.stringify(codes), userId],
    );
    return true;
  }
  return false;
};

module.exports = {
  ensureAdminAccount,
  findAdminByEmail,
  findAdminById,
  updateAdminPassword,
  enableTotp,
  getTotpSecret,
  isTotpEnabled,
  saveBackupCodes,
  verifyBackupCode,
};
