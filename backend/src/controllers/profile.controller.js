const { updateUser, assignSlabToUser } = require("../models/user.model");
const {
  getUserProfile,
  upsertUserProfile,
  getUserCategories,
  assignUserCategories,
  updateUserCategories,
} = require("../models/user_profile.model");

const getProfileHandler = async (req, res, next) => {
  try {
    const userId = req.user.id;
    if (!userId) return res.status(400).json({ message: "UserId not found!" });

    const profile = await getUserProfile(userId);
    if (!profile)
      return res
        .status(400)
        .json({ message: "profile does not fetched or doesn't exist" });

    res.status(201).json({
      message: "Profile fetched succesfully!",
      profile,
    });
  } catch (err) {
    next(err);
  }
};

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
 * ADMIN / STAFF: Assign slab to a USER
 * Body: { user_id, slab_id }
 */
const assignUserSlabHandler = async (req, res, next) => {
  try {
    const { user_id, slab_id } = req.body;

    if (!user_id || !slab_id) {
      return res.status(400).json({
        message: "user_id and slab_id are required.",
      });
    }

    const updatedUser = await assignSlabToUser(user_id, slab_id);

    return res.status(200).json({
      success: true,
      message: "User slab updated successfully.",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error in assignUserSlabHandler:", error);
    next(error);
  }
};

module.exports = {
  getProfileHandler,
  updateProfile,
  setUserCategoriesHandler,
  updateUserCategoriesHandler,
  getUserCategoriesHandler,
  assignUserSlabHandler,
};
