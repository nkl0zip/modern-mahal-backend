const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/jwt");
const { isTokenBlacklisted } = require("../models/admin/token.model");

/**
 * Middleware: Validates JWT + checks blacklist tokens
 */
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Authorization header missing" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Token missing" });
  }

  try {
    // Check if token is blaclisted (logged out)
    const blacklisted = await isTokenBlacklisted(token);
    if (blacklisted)
      return res
        .status(401)
        .json({ message: "Token is invalid (logged out)." });

    const payload = jwt.verify(token, jwtSecret);

    req.user = payload;
    req.token = token;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
};

// restrict route access by role
const requireRole = (role) => {
  // normalize to array
  const allowedRoles = Array.isArray(role) ? role : [role];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Access denied. Required role(s): ${allowedRoles.join(", ")}.`,
      });
    }

    next();
  };
};

const optionalAuthenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      req.user = null;
      return next();
    }

    req.user = decoded;
    next();
  });
};

module.exports = { authenticateToken, requireRole, optionalAuthenticateToken };
