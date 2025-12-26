const express = require("express");
const {
  listSegmentsHandler,
  createSegmentHandler,
  deleteSegmentHandler,
  getSegmentsByCategoryHandler,
} = require("../../controllers/admin/segment.controller");

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

module.exports = router;
