const bcrypt = require("bcryptjs");
const pool = require("../../config/db");
const jwt = require("jsonwebtoken");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const crypto = require("crypto");

const { jwtSecret, jwtExpire } = require("../../config/jwt");

const {
  findAdminByEmail,
  findAdminById,
  updateAdminPassword,
  enableTotp,
  getTotpSecret,
  isTotpEnabled,
  saveBackupCodes,
  verifyBackupCode,
} = require("../../models/admin/admin.model");
const { sendEmail } = require("../../utils/mailer");

const { blacklistToken } = require("../../models/admin/token.model");

// Store reset tokens temporarily in memory (for demo)
// For production → use Redis or database table
const resetTokens = new Map();

// Generate JWT for admin
const generateToken = (admin) => {
  return jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role },
    jwtSecret,
    { expiresIn: jwtExpire || "1d" },
  );
};

// Step 1: Login – verify password, then check TOTP status
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const admin = await findAdminByEmail(email);
    if (!admin) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const totpEnabled = admin.totp_enabled === true;

    // If TOTP not enabled, we return QR code for setup
    if (!totpEnabled) {
      // Generate a new TOTP secret for this admin
      const secret = speakeasy.generateSecret({
        length: 20,
        name: `ModernMahal:${admin.email}`,
        issuer: "ModernMahal",
      });

      const otpauthUrl = secret.otpauth_url;
      const qrCode = await QRCode.toDataURL(otpauthUrl);

      // Store secret in DB (not enabled yet)
      await pool.query(`UPDATE users SET totp_secret = $1 WHERE id = $2`, [
        secret.base32,
        admin.id,
      ]);

      // Create temp token for setup session
      const tempToken = jwt.sign(
        { id: admin.id, email: admin.email, purpose: "totp_setup" },
        jwtSecret,
        { expiresIn: "15m" },
      );

      return res.status(200).json({
        message:
          "2FA not enabled. Please scan QR code with Google Authenticator.",
        requiresTotpSetup: true,
        tempToken,
        qrCode,
        secret: secret.base32,
      });
    }

    // TOTP is enabled → return temp token for verification
    const tempToken = jwt.sign(
      { id: admin.id, email: admin.email, purpose: "totp_verify" },
      jwtSecret,
      { expiresIn: "5m" },
    );

    res.status(200).json({
      message: "2FA enabled. Please provide TOTP code.",
      requiresTotp: true,
      tempToken,
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Step 2: Verify TOTP and either setup or login
const verifyTotpAndLogin = async (req, res) => {
  try {
    const { tempToken, otpCode } = req.body;
    if (!tempToken || !otpCode) {
      return res
        .status(400)
        .json({ message: "Temp token and OTP code required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, jwtSecret);
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired temp token" });
    }

    const admin = await findAdminById(decoded.id);
    if (!admin) {
      return res.status(401).json({ message: "User not found" });
    }

    const secret = admin.totp_secret;
    if (!secret) {
      return res
        .status(400)
        .json({ message: "TOTP not set up. Please login again." });
    }

    // Verify TOTP with proper parameters
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: "base32",
      token: otpCode,
      window: 2, // Allow 2 steps before/after (30 seconds each = 1 min tolerance)
    });

    let backupUsed = false;
    if (!verified) {
      // Try backup codes
      const backupValid = await verifyBackupCode(admin.id, otpCode);
      if (!backupValid) {
        return res.status(401).json({ message: "Invalid TOTP or backup code" });
      }
      backupUsed = true;
    }

    // If this was a setup session, enable TOTP
    if (decoded.purpose === "totp_setup") {
      await enableTotp(admin.id, secret);

      // Generate backup codes
      const backupCodes = Array(8)
        .fill()
        .map(() => {
          return crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()
            .slice(0, 8);
        });
      await saveBackupCodes(admin.id, backupCodes);

      const finalToken = generateToken(admin);

      return res.status(200).json({
        message: "2FA enabled successfully",
        token: finalToken,
        backupCodes: backupCodes,
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
        },
      });
    }

    // Normal login after TOTP verification
    const finalToken = generateToken(admin);
    res.status(200).json({
      message: "Login successful",
      token: finalToken,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error("TOTP verify error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// NEED TO SETUP
// Request Password Reset (send secure token to email)
const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    const admin = await findAdminByEmail(email);
    if (!admin) {
      return res.status(404).json({ message: "Admin account not found." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    resetTokens.set(email, token);

    const resetLink = `${process.env.FRONTEND_URL}/admin/reset-password?token=${token}&email=${email}`;
    await sendEmail(
      email,
      "Admin Password Reset",
      `Click here to reset your password: ${resetLink}`,
    );

    res
      .status(200)
      .json({ message: "Password reset link sent to admin email." });
  } catch (error) {
    console.error("Error in requestPasswordReset:", error);
    res.status(500).json({ message: "Server error sending reset link." });
  }
};

// Reset Password
const resetPassword = async (req, res) => {
  try {
    const { email, token, new_password } = req.body;

    const storedToken = resetTokens.get(email);
    if (!storedToken || storedToken !== token) {
      return res.status(400).json({ message: "Invalid or expired token." });
    }

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(new_password, saltRounds);

    await updateAdminPassword(email, hashedPassword);

    // Remove token after successful reset
    resetTokens.delete(email);

    res.status(200).json({ message: "Password reset successfully." });
  } catch (error) {
    console.error("Error in resetPassword:", error);
    res.status(500).json({ message: "Server error resetting password." });
  }
};

// Logout Admin and Blacklist the token used by that admin till its expired
const adminLogoutHandler = async (req, res, next) => {
  try {
    const token = req.token;
    const decoded = req.user;

    const expiresAt = new Date(decoded.exp * 1000);

    await blacklistToken(token, expiresAt);

    return res.status(200).json({
      success: true,
      message: "Admin logged out successfully.",
    });
  } catch (err) {
    console.error("Admin Logout Error: ", err);
    next(err);
  }
};

// Disable 2FA for Admin (requires current TOTP verification)
const disableTotpHandler = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { otpCode } = req.body;

    if (!otpCode) {
      return res.status(400).json({ message: "TOTP code is required" });
    }

    const admin = await findAdminById(adminId);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const secret = admin.totp_secret;
    if (!secret) {
      return res.status(400).json({ message: "2FA is not enabled" });
    }

    // Verify TOTP before disabling
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: "base32",
      token: otpCode,
      window: 2,
    });

    if (!verified) {
      // Try backup codes
      const backupValid = await verifyBackupCode(adminId, otpCode);
      if (!backupValid) {
        return res.status(401).json({ message: "Invalid TOTP code" });
      }
    }

    // Disable TOTP
    await pool.query(
      `UPDATE users SET totp_secret = NULL, totp_enabled = false, totp_backup_codes = '[]' WHERE id = $1 AND role = 'ADMIN'`,
      [adminId],
    );

    res.status(200).json({
      message: "2FA disabled successfully",
    });
  } catch (error) {
    console.error("Disable TOTP error:", error);
    res.status(500).json({ message: "Server error disabling 2FA" });
  }
};

// Get 2FA status
const getTotpStatusHandler = async (req, res) => {
  try {
    const adminId = req.user.id;
    const totpEnabled = await isTotpEnabled(adminId);

    res.status(200).json({
      totpEnabled,
      message: totpEnabled ? "2FA is enabled" : "2FA is not enabled",
    });
  } catch (error) {
    console.error("Get TOTP status error:", error);
    res.status(500).json({ message: "Server error fetching 2FA status" });
  }
};

// Regenerate backup codes
const regenerateBackupCodesHandler = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { otpCode } = req.body;

    if (!otpCode) {
      return res.status(400).json({ message: "TOTP code is required" });
    }

    const admin = await findAdminById(adminId);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const secret = admin.totp_secret;
    if (!secret) {
      return res.status(400).json({ message: "2FA is not enabled" });
    }

    // Verify TOTP
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: "base32",
      token: otpCode,
      window: 2,
    });

    if (!verified) {
      // Try backup codes
      const backupValid = await verifyBackupCode(adminId, otpCode);
      if (!backupValid) {
        return res.status(401).json({ message: "Invalid TOTP code" });
      }
    }

    // Generate new backup codes
    const backupCodes = Array(8)
      .fill()
      .map(() => {
        return crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
      });
    await saveBackupCodes(adminId, backupCodes);

    res.status(200).json({
      message: "Backup codes regenerated successfully",
      backupCodes,
    });
  } catch (error) {
    console.error("Regenerate backup codes error:", error);
    res.status(500).json({ message: "Server error regenerating backup codes" });
  }
};

