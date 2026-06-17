const pool = require("../config/db");

// Fetch all addresses of a user
const getAllAddresses = async (user_id) => {
  const query = `
    SELECT * FROM user_address WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`;

  const result = await pool.query(query, [user_id]);
  return result.rows;
};

// Create a new address of an user - An user can have multiple addresses
const createAddress = async (address) => {
  // Start a transaction
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // If this address is set as default, remove default from other addresses
    if (address.is_default) {
      await client.query(
        `UPDATE user_address SET is_default = false WHERE user_id = $1`,
        [address.user_id],
      );
    }

    const query = `
      INSERT INTO user_address
        (user_id, address_line_1, address_line_2, pincode, city, state, mobile_number, alternate_mobile_number, address_type, is_default)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;
    const values = [
      address.user_id,
      address.address_line_1,
      address.address_line_2,
      address.pincode,
      address.city,
      address.state,
      address.mobile_number,
      address.alternate_mobile_number,
      address.address_type,
      address.is_default || false,
    ];
    const result = await client.query(query, values);

    // If this is the first address, make it default
    if (!address.is_default) {
      const countResult = await client.query(
        `SELECT COUNT(*) FROM user_address WHERE user_id = $1`,
        [address.user_id],
      );
      if (parseInt(countResult.rows[0].count) === 1) {
        await client.query(
          `UPDATE user_address SET is_default = true WHERE id = $1`,
          [result.rows[0].id],
        );
        result.rows[0].is_default = true;
      }
    }

    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// Update the current address with (address_id, user_id, address object)
const updateAddress = async (id, user_id, address) => {
  // Start a transaction
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // If this address is set as default, remove default from other addresses
    if (address.is_default) {
      await client.query(
        `UPDATE user_address SET is_default = false WHERE user_id = $1 AND id != $2`,
        [user_id, id],
      );
    }

    const query = `
      UPDATE user_address
      SET address_line_1 = $1,
          address_line_2 = $2,
          pincode = $3,
          city = $4,
          state = $5,
          mobile_number = $6,
          alternate_mobile_number = $7,
          address_type = $8,
          is_default = $9
      WHERE id = $10 AND user_id = $11
      RETURNING *;
    `;
    const values = [
      address.address_line_1,
      address.address_line_2,
      address.pincode,
      address.city,
      address.state,
      address.mobile_number,
      address.alternate_mobile_number,
      address.address_type,
      address.is_default || false,
      id,
      user_id,
    ];
    const result = await client.query(query, values);

    // If this address exists and is_default is false,
    // check if there's any default address for this user
    if (result.rows[0] && !result.rows[0].is_default) {
      const defaultCheck = await client.query(
        `SELECT COUNT(*) FROM user_address WHERE user_id = $1 AND is_default = true`,
        [user_id],
      );

      if (parseInt(defaultCheck.rows[0].count) === 0) {
        // No default address exists, make the first one default
        const firstAddress = await client.query(
          `SELECT id FROM user_address WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
          [user_id],
        );
        if (firstAddress.rows[0]) {
          await client.query(
            `UPDATE user_address SET is_default = true WHERE id = $1`,
            [firstAddress.rows[0].id],
          );
        }
      }
    }

    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// Delete an Address - with (address_id, user_id)
const deleteAddress = async (id, user_id) => {
  // Start a transaction
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Get the address to be deleted
    const addressToDelete = await client.query(
      `SELECT is_default FROM user_address WHERE id = $1 AND user_id = $2`,
      [id, user_id],
    );

    if (addressToDelete.rows.length === 0) {
      return null;
    }

    const wasDefault = addressToDelete.rows[0].is_default;

    const query = `
      DELETE FROM user_address
      WHERE id = $1 AND user_id = $2
      RETURNING *;
    `;
    const result = await client.query(query, [id, user_id]);

    // If the deleted address was default, make another address default
    if (wasDefault && result.rows[0]) {
      const remainingAddress = await client.query(
        `SELECT id FROM user_address WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [user_id],
      );
      if (remainingAddress.rows[0]) {
        await client.query(
          `UPDATE user_address SET is_default = true WHERE id = $1`,
          [remainingAddress.rows[0].id],
        );
      }
    }

    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// Set a specific address as default
const setDefaultAddress = async (id, user_id) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Remove default from all addresses of this user
    await client.query(
      `UPDATE user_address SET is_default = false WHERE user_id = $1`,
      [user_id],
    );

    // Set the specified address as default
    const result = await client.query(
      `UPDATE user_address SET is_default = true WHERE id = $1 AND user_id = $2 RETURNING *;`,
      [id, user_id],
    );

    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getAllAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
};
