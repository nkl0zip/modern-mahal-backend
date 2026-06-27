const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();
require("./jobs/cleanupTokens.job");

const { startCleanupScheduler } = require("./jobs/cleanupOrders.job");

const authRoutes = require("./routes/auth.routes");
const profileRoutes = require("./routes/profile.routes");
const categoryRoutes = require("./routes/admin/category.routes");
const brandRoutes = require("./routes/admin/brand.routes");
const productRoutes = require("./routes/staff/product.routes");
const productImageRoutes = require("./routes/staff/productImage.routes");
const addressRoutes = require("./routes/address.routes");
const wishlistRoutes = require("./routes/wishlist.routes");
const cartRoutes = require("./routes/cart.routes");
const reviewRoutes = require("./routes/review.routes");
const adminRoutes = require("./routes/admin/admin.routes");
const staffRoutes = require("./routes/staff/staff.routes");
const adminIpRoutes = require("./routes/admin/ip.routes");
const ticketRoutes = require("./routes/staff/ticket.routes");
const productVariantRoutes = require("./routes/staff/productVariant.routes");
const segmentRoutes = require("./routes/admin/segment.routes");
const orderChatRoutes = require("./routes/staff/orderTemplate.routes");
const userDetailRoutes = require("./routes/staff/userDetails.routes");
const discountRoutes = require("./routes/staff/discount.routes");
const orderRoutes = require("./routes/order.routes");
const paymentRoutes = require("./routes/payment.routes");
const subAdminRoutes = require("./routes/sub-admin.routes");
const slabRoutes = require("./routes/admin/slab.routes");
const paylaterRoutes = require("./routes/paylater.routes");
const storeRoutes = require("./routes/admin/store.routes");
const deliveryRoutes = require("./routes/delivery.routes");

const errorHandler = require("./middlewares/error.middleware");

const app = express();

const { ensureAdminAccount } = require("./models/admin/admin.model");

(async () => {
  await ensureAdminAccount();
})();

// Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// TODO: TEMP - remove before production
app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl, body, query, headers } = req;

  console.log(`\n[REQ] ${method} ${originalUrl}`);
  if (Object.keys(query).length) console.log("[REQ] Query:", query);
  if (Object.keys(body || {}).length) console.log("[REQ] Body:", JSON.stringify(body, null, 2));
  if (headers.authorization) console.log("[REQ] Auth:", headers.authorization.slice(0, 30) + "...");

  const originalJson = res.json.bind(res);
  res.json = (data) => {
    const duration = Date.now() - start;
    console.log(`[RES] ${method} ${originalUrl} -> ${res.statusCode} (${duration}ms)`);
    console.log("[RES] Body:", JSON.stringify(data, null, 2));
    return originalJson(data);
  };

  next();
});

startCleanupScheduler();

// Routes
app.use("/api/profile", profileRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/category", categoryRoutes);
app.use("/api/brand", brandRoutes);
app.use("/api/products", productRoutes);
app.use("/api/product-images", productImageRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/sub-admin", subAdminRoutes);
app.use("/api/admin/ips", adminIpRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/products/variant", productVariantRoutes);
app.use("/api/segment", segmentRoutes);
app.use("/api/order-templates", orderChatRoutes);
app.use("/api/user", userDetailRoutes);
app.use("/api/discount", discountRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/slabs", slabRoutes);
app.use("/api/paylater", paylaterRoutes);
app.use("/api/store", storeRoutes);
app.use("/api/delivery", deliveryRoutes);

app.use(errorHandler);

const os = require("os");

// Get local network IP
const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "IP not found";
};

console.log("Server Local IP:", getLocalIP());

module.exports = app;
