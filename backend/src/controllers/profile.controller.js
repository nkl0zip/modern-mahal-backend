const { updateUser, getUserWithSlab } = require("../models/user.model");
const {
  getUserProfile,
  upsertUserProfile,
  getUserCategories,
  assignUserCategories,
  updateUserCategories,
} = require("../models/user_profile.model");

const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, date_of_birth, bio, working_email } = req.body;
    const avatarUrl = req.file ? req.file.path : null;

    // Update usera table
    const updatedUser = await updateUser(userId, name);

    // update user_profiles table
    const updatedProfile = await upsertUserProfile(
      userId,
      date_of_birth,
      avatarUrl,
      bio,
      working_email,
    );

    res.status(200).json({
      message: "Profile updated successfully",
      user: updatedUser,
      profile: updatedProfile,
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    res
      .status(500)
      .json({ message: error.message || "Failed to update profile" });
  }
};

/**
 * Set Category Preferences on Signup by User (Only User)
 * Body: { category_ids: [uuid, uuid] }
 */
const setUserCategoriesHandler = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { category_ids } = req.body;

    if (!Array.isArray(category_ids) || category_ids.length !== 2) {
      return res.status(400).json({
        message: "Exactly 2 categories must be selected.",
      });
    }

    const existing = await getUserCategories(userId);
    if (existing.length > 0) {
      return res.status(400).json({
        message: "Categories already set. Use update instead.",
      });
    }

    await assignUserCategories(userId, category_ids);

    res.status(201).json({
      success: true,
      message: "Categories assigned successfully.",
    });
  } catch (err) {
    console.error("Error in setUserCategoriesHandler: ", err);
  }
};

/**
 * Update category preferences for User (only 2)
 * Body: {category_ids: [uuid, uuid]}
 */
const updateUserCategoriesHandler = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { category_ids } = req.body;

    if (!Array.isArray(category_ids) || category_ids.length !== 2) {
      return res.status(400).json({
        message: "Exactly 2 categories must be selected.",
      });
    }

    const existing = await getUserCategories(userId);
    if (existing.length === 0) {
      return res.status(400).json({
        message: "Categories not set yet. Use set first.",
      });
    }

    await updateUserCategories(userId, category_ids);

    res.status(200).json({
      success: true,
      message: "Categories updated successfully.",
    });
  } catch (err) {
    console.error("Error in updateUserCategoriesHandler: ", err);
    next(err);
  }
};

/**
 * Get selected categories by user
 */
const getUserCategoriesHandler = async (req, res, next) => {
  try {
    const categories = await getUserCategories(req.user.id);
    res.status(200).json({
      success: true,
      categories,
    });
  } catch (err) {
    console.error("Error in getUserCategoriesHandler: ", err);
    next(err);
  }
};

/**
 * Get complete user profile with slab and pay later info
 */
const getCompleteProfileHandler = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get user with slab info
    const user = await getUserWithSlab(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get user profile
    const profile = await getUserProfile(userId);

    // Get user categories
    const categories = await getUserCategories(userId);

    res.status(200).json({
      success: true,
      message: "Profile fetched successfully",
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          is_verified: user.is_verified,
        },
        profile: profile || null,
        slab: {
          id: user.slab_id,
          name: user.slab_name,
          rank: user.slab_rank,
          pay_later_limit: parseFloat(user.pay_later_limit) || 0,
          description: user.slab_description,
        },
        categories: categories || [],
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  updateProfile,
  setUserCategoriesHandler,
  updateUserCategoriesHandler,
  getUserCategoriesHandler,
  getCompleteProfileHandler,
};
