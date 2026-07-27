// ============================================================
// 📊 GUARD REPORT SERVER v3.0.0
// API + Frontend serving
// ============================================================

const path = require('path');
const fs   = require('fs');

// ─── PKG DETECTION (must be before dotenv) ──────────────────
const IS_PKG =
  typeof process.pkg !== 'undefined' ||
  (process.argv[0]  && process.argv[0].includes('guard-report-server.exe')) ||
  (process.execPath && process.execPath.includes('guard-report-server.exe')) ||
  __dirname.includes('snapshot');

// ─── DIST PATH RESOLUTION ────────────────────────────────────
// PKG binary  → dist/ folder sitting beside the .exe file
// Development → dist/ folder sitting beside server.js  (i.e. server/dist/)
const distPath = IS_PKG
  ? path.join(path.dirname(process.execPath), 'dist')
  : path.join(__dirname, 'dist');

// ─── DOTENV — EXPLICIT PATH ──────────────────────────────────
const envPath = IS_PKG
  ? path.join(path.dirname(process.execPath), '.env')
  : path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath, override: false });
  console.log(`🔧 Loading .env from: ${envPath}`);
} else {
  console.warn(`⚠️  .env not found at: ${envPath}`);
}

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const NodeCache   = require('node-cache');

const logger = require('./logger');

if (process.env.NODE_ENV === 'production') {
  logger.clearConsole();
}

// ─── ENVIRONMENT DETECTION ──────────────────────────────────
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ─── ENV DEBUG ──────────────────────────────────────────────
logger.debug('🔍 ENV CHECK:');
logger.debug(`   GOOGLE_SERVICE_ACCOUNT_KEY: ${process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? '✅ SET' : '❌ MISSING'}`);
logger.debug(`   ARCHIVE_ROOT_FOLDER_ID:     ${process.env.ARCHIVE_ROOT_FOLDER_ID     ? '✅ SET' : '❌ MISSING'}`);
logger.debug(`   DB_PASSWORD:                ${process.env.DB_PASSWORD                ? '✅ SET' : '❌ MISSING'}`);
logger.debug(`   JWT_SECRET:                 ${process.env.JWT_SECRET                 ? '✅ SET' : '❌ MISSING'}`);
logger.debug(`   JWT_SECRET length:          ${process.env.JWT_SECRET?.length || 0}`);

// ─── DIST PATH DEBUG ─────────────────────────────────────────
const distIndexExists = fs.existsSync(path.join(distPath, 'index.html'));
console.log(`📂 Dist path:     ${distPath}`);
console.log(`📂 index.html:    ${distIndexExists ? '✅ FOUND' : '❌ NOT FOUND'}`);
console.log(`📦 PKG mode:      ${IS_PKG ? 'Yes (binary)' : 'No (dev/node)'}`);

// ─── ASCII / ENCODING POLYFILLS ─────────────────────────────
logger.debug('🔄 Applying Buffer-based encoding fixes...');

const patchesApplied = {
  textDecoder: false, textEncoder: false,
  abortSignal: false, abortController: false,
};

if (typeof global.TextDecoder === 'undefined' || IS_PKG) {
  delete global.TextDecoder;
  global.TextDecoder = class TextDecoder {
    constructor(encoding = 'utf-8') {
      const normalized = String(encoding).toLowerCase()
        .replace(/[-_\s]/g, '').replace(/[^a-z0-9]/g, '');
      const encodingMap = {
        utf8: 'utf8', 'utf-8': 'utf8',
        ascii: 'ascii', usascii: 'ascii',
        ansi: 'latin1', latin1: 'latin1',
        iso88591: 'latin1', 'iso-8859-1': 'latin1', binary: 'latin1',
        base64: 'base64', base64url: 'base64', hex: 'hex',
        ucs2: 'utf16le', 'ucs-2': 'utf16le',
        utf16le: 'utf16le', 'utf-16le': 'utf16le', utf16: 'utf16le', '': 'utf8',
      };
      this._encoding     = encoding;
      this._nodeEncoding = encodingMap[normalized] || 'utf8';
      logger.debug(`TextDecoder: ${encoding} -> ${this._nodeEncoding}`);
    }
    decode(input, _options = {}) {
      if (!input) return '';
      if (typeof input === 'string') return input;
      try {
        let buffer;
        if (Buffer.isBuffer(input))            buffer = input;
        else if (input instanceof ArrayBuffer) buffer = Buffer.from(input);
        else if (ArrayBuffer.isView(input))    buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
        else if (Array.isArray(input))         buffer = Buffer.from(input);
        else if (typeof input === 'object' && input.length !== undefined)
          buffer = Buffer.from(Array.from(input));
        else buffer = Buffer.from(String(input));
        try   { return buffer.toString(this._nodeEncoding); }
        catch { return buffer.toString('utf8'); }
      } catch (err) {
        logger.warn(`TextDecoder.decode failed: ${err.message}`);
        return '';
      }
    }
    get encoding()      { return this._encoding || 'utf-8'; }
    set encoding(value) { this._encoding = value; }
  };
  patchesApplied.textDecoder = true;
  logger.debug('✅ TextDecoder polyfill loaded (Pure Buffer-based)');
}

