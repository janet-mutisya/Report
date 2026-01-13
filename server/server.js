// server.js - FULLY OPTIMIZED VERSION WITH INCIDENT ROUTES - FIXED ROUTE ORDER
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { createConnection } from 'net';
import cluster from 'cluster';
import os from 'os';

// Load environment variables
dotenv.config();

// =============================================
// 🚀 PRODUCTION OPTIMIZATIONS
// =============================================
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 5000;

// Cluster mode for production
if (IS_PRODUCTION && cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`🚀 Master ${process.pid} is running`);
  
  for (let i = 0; i < Math.min(numCPUs, 4); i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`⚠️ Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
}

// =============================================
// 🛑 EMAIL KILL SWITCH - GLOBAL CONTROL
// =============================================
const EMAIL_ENABLED = process.env.ENABLE_EMAIL_SENDING === 'true';
global.EMAIL_SENDING_ENABLED = EMAIL_ENABLED;

console.log(`
╔════════════════════════════════════════════╗
║     📧 EMAIL SENDING STATUS                ║
║     ${EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}                         ║
╚════════════════════════════════════════════╝
Worker ${process.pid} started
`);

// =============================================
// 🛡️ NETWORK RESILIENCE & ERROR HANDLING
// =============================================

process.on('unhandledRejection', (reason, promise) => {
  console.error('🛡️ Unhandled Rejection at:', promise, 'reason:', reason);
  if (IS_PRODUCTION) {
    // Log to external service (Sentry, Loggly, etc.)
  }
});

process.on('uncaughtException', (error) => {
  if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
    console.log('🛡️ Network error handled gracefully:', error.message);
    return;
  }
  console.error('❌ Critical error:', error);
  if (IS_PRODUCTION) {
    // Log to external service
  }
  process.exit(1);
});

// =============================================
// 🚀 OPTIMIZED NETWORK CHECK (CACHED)
// =============================================

let cachedNetworkStatus = false;
let lastNetworkCheck = 0;
const NETWORK_CHECK_INTERVAL = 60000; // Check once per minute

const isNetworkAvailable = async () => {
  return new Promise((resolve) => {
    const socket = createConnection({ port: 80, host: '8.8.8.8' });
    
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 3000); // Reduced timeout to 3 seconds
    
    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });
    
    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
};

// Background network status updater
async function updateNetworkStatus() {
  try {
    const status = await isNetworkAvailable();
    cachedNetworkStatus = status;
    lastNetworkCheck = Date.now();
    
    // Only log if status changed
    const currentTime = new Date().toISOString();
    if (cachedNetworkStatus !== status) {
      console.log(`🌐 [${currentTime}] Network status changed: ${status ? 'Online ✅' : 'Offline ❌'}`);
    }
  } catch (error) {
    cachedNetworkStatus = false;
    lastNetworkCheck = Date.now();
  }
}

// Initial network check
updateNetworkStatus();

// Update network status every minute in the background
setInterval(updateNetworkStatus, NETWORK_CHECK_INTERVAL);

// Circuit Breaker for network operations
class CircuitBreaker {
  constructor(timeout = 10000) {
    this.state = 'CLOSED';
    this.timeout = timeout;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    this.threshold = 3;
    this.resetTimeout = 30000;
  }
  
  async execute(asyncFunction) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN - waiting for recovery');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await Promise.race([
        asyncFunction(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), this.timeout)
        )
      ]);
      
      this.successCount++;
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failureCount = 0;
        console.log('✅ Circuit breaker reset to CLOSED');
      }
      return result;
    } catch (error) {
      this.failureCount++;
      
      if (this.failureCount >= this.threshold || this.state === 'HALF_OPEN') {
        this.state = 'OPEN';
        this.nextAttempt = Date.now() + this.resetTimeout;
        console.log(`🔴 Circuit breaker OPEN until ${new Date(this.nextAttempt).toISOString()}`);
      }
      
      throw error;
    }
  }
}

const networkBreaker = new CircuitBreaker(10000);

// =============================================
// 🔒 CUSTOM MONGO SANITIZATION
// =============================================

const sanitize = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitize(item));
  }
  
  const sanitized = {};
  for (let key in obj) {
    if (key.includes('$') || key.includes('.')) {
      continue;
    }
    
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitized[key] = sanitize(obj[key]);
    } else {
      sanitized[key] = obj[key];
    }
  }
  return sanitized;
};

const mongoSanitizeMiddleware = (req, res, next) => {
  try {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitize(req.body);
    }
    
    if (req.params && typeof req.params === 'object') {
      req.params = sanitize(req.params);
    }
    
    next();
  } catch (error) {
    console.error('Sanitization error:', error);
    next();
  }
};

// =============================================
// 📦 IMPORT ROUTES
// =============================================
import testRoute from "./routes/testRoute.js";
import schedularRoutes from './routes/schedularRoutes.js';
import reportRoutes from "./routes/reportRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import dataSyncRoutes from "./routes/dataSyncRoutes.js";
import backupSyncRoutes from "./routes/backupSyncRoute.js";
import patrolSchedulesRoutes from "./routes/managePatrolScheduleRoutes.js";
import eventsRoutes from './routes/eventsRoutes.js';
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import adminRoutes from "./routes/adminRoutes.js";

// Import incident model for API setup
import { createIncidentAPI } from './models/incidentModel.js';

// Import the scheduler
import "./service/scheduler.js";

const app = express();

// =============================================
// 🔒 SECURITY MIDDLEWARE
// =============================================

app.use(helmet({
  contentSecurityPolicy: IS_PRODUCTION ? {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
}));

const FRONTEND_URL = process.env.FRONTEND_URL || "https://reports-97dm.onrender.com";
const allowedOrigins = IS_PRODUCTION 
  ? [FRONTEND_URL]
  : [FRONTEND_URL, "http://localhost:5173", "http://localhost:3000"];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PRODUCTION ? 100 : 1000,
  message: {
    success: false,
    error: "Too many requests from this IP, please try again after 15 minutes"
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    error: "Too many login attempts, please try again after an hour"
  }
});

app.use(compression());

app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

app.use(mongoSanitizeMiddleware);

// =============================================
// 📊 OPTIMIZED REQUEST LOGGING MIDDLEWARE
// =============================================

app.use((req, res, next) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`[${new Date().toISOString()}] [${requestId}] ${req.method} ${req.originalUrl} - IP: ${req.ip}`);
  
  req.requestId = requestId;
  
  // 🚀 USE CACHED NETWORK STATUS - No blocking!
  req.networkAvailable = cachedNetworkStatus;
  req.emailEnabled = EMAIL_ENABLED;
  
  // Response interceptor
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] [${requestId}] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} - Duration: ${duration}ms`);
    
    if (duration > 1000) {
      console.warn(`⚠️ Slow request detected: ${req.method} ${req.originalUrl} took ${duration}ms`);
    }
    
    return originalSend.call(this, data);
  };
  
  next();
});

