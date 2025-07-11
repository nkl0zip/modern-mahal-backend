require("dotenv").config();
const axios = require("axios");

const sendOTP = async (phone, otp) => {
  try {
    // Format phone number (Fast2SMS expects Indian numbers without +91)
    const formattedPhone = phone.replace("+91", "");

    const payload = {
      sender_id: "FSTSMS", // For Transactional SMS
      message: `Your Modern Mahal OTP is ${otp}. It will expire in 5 minutes.`,
      language: "english",
      route: "q", // Transactional route
      numbers: formattedPhone,
    };

    const response = await axios.post(
      "https://www.fast2sms.com/dev/bulkV2",
      payload,
      {
        headers: {
          authorization: process.env.FAST2SMS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data.return === false) {
      throw new Error("Fast2SMS API error: " + JSON.stringify(response.data));
    }

    console.log(`✅ OTP sent to ${phone} via Fast2SMS`);
  } catch (error) {
    console.error(
      "❌ Fast2SMS OTP Error:",
      error.response?.data || error.message
    );
    throw error;
  }
};

module.exports = { sendOTP };