if (typeof global.TextEncoder === 'undefined' || IS_PKG) {
  global.TextEncoder = class TextEncoder {
    constructor() { this.encoding = 'utf-8'; }
    encode(input = '') {
      try   { return Buffer.from(String(input), 'utf8'); }
      catch { return Buffer.from(''); }
    }
    encodeInto(source, destination) {
      const buf = this.encode(source);
      const len = Math.min(buf.length, destination.length);
      for (let i = 0; i < len; i++) destination[i] = buf[i];
      return { read: source.length, written: len };
    }
  };
  patchesApplied.textEncoder = true;
  logger.debug('✅ TextEncoder polyfill loaded');
}

if (typeof AbortSignal !== 'undefined' && !AbortSignal.any) {
  AbortSignal.any = function (signals) {
    const ctrl = new AbortController();
    for (const sig of signals) {
      if (sig?.aborted) { ctrl.abort(sig.reason); break; }
      sig?.addEventListener('abort', () => ctrl.abort(sig.reason), { once: true });
    }
    return ctrl.signal;
  };
  patchesApplied.abortSignal = true;
  logger.debug('✅ AbortSignal.any polyfill loaded');
}

if (typeof global.AbortController === 'undefined') {
  global.AbortController = class AbortController {
    constructor() {
      this.signal = {
        aborted: false, reason: undefined, onabort: null, _listeners: [],
        addEventListener(event, handler, options) {
          if (event === 'abort') this._listeners.push({ handler, options });
        },
        removeEventListener(event, handler) {
          if (event === 'abort')
            this._listeners = this._listeners.filter(l => l.handler !== handler);
        },
      };
    }
    abort(reason) {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      this.signal.reason  = reason;
      try { this.signal.onabort?.(); } catch {}
      this.signal._listeners.forEach(({ handler }) => { try { handler(); } catch {} });
      this.signal._listeners = [];
    }
  };
  patchesApplied.abortController = true;
  logger.debug('✅ AbortController polyfill loaded');
}

global.__pdfkit_patched__        = true;
global.__ascii_encoding_fixed__  = true;
global.__buffer_based_encoding__ = true;
logger.debug('Encoding patches applied', patchesApplied);

try {
  const dec = new TextDecoder('ascii');
  const enc = new TextEncoder();
  const raw = enc.encode('Test123 ASCII: !@#$%^&*()');
  const out = dec.decode(raw);
  if (out === 'Test123 ASCII: !@#$%^&*()') logger.debug('✅ ASCII encoding test PASSED');
  else logger.warn(`⚠️ ASCII encoding test mismatch: got "${out}"`);
} catch (err) {
  logger.error(`❌ ASCII encoding test FAILED: ${err.message}`);
}

// ─── CONFIGURATION ──────────────────────────────────────────
const PORT = process.env.PORT || 5000;

global.apiCache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

const EMAIL_ENABLED = process.env.ENABLE_EMAIL_SENDING === 'true';
global.EMAIL_SENDING_ENABLED = EMAIL_ENABLED;

function msToCronPattern(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 2)   return '* * * * *';
  if (minutes <= 59) return `*/${minutes} * * * *`;
  const hours = Math.floor(minutes / 60);
  return hours <= 23 ? `0 */${hours} * * *` : '0 0 * * *';
}

const SCHEDULER_INTERVAL_MS =
  process.env.SCHEDULER_INTERVAL
    ? parseInt(process.env.SCHEDULER_INTERVAL, 10)
    : IS_PRODUCTION ? 600_000 : 300_000;

