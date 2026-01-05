const app = require("./app");
const http = require("http");
const PORT = process.env.PORT || 5000;
const { initializeSocket } = require("./config/socket");
const os = require("os");

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io with the HTTP server
const socketManager = initializeSocket(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.io initialized: ${socketManager ? "YES" : "NO"}`);
});

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
  });
});
