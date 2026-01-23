// server/routes/dashboard.js - UPDATED WITH PATROL SCHEDULE INTEGRATION
import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireLinkedAccount } from "../middleware/requireLinkedAccount.js";
import dashboardService from "../service/dashboardReportService.js";
import { getClientById } from "../service/clientStorage.js";
import bmSecurityAPI from "../service/bmSecurityAPI.js";

const router = express.Router();

// Helper to validate date format
function isValidDate(dateString) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;
  
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

// Helper to get default date ranges
function getDefaultDateRange(reportType = 'weekly') {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  switch (reportType.toLowerCase()) {
    case 'weekly':
    case 'last7':
      const weekAgo = new Date();
      weekAgo.setDate(today.getDate() - 6); // 7 days inclusive
      return {
        startDate: weekAgo.toISOString().split('T')[0],
        endDate: todayStr,
        days: 7
      };
      
    case 'monthly':
    case 'last30':
      const monthAgo = new Date();
      monthAgo.setDate(today.getDate() - 29); // 30 days inclusive
      return {
        startDate: monthAgo.toISOString().split('T')[0],
        endDate: todayStr,
        days: 30
      };
      
    case 'daily':
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      return {
        startDate: yesterday.toISOString().split('T')[0],
        endDate: yesterday.toISOString().split('T')[0],
        days: 1
      };
      
    default:
      return {
        startDate: todayStr,
        endDate: todayStr,
        days: 1
      };
  }
}

/**
 * GET /api/dashboard/status
 * Check account linking status
 */
router.get("/status", requireAuth, (req, res) => {
  try {
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
        : "Account inactive",
      timestamp: new Date()
    });
  } catch (error) {
    console.error("[Dashboard] Status error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to check status"
    });
  }
});

/**
 * GET /api/dashboard/summary
 * Get dashboard summary with patrol schedule integration
 */
router.get("/summary", requireAuth, requireLinkedAccount, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { startDate, endDate, reportType = 'custom', forceWeekly = 'false' } = req.query;
    
    let dateRange;
    let finalReportType = reportType;
    let finalForceWeekly = forceWeekly === 'true';
    
    // Handle preset report types
    if (reportType && !startDate && !endDate) {
      dateRange = getDefaultDateRange(reportType);
      finalReportType = reportType;
      
      // Only enforce weekly for weekly reports
      if (reportType === 'weekly' || reportType === 'last7') {
        finalForceWeekly = true;
      }
    } else if (startDate && endDate) {
      // Validate custom dates
      if (!isValidDate(startDate) || !isValidDate(endDate)) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Use YYYY-MM-DD"
        });
      }
      dateRange = { startDate, endDate };
      finalReportType = 'custom';
      finalForceWeekly = false;
    } else {
      // Default to weekly
      dateRange = getDefaultDateRange('weekly');
      finalReportType = 'weekly';
      finalForceWeekly = true;
    }
    
    console.log(`[Dashboard] Summary request for ${req.user.apiClientAccount}:`, {
      reportType: finalReportType,
      range: `${dateRange.startDate} to ${dateRange.endDate}`,
      forceWeekly: finalForceWeekly
    });
    
    const result = await dashboardService.getDashboardSummary({
      clientId: req.user.apiClientAccount,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      forceWeekly: finalForceWeekly,
      reportType: finalReportType
    });
    
    const duration = Date.now() - startTime;
    console.log(`[Dashboard] Summary response in ${duration}ms`);
    
    res.json({
      ...result,
      userContext: {
        accountNumber: req.user.apiClientAccount,
        companyName: req.user.companyName,
        email: req.user.email
      },
      performance: {
        responseTime: duration,
        cached: result.cached || false
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Summary error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: "Unable to fetch summary data",
      error: error.message,
      responseTime: duration
    });
  }
});

/**
 * GET /api/dashboard/patrol-events
 * Get patrol events with schedule context
 */
