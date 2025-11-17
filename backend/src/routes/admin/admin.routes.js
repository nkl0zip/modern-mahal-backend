const express = require("express");
const {
  adminLogin,
  requestPasswordReset,
  resetPassword,
  adminLogoutHandler,
} = require("../../controllers/admin/admin.controller");
const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");

const router = express.Router();

// POST /api/admin/login
router.post("/login", adminLogin);

// POST /api/admin/request-reset
router.post("/request-reset", requestPasswordReset);

// POST /api/admin/reset-password
router.post("/reset-password", resetPassword);

// POST /api/admin/logout
router.post(
  "/logout",
  authenticateToken,
  requireRole("ADMIN"),
  adminLogoutHandler
);

module.exports = router;
