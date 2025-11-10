const express = require("express");
const {
  adminLogin,
  requestPasswordReset,
  resetPassword,
} = require("../../controllers/admin/admin.controller");

const router = express.Router();

// POST /api/admin/login
router.post("/login", adminLogin);

// POST /api/admin/request-reset
router.post("/request-reset", requestPasswordReset);

// POST /api/admin/reset-password
router.post("/reset-password", resetPassword);

module.exports = router;
