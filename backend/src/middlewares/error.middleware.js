const multerErrorHandler = (err, req, res, next) => {
  if (err.name === "MulterError") {
    console.error("Multer Error:", err);
    return res.status(400).json({ message: err.message });
  }

  if (err.message?.includes("Cloudinary")) {
    console.error("Cloudinary Upload Error:", err);
    return res.status(500).json({ message: "Cloudinary upload failed" });
  }

  next(err); // Pass other errors to Express
};

const errorHandler = (err, req, res, next) => {
  console.error("🔥 Global Error Handler:", err);

  // Multer file upload error
  if (err.name === "MulterError") {
    return res.status(400).json({
      message: `Multer Error: ${err.message}`,
    });
  }

  // Cloudinary upload error
  if (err.message?.includes("Cloudinary")) {
    return res.status(500).json({
      message: "Cloudinary upload failed. Check API keys and config.",
    });
  }

  // Generic fallback error
  res.status(500).json({
    message: err.message || "Internal Server Error",
  });
};

module.exports = errorHandler;
