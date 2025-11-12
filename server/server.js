// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";

// Load environment variables
dotenv.config();

// Import routes
import testRoute from "./routes/testRoute.js";
import schedularRoutes from './routes/schedularRoutes.js'; // Use the actual file name
import reportRoutes from "./routes/reportRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import dataSyncRoutes from "./routes/dataSyncRoutes.js";
import backupSyncRoutes from "./routes/backupSyncRoute.js";
import patrolSchedulesRoutes from "./routes/managePatrolScheduleRoutes.js";

// Import the scheduler (this starts the cron job automatically)
import "./service/scheduler.js";

const app = express();

// Environment variables
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "https://reports-97dm.onrender.com";

// Middleware
app.use(
  cors({
    origin: [FRONTEND_URL, "http://localhost:5173", "http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json());

// Log each request for debugging
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.originalUrl}`);
  next();
});

// =============================================
// 🎯 API ROUTES - CORRECT ORDER AND CONFIGURATION
// =============================================

// IMPORTANT: schedularRoutes must come first to handle all /api/scheduler/* routes
app.use('/api/scheduler', schedularRoutes);

// Other API routes
app.use("/api/reports", reportRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/sync", dataSyncRoutes);
app.use("/api/backup", backupSyncRoutes);
app.use("/api/patrol-schedules", patrolSchedulesRoutes);
app.use("/api/test", testRoute);

// =============================================
// 🏠 HEALTH CHECK ENDPOINTS
// =============================================

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "📊 Guard Report API is running, and the scheduler is active.",
    version: "1.0.0",
    endpoints: {
      scheduler: "/api/scheduler",
      health: "/api/scheduler/health",
      clients: "/api/clients",
      reports: "/api/reports",
      patrolSchedules: "/api/patrol-schedules"
    }
  });
});

// Health check endpoint that frontend expects
app.get('/api/scheduler/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Scheduler API is healthy and running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    server: {
      port: PORT,
      environment: process.env.NODE_ENV || 'development'
    },
    endpoints: {
      clients: '/api/scheduler/clients',
      schedules: '/api/scheduler',
      triggers: '/api/scheduler/trigger',
      reports: '/api/scheduler/send-enhanced',
      previews: '/api/scheduler/preview',
      status: '/api/scheduler/system/status'
    }
  });
});

// Global health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API Server is healthy',
    timestamp: new Date().toISOString(),
    services: {
      scheduler: 'active',
      database: 'connected',
      cron: 'running'
    }
  });
});

// =============================================
// 🎯 ENDPOINT LISTING (Helpful for debugging)
// =============================================

app.get('/api', (req, res) => {
  res.json({
    message: "Guard Report API - Available Endpoints",
    version: "1.0.0",
    endpoints: {
      // Scheduler endpoints (what frontend uses)
      scheduler: {
        base: "/api/scheduler",
        clients: {
          all: "/api/scheduler/clients",
          basic: "/api/scheduler/clients/basic",
          performance: "/api/scheduler/clients/performance"
        },
        schedules: "/api/scheduler",
        status: "/api/scheduler/status",
        health: "/api/scheduler/health",
        analytics: {
          summary: "/api/scheduler/analytics/summary",
          client: "/api/scheduler/analytics/client/:clientId"
        },
        triggers: {
          dynamic: "/api/scheduler/trigger/dynamic-reports",
          patrol: "/api/scheduler/trigger/patrol-reports"
        },
        reports: {
          enhanced: "/api/scheduler/send-enhanced/:clientId",
          preview: "/api/scheduler/preview/:clientId"
        },
        historical: "/api/scheduler/historical/:clientId",
        debug: "/api/scheduler/debug/data/:clientId",
        test: "/api/scheduler/test/pdf/:clientId"
      },
      // Other API endpoints
      clients: "/api/clients",
      reports: "/api/reports",
      sync: "/api/sync",
      backup: "/api/backup",
      patrolSchedules: "/api/patrol-schedules",
      test: "/api/test"
    }
  });
});

// =============================================
// 🚨 ERROR HANDLERS
// =============================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: "Endpoint not found",
    requested: req.originalUrl,
    availableEndpoints: "/api"
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err);
  res.status(500).json({ 
    success: false,
    error: "Internal server error",
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// =============================================
// 🚀 SERVER STARTUP
// =============================================

// Start the server
app.listen(PORT, () => {
  console.log("===============================================");
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Allowed frontends: ${FRONTEND_URL}, http://localhost:5173`);
  console.log(`📊 API base URL: http://localhost:${PORT}/api`);
  console.log("⏰ Scheduler loaded and waiting for its cron trigger.");
  console.log("🛡️  Patrol Schedules API: /api/patrol-schedules");
  console.log("❤️  Health check: http://localhost:" + PORT + "/api/scheduler/health");
  console.log("📋 All endpoints: http://localhost:" + PORT + "/api");
  console.log("===============================================");
});