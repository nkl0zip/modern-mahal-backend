const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const {
  findAdminByEmail,
  updateAdminPassword,
} = require("../../models/admin/admin.model");
const { sendEmail } = require("../../utils/mailer");

// Store reset tokens temporarily in memory (for demo)
// For production → use Redis or database table
const resetTokens = new Map();

// Generate JWT for admin
const generateToken = (admin) => {
  return jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
};

// Admin Login
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await findAdminByEmail(email);
    if (!admin) {
      return res
        .status(403)
        .json({ message: "Access denied. Invalid credentials." });
    }

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password." });
    }

    const token = generateToken(admin);

    res.status(200).json({
      message: "Admin login successful.",
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error("Error in adminLogin:", error);
    res.status(500).json({ message: "Server error during login." });
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
      `Click here to reset your password: ${resetLink}`
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

module.exports = {
  adminLogin,
  requestPasswordReset,
  resetPassword,
};
