const { updateUser } = require("../models/user.model");
const { upsertUserProfile } = require("../models/user_profile.model");

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
  updateProfile,
};
