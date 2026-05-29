const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const crypto = require("crypto");
const { jwtSecret, jwtExpire } = require("../../config/jwt");
const { sendEmail } = require("../../utils/mailer");
const pool = require("../../config/db");
const { blacklistToken } = require("../../models/admin/token.model");
const {
  findSubAdminByEmail,
  updateSubAdminPassword,
  createPasswordResetToken,
  findValidResetToken,
  markResetTokenUsed,
  getSubAdminById,
  enableTotp,
  saveBackupCodes,
  verifyBackupCode,
  isTotpEnabled,
} = require("../../models/sub-admin/sub-admin.model");

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    jwtSecret,
    { expiresIn: jwtExpire || "1d" },
  );
};

// Step 1: Login – verify password, then check TOTP status
const subAdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const subAdmin = await findSubAdminByEmail(email);
    if (!subAdmin) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, subAdmin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const totpEnabled = subAdmin.totp_enabled === true;

    // If TOTP not enabled, we return QR code for setup
    if (!totpEnabled) {
      // Generate a new TOTP secret for this user
      const secret = speakeasy.generateSecret({
        length: 20,
        name: `ModernMahal:${subAdmin.email}`,
        issuer: "ModernMahal",
      });

      const otpauthUrl = secret.otpauth_url;
      const qrCode = await QRCode.toDataURL(otpauthUrl);

      // Store secret in DB (not enabled yet)
      await pool.query(`UPDATE users SET totp_secret = $1 WHERE id = $2`, [
        secret.base32,
        subAdmin.id,
      ]);

      // Create temp token for setup session
      const tempToken = jwt.sign(
        { id: subAdmin.id, email: subAdmin.email, purpose: "totp_setup" },
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
      { id: subAdmin.id, email: subAdmin.email, purpose: "totp_verify" },
      jwtSecret,
      { expiresIn: "5m" },
    );

    res.status(200).json({
      message: "2FA enabled. Please provide TOTP code.",
      requiresTotp: true,
      tempToken,
    });
  } catch (error) {
    console.error("Login error:", error);
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

    const subAdmin = await getSubAdminById(decoded.id);
    if (!subAdmin) {
      return res.status(401).json({ message: "User not found" });
    }

    const secret = subAdmin.totp_secret;
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
      const backupValid = await verifyBackupCode(subAdmin.id, otpCode);
      if (!backupValid) {
        return res.status(401).json({ message: "Invalid TOTP or backup code" });
      }
      backupUsed = true;
    }

    // If this was a setup session, enable TOTP
    if (decoded.purpose === "totp_setup") {
      await enableTotp(subAdmin.id, secret);

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
      await saveBackupCodes(subAdmin.id, backupCodes);

      const finalToken = generateToken(subAdmin);

      return res.status(200).json({
        message: "2FA enabled successfully",
        token: finalToken,
        backupCodes: backupCodes,
        subAdmin: {
          id: subAdmin.id,
          name: subAdmin.name,
          email: subAdmin.email,
          role: subAdmin.role,
        },
      });
    }

    // Normal login after TOTP verification
    const finalToken = generateToken(subAdmin);
    res.status(200).json({
      message: "Login successful",
      token: finalToken,
      subAdmin: {
        id: subAdmin.id,
        name: subAdmin.name,
        email: subAdmin.email,
        role: subAdmin.role,
      },
    });
  } catch (error) {
    console.error("TOTP verify error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Request password reset
const requestSubAdminPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const subAdmin = await findSubAdminByEmail(email);
    if (!subAdmin) {
      return res
        .status(200)
        .json({ message: "If the email exists, a reset link has been sent." });
    }

    const token = await createPasswordResetToken(subAdmin.id);
    const resetLink = `${process.env.FRONTEND_URL || "http://localhost:3000"}/sub-admin/reset-password?token=${token}&email=${email}`;

    await sendEmail(
      subAdmin.email,
      "Sub-Admin Password Reset",
      `Click here to reset your password: ${resetLink}\n\nThis link expires in 1 hour.`,
    );

    res
      .status(200)
      .json({ message: "Password reset link sent to your email." });
  } catch (error) {
    console.error("Request Reset Error:", error);
    res.status(500).json({ message: "Server error sending reset link" });
  }
};

// Reset password using token
const resetSubAdminPassword = async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res
        .status(400)
        .json({ message: "Token and new password are required" });
    }

    if (new_password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const resetRecord = await findValidResetToken(token);
    if (!resetRecord) {
      return res
        .status(400)
        .json({ message: "Invalid or expired reset token" });
    }

    const hashedPassword = await bcrypt.hash(new_password, 12);
    await updateSubAdminPassword(resetRecord.user_id, hashedPassword);
    await markResetTokenUsed(resetRecord.id);

    res
      .status(200)
      .json({ message: "Password reset successful. You can now log in." });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ message: "Server error resetting password" });
  }
};

// Logout
const subAdminLogout = async (req, res) => {
  try {
    if (req.token) {
      const decoded = req.user;
      const expiresAt = new Date(decoded.exp * 1000);
      await blacklistToken(req.token, expiresAt);
    }
    res.status(200).json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout Error:", err);
    res.status(500).json({ message: "Server error during logout" });
  }
};

module.exports = {
  subAdminLogin,
  verifyTotpAndLogin,
  requestSubAdminPasswordReset,
  resetSubAdminPassword,
  subAdminLogout,
};
