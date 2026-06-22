// routes/payment/paylater.routes.js
const express = require("express");
const {
  getMyPayLaterDetails,
  getUserTransactions,
  approveRepayment,
  rejectRepayment,
  getAllTransactions,
  getAdminSummary,
  getOutstandingBalancesList,
  getAuditLogs,
  adminRecordRepaymentHandler,
} = require("../controllers/paylater.controller");
const {
  authenticateToken,
  requireRole,
} = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");

const router = express.Router();

// ============= AUTHENTICATED USER ROUTES =============
// GET /api/paylater/me - Get user's pay later details
router.get("/me", authenticateToken, getMyPayLaterDetails);

// GET /api/paylater/transactions - Get user's transactions
router.get("/transactions", authenticateToken, getUserTransactions);

// ============= ADMIN/SUB-ADMIN/STAFF ROUTES =============
// All routes below require STAFF, ADMIN, or SUB_ADMIN role

// GET /api/paylater/admin/transactions - Get all transactions
router.get(
  "/admin/transactions",
  authenticateToken,
  requireRole(["STAFF", "ADMIN", "SUB_ADMIN"]),
  getAllTransactions,
);

// GET /api/paylater/admin/summary - Get summary
router.get(
  "/admin/summary",
  authenticateToken,
  requireRole(["STAFF", "ADMIN", "SUB_ADMIN"]),
  getAdminSummary,
);

// GET /api/paylater/admin/outstanding - Get outstanding balances
router.get(
  "/admin/outstanding",
  authenticateToken,
  requireRole(["STAFF", "ADMIN", "SUB_ADMIN"]),
  getOutstandingBalancesList,
);

// GET /api/paylater/admin/audit-logs - Get audit logs
router.get(
  "/admin/audit-logs",
  authenticateToken,
  requireRole(["STAFF", "ADMIN", "SUB_ADMIN"]),
  getAuditLogs,
);

// PUT /api/paylater/admin/approve/:transactionId - Approve repayment
router.put(
  "/admin/approve/:transactionId",
  authenticateToken,
  requireRole(["STAFF", "ADMIN", "SUB_ADMIN"]),
  approveRepayment,
);

// PUT /api/paylater/admin/reject/:transactionId - Reject repayment
router.put(
  "/admin/reject/:transactionId",
  authenticateToken,
  requireRole(["STAFF", "ADMIN", "SUB_ADMIN"]),
  rejectRepayment,
);

// POST /api/paylater/admin/repay - Admin records a repayment (with receipt upload)
router.post(
  "/admin/repay",
  authenticateToken,
  requireRole(["STAFF", "ADMIN", "SUB_ADMIN"]),
  upload.single("receipt"),
  adminRecordRepaymentHandler,
);

module.exports = router;
