const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();

const authRoutes = require("./routes/auth.routes");
const profileRoutes = require("./routes/profile.routes");
const categoryRoutes = require("./routes/admin/category.routes");
const brandRoutes = require("./routes/admin/brand.routes");

const errorHandler = require("./middlewares/error.middleware");

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use("/api/profile", profileRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/category", categoryRoutes);
app.use("/api/brand", brandRoutes);

app.use(errorHandler); // Add after all routes

module.exports = app;
