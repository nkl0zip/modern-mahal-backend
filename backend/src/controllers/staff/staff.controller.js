const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const {
  createStaff,
  findStaffByEmail,
  findStaffById,
  updateStaffPassword,
  deleteStaffById,
  listStaff,
} = require("../../models/staff/staff.model");

// Helper: generate secure random password
const generateTempPassword = (length = 12) => {
  return crypto
    .randomBytes(Math.ceil(length * 0.75))
    .toString("base64")
    .slice(0, length);
};

/**
 * Admin-only: Create a new staff account
 * Request body: { name, email, phone, tempPassword(optional) }
 */

const createStaffHandler = async (req, res, next) => {
  try {
    const { name, email, phone, tempPassword } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required." });
    }

    // Prevent creating non-staff via this route if role specified
    // Ensure email doesn't already exist for a staff or any user
    const existing = await findStaffByEmail(email);
    if (existing) {
      return res
        .status(400)
        .json({ message: "Staff with this email already exists." });
    }

    // As extra safety, ensure email not used by other role
    // (Query users table directly)
    const { rows: otherUserRows } = await require("../../config/db").query(
      `SELECT id, role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (otherUserRows && otherUserRows.length > 0) {
      return res
        .status(400)
        .json({ message: "Email already in use by another account." });
    }

    const passwordPlain =
      tempPassword && typeof tempPassword === "string"
        ? tempPassword
        : generateTempPassword(12);
    const saltRounds = 12;
    const hashed = await bcrypt.hash(passwordPlain, saltRounds);

    const newStaff = await createStaff({
      name,
      email,
      phone,
      password_hash: hashed,
      is_verified: true, // admin created - mark verified
    });

    res.status(201).json({
      success: true,
      message: "Staff account created successfully.",
      staff: newStaff,
      temp_password: passwordPlain,
    });
  } catch (error) {
    console.error("Error in createStaffHandler:", error);
    next(error);
  }
};

/**
 * Admin-only: Reset staff password
 * Request body: { staff_id or email, new_password(optional) }
 */
const resetStaffPasswordHandler = async (req, res, next) => {
  try {
    const { staff_id, email, new_password } = req.body;

    if (!staff_id && !email) {
      return res
        .status(400)
        .json({ message: "Provide staff_id or email to reset password." });
    }

    // Resolve staff record
    let staff = null;
    if (staff_id) {
      staff = await findStaffById(staff_id);
    } else {
      staff = await findStaffByEmail(email);
    }

    if (!staff) {
      return res.status(404).json({ message: "Staff not found." });
    }

    const plain =
      new_password && typeof new_password === "string"
        ? new_password
        : generateTempPassword(12);
    const saltRounds = 12;
    const hashed = await bcrypt.hash(plain, saltRounds);

    await updateStaffPassword(staff.id, hashed);

    res.status(200).json({
      success: true,
      message: "Staff password reset successfully.",
      temp_password: plain,
    });
  } catch (error) {
    console.error("Error in resetStaffPasswordHandler:", error);
    next(error);
  }
};

/**
 * Admin-only: Delete a Staff account
 * Params: :id
 */
const deleteStaffHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "Staff id is required." });

    // Prevent admin from deleting themselves accidenctally
    if (req.user && req.user.id === id) {
      return res
        .status(400)
        .json({ message: "Admin cannot delete their own account here." });
    }

    const deleted = await deleteStaffById(id);
    if (!deleted) {
      return res
        .status(404)
        .json({ message: "Staff not found or already deleted." });
    }

    res.status(200).json({
      success: true,
      message: "Staff account deleted successfully.",
      deleted,
    });
  } catch (error) {
    console.error("Error in deleteStaffHandler:", error);
    next(error);
  }
};

/**
 * Admin-only:List staff
 */
const listStaffHandler = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    const staffs = await listStaff(limit, offset);
    res.status(200).json({ success: true, count: staffs.length, staffs });
  } catch (error) {
    console.error("Error in listStaffHandler:", error);
    next(error);
  }
};

module.exports = {
  createStaffHandler,
  resetStaffPasswordHandler,
  deleteStaffHandler,
  listStaffHandler,
};
