const express = require("express");
const router = express.Router();
const {
  getProfileHandler,
  updateProfile,
  setUserCategoriesHandler,
  getUserCategoriesHandler,
  updateUserCategoriesHandler,
  assignUserSlabHandler,
} = require("../controllers/profile.controller");
const {
  authenticateToken,
  requireRole,
} = require("../middlewares/auth.middleware");
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
  updateUserCategoriesHandler,
);

// GET /api/profile/categories
router.get("/categories", authenticateToken, getUserCategoriesHandler);

// POST /api/profile/assign/slab
// Only for ADMIN/STAFF
router.post(
  "/assign/slab",
  authenticateToken,
  requireRole(["STAFF", "ADMIN"]),
  assignUserSlabHandler,
);

module.exports = router;
