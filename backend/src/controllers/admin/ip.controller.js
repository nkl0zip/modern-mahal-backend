const ipModel = require("../../models/admin/ip.model");

/**
 * Add a new global office IP (ADMIN-ONLY)
 */
const addOfficeIpHandler = async (req, res, next) => {
  try {
    const { ip_address, description } = req.body;
    if (!ip_address)
      return res.status(400).json({ message: "IP Address is required" });

    const created = await ipModel.addAllowedIp({
      ip_address,
      description,
      created_by: req.user.id,
    });
    if (!created)
      return res
        .status(400)
        .json({ message: "IP already exists or failed to add." });

    res
      .status(201)
      .json({ success: true, message: "Office IP added.", ip: created });
  } catch (error) {
    console.error("addOfficeIpHandler:", error);
    next(error);
  }
};

/**
 * List all allowed (global) office IPs
 */
const listOfficeIpsHandler = async (req, res, next) => {
  try {
    const ips = await ipModel.listAllowedIps();
    res.status(200).json({ success: true, count: ips.length, ips });
  } catch (error) {
    console.error("listOfficeIpsHandler", error);
    next(error);
  }
};

/**
 * Delete an office IP by id
 */
const deleteOfficeIpHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await ipModel.deleteAllowedIp(id);
    if (!deleted) return res.status(404).json({ message: "IP not found" });
    res
      .status(200)
      .json({ success: true, message: "Office IP removed.", ip: deleted });
  } catch (error) {
    console.error("deleteOfficeIpHandler: ", error);
    next(error);
  }
};

/**
 * List pending staff IP requests
 */
const listPendingRequestsHandler = async (req, res, next) => {
  try {
    const rows = await ipModel.getPendingRequests();
    res.status(200).json({ success: true, count: rows.length, requests: rows });
  } catch (error) {
    console.error("listPendingRequestsHandler: ", error);
    next(error);
  }
};

/**
 * Approve a staff IP request
 * - request_id param
 * - body: { access_level: "FULL" | "RESTRICTED" } optional
 */
const approveRequestHandler = async (req, res, next) => {
  try {
    const { id: request_id } = req.params;
    const { access_level } = req.body;
    const AL = access_level === "FULL" ? "FULL" : "RESTRICTED";

    const updatedReq = await ipModel.updateStaffIpRequestStatus({
      request_id,
      status: "APPROVED",
      reviewed_by: req.user.id,
    });
    if (!updatedReq)
      return res.status(404).json({ message: "Request not found" });

    // Create or update staff_ip_access
    await ipModel.addStaffIpAccess({
      staff_id: updatedReq.staff_id,
      ip_address: updatedReq.ip_address,
      access_level: AL,
      approved_by: req.user.id,
    });

    res
      .status(200)
      .json({ success: true, message: "Request approved and access granted." });
  } catch (error) {
    console.error("approveRequestHandler: ", error);
    next(error);
  }
};

/**
 * Reject a staff IP request
 */
const rejectRequestHandler = async (req, res, next) => {
  try {
    const { id: request_id } = req.params;
    const updatedReq = await ipModel.updateStaffIpRequestStatus({
      request_id,
      status: "REJECTED",
      reviewed_by: req.user.id,
    });
    if (!updatedReq)
      return res.status(404).json({ message: "Request not found" });

    res.status(200).json({ success: true, message: "Request rejected." });
  } catch (error) {
    console.error("rejectRequestHandler: ", error);
    next(error);
  }
};

/**
 * List staff-specific approved IPs
 */
const listStaffAccessHandler = async (req, res, next) => {
  try {
    const rows = await ipModel.listStaffIpAccess();
    res.status(200).json({ success: true, count: rows.length, access: rows });
  } catch (error) {
    console.error("listStaffAccessHandler: ", error);
    next(error);
  }
};

/**
 * Remove staff IP access entry
 */
const removeStaffAccessHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await ipModel.deleteStaffIpAccess(id);
    if (!deleted)
      return res.status(404).json({ message: "Staff IP access not found" });
    res
      .status(200)
      .json({ success: true, message: "Staff IP access removed.", deleted });
  } catch (error) {
    console.error("removeStaffAccessHandler: ", error);
    next(error);
  }
};

module.exports = {
  addOfficeIpHandler,
  listOfficeIpsHandler,
  deleteOfficeIpHandler,
  listPendingRequestsHandler,
  approveRequestHandler,
  rejectRequestHandler,
  listStaffAccessHandler,
  removeStaffAccessHandler,
};
