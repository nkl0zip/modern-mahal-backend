const pool = require("../config/db");
const {
  getUserPayLaterDetails,
  createPayLaterTransaction,
  getUserPayLaterTransactions,
  getPayLaterTransactionById,
  logPayLaterAudit,
  getPayLaterAuditLogs,
  getPayLaterSummary,
  getOutstandingBalances,
  adminRecordRepayment,
} = require("../models/paylater.model");
const cloudinary = require("../config/cloudinary");

/**
 * GET /api/paylater/me
 * Get authenticated user's pay later details
 */
const getMyPayLaterDetails = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const details = await getUserPayLaterDetails(userId);
    if (!details) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const totalCreditLimit = parseFloat(details.total_credit_limit || 0);
    const availableCredit = parseFloat(details.available_credit || 0);
    const outstandingBalance = parseFloat(details.outstanding_balance || 0);

    // Calculate credit utilization percentage
    let creditUtilizationPercentage = 0;
    if (totalCreditLimit > 0) {
      creditUtilizationPercentage =
        (outstandingBalance / totalCreditLimit) * 100;
      // Cap at 100% if outstanding exceeds limit
      if (creditUtilizationPercentage > 100) {
        creditUtilizationPercentage = 100;
      }
    }

    res.status(200).json({
      success: true,
      message: "Pay later details fetched successfully",
      data: {
        user_id: details.user_id,
        user_name: details.user_name,
        user_email: details.user_email,
        available_credit: availableCredit,
        total_credit_limit: totalCreditLimit,
        total_used: parseFloat(details.total_used || 0),
        total_repaid: parseFloat(details.total_repaid || 0),
        outstanding_balance: outstandingBalance,
        slab_id: details.slab_id,
        slab_name: details.slab_name || "No slab assigned",
        slab_rank: details.slab_rank || null,
        slab_description: details.slab_description || null,
        credit_utilization_percentage: creditUtilizationPercentage.toFixed(2),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/paylater/transactions
 * Get user's pay later transactions
 */
const getUserTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    const transactions = await getUserPayLaterTransactions(
      userId,
      parseInt(limit),
      parseInt(offset),
    );

    // Format transactions for response
    const formattedTransactions = transactions.map((t) => ({
      id: t.id,
      transaction_type: t.transaction_type,
      amount: parseFloat(t.amount),
      balance_after: parseFloat(t.balance_after),
      payment_method: t.payment_method,
      transaction_id: t.transaction_id,
      description: t.description,
      receipt_url: t.receipt_url,
      order_id: t.order_id,
      order_number: t.order_number,
      approved_by_name: t.approved_by_name,
      created_at: t.created_at,
    }));

    res.status(200).json({
      success: true,
      message: "Transactions fetched successfully",
      transactions: formattedTransactions,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: transactions.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/paylater/admin/repay
 * Admin/Sub-Admin records a repayment for a user
 * This is for face-to-face repayments where admin uploads receipt
 */
const adminRecordRepaymentHandler = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const adminRole = req.user.role;
    const { user_id, amount, payment_method, transaction_id, description } =
      req.body;

    // Validate required fields
    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "user_id is required",
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount is required and must be greater than 0",
      });
    }

    if (!payment_method) {
      return res.status(400).json({
        success: false,
        message:
          "Payment method is required (CASH, ONLINE, BANK_TRANSFER, CHEQUE, UPI)",
      });
    }

    // Check if user exists and has outstanding balance
    const userDetails = await getUserPayLaterDetails(user_id);
    if (!userDetails) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const outstandingBalance = parseFloat(userDetails.outstanding_balance || 0);
    if (outstandingBalance <= 0) {
      return res.status(400).json({
        success: false,
        message: "User has no outstanding balance to repay",
      });
    }

    if (parseFloat(amount) > outstandingBalance) {
      return res.status(400).json({
        success: false,
        message: `Repayment amount (${amount}) exceeds outstanding balance (${outstandingBalance})`,
      });
    }

    // Handle receipt upload
    let receiptUrl = null;
    let receiptPublicId = null;

    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "paylater-receipts",
          resource_type: "auto",
          allowed_formats: ["jpg", "jpeg", "png", "gif", "pdf"],
        });
        receiptUrl = result.secure_url;
        receiptPublicId = result.public_id;
      } catch (uploadError) {
        console.error("Cloudinary upload error:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload receipt",
          error: uploadError.message,
        });
      }
    }

    // Record repayment using the model function
    const transaction = await adminRecordRepayment({
      user_id: user_id,
      amount: amount,
      payment_method: payment_method,
      transaction_id: transaction_id || null,
      description:
        description || `Repayment of ₹${amount} via ${payment_method}`,
      receipt_url: receiptUrl,
      receipt_public_id: receiptPublicId,
      admin_id: adminId,
      admin_role: adminRole,
      metadata: {
        recorded_by: adminId,
        recorded_by_role: adminRole,
        recorded_at: new Date().toISOString(),
        payment_method: payment_method,
        transaction_id: transaction_id || null,
      },
    });

    // Log audit
    await logPayLaterAudit({
      transaction_id: transaction.id,
      action: "RECORDED_REPAYMENT",
      performed_by: adminId,
      performed_by_role: adminRole,
      new_data: {
        user_id: user_id,
        amount: amount,
        payment_method: payment_method,
        transaction_id: transaction_id,
        description: description,
        receipt_url: receiptUrl,
        new_balance: transaction.balance_after,
      },
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    res.status(201).json({
      success: true,
      message: "Repayment recorded successfully",
      data: {
        transaction_id: transaction.id,
        user_id: user_id,
        amount: parseFloat(transaction.amount),
        payment_method: transaction.payment_method,
        receipt_url: transaction.receipt_url,
        status: "APPROVED",
        new_balance: parseFloat(transaction.balance_after),
        created_at: transaction.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/paylater/admin/approve/:transactionId
 * Admin/Sub-Admin approves a repayment transaction
 */
const approveRepayment = async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    const adminId = req.user.id;
    const adminRole = req.user.role;

    // Get the transaction
    const transaction = await getPayLaterTransactionById(transactionId);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    // Check if already approved
    if (transaction.approved_by) {
      return res.status(400).json({
        success: false,
        message: "Transaction is already approved",
      });
    }

    // Check if it's a repayment transaction
    if (transaction.transaction_type !== "REPAYMENT") {
      return res.status(400).json({
        success: false,
        message: "Only repayment transactions can be approved",
      });
    }

    // Store old data for audit
    const oldData = { ...transaction };

    // Update the transaction - set approved_by
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Update transaction
      const result = await client.query(
        `
        UPDATE pay_later_transactions
        SET 
          approved_by = $1,
          metadata = metadata || $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *;
        `,
        [
          adminId,
          JSON.stringify({
            approved_at: new Date().toISOString(),
            approved_by_name: req.user.name,
            approved_by_role: adminRole,
          }),
          transactionId,
        ],
      );

      const updatedTransaction = result.rows[0];

      // The trigger will automatically update user's balance
      // But we need to ensure the balance update happens correctly
      // Since we already have a trigger on INSERT, we need to manually update balance
      // because the transaction already exists
      await client.query(
        `
        UPDATE users
        SET 
          pay_later_balance = pay_later_balance + $1,
          total_pay_later_repaid = total_pay_later_repaid + $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        `,
        [transaction.amount, transaction.user_id],
      );

      await client.query("COMMIT");

      // Log audit
      await logPayLaterAudit({
        transaction_id: transactionId,
        action: "APPROVED",
        performed_by: adminId,
        performed_by_role: adminRole,
        old_data: oldData,
        new_data: updatedTransaction,
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
      });

      res.status(200).json({
        success: true,
        message: "Repayment approved successfully",
        data: {
          transaction_id: updatedTransaction.id,
          amount: parseFloat(updatedTransaction.amount),
          status: "APPROVED",
          approved_by: adminId,
          approved_at: updatedTransaction.updated_at,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/paylater/admin/reject/:transactionId
 * Admin/Sub-Admin rejects a repayment transaction
 */
const rejectRepayment = async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    const adminId = req.user.id;
    const adminRole = req.user.role;
    const { reason } = req.body;

    // Get the transaction
    const transaction = await getPayLaterTransactionById(transactionId);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    // Check if already approved
    if (transaction.approved_by) {
      return res.status(400).json({
        success: false,
        message: "Transaction is already approved and cannot be rejected",
      });
    }

    // Check if it's a repayment transaction
    if (transaction.transaction_type !== "REPAYMENT") {
      return res.status(400).json({
        success: false,
        message: "Only repayment transactions can be rejected",
      });
    }

    // Store old data for audit
    const oldData = { ...transaction };

    // Update transaction status
    const result = await pool.query(
      `
      UPDATE pay_later_transactions
      SET 
        metadata = metadata || $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *;
      `,
      [
        JSON.stringify({
          status: "REJECTED",
          rejected_at: new Date().toISOString(),
          rejected_by: adminId,
          rejected_by_role: adminRole,
          rejection_reason: reason || null,
        }),
        transactionId,
      ],
    );

    const updatedTransaction = result.rows[0];

    // Log audit
    await logPayLaterAudit({
      transaction_id: transactionId,
      action: "REJECTED",
      performed_by: adminId,
      performed_by_role: adminRole,
      old_data: oldData,
      new_data: updatedTransaction,
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    res.status(200).json({
      success: true,
      message: "Repayment rejected",
      data: {
        transaction_id: updatedTransaction.id,
        amount: parseFloat(updatedTransaction.amount),
        status: "REJECTED",
        reason: reason || null,
        rejected_by: adminId,
        rejected_at: updatedTransaction.updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/paylater/admin/transactions
 * Admin/Sub-Admin gets all pay later transactions (with filtering)
 */
const getAllTransactions = async (req, res, next) => {
  try {
    const {
      user_id,
      transaction_type,
      status,
      start_date,
      end_date,
      limit = 50,
      offset = 0,
    } = req.query;

    let query = `
      SELECT 
        pt.*,
        u.name as user_name,
        u.email as user_email,
        a.name as approved_by_name,
        a.email as approved_by_email,
        o.order_number
      FROM pay_later_transactions pt
      LEFT JOIN users u ON pt.user_id = u.id
      LEFT JOIN users a ON pt.approved_by = a.id
      LEFT JOIN orders o ON pt.order_id = o.id
      WHERE 1=1
    `;

    const params = [];
    let paramCounter = 1;

    if (user_id) {
      query += ` AND pt.user_id = $${paramCounter}`;
      params.push(user_id);
      paramCounter++;
    }

    if (transaction_type) {
      query += ` AND pt.transaction_type = $${paramCounter}`;
      params.push(transaction_type);
      paramCounter++;
    }

    if (status) {
      if (status === "PENDING_APPROVAL") {
        query += ` AND pt.approved_by IS NULL AND pt.transaction_type = 'REPAYMENT'`;
      } else if (status === "APPROVED") {
        query += ` AND pt.approved_by IS NOT NULL AND pt.transaction_type = 'REPAYMENT'`;
      } else if (status === "REJECTED") {
        query += ` AND pt.metadata->>'status' = 'REJECTED'`;
      }
    }

    if (start_date) {
      query += ` AND pt.created_at >= $${paramCounter}`;
      params.push(start_date);
      paramCounter++;
    }

    if (end_date) {
      query += ` AND pt.created_at <= $${paramCounter}`;
      params.push(end_date);
      paramCounter++;
    }

    query += ` ORDER BY pt.created_at DESC LIMIT $${paramCounter} OFFSET $${paramCounter + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await pool.query(query, params);

    res.status(200).json({
      success: true,
      message: "Transactions fetched successfully",
      transactions: rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: rows.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/paylater/admin/summary
 * Admin/Sub-Admin gets pay later summary
 */
const getAdminSummary = async (req, res, next) => {
  try {
    const summary = await getPayLaterSummary();

    res.status(200).json({
      success: true,
      message: "Pay later summary fetched successfully",
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/paylater/admin/outstanding
 * Admin/Sub-Admin gets outstanding balances
 */
const getOutstandingBalancesList = async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const balances = await getOutstandingBalances(
      parseInt(limit),
      parseInt(offset),
    );

    res.status(200).json({
      success: true,
      message: "Outstanding balances fetched successfully",
      data: balances,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: balances.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/paylater/admin/audit-logs
 * Admin/Sub-Admin gets audit logs
 */
const getAuditLogs = async (req, res, next) => {
  try {
    const { transaction_id, user_id, limit = 50, offset = 0 } = req.query;

    const logs = await getPayLaterAuditLogs(
      transaction_id,
      user_id,
      parseInt(limit),
      parseInt(offset),
    );

    res.status(200).json({
      success: true,
      message: "Audit logs fetched successfully",
      logs,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: logs.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getMyPayLaterDetails,
  getUserTransactions,
  adminRecordRepaymentHandler,
  approveRepayment,
  rejectRepayment,
  getAllTransactions,
  getAdminSummary,
  getOutstandingBalancesList,
  getAuditLogs,
};
