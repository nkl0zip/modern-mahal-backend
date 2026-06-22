const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    // Determine folder based on file type or route
    let folder = "uploads";

    if (req.path.includes("/repay")) {
      folder = "paylater-receipts";
    } else if (req.path.includes("/avatar")) {
      folder = "avatars";
    } else if (req.path.includes("/tickets")) {
      folder = "tickets";
    } else if (req.path.includes("/order-templates")) {
      folder = "order-templates";
    }

    return {
      folder: folder,
      allowed_formats: [
        "jpg",
        "jpeg",
        "png",
        "gif",
        "mp3",
        "mp4",
        "pdf",
        "doc",
        "docx",
        "webp",
        "svg",
      ],
      resource_type: "auto",
    };
  },
});

const fileFilter = (req, file, cb) => {
  // Accept images, audio, and documents
  const allowedMimes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/ogg",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "video/mp4",
    "video/mpeg",
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type: ${file.mimetype}. Allowed types: images, audio, video, PDF, Word documents`,
      ),
      false,
    );
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit
  },
});

module.exports = upload;
