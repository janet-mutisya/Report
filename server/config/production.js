// server/config/production.js
// Production configuration for Report Patrol

const dotenv = require('dotenv');
const path = require('path');

// ✅ FIX: Load environment variables from the server/.env file
const envPath = path.join(__dirname, '..', '.env');
console.log('🔧 [production.js] Loading .env from:', envPath);
const envResult = dotenv.config({ path: envPath });

if (envResult.error) {
  console.warn('⚠️  Could not load .env file from', envPath);
  console.warn('⚠️  Relying on system environment variables:', Object.keys(process.env).filter(key => key.startsWith('DB_') || key.startsWith('EMAIL_') || key.startsWith('JWT_')));
} else {
  console.log('✅ Environment variables loaded successfully');
}

const productionConfig = {
  // Server Configuration
  server: {
    port: process.env.PORT || 5000,
    host: '0.0.0.0',
    environment: 'production',
    nodeVersion: process.version
  },

  // Database Configuration - ✅ REMOVED DUPLICATION
  // Note: Database configuration is handled in server/database.js
  // This config only references what's needed for validation
  database: {
    // Only include minimal info for validation purposes
    isConfigured: !!(process.env.DB_SERVER && process.env.DB_DATABASE),
    server: process.env.DB_SERVER,
    name: process.env.DB_DATABASE
  },

  // Email Configuration
  email: {
    enabled: process.env.ENABLE_EMAIL_SENDING === 'true',
    service: process.env.EMAIL_SERVICE || 'gmail',
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER || '',
      pass: process.env.EMAIL_PASS ? '***' + process.env.EMAIL_PASS.slice(-3) : '(not set)' // Hide password
    },
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER || '',
    retryAttempts: 3,
    retryDelay: 5000
  },

  // Scheduler Configuration
  scheduler: {
    enabled: process.env.USE_SCHEDULER !== 'false',
    checkInterval: process.env.SCHEDULER_CHECK_INTERVAL || '* * * * *', // Every minute
    timezone: process.env.TIMEZONE || 'Africa/Nairobi',
    testMode: false, // Always false in production
    gracePeriodMinutes: parseInt(process.env.GRACE_PERIOD_MINUTES) || 10,
    maxConcurrentPdfs: parseInt(process.env.MAX_CONCURRENT_PDFS) || 5,
    pdfGenerationTimeout: parseInt(process.env.PDF_GENERATION_TIMEOUT) || 45000,
    emailSendTimeout: parseInt(process.env.EMAIL_SEND_TIMEOUT) || 20000,
    delayBetweenClients: parseInt(process.env.DELAY_BETWEEN_CLIENTS) || 500
  },

  // Security Configuration
  security: {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    bcryptSaltRounds: 10,
    sessionSecret: process.env.SESSION_SECRET || 'session-secret-change-in-production',
    cors: {
      origin: process.env.FRONTEND_URL || 'https://reports-97dm.onrender.com',
      credentials: true
    },
    helmet: {
      contentSecurityPolicy: true,
      crossOriginEmbedderPolicy: false
    }
  },

  // Logging Configuration
  logging: {
    enabled: true,
    level: process.env.LOG_LEVEL || 'info',
    errorLogFile: process.env.ERROR_LOG_FILE || 'scheduler_errors.log',
    successLogFile: process.env.SUCCESS_LOG_FILE || 'scheduler_success.log',
    logToFile: process.env.LOG_ERRORS_TO_FILE === 'true',
    maxLogSize: '10M',
    maxLogFiles: 10
  },

  // Performance Configuration
  performance: {
    compression: true,
    cluster: {
      enabled: process.env.NODE_ENV === 'production', // Only cluster in production
      maxWorkers: 2 // Reduced from 4 to avoid overwhelming the system
    },
    requestTimeout: 30000,
    keepAliveTimeout: 65000,
    headersTimeout: 66000
  },

  // Network Configuration
  network: {
    checkInterval: 60000, // Check network every 60 seconds
    timeout: 3000,
    circuitBreaker: {
      enabled: true,
      threshold: 3,
      resetTimeout: 30000,
      timeout: 10000
    }
  },

  // Storage Configuration
  storage: {
    tempDir: process.env.TEMP_DIR || path.join(__dirname, '../../temp_pdfs'),
    savePdfToDisk: process.env.SAVE_PDF_TO_DISK === 'true',
    maxPdfSize: '10M',
    cleanupInterval: 24 * 60 * 60 * 1000 // Clean temp files every 24 hours
  },

  // API Configuration
  api: {
    baseUrl: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`,
    version: '3.0.0',
    timeout: 30000,
    retryAttempts: 3
  },

  // Feature Flags
  features: {
    useDatabase: process.env.USE_DATABASE !== 'false',
    authentication: true,
    adminRoutes: true,
    incidentTracking: true,
    autoDiscovery: true,
    backupSync: process.env.ENABLE_BACKUP_SYNC === 'true'
  },

  // Monitoring Configuration
  monitoring: {
    healthCheckInterval: 60000,
    metricsEnabled: true,
    performanceTracking: true,
    errorTracking: true
  }
};

// Enhanced validation function
function validateConfig() {
  const errors = [];
  const warnings = [];

  console.log('\n🔍 [production.js] Validating configuration...');
  
  // Critical validations
  if (!process.env.DB_SERVER) {
    errors.push('DB_SERVER environment variable is not set');
  } else {
    console.log(`   ✅ DB_SERVER: ${process.env.DB_SERVER}`);
  }

  if (!process.env.DB_DATABASE) {
    errors.push('DB_DATABASE environment variable is not set');
  } else {
    console.log(`   ✅ DB_DATABASE: ${process.env.DB_DATABASE}`);
  }

  if (!process.env.DB_USER) {
    warnings.push('DB_USER environment variable is not set');
  } else {
    console.log(`   ✅ DB_USER: ${process.env.DB_USER}`);
  }

  if (!process.env.DB_PASSWORD) {
    warnings.push('DB_PASSWORD environment variable is not set');
  } else {
    console.log(`   ✅ DB_PASSWORD: ********`);
  }

  if (productionConfig.email.enabled && !process.env.EMAIL_USER) {
    errors.push('Email is enabled but EMAIL_USER is not configured');
  } else if (productionConfig.email.enabled) {
    console.log(`   ✅ EMAIL_USER: ${process.env.EMAIL_USER}`);
  }

  if (productionConfig.security.jwtSecret === 'your-secret-key-change-in-production') {
    errors.push('JWT_SECRET is using default value - MUST be changed in production');
  } else if (process.env.JWT_SECRET) {
    console.log(`   ✅ JWT_SECRET: ******** (${process.env.JWT_SECRET.length} chars)`);
  }

  // Display validation results
  if (errors.length > 0) {
    console.error('\n❌ CRITICAL CONFIGURATION ERRORS:');
    errors.forEach(error => console.error(`   - ${error}`));
    
    // Only exit if in strict mode
    if (process.env.STRICT_CONFIG === 'true') {
      console.error('   Exiting due to strict mode...');
      process.exit(1);
    } else {
      console.error('   ⚠️  Continuing despite errors (strict mode disabled)');
    }
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  CONFIGURATION WARNINGS:');
    warnings.forEach(warning => console.warn(`   - ${warning}`));
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n✅ All configuration checks passed');
  }

  return { 
    valid: errors.length === 0, 
    errors, 
    warnings,
    hasDatabaseConfig: !!(process.env.DB_SERVER && process.env.DB_DATABASE && process.env.DB_USER && process.env.DB_PASSWORD)
  };
}

// Helper function to get config value with fallback
function getConfig(path, defaultValue = null) {
  const keys = path.split('.');
  let value = productionConfig;
  
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return defaultValue;
    }
  }
  
  return value;
}

// Helper to check if a feature is enabled
function isFeatureEnabled(featureName) {
  return productionConfig.features[featureName] === true;
}

// Display configuration summary
function displayConfigSummary() {
  const dbStatus = productionConfig.database.isConfigured ? '✅ Configured' : '❌ Not Configured';
  const emailStatus = productionConfig.email.enabled ? '✅ Enabled' : '❌ Disabled';
  const schedulerStatus = productionConfig.scheduler.enabled ? '✅ Enabled' : '❌ Disabled';
  const authStatus = productionConfig.features.authentication ? '✅ Enabled' : '❌ Disabled';
  
  console.log('\n' + '='.repeat(70));
  console.log('📋 PRODUCTION CONFIGURATION SUMMARY');
  console.log('='.repeat(70));
  console.log(`🚀 Server:        Port ${productionConfig.server.port} (${productionConfig.server.environment})`);
  console.log(`🗄️  Database:      ${dbStatus} - ${process.env.DB_SERVER || 'Not set'}`);
  console.log(`📧 Email:         ${emailStatus} - ${process.env.EMAIL_USER || 'No user configured'}`);
  console.log(`⏰ Scheduler:     ${schedulerStatus} - ${productionConfig.scheduler.timezone}`);
  console.log(`🔐 Auth:          ${authStatus} - JWT expires in ${productionConfig.security.jwtExpiresIn}`);
  console.log(`📊 Monitoring:    ${productionConfig.monitoring.metricsEnabled ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`🌐 CORS Origin:   ${productionConfig.security.cors.origin}`);
  console.log(`📁 Temp Storage:  ${productionConfig.storage.savePdfToDisk ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`⚙️  Workers:       ${productionConfig.performance.cluster.enabled ? productionConfig.performance.cluster.maxWorkers : 1} worker(s)`);
  console.log(`🔑 Env Loaded:    ${envResult && !envResult.error ? '✅ From .env file' : '⚠️ From system/env vars'}`);
  console.log('='.repeat(70) + '\n');
}

// Export default config and functions
module.exports = productionConfig;
module.exports.validateConfig = validateConfig;
module.exports.getConfig = getConfig;
module.exports.isFeatureEnabled = isFeatureEnabled;
module.exports.displayConfigSummary = displayConfigSummary;

// Export individual config sections for easier imports
module.exports.server = productionConfig.server;
module.exports.email = productionConfig.email;
module.exports.scheduler = productionConfig.scheduler;
module.exports.security = productionConfig.security;
module.exports.logging = productionConfig.logging;
module.exports.performance = productionConfig.performance;
module.exports.network = productionConfig.network;
module.exports.storage = productionConfig.storage;
module.exports.api = productionConfig.api;
module.exports.features = productionConfig.features;
module.exports.monitoring = productionConfig.monitoring;