// =============================================
// 🎯 API ROUTES - CRITICAL: ORDER MATTERS!
// =============================================

app.use('/api', apiLimiter);

// Health check endpoints (no rate limiting)
app.use('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use("/api/test", testRoute);

// Auth routes with stricter rate limiting
app.use("/api/auth", authLimiter, authRoutes);

// Main API routes
app.use("/api/reports", reportRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/sync", dataSyncRoutes);
app.use("/api/backup", backupSyncRoutes);
app.use("/api/patrol-schedules", patrolSchedulesRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/scheduler', schedularRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);

// =============================================
// 🚨 INCIDENT ROUTES - MUST BE BEFORE ROOT ENDPOINTS
// =============================================
console.log('📊 Registering incident API routes...');
createIncidentAPI(app);
console.log('✅ Incident routes registered: /api/incidents/*');

// =============================================
// 🏠 ROOT ENDPOINTS - MUST BE AFTER ALL API ROUTES
// =============================================

app.get("/", (req, res) => {
  res.json({
    message: "📊 Guard Report API is running",
    version: "3.0.0",
    production: IS_PRODUCTION,
    worker: process.pid,
    emailSending: EMAIL_ENABLED ? "enabled" : "DISABLED",
    endpoints: {
      auth: "/api/auth",
      dashboard: "/api/dashboard",
      admin: "/api/admin",
      clients: "/api/clients",
      reports: "/api/reports",
      scheduler: "/api/scheduler",
      incidents: "/api/incidents",
      health: "/api/scheduler/health",
      network: "/api/network/status"
    }
  });
});

app.get('/api/scheduler/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Scheduler API is healthy and running',
    timestamp: new Date().toISOString(),
    version: '3.0.0',
    worker: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    email: {
      sendingEnabled: EMAIL_ENABLED,
      status: EMAIL_ENABLED ? 'Emails will be sent' : '🛑 EMAIL SENDING DISABLED'
    },
    network: {
      status: cachedNetworkStatus ? 'online' : 'offline',
      lastChecked: new Date(lastNetworkCheck).toISOString(),
      cacheAge: Math.floor((Date.now() - lastNetworkCheck) / 1000) + 's',
      circuitBreaker: networkBreaker.state
    },
    server: {
      port: PORT,
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version
    }
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API Server is healthy',
    timestamp: new Date().toISOString(),
    network: cachedNetworkStatus ? 'online' : 'offline',
    networkLastChecked: new Date(lastNetworkCheck).toISOString(),
    emailSending: EMAIL_ENABLED,
    services: {
      scheduler: 'active',
      database: 'connected',
      cron: 'running',
      circuitBreaker: networkBreaker.state,
      emailService: EMAIL_ENABLED ? 'enabled' : 'disabled',
      authentication: 'active',
      autoDiscovery: 'enabled',
      incidentTracking: 'active'
    }
  });
});