const SCHEDULER_CRON_PATTERN =
  process.env.SCHEDULER_CRON_PATTERN || msToCronPattern(SCHEDULER_INTERVAL_MS);

logger.debug(`Scheduler: ${SCHEDULER_INTERVAL_MS / 1000}s (cron: "${SCHEDULER_CRON_PATTERN}")`);

global.schedulerStatus = {
  running: false, lastRun: null,
  interval: SCHEDULER_INTERVAL_MS,
  cronPattern: SCHEDULER_CRON_PATTERN,
  callsInLastMinute: 0, nextRun: null, error: null,
};
setInterval(() => { global.schedulerStatus.callsInLastMinute = 0; }, 60_000);

// ─── STARTUP BANNER ─────────────────────────────────────────
logger.banner([
  '═'.repeat(60),
  '    📊 GUARD REPORT SERVER v3.0.0',
  '═'.repeat(60),
  `    🌐 Port:          ${PORT}`,
  `    📧 Email:         ${EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}`,
  `    ⏰ Scheduler:     ${SCHEDULER_INTERVAL_MS / 60_000} min interval`,
  `    📦 Mode:          ${IS_PKG ? 'Production (PKG)' : 'Development'}`,
  `    🔧 Environment:   ${process.env.NODE_ENV || 'development'}`,
  `    🔤 ASCII Fix:     ✅ BUFFER-BASED`,
  `    🔑 JWT Secret:    ${process.env.JWT_SECRET ? `✅ SET (${process.env.JWT_SECRET.length} chars)` : '❌ MISSING — login will fail!'}`,
  `    📂 Dist path:     ${distPath}`,
  `    📂 index.html:    ${distIndexExists ? '✅ FOUND' : '❌ NOT FOUND — frontend will not load'}`,
  '═'.repeat(60),
]);

// ─── CACHE MIDDLEWARE ────────────────────────────────────────
const CACHEABLE_PATHS = [
  '/api/public',
  '/api/reports/summary',
  '/api/dashboard/patrol-events',
  '/api/dashboard/summary',
  '/api/clients/list',
  '/api/users/list',
];

function createCacheMiddleware(duration = 300) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    const shouldCache = CACHEABLE_PATHS.some(p => req.path.startsWith(p));
    if (!shouldCache) return next();
    const key    = `${req.method}:${req.originalUrl}`;
    const cached = global.apiCache.get(key);
    if (cached) {
      logger.debug(`Cache hit: ${key}`);
      return res.json(cached);
    }
    const originalJson = res.json.bind(res);
    res.json = function (data) {
      if (res.statusCode >= 200 && res.statusCode < 300)
        global.apiCache.set(key, data, duration);
      return originalJson(data);
    };
    next();
  };
}

// ─── REQUEST LOGGER ─────────────────────────────────────────
function requestLogger(req, res, next) {
  const SKIP_LOG = ['/api/health', '/favicon.ico'];
  if (SKIP_LOG.some(p => req.path.includes(p))) return next();

  if (req.path.includes('/scheduler') && req.method === 'GET') {
    global.schedulerStatus.callsInLastMinute++;
    if (global.schedulerStatus.callsInLastMinute > 10)
      logger.warn(`High scheduler call rate: ${global.schedulerStatus.callsInLastMinute}/min`);
  }

  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms > 1000) logger.warn(`SLOW: ${req.method} ${req.path} — ${ms}ms`);
  });
  next();
}

// ─── PROCESS CRASH HANDLERS ─────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error(`💥 UNCAUGHT EXCEPTION: ${err.stack || err.message}`);
  setTimeout(() => { logger.error('Forcing exit due to uncaught exception'); process.exit(1); }, 5000);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`💥 UNHANDLED REJECTION: ${reason instanceof Error ? reason.stack : reason}`);
  logger.error(`   Promise: ${promise}`);
});

// ─── AUTO-OPEN BROWSER ──────────────────────────────────────
function openBrowser(url) {
  if (process.env.DISABLE_AUTO_OPEN === 'true') return;
  try {
    const { exec } = require('child_process');
    const cmd =
      process.platform === 'win32'  ? `start "" "${url}"` :
      process.platform === 'darwin' ? `open "${url}"`     :
                                      `xdg-open "${url}"`;
    exec(cmd, (err) => {
      if (err) logger.warn(`⚠️  Could not open browser automatically: ${err.message}`);
      else     logger.info(`🌐 Browser opened at ${url}`);
    });
  } catch (err) {
    logger.warn(`⚠️  openBrowser failed: ${err.message}`);
  }
}

