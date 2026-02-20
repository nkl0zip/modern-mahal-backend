const axios = require("axios");
const crypto = require("crypto");

// Environment variables
const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID;
const SALT_KEY = process.env.PHONEPE_SALT_KEY;
const SALT_INDEX = process.env.PHONEPE_SALT_INDEX;
const BASE_URL = process.env.PHONEPE_BASE_URL;
const CALLBACK_URL = process.env.PHONEPE_CALLBACK_URL;

/**
 * Generate X-VERIFY header
 * Steps:
 * 1. base64 encode the payload
 * 2. Append "/pg/v1/pay" + salt_key
 * 3. SHA256 hash + "###" + salt_index
 */
const generateXVerify = (payloadBase64, endpointSuffix = "/pg/v1/pay") => {
  const stringToHash = payloadBase64 + endpointSuffix + SALT_KEY;
  const sha256 = crypto.createHash("sha256").update(stringToHash).digest("hex");
  return `${sha256}###${SALT_INDEX}`;
};

/**
 * Initiate a PhonePe payment
 * Returns the redirect URL
 */
const initiatePayment = async ({
  orderId,
  amount,
  merchantTransactionId,
  userPhone = null,
  redirectMode = "REDIRECT",
}) => {
  const payload = {
    merchantId: MERCHANT_ID,
    merchantTransactionId,
    merchantUserId: orderId, // can be order_id or user_id
    amount: amount * 100, // PhonePe expects amount in paisa
    redirectUrl: `${process.env.FRONTEND_URL}/payment-status?orderId=${orderId}`, // frontend return URL after payment
    redirectMode,
    callbackUrl: CALLBACK_URL,
    mobileNumber: userPhone,
    paymentInstrument: {
      type: "PAY_PAGE",
    },
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const xVerify = generateXVerify(payloadBase64);

  try {
    const response = await axios.post(
      `${BASE_URL}/pg/v1/pay`,
      { request: payloadBase64 },
      {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": xVerify,
        },
      },
    );

    // PhonePe returns a success response with redirectUrl inside data.instrumentResponse.redirectInfo.url
    if (response.data.success) {
      const redirectUrl =
        response.data.data.instrumentResponse.redirectInfo.url;
      return {
        success: true,
        redirectUrl,
        transactionId: merchantTransactionId,
      };
    } else {
      throw new Error(response.data.message || "PhonePe initiation failed");
    }
  } catch (err) {
    console.error("PhonePe initiate error:", err.response?.data || err.message);
    throw err;
  }
};

/**
 * Verify callback signature
 */
const verifyCallback = (payloadBase64, xVerifyHeader) => {
  const stringToHash = payloadBase64 + SALT_KEY;
  const sha256 = crypto.createHash("sha256").update(stringToHash).digest("hex");
  const expectedHash = `${sha256}###${SALT_INDEX}`;

  return xVerifyHeader === expectedHash;
};

/**
 * Decode callback payload
 */
const decodeCallbackPayload = (payloadBase64) => {
  const decoded = Buffer.from(payloadBase64, "base64").toString("utf8");
  return JSON.parse(decoded);
};

/**
 * Check payment status (optional, for polling)
 */
const checkPaymentStatus = async (merchantTransactionId) => {
  const endpoint = `/pg/v1/status/${MERCHANT_ID}/${merchantTransactionId}`;
  const xVerify = generateXVerify("", endpoint); // empty payload for status check

  try {
    const response = await axios.get(`${BASE_URL}${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": xVerify,
        "X-MERCHANT-ID": MERCHANT_ID,
      },
    });
    return response.data;
  } catch (err) {
    console.error(
      "PhonePe status check error:",
      err.response?.data || err.message,
    );
    throw err;
  }
};

module.exports = {
  initiatePayment,
  verifyCallback,
  decodeCallbackPayload,
  checkPaymentStatus,
};
