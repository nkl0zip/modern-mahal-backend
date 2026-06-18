const express = require("express");
const {
  adminLogin,
  verifyTotpAndLogin,
  requestPasswordReset,
  resetPassword,
  adminLogoutHandler,
  disableTotpHandler,
  getTotpStatusHandler,
  regenerateBackupCodesHandler,
  getBackupCodesHandler,
} = require("../../controllers/admin/admin.controller");

const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");

const router = express.Router();

// POST /api/admin/login
router.post("/login", adminLogin);

// POST /api/admin/verify-totp
router.post("/verify-totp", verifyTotpAndLogin);

// POST /api/admin/request-reset
router.post("/request-reset", requestPasswordReset);

// POST /api/admin/reset-password
router.post("/reset-password", resetPassword);

// Protected routes (require valid JWT and ADMIN role)
router.use(authenticateToken, requireRole("ADMIN"));

// POST /api/admin/logout
router.post("/logout", adminLogoutHandler);

// 2FA Management Routes
// GET /api/admin/totp-status
router.get("/totp-status", getTotpStatusHandler);

// POST /api/admin/disable-totp
router.post("/disable-totp", disableTotpHandler);

// POST /api/admin/regenerate-backup-codes
router.post("/regenerate-backup-codes", regenerateBackupCodesHandler);

// POST /api/admin/get-backup-codes
router.post("/get-backup-codes", getBackupCodesHandler);

module.exports = router;