// Get backup codes (requires TOTP verification)
const getBackupCodesHandler = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { otpCode } = req.body;

    if (!otpCode) {
      return res.status(400).json({ message: "TOTP code is required" });
    }

    const admin = await findAdminById(adminId);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const secret = admin.totp_secret;
    if (!secret) {
      return res.status(400).json({ message: "2FA is not enabled" });
    }

    // Verify TOTP
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: "base32",
      token: otpCode,
      window: 2,
    });

    if (!verified) {
      return res.status(401).json({ message: "Invalid TOTP code" });
    }

    // Get backup codes
    const { rows } = await pool.query(
      `SELECT totp_backup_codes FROM users WHERE id = $1 AND role = 'ADMIN'`,
      [adminId],
    );

    res.status(200).json({
      backupCodes: rows[0]?.totp_backup_codes || [],
    });
  } catch (error) {
    console.error("Get backup codes error:", error);
    res.status(500).json({ message: "Server error fetching backup codes" });
  }
};

// Update admin password (requires TOTP verification)
const updateAdminPasswordHandler = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { currentPassword, newPassword, otpCode } = req.body;

    if (!currentPassword || !newPassword || !otpCode) {
      return res.status(400).json({
        message: "Current password, new password, and TOTP code are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "New password must be at least 6 characters",
      });
    }

    const admin = await findAdminById(adminId);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    // Verify TOTP
    const secret = admin.totp_secret;
    if (!secret) {
      return res.status(400).json({ message: "2FA is not enabled" });
    }

    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: "base32",
      token: otpCode,
      window: 2,
    });

    if (!verified) {
      // Try backup codes
      const backupValid = await verifyBackupCode(adminId, otpCode);
      if (!backupValid) {
        return res.status(401).json({ message: "Invalid TOTP code" });
      }
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await updateAdminPassword(adminId, hashedPassword);

    res.status(200).json({
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Update password error:", error);
    res.status(500).json({ message: "Server error updating password" });
  }
};

module.exports = {
  adminLogin,
  verifyTotpAndLogin,
  requestPasswordReset,
  resetPassword,
  adminLogoutHandler,
  disableTotpHandler,
  getTotpStatusHandler,
  regenerateBackupCodesHandler,
  getBackupCodesHandler,
};
