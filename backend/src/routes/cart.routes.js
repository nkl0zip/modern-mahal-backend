const express = require("express");
const {
  initCartHandler,
  getCartHandler,
  addToCartHandler,
  updateCartItemHandler,
  removeCartItemHandler,
  clearCartHandler,
} = require("../controllers/cart.controller");

const router = express.Router();

// POST /api/cart/init
// Allowed by USER only
router.post("/init", initCartHandler);

// GET /api/cart/{user_id}
router.get("/:user_id", getCartHandler);

// POST /api/cart/items
// Allowed by USER only
router.post("/items", addToCartHandler);

// PATCH /api/cart/items/{item_id}
// Allowed by USER only
router.patch("/items/:item_id", updateCartItemHandler);

// DELETE /api/cart/items/{item_id}
// Allowed by USER only
router.delete("/items/:item_id", removeCartItemHandler);

// DELETE /api/cart/{user_id}/clear
// Allowed by USER only
router.delete("/:user_id/clear", clearCartHandler);

module.exports = router;
