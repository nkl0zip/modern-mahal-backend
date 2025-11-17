const express = require("express");
const router = express.Router();

const { googleAuth } = require("../controllers/auth.controller");
const { register, login } = require("../controllers/auth.controller");
const { sendOtp, verifyOtp } = require("../controllers/auth.controller");

const { staffLogin } = require("../controllers/staff/auth.controller");

const {
  authenticateToken,
  requireRole,
} = require("../middlewares/auth.middleware");
const { staffLogoutHandler } = require("../controllers/staff/auth.controller");

// Email auth
router.post("/register", register);
router.post("/login", login);

// Mobile OTP auth
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);

// POST /api/auth/google
router.post("/google", googleAuth);

// POST /api/auth/staff-login
router.post("/staff-login", staffLogin);

// POST /api/auth/logout
router.post(
  "/logout",
  authenticateToken,
  requireRole("STAFF"),
  staffLogoutHandler
);

module.exports = router;
