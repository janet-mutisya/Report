// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";

// Load environment variables
dotenv.config();

// Import routes
import reportRoutes from "./routes/reportRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import dataSyncRoutes from "./routes/dataSyncRoutes.js";
import backupSyncRoutes from "./routes/backupSyncRoute.js";

// Import the scheduler (this starts the cron job automatically)
import "./service/scheduler.js";

const app = express();

// Environment variables
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "https://report-frontend.onrender.com";

// Middleware
app.use(
  cors({
    origin: [FRONTEND_URL, "http://localhost:5173"], // allow both production and local dev
    credentials: true,
  })
);
app.use(express.json());

// API routes
app.use("/api/reports", reportRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/sync", dataSyncRoutes);
app.use("/api/backup", backupSyncRoutes);

// Root endpoint
app.get("/", (req, res) => {
  res.send("📊 Guard Report API is running, and the scheduler is active.");
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 API base URL: http://localhost:${PORT}/api`);
  console.log("⏰ Scheduler loaded and waiting for its cron trigger.");
});
