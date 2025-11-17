const express = require("express");
const router = express.Router();

const {
  createStaffHandler,
  resetStaffPasswordHandler,
  deleteStaffHandler,
  listStaffHandler,
} = require("../../controllers/staff/staff.controller");

const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");
const {
  staffLogoutHandler,
} = require("../../controllers/staff/auth.controller");

// All routes below require admin
router.use(authenticateToken);
router.use(requireRole("ADMIN"));

// POST /api/staff/create
router.post("/create", createStaffHandler);

// POST /api/staff/reset-password
router.post("/reset-password", resetStaffPasswordHandler);

// DELETE /api/staff/delete/:id
router.delete("/delete/:id", deleteStaffHandler);

// GET /api/staff/list
router.get("/list", listStaffHandler);

module.exports = router;
