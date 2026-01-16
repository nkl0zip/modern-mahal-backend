const express = require("express");
const router = express.Router();

const {
  getProfileByStaffHandler,
} = require("../../controllers/staff/userDetails.controller");

const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");

/**
 * GET USER PROFILE BY STAFF/ADMIN
 * GET: /api/user/profile
 */
router.get(
  "/profile",
  authenticateToken,
  requireRole(["STAFF", "ADMIN"]),
  getProfileByStaffHandler
);

module.exports = router;
