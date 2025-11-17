const cron = require("node-cron");
const pool = require("../config/db");

/**
 * Runs every 12 hour:
 * Deletes expired tokens from token_blacklist
 */
cron.schedule("0 */12 * * *", async () => {
  try {
    await pool.query("DELETE FROM token_blacklist WHERE expires_at < NOW()");
  } catch (err) {
    console.error("Token cleanup failed: ", err);
  }
});
