const {
  createUser,
  findUserByEmail,
  findUserByPhone,
  findUserById,
  updateUserPhoneAndVerify,
} = require("../models/user.model");
const {
  findAuthMethodByUserAndProvider,
  findAuthMethodByProviderId,
  createAuthMethod,
} = require("../models/auth_method.model");
const { createUserProfile, upsertUserProfile } = require("../models/user_profile.model");
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

// Google Sign-In/Login
const googleAuth = async (req, res) => {
  const { id_token } = req.body;

  if (!id_token) {
    return res.status(400).json({ message: "Google id_token is required" });
  }

  // Verify Google token first — return 401, not 500, on bad token
  let googleUser;
  try {
    googleUser = await verifyGoogleToken(id_token);
  } catch (err) {
    console.error("Google token verification failed:", err.message);
    return res.status(401).json({ message: "Invalid or expired Google token" });
  }

  const { googleId, email, name, picture } = googleUser;

  try {
    let isNewUser = false;
    let user;

    const authMethod = await findAuthMethodByProviderId(googleId, "GOOGLE");

    if (authMethod) {
      // Returning Google user
      user = await findUserById(authMethod.user_id);
      if (!user) {
        // Auth method exists but user was deleted — treat as orphan
        console.error(`Google auth: orphaned auth_method for user_id=${authMethod.user_id}`);
        return res.status(401).json({ message: "Account not found. Please sign up again." });
      }
    } else {
      const existingUser = await findUserByEmail(email);
      if (existingUser) {
        // Link Google to the existing account and update their avatar
        user = existingUser;
        await createAuthMethod(user.id, "GOOGLE", googleId);
        await upsertUserProfile(user.id, null, picture || null, null, null);
      } else {
        // Brand new user
        isNewUser = true;
        user = await createUser(name, email, null, null, true);
        await createAuthMethod(user.id, "GOOGLE", googleId);
        await upsertUserProfile(user.id, null, picture || null, null, null);
      }
    }

    const token = generateToken(user);

    res.status(200).json({
      message: "Authentication successful",
      token,
      is_new_user: isNewUser,
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
    res.status(500).json({ message: "Google authentication failed" });
  }
};

module.exports = {
  register,
  login,
  sendOtp,
  verifyOtp,
  googleAuth,
};
