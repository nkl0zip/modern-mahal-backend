const { updateUser } = require("../models/user.model");
const {
  getUserProfile,
  upsertUserProfile,
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
      working_email
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

module.exports = {
  getProfileHandler,
  updateProfile,
};
