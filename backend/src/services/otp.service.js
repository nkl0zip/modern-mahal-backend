const otpGenerator = require("otp-generator");

const generateOTP = () => {
  return otpGenerator.generate(6, {
    upperCaseAlphabets: false,
    specialChars: false,
    lowerCaseAlphabets: false,
  });
};

const otpStore = new Map(); // In-memory store: phone -> { otp, expiresAt }

const saveOTP = (phone, otp) => {
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  otpStore.set(phone, { otp, expiresAt });
};

const validateOTP = (phone, otp) => {
  const record = otpStore.get(phone);
  if (!record) return false;
  if (Date.now() > record.expiresAt) {
    otpStore.delete(phone); // Clean expired OTP
    return false;
  }
  return record.otp === otp;
};

module.exports = {
  generateOTP,
  saveOTP,
  validateOTP,
};
