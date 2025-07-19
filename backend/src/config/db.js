const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // stored in .env

  //Dont Forget to comment off this ssl setting on main server
  ssl: {
    rejectUnauthorized: false, // Render uses a self-signed cert
  },
});

pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL Database");
});

module.exports = pool;
