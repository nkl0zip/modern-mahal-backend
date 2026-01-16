const {
  createCategory,
  findCategoryByNameOrSlug,
  getAllCategories,
  deleteCategoryById,
  updateCategoryGlobalFlag,
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

/**
 * ADMIN: Set / unset global category
 * Body: { category_id, is_global }
 */
const setCategoryGlobalHandler = async (req, res, next) => {
  try {
    const { category_id, is_global } = req.body;

    if (!category_id || typeof is_global !== "boolean") {
      return res.status(400).json({
        message: "category_id and is_global (boolean) are required.",
      });
    }

    const updated = await updateCategoryGlobalFlag(category_id, is_global);

    res.status(200).json({
      success: true,
      message: `Category marked as ${
        is_global ? "global" : "non-global"
      } successfully.`,
      category: updated,
    });
  } catch (error) {
    console.error("Error in setCategoryGlobalHandler:", error);
    next(error);
  }
};

module.exports = {
  createCategoryHandler,
  getAllCategoriesHandler,
  deleteCategoryHandler,
  setCategoryGlobalHandler,
};
