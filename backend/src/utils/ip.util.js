/**
 * Get client IP from request headers (x-forwarded-for) or socket
 * Returns the first IP in x-forwarded-for if present.
 */

const getClientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    // x-forwarded-for can be 'client, proxy1, proxy2'
    return xff.split(",")[0].trim();
  }

  // fallback to connection remote address
  return req.socket?.remoteAddress || req.connection?.remoteAddress || null;
};

module.exports = { getClientIp };
