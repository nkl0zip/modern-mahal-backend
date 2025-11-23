const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

// Allowed file formats — feel free to expand
const ALLOWED_FORMATS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "txt",
  "zip",
];

// Sanitize public_id (CRITICAL FIX)
function sanitizePublicId(filename) {
  if (!filename) return Date.now().toString();

  return filename
    .trim() // remove leading/trailing spaces
    .replace(/\s+/g, "_") // replace inner spaces
    .replace(/[^\w\-.]/g, "") // remove any weird characters
    .replace(/_+/g, "_") // collapse multiple underscores
    .toLowerCase();
}

const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const original = file.originalname || "file";

    const sanitized = sanitizePublicId(original);

    return {
      folder: "modernmahal/tickets/complaints",
      allowed_formats: ALLOWED_FORMATS,
      resource_type: "auto",

      // FINAL FIX HERE
      public_id: `${Date.now()}_${sanitized}`,
    };
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    cb(null, true);
  },
});
module.exports = upload;
