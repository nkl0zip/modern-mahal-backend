const { getClientIp } = require("../../utils/ip.util");
const ipModel = require("../../models/admin/ip.model");
const { findUserByEmail } = require("../../models/user.model");
const {
  verifyPassword,
  generateToken,
} = require("../../services/auth.service");

const { blacklistToken } = require("../../models/admin/token.model");

/**
 * Staff login with IP checks and request creation
 * - If IP in allowed_ips => FULL access
 * - Else if in staff_ip_acess => allowed with that access level
 * - Else create staff_ip_request (if not pending) and deny full access (return 403)
 */
const staffLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });
    if (!password)
      return res.status(400).json({ message: "Password is required" });

    // 1. Authenticate user credentials
    const user = await findUserByEmail(email);
    if (!user) return res.status(400).json({ message: "Invalid email" });

    // Ensuring that the role is STAFF
    if (user.role !== "STAFF") {
      return res
        .status(403)
        .json({ message: "This endpoint is for staff login only" });
    }

    const isMatch = await verifyPassword(password, user.password_hash);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid email or password" });

    // 2. Get client IP
    const ip = getClientIp(req);
    if (!ip) {
      // if unable to detect IP, deny for safety
      return res.status(400).json({ message: "Unable to determine client IP" });
    }

    // 3. Check global allowed IPs
    const allowed = await ipModel.findAllowedIp(ip);
    if (allowed) {
      const token = generateToken({
        id: user.id,
        role: user.role,
        ip_access: "FULL",
      });
      return res.status(200).json({
        message: "Login success (office IP). Full access granted.",
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          ip_access: "FULL",
        },
      });
    }

    // 4. Check staff-specific approved IPs
    const staffAccess = await ipModel.findStaffIpAccess({
      staff_id: user.id,
      ip_address: ip,
    });
    if (staffAccess) {
      // allowed with specific access level
      const token = generateToken({
        id: user.id,
        role: user.role,
        ip_access: staffAccess.access_level,
      });
      return res.status(200).json({
        message: `Login successful (${staffAccess.access_level}).`,
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          ip_access: staffAccess.access_level,
        },
      });
    }

    // 5. Not found anywhere => create or return existing pening request
    const existingReq = await ipModel.findStaffIpRequest({
      staff_id: user.id,
      ip_address: ip,
    });
    if (existingReq) {
      if (existingReq.status === "PENDING") {
        return res.status(403).json({
          message:
            "Access from this IP is pending admin approval. Please wait.",
        });
      } else if (existingReq.status === "REJECTED") {
        return res
          .status(403)
          .json({ message: "Access from this IP was rejected by admin." });
      }
    }

    // create request
    await ipModel.createStaffIpRequest({
      staff_id: user.id,
      ip_address: ip,
      reason: req.body.reason || null,
    });

    return res.status(403).json({
      message: "Your access request has been submitted to admin for approval.",
    });
  } catch (error) {
    console.error("Error in staff Login", error);
    next(error);
  }
};

const staffLogoutHandler = async (req, res, next) => {
  try {
    const token = req.token;
    const decoded = req.user;

    const expiresAt = new Date(decoded.exp * 1000);

    await blacklistToken(token, expiresAt);

    return res.status(200).json({
      success: true,
      message: "Staff logged out successfully.",
    });
  } catch (err) {
    console.error("Staff Logout Error: ", err);
    next(err);
  }
};

module.exports = { staffLogin, staffLogoutHandler };