// ═════════════════════════════════════════════════════════════
// 🚀  CREATE EXPRESS APP
// ═════════════════════════════════════════════════════════════
async function createApp() {
  const app             = express();
  const serverStartTime = Date.now();

  if (IS_PRODUCTION) {
    app.set('trust proxy', 1);
    logger.info('✅ Trust proxy enabled (production mode)');
  }

  // ── CORS ────────────────────────────────────────────────────
  const allowedOrigins = [
    'http://localhost:5175', 'http://localhost:5173',
    'http://localhost:3000', 'http://localhost:5000',
    'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
    'http://127.0.0.1:3000', 'http://127.0.0.1:5000',
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ];

  const allowedPatterns = process.env.CORS_ORIGIN_PATTERNS
    ? process.env.CORS_ORIGIN_PATTERNS.split(',').map(p => new RegExp(p.trim()))
    : [/^https:\/\/.*\.example\.com$/, /^https:\/\/[^.]+\.example\.com$/];

  const corsOptions = {
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (!IS_PRODUCTION || allowedOrigins.includes(origin)) return cb(null, true);
      if (allowedPatterns.some(pattern => pattern.test(origin))) return cb(null, true);
      logger.warn(`CORS blocked: ${origin}`);
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400,
  };

  app.use(cors(corsOptions));
  app.options('/', cors(corsOptions));

  // ── HELMET ──────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        imgSrc:     ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc:    ["'self'", 'data:'],
        objectSrc:  ["'none'"],
        frameSrc:   ["'none'"],
      },
    },
  }));

  app.use(compression({ level: 6, threshold: 1024 }));
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(requestLogger);

  // ── RATE LIMITING ────────────────────────────────────────────
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 250,
    message: { success: false, error: 'Too many requests' },
    standardHeaders: true, legacyHeaders: false,
    skip: req =>
      ['/api/health', '/api/email/status', '/favicon.ico'].some(p => req.path.startsWith(p)),
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 20,
    message: { success: false, error: 'Too many login attempts. Please try again later.' },
    standardHeaders: true, legacyHeaders: false,
    skip: (req) =>
      req.path.startsWith('/admin/') ||
      req.path === '/search'         ||
      req.path === '/verify'         ||
      req.path === '/change-password',
  });

  const schedulerLimiter = rateLimit({
    windowMs: 60 * 1000, max: 30,
    message: { success: false, error: 'Scheduler rate limited' },
  });

  app.use('/api/auth',      authLimiter);
  app.use('/api/scheduler', schedulerLimiter);
  app.use('/api',           generalLimiter);

  // ── CACHE (before route handlers) ───────────────────────────
  app.use('/api', createCacheMiddleware());

  // ════════════════════════════════════════════════════════════
  // 📡 CORE / META ROUTES
  // ════════════════════════════════════════════════════════════
  app.get('/api/health', (req, res) => res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
  }));

  app.get('/api/health/internal', (req, res) => {
    if (IS_PRODUCTION && req.ip !== '127.0.0.1' && !req.ip.startsWith('::ffff:127.0.0.1'))
      return res.status(403).json({ success: false, error: 'Internal endpoint' });
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
      pdfkitPatched: true,
      asciiFixed: true,
      bufferBased: true,
      jwtSecretSet: !!process.env.JWT_SECRET,
      jwtSecretLen: process.env.JWT_SECRET?.length || 0,
      envLoadedFrom: envPath,
      distPath,
      distIndexFound: distIndexExists,
      googleDrive: {
        serviceAccount:  process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? '✅ SET' : '❌ MISSING',
        archiveFolderId: process.env.ARCHIVE_ROOT_FOLDER_ID     ? '✅ SET' : '❌ MISSING',
      },
    });
  });

  app.get('/api/scheduler/status', (req, res) => res.json({
    success: true,
    running:     global.schedulerStatus.running,
    lastRun:     global.schedulerStatus.lastRun,
    interval:    global.schedulerStatus.interval,
    cronPattern: global.schedulerStatus.cronPattern,
    callsInLastMinute: global.schedulerStatus.callsInLastMinute,
    nextRunEstimate: global.schedulerStatus.lastRun
      ? new Date(
          new Date(global.schedulerStatus.lastRun).getTime() + global.schedulerStatus.interval
        ).toISOString()
      : null,
    error: global.schedulerStatus.error,
  }));

  app.get('/api/email/status', (req, res) => res.json({
    emailSending: EMAIL_ENABLED,
    status:  EMAIL_ENABLED ? 'enabled' : 'disabled',
    message: EMAIL_ENABLED ? '✅ Email sending ENABLED' : '🛑 Email sending DISABLED',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api', (req, res) => res.json({
    message: '📊 Guard Report API v3.0.0',
    production: IS_PRODUCTION,
    emailSending: EMAIL_ENABLED ? 'enabled' : 'DISABLED',
    scheduler: `${SCHEDULER_INTERVAL_MS / 60_000}min interval`,
    schedulerCron: SCHEDULER_CRON_PATTERN,
    packaged: IS_PKG, asciiFixed: true, bufferBased: true,
    endpoints: {
      health:          '/api/health',
      healthInternal:  '/api/health/internal',
      auth:            '/api/auth',
      dashboard:       '/api/dashboard',
      admin:           '/api/admin',
      clients:         '/api/clients',
      users:           '/api/users',
      reports:         '/api/reports',
      scheduler:       '/api/scheduler',
      incidents:       '/api/incidents',
      emailStatus:     '/api/email/status',
      sync:            '/api/sync',
      backup:          '/api/backup',
      patrolSchedules: '/api/patrol-schedules',
      events:          '/api/events',
      archive:         '/api/archive',
    },
  }));

  // ════════════════════════════════════════════════════════════
  // 📦 ROUTE LOADER
  // ════════════════════════════════════════════════════════════
  const loadRoute = async ({ file, path: mountPath }) => {
    const fullPath = path.join(__dirname, 'routes', file);
    if (!fs.existsSync(fullPath)) {
      logger.debug(`Route file not found: ${file}`);
      app.use(mountPath, (req, res) =>
        res.status(503).json({ success: false, error: `${file} not available` })
      );
      return false;
    }
    try {
      logger.debug(`Loading ${file}...`);
      if (!IS_PRODUCTION && require.cache[fullPath]) delete require.cache[fullPath];
      const routeModule = require(fullPath);
      app.use(mountPath, routeModule);
      logger.debug(`Mounted ${mountPath} <- ${file}`);
      return true;
    } catch (err) {
      logger.warn(`Failed to load ${file}: ${err.message}`);
      if (/ascii|encoding|TextDecoder|FontKit/i.test(err.message))
        logger.error(`ASCII encoding error in ${file} — polyfills should have prevented this`);
      app.use(mountPath, (req, res) =>
        res.status(503).json({
          success: false,
          error: `${file} temporarily unavailable`,
          message: err.message,
          timestamp: new Date().toISOString(),
        })
      );
      return false;
    }
  };

  const routeConfig = [
    { file: 'auth.js',                       path: '/api/auth'             },
    { file: 'userRoutes.js',                 path: '/api/users'            },
    { file: 'clientRoutes.js',               path: '/api/clients'          },
    { file: 'adminRoutes.js',                path: '/api/admin'            },
    { file: 'dashboardRoutes.js',            path: '/api/dashboard'        },
    { file: 'reportRoutes.js',               path: '/api/reports'          },
    { file: 'schedulerRoutes.js',            path: '/api/scheduler'        },
    { file: 'dataSyncRoutes.js',             path: '/api/sync'             },
    { file: 'backupSyncRoute.js',            path: '/api/backup'           },
    { file: 'managePatrolScheduleRoutes.js', path: '/api/patrol-schedules' },
    { file: 'eventsRoutes.js',               path: '/api/events'           },
    { file: 'archiveRoutes.js',              path: '/api/archive'          },
    { file: 'testRoute.js',                  path: '/api/test'             },
  ];

  logger.info('Loading API routes...');
  const results      = await Promise.allSettled(routeConfig.map(loadRoute));
  const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
  logger.info(`Routes loaded: ${successCount}/${routeConfig.length} successful`);

  // ── Incident routes ──────────────────────────────────────────
  try {
    const incidentModelPath = path.join(__dirname, 'models', 'incidentModel.js');
    if (fs.existsSync(incidentModelPath)) {
      const incidentModel = require(incidentModelPath);
      if (typeof incidentModel.createIncidentAPI === 'function') {
        incidentModel.createIncidentAPI(app);
        logger.info('Incident routes registered');
      }
    }
  } catch (err) {
    logger.warn(`Incident routes not available: ${err.message}`);
  }

  // ── BM Security API init ─────────────────────────────────────
  global.bmSecurityAPIStatus = { status: 'initializing' };
  try {
    const bmPath = path.join(__dirname, 'service', 'bmSecurityAPI.js');
    if (fs.existsSync(bmPath)) {
      const bmAPI  = require(bmPath);
      const token  = await bmAPI.ensureAuthenticated().catch(() => null);
      global.bmSecurityAPIStatus = token
        ? { success: true,  status: 'authenticated' }
        : { success: false, status: 'login_failed'  };
      logger.info(`BMSecurity API: ${global.bmSecurityAPIStatus.status}`);
    } else {
      global.bmSecurityAPIStatus = { success: false, status: 'file_not_found' };
    }
  } catch (err) {
    global.bmSecurityAPIStatus = { success: false, status: 'error', error: err.message };
    logger.warn(`BMSecurity API error: ${err.message}`);
  }

  // ── Background jobs (deferred 3 s to let DB/API init settle) ─
  setTimeout(async () => {

    // ── 1. Report Scheduler ──────────────────────────────────
    try {
      const schedulerPath = path.join(__dirname, 'service', 'scheduler.js');
      if (!fs.existsSync(schedulerPath)) {
        logger.warn('Scheduler file not found — running without scheduler');
        global.schedulerStatus.running = false;
        global.schedulerStatus.error   = 'File not found';
      } else {
        if (!IS_PRODUCTION && require.cache[require.resolve(schedulerPath)])
          delete require.cache[require.resolve(schedulerPath)];

        const schedulerModule = require(schedulerPath);
        if      (schedulerModule.initializeScheduler)          schedulerModule.initializeScheduler(SCHEDULER_CRON_PATTERN);
        else if (schedulerModule.default?.initializeScheduler) schedulerModule.default.initializeScheduler(SCHEDULER_CRON_PATTERN);
        else if (schedulerModule.init)                         schedulerModule.init(SCHEDULER_CRON_PATTERN);

        global.schedulerStatus.running = true;
        global.schedulerStatus.lastRun = new Date().toISOString();
        logger.info(`✅ Scheduler initialized (${SCHEDULER_INTERVAL_MS / 60_000} min interval)`);
      }
    } catch (err) {
      logger.error(`Scheduler failed: ${err.message}`);
      global.schedulerStatus.running = false;
      global.schedulerStatus.error   = err.message;
    }

    // ── 2. Event Archive Job ─────────────────────────────────
    try {
      const eventArchivePath = path.join(__dirname, 'service', 'eventArchiveJob.js');
      if (!fs.existsSync(eventArchivePath)) {
        logger.warn('eventArchiveJob.js not found — event archiving disabled');
      } else {
        if (!IS_PRODUCTION && require.cache[require.resolve(eventArchivePath)])
          delete require.cache[require.resolve(eventArchivePath)];

        const { startEventArchiveJob } = require(eventArchivePath);

        if (typeof startEventArchiveJob !== 'function') {
          logger.warn('eventArchiveJob.js does not export startEventArchiveJob — skipping');
        } else {
          startEventArchiveJob();
          logger.info('✅ Event archive job started');
        }
      }
    } catch (err) {
      // Isolated: a failure here must never take down the server
      logger.error(`Event archive job failed to start: ${err.message}`);
    }

  }, 3000);

  // ════════════════════════════════════════════════════════════
  // 🖥️  SERVE REACT FRONTEND
  // ════════════════════════════════════════════════════════════
  if (fs.existsSync(distPath)) {
    // 1. Static assets
    app.use(express.static(distPath, {
      maxAge: IS_PRODUCTION ? '7d' : '0',
      etag:   true,
      index:  false,   // we handle index.html ourselves in the SPA fallback
    }));
    logger.info(`✅ Frontend static files served from: ${distPath}`);

    // 2. SPA fallback — send index.html for every non-API GET request
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();

      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        logger.debug(`SPA fallback: ${req.path} → index.html`);
        return res.sendFile(indexFile);
      }

      logger.warn(`⚠️  SPA fallback: index.html not found in ${distPath}`);
      next();
    });

  } else {
    logger.warn(`⚠️  Frontend dist not found at: ${distPath}`);
    logger.warn(`    Build the frontend and copy dist/ into: ${distPath}`);
    logger.warn(`    Running in API-only mode.`);
  }

  // ── 404 for unknown /api/* ───────────────────────────────────
  app.use('/api/', (req, res) =>
    res.status(404).json({
      success: false, error: 'API endpoint not found',
      requested: req.originalUrl, timestamp: new Date().toISOString(),
    })
  );

  // ── Root catch-all 404 ───────────────────────────────────────
  app.use((req, res) =>
    res.status(404).json({
      success: false, error: 'Not found',
      requested: req.originalUrl, timestamp: new Date().toISOString(),
    })
  );

  // ── Global error handler ─────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error(`Unhandled error: ${err.message}`);
    if (err.statusCode === 429) {
      return res.status(429).json({
        success: false, error: 'Rate limit exceeded',
        message: 'Too many requests, please try again later', retryAfter: '15 minutes',
      });
    }
    const status = err.statusCode || 500;
    res.status(status).json({
      success: false,
      error:   IS_PRODUCTION && status === 500 ? 'Internal server error' : err.message,
      timestamp: new Date().toISOString(),
      path: req.path,
      ...(!IS_PRODUCTION && { stack: err.stack }),
    });
  });

  return app;
}

