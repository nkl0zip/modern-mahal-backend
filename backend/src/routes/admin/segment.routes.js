const express = require("express");
const {
  listSegmentsHandler,
  createSegmentHandler,
  deleteSegmentHandler,
  getSegmentsByCategoryHandler,
  getUserSegmentsHandler,
} = require("../../controllers/admin/segment.controller");

const { authenticateToken } = require("../../middlewares/auth.middleware");
const { auth } = require("google-auth-library");
const router = express.Router();

/**
 * ADMIN / STAFF
 */

// GET: /api/segment/list
router.get("/list", listSegmentsHandler);

// POST: /api/segment/create
router.post("/create", createSegmentHandler);

// DELETE: /api/segment/delete/:id
router.delete("/delete/:id", deleteSegmentHandler);

/**
 * GET /api/segment/category?id=uuid
 * GET /api/segment/category?name=Glass
 */
router.get("/category", getSegmentsByCategoryHandler);

/**
 * GET /api/segment/user
 */
router.get("/user", authenticateToken, getUserSegmentsHandler);

module.exports = router;
