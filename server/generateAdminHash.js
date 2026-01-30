// server/generateAdminHash.js
const bcrypt = require('bcrypt');

async function generateAdminUsers() {
  const password = 'password$';
  const hash = await bcrypt.hash(password, 10);

  const adminUsers = [
    {
      id: "admin-" + Date.now() + "-0",
      email: "rirungu@bmsecurity.com",
      passwordHash: hash,
      companyName: "BM Security Admin",
      accountNumber: null,
      role: "admin",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "admin-" + Date.now() + "-1",
      email: "jmutisya@bmsecurity.com",
      passwordHash: hash,
      companyName: "BM Security Admin",
      accountNumber: null,
      role: "admin",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  console.log('Password Hash:', hash);
  console.log('\n📋 Copy this into server/data/clients.json:\n');
  console.log(JSON.stringify(adminUsers, null, 2));
}

generateAdminUsers();