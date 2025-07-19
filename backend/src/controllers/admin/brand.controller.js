const {
  createBrand,
  findBrandByName,
  deleteBrandById,
  getAllBrands,
  updateBrandById,
} = require("../../models/admin/brand.model");

// POST /api/brand
const createBrandHandler = async (req, res, next) => {
  try {
    const { name, website_url, image, description, establishment_date } =
      req.body;

    if (!name)
      return res.status(400).json({ message: "Brand name is required!" });

    // Checking if brand already exists
    const existing = await findBrandByName(name);
    if (existing)
      return res.status(409).json({
        message:
          "Brand with this name already exists in Database. Try something else!",
      });

    const brand = await createBrand(
      name,
      website_url,
      image,
      description,
      establishment_date
    );

    return res
      .status(201)
      .json({ message: "Brand created successfully in Database.", brand });
  } catch (err) {
    next(err);
  }
};

// Get All Brands
const getAllBrandsHandler = async (req, res, next) => {
  try {
    const brands = await getAllBrands();
    res.json({ brands });
  } catch (err) {
    next(err);
  }
};

// Delete Brand by Id
const deleteBrandHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await deleteBrandById(id);

    if (!deleted)
      return res.status(404).json({ message: "Brand not Found. Try Again" });

    res.json({
      message: "Brand deleted successfully from Database",
      brand: deleted,
    });
  } catch (err) {
    next(err);
  }
};

// Update a particular Brand
const updateBrandHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateFields = req.body;

    if (Object.keys(updateFields).length === 0)
      return res
        .status(400)
        .json({ message: "No Fields provided for update." });

    const updated = await updateBrandById(id, updateFields);

    if (!updated)
      return res
        .status(404)
        .json({ message: "Brand not found or nothing to update in Database" });

    res.json({
      message: "Brand updated successfully in Database",
      brand: updated,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createBrandHandler,
  getAllBrandsHandler,
  deleteBrandHandler,
  updateBrandHandler,
};
