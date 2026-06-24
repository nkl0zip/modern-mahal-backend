// utils/otpGenerator.js
const crypto = require("crypto");

/**
 * Generate a secure 6-digit OTP
 */
const generateOTP = () => {
  // Generate cryptographically secure random number
  const randomNum = crypto.randomInt(100000, 999999);
  return randomNum.toString();
};

/**
 * Generate a secure pickup ID
 * Format: PICK-YYYYMMDD-XXXXX
 */
const generatePickupId = () => {
  const date = new Date();
  const yyyymmdd = date.toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `PICK-${yyyymmdd}-${random}`;
};

/**
 * Calculate OTP expiry time (7 days from now)
 */
const calculateOTPExpiry = (days = 7) => {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  return expiry;
};

module.exports = {
  generateOTP,
  generatePickupId,
  calculateOTPExpiry,
};
