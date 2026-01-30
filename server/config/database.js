// server/config/database.js - FIXED WITH CORRECT SQL SYNTAX
const sql = require('mssql');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from server/.env
const envPath = path.join(__dirname, '..', '.env');
console.log(`🔧 Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });

// ============================================================
// 🔍 COMPREHENSIVE DEBUG OUTPUT
// ============================================================
console.log('\n' + '='.repeat(70));
console.log('🔍 DATABASE CONFIGURATION DEBUG');
console.log('='.repeat(70));

console.log('\n📋 Environment Variables:');
console.log(`   USE_DATABASE: ${process.env.USE_DATABASE}`);
console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`   DB_SERVER: ${process.env.DB_SERVER || '❌ MISSING'}`);
console.log(`   DB_DATABASE: ${process.env.DB_DATABASE || '❌ MISSING'}`);
console.log(`   DB_PORT: ${process.env.DB_PORT || '(default: 1433)'}`);
console.log(`   DB_USER: ${process.env.DB_USER ? `"${process.env.DB_USER}"` : '❌ MISSING'}`);
console.log(`   DB_PASSWORD: ${process.env.DB_PASSWORD ? `✅ SET (${process.env.DB_PASSWORD.length} chars)` : '❌ MISSING'}`);
console.log(`   DB_ENCRYPT: ${process.env.DB_ENCRYPT}`);
console.log(`   DB_TRUST_SERVER_CERTIFICATE: ${process.env.DB_TRUST_SERVER_CERTIFICATE}`);

// Check for common issues
const issues = [];
if (!process.env.DB_SERVER) issues.push('DB_SERVER is not set');
if (!process.env.DB_DATABASE) issues.push('DB_DATABASE is not set');
if (!process.env.DB_USER) issues.push('DB_USER is not set');
if (!process.env.DB_PASSWORD) issues.push('DB_PASSWORD is not set');
if (process.env.DB_USER === '') issues.push('DB_USER is empty string');
if (process.env.DB_PASSWORD === '') issues.push('DB_PASSWORD is empty string');

if (issues.length > 0) {
  console.log('\n⚠️  CONFIGURATION ISSUES DETECTED:');
  issues.forEach(issue => console.log(`   ❌ ${issue}`));
}

console.log('='.repeat(70) + '\n');

// ============================================================
// DATABASE CONFIGURATION
// ============================================================
const USE_DATABASE = process.env.USE_DATABASE !== 'false';

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || '1433'),
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true
  },
  pool: {
    max: parseInt(process.env.DB_POOL_MAX || '10'),
    min: parseInt(process.env.DB_POOL_MIN || '0'),
    idleTimeoutMillis: 30000
  },
  requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT || '30000'),
  connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '30000')
};

// Debug: Show what config object looks like
console.log('📊 Database Config Object:');
console.log(`   server: ${config.server || '❌ undefined'}`);
console.log(`   database: ${config.database || '❌ undefined'}`);
console.log(`   port: ${config.port}`);
console.log(`   user: ${config.user ? `"${config.user}"` : '❌ undefined/empty'}`);
console.log(`   password: ${config.password ? '✅ SET' : '❌ undefined/empty'}`);
console.log(`   encrypt: ${config.options.encrypt}`);
console.log(`   trustServerCertificate: ${config.options.trustServerCertificate}`);
console.log('');

// ============================================================
// CONNECTION POOL CREATION
// ============================================================
let poolPromise;

if (USE_DATABASE && config.server && config.database && config.user && config.password) {
  console.log('🔌 Initiating database connection...');
  console.log(`   Target: ${config.server}:${config.port}`);
  console.log(`   Database: ${config.database}`);
  console.log(`   User: ${config.user}`);
  console.log('');
  
  poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
      console.log('✅ SQL Server connection pool created');
      
      // Test the connection with a simple query (FIXED SQL SYNTAX)
      return pool.request()
        .query('SELECT @@VERSION as version, DB_NAME() as current_db, SUSER_SNAME() as login_name')
        .then(result => {
          console.log('✅ Database connection test SUCCESSFUL');
          console.log('📊 Connection details:');
          console.log(`   Database: ${result.recordset[0]?.current_db}`);
          console.log(`   Login: ${result.recordset[0]?.login_name}`);
          console.log(`   SQL Server: ${result.recordset[0]?.version?.split('\n')[0]}`);
          console.log('');
          return pool;
        })
        .catch(testError => {
          console.error('❌ Database connection test FAILED');
          console.error(`   Error: ${testError.message}`);
          console.error(`   Code: ${testError.code}`);
          console.error('');
          throw testError;
        });
    })
    .catch(err => {
      console.error('\n' + '❌'.repeat(35));
      console.error('❌ DATABASE CONNECTION FAILED');
      console.error('❌'.repeat(35));
      console.error(`\n📋 Error Details:`);
      console.error(`   Message: ${err.message}`);
      console.error(`   Code: ${err.code || 'N/A'}`);
      console.error(`   Number: ${err.number || 'N/A'}`);
      console.error(`   State: ${err.state || 'N/A'}`);
      console.error(`   Class: ${err.class || 'N/A'}`);
      
      console.error('\n🔍 Connection Parameters Used:');
      console.error(`   Server: ${config.server}:${config.port}`);
      console.error(`   Database: ${config.database}`);
      console.error(`   User: ${config.user || '(empty)'}`);
      console.error(`   Password: ${config.password ? '(set)' : '(empty)'}`);
      console.error(`   Encrypt: ${config.options.encrypt}`);
      console.error(`   Trust Certificate: ${config.options.trustServerCertificate}`);
      
      console.error('\n💡 Troubleshooting Tips:');
      
      if (err.code === 'ELOGIN') {
        console.error('   ⚠️  Login failed - Check:');
        console.error('      1. Username and password are correct');
        console.error('      2. SQL Server is set to Mixed Mode authentication');
        console.error('      3. User has permission to access the database');
        console.error('      4. Special characters in password are properly escaped');
      } else if (err.code === 'ESOCKET') {
        console.error('   ⚠️  Network/socket error - Check:');
        console.error('      1. SQL Server is running');
        console.error('      2. Server address and port are correct');
        console.error('      3. Firewall allows connections on port ' + config.port);
        console.error('      4. SQL Server is configured to accept TCP/IP connections');
      } else if (err.code === 'ETIMEOUT') {
        console.error('   ⚠️  Connection timeout - Check:');
        console.error('      1. Server is reachable');
        console.error('      2. Network connectivity');
        console.error('      3. Increase connectionTimeout value');
      }
      
      console.error('\n📝 Fix your .env file:');
      console.error('   DB_USER="sa"');
      console.error('   DB_PASSWORD="YourPassword"');
      console.error('   DB_SERVER=localhost');
      console.error('   DB_DATABASE=_Datos');
      console.error('   DB_PORT=1433');
      console.error('');
      console.error('❌'.repeat(35) + '\n');
      
      // Check if we should crash or continue without database
      const isProduction = process.env.NODE_ENV === 'production';
      
      if (isProduction) {
        console.error('🛑 PRODUCTION MODE: Database is required. Exiting...\n');
        process.exit(1);
      } else {
        console.log('⚠️  DEVELOPMENT MODE: Continuing without database...\n');
        
        // Return mock pool for development
        return createMockPool('Connection failed: ' + err.message);
      }
    });
} else {
  // Database disabled or missing configuration
  console.log('📊 DATABASE NOT INITIALIZED');
  
  if (!USE_DATABASE) {
    console.log('   Reason: USE_DATABASE is set to false');
  } else {
    console.log('   Reason: Missing required configuration');
    if (!config.server) console.log('   ❌ DB_SERVER not set');
    if (!config.database) console.log('   ❌ DB_DATABASE not set');
    if (!config.user) console.log('   ❌ DB_USER not set');
    if (!config.password) console.log('   ❌ DB_PASSWORD not set');
  }
  
  console.log('   Status: Running without database connection\n');
  
  poolPromise = Promise.resolve(createMockPool('Database disabled or not configured'));
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Create a mock pool that throws informative errors
 */
function createMockPool(reason) {
  return {
    request: () => ({
      input: function() { return this; },
      query: () => Promise.reject(new Error(`Database not available: ${reason}`))
    }),
    connected: false,
    close: () => Promise.resolve(),
    on: () => {},
    connect: () => Promise.reject(new Error(`Database not available: ${reason}`))
  };
}

/**
 * Test database connection
 */
async function testConnection() {
  try {
    const pool = await poolPromise;
    
    if (!pool || pool.connected === false) {
      return { 
        success: false, 
        connected: false, 
        message: 'Database not connected' 
      };
    }
    
    const result = await pool.request().query(`
      SELECT 
        @@VERSION as version,
        DB_NAME() as database_name,
        SUSER_SNAME() as login_name,
        GETDATE() as server_time
    `);
    
    return { 
      success: true,
      connected: true, 
      message: 'Database connected successfully',
      details: {
        database: result.recordset[0]?.database_name,
        user: result.recordset[0]?.login_name,
        version: result.recordset[0]?.version?.split('\n')[0],
        serverTime: result.recordset[0]?.server_time
      }
    };
  } catch (error) {
    return { 
      success: false,
      connected: false, 
      message: error.message,
      error: error.code
    };
  }
}

/**
 * Get database pool (async)
 */
async function getPool() {
  try {
    const pool = await poolPromise;
    if (!pool || pool.connected === false) {
      throw new Error('Database pool is not available');
    }
    return pool;
  } catch (error) {
    console.error('❌ Error getting database pool:', error.message);
    throw error;
  }
}

/**
 * Close database connection
 */
async function closeConnection() {
  try {
    const pool = await poolPromise;
    if (pool && typeof pool.close === 'function') {
      await pool.close();
      console.log('✅ Database connection closed');
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ Error closing database connection:', error.message);
    return false;
  }
}

/**
 * Execute a query with automatic connection handling
 */
async function query(queryString, params = {}) {
  try {
    const pool = await poolPromise;
    const request = pool.request();
    
    // Add parameters
    Object.entries(params).forEach(([key, value]) => {
      request.input(key, value);
    });
    
    const result = await request.query(queryString);
    return result;
  } catch (error) {
    console.error('❌ Query execution failed:', error.message);
    throw error;
  }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  sql,
  poolPromise,
  getPool,
  testConnection,
  closeConnection,
  query,
  
  // Legacy compatibility
  connectDB: getPool,
  
  // Configuration info
  config: {
    server: config.server,
    database: config.database,
    port: config.port,
    isConnected: () => poolPromise.then(p => p?.connected || false).catch(() => false)
  }
};

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================
process.on('SIGTERM', async () => {
  console.log('\n⚠️  SIGTERM received, closing database connection...');
  await closeConnection();
});

process.on('SIGINT', async () => {
  console.log('\n⚠️  SIGINT received, closing database connection...');
  await closeConnection();
  process.exit(0);
});
