// server.js - FIXED VERSION: Reduced scheduler frequency and improved rate limiting
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import NodeCache from "node-cache";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// ES Module dirname workaround
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables FIRST
dotenv.config();

// =============================================
// 🚀 CONFIGURATION & CACHE SETUP
// =============================================
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 5000;

// Initialize global cache (5 minute TTL)
global.apiCache = new NodeCache({ 
  stdTTL: 300, // 5 minutes
  checkperiod: 60, // Check for expired items every minute
  useClones: false // Better performance
});

// 🛑 EMAIL KILL SWITCH - GLOBAL CONTROL
const EMAIL_ENABLED = process.env.ENABLE_EMAIL_SENDING === 'true';
global.EMAIL_SENDING_ENABLED = EMAIL_ENABLED;

// 🛑 SIGNIFICANTLY REDUCE SCHEDULER FREQUENCY TO PREVENT 429 ERRORS
const SCHEDULER_INTERVAL = IS_PRODUCTION ? 600000 : 300000; // 10 min in prod, 5 min in dev
console.log(`⏰ Scheduler interval: ${SCHEDULER_INTERVAL/1000}s (${SCHEDULER_INTERVAL/60000}min)`);

// Track scheduler status
global.schedulerStatus = {
  running: false,
  lastRun: null,
  interval: SCHEDULER_INTERVAL,
  callsInLastMinute: 0
};

// Rate limiting helper
const resetRateCounters = () => {
  setInterval(() => {
    global.schedulerStatus.callsInLastMinute = 0;
  }, 60000); // Reset every minute
};

resetRateCounters();

console.log(`
╔════════════════════════════════════════════╗
║     📧 EMAIL SENDING STATUS                ║
║     ${EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}                         ║
║     🔄 SCHEDULER INTERVAL: ${SCHEDULER_INTERVAL/60000}min                ║
║     🚫 RATE LIMIT PROTECTION: ACTIVE       ║
╚════════════════════════════════════════════╝
`);

// =============================================
// 🔧 CACHE MIDDLEWARE
// =============================================
const createCacheMiddleware = (duration = 300) => {
  return (req, res, next) => {
    // Skip non-GET requests
    if (req.method !== 'GET') {
      return next();
    }
    
    // Skip certain endpoints
    const skipPaths = [
      '/api/health',
      '/api/email/status', 
      '/api/scheduler/health',
      '/api/dashboard/patrol-events',
      '/api/dashboard/summary',
      '/api/scheduler/status'
    ];
    
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }
    
    const cacheKey = `${req.method}:${req.originalUrl}`;
    const cached = global.apiCache.get(cacheKey);
    
    if (cached) {
      console.log(`📦 Cache hit: ${cacheKey}`);
      return res.json(cached);
    }
    
    // Override res.json to cache responses
    const originalJson = res.json;
    res.json = function(data) {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        global.apiCache.set(cacheKey, data, duration);
      }
      return originalJson.call(this, data);
    };
    
    next();
  };
};

// =============================================
// 📊 REQUEST LOGGING MIDDLEWARE
// =============================================
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Skip logging for health checks and scheduler checks
  const skipPaths = ['/api/health', '/api/backup/history', '/api/scheduler'];
  if (skipPaths.some(path => req.path.includes(path))) {
    return next();
  }
  
  // Track scheduler calls
  if (req.path.includes('/scheduler') && req.method === 'GET') {
    global.schedulerStatus.callsInLastMinute++;
    if (global.schedulerStatus.callsInLastMinute > 10) {
      console.warn(`⚠️ High scheduler call rate: ${global.schedulerStatus.callsInLastMinute} calls/min`);
    }
  }
  
  // Log slow requests
  res.on('finish', () => {
    const duration = Date.now() - start;
    const method = req.method;
    const path = req.path;
    const status = res.statusCode;
    
    if (duration > 1000) { // Log requests slower than 1s
      console.log(`🐢 SLOW REQUEST: ${method} ${path} - ${duration}ms - ${status}`);
    } else if (IS_PRODUCTION && path.startsWith('/api')) {
      // Only log API requests in production for debugging
      console.log(`[${new Date().toISOString().substring(11, 19)}] ${method} ${path} - ${duration}ms`);
    }
  });
  
  next();
};