router.get("/patrol-events", requireAuth, requireLinkedAccount, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { startDate, endDate, reportType = 'custom', forceWeekly = 'false' } = req.query;
    
    let dateRange;
    let finalReportType = reportType;
    let finalForceWeekly = forceWeekly === 'true';
    
    if (reportType && !startDate && !endDate) {
      dateRange = getDefaultDateRange(reportType);
      finalReportType = reportType;
    } else if (startDate && endDate) {
      if (!isValidDate(startDate) || !isValidDate(endDate)) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Use YYYY-MM-DD"
        });
      }
      dateRange = { startDate, endDate };
      finalReportType = 'custom';
    } else {
      // Default to today
      const today = new Date().toISOString().split('T')[0];
      dateRange = { startDate: today, endDate: today };
      finalReportType = 'daily';
    }
    
    console.log(`[Dashboard] Patrol events request for ${req.user.apiClientAccount}:`, {
      range: `${dateRange.startDate} to ${dateRange.endDate}`,
      reportType: finalReportType
    });
    
    const result = await dashboardService.getDashboardPatrolEvents({
      clientId: req.user.apiClientAccount,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      forceWeekly: finalForceWeekly,
      reportType: finalReportType
    });
    
    const duration = Date.now() - startTime;
    console.log(`[Dashboard] Patrol events response in ${duration}ms (${result.data?.length || 0} events)`);
    
    res.json({
      ...result,
      performance: {
        responseTime: duration,
        cached: result.cached || false
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Patrol events error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: "Unable to fetch patrol events",
      error: error.message,
      responseTime: duration
    });
  }
});

/**
 * GET /api/dashboard/schedule
 * Get client patrol schedule details
 */
router.get("/schedule", requireAuth, requireLinkedAccount, async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log(`[Dashboard] Schedule request for ${req.user.apiClientAccount}`);
    
    const result = await dashboardService.getClientPatrolSchedule(req.user.apiClientAccount);
    
    const duration = Date.now() - startTime;
    console.log(`[Dashboard] Schedule response in ${duration}ms`);
    
    res.json({
      ...result,
      performance: {
        responseTime: duration
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Schedule error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: "Unable to fetch patrol schedule",
      error: error.message,
      responseTime: duration
    });
  }
});

/**
 * GET /api/dashboard/compliance
 * Get patrol compliance analysis
 */
router.get("/compliance", requireAuth, requireLinkedAccount, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { startDate, endDate } = req.query;
    
    let dateRange;
    
    if (startDate && endDate) {
      if (!isValidDate(startDate) || !isValidDate(endDate)) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Use YYYY-MM-DD"
        });
      }
      dateRange = { startDate, endDate };
    } else {
      // Default to last 30 days
      dateRange = getDefaultDateRange('monthly');
    }
    
    console.log(`[Dashboard] Compliance request for ${req.user.apiClientAccount}:`, {
      range: `${dateRange.startDate} to ${dateRange.endDate}`
    });
    
    const result = await dashboardService.getPatrolCompliance(
      req.user.apiClientAccount,
      dateRange.startDate,
      dateRange.endDate
    );
    
    const duration = Date.now() - startTime;
    console.log(`[Dashboard] Compliance response in ${duration}ms`);
    
    res.json({
      ...result,
      performance: {
        responseTime: duration
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Compliance error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: "Unable to fetch compliance analysis",
      error: error.message,
      responseTime: duration
    });
  }
});

/**
 * GET /api/dashboard/pdf
 * Generate PDF report
 */
