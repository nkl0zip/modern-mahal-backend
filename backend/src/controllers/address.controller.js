const {
  getAllAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} = require("../models/address.model");

// To fetch all the addresses of a user
const getAllAddressesHandler = async (req, res, next) => {
  try {
    const { id: user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({ message: "User_id does not exist" });
    }

    const addresses = await getAllAddresses(user_id);

    if (!addresses || addresses.length === 0)
      return res.status(400).json({
        message: "No addresses exist for the User. Create one instead",
      });

    res.status(201).json({
      message: "Addresses fetched successfully.",
      addresses,
    });
  } catch (err) {
    next(err);
  }
};

// To create a new address of an user - can have multiple addresses of a same user
const createAddressHandler = async (req, res, next) => {
  try {
    const {
      user_id,
      address_line_1,
      address_line_2,
      pincode,
      city,
      state,
      mobile_number,
      alternate_mobile_number,
      address_type,
    } = req.body;

    // Required fields check
    if (
      !user_id ||
      !address_line_1 ||
      !pincode ||
      !city ||
      !state ||
      !mobile_number ||
      !address_type
    ) {
      return res
        .status(400)
        .json({ message: "Missing required address fields." });
    }

    const address = await createAddress({
      user_id,
      address_line_1,
      address_line_2,
      pincode,
      city,
      state,
      mobile_number,
      alternate_mobile_number,
      address_type,
    });

    res.status(201).json({
      message: "Address created successfully.",
      address,
    });
  } catch (err) {
    next(err);
  }
};

// Update address
const updateAddressHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      user_id,
      address_line_1,
      address_line_2,
      pincode,
      city,
      state,
      mobile_number,
      alternate_mobile_number,
      address_type,
    } = req.body;

    if (
      !user_id ||
      !address_line_1 ||
      !pincode ||
      !city ||
      !state ||
      !mobile_number ||
      !address_type
    ) {
      return res
        .status(400)
        .json({ message: "Missing required address fields." });
    }

    const updated = await updateAddress(id, user_id, {
      address_line_1,
      address_line_2,
      pincode,
      city,
      state,
      mobile_number,
      alternate_mobile_number,
      address_type,
    });

    if (!updated) {
      return res
        .status(404)
        .json({ message: "Address not found or does not belong to user." });
    }

    res.status(200).json({
      message: "Address updated successfully.",
      address: updated,
    });
  } catch (err) {
    next(err);
  }
};

// Delete an address
const deleteAddressHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    if (!user_id)
      return res.status(400).json({ message: "user_id is required" });

    const deleted = await deleteAddress(id, user_id);

    if (!deleted)
      return res
        .status(404)
        .json({ message: "Address not found or does not belong to the user!" });

    res.status(200).json({
      message: "Address deleted successfully.",
      address: deleted,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllAddressesHandler,
  createAddressHandler,
  updateAddressHandler,
  deleteAddressHandler,
};
