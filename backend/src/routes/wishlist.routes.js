const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const {
  getUserWishlistHandler,
  addToWishlistHandler,
  removeFromWishlistHandler,
} = require("../controllers/wishlist.controller");

const router = express.Router();

// GET /api/wishlist/
router.get("/", authenticateToken, getUserWishlistHandler);

// POST /api/wishlist
router.post("/", authenticateToken, addToWishlistHandler);

// DELETE /api/wishlist
router.delete("/", authenticateToken, removeFromWishlistHandler);

module.exports = router;
