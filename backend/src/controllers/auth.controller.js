const {
  createUser,
  findUserByEmail,
  findUserByPhone,
  updateUserPhoneAndVerify,
} = require("../models/user.model");
const {
  findAuthMethodByUserAndProvider,
  createAuthMethod,
} = require("../models/auth_method.model");
const { createUserProfile } = require("../models/user_profile.model");
const {
  generateOTP,
  saveOTP,
  validateOTP,
} = require("../services/otp.service");
const { sendOTP, verifyOTP } = require("../config/twilio");
const {
  hashPassword,
  verifyPassword,
  generateToken,
} = require("../services/auth.service");
const { verifyGoogleToken } = require("../config/google");

// ✅ Send OTP using Twilio Verify API
const sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    // Send OTP via Twilio Verify
    await sendOTP(phone);

    res.status(200).json({ message: "OTP sent successfully" });
  } catch (error) {
    console.error("Send OTP Error:", error);
    res.status(500).json({ message: "Failed to send OTP" });
  }
};

// ✅ Verify OTP using Twilio Verify API
const verifyOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res
        .status(400)
        .json({ message: "Phone number and OTP are required" });
    }

    // Verify OTP
    const isVerified = await verifyOTP(phone, otp);
    if (!isVerified) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // Find user by phone
    let user = await findUserByPhone(phone);

    if (!user) {
      // 🆕 Case 1: Register new user
      user = await createUser(null, null, null, phone, true);
      await createAuthMethod(user.id, "PHONE_OTP");
    } else {
      // Check if user has PHONE_OTP auth method
      const authMethod = await findAuthMethodByUserAndProvider(
        user.id,
        "PHONE_OTP"
      );
      if (!authMethod) {
        // 🆕 Case 2: Add PHONE_OTP auth
        await createAuthMethod(user.id, "PHONE_OTP");
      }
      // 🆕 Case 3: Update user's phone & mark as verified
      await updateUserPhoneAndVerify(user.id, phone);
      user = await findUserByPhone(phone); // Get updated user data
    }

    // Generate JWT token
    const token = generateToken(user);

    res.status(200).json({
      message: "Authentication successful",
      token,
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role,
        is_verified: user.is_verified,
      },
    });
  } catch (error) {
    console.error("Verify OTP Error:", error);
    res.status(500).json({ message: "Failed to verify OTP" });
  }
};

// Email Register
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "User with this email already exists" });
    }

    // Hash password and save user
    const passwordHash = await hashPassword(password);
    const user = await createUser(name, email, passwordHash, null, false);

    // Automatically create userprofile for new user
    const profile = await createUserProfile(user.id);

    // Insert into auth_methods table
    await createAuthMethod(user.id, "EMAIL");

    // Generate JWT token
    const token = generateToken(user);

    res.status(201).json({
      message: "User registered successfully",
      user,
      token,
      profile,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Email Login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // Check if EMAIL login method exists for this user
    const authMethod = await findAuthMethodByUserAndProvider(user.id, "EMAIL");
    if (!authMethod) {
      return res.status(400).json({
        message: "This user does not have EMAIL login enabled",
      });
    }

    // Verify password
    const isMatch = await verifyPassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // Generate JWT
    const token = generateToken(user);

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_verified: user.is_verified,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Google Sign-In/Login
const googleAuth = async (req, res) => {
  try {
    const { id_token } = req.body;

    if (!id_token) {
      return res.status(400).json({ message: "Google id_token is required" });
    }

    // ✅ Verify Google token
    const googleUser = await verifyGoogleToken(id_token);
    const { googleId, email, name, picture } = googleUser;

    // ✅ Check if user already exists with this Google ID
    let authMethod = await findAuthMethodByProviderId(googleId, "GOOGLE");

    let user;
    if (authMethod) {
      // 🟢 Existing user → fetch user
      user = await findUserById(authMethod.user_id);
    } else {
      // 🆕 New user → create user, auth_method, and user_profile
      user = await createUser(name, email, null, null, true);
      await createAuthMethod(user.id, "GOOGLE", googleId);
      await createUserProfile(user.id, null, picture, null, null);
    }

    // ✅ Generate JWT
    const token = generateToken(user);

    res.status(200).json({
      message: "Authentication successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_verified: user.is_verified,
      },
    });
  } catch (error) {
    console.error("Google Auth Error:", error);
    res
      .status(500)
      .json({ message: error.message || "Google authentication failed" });
  }
};

module.exports = {
  register,
  login,
  sendOtp,
  verifyOtp,
  googleAuth,
};
