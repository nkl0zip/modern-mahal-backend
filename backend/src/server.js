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

  // Log number of connected sockets (for debugging)
  setInterval(() => {
    if (socketManager) {
      const connectedSockets = socketManager.getConnectedSockets();
      console.log(`Active sockets: ${connectedSockets.length}`);
    }
  }, 60000); // Log every minute
});

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
  });
});
