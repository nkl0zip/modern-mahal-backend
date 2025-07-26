const express = require("express");
const multer = require("multer");
const path = require("path");
const {
  uploadProductMediaHandler,
  fetchProductImagesHandler,
} = require("../../controllers/staff/productImage.controller");

const upload = multer({
  dest: path.join(__dirname, "../../uploads/"),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    //Accept images and videos only
    const ext = path.extname(file.originalname).toLowerCase();
    if (
      [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".mp4",
        ".mov",
        ".avi",
        ".mkv",
      ].includes(ext)
    )
      cb(null, true);
    else cb(new Error("Only image/video files are allowed!"), false);
  },
});

const router = express.Router();

// POST /api/product-images/upload
// Allowed for ADMIN/STAFF only with 50MB limit
router.post("/upload", upload.single("file"), uploadProductMediaHandler);

// GET /api/product-images/:product_id
// Allowed for every Role
router.get("/:product_id", fetchProductImagesHandler);

module.exports = router;
