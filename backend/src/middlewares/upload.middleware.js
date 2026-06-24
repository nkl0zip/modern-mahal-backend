const multer = require("multer");
const path = require("path");
const cloudinary = require("../config/cloudinary");

// Memory storage for temporary file handling
const storage = multer.memoryStorage();

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

// Helper function to upload to Cloudinary manually
const uploadToCloudinary = async (file, folder = "uploads", options = {}) => {
  return new Promise((resolve, reject) => {
    // Determine resource type
    let resourceType = "auto";
    if (file.mimetype === "application/pdf") {
      resourceType = "raw";
    } else if (file.mimetype.startsWith("image/")) {
      resourceType = "image";
    } else if (file.mimetype.startsWith("audio/")) {
      resourceType = "video";
    } else if (file.mimetype.startsWith("video/")) {
      resourceType = "video";
    }

    const uploadOptions = {
      folder: folder,
      resource_type: resourceType,
      use_filename: true,
      unique_filename: true,
      ...options,
    };

    // Upload buffer directly to Cloudinary
    const stream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.error("Cloudinary upload error:", error);
          reject(error);
        } else {
          resolve(result);
        }
      },
    );

    stream.end(file.buffer);
  });
};

module.exports = upload;
module.exports.uploadToCloudinary = uploadToCloudinary;
