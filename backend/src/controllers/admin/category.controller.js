const {
  createCategory,
  findCategoryByNameOrSlug,
  getAllCategories,
  deleteCategoryById,
} = require("../../models/admin/category.model");

// POST /api/category
const createCategoryHandler = async (req, res, next) => {
  try {
    const { name, slug, description } = req.body;

    if (!name)
      return res.status(400).json({ message: "Category name is required." });

    // Optional: auto-generate slug if not provided
    const finalSlug = slug || name.trim().toLowerCase().replace(/\s+/g, "-");

    // Check if category exists
    const existing = await findCategoryByNameOrSlug(name, finalSlug);
    if (existing)
      return res
        .status(409)
        .json({ message: "Category with this name or slug already exists." });

    const category = await createCategory(name, finalSlug, description);

    return res.status(201).json({
      message: "Category created successfully.",
      category,
    });
  } catch (err) {
    next(err);
  }
};

// Get All Categories
const getAllCategoriesHandler = async (req, res, next) => {
  try {
    const categories = await getAllCategories();
    res.json({ categories });
  } catch (err) {
    next(err);
  }
};

// Delete Category by Id
const deleteCategoryHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await deleteCategoryById(id);

    if (!deleted)
      return res.status(404).json({ message: "Category not Found" });

    res.json({
      message: "Category deleted successfully",
      category: deleted,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createCategoryHandler,
  getAllCategoriesHandler,
  deleteCategoryHandler,
};
