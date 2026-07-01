require("dotenv").config();

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("JWT_SECRET environment variable is required but not set");
}

module.exports = {
  jwtSecret,
  jwtExpire: "24h",
};