// =============================================
// 🎯 LOAD ROUTES WITH CACHING
// =============================================
const routeCache = new Map();
async function loadRoute(routePath) {
  if (routeCache.has(routePath)) {
    return routeCache.get(routePath);
  }
  
  try {
    const module = await import(routePath);
    routeCache.set(routePath, module.default);
    return module.default;
  } catch (error) {
    console.error(`❌ Failed to load route: ${routePath}`, error.message);
    throw error;
  }
}

// =============================================
// 🔐 INITIALIZE BM SECURITY API
// =============================================
async function initializeBMSecurityAPI() {
  console.log('\n🔐 Initializing BMSecurity API service...');
  
  try {
    const bmSecurityAPI = await import('./service/bmSecurityAPI.js');
    
    console.log('⚡ BMSecurity API Service initialized');
    
    // Test login with timeout
    console.log('🔐 Attempting API login...');
    
    const loginPromise = bmSecurityAPI.default.ensureAuthenticated();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Login timeout after 30s')), 30000)
    );
    
    const token = await Promise.race([loginPromise, timeoutPromise]);
    
    if (token) {
      console.log('✅ BMSecurity API login successful');
      return { 
        success: true, 
        apiInstance: bmSecurityAPI.default,
        status: 'authenticated'
      };
    }
    
    console.warn('⚠️  BMSecurity API login failed');
    return { 
      success: false, 
      apiInstance: bmSecurityAPI.default,
      status: 'login_failed'
    };
    
  } catch (error) {
    console.warn('⚠️  BMSecurity API initialization error:', error.message);
    return { 
      success: false, 
      apiInstance: null, 
      status: 'initialization_error',
      error: error.message 
    };
  }
}

// =============================================
// 🚀 CREATE EXPRESS APP
// =============================================
async function createApp() {
  const app = express();
  const serverStartTime = Date.now();

  // =============================================
  // 🔒 SECURITY & CORS MIDDLEWARE
  // =============================================
  const corsOptions = {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      const allowedOrigins = [
        'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:5000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5000',
        ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])
      ];
      
      if (IS_PRODUCTION) {
        // In production, only allow specific origins
        if (allowedOrigins.includes(origin) || origin === process.env.FRONTEND_URL) {
          return callback(null, true);
        }
        console.log(`❌ CORS blocked in production: ${origin}`);
        return callback(new Error('Not allowed by CORS'), false);
      }
      
      // In development, allow all
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Length', 'X-Request-Id'],
    maxAge: 86400 // 24 hours
  };

  app.use(cors(corsOptions));
  app.options('/', cors(corsOptions));

  app.use(helmet({
    contentSecurityPolicy: IS_PRODUCTION ? {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https:"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https:"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "https:", "data:"],
        connectSrc: ["'self'", "ws:", "http://localhost:*"],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));

  app.use(compression({ level: 6 }));

  // =============================================
  // ⚠️ OPTIMIZED RATE LIMITING - PREVENT 429 ERRORS
  // =============================================
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 250,
    message: {
      success: false,
      error: "Too many requests, please try again later",
      retryAfter: "15 minutes"
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for these paths
      const skipPaths = [
        '/api/health', 
        '/api/email/status', 
        '/api/scheduler/health',
        '/api/scheduler/status',
        '/favicon.ico'
      ];
      return skipPaths.some(path => req.path.startsWith(path));
    }
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
      success: false,
      error: "Too many login attempts, please try again later"
    },
    standardHeaders: true,
    legacyHeaders: false
  });

  const dashboardLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: {
      success: false,
      error: "Too many dashboard requests, please slow down"
    },
    standardHeaders: true,
    legacyHeaders: false
  });

  // Special limiter for scheduler endpoints to prevent self-DDoS
  const schedulerLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: 5, // Only 5 requests per minute to scheduler
    message: {
      success: false,
      error: "Scheduler endpoint rate limited. Please wait before trying again."
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path.includes('/health') || req.path.includes('/status');
    }
  });

  // Apply rate limits
  app.use('/api/auth', authLimiter);
  app.use('/api/dashboard', dashboardLimiter);
  app.use('/api/scheduler', schedulerLimiter); // Add scheduler-specific limiter
  app.use('/api', generalLimiter);

  // =============================================
  // 📝 BODY PARSING
  // =============================================
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // =============================================
  // 📊 REQUEST LOGGING
  // =============================================
  app.use(requestLogger);

  // =============================================
  // 🎯 BASIC API ROUTES WITH CACHE
  // =============================================
  app.get('/api/health', (req, res) => {
    res.json({
      success: true,
      message: 'API Server is healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      port: PORT,
      emailSending: EMAIL_ENABLED,
      server: 'ready',
      status: 'running',
      startupTime: Date.now() - serverStartTime,
      scheduler: global.schedulerStatus,
      cache: {
        enabled: true,
        stats: global.apiCache.getStats()
      }
    });
  });

  app.get('/api/scheduler/status', (req, res) => {
    res.json({
      success: true,
      running: global.schedulerStatus.running,
      lastRun: global.schedulerStatus.lastRun,
      interval: global.schedulerStatus.interval,
      callsInLastMinute: global.schedulerStatus.callsInLastMinute,
      nextRunEstimate: global.schedulerStatus.lastRun 
        ? new Date(new Date(global.schedulerStatus.lastRun).getTime() + global.schedulerStatus.interval).toISOString()
        : null,
      message: `Scheduler running every ${global.schedulerStatus.interval/60000} minutes`
    });
  });

  app.get('/api/backup/history', createCacheMiddleware(30), (req, res) => {
    res.json({
      success: true,
      data: [],
      message: 'Backup history endpoint',
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api", (req, res) => {
    res.json({
      message: "📊 Guard Report API is running",
      version: "3.0.0",
      production: IS_PRODUCTION,
      emailSending: EMAIL_ENABLED ? "enabled" : "DISABLED",
      cache: "enabled (5 min TTL)",
      scheduler: `running every ${SCHEDULER_INTERVAL/60000} minutes`,
      rateLimit: "optimized to prevent 429 errors",
      endpoints: {
        auth: "/api/auth",
        dashboard: "/api/dashboard",
        admin: "/api/admin",
        clients: "/api/clients",
        reports: "/api/reports",
        scheduler: "/api/scheduler",
        schedulerStatus: "/api/scheduler/status",
        incidents: "/api/incidents",
        health: "/api/health",
        emailStatus: "/api/email/status"
      }
    });
  });

  app.get('/api/email/status', createCacheMiddleware(60), (req, res) => {
    res.json({
      emailSending: EMAIL_ENABLED,
      status: EMAIL_ENABLED ? 'enabled' : 'disabled',
      message: EMAIL_ENABLED 
        ? '✅ Email sending is ENABLED'
        : '🛑 Email sending is DISABLED',
      timestamp: new Date().toISOString()
    });
  });

  // =============================================
  // 📦 LOAD ALL ROUTES
  // =============================================
  console.log('\n🔄 Loading API routes...');
  
  try {
    // Load routes in parallel for faster startup
    const routePromises = [
      loadRoute("./routes/testRoute.js"),
      loadRoute('./routes/schedularRoutes.js'),
      loadRoute("./routes/reportRoutes.js"),
      loadRoute("./routes/clientRoutes.js"),
      loadRoute("./routes/dataSyncRoutes.js"),
      loadRoute("./routes/backupSyncRoute.js"),
      loadRoute("./routes/managePatrolScheduleRoutes.js"),
      loadRoute('./routes/eventsRoutes.js'),
      loadRoute("./routes/auth.js"),
      loadRoute("./routes/dashboard.js"),
      loadRoute("./routes/adminRoutes.js")
    ];

    const routes = await Promise.all(routePromises);
    
    // Register routes
    app.use("/api/test", routes[0]);
    app.use("/api/scheduler", routes[1]);
    app.use("/api/reports", routes[2]);
    app.use("/api/clients", routes[3]);
    app.use("/api/sync", routes[4]);
    app.use("/api/backup", routes[5]);
    app.use("/api/patrol-schedules", routes[6]);
    app.use('/api/events', routes[7]);
    app.use("/api/auth", routes[8]);
    app.use("/api/dashboard", routes[9]);
    app.use("/api/admin", routes[10]);
    
    console.log('✅ All API routes registered!');
    
    // Load incident routes
    try {
      const incidentModel = await import('./models/incidentModel.js');
      console.log('📊 Registering incident API routes...');
      incidentModel.default.createIncidentAPI(app);
      console.log('✅ Incident routes registered');
    } catch (error) {
      console.warn('⚠️ Incident routes not available:', error.message);
    }
    
    // Initialize BMSecurity API in background
    console.log('🔄 Starting background services...');
    
    global.bmSecurityAPIStatus = { 
      success: false, 
      status: 'initializing',
      message: 'BMSecurity API is initializing...'
    };
    
    // Start BMSecurity API with timeout
    const apiInitPromise = initializeBMSecurityAPI()
      .then(apiStatus => {
        global.bmSecurityAPIStatus = apiStatus;
        console.log('✅ BMSecurity API initialized:', apiStatus.status);
      })
      .catch(error => {
        console.error('❌ BMSecurity API initialization failed:', error.message);
        global.bmSecurityAPIStatus = { 
          success: false, 
          status: 'error',
          error: error.message 
        };
      });

    // Start scheduler with SIGNIFICANTLY REDUCED frequency
    const schedulerPromise = import("./service/scheduler.js")
      .then(async (schedulerModule) => {
        console.log('✅ Scheduler module loaded');
        
        // Set scheduler to run less frequently - FIX FOR 429 ERRORS
        if (schedulerModule.default && schedulerModule.default.updateSchedulerInterval) {
          schedulerModule.default.updateSchedulerInterval(SCHEDULER_INTERVAL);
          console.log(`⏰ Scheduler interval set to ${SCHEDULER_INTERVAL/60000} minutes`);
          
          // Update global status
          global.schedulerStatus.running = true;
          global.schedulerStatus.interval = SCHEDULER_INTERVAL;
          global.schedulerStatus.lastRun = new Date().toISOString();
        } else {
          console.warn('⚠️ Scheduler module does not have updateSchedulerInterval method');
          console.log('ℹ️ Check ./service/scheduler.js for hardcoded interval');
        }
        return schedulerModule;
      })
      .catch(error => {
        console.error('❌ Scheduler failed to start:', error.message);
        return null;
      });

    // Wait for critical services
    await Promise.allSettled([apiInitPromise, schedulerPromise]);
    
    console.log('✅ Background services started');
    
  } catch (error) {
    console.error('❌ Error loading routes:', error.message);
    throw error;
  }

  // =============================================
  // 🎨 STATIC FILES & FRONTEND SERVING
  // =============================================
  const frontendDistPath = path.join(__dirname, 'client', 'reports', 'dist');
  const frontendExists = fs.existsSync(path.join(frontendDistPath, 'index.html'));

  if (frontendExists) {
    console.log(`📁 Serving frontend from: ${frontendDistPath}`);
    app.use(express.static(frontendDistPath, {
      maxAge: IS_PRODUCTION ? '1d' : '0',
      etag: true,
      lastModified: true,
      index: false,
      setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      }
    }));
    
    // Serve index.html for all non-API routes
    app.get('', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(frontendDistPath, 'index.html'));
    });
  } else {
    console.log(`⚠️  Frontend not found at: ${frontendDistPath}`);
    
    app.get('/', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Guard Report API</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
              h1 { color: #333; }
              .status { color: green; font-weight: bold; }
              code { background: #f5f5f5; padding: 2px 5px; border-radius: 3px; }
              .warning { color: orange; font-weight: bold; }
            </style>
          </head>
          <body>
            <h1>📊 Guard Report API</h1>
            <p class="status">✅ Server is running on port ${PORT}</p>
            <p>API is available at <code>/api</code> endpoints</p>
            <p>📧 Email sending: ${EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}</p>
            <p>⏰ Scheduler: Running every ${SCHEDULER_INTERVAL/60000} minutes</p>
            <p class="warning">⚠️ Frontend not built yet. Build with: <code>cd client/reports && npm run build</code></p>
          </body>
        </html>
      `);
    });
  }

  // =============================================
  // 🚨 404 HANDLER
  // =============================================
  app.use('/api//', (req, res) => {
    res.status(404).json({
      success: false,
      error: "API endpoint not found",
      requested: req.originalUrl,
      availableEndpoints: [
        '/api/auth/login',
        '/api/auth/register',
        '/api/dashboard',
        '/api/admin',
        '/api/clients',
        '/api/reports',
        '/api/events',
        '/api/scheduler',
        '/api/scheduler/status',
        '/api/health',
        '/api/email/status'
      ]
    });
  });

  // =============================================
  // 🚨 ERROR HANDLING
  // =============================================
  app.use((err, req, res, next) => {
    console.error(`❌ Error: ${err.message}`);
    
    // Handle specific error types
    if (err.message.includes('CORS')) {
      return res.status(403).json({
        success: false,
        error: "CORS Error",
        message: "Cross-Origin Request Blocked",
        origin: req.headers.origin,
        timestamp: new Date().toISOString()
      });
    }
    
    if (err.statusCode === 429) {
      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded",
        message: "Too many requests, please try again later",
        retryAfter: "15 minutes",
        timestamp: new Date().toISOString(),
        suggestion: "Scheduler running too frequently. Check scheduler interval settings."
      });
    }
    
    const statusCode = err.statusCode || err.status || 500;
    const errorMessage = IS_PRODUCTION && statusCode === 500 
      ? 'Internal server error' 
      : err.message;
    
    res.status(statusCode).json({ 
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString(),
      ...(IS_PRODUCTION ? {} : { stack: err.stack })
    });
  });

  return app;
}

// =============================================
// 🚀 START SERVER
// =============================================
async function startServer() {
  try {
    console.log('\n🚀 Starting Guard Report API Server...');
    console.log('📊 Environment:', process.env.NODE_ENV || 'development');
    console.log('📧 Email Status:', EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED');
    console.log('⏰ Scheduler Interval:', SCHEDULER_INTERVAL/60000, 'minutes');
    console.log('🚫 Rate Limit Protection: ACTIVE');
    
    const startTime = Date.now();
    
    // Create app
    const app = await createApp();
    
    // Start server
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log("=".repeat(60));
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📧 Email Sending: ${EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}`);
      console.log(`⏰ Scheduler: Every ${SCHEDULER_INTERVAL/60000} minutes`);
      console.log(`🚫 Rate Limit: Optimized to prevent 429 errors`);
      console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
      console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
      console.log(`🔗 Scheduler Status: http://localhost:${PORT}/api/scheduler/status`);
      console.log(`📦 Cache: ENABLED (5 min TTL)`);
      console.log(`⏰ Startup Time: ${Date.now() - startTime}ms`);
      console.log("=".repeat(60));
      console.log('\n✅ Server is ready!');
    });

    // Graceful shutdown
    const gracefulShutdown = async () => {
      console.log(`\n⚠️  Received shutdown signal`);
      
      // Close server
      server.close(() => {
        console.log(`✅ HTTP server closed`);
        
        // Clear cache
        global.apiCache.flushAll();
        console.log(`✅ Cache cleared`);
        
        process.exit(0);
      });
      
      // Force shutdown after 10 seconds
      setTimeout(() => {
        console.error(`❌ Could not close connections in time, forcing shutdown`);
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    });

    return server;
    
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Start the server
startServer();

export default startServer;