const cloudinary = require("../../config/cloudinary");
const fs = require("fs");
const path = require("path");
const {
  insertProductImage,
  getProductImagesByProductId,
} = require("../../models/staff/productImage.model");

const uploadProductMediaHandler = async (req, res, next) => {
  try {
    const { product_id, display_order } = req.body;

    if (!product_id || !display_order) {
      return res.status(400).json({
        message: "Missing required fields: product_id, display_order.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        message: "No file uploaded.",
      });
    }

    // Check file type (image/video)
    const ext = path.extname(req.file.originalname).toLowerCase();
    let media_type = null;
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) media_type = "image";
    else if ([".mp4", ".mov", ".avi", ".mkv"].includes(ext))
      media_type = "video";
    else {
      fs.unlinkSync(req.file.path); // Remove uploaded file
      return res.status(400).json({
        message: "Unsupported file type. Only images/videos are allowed.",
      });
    }

    // Upload to Cloudinary
    const folder = "product_images";
    const resource_type = media_type === "image" ? "image" : "video";
    const uploadResult = await cloudinary.uploader.upload(req.file.path, {
      folder,
      resource_type,
    });

    fs.unlinkSync(req.file.path);

    // Syore in DB
    let dbEntry;
    try {
      dbEntry = await insertProductImage({
        product_id,
        media_url: uploadResult.secure_url,
        media_type,
        display_order: parseInt(display_order),
      });
    } catch (err) {
      // On unique constraint err, delete file from Cloudinary
      await cloudinary.uploader.destroy(uploadResult.public_id, {
        resource_type,
      });
      return res.status(400).json({ message: err.message });
    }

    res.status(201).json({
      message: "File uploaded and product image saved successfully.",
      product_image: dbEntry,
    });
  } catch (err) {
    next(err);
  }
};

const fetchProductImagesHandler = async (req, res, next) => {
  try {
    const { product_id } = req.params;

    if (!product_id) {
      return res.status(400).json({ message: "Product ID is Required" });
    }

    const images = await getProductImagesByProductId(product_id);

    if (!images || images.length === 0) {
      return res.status(404).json({
        message: "No images or videos found for this product.",
        images: [],
      });
    }

    res.status(200).json({
      message: "Product images and videos fetched successfully",
      images,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { uploadProductMediaHandler, fetchProductImagesHandler };