app.get('/api/email/status', (req, res) => {
  res.json({
    emailSending: EMAIL_ENABLED,
    status: EMAIL_ENABLED ? 'enabled' : 'disabled',
    message: EMAIL_ENABLED 
      ? '✅ Email sending is ENABLED - Emails will be sent to clients'
      : '🛑 Email sending is DISABLED - No emails will be sent to clients',
    configuration: {
      enableVariable: 'ENABLE_EMAIL_SENDING',
      currentValue: process.env.ENABLE_EMAIL_SENDING || 'not set',
      toEnable: 'Set ENABLE_EMAIL_SENDING=true in .env file',
      toDisable: 'Set ENABLE_EMAIL_SENDING=false in .env file'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/network/status', (req, res) => {
  res.json({
    online: cachedNetworkStatus,
    emailSending: EMAIL_ENABLED,
    timestamp: new Date().toISOString(),
    lastChecked: new Date(lastNetworkCheck).toISOString(),
    cacheAge: Math.floor((Date.now() - lastNetworkCheck) / 1000),
    circuitBreaker: {
      state: networkBreaker.state,
      failures: networkBreaker.failureCount,
      nextAttempt: networkBreaker.state === 'OPEN' ? new Date(networkBreaker.nextAttempt).toISOString() : null
    }
  });
});

app.get('/api', (req, res) => {
  res.json({
    message: "Guard Report API - Available Endpoints",
    version: "3.0.0",
    production: IS_PRODUCTION,
    worker: process.pid,
    emailSending: EMAIL_ENABLED ? "ENABLED" : "DISABLED",
    endpoints: {
      authentication: {
        signup: "POST /api/auth/signup",
        login: "POST /api/auth/login",
        verify: "POST /api/auth/verify",
        me: "GET /api/auth/me",
        changePassword: "POST /api/auth/change-password",
        logout: "POST /api/auth/logout"
      },
      dashboard: {
        status: "GET /api/dashboard/status",
        patrolEvents: "GET /api/dashboard/patrol-events",
        summary: "GET /api/dashboard/summary",
        monthlySummary: "GET /api/dashboard/monthly-summary"
      },
      admin: {
        users: "GET /api/admin/users",
        clients: "GET /api/admin/clients",
        reports: "GET /api/admin/reports",
        system: "GET /api/admin/system"
      },
      incidents: {
        count: "GET /api/incidents/count?clientId=X&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD",
        details: "GET /api/incidents/details?clientId=X&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD",
        period: "GET /api/incidents/:period?clientId=X (periods: daily, weekly, monthly, yesterday, last7days, last30days)"
      },
      scheduler: {
        base: "/api/scheduler",
        health: "/api/scheduler/health"
      },
      clients: "/api/clients",
      reports: "/api/reports",
      sync: "/api/sync",
      backup: "/api/backup",
      patrolSchedules: "/api/patrol-schedules",
      network: "/api/network/status",
      emailStatus: "/api/email/status"
    }
  });
});

// =============================================
// 🚨 ERROR HANDLERS - MUST BE LAST
// =============================================

app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: "Endpoint not found",
    requested: req.originalUrl,
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  });
});

