const express = require("express");
const {
  subAdminLogin,
  requestSubAdminPasswordReset,
  resetSubAdminPassword,
  subAdminLogout,
  verifyTotpAndLogin,
} = require("../controllers/sub-admin/auth.controller");
const {
  authenticateToken,
  requireRole,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// Public routes
router.post("/login", subAdminLogin);
router.post("/verify-totp", verifyTotpAndLogin);
router.post("/request-reset", requestSubAdminPasswordReset);
router.post("/reset-password", resetSubAdminPassword);

// Protected routes (require valid JWT and SUB_ADMIN role)
router.use(authenticateToken, requireRole("SUB_ADMIN"));

router.post("/logout", subAdminLogout);

module.exports = router;
