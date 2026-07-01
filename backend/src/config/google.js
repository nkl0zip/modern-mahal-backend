require("dotenv").config();
const { OAuth2Client } = require("google-auth-library");

const WEB_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!WEB_CLIENT_ID) {
  console.error("❌ GOOGLE_CLIENT_ID environment variable is not set");
}

const googleClient = new OAuth2Client(WEB_CLIENT_ID);

const verifyGoogleToken = async (idToken) => {
  if (!WEB_CLIENT_ID) {
    throw new Error("Server misconfiguration: GOOGLE_CLIENT_ID is not set");
  }
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload.email_verified) {
      throw new Error('Google account email is not verified');
    }

    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  } catch (err) {
    console.error("❌ Google Token Verification Failed:", err.message);
    throw new Error(`Google token verification failed: ${err.message}`);
  }
};

module.exports = { verifyGoogleToken };
