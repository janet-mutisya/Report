// server/service/clientStorage.js - COMPLETE FIXED VERSION
import fs from "fs/promises";
import path from "path";
import bcrypt from "bcrypt";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STORAGE_FILE = path.join(__dirname, "..", "data", "clients.json");
const SALT_ROUNDS = 10;

async function ensureStorageFile() {
  try {
    await fs.access(STORAGE_FILE);
  } catch {
    await fs.mkdir(path.dirname(STORAGE_FILE), { recursive: true });
    await fs.writeFile(STORAGE_FILE, JSON.stringify([], null, 2));
  }
}

async function readClients() {
  await ensureStorageFile();
  const data = await fs.readFile(STORAGE_FILE, "utf-8");
  return JSON.parse(data);
}

async function writeClients(clients) {
  await fs.writeFile(STORAGE_FILE, JSON.stringify(clients, null, 2));
}

/**
 * Creates a new client account (account number discovered later)
 */
export async function createClient({ email, password, companyName }) {
  const clients = await readClients();

  const existingClient = clients.find(c => c.email.toLowerCase() === email.toLowerCase());
  if (existingClient) {
    return {
      success: false,
      error: "Email already registered"
    };
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const newClient = {
    id: Date.now().toString(),
    email: email.toLowerCase(),
    passwordHash,
    accountNumber: null,
    companyName: companyName || "",
    status: "pending_link",
    role: "client",  // ✅ Default role
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isActive: true
  };

  clients.push(newClient);
  await writeClients(clients);

  return {
    success: true,
    client: {
      id: newClient.id,
      email: newClient.email,
      companyName: newClient.companyName,
      status: newClient.status,
      role: newClient.role,  // ✅ Include role
      accountNumber: newClient.accountNumber
    }
  };
}

/**
 * Links account number to client (after discovery)
 */
export async function linkAccountNumber(clientId, accountNumber) {
  const clients = await readClients();
  const clientIndex = clients.findIndex(c => c.id === clientId);

  if (clientIndex === -1) {
    return { success: false, error: "Client not found" };
  }

  // Check if account number already linked to another user
  const existingAccount = clients.find(
    (c, idx) => idx !== clientIndex && c.accountNumber === accountNumber
  );

  if (existingAccount) {
    return {
      success: false,
      error: "Account number already linked to another user"
    };
  }

  clients[clientIndex].accountNumber = accountNumber;
  clients[clientIndex].status = "active";
  clients[clientIndex].updatedAt = new Date().toISOString();

  await writeClients(clients);

  return {
    success: true,
    client: {
      id: clients[clientIndex].id,
      email: clients[clientIndex].email,
      accountNumber: clients[clientIndex].accountNumber,
      companyName: clients[clientIndex].companyName,
      status: clients[clientIndex].status,
      role: clients[clientIndex].role || "client"  // ✅ Include role
    }
  };
}

/**
 * ✅ FIXED: Validates client login credentials - NOW RETURNS ROLE!
 */
export async function validateClientLogin(email, password) {
  const clients = await readClients();

  const client = clients.find(
    c => c.email.toLowerCase() === email.toLowerCase() && (c.isActive !== false)
  );

  if (!client) {
    return {
      valid: false,
      error: "Invalid email or password"
    };
  }

  const isValidPassword = await bcrypt.compare(password, client.passwordHash);

  if (!isValidPassword) {
    return {
      valid: false,
      error: "Invalid email or password"
    };
  }

  // ✅ FIX: Return FULL client object including role!
  return {
    valid: true,
    client: {
      id: client.id,
      email: client.email,
      accountNumber: client.accountNumber,
      companyName: client.companyName,
      status: client.status,
      role: client.role || "client",  // ✅ CRITICAL: Include role from database!
      createdAt: client.createdAt
    }
  };
}

/**
 * ✅ FIXED: Gets client by ID - NOW RETURNS ROLE!
 */
export async function getClientById(clientId) {
  const clients = await readClients();
  const client = clients.find(c => c.id === clientId);

  if (!client) return null;

  // ✅ FIX: Return role from database!
  return {
    id: client.id,
    email: client.email,
    accountNumber: client.accountNumber,
    companyName: client.companyName,
    status: client.status,
    role: client.role || "client",  // ✅ CRITICAL: Include role!
    createdAt: client.createdAt
  };
}

/**
 * Gets client by email
 */
export async function getClientByEmail(email) {
  const clients = await readClients();
  const client = clients.find(c => c.email.toLowerCase() === email.toLowerCase());

  if (!client) return null;

  return {
    id: client.id,
    email: client.email,
    accountNumber: client.accountNumber,
    companyName: client.companyName,
    status: client.status,
    role: client.role || "client",  // ✅ Include role
    createdAt: client.createdAt
  };
}

/**
 * Updates client status
 */
export async function updateClientStatus(clientId, status) {
  const clients = await readClients();
  const clientIndex = clients.findIndex(c => c.id === clientId);

  if (clientIndex === -1) {
    return { success: false, error: "Client not found" };
  }

  clients[clientIndex].status = status;
  clients[clientIndex].updatedAt = new Date().toISOString();

  await writeClients(clients);

  return { 
    success: true,
    client: {
      id: clients[clientIndex].id,
      email: clients[clientIndex].email,
      accountNumber: clients[clientIndex].accountNumber,
      companyName: clients[clientIndex].companyName,
      status: clients[clientIndex].status,
      role: clients[clientIndex].role || "client"
    }
  };
}

/**
 * Get all clients (for admin dashboard)
 */
export async function getAllClients() {
  try {
    const clients = await readClients();
    
    return clients.map(client => ({
      id: client.id,
      email: client.email,
      companyName: client.companyName,
      accountNumber: client.accountNumber,
      status: client.status,
      role: client.role || "client",  // ✅ Include role
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
      isActive: client.isActive
    }));
  } catch (error) {
    console.error('[ClientStorage] Failed to get all clients:', error);
    throw error;
  }
}

/**
 * Unlink account from client
 */
export async function unlinkAccount(clientId) {
  try {
    const clients = await readClients();
    const clientIndex = clients.findIndex(c => c.id === clientId);

    if (clientIndex === -1) {
      return {
        success: false,
        error: "Client not found"
      };
    }

    clients[clientIndex].accountNumber = null;
    clients[clientIndex].status = "pending_link";
    clients[clientIndex].updatedAt = new Date().toISOString();

    await writeClients(clients);

    return {
      success: true,
      client: {
        id: clients[clientIndex].id,
        email: clients[clientIndex].email,
        accountNumber: clients[clientIndex].accountNumber,
        companyName: clients[clientIndex].companyName,
        status: clients[clientIndex].status,
        role: clients[clientIndex].role || "client"
      }
    };

  } catch (error) {
    console.error('[ClientStorage] Failed to unlink account:', error);
    return {
      success: false,
      error: "Failed to unlink account"
    };
  }
}

/**
 * Search clients by query
 */
export async function searchClients(query) {
  try {
    const clients = await readClients();
    const searchTerm = query.toLowerCase();

    const filtered = clients.filter(client => {
      return (
        client.email.toLowerCase().includes(searchTerm) ||
        (client.companyName || "").toLowerCase().includes(searchTerm) ||
        (client.accountNumber || "").toLowerCase().includes(searchTerm)
      );
    });

    return {
      success: true,
      clients: filtered.map(client => ({
        id: client.id,
        email: client.email,
        companyName: client.companyName,
        accountNumber: client.accountNumber,
        status: client.status,
        role: client.role || "client",
        createdAt: client.createdAt,
        updatedAt: client.updatedAt
      }))
    };

  } catch (error) {
    console.error('[ClientStorage] Failed to search clients:', error);
    return {
      success: false,
      error: "Failed to search clients",
      clients: []
    };
  }
}

/**
 * Get clients by status
 */
export async function getClientsByStatus(status) {
  try {
    const clients = await readClients();
    const filtered = clients.filter(c => c.status === status);

    return {
      success: true,
      clients: filtered.map(client => ({
        id: client.id,
        email: client.email,
        companyName: client.companyName,
        accountNumber: client.accountNumber,
        status: client.status,
        role: client.role || "client",
        createdAt: client.createdAt,
        updatedAt: client.updatedAt
      }))
    };

  } catch (error) {
    console.error('[ClientStorage] Failed to get clients by status:', error);
    return {
      success: false,
      error: "Failed to get clients",
      clients: []
    };
  }
}

/**
 * Get client statistics
 */
export async function getClientStats() {
  try {
    const clients = await readClients();

    return {
      success: true,
      stats: {
        total: clients.length,
        active: clients.filter(c => c.status === "active").length,
        pending: clients.filter(c => c.status === "pending_link").length,
        inactive: clients.filter(c => c.status === "inactive").length,
        linked: clients.filter(c => c.accountNumber).length,
        unlinked: clients.filter(c => !c.accountNumber).length,
        admins: clients.filter(c => c.role === "admin").length,
        regularClients: clients.filter(c => c.role === "client" || !c.role).length
      }
    };

  } catch (error) {
    console.error('[ClientStorage] Failed to get stats:', error);
    return {
      success: false,
      error: "Failed to get statistics"
    };
  }
}

/**
 * Update client account number directly (admin override)
 */
export async function updateClientAccount(clientId, accountNumber) {
  try {
    const clients = await readClients();
    const clientIndex = clients.findIndex(c => c.id === clientId);

    if (clientIndex === -1) {
      return {
        success: false,
        error: "Client not found"
      };
    }

    const existingAccount = clients.find(
      (c, idx) => idx !== clientIndex && c.accountNumber === accountNumber
    );

    if (existingAccount) {
      return {
        success: false,
        error: `Account ${accountNumber} is already linked to ${existingAccount.email}`
      };
    }

    clients[clientIndex].accountNumber = accountNumber;
    clients[clientIndex].updatedAt = new Date().toISOString();

    await writeClients(clients);

    return {
      success: true,
      client: {
        id: clients[clientIndex].id,
        email: clients[clientIndex].email,
        accountNumber: clients[clientIndex].accountNumber,
        companyName: clients[clientIndex].companyName,
        status: clients[clientIndex].status,
        role: clients[clientIndex].role || "client"
      }
    };

  } catch (error) {
    console.error('[ClientStorage] Failed to update client account:', error);
    return {
      success: false,
      error: "Failed to update account"
    };
  }
}