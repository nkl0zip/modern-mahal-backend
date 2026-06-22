const express = require("express");
const router = express.Router();
const {
  updateProfile,
  setUserCategoriesHandler,
  getUserCategoriesHandler,
  updateUserCategoriesHandler,
  getCompleteProfileHandler,
} = require("../controllers/profile.controller");
const {
  authenticateToken,
  requireRole,
} = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");

// GET /api/profile - Get complete profile with slab info
router.get("/", authenticateToken, getCompleteProfileHandler);

// PATCH /api/profile
router.patch("/", authenticateToken, upload.single("avatar"), updateProfile);

// POST /api/profile/categories/set
router.post("/categories/set", authenticateToken, setUserCategoriesHandler);

// PATCH /api/profile/categories/update
router.patch(
  "/categories/update",
  authenticateToken,
  updateUserCategoriesHandler,
);

// GET /api/profile/categories
router.get("/categories", authenticateToken, getUserCategoriesHandler);

module.exports = router;
