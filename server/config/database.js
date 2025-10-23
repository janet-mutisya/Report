import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

const pool = new sql.ConnectionPool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
});

const poolPromise = pool.connect()
  .then(p => {
    console.log('✅ Connected to SQL Server');
    return p;
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err);
  });

export { sql, poolPromise };
export default poolPromise;
