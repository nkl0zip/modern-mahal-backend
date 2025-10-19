const express = require("express");
const router = express.Router();
const {
  addReviewHandler,
  getProductReviewsHandler,
} = require("../controllers/review.controller");

// Add or Update a Review
// Allowed to USER only
// POST: /api/reviews
router.post("/", addReviewHandler);

// Get all reviews for a specific product
// Allowed to All
// GET: /api/reviews/:product_id
router.get("/:product_id", getProductReviewsHandler);

module.exports = router;