router.get("/pdf", requireAuth, requireLinkedAccount, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { startDate, endDate, reportType = 'custom' } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required"
      });
    }
    
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Use YYYY-MM-DD"
      });
    }
    
    console.log(`[Dashboard] PDF request for ${req.user.apiClientAccount}:`, {
      range: `${startDate} to ${endDate}`,
      reportType
    });
    
    const result = await dashboardService.generateDashboardPDF({
      clientId: req.user.apiClientAccount,
      clientName: req.user.companyName,
      startDate,
      endDate,
      reportType
    });
    
    const duration = Date.now() - startTime;
    console.log(`[Dashboard] PDF generated in ${duration}ms`);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Processing-Time', duration.toString());
    
    res.send(result.pdfBuffer);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] PDF error after ${duration}ms:`, error);
    
    res.status(500).json({
      success: false,
      message: "Failed to generate PDF",
      error: error.message,
      responseTime: duration
    });
  }
});

/**
 * PRESET REPORT ENDPOINTS
 * These provide convenience endpoints for common report types
 */

// Weekly report (last 7 days)
router.get("/weekly", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const result = await dashboardService.getWeeklySummary(req.user.apiClientAccount);
    res.json(result);
  } catch (error) {
    console.error("[Dashboard] Weekly report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch weekly report"
    });
  }
});

// Last 7 days report (same as weekly)
router.get("/last7", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const result = await dashboardService.getLast7DaysSummary(req.user.apiClientAccount);
    res.json(result);
  } catch (error) {
    console.error("[Dashboard] Last7 report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch last 7 days report"
    });
  }
});

// Last 30 days report
router.get("/last30", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const result = await dashboardService.getLast30DaysSummary(req.user.apiClientAccount);
    res.json(result);
  } catch (error) {
    console.error("[Dashboard] Last30 report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch last 30 days report"
    });
  }
});

// Monthly report (same as last30)
router.get("/monthly", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const result = await dashboardService.getMonthlySummary(req.user.apiClientAccount);
    res.json(result);
  } catch (error) {
    console.error("[Dashboard] Monthly report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch monthly report"
    });
  }
});

// Daily report (yesterday)
router.get("/daily", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const result = await dashboardService.getDailySummary(req.user.apiClientAccount);
    res.json(result);
  } catch (error) {
    console.error("[Dashboard] Daily report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch daily report"
    });
  }
});

// Custom range report
router.get("/custom", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required"
      });
    }
    
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Use YYYY-MM-DD"
      });
    }
    
    const result = await dashboardService.getCustomRangeSummary(
      req.user.apiClientAccount,
      startDate,
      endDate
    );
    
    res.json(result);
  } catch (error) {
    console.error("[Dashboard] Custom report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch custom report"
    });
  }
});

/**
 * GET /api/dashboard/account-info
 * Get account information
 */
router.get("/account-info", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    console.log(`[Dashboard] Account info request for ${req.user.apiClientAccount}`);
    
    const result = await bmSecurityAPI.getAccountByNumber(req.user.apiClientAccount);
    
    if (!result.success || !result.account) {
      return res.status(404).json({
        success: false,
        message: "Account information not found"
      });
    }
    
    // Get schedule info
    const schedule = await dashboardService.getClientPatrolSchedule(req.user.apiClientAccount);
    
    res.json({
      success: true,
      account: {
        accountNumber: result.accountUsed,
        name: result.account.cue_cnombre || result.account.cue_cempresa,
        email: result.account.cue_correo || result.account.cue_cemail,
        phone: result.account.cue_ctelefono,
        active: result.account.cue_lactivo,
        createdAt: result.account.cue_tcreacion
      },
      schedule: schedule.success ? schedule.schedule : null
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
 * Get user profile
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
        createdAt: client.createdAt,
        lastLogin: client.lastLogin
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
 * CACHE MANAGEMENT ENDPOINTS
 */

// Get cache statistics
router.get("/cache-stats", requireAuth, async (req, res) => {
  try {
    const stats = dashboardService.getCacheStats();
    
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

// Clear all caches (admin)
router.post("/clear-cache", requireAuth, async (req, res) => {
  try {
    const result = dashboardService.clearAllCaches();
    
    res.json({
      success: true,
      message: "All caches cleared successfully",
      cleared: result,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error("[Dashboard] Clear cache error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Warmup cache for better performance
router.post("/warmup", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const { reportType = 'weekly' } = req.body;
    
    console.log(`[Dashboard] Cache warmup for ${req.user.apiClientAccount} (${reportType})`);
    
    const result = await dashboardService.warmupCache(req.user.apiClientAccount, reportType);
    
    res.json({
      success: result.success,
      message: result.success 
        ? "Cache warmed up successfully" 
        : "Cache warmup failed",
      details: result
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
 * GET /api/dashboard/report-types
 * Get available report types and descriptions
 */
router.get("/report-types", requireAuth, async (req, res) => {
  try {
    const reportTypes = dashboardService.getAvailableReportTypes();
    
    res.json({
      success: true,
      reportTypes,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error("[Dashboard] Report types error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch report types"
    });
  }
});

/**
 * GET /api/dashboard/performance-tiers
 * Get performance tier definitions
 */
router.get("/performance-tiers", requireAuth, async (req, res) => {
  try {
    const tiers = dashboardService.PERFORMANCE_TIERS || {
      EXCELLENT: { min: 90, label: 'Excellent', color: 'green' },
      GOOD: { min: 80, label: 'Good', color: 'blue' },
      FAIR: { min: 70, label: 'Fair', color: 'yellow' },
      NEEDS_IMPROVEMENT: { min: 0, label: 'Needs Improvement', color: 'red' }
    };
    
    res.json({
      success: true,
      tiers,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error("[Dashboard] Performance tiers error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch performance tiers"
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
    service: "dashboard",
    version: "2.0.0",
    features: [
      "patrol_schedule_integration",
      "dynamic_patrol_calculation",
      "performance_analytics",
      "multi_layer_caching"
    ],
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

export default router;