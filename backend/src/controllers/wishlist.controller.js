const {
  getUserWishlist,
  addToWishlist,
  removeFromWishlist,
} = require("../models/wishlist.model");

const getUserWishlistHandler = async (req, res, next) => {
  try {
    const userId = req.user.id;
    if (!userId)
      return res.status(400).json({ message: "User ID is required!" });

    const wishlist = await getUserWishlist(userId);

    res.status(200).json({
      message: "Wishlist fetched successfully.",
      wishlist,
    });
  } catch (err) {
    next(err);
  }
};

const addToWishlistHandler = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { product_id } = req.body;

    if (!userId)
      return res.status(400).json({ message: "User Id is required!" });
    if (!product_id)
      return res.status(400).json({ message: "Product Id is required!" });

    const inserted = await addToWishlist(userId, product_id);

    if (!inserted) {
      return res.status(200).json({
        message: "Product already exists in Wishlist.",
      });
    }

    res.status(201).json({
      message: "Product added to wishlist successfully.",
      wishlist_item: inserted,
    });
  } catch (err) {
    next(err);
  }
};

const removeFromWishlistHandler = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { product_id } = req.body;

    if (!userId)
      return res.status(400).json({ message: "User Id is required!" });
    if (!product_id)
      return res.status(400).json({ message: "Product Id is required!" });

    const deleted = await removeFromWishlist(userId, product_id);
    if (!deleted) {
      return res.status(400).json({ message: "Product not found!" });
    }

    res.status(200).json({
      message: "Product removed from wishlist",
      removed: deleted,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getUserWishlistHandler,
  addToWishlistHandler,
  removeFromWishlistHandler,
};
