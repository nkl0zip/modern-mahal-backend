const {
  findOrCreateCartByUser,
  getCartByUser,
  getCartItemsWithProductDetails,
  updateCartItemQuantity,
  addOrUpdateCartItem,
  removeCartItem,
  clearCart,
} = require("../models/cart.model");

// Initialise Cart
const initCartHandler = async (req, res, next) => {
  try {
    const { user_id } = req.body;
    if (!user_id)
      return res.status(400).json({
        message: "user_id is required.",
      });

    const cart = await findOrCreateCartByUser(user_id);
    res.status(200).json({ message: "Cart Initialized.", cart });
  } catch (err) {
    next(err);
  }
};

// GET cart + items
const getCartHandler = async (req, res, next) => {
  try {
    const { user_id } = req.params;
    if (!user_id) return res.status(400).json({ message: "user_id required." });

    const cart = await getCartByUser(user_id);
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    const items = await getCartItemsWithProductDetails(cart.id);
    const total = items.reduce(
      (acc, it) => acc + parseFloat(it.subtotal || 0),
      0
    );

    res.status(200).json({
      message: "Cart Fetched.",
      cart: { ...cart, items, total, final_total: total },
    });
  } catch (err) {
    next(err);
  }
};

// ADD TO CART
const addToCartHandler = async (req, res, next) => {
  try {
    const { user_id, product_id, quantity } = req.body;
    if (!user_id) return res.status(400).json({ message: "user_id required." });
    if (!product_id)
      return res.status(400).json({ message: "product_id required." });
    if (!quantity)
      return res.status(400).json({ message: "quantity required." });

    const cart = await findOrCreateCartByUser(user_id);
    const cartItem = await addOrUpdateCartItem({
      cart_id: cart.id,
      product_id,
      quantity,
    });

    res.status(200).json({ message: "Product Added.", cart_item: cartItem });
  } catch (err) {
    if (err.status)
      return res.status(err.status).json({ message: err.message });
    next(err);
  }
};

// Update cart item
const updateCartItemHandler = async (req, res, next) => {
  try {
    const { item_id } = req.params;
    const { quantity } = req.body;
    if (!item_id) return res.status(400).json({ message: "item_id required." });
    if (quantity === undefined)
      return res.status(400).json({ message: "quantity required." });

    const updated = await updateCartItemQuantity(item_id, quantity);
    if (!updated)
      return res.status(404).json({ message: "Cart item not found." });

    res.status(200).json({ message: "Cart item updated.", cart_item: updated });
  } catch (err) {
    if (err.status)
      return res.status(err.status0.json({ message: err.message }));
    next(err);
  }
};

// Remove Cart Item
const removeCartItemHandler = async (req, res, next) => {
  try {
    const { item_id } = req.params;
    if (!item_id) return res.status(400).json({ message: "item_id required." });

    const deleted = await removeCartItem(item_id);
    if (!deleted)
      return res.status(404).json({ message: "Cart item not found." });

    res.status(200).json({ message: "Cart Item Removed.", removed: deleted });
  } catch (err) {
    next(err);
  }
};

// Clear Cart
const clearCartHandler = async (req, res, next) => {
  try {
    const { user_id } = req.params;
    if (!user_id) return res.status(400).json({ message: "user_id required." });

    const cart = await getCartByUser(user_id);
    if (!cart) return res.status(404).json({ message: "Cart not found." });

    await clearCart(cart.id);
    res.status(200).json({ message: "Cart Cleared." });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  initCartHandler,
  getCartHandler,
  addToCartHandler,
  updateCartItemHandler,
  removeCartItemHandler,
  clearCartHandler,
};
