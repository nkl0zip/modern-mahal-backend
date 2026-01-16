const { getUserProfile } = require("../../models/user_profile.model");

const getProfileByStaffHandler = async (req, res, next) => {
  try {
    const { userId } = req.body;
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

module.exports = {
  getProfileByStaffHandler,
};
