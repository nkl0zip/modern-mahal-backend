const pool = require("../../config/db");
const crypto = require("crypto");
const speakeasy = require("speakeasy");

// Find sub-admin by email
const findSubAdminByEmail = async (email) => {
  const query = `SELECT * FROM users WHERE email = $1 AND role = 'SUB_ADMIN' LIMIT 1`;
  const { rows } = await pool.query(query, [email]);
  return rows[0];
};

// Update password
const updateSubAdminPassword = async (userId, hashedPassword) => {
  const query = `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND role = 'SUB_ADMIN'`;
  await pool.query(query, [hashedPassword, userId]);
};

// ---------- Password Reset ----------
const createPasswordResetToken = async (userId) => {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  const query = `
    INSERT INTO sub_admin_password_resets (user_id, token, expires_at)
    VALUES ($1, $2, $3)
    RETURNING token
  `;
  const { rows } = await pool.query(query, [userId, token, expiresAt]);
  return rows[0].token;
};

const findValidResetToken = async (token) => {
  const query = `
    SELECT * FROM sub_admin_password_resets
    WHERE token = $1 AND used = false AND expires_at > NOW()
    LIMIT 1
  `;
  const { rows } = await pool.query(query, [token]);
  return rows[0];
};

const markResetTokenUsed = async (tokenId) => {
  await pool.query(
    `UPDATE sub_admin_password_resets SET used = true WHERE id = $1`,
    [tokenId],
  );
};

// ---------- OTP 2FA ----------
const createOtp = async (userId, otpCode) => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  const query = `
    INSERT INTO sub_admin_otps (user_id, otp_code, expires_at)
    VALUES ($1, $2, $3)
    RETURNING id
  `;
  const { rows } = await pool.query(query, [userId, otpCode, expiresAt]);
  return rows[0].id;
};

const verifyOtp = async (userId, otpCode) => {
  // Find latest unused, non-expired OTP
  const query = `
    SELECT id, attempts FROM sub_admin_otps
    WHERE user_id = $1 AND otp_code = $2 AND used = false AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const { rows } = await pool.query(query, [userId, otpCode]);
  if (rows.length === 0) return false;

  const otp = rows[0];
  if (otp.attempts >= 3) {
    // Mark as used to block further attempts
    await pool.query(`UPDATE sub_admin_otps SET used = true WHERE id = $1`, [
      otp.id,
    ]);
    return false;
  }

  // Increment attempts
  await pool.query(
    `UPDATE sub_admin_otps SET attempts = attempts + 1 WHERE id = $1`,
    [otp.id],
  );

  // Success
  await pool.query(`UPDATE sub_admin_otps SET used = true WHERE id = $1`, [
    otp.id,
  ]);
  return true;
};

// Delete all expired OTPs (optional cleanup – run via cron)
const deleteExpiredOtps = async () => {
  await pool.query(`DELETE FROM sub_admin_otps WHERE expires_at < NOW()`);
};

// TOTP helpers
const getSubAdminById = async (id) => {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE id = $1 AND role = 'SUB_ADMIN'`,
    [id],
  );
  return rows[0];
};

const enableTotp = async (userId, secret) => {
  await pool.query(
    `UPDATE users SET totp_secret = $1, totp_enabled = true WHERE id = $2`,
    [secret, userId],
  );
};

const getTotpSecret = async (userId) => {
  const { rows } = await pool.query(
    `SELECT totp_secret FROM users WHERE id = $1 AND role = 'SUB_ADMIN'`,
    [userId],
  );
  return rows[0]?.totp_secret;
};

const isTotpEnabled = async (userId) => {
  const { rows } = await pool.query(
    `SELECT totp_enabled FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.totp_enabled === true;
};

const saveBackupCodes = async (userId, codes) => {
  await pool.query(`UPDATE users SET totp_backup_codes = $1 WHERE id = $2`, [
    JSON.stringify(codes),
    userId,
  ]);
};

const verifyBackupCode = async (userId, code) => {
  const { rows } = await pool.query(
    `SELECT totp_backup_codes FROM users WHERE id = $1`,
    [userId],
  );
  const codes = rows[0]?.totp_backup_codes || [];
  const index = codes.indexOf(code);
  if (index !== -1) {
    codes.splice(index, 1);
    await pool.query(`UPDATE users SET totp_backup_codes = $1 WHERE id = $2`, [
      JSON.stringify(codes),
      userId,
    ]);
    return true;
  }
  return false;
};

module.exports = {
  findSubAdminByEmail,
  updateSubAdminPassword,
  createPasswordResetToken,
  findValidResetToken,
  markResetTokenUsed,
  getSubAdminById,
  enableTotp,
  getTotpSecret,
  isTotpEnabled,
  saveBackupCodes,
  verifyBackupCode,
  createOtp,
  verifyOtp,
};