// ═════════════════════════════════════════════════════════════
// 🚀  START SERVER
// ═════════════════════════════════════════════════════════════
async function startServer() {
  try {
    logger.info('Starting Guard Report API Server...');
    const app    = await createApp();
    const server = app.listen(PORT, '0.0.0.0', () => {
      if (IS_PRODUCTION) {
        server.keepAliveTimeout = 65000;
        server.headersTimeout   = 66000;
        logger.info('✅ Server timeouts configured (keepAlive: 65s, headers: 66s)');
      }

      logger.banner([
        '', '═'.repeat(60), '    ✅ SERVER READY', '═'.repeat(60),
        `    📡 API:           http://localhost:${PORT}/api`,
        `    🖥️  Frontend:      http://localhost:${PORT}`,
        `    📂 Dist:          ${fs.existsSync(distPath) ? '✅ FOUND' : '⚠️  NOT FOUND'} (${distPath})`,
        `    📂 index.html:    ${distIndexExists ? '✅ FOUND' : '❌ NOT FOUND — run the build first'}`,
        `    📧 Email:         ${EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}`,
        `    ⏰ Scheduler:     ${SCHEDULER_INTERVAL_MS / 60_000} min interval`,
        `    📦 Packaged:      ${IS_PKG ? 'Yes' : 'No'}`,
        `    🔧 Environment:   ${process.env.NODE_ENV || 'development'}`,
        `    🔤 ASCII Fix:     BUFFER-BASED ✅`,
        `    🔑 JWT Secret:    ${process.env.JWT_SECRET ? `✅ SET (${process.env.JWT_SECRET.length} chars)` : '❌ MISSING — login will fail!'}`,
        `    📄 .env loaded:   ${envPath}`,
        `    ☁️  Google Drive:  ${process.env.ARCHIVE_ROOT_FOLDER_ID ? '✅ CONFIGURED' : '⚠️  NOT SET'}`,
        '═'.repeat(60), '', '    Press Ctrl+C to stop', '',
      ]);

      openBrowser(`http://localhost:${PORT}`);

      setTimeout(() => {
        try {
          const cleanupPath = path.join(__dirname, 'utils', 'paths.js');
          if (fs.existsSync(cleanupPath)) {
            const { cleanupOldTempFiles } = require(cleanupPath);
            cleanupOldTempFiles(24);
            logger.info('✅ Old temp files cleanup initiated');
          }
        } catch (err) {
          logger.warn(`Temp cleanup failed: ${err.message}`);
        }
      }, 5000);
    });

    const gracefulShutdown = async signal => {
      logger.info(`${signal} received — shutting down gracefully...`);
      global.schedulerStatus.running = false;
      server.close(() => {
        global.apiCache.flushAll();
        logger.info('Server stopped cleanly');
        process.exit(0);
      });
      setTimeout(() => { logger.error('Forcing shutdown after timeout'); process.exit(1); }, 10_000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

    server.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
        logger.info(`Run: kill $(lsof -t -i:${PORT})  or set a different PORT`);
      } else {
        logger.error(`Server error: ${err.message}`);
      }
      process.exit(1);
    });

    return server;
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) startServer();

module.exports = { startServer, createApp };