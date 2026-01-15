const express = require("express");
const router = express.Router();
const {
  getProfileHandler,
  updateProfile,
  setUserCategoriesHandler,
  getUserCategoriesHandler,
  updateUserCategoriesHandler,
} = require("../controllers/profile.controller");
const { authenticateToken } = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");

// GET /api/profile
router.get("/", authenticateToken, getProfileHandler);

// PATCH /api/profile
router.patch("/", authenticateToken, upload.single("avatar"), updateProfile);

// POST /api/profile/categories/set
router.post("/categories/set", authenticateToken, setUserCategoriesHandler);

// PATCH /api/profile/categories/update
router.patch(
  "/categories/update",
  authenticateToken,
  updateUserCategoriesHandler
);

// GET /api/user/categories
router.get("/categories", authenticateToken, getUserCategoriesHandler);

module.exports = router;
