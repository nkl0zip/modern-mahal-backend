const express = require("express");
const {
  initCartHandler,
  getCartHandler,
  addToCartHandler,
  updateCartItemHandler,
  removeCartItemHandler,
  clearCartHandler,
} = require("../controllers/cart.controller");

const { authenticateToken } = require("../middlewares/auth.middleware");

const router = express.Router();

// POST /api/cart/init
// Allowed by USER only
router.post("/init", authenticateToken, initCartHandler);

// GET /api/cart/
router.get("/", authenticateToken, getCartHandler);

// POST /api/cart/items
// Allowed by USER only
router.post("/items", authenticateToken, addToCartHandler);

// PATCH /api/cart/items/{item_id}
// Allowed by USER only
router.patch("/items/:item_id", authenticateToken, updateCartItemHandler);

// DELETE /api/cart/items/{item_id}
// Allowed by USER only
router.delete("/items/:item_id", authenticateToken, removeCartItemHandler);

// DELETE /api/cart/{user_id}/clear
// Allowed by USER only
router.delete("/clear", authenticateToken, clearCartHandler);

module.exports = router;
