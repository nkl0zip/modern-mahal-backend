const {
  findOrCreateCartByUser,
  getCartByUser,
  getCartItemsWithProductDetails,
  addOrUpdateCartItem,
  updateCartItemQuantity,
  removeCartItem,
  clearCart,
} = require("../models/cart.model");

/* INIT CART */
const initCartHandler = async (req, res, next) => {
  try {
    const user_id = req.user.id;
    if (!user_id) return res.status(400).json({ message: "user_id required" });

    const cart = await findOrCreateCartByUser(user_id);
    res.json({ message: "Cart initialized", cart });
  } catch (err) {
    next(err);
  }
};

/* GET CART */
const getCartHandler = async (req, res, next) => {
  try {
    const user_id = req.user.id;
    const cart = await getCartByUser(user_id);
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    const items = await getCartItemsWithProductDetails(cart.id);
    const total = items.reduce((a, b) => a + Number(b.subtotal || 0), 0);

    res.json({
      message: "Cart fetched",
      cart: { ...cart, items, total, final_total: total },
    });
  } catch (err) {
    next(err);
  }
};

/* ADD TO CART */
const addToCartHandler = async (req, res, next) => {
  try {
    const user_id = req.user.id;
    const { variant_id, quantity } = req.body;

    if (!user_id || !variant_id || !quantity)
      return res.status(400).json({ message: "Missing required fields" });

    const cart = await findOrCreateCartByUser(user_id);

    const item = await addOrUpdateCartItem({
      cart_id: cart.id,
      variant_id,
      quantity,
    });

    res.json({ message: "Item added to cart", cart_item: item });
  } catch (err) {
    if (err.status)
      return res.status(err.status).json({ message: err.message });
    next(err);
  }
};

/* UPDATE QUANTITY */
const updateCartItemHandler = async (req, res, next) => {
  try {
    const { item_id } = req.params;
    const { quantity } = req.body;

    const updated = await updateCartItemQuantity(item_id, quantity);
    if (!updated)
      return res.status(404).json({ message: "Cart item not found" });

    res.json({ message: "Cart updated", cart_item: updated });
  } catch (err) {
    next(err);
  }
};

/* REMOVE ITEM */
const removeCartItemHandler = async (req, res, next) => {
  try {
    const removed = await removeCartItem(req.params.item_id);
    if (!removed) return res.status(404).json({ message: "Item not found" });

    res.json({ message: "Item removed", removed });
  } catch (err) {
    next(err);
  }
};

/* CLEAR CART */
const clearCartHandler = async (req, res, next) => {
  try {
    const cart = await getCartByUser(req.user.id);
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    await clearCart(cart.id);
    res.json({ message: "Cart cleared" });
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
