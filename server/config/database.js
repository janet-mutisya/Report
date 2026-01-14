// server/config/database.js
import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

const USE_DATABASE = process.env.USE_DATABASE !== 'false'; // Default to true unless explicitly disabled

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let poolPromise;

if (USE_DATABASE && config.server && config.database) {
  poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
      console.log('✅ Connected to SQL Server');
      return pool;
    })
    .catch(err => {
      console.error('❌ Database connection failed:', err);
      console.log('⚠️ Continuing without database...');
      return null; // Return null instead of crashing
    });
} else {
  console.log('📊 Database disabled - running without DB connection');
  poolPromise = Promise.resolve(null);
}

export { sql, poolPromise };
export default poolPromise;