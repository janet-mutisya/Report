// server/config/production.js
// Production configuration for Report Patrol

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

const productionConfig = {
  // Server Configuration
  server: {
    port: process.env.PORT || 5000,
    host: '0.0.0.0',
    environment: 'production',
    nodeVersion: process.version
  },

  // Database Configuration
  database: {
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE || '',
    port: parseInt(process.env.DB_PORT) || 1433,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
      connectTimeout: 30000,
      requestTimeout: 30000
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
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
      pass: process.env.EMAIL_PASS || ''
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
    // ✅ RATE LIMITING REMOVED - Was causing 429 errors with multiple workers
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

// Validation function to ensure critical configs are set
export function validateConfig() {
  const errors = [];
  const warnings = [];

  // Critical validations
  if (!productionConfig.database.server) {
    errors.push('Database server (DB_SERVER) is not configured');
  }

  if (!productionConfig.database.database) {
    errors.push('Database name (DB_DATABASE) is not configured');
  }

  if (productionConfig.email.enabled && !productionConfig.email.auth.user) {
    errors.push('Email is enabled but EMAIL_USER is not configured');
  }

  if (productionConfig.security.jwtSecret === 'your-secret-key-change-in-production') {
    warnings.push('JWT_SECRET is using default value - should be changed in production');
  }

  // Display validation results
  if (errors.length > 0) {
    console.error('❌ CRITICAL CONFIGURATION ERRORS:');
    errors.forEach(error => console.error(`   - ${error}`));
    if (process.env.STRICT_CONFIG === 'true') {
      process.exit(1);
    }
  }

  if (warnings.length > 0) {
    console.warn('⚠️  CONFIGURATION WARNINGS:');
    warnings.forEach(warning => console.warn(`   - ${warning}`));
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ Configuration validation passed');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// Helper function to get config value with fallback
export function getConfig(path, defaultValue = null) {
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
export function isFeatureEnabled(featureName) {
  return productionConfig.features[featureName] === true;
}

// Display configuration summary
export function displayConfigSummary() {
  console.log('\n' + '='.repeat(70));
  console.log('📋 PRODUCTION CONFIGURATION SUMMARY');
  console.log('='.repeat(70));
  console.log(`🚀 Server:        Port ${productionConfig.server.port} (${productionConfig.server.environment})`);
  console.log(`🗄️  Database:      ${productionConfig.features.useDatabase ? '✅ Enabled' : '❌ Disabled'} - ${productionConfig.database.server}`);
  console.log(`📧 Email:         ${productionConfig.email.enabled ? '✅ Enabled' : '❌ Disabled'} - ${productionConfig.email.auth.user || 'Not configured'}`);
  console.log(`⏰ Scheduler:     ${productionConfig.scheduler.enabled ? '✅ Enabled' : '❌ Disabled'} - ${productionConfig.scheduler.timezone}`);
  console.log(`🔐 Auth:          ✅ Enabled - JWT expires in ${productionConfig.security.jwtExpiresIn}`);
  console.log(`🛡️  Security:      Rate limiting disabled`);
  console.log(`📊 Monitoring:    ${productionConfig.monitoring.metricsEnabled ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`🌐 CORS Origin:   ${productionConfig.security.cors.origin}`);
  console.log(`📁 Temp Storage:  ${productionConfig.storage.savePdfToDisk ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`⚙️  Workers:       ${productionConfig.performance.cluster.enabled ? productionConfig.performance.cluster.maxWorkers : 1} worker(s)`);
  console.log('='.repeat(70) + '\n');
}

// Export default config
export default productionConfig;

// Export individual config sections for easier imports
export const {
  server,
  database,
  email,
  scheduler,
  security,
  logging,
  performance,
  network,
  storage,
  api,
  features,
  monitoring
} = productionConfig;