app.use((err, req, res, next) => {
  const requestId = req.requestId || 'unknown';
  
  console.error(`[${new Date().toISOString()}] [${requestId}] ❌ Server Error:`, err);
  
  const isNetworkError = err.code && ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN'].includes(err.code);
  
  if (isNetworkError) {
    console.log(`[${new Date().toISOString()}] [${requestId}] 🛡️ Network error: ${err.code} | Status: ${cachedNetworkStatus ? 'Online' : 'Offline'}`);
  }
  
  const statusCode = err.statusCode || err.status || 500;
  
  res.status(statusCode).json({ 
    success: false,
    error: "Internal server error",
    message: IS_PRODUCTION && statusCode === 500 ? 'Something went wrong' : err.message,
    requestId: requestId,
    timestamp: new Date().toISOString(),
    ...(IS_PRODUCTION ? {} : { stack: err.stack })
  });
});

// =============================================
// 🚀 SERVER STARTUP
// =============================================

if (!IS_PRODUCTION || cluster.isWorker) {
  const server = app.listen(PORT, () => {
    console.log("===============================================");
    console.log(`🚀 Server ${process.pid} running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 Network Status: ${cachedNetworkStatus ? '✅ Online' : '❌ Offline'} (cached, updates every 60s)`);
    console.log(`🛡️ Circuit Breaker: ${networkBreaker.state}`);
    console.log(`📧 Email Sending: ${EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}`);
    if (!EMAIL_ENABLED) {
      console.log(`⚠️  NO EMAILS WILL BE SENT TO CLIENTS`);
    }
    console.log(`🔐 Authentication: ✅ ACTIVE`);
    console.log(`👑 Admin Routes: ✅ ACTIVE (/api/admin)`);
    console.log(`📊 Incident Tracking: ✅ ACTIVE (/api/incidents)`);
    console.log(`🔗 Allowed origins: ${allowedOrigins.join(', ')}`);
    console.log(`📊 API base URL: http://localhost:${PORT}/api`);
    console.log("===============================================");
    console.log("⏰ Scheduler loaded and waiting for cron triggers.");
    console.log("===============================================");
  });
  
  // Graceful shutdown
  const gracefulShutdown = () => {
    console.log(`\n⚠️  Received shutdown signal for worker ${process.pid}`);
    
    server.close(() => {
      console.log(`✅ Worker ${process.pid} shut down gracefully`);
      process.exit(0);
    });
    
    setTimeout(() => {
      console.error(`❌ Could not close connections in time, forcefully shutting down worker ${process.pid}`);
      process.exit(1);
    }, 10000);
  };
  
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

export default app;