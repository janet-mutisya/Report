// explore-current-dbs.js - Explore current databases
const sql = require('mssql');

async function exploreDatabases() {
  try {
    console.log('🔍 EXPLORING CURRENT DATABASES\n');
    
    const config = {
      server: 'localhost',
      user: 'sa',
      password: 'Password$',
      database: 'master',
      options: {
        trustServerCertificate: true,
        encrypt: false,
        connectTimeout: 5000
      }
    };
    
    await sql.connect(config);
    
    // Get all databases
    const dbs = await sql.query`
      SELECT name, state, state_desc, create_date 
      FROM sys.databases 
      WHERE state = 0 
      ORDER BY name
    `;
    
    console.log(`📊 FOUND ${dbs.recordset.length} DATABASES:\n`);
    
    dbs.recordset.forEach(db => {
      console.log(`📍 ${db.name}`);
      console.log(`   Status: ${db.state_desc}`);
      console.log(`   Created: ${db.create_date}`);
      console.log('');
    });
    
    // Check if our target databases exist
    const targetDbs = ['mainDB', 'reflatbles'];
    console.log('🎯 CHECKING FOR TARGET DATABASES:');
    
    for (const dbName of targetDbs) {
      const exists = dbs.recordset.some(db => db.name.toLowerCase() === dbName.toLowerCase());
      if (exists) {
        console.log(`   ✅ ${dbName} - EXISTS`);
      } else {
        console.log(`   ❌ ${dbName} - NOT FOUND`);
      }
    }
    
    await sql.close();
    
  } catch (err) {
    console.log('❌ Error:', err.message);
  }
}

exploreDatabases();