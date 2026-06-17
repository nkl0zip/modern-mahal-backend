const express = require("express");
const {
  getAllAddressesHandler,
  createAddressHandler,
  updateAddressHandler,
  deleteAddressHandler,
  setDefaultAddressHandler,
} = require("../controllers/address.controller");

const {
  authenticateToken,
  requireRole,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// All Addresses routes require authentication
router.use(authenticateToken);

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

// PATCH /api/addresses/:id/default
// Set a specific address as default
router.patch("/:id/default", setDefaultAddressHandler);

module.exports = router;
