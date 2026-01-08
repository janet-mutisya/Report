// server/routes/dashboard.js - ULTRA-OPTIMIZED VERSION
import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireLinkedAccount } from "../middleware/requireLinkedAccount.js";
import { 
  getDashboardPatrolEvents, 
  getDashboardSummary,
  generateDashboardPDF,
  clearAllCaches,
  getCacheStats,
  warmupCache
} from "../service/dashboardReportService.js";
import { getClientById } from "../service/clientStorage.js";
import bmSecurityAPI from "../service/bmSecurityAPI.js";

const router = express.Router();

/**
 * GET /api/dashboard/status
 * Check account linking status (no account required)
 */
router.get("/status", requireAuth, (req, res) => {
  res.json({
    success: true,
    status: req.user.status,
    accountNumber: req.user.apiClientAccount,
    email: req.user.email,
    companyName: req.user.companyName,
    hasAccess: req.user.status === "active" && !!req.user.apiClientAccount,
    message: req.user.status === "pending_link"
      ? "Account setup in progress. You'll receive an email when ready."
      : req.user.status === "active"
      ? "Dashboard access granted"
      : "Account inactive"
  });
});

/**
 * ✅ ULTRA-FAST: GET /api/dashboard/summary
 * Weekly summary with aggressive caching - SHOULD LOAD IN 1-2 SECONDS
 */
router.get("/summary", requireAuth, requireLinkedAccount, async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Get date range from query params or default to last 7 days
    const { startDate, endDate } = req.query;
    
    let start, end;
    
    if (startDate && endDate) {
      start = startDate;
      end = endDate;
    } else {
      end = new Date().toISOString().split("T")[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      start = weekAgo.toISOString().split("T")[0];
    }

    console.log(`[Dashboard] Summary request for ${req.user.apiClientAccount}: ${start} to ${end}`);

    const result = await getDashboardSummary({
      clientId: req.user.apiClientAccount,
      startDate: start,
      endDate: end
    });

    const duration = Date.now() - startTime;
    console.log(`[Dashboard] Summary response sent in ${duration}ms`);

    // Add user context to response
    res.json({
      ...result,
      accountNumber: req.user.apiClientAccount,
      companyName: req.user.companyName,
      email: req.user.email,
      totalResponseTime: duration
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Summary error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: "Unable to fetch summary data. Please try again later.",
      error: error.message,
      totalResponseTime: duration
    });
  }
});

/**
 * ✅ ULTRA-FAST: GET /api/dashboard/patrol-events
 * Get patrol events with aggressive caching
 */
router.get("/patrol-events", requireAuth, requireLinkedAccount, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { startDate, endDate } = req.query;

    const today = new Date().toISOString().split("T")[0];
    const start = startDate || today;
    const end = endDate || today;

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start) || !dateRegex.test(end)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Use YYYY-MM-DD"
      });
    }

    console.log(`[Dashboard] Patrol events request for ${req.user.apiClientAccount}: ${start} to ${end}`);

    const result = await getDashboardPatrolEvents({
      clientId: req.user.apiClientAccount,
      startDate: start,
      endDate: end
    });

    const duration = Date.now() - startTime;
    console.log(`[Dashboard] Patrol events response sent in ${duration}ms`);

    res.json({
      ...result,
      totalResponseTime: duration
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Patrol events error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: "Unable to fetch patrol data. Please try again later.",
      error: error.message,
      totalResponseTime: duration
    });
  }
});

/**
 * ✅ NEW: GET /api/dashboard/pdf
 * Generate and download PDF report
 */
