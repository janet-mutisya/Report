// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";

// Load environment variables
dotenv.config();

// Import routes
import testRoute from "./routes/testRoute.js";
import scheduleRoutes from './routes/schedularRoutes.js';
import reportRoutes from "./routes/reportRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import dataSyncRoutes from "./routes/dataSyncRoutes.js";
import backupSyncRoutes from "./routes/backupSyncRoute.js";
import { patrolSchedulesRoutes } from "./routes/managePatrolScheduleRoutes.js";

// Import the scheduler (this starts the cron job automatically)
import "./service/scheduler.js";

const app = express();

// Environment variables
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "https://reports-97dm.onrender.com";

// Middleware
app.use(
  cors({
    origin: [FRONTEND_URL, "http://localhost:5173"], // Allow both production & local dev
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json());

// Log each request for debugging (optional but helpful)
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.originalUrl}`);
  next();
});

// API routes
app.use('/api/schedules', scheduleRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/sync", dataSyncRoutes);
app.use("/api/backup", backupSyncRoutes);
app.use("/api", patrolSchedulesRoutes); 
app.use("/api/test", testRoute);

// Root endpoint
app.get("/", (req, res) => {
  res.send("📊 Guard Report API is running, and the scheduler is active.");
});

// 404 handler (for clarity)
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start the server
app.listen(PORT, () => {
  console.log("===============================================");
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Allowed frontend: ${FRONTEND_URL}`);
  console.log(`📊 API base URL: http://localhost:${PORT}/api`);
  console.log("⏰ Scheduler loaded and waiting for its cron trigger.");
  console.log("🛡️  Patrol Schedules API: /api/patrol-schedules"); // Add this line
  console.log("===============================================");
});