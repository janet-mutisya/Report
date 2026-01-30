// server/routes/dashboard.js - FIXED WITH ASCII ENCODING SUPPORT & PATROL SCHEDULE INTEGRATION
const express = require("express");
const { requireAuth } = require("../middleware/requireAuth.js");
const { requireLinkedAccount } = require("../middleware/requireLinkedAccount.js");
const dashboardService = require("../service/dashboardReportService.js");
const clientStorage = require("../service/clientStorage.js");
const bmSecurityAPI = require("../service/bmSecurityAPI.js");

// 🔧 CRITICAL: ASCII ENCODING FIX - Apply only if needed
if (typeof global.TextDecoder === 'undefined' || !global.__ascii_encoding_fixed__) {
  console.log('[Dashboard] Applying ASCII encoding fix...');
  
  try {
    const { StringDecoder } = require('string_decoder');
    
    global.TextDecoder = class TextDecoder {
      constructor(encoding = 'utf-8') {
        const enc = String(encoding).toLowerCase().replace(/[-_\s]/g, '');
        const map = {
          'utf8': 'utf8', 'utf-8': 'utf8',
          'ascii': 'ascii', 'usascii': 'ascii', 'ansi': 'latin1',
          'latin1': 'latin1', 'iso88591': 'latin1', 'iso-8859-1': 'latin1',
          'binary': 'latin1', 'base64': 'base64', 'hex': 'hex',
          'ucs2': 'ucs2', 'ucs-2': 'ucs2', 'utf16le': 'utf16le', 'utf-16le': 'utf16le'
        };
        this.encoding = encoding;
        this.nodeEncoding = map[enc] || 'utf8';
        try {
          this.decoder = new StringDecoder(this.nodeEncoding);
        } catch (error) {
          this.decoder = new StringDecoder('utf8');
          this.nodeEncoding = 'utf8';
        }
      }
      
      decode(input, options = {}) {
        if (!input) return '';
        if (typeof input === 'string') return input;
        try {
          let buffer;
          if (Buffer.isBuffer(input)) {
            buffer = input;
          } else if (input instanceof ArrayBuffer) {
            buffer = Buffer.from(input);
          } else if (ArrayBuffer.isView(input)) {
            buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
          } else {
            buffer = Buffer.from(input);
          }
          
          if (options.stream) {
            return this.decoder.write(buffer);
          }
          
          return buffer.toString(this.nodeEncoding);
        } catch (error) {
          console.warn('[Dashboard] TextDecoder decode error:', error.message);
          return '';
        }
      }
    };
    
    global.TextEncoder = class TextEncoder {
      constructor() { 
        this.encoding = 'utf-8'; 
      }
      
      encode(input = '') { 
        return Buffer.from(String(input), 'utf8'); 
      }
      
      encodeInto(source, destination) {
        const buffer = this.encode(source);
        const length = Math.min(buffer.length, destination.length);
        for (let i = 0; i < length; i++) {
          destination[i] = buffer[i];
        }
        return { read: source.length, written: length };
      }
    };
    
    global.__ascii_encoding_fixed__ = true;
    console.log('[Dashboard] ASCII encoding fix applied successfully');
    
  } catch (error) {
    console.error('[Dashboard] Failed to apply ASCII encoding fix:', error);
    
    // Fallback minimal implementation
    global.TextDecoder = class TextDecoder {
      constructor(encoding = 'utf-8') {
        this.encoding = encoding;
      }
      
      decode(input) {
        if (!input) return '';
        if (typeof input === 'string') return input;
        try {
          let buffer;
          if (Buffer.isBuffer(input)) {
            buffer = input;
          } else if (input instanceof ArrayBuffer) {
            buffer = Buffer.from(input);
          } else if (ArrayBuffer.isView(input)) {
            buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
          } else {
            buffer = Buffer.from(input);
          }
          return buffer.toString('utf8');
        } catch (error) {
          return '';
        }
      }
    };
    
    global.TextEncoder = class TextEncoder {
      constructor() { this.encoding = 'utf-8'; }
      encode(input = '') { return Buffer.from(String(input), 'utf8'); }
    };
    
    global.__ascii_encoding_fixed__ = true;
    console.log('[Dashboard] Applied fallback ASCII fix');
  }
}

const router = express.Router();

// Helper to validate date format
function isValidDate(dateString) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;
  
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date) && date.toISOString().split('T')[0] === dateString;
}

// Helper to get default date ranges
function getDefaultDateRange(reportType = 'weekly') {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  
  switch (reportType.toLowerCase()) {
    case 'weekly':
    case 'last7':
      const weekAgo = new Date(today);
      weekAgo.setDate(today.getDate() - 6); // 7 days inclusive
      return {
        startDate: weekAgo.toISOString().split('T')[0],
        endDate: todayStr,
        days: 7,
        label: 'Last 7 Days'
      };
      
    case 'monthly':
    case 'last30':
      const monthAgo = new Date(today);
      monthAgo.setDate(today.getDate() - 29); // 30 days inclusive
      return {
        startDate: monthAgo.toISOString().split('T')[0],
        endDate: todayStr,
        days: 30,
        label: 'Last 30 Days'
      };
      
    case 'daily':
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      return {
        startDate: yesterday.toISOString().split('T')[0],
        endDate: yesterday.toISOString().split('T')[0],
        days: 1,
        label: 'Yesterday'
      };
      
    case 'today':
      return {
        startDate: todayStr,
        endDate: todayStr,
        days: 1,
        label: 'Today'
      };
      
    default:
      return {
        startDate: todayStr,
        endDate: todayStr,
        days: 1,
        label: 'Custom'
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
      timestamp: new Date(),
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  } catch (error) {
    console.error("[Dashboard] Status error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to check status",
      error: error.message
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
    const { startDate, endDate, reportType = 'weekly', forceWeekly = 'false' } = req.query;
    
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
        cached: result.cached || false,
        asciiFixed: !!global.__ascii_encoding_fixed__
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Summary error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: "Unable to fetch summary data",
      error: error.message,
      responseTime: duration,
      asciiFixed: !!global.__ascii_encoding_fixed__
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
    const { startDate, endDate, reportType = 'weekly', forceWeekly = 'false' } = req.query;
    
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
      // Default to last 7 days
      dateRange = getDefaultDateRange('weekly');
      finalReportType = 'weekly';
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
        cached: result.cached || false,
        asciiFixed: !!global.__ascii_encoding_fixed__
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Patrol events error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: "Unable to fetch patrol events",
      error: error.message,
      responseTime: duration,
      asciiFixed: !!global.__ascii_encoding_fixed__
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
        responseTime: duration,
        asciiFixed: !!global.__ascii_encoding_fixed__
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Schedule error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: "Unable to fetch patrol schedule",
      error: error.message,
      responseTime: duration,
      asciiFixed: !!global.__ascii_encoding_fixed__
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
        responseTime: duration,
        asciiFixed: !!global.__ascii_encoding_fixed__
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Compliance error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: "Unable to fetch compliance analysis",
      error: error.message,
      responseTime: duration,
      asciiFixed: !!global.__ascii_encoding_fixed__
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
    const { startDate, endDate, reportType = 'custom', title = 'Patrol Report' } = req.query;
    
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
      reportType,
      title
    });
    
    const result = await dashboardService.generateDashboardPDF({
      clientId: req.user.apiClientAccount,
      clientName: req.user.companyName,
      startDate,
      endDate,
      reportType,
      title
    });
    
    const duration = Date.now() - startTime;
    console.log(`[Dashboard] PDF generated in ${duration}ms`);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Processing-Time', duration.toString());
    res.setHeader('X-ASCII-Fixed', global.__ascii_encoding_fixed__ ? 'true' : 'false');
    
    res.send(result.pdfBuffer);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] PDF error after ${duration}ms:`, error);
    
    // Check if it's an ASCII encoding error
    if (error.message.includes('ASCII') || error.message.includes('encoding') || 
        error.message.includes('TextDecoder') || error.message.includes('font')) {
      console.error('[Dashboard] PDF ASCII encoding issue detected');
    }
    
    res.status(500).json({
      success: false,
      message: "Failed to generate PDF",
      error: error.message,
      responseTime: duration,
      asciiFixed: !!global.__ascii_encoding_fixed__,
      hint: error.message.includes('ASCII') ? 'ASCII encoding issue detected' : undefined
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
    res.json({
      ...result,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  } catch (error) {
    console.error("[Dashboard] Weekly report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch weekly report",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  }
});

// Last 7 days report (same as weekly)
router.get("/last7", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const result = await dashboardService.getLast7DaysSummary(req.user.apiClientAccount);
    res.json({
      ...result,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  } catch (error) {
    console.error("[Dashboard] Last7 report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch last 7 days report",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  }
});

// Last 30 days report
router.get("/last30", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const result = await dashboardService.getLast30DaysSummary(req.user.apiClientAccount);
    res.json({
      ...result,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  } catch (error) {
    console.error("[Dashboard] Last30 report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch last 30 days report",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  }
});

// Monthly report (same as last30)
router.get("/monthly", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const result = await dashboardService.getMonthlySummary(req.user.apiClientAccount);
    res.json({
      ...result,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  } catch (error) {
    console.error("[Dashboard] Monthly report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch monthly report",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  }
});

// Daily report (yesterday)
router.get("/daily", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const result = await dashboardService.getDailySummary(req.user.apiClientAccount);
    res.json({
      ...result,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  } catch (error) {
    console.error("[Dashboard] Daily report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch daily report",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  }
});

// Today's report
router.get("/today", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await dashboardService.getCustomRangeSummary(
      req.user.apiClientAccount,
      today,
      today
    );
    
    res.json({
      ...result,
      asciiFixed: !!global.__ascii_encoding_fixed__,
      date: today
    });
  } catch (error) {
    console.error("[Dashboard] Today report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch today's report",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
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
        message: "startDate and endDate are required",
        asciiFixed: !!global.__ascii_encoding_fixed__
      });
    }
    
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Use YYYY-MM-DD",
        asciiFixed: !!global.__ascii_encoding_fixed__
      });
    }
    
    const result = await dashboardService.getCustomRangeSummary(
      req.user.apiClientAccount,
      startDate,
      endDate
    );
    
    res.json({
      ...result,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  } catch (error) {
    console.error("[Dashboard] Custom report error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch custom report",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
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
        message: "Account information not found",
        asciiFixed: !!global.__ascii_encoding_fixed__
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
      schedule: schedule.success ? schedule.schedule : null,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
    
  } catch (error) {
    console.error("[Dashboard] Account info error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch account information",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  }
});

/**
 * GET /api/dashboard/user-profile
 * Get user profile
 */
router.get("/user-profile", requireAuth, async (req, res) => {
  try {
    const client = await clientStorage.getClientById(req.user.userId);
    
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        asciiFixed: !!global.__ascii_encoding_fixed__
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
      },
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
    
  } catch (error) {
    console.error("[Dashboard] User profile error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch user profile",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  }
});

/**
 * CACHE MANAGEMENT ENDPOINTS
 */

// Get cache statistics
router.get("/cache-stats", requireAuth, async (req, res) => {
  try {
    const stats = dashboardService.getCacheStats ? await dashboardService.getCacheStats() : { 
      message: 'Cache stats not available',
      asciiFixed: !!global.__ascii_encoding_fixed__
    };
    
    res.json({
      success: true,
      stats,
      timestamp: new Date(),
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
    
  } catch (error) {
    console.error("[Dashboard] Cache stats error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  }
});

// Clear all caches (admin)
router.post("/clear-cache", requireAuth, async (req, res) => {
  try {
    const result = dashboardService.clearAllCaches ? await dashboardService.clearAllCaches() : { 
      message: 'Cache clearing not available',
      cleared: false 
    };
    
    res.json({
      success: true,
      message: "All caches cleared successfully",
      cleared: result,
      timestamp: new Date(),
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
    
  } catch (error) {
    console.error("[Dashboard] Clear cache error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  }
});

// Warmup cache for better performance
router.post("/warmup", requireAuth, requireLinkedAccount, async (req, res) => {
  try {
    const { reportType = 'weekly' } = req.body;
    
    console.log(`[Dashboard] Cache warmup for ${req.user.apiClientAccount} (${reportType})`);
    
    const result = dashboardService.warmupCache ? await dashboardService.warmupCache(req.user.apiClientAccount, reportType) : { 
      success: false,
      message: 'Warmup not available' 
    };
    
    res.json({
      success: result.success,
      message: result.success 
        ? "Cache warmed up successfully" 
        : "Cache warmup failed",
      details: result,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
    
  } catch (error) {
    console.error("[Dashboard] Cache warmup error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to warmup cache",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  }
});

/**
 * GET /api/dashboard/report-types
 * Get available report types and descriptions
 */
router.get("/report-types", requireAuth, async (req, res) => {
  try {
    const reportTypes = dashboardService.getAvailableReportTypes ? await dashboardService.getAvailableReportTypes() : [
      { id: 'weekly', name: 'Weekly Report', description: 'Last 7 days of patrol data' },
      { id: 'monthly', name: 'Monthly Report', description: 'Last 30 days of patrol data' },
      { id: 'daily', name: 'Daily Report', description: 'Yesterday\'s patrol data' },
      { id: 'custom', name: 'Custom Report', description: 'Select specific date range' }
    ];
    
    res.json({
      success: true,
      reportTypes,
      timestamp: new Date(),
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
    
  } catch (error) {
    console.error("[Dashboard] Report types error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch report types",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
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
      EXCELLENT: { min: 90, label: 'Excellent', color: 'green', description: 'Outstanding performance' },
      GOOD: { min: 80, label: 'Good', color: 'blue', description: 'Good performance' },
      FAIR: { min: 70, label: 'Fair', color: 'yellow', description: 'Average performance' },
      NEEDS_IMPROVEMENT: { min: 0, label: 'Needs Improvement', color: 'red', description: 'Below expectations' }
    };
    
    res.json({
      success: true,
      tiers,
      timestamp: new Date(),
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
    
  } catch (error) {
    console.error("[Dashboard] Performance tiers error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch performance tiers",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  }
});

/**
 * GET /api/dashboard/system-info
 * Get system information including ASCII fix status
 */
router.get("/system-info", requireAuth, async (req, res) => {
  try {
    res.json({
      success: true,
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        memory: process.memoryUsage(),
        uptime: process.uptime()
      },
      encoding: {
        asciiFixed: !!global.__ascii_encoding_fixed__,
        textDecoder: typeof global.TextDecoder !== 'undefined',
        textEncoder: typeof global.TextEncoder !== 'undefined',
        pdfkitPatched: !!global.__pdfkit_patched__
      },
      timestamp: new Date()
    });
  } catch (error) {
    console.error("[Dashboard] System info error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to fetch system information",
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
    service: "dashboard",
    version: "3.0.0",
    features: [
      "patrol_schedule_integration",
      "dynamic_patrol_calculation",
      "performance_analytics",
      "multi_layer_caching",
      "ascii_encoding_fix"
    ],
    timestamp: new Date(),
    uptime: process.uptime(),
    encoding: {
      asciiFixed: !!global.__ascii_encoding_fixed__,
      pdfkitPatched: !!global.__pdfkit_patched__
    }
  });
});

/**
 * GET /api/dashboard/test-ascii
 * Test ASCII encoding functionality
 */
router.get("/test-ascii", requireAuth, (req, res) => {
  try {
    // Test TextDecoder
    const decoder = new TextDecoder('ascii');
    const encoder = new TextEncoder();
    
    const testString = "Guard Report Dashboard - ASCII Test: 123!@#";
    const encoded = encoder.encode(testString);
    const decoded = decoder.decode(encoded);
    
    const success = decoded === testString;
    
    res.json({
      success: true,
      test: {
        textDecoder: typeof global.TextDecoder !== 'undefined',
        textEncoder: typeof global.TextEncoder !== 'undefined',
        asciiFixed: !!global.__ascii_encoding_fixed__,
        encodingTest: success,
        original: testString,
        decoded: decoded,
        match: success
      },
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error("[Dashboard] ASCII test error:", error);
    res.status(500).json({
      success: false,
      message: "ASCII encoding test failed",
      error: error.message,
      asciiFixed: !!global.__ascii_encoding_fixed__
    });
  }
});

module.exports = router;