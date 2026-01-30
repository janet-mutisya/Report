// server-final.js - PRODUCTION-READY WITH DOTENV SILENCE, ASCII FIX & AUTO-BROWSER
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const NodeCache = require("node-cache");
const path = require("path");
const fs = require("fs");

// =============================================
// 🔇 SILENT DOTENV CONFIGURATION
// =============================================
// Load environment variables COMPLETELY SILENTLY
require('dotenv').config({ 
  silent: true,
  debug: false,
  override: false
});

// Suppress dotenv console pollution globally
if (process.env.DOTENV_CONFIG_DEBUG === undefined) {
  process.env.DOTENV_CONFIG_DEBUG = 'false';
}

// Initialize logger AFTER env is loaded
const logger = require('./logger');

// Clear console for clean production start
if (process.env.NODE_ENV === 'production') {
  logger.clearConsole();
}

// =============================================
// 🎯 CRITICAL FIX: APPLY ASCII ENCODING FIX BEFORE ANY MODULES ARE LOADED
// =============================================
// This MUST happen before ANY other modules (especially routes) are loaded
// because they might import PDFKit which needs these polyfills

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_PKG = typeof process.pkg !== 'undefined' || 
               (process.argv[0] && process.argv[0].includes('guard-report-server.exe')) ||
               (process.execPath && process.execPath.includes('guard-report-server.exe')) ||
               __dirname.includes('snapshot');

// =============================================
// 🔧 ALWAYS APPLY BUFFER-BASED ENCODING FIXES
// =============================================
// We'll apply these fixes even in development to ensure consistency

logger.debug('🔄 Applying Buffer-based encoding fixes...');

const patchesApplied = {
  textDecoder: false,
  textEncoder: false,
  abortSignal: false,
  abortController: false
};

// 🎯 CRITICAL FIX 1: TextDecoder using ONLY Buffer (NO StringDecoder)
if (typeof global.TextDecoder === 'undefined' || IS_PKG) {
  // Remove existing TextDecoder to ensure clean state
  delete global.TextDecoder;
  
  global.TextDecoder = class TextDecoder {
    constructor(encoding = 'utf-8') {
      // Normalize encoding name - remove dashes, underscores, spaces
      const normalized = String(encoding).toLowerCase()
        .replace(/[-_\s]/g, '')
        .replace(/[^a-z0-9]/g, '');
      
      // Map to Node.js Buffer-supported encodings
      // Buffer.toString() supports: 'utf8', 'ascii', 'latin1', 'base64', 'hex', 'utf16le'
      const encodingMap = {
        // UTF variants
        'utf8': 'utf8',
        'utf-8': 'utf8',
        // ASCII variants
        'ascii': 'ascii',
        'usascii': 'ascii',
        'ansi': 'latin1',
        // Latin variants
        'latin1': 'latin1',
        'iso88591': 'latin1',
        'iso-8859-1': 'latin1',
        'binary': 'latin1',
        // Other encodings
        'base64': 'base64',
        'base64url': 'base64',
        'hex': 'hex',
        'ucs2': 'utf16le',
        'ucs-2': 'utf16le',
        'utf16le': 'utf16le',
        'utf-16le': 'utf16le',
        'utf16': 'utf16le',
        // Default
        '': 'utf8'
      };
      
      this._encoding = encoding;
      this._nodeEncoding = encodingMap[normalized] || 'utf8';
      
      logger.debug(`TextDecoder created: ${encoding} -> ${this._nodeEncoding}`);
    }
    
    decode(input, options = {}) {
      if (!input) return '';
      if (typeof input === 'string') return input;
      
      try {
        let buffer;
        
        // Convert input to Buffer
        if (Buffer.isBuffer(input)) {
          buffer = input;
        } else if (input instanceof ArrayBuffer) {
          buffer = Buffer.from(input);
        } else if (ArrayBuffer.isView(input)) {
          buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
        } else if (Array.isArray(input)) {
          buffer = Buffer.from(input);
        } else if (typeof input === 'object' && input.length !== undefined) {
          buffer = Buffer.from(Array.from(input));
        } else {
          buffer = Buffer.from(String(input));
        }
        
        // Use Buffer.toString directly - this always works in Node.js
        // Buffer.toString() natively supports 'ascii' encoding
        try {
          const result = buffer.toString(this._nodeEncoding);
          return result;
        } catch (err) {
          // Fallback to utf8 if the encoding fails
          logger.warn(`TextDecoder: Failed to decode as ${this._nodeEncoding}, using utf8: ${err.message}`);
          return buffer.toString('utf8');
        }
        
      } catch (error) {
        logger.warn(`TextDecoder: Failed to decode input: ${error.message}`);
        return '';
      }
    }
    
    get encoding() {
      return this._encoding || 'utf-8';
    }
    
    set encoding(value) {
      this._encoding = value;
    }
  };
  
  patchesApplied.textDecoder = true;
  logger.debug('✅ TextDecoder polyfill loaded (Pure Buffer-based)');
}

// 🎯 FIX 2: TextEncoder polyfill
if (typeof global.TextEncoder === 'undefined' || IS_PKG) {
  global.TextEncoder = class TextEncoder {
    constructor() {
      this.encoding = 'utf-8';
    }
    
    encode(input = '') {
      try {
        return Buffer.from(String(input), 'utf8');
      } catch (error) {
        logger.warn(`TextEncoder: Failed to encode: ${error.message}`);
        return Buffer.from('');
      }
    }
    
    encodeInto(source, destination) {
      const buffer = this.encode(source);
      const length = Math.min(buffer.length, destination.length);
      for (let i = 0; i < length; i++) {
        destination[i] = buffer[i];
      }
      return { read: source.length, written: length };
    }
  };
  patchesApplied.textEncoder = true;
  logger.debug('✅ TextEncoder polyfill loaded');
}

// 🎯 FIX 3: AbortSignal.any polyfill
if (typeof AbortSignal !== 'undefined' && !AbortSignal.any) {
  AbortSignal.any = function(signals) {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal && signal.aborted) {
        controller.abort(signal.reason);
        break;
      }
      if (signal) {
        signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
      }
    }
    return controller.signal;
  };
  patchesApplied.abortSignal = true;
  logger.debug('✅ AbortSignal.any polyfill loaded');
}

// 🎯 FIX 4: AbortController polyfill
if (typeof global.AbortController === 'undefined') {
  global.AbortController = class AbortController {
    constructor() {
      this.signal = {
        aborted: false,
        reason: undefined,
        onabort: null,
        _listeners: [],
        
        addEventListener(event, handler, options) {
          if (event === 'abort') {
            this._listeners.push({ handler, options });
          }
        },
        
        removeEventListener(event, handler) {
          if (event === 'abort') {
            this._listeners = this._listeners.filter(l => l.handler !== handler);
          }
        }
      };
    }
    
    abort(reason) {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      this.signal.reason = reason;
      
      if (this.signal.onabort) {
        try {
          this.signal.onabort();
        } catch (error) {
          logger.warn('Error in onabort handler');
        }
      }
      
      this.signal._listeners.forEach(({ handler }) => {
        try {
          handler();
        } catch (error) {
          logger.warn('Error in abort event listener');
        }
      });
      
      this.signal._listeners = [];
    }
  };
  patchesApplied.abortController = true;
  logger.debug('✅ AbortController polyfill loaded');
}

// Mark as patched globally
global.__pdfkit_patched__ = true;
global.__ascii_encoding_fixed__ = true;
global.__buffer_based_encoding__ = true;

logger.debug('Encoding patches applied', patchesApplied);

// 🔧 Test the polyfills immediately
try {
  const testDecoder = new TextDecoder('ascii');
  const testEncoder = new TextEncoder();
  const testData = testEncoder.encode('Test123 ASCII: !@#$%^&*()');
  const testResult = testDecoder.decode(testData);
  
  if (testResult === 'Test123 ASCII: !@#$%^&*()') {
    logger.debug(`✅ ASCII encoding test PASSED: "${testResult}"`);
  } else {
    logger.warn(`⚠️ ASCII encoding test mismatch: got "${testResult}"`);
  }
} catch (error) {
  logger.error(`❌ ASCII encoding test FAILED: ${error.message}`);
}

// =============================================
// 🌐 AUTO-OPEN BROWSER FUNCTION (Cross-platform) - FIXED
// =============================================
function openBrowser(url) {
  const { exec } = require('child_process');
  const platform = process.platform;
  
  let command;
  if (platform === 'win32') {
    command = `start "" "${url}"`; // Windows
  } else if (platform === 'darwin') {
    command = `open "${url}"`; // macOS
  } else {
    command = `xdg-open "${url}"`; // Linux
  }
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      logger.debug(`Could not auto-open browser: ${error.message}`);
      // Try alternative methods
      tryAlternativeBrowserOpen(url);
    } else {
      logger.info(`✅ Browser opened: ${url}`);
    }
  });
}

// Alternative method for opening browser
function tryAlternativeBrowserOpen(url) {
  const { exec } = require('child_process');
  const platform = process.platform;
  
  let altCommand;
  if (platform === 'win32') {
    altCommand = `cmd /c start "${url}"`;
  } else if (platform === 'darwin') {
    altCommand = `open -a "Google Chrome" "${url}" || open -a "Safari" "${url}" || open -a "Firefox" "${url}"`;
  } else {
    altCommand = `which google-chrome && google-chrome "${url}" || which firefox && firefox "${url}" || which xdg-open && xdg-open "${url}"`;
  }
  
  exec(altCommand, (error) => {
    if (error) {
      logger.debug(`Alternative browser open also failed: ${error.message}`);
    } else {
      logger.info(`✅ Browser opened via alternative method: ${url}`);
    }
  });
}

// =============================================
// 🚀 CONFIGURATION & CACHE SETUP
// =============================================
const PORT = process.env.PORT || 5000;

// Initialize global cache
global.apiCache = new NodeCache({ 
  stdTTL: 300,
  checkperiod: 60,
  useClones: false
});

// 🛑 EMAIL KILL SWITCH
const EMAIL_ENABLED = process.env.ENABLE_EMAIL_SENDING === 'true';
global.EMAIL_SENDING_ENABLED = EMAIL_ENABLED;

// Convert milliseconds to cron pattern
function msToCronPattern(ms) {
  const minutes = Math.floor(ms / 60000);
  
  if (minutes < 1) {
    return '* * * * *';
  } else if (minutes === 1) {
    return '* * * * *';
  } else if (minutes <= 59) {
    return `*/${minutes} * * * *`;
  } else {
    const hours = Math.floor(minutes / 60);
    if (hours <= 23) {
      return `0 */${hours} * * *`;
    } else {
      return '0 0 * * *';
    }
  }
}

// Scheduler configuration
const SCHEDULER_INTERVAL_MS = process.env.SCHEDULER_INTERVAL 
  ? parseInt(process.env.SCHEDULER_INTERVAL) 
  : (IS_PRODUCTION ? 600000 : 300000);

const SCHEDULER_CRON_PATTERN = process.env.SCHEDULER_CRON_PATTERN || msToCronPattern(SCHEDULER_INTERVAL_MS);

logger.debug(`Scheduler interval: ${SCHEDULER_INTERVAL_MS/1000}s (Cron: "${SCHEDULER_CRON_PATTERN}")`);

// Track scheduler status
global.schedulerStatus = {
  running: false,
  lastRun: null,
  interval: SCHEDULER_INTERVAL_MS,
  cronPattern: SCHEDULER_CRON_PATTERN,
  callsInLastMinute: 0,
  nextRun: null,
  error: null
};

// Rate limiting helper
const resetRateCounters = () => {
  setInterval(() => {
    global.schedulerStatus.callsInLastMinute = 0;
  }, 60000);
};
resetRateCounters();

// =============================================
// 🎯 STARTUP BANNER - CLEAN & PROFESSIONAL
// =============================================
logger.banner([
  '═'.repeat(60),
  '    📊 GUARD REPORT SERVER v3.0.0',
  '═'.repeat(60),
  `    🌐 Port:          ${PORT}`,
  `    📧 Email:         ${EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}`,
  `    ⏰ Scheduler:     ${SCHEDULER_INTERVAL_MS/60000} min interval`,
  `    📦 Mode:          ${IS_PKG ? 'Production (PKG)' : 'Development'}`,
  `    🔧 Environment:   ${process.env.NODE_ENV || 'development'}`,
  `    🌐 Auto-Browser:  ${(IS_PKG || IS_PRODUCTION) ? '✅ ENABLED' : '🛑 DISABLED'}`,
  `    🔤 ASCII Fix:     ${global.__ascii_encoding_fixed__ ? '✅ BUFFER-BASED' : '⚠️ DEFAULT'}`,
  '═'.repeat(60)
]);

// =============================================
// 🔧 CACHE MIDDLEWARE
// =============================================
const createCacheMiddleware = (duration = 300) => {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    
    const skipPaths = [
      '/api/health',
      '/api/email/status', 
      '/api/scheduler/health',
      '/api/dashboard/patrol-events',
      '/api/dashboard/summary',
      '/api/scheduler/status'
    ];
    
    if (skipPaths.some(p => req.path.startsWith(p))) return next();
    
    const cacheKey = `${req.method}:${req.originalUrl}`;
    const cached = global.apiCache.get(cacheKey);
    
    if (cached) {
      logger.debug(`Cache hit: ${cacheKey}`);
      return res.json(cached);
    }
    
    const originalJson = res.json;
    res.json = function(data) {
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
  const skipPaths = ['/api/health', '/favicon.ico'];
  
  if (skipPaths.some(p => req.path.includes(p))) return next();
  
  if (req.path.includes('/scheduler') && req.method === 'GET') {
    global.schedulerStatus.callsInLastMinute++;
    if (global.schedulerStatus.callsInLastMinute > 10) {
      logger.warn(`High scheduler call rate: ${global.schedulerStatus.callsInLastMinute}/min`);
    }
  }
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn(`SLOW REQUEST: ${req.method} ${req.path} - ${duration}ms`);
    }
  });
  
  next();
};

// =============================================
// 🎯 FRONTEND SERVING HELPER
// =============================================
function setupFrontendServing(app) {
  logger.debug('Setting up frontend serving...');
  
  let frontendDistPath;
  
  if (IS_PKG) {
    const possiblePaths = [
      path.join(path.dirname(process.execPath), 'dist'),
      path.join(__dirname, 'dist'),
      path.join(process.cwd(), 'dist'),
      path.join(path.dirname(process.execPath), 'client', 'reports', 'dist'),
      path.join(__dirname, '..', 'client', 'reports', 'dist')
    ];
    
    for (const p of possiblePaths) {
      try {
        const indexPath = path.join(p, 'index.html');
        if (fs.existsSync(indexPath)) {
          frontendDistPath = p;
          logger.debug(`Found frontend at: ${p}`);
          break;
        }
      } catch (error) {
        // Continue searching
      }
    }
  } else {
    frontendDistPath = path.join(__dirname, '..', 'client', 'reports', 'dist');
  }
  
  if (!frontendDistPath || !fs.existsSync(path.join(frontendDistPath, 'index.html'))) {
    logger.warn(`Frontend not found at: ${frontendDistPath || 'unknown location'}`);
    logger.info('Running in API-only mode');
    return false;
  }
  
  logger.info(`Serving React from: ${frontendDistPath}`);
  
  app.use(express.static(frontendDistPath, {
    maxAge: IS_PRODUCTION ? '1d' : '0',
    etag: true,
    lastModified: true
  }));
  
  app.get('/', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (req.path.match(/\.[a-zA-Z0-9]{2,}$/)) {
      const filePath = path.join(frontendDistPath, req.path);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
      return next();
    }
    
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
  
  return true;
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
        if (allowedOrigins.includes(origin) || origin === process.env.FRONTEND_URL) {
          return callback(null, true);
        }
        logger.warn(`CORS blocked: ${origin}`);
        return callback(new Error('Not allowed by CORS'), false);
      }
      
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400
  };

  app.use(cors(corsOptions));
  app.options('/', cors(corsOptions));

  app.use(helmet({
    contentSecurityPolicy: IS_PRODUCTION ? {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));

  app.use(compression({ level: 6 }));

  // =============================================
  // ⚠️ RATE LIMITING
  // =============================================
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 250,
    message: { success: false, error: "Too many requests" },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      const skipPaths = ['/api/health', '/api/email/status', '/favicon.ico'];
      return skipPaths.some(p => req.path.startsWith(p));
    }
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, error: "Too many login attempts" }
  });

  const schedulerLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { success: false, error: "Scheduler rate limited" }
  });

  app.use('/api/auth', authLimiter);
  app.use('/api/scheduler', schedulerLimiter);
  app.use('/api', generalLimiter);

  // =============================================
  // 📝 BODY PARSING & LOGGING
  // =============================================
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(requestLogger);

  // =============================================
  // 🎯 BASIC API ROUTES
  // =============================================
  app.get('/api/health', (req, res) => {
    res.json({
      success: true,
      message: 'API Server is healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      port: PORT,
      emailSending: EMAIL_ENABLED,
      startupTime: Date.now() - serverStartTime,
      scheduler: global.schedulerStatus,
      cache: { stats: global.apiCache.getStats() },
      packaged: IS_PKG,
      platform: process.platform,
      nodeVersion: process.version,
      pdfkitPatched: !!global.__pdfkit_patched__,
      asciiFixed: !!global.__ascii_encoding_fixed__,
      bufferBased: !!global.__buffer_based_encoding__,
      autoBrowser: (IS_PKG || IS_PRODUCTION) ? 'enabled' : 'disabled'
    });
  });

  app.get('/api/scheduler/status', (req, res) => {
    res.json({
      success: true,
      running: global.schedulerStatus.running,
      lastRun: global.schedulerStatus.lastRun,
      interval: global.schedulerStatus.interval,
      cronPattern: global.schedulerStatus.cronPattern,
      callsInLastMinute: global.schedulerStatus.callsInLastMinute,
      nextRunEstimate: global.schedulerStatus.lastRun 
        ? new Date(new Date(global.schedulerStatus.lastRun).getTime() + global.schedulerStatus.interval).toISOString()
        : null,
      error: global.schedulerStatus.error
    });
  });

  app.get('/api/email/status', (req, res) => {
    res.json({
      emailSending: EMAIL_ENABLED,
      status: EMAIL_ENABLED ? 'enabled' : 'disabled',
      message: EMAIL_ENABLED ? '✅ Email sending ENABLED' : '🛑 Email sending DISABLED',
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api", (req, res) => {
    res.json({
      message: "📊 Guard Report API v3.0.0",
      production: IS_PRODUCTION,
      emailSending: EMAIL_ENABLED ? "enabled" : "DISABLED",
      scheduler: `${SCHEDULER_INTERVAL_MS/60000}min interval`,
      schedulerCron: SCHEDULER_CRON_PATTERN,
      packaged: IS_PKG,
      asciiFixed: !!global.__ascii_encoding_fixed__,
      bufferBased: !!global.__buffer_based_encoding__,
      autoBrowser: (IS_PKG || IS_PRODUCTION) ? "enabled" : "disabled",
      endpoints: {
        health: "/api/health",
        auth: "/api/auth",
        dashboard: "/api/dashboard",
        admin: "/api/admin",
        clients: "/api/clients",
        reports: "/api/reports",
        scheduler: "/api/scheduler",
        incidents: "/api/incidents",
        emailStatus: "/api/email/status",
        sync: "/api/sync",
        backup: "/api/backup",
        patrolSchedules: "/api/patrol-schedules",
        events: "/api/events"
      }
    });
  });

  // =============================================
  // 📦 LOAD ALL ROUTES (ASCII FIX IS ALREADY APPLIED)
  // =============================================
  logger.info('Loading API routes...');
  
  const loadRoute = async (config) => {
    try {
      const routePath = path.join(__dirname, 'routes', config.file);
      if (!fs.existsSync(routePath)) {
        logger.debug(`Route file not found: ${config.file}`);
        app.use(config.path, (req, res) => {
          res.status(503).json({
            success: false,
            error: `Route ${config.file} not available`,
            message: "Route file not found"
          });
        });
        return false;
      }

      logger.debug(`Loading: ${config.file}...`);
      
      if (!IS_PRODUCTION && require.cache[routePath]) {
        delete require.cache[routePath];
      }

      // ASCII fix is already applied globally, so routes should load fine
      const route = require(routePath);
      app.use(config.path, route);
      logger.debug(`Loaded: ${config.path} -> ${config.file}`);
      return true;
      
    } catch (error) {
      logger.warn(`Failed to load ${config.file}: ${error.message}`);
      
      // Check if it's an encoding error (shouldn't happen since fix is applied)
      if (error.message.includes('ascii') || error.message.includes('encoding') || 
          error.message.includes('TextDecoder') || error.message.includes('FontKit')) {
        logger.error(`ASCII encoding error in ${config.file} - global fix should have prevented this`);
        logger.error('Check that TextDecoder/TextEncoder polyfills are properly applied');
      }
      
      app.use(config.path, (req, res) => {
        res.status(503).json({
          success: false,
          error: `Route ${config.file} temporarily unavailable`,
          message: error.message,
          timestamp: new Date().toISOString()
        });
      });
      return false;
    }
  };

  const routeConfig = [
    { file: "testRoute.js", path: "/api/test" },
    { file: "schedularRoutes.js", path: "/api/scheduler" },
    { file: "reportRoutes.js", path: "/api/reports" },
    { file: "clientRoutes.js", path: "/api/clients" },
    { file: "dataSyncRoutes.js", path: "/api/sync" },
    { file: "backupSyncRoute.js", path: "/api/backup" },
    { file: "managePatrolScheduleRoutes.js", path: "/api/patrol-schedules" },
    { file: "eventsRoutes.js", path: "/api/events" },
    { file: "auth.js", path: "/api/auth" },
    { file: "dashboard.js", path: "/api/dashboard" },
    { file: "adminRoutes.js", path: "/api/admin" }
  ];

  const loadPromises = routeConfig.map(config => loadRoute(config));
  const results = await Promise.allSettled(loadPromises);
  
  const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
  logger.info(`Routes loaded: ${successCount}/${routeConfig.length} successful`);

  // Load incident routes if available
  try {
    const incidentModelPath = path.join(__dirname, 'models', 'incidentModel.js');
    if (fs.existsSync(incidentModelPath)) {
      logger.debug('Loading incident routes...');
      const incidentModel = require(incidentModelPath);
      if (typeof incidentModel.createIncidentAPI === 'function') {
        incidentModel.createIncidentAPI(app);
        logger.info('Incident routes registered');
      }
    }
  } catch (error) {
    logger.warn('Incident routes not available');
  }

  // Initialize BMSecurity API
  logger.debug('Initializing BMSecurity API...');
  global.bmSecurityAPIStatus = { status: 'initializing' };
  
  try {
    const bmSecurityAPIPath = path.join(__dirname, 'service', 'bmSecurityAPI.js');
    if (fs.existsSync(bmSecurityAPIPath)) {
      const bmSecurityAPI = require(bmSecurityAPIPath);
      const token = await bmSecurityAPI.ensureAuthenticated().catch(() => null);
      global.bmSecurityAPIStatus = token ? 
        { success: true, status: 'authenticated' } : 
        { success: false, status: 'login_failed' };
      logger.info(`BMSecurity API: ${global.bmSecurityAPIStatus.status}`);
    } else {
      logger.debug('BMSecurity API file not found');
      global.bmSecurityAPIStatus = { success: false, status: 'file_not_found' };
    }
  } catch (error) {
    global.bmSecurityAPIStatus = { success: false, status: 'error', error: error.message };
    logger.warn(`BMSecurity API error: ${error.message}`);
  }

  // =============================================
  // 🕒 SCHEDULER LOADING
  // =============================================
  logger.debug('Loading scheduler...');
  
  setTimeout(async () => {
    try {
      const schedulerPath = path.join(__dirname, 'service', 'scheduler.js');
      if (fs.existsSync(schedulerPath)) {
        if (!IS_PRODUCTION) {
          delete require.cache[require.resolve(schedulerPath)];
        }
        
        const schedulerModule = require(schedulerPath);
        logger.debug('Scheduler module loaded');
        
        if (schedulerModule.initializeScheduler) {
          schedulerModule.initializeScheduler(SCHEDULER_CRON_PATTERN);
        } else if (schedulerModule.default?.initializeScheduler) {
          schedulerModule.default.initializeScheduler(SCHEDULER_CRON_PATTERN);
        } else if (schedulerModule.init) {
          schedulerModule.init(SCHEDULER_CRON_PATTERN);
        }
        
        global.schedulerStatus.running = true;
        global.schedulerStatus.lastRun = new Date().toISOString();
        
        logger.info(`Scheduler initialized (${SCHEDULER_INTERVAL_MS/60000} min interval)`);
        
        if (schedulerModule.getSchedulerStatus) {
          const status = schedulerModule.getSchedulerStatus();
          logger.debug(`Scheduler status: ${status.status}`);
        }
        
      } else {
        logger.warn('Scheduler file not found, running without scheduler');
        global.schedulerStatus.running = false;
        global.schedulerStatus.error = 'File not found';
      }
    } catch (error) {
      logger.error(`Scheduler failed to load: ${error.message}`);
      global.schedulerStatus.running = false;
      global.schedulerStatus.error = error.message;
    }
  }, 3000);

  app.use('/api', createCacheMiddleware());

  // =============================================
  // 🌐 SETUP FRONTEND SERVING
  // =============================================
  const frontendReady = setupFrontendServing(app);
  
  if (!frontendReady) {
    app.get('/', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Guard Report API</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                margin: 0;
                padding: 20px;
                display: flex;
                justify-content: center;
                align-items: center;
              }
              .container { 
                background: white; 
                padding: 40px; 
                border-radius: 20px; 
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                max-width: 800px; 
                width: 100%;
                text-align: center;
              }
              h1 { 
                color: #333; 
                margin-bottom: 10px;
                font-size: 2.5em;
              }
              .status { 
                color: #28a745; 
                font-weight: bold; 
                font-size: 1.2em;
                margin: 20px 0;
                padding: 10px;
                background: #d4edda;
                border-radius: 10px;
              }
              .error { 
                color: #721c24; 
                background: #f8d7da; 
                padding: 20px; 
                border-radius: 10px; 
                margin: 20px 0; 
                border-left: 5px solid #f5c6cb;
              }
              .api-link { 
                display: inline-block; 
                margin: 10px; 
                padding: 15px 30px; 
                background: #007bff; 
                color: white; 
                text-decoration: none; 
                border-radius: 50px;
                font-weight: bold;
                transition: all 0.3s;
                box-shadow: 0 4px 6px rgba(0,123,255,0.3);
              }
              .api-link:hover { 
                background: #0056b3; 
                transform: translateY(-2px);
                box-shadow: 0 6px 12px rgba(0,123,255,0.4);
              }
              .info-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin: 25px 0;
                text-align: left;
              }
              .info-item {
                background: #f8f9fa;
                padding: 15px;
                border-radius: 10px;
                border-left: 4px solid #007bff;
              }
              .info-label {
                font-weight: bold;
                color: #666;
                font-size: 0.9em;
              }
              .info-value {
                font-size: 1.1em;
                margin-top: 5px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>📊 Guard Report API</h1>
              <p class="status">✅ Server running on port ${PORT}</p>
              <div class="error">
                <strong>⚠️ Frontend not found!</strong><br>
                <p>The React frontend files were not found in the expected location.</p>
                <p>Running in API-only mode.</p>
              </div>
              
              <div class="info-grid">
                <div class="info-item">
                  <div class="info-label">Mode</div>
                  <div class="info-value">${IS_PKG ? '📦 PKG' : '🔧 Development'}</div>
                </div>
                <div class="info-item">
                  <div class="info-label">Email Sending</div>
                  <div class="info-value">${EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}</div>
                </div>
                <div class="info-item">
                  <div class="info-label">Scheduler Interval</div>
                  <div class="info-value">${SCHEDULER_INTERVAL_MS/60000} minutes</div>
                </div>
                <div class="info-item">
                  <div class="info-label">ASCII Support</div>
                  <div class="info-value">${global.__ascii_encoding_fixed__ ? '✅ BUFFER-BASED' : '⚠️ DEFAULT'}</div>
                </div>
                <div class="info-item">
                  <div class="info-label">Auto-Browser</div>
                  <div class="info-value">${(IS_PKG || IS_PRODUCTION) ? '✅ ENABLED' : '🛑 DISABLED'}</div>
                </div>
              </div>
              
              <div style="margin-top: 30px;">
                <p>Useful API endpoints:</p>
                <a class="api-link" href="/api/health">API Health</a>
                <a class="api-link" href="/api">API Endpoints</a>
                <a class="api-link" href="/api/scheduler/status">Scheduler Status</a>
                <a class="api-link" href="/api/email/status">Email Status</a>
              </div>
            </div>
          </body>
        </html>
      `);
    });
  }

  // =============================================
  // 🚨 404 & ERROR HANDLERS
  // =============================================
  app.use('/api/', (req, res) => {
    res.status(404).json({
      success: false,
      error: "API endpoint not found",
      requested: req.originalUrl,
      timestamp: new Date().toISOString()
    });
  });

  app.use((err, req, res, next) => {
    logger.error(`Error: ${err.message}`);
    
    if (err.statusCode === 429) {
      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded",
        message: "Too many requests, please try again later",
        retryAfter: "15 minutes"
      });
    }
    
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ 
      success: false,
      error: IS_PRODUCTION && statusCode === 500 ? 'Internal server error' : err.message,
      timestamp: new Date().toISOString(),
      path: req.path,
      ...(!IS_PRODUCTION && { stack: err.stack })
    });
  });

  return app;
}

// =============================================
// 🚀 START SERVER
// =============================================
async function startServer() {
  try {
    logger.info('Starting Guard Report API Server...');
    
    const app = await createApp();
    
    const server = app.listen(PORT, "0.0.0.0", () => {
      logger.banner([
        '',
        '═'.repeat(60),
        '    ✅ SERVER READY',
        '═'.repeat(60),
        `    🌐 Web UI:        http://localhost:${PORT}/`,
        `    📡 API:           http://localhost:${PORT}/api`,
        `    📧 Email:         ${EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}`,
        `    ⏰ Scheduler:     ${SCHEDULER_INTERVAL_MS/60000} min interval`,
        `    📦 Packaged:      ${IS_PKG ? 'Yes' : 'No'}`,
        `    🔧 Environment:   ${process.env.NODE_ENV || 'development'}`,
        `    🔤 ASCII Fix:     ${global.__ascii_encoding_fixed__ ? 'BUFFER-BASED ✅' : 'NOT NEEDED ✅'}`,
        `    🌐 Auto-Browser:  ${(IS_PKG || IS_PRODUCTION) ? '✅ ENABLED' : '🛑 DISABLED'}`,
        '═'.repeat(60),
        '',
        '    Press Ctrl+C to stop the server',
        ''
      ]);
      
      // 🌐 AUTO-OPEN BROWSER (Only in Production/PKG mode)
      if (IS_PKG || IS_PRODUCTION) {
        setTimeout(() => {
          const url = `http://localhost:${PORT}`;
          logger.info(`🌐 Opening browser in 1.5 seconds: ${url}`);
          
          // Give server a moment to fully initialize
          setTimeout(() => {
            try {
              openBrowser(url);
            } catch (browserError) {
              logger.warn(`Failed to open browser: ${browserError.message}`);
              logger.info(`Please manually open: ${url}`);
            }
          }, 1500);
        }, 500); // Initial delay
      } else {
        logger.info(`🌐 Server ready at: http://localhost:${PORT}`);
        logger.info('   (Auto-browser disabled in development mode)');
      }
    });

    // Graceful shutdown
    const gracefulShutdown = async () => {
      logger.info('Shutting down gracefully...');
      global.schedulerStatus.running = false;
      
      server.close(() => {
        global.apiCache.flushAll();
        logger.info('Server stopped');
        process.exit(0);
      });
      
      setTimeout(() => {
        logger.error('Forcing shutdown');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
        logger.info(`Try: kill $(lsof -t -i:${PORT}) or use a different port`);
        process.exit(1);
      } else {
        logger.error('Server error:', error);
      }
    });
    
    return server;
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, createApp };