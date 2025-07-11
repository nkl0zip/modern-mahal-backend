require("dotenv").config();
const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ✅ Send OTP
const sendOTP = async (phone) => {
  try {
    const verification = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({
        to: phone,
        channel: "sms", // Can use 'call' for voice OTP
      });

    console.log(`✅ OTP sent to ${phone} (status: ${verification.status})`);
  } catch (error) {
    console.error("❌ Twilio Send OTP Error:", error);
    throw error;
  }
};

// ✅ Verify OTP
const verifyOTP = async (phone, code) => {
  try {
    const verificationCheck = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({
        to: phone,
        code: code,
      });

    console.log(`✅ OTP verification status: ${verificationCheck.status}`);
    return verificationCheck.status === "approved";
  } catch (error) {
    console.error("❌ Twilio Verify OTP Error:", error);
    throw error;
  }
};

module.exports = { sendOTP, verifyOTP };
