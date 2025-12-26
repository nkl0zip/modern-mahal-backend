const {
  getAllSegmentsWithCategories,
  createSegment,
  mapSegmentToCategories,
  deleteSegmentById,
  findCategoryIdsByNames,
  getSegmentsByCategory,
} = require("../../models/admin/segment.model");

/**
 * GET /api/segments
 * ADMIN / STAFF
 */
const listSegmentsHandler = async (req, res, next) => {
  try {
    const segments = await getAllSegmentsWithCategories();
    res.status(200).json({
      message: "Segments fetched successfully",
      segments,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/segments
 * ADMIN / STAFF
 */
const createSegmentHandler = async (req, res, next) => {
  try {
    const { name, slug, description, categories } = req.body;

    if (!name)
      return res.status(400).json({ message: "Segment name is required" });

    const categoryNames = Array.isArray(categories)
      ? categories
      : typeof categories === "string"
      ? categories.split(",").map((c) => c.trim())
      : [];

    const categoryIds = await findCategoryIdsByNames(categoryNames);

    const segment = await createSegment({
      name,
      slug: slug || name.toLowerCase().replace(/\s+/g, "-"),
      description,
    });

    await mapSegmentToCategories(segment.id, categoryIds);

    res.status(201).json({
      message: "Segment created successfully",
      segment,
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        message: "Segment with same name or slug already exists",
      });
    }
    next(err);
  }
};

/**
 * DELETE /api/segments/:id
 * ADMIN / STAFF
 */
const deleteSegmentHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) return res.status(400).json({ message: "segment_id is required" });

    const deleted = await deleteSegmentById(id);

    if (!deleted) return res.status(404).json({ message: "Segment not found" });

    res.status(200).json({
      message: "Segment deleted successfully",
      deleted,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/segments/category
 * ?id=uuid OR ?name=category-name
 */
const getSegmentsByCategoryHandler = async (req, res, next) => {
  try {
    const { id, name } = req.query;

    if (!id && !name) {
      return res.status(400).json({
        message: "Please provide category id or category name",
      });
    }

    const segments = await getSegmentsByCategory({
      category_id: id,
      category_name: name,
    });

    if (!segments.length) {
      return res.status(404).json({
        message: "No segments found for this category",
        segments: [],
      });
    }

    return res.status(200).json({
      message: "Segments fetched successfully",
      segments,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listSegmentsHandler,
  createSegmentHandler,
  deleteSegmentHandler,
  getSegmentsByCategoryHandler,
};
