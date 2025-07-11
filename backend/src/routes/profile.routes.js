const express = require("express");
const router = express.Router();
const { updateProfile } = require("../controllers/profile.controller");
const authenticateToken = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");

// PATCH /api/profile
router.patch("/", authenticateToken, upload.single("avatar"), updateProfile);

module.exports = router;
