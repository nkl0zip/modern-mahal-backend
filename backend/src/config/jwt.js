require("dotenv").config();

module.exports = {
  jwtSecret: process.env.JWT_SECRET || "supersecretkey",
  jwtExpire: "24h", // token expiry
};
