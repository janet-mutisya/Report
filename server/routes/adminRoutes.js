// routes for manual account linking
const express = require("express");
const { requireAuth } = require("../middleware/requireAuth.js");
const { requireAdmin } = require("../middleware/requireAdmin.js");
const clientStorage = require("../service/clientStorage.js");
const accountDiscovery = require("../service/accountDiscovery.js");
const bmSecurityAPI = require("../service/bmSecurityAPI.js");

const router = express.Router();

/**
 * GET /api/admin/clients
 * Get all clients for admin dashboard
 */
router.get("/clients", requireAuth, requireAdmin, async (req, res) => {
  try {
    const clients = await clientStorage.getAllClients();

    res.json({
      success: true,
      clients: clients.map(client => ({
        id: client.id,
        email: client.email,
        companyName: client.companyName,
        accountNumber: client.accountNumber,
        status: client.status,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt
      }))
    });

  } catch (error) {
    console.error("[Admin] Failed to fetch clients:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch clients"
    });
  }
});

/**
 * GET /api/admin/bm-accounts
 * Get all BM Security accounts for linking
 */
router.get("/bm-accounts", requireAuth, requireAdmin, async (req, res) => {
  try {
    console.log("[Admin] Fetching all BM Security accounts...");

    // Use the new getAllAccounts() method instead of getAccountByNumber("")
    const result = await bmSecurityAPI.getAllAccounts();

    if (!result.success) {
      throw new Error("Failed to fetch BM accounts");
    }

    res.json({
      success: true,
      accounts: result.data,
      total: result.total
    });

  } catch (error) {
    console.error("[Admin] Failed to fetch BM accounts:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch BM Security accounts"
    });
  }
});

/**
 * POST /api/admin/link-account
 * Manually link a client to a BM Security account
 */
router.post("/link-account", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId, accountNumber } = req.body;

    if (!clientId || !accountNumber) {
      return res.status(400).json({
        success: false,
        message: "Client ID and account number are required"
      });
    }

    // Validate the account exists
    const validationResult = await accountDiscovery.validateAccountNumber(accountNumber);

    if (!validationResult.valid) {
      return res.status(400).json({
        success: false,
        message: "Invalid account number or account not found"
      });
    }

    // Link the account
    const linkResult = await clientStorage.linkAccountNumber(
      clientId,
      validationResult.normalizedAccountNumber
    );

    if (!linkResult.success) {
      return res.status(400).json({
        success: false,
        message: linkResult.error
      });
    }

    console.log(`[Admin] Manually linked client ${clientId} to account ${validationResult.normalizedAccountNumber}`);

    res.json({
      success: true,
      message: "Account linked successfully",
      client: linkResult.client
    });

  } catch (error) {
    console.error("[Admin] Failed to link account:", error);
    res.status(500).json({
      success: false,
      message: "Failed to link account"
    });
  }
});

/**
 * POST /api/admin/unlink-account
 * Unlink a client from their BM Security account
 */
router.post("/unlink-account", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.body;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required"
      });
    }

    const result = await clientStorage.unlinkAccount(clientId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    }

    console.log(`[Admin] Unlinked account for client ${clientId}`);

    res.json({
      success: true,
      message: "Account unlinked successfully",
      client: result.client
    });

  } catch (error) {
    console.error("[Admin] Failed to unlink account:", error);
    res.status(500).json({
      success: false,
      message: "Failed to unlink account"
    });
  }
});

/**
 * POST /api/admin/update-status
 * Update client status (active, inactive, pending_link)
 */
router.post("/update-status", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId, status } = req.body;

    if (!clientId || !status) {
      return res.status(400).json({
        success: false,
        message: "Client ID and status are required"
      });
    }

    const validStatuses = ["active", "inactive", "pending_link"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be: active, inactive, or pending_link"
      });
    }

    const result = await clientStorage.updateClientStatus(clientId, status);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    }

    console.log(`[Admin] Updated client ${clientId} status to ${status}`);

    res.json({
      success: true,
      message: "Status updated successfully",
      client: result.client
    });

  } catch (error) {
    console.error("[Admin] Failed to update status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update status"
    });
  }
});

/**
 * GET /api/admin/client/:id
 * Get detailed information about a specific client
 */
router.get("/client/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = await clientStorage.getClientById(req.params.id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    res.json({
      success: true,
      client: {
        id: client.id,
        email: client.email,
        companyName: client.companyName,
        accountNumber: client.accountNumber,
        status: client.status,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt
      }
    });

  } catch (error) {
    console.error("[Admin] Failed to fetch client:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch client"
    });
  }
});

/**
 * GET /api/admin/stats
 * Get dashboard statistics
 */
router.get("/stats", requireAuth, requireAdmin, async (req, res) => {
  try {
    const clients = await clientStorage.getAllClients();

    const stats = {
      total: clients.length,
      active: clients.filter(c => c.status === "active").length,
      pending: clients.filter(c => c.status === "pending_link").length,
      inactive: clients.filter(c => c.status === "inactive").length,
      linked: clients.filter(c => c.accountNumber).length,
      unlinked: clients.filter(c => !c.accountNumber).length
    };

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error("[Admin] Failed to fetch stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch statistics"
    });
  }
});

/**
 * POST /api/admin/search-accounts
 * Search BM Security accounts by query
 */
router.post("/search-accounts", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "Search query is required"
      });
    }

    // Get all accounts and filter
    const result = await bmSecurityAPI.getAllAccounts();

    if (!result.success) {
      throw new Error("Failed to fetch accounts");
    }

    const filtered = result.data.filter(account => {
      const searchStr = query.toLowerCase();
      return (
        (account.cue_ncuenta || "").toLowerCase().includes(searchStr) ||
        (account.cue_cnombre || "").toLowerCase().includes(searchStr) ||
        (account.cue_cempresa || "").toLowerCase().includes(searchStr)
      );
    });

    res.json({
      success: true,
      accounts: filtered,
      total: filtered.length
    });

  } catch (error) {
    console.error("[Admin] Failed to search accounts:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search accounts"
    });
  }
});

module.exports = router;