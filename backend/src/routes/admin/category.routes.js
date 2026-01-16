const express = require("express");
const {
  createCategoryHandler,
  getAllCategoriesHandler,
  deleteCategoryHandler,
  setCategoryGlobalHandler,
} = require("../../controllers/admin/category.controller");
const router = express.Router();

const {
  authenticateToken,
  requireRole,
} = require("../../middlewares/auth.middleware");

// POST /api/category/
router.post("/", createCategoryHandler);

// GET /api/category/
router.get("/", getAllCategoriesHandler);

// DELETE /api/category/:id
router.delete("/:id", deleteCategoryHandler);

// ADMIN ONLY
// PATCH /api/category/set-global
router.patch(
  "/set-global",
  authenticateToken,
  requireRole("ADMIN"),
  setCategoryGlobalHandler
);

module.exports = router;
