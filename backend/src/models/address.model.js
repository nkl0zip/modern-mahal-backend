const pool = require("../config/db");

// Fetch all addresses of a user
const getAllAddresses = async (user_id) => {
  const query = `
    SELECT * FROM user_address WHERE user_id = $1 ORDER BY created_at DESC`;

  const result = await pool.query(query, [user_id]);
  return result.rows;
};

// Create a new address of an user - An user can have multiple addresses
const createAddress = async (address) => {
  const query = `
    INSERT INTO user_address
      (user_id, address_line_1, address_line_2, pincode, city, state, mobile_number, alternate_mobile_number, address_type)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
  ];
  const result = await pool.query(query, values);
  return result.rows[0];
};

// Update the current address with (address_id, user_id, address object)
const updateAddress = async (id, user_id, address) => {
  const query = `
    UPDATE user_address
    SET address_line_1 = $1,
        address_line_2 = $2,
        pincode = $3,
        city = $4,
        state = $5,
        mobile_number = $6,
        alternate_mobile_number = $7,
        address_type = $8
    WHERE id = $9 AND user_id = $10
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
    id,
    user_id,
  ];
  const result = await pool.query(query, values);
  return result.rows[0];
};

// Delete an Address - with (address_id, user_id)
const deleteAddress = async (id, user_id) => {
  const query = `
    DELETE FROM user_address
    WHERE id = $1 AND user_id = $2
    RETURNING *;
  `;
  const result = await pool.query(query, [id, user_id]);
  return result.rows[0];
};

module.exports = {
  getAllAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
};
