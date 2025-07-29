const express = require("express");
const router = express.Router();
const {
  getProfileHandler,
  updateProfile,
} = require("../controllers/profile.controller");
const authenticateToken = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");

// GET /api/profile
router.get("/", authenticateToken, getProfileHandler);

// PATCH /api/profile
router.patch("/", authenticateToken, upload.single("avatar"), updateProfile);

module.exports = router;