router.get("/pdf", requireAuth, requireLinkedAccount, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required (YYYY-MM-DD)"
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Use YYYY-MM-DD"
      });
    }

    console.log(`[Dashboard] PDF generation request for ${req.user.apiClientAccount}: ${startDate} to ${endDate}`);

    const result = await generateDashboardPDF({
      clientId: req.user.apiClientAccount,
      clientName: req.user.companyName,
      startDate,
      endDate
    });

    const duration = Date.now() - startTime;
    console.log(`[Dashboard] PDF generated and sent in ${duration}ms`);

    // Send as downloadable PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.setHeader("X-Processing-Time", duration.toString());

    res.send(result.pdfBuffer);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] PDF generation error after ${duration}ms:`, error);
    
    res.status(500).json({
      success: false,
      message: "Failed to generate PDF",
      error: error.message,
      totalResponseTime: duration
    });
  }
});

/**
 * ✅ ULTRA-FAST: GET /api/dashboard/all-events
 * Get ALL events for dashboard (last 90 days)
 */
router.get("/all-events", requireAuth, requireLinkedAccount, async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Get last 90 days of data for dashboard
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 90);
    
    const formattedStart = startDate.toISOString().split('T')[0];
    const formattedEnd = endDate.toISOString().split('T')[0];

    console.log(`[Dashboard] All events request for ${req.user.apiClientAccount}: ${formattedStart} to ${formattedEnd}`);

    const [eventsResult, summaryResult] = await Promise.all([
      getDashboardPatrolEvents({
        clientId: req.user.apiClientAccount,
        startDate: formattedStart,
        endDate: formattedEnd
      }),
      getDashboardSummary({
        clientId: req.user.apiClientAccount,
        startDate: formattedStart,
        endDate: formattedEnd
      })
    ]);

    const duration = Date.now() - startTime;
    console.log(`[Dashboard] All events response sent in ${duration}ms`);

    res.json({
      success: true,
      events: eventsResult.data || [],
      summary: summaryResult.data?.summary || {},
      metadata: summaryResult.data?.metadata || {},
      posts: summaryResult.data?.posts || [],
      dataSource: eventsResult.dataSource || 'UNKNOWN',
      totalEvents: eventsResult.data?.length || 0,
      generatedAt: new Date(),
      totalResponseTime: duration
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] All events error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: "Unable to fetch dashboard data. Please try again later.",
      events: [],
      summary: {},
      metadata: null,
      totalResponseTime: duration
    });
  }
});

/**
 * GET /api/dashboard/monthly-summary
 * Monthly summary with caching
 */
router.get("/monthly-summary", requireAuth, requireLinkedAccount, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      .toISOString()
      .split("T")[0];
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      .toISOString()
      .split("T")[0];

    console.log(`[Dashboard] Monthly summary request for ${req.user.apiClientAccount}`);

    const result = await getDashboardSummary({
      clientId: req.user.apiClientAccount,
      startDate: firstDayOfMonth,
      endDate: lastDayOfMonth
    });

    const duration = Date.now() - startTime;
    console.log(`[Dashboard] Monthly summary response sent in ${duration}ms`);

    // Add user context to response
    res.json({
      ...result,
      accountNumber: req.user.apiClientAccount,
      companyName: req.user.companyName,
      totalResponseTime: duration
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Monthly summary error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: "Unable to fetch monthly summary. Please try again later.",
      totalResponseTime: duration
    });
  }
});

/**
 * GET /api/dashboard/account-info
 * Get account information from BM Security
 */
router.get("/account-info", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    console.log(`[Dashboard] Fetching account info for ${req.user.apiClientAccount}`);
    
    const result = await bmSecurityAPI.getAccountByNumber(req.user.apiClientAccount);

    if (!result.success || !result.account) {
      return res.status(404).json({
        success: false,
        message: "Account information not found"
      });
    }

    res.json({
      success: true,
      account: {
        accountNumber: result.accountUsed,
        name: result.account.cue_cnombre || result.account.cue_cempresa,
        email: result.account.cue_correo || result.account.cue_cemail,
        phone: result.account.cue_ctelefono,
        active: result.account.cue_lactivo
      }
    });

  } catch (error) {
    console.error("[Dashboard] Account info error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch account information"
    });
  }
});

/**
 * GET /api/dashboard/user-profile
 * Get user profile information
 */
router.get("/user-profile", requireAuth, async (req, res) => {
  try {
    const client = await getClientById(req.user.userId);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      profile: {
        email: client.email,
        companyName: client.companyName,
        accountNumber: client.accountNumber,
        status: client.status,
        createdAt: client.createdAt
      }
    });

  } catch (error) {
    console.error("[Dashboard] User profile error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch user profile"
    });
  }
});

/**
 * ✅ NEW: POST /api/dashboard/warmup
 * Warmup cache for faster initial load
 * Optional: Pass startDate and endDate to warm specific range
 */
router.post("/warmup", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    console.log(`[Dashboard] Cache warmup request for ${req.user.apiClientAccount}`, 
      startDate && endDate ? `(${startDate} to ${endDate})` : '(smart warmup)');
    
    let result;
    
    if (startDate && endDate) {
      // Warmup specific date range
      const { warmupDateRange } = await import("../service/bmSecurityAPICache.js");
      result = await warmupDateRange(req.user.apiClientAccount, startDate, endDate);
    } else {
      // Smart warmup (last 7 days + current month)
      result = await warmupCache(req.user.apiClientAccount);
    }
    
    res.json({
      success: result.success,
      message: result.success 
        ? "Cache warmed up successfully. Next requests will be instant." 
        : "Cache warmup failed",
      details: result,
      tip: "The first warmup takes 40+ seconds, but all subsequent requests will be fast"
    });

  } catch (error) {
    console.error("[Dashboard] Cache warmup error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to warmup cache",
      error: error.message
    });
  }
});

/**
 * ✅ NEW: GET /api/dashboard/cache-stats
 * Get cache statistics (admin only)
 */
router.get("/cache-stats", requireAuth, async (req, res) => {
  try {
    const stats = getCacheStats();
    
    res.json({
      success: true,
      stats,
      timestamp: new Date()
    });

  } catch (error) {
    console.error("[Dashboard] Cache stats error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ✅ NEW: POST /api/dashboard/clear-cache
 * Clear all caches (admin only)
 */
router.post("/clear-cache", requireAuth, async (req, res) => {
  try {
    const result = clearAllCaches();
    
    res.json({
      success: true,
      message: "Caches cleared successfully",
      cleared: result
    });

  } catch (error) {
    console.error("[Dashboard] Clear cache error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ✅ NEW: POST /api/dashboard/force-refresh
 * Force refresh cache for specific date range (bypasses cache)
 */
router.post("/force-refresh", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required"
      });
    }
    
    console.log(`[Dashboard] Force refresh request for ${req.user.apiClientAccount}: ${startDate} to ${endDate}`);
    
    const { forceRefresh } = await import("../service/bmSecurityAPICache.js");
    const result = await forceRefresh(req.user.apiClientAccount, startDate, endDate);
    
    res.json({
      success: result.success,
      message: "Cache refreshed successfully",
      events: result.data?.length || 0
    });

  } catch (error) {
    console.error("[Dashboard] Force refresh error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to refresh cache",
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/health
 * Health check endpoint
 */
router.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

export default router;