const {
  createReview,
  getReviewsByProduct,
  getProductReviewStats,
} = require("../models/review.model");

// Add or Update review for a product
const addReviewHandler = async (req, res) => {
  try {
    const { product_id, user_id, rating, review_title, review_text } = req.body;

    if (!product_id) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required.",
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "User ID is required.",
      });
    }

    if (!rating) {
      return res.status(400).json({
        success: false,
        message: "Rating is required.",
      });
    }

    if (review_title && review_title.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Review Title exceeds 50 letter limit.",
      });
    }

    if (review_text && review_text.length > 400) {
      return res.status(400).json({
        success: false,
        message: "Review text exceeds 400 letter limit.",
      });
    }

    const review = await createReview({
      product_id,
      user_id,
      rating,
      review_title,
      review_text,
    });
    res.status(201).json({
      success: true,
      message: "Review submitted successfully",
      data: review,
    });
  } catch (error) {
    console.error("Error in addReview: ", error);
    res.status(500).json({
      success: false,
      message: "Server error while submitting review.",
    });
  }
};

// To fetch all the reviews of a particular product
const getProductReviewsHandler = async (req, res) => {
  try {
    const { product_id } = req.params;

    const reviews = await getReviewsByProduct(product_id);
    const stats = await getProductReviewStats(product_id);

    res.status(200).json({
      success: true,
      total_reviews: Number(stats.total_reviews) || 0,
      avg_rating: Number(stats.avg_rating) || 0,
      ratings_breakdown: {
        five_star: Number(stats.five_star) || 0,
        four_star: Number(stats.four_star) || 0,
        three_star: Number(stats.three_star) || 0,
        two_star: Number(stats.two_star) || 0,
        one_star: Number(stats.one_star) || 0,
      },
      reviews,
    });
  } catch (error) {
    console.error("Error in getProductReviews:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching product reviews.",
    });
  }
};

module.exports = { getProductReviewsHandler, addReviewHandler };
