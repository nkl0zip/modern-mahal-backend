const express = require("express");
const {
  getAllAddressesHandler,
  createAddressHandler,
  updateAddressHandler,
  deleteAddressHandler,
} = require("../controllers/address.controller");

const router = express.Router();

// GET /api/addresses/:id
// Allowed by USER only
router.get("/:id", getAllAddressesHandler);

// POST /api/addresses
// Allowed by USER only
router.post("/", createAddressHandler);

// PUT /api/addresses/:id
// Allowed by USER only
router.put("/:id", updateAddressHandler);

// DELETE /api/addresses/:id
router.delete("/:id", deleteAddressHandler);

module.exports = router;
