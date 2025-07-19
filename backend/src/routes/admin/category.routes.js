const express = require("express");
const {
  createCategoryHandler,
  getAllCategoriesHandler,
  deleteCategoryHandler,
} = require("../../controllers/admin/category.controller");
const router = express.Router();

// POST /api/category/
router.post("/", createCategoryHandler);

// GET /api/category/
router.get("/", getAllCategoriesHandler);

// DELETE /api/category/:id
router.delete("/:id", deleteCategoryHandler);

module.exports = router;
