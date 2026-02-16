const pool = require("../config/db");

const {
  findOrCreateCartByUser,
  getCartByUser,
  getCartItemsWithProductDetails,
  addOrUpdateCartItem,
  updateCartItemQuantity,
  removeCartItem,
  clearCart,
} = require("../models/cart.model");

const { getValidCouponByCode } = require("../models/staff/discount.model");

const { applyCartPricingLogic } = require("../services/cartPricing.service");

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

    const cart = await findOrCreateCartByUser(user_id);

    const rawItems = await getCartItemsWithProductDetails(cart.id);

    if (!rawItems.length) {
      return res.json({
        message: "Cart fetched",
        cart: {
          ...cart,
          items: [],
          total_original_cost: 0,
          total_discount_amount: 0,
          final_total: 0,
          applied_coupon: null,
        },
      });
    }

    /* -----------------------------------------
       Fetch Applied Coupon By ID (CORRECT FIX)
    ------------------------------------------ */
    let coupon = null;

    if (cart.applied_coupon_id) {
      const { rows } = await pool.query(
        `
        SELECT *
        FROM discounts
        WHERE id = $1
          AND type = 'COUPON'
          AND is_active = true
          AND expires_at > NOW()
        LIMIT 1;
        `,
        [cart.applied_coupon_id],
      );

      if (rows.length) {
        coupon = rows[0];
      }
    }

    /* -----------------------------------------
       Apply Pricing Logic
    ------------------------------------------ */
    const pricing = await applyCartPricingLogic({
      items: rawItems,
      coupon,
      user_id,
    });

    return res.json({
      message: "Cart fetched",
      cart: {
        ...cart,
        items: pricing.items,
        total_original_cost: pricing.total_original_cost,
        total_discount_amount: pricing.total_discount_amount,
        final_total: pricing.final_total,
        applied_coupon: pricing.applied_coupon,
      },
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
