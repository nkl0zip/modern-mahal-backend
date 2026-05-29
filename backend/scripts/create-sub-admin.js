#!/usr/bin/env node

const bcrypt = require("bcryptjs");
const pool = require("../src/config/db");

const createSubAdmin = async () => {
  const email = process.argv[2];
  const password = process.argv[3];
  const name = process.argv[4] || "Sub Admin";

  if (!email || !password) {
    console.error(
      "Usage: node scripts/create-sub-admin.js <email> <password> [name]",
    );
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    // Check if user already exists
    const check = await client.query(
      `SELECT id FROM users WHERE email = $1 AND role = 'SUB_ADMIN'`,
      [email],
    );
    if (check.rows.length > 0) {
      console.error(`Sub-admin with email ${email} already exists.`);
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await client.query(
      `INSERT INTO users (name, email, password_hash, role, is_verified)
       VALUES ($1, $2, $3, 'SUB_ADMIN', true)
       RETURNING id, name, email, role`,
      [name, email, hashedPassword],
    );

    console.log("Sub-admin created successfully:");
    console.log(result.rows[0]);
  } catch (err) {
    console.error("Error creating sub-admin:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

createSubAdmin();
