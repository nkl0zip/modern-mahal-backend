const { assign } = require("nodemailer/lib/shared");
const {
  getAllTemplates,
  getTemplateStatistics,
} = require("../../models/staff/orderTemplate.model");

/**
 * Get all templates with pagination by ADMIN/STAFF only
 */
const getAllTemplatesHandler = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    // Validate pagination
    if (page < 1) {
      return res.status(400).json({
        message: "Page must be greater than 0",
      });
    }

    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        message: "Limit must be between 1 and 100",
      });
    }

    // For filters
    const filters = {};

    if (req.query.status) {
      const validStatuses = ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"];

      if (!validStatuses.includes(req.query.status)) {
        return res.status(400).json({
          message: `Invalid status. Valid values: ${validStatuses.join(", ")}`,
        });
      }
      filters.status = req.query.status;
    }

    if (req.query.user_id) {
      filters.user_id = req.query.user_id;
    }

    if (req.query.staff_id) {
      filters.staff_id = req.query.user_id;
    }

    if (req.query.created_by) {
      if (!["USER", "STAFF"].includes(req.query.created_by)) {
        return res.status(400).json({
          message: "Invalid created_by value. Must be 'USER' or 'STAFF'",
        });
      }
      filters.created_by = req.query.created_by;
    }

    if (req.query.search) {
      if (req.query.search.trim().length < 2) {
        return res.status(400).json({
          message: "Search query must be at least 2 characters long",
        });
      }
      filters.search = req.query.search.trim();
    }

    if (req.query.start_date) {
      const startDate = new Date(req.query.start_date);
      if (isNaN(startDate.getTime())) {
        return res.status(400).json({
          message: "Invalid start_date format. Use YYYY-MM-DD",
        });
      }
      filters.start_date = startDate.toISOString().split("T")[0];
    }

    if (req.query.end_date) {
      const endDate = new Date(req.query.end_date);
      if (isNaN(endDate.getTime())) {
        return res.status(400).json({
          message: "Invalid end_date format. Use YYYY-MM-DD",
        });
      }
      filters.end_date = endDate.toISOString().split("T")[0];
    }

    // For Sorting
    if (req.query.sort_by) {
      const validSortFields = [
        "created_at",
        "updated_at",
        "finalized_at",
        "total_cost",
        "title",
        "status",
      ];
      if (!validSortFields.includes(req.query.sort_by)) {
        return res.status(400).json({
          message: `Invalid sort_by field. Valid fields: ${validSortFields.join(", ")}`,
        });
      }
      filters.sort_by = req.query.sort_by;
    }

    if (req.query.sort_order) {
      if (!["asc", "desc"].includes(req.query.sort_order.toLowerCase())) {
        return res.status(400).json({
          message: "Invalid sort_order. Must be 'asc' or 'desc'",
        });
      }
      filters.sort_order = req.query.sort_order.toLowerCase();
    }

    // Now getting templates with pagination
    const result = await getAllTemplates(page, limit, filters);

    return res.status(200).json({
      message: "All templates fetched successfully",
      date: result.templates,
      pagination: result.pagination,
      filters: filters,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get template stats by ADMIN/STAFF
 */
const getTemplateStatisticsHandler = async (req, res, next) => {
  try {
    const statistics = await getTemplateStatistics();

    // Formatting the stats
    const formattedStats = {
      total_templates: parseInt(statistics.total_templates),
      by_status: {
        draft: parseInt(statistics.draft_count),
        active: parseInt(statistics.active_count),
        completed: parseInt(statistics.completed_count),
        cancelled: parseInt(statistics.cancelled_count),
      },
      by_assignment: {
        assigned: parseInt(statistics.assigned_count),
        unassigned: parseInt(statistics.unassigned_count),
      },
      uniquer_users: parseInt(statistics.unique_users),
      financial: {
        total_value: parseFloat(statistics.total_value) || 0,
        average_value: parseFloat(statistics.avg_value) || 0,
      },
    };

    return res.status(200).json({
      message: "Template statistics fetched successfully",
      statistics: formattedStats,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllTemplatesHandler,
  getTemplateStatisticsHandler,
};
