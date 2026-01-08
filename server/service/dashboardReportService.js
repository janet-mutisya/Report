// server/service/dashboardReportService.js - FLEXIBLE DATE RANGE SUPPORT
import { fetchWeeklyReport } from '../models/reportModel.js'; 
import { sql, poolPromise } from "../config/database.js";
import pdfService from './pdfService.js';

// Configuration
const WEEKLY_DEFAULT_DAYS = 7;      // For weekly reports only
const MONTHLY_DEFAULT_DAYS = 30;    // For monthly reports
const DEFAULT_SHIFT_START_HOUR = 18;
const DEFAULT_SHIFT_END_HOUR = 6;

// ✅ MULTI-LAYER CACHE SYSTEM
const accountCache = new Map();
const reportCache = new Map();
const ACCOUNT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const REPORT_CACHE_TTL = 2 * 60 * 1000;  // 2 minutes

// Report type constants
const REPORT_TYPES = {
  WEEKLY: 'weekly',
  CUSTOM: 'custom',
  DAILY: 'daily',
  MONTHLY: 'monthly',
  LAST30: 'last30',
  LAST7: 'last7'
};

/**
 * ✅ Helper: Adjust date range based on report type and forceWeekly flag
 * Only enforces 7 days when forceWeekly = true
 */
function adjustDateRange(startDate, endDate, forceWeekly = false, reportType = REPORT_TYPES.CUSTOM) {
  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Calculate days difference
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    console.log(`[Dashboard] 📅 Date range: ${startDate} to ${endDate} = ${diffDays} days (type: ${reportType}, forceWeekly: ${forceWeekly})`);
    
    // Only enforce 7 days when explicitly requested
    if (forceWeekly && diffDays !== WEEKLY_DEFAULT_DAYS) {
      console.log(`[Dashboard] ⚠️ ENFORCING WEEKLY: Adjusting to ${WEEKLY_DEFAULT_DAYS}-day range`);
      
      // Keep the end date, adjust start date to be 6 days before
      const adjustedStart = new Date(end);
      adjustedStart.setDate(adjustedStart.getDate() - (WEEKLY_DEFAULT_DAYS - 1));
      
      const formattedStart = adjustedStart.toISOString().split('T')[0];
      const formattedEnd = end.toISOString().split('T')[0];
      
      console.log(`[Dashboard] 📅 Adjusted to: ${formattedStart} to ${formattedEnd}`);
      
      return { 
        adjustedStartDate: formattedStart, 
        adjustedEndDate: formattedEnd,
        wasAdjusted: true,
        originalDays: diffDays,
        reason: 'weekly_enforcement'
      };
    }
    
    // For monthly/last30 reports, ensure we have at least the right number of days
    if (reportType === REPORT_TYPES.MONTHLY || reportType === REPORT_TYPES.LAST30) {
      const targetDays = MONTHLY_DEFAULT_DAYS;
      if (diffDays !== targetDays) {
        console.log(`[Dashboard] 📅 ${reportType.toUpperCase()}: Adjusting to ${targetDays}-day range`);
        
        const adjustedStart = new Date(end);
        adjustedStart.setDate(adjustedStart.getDate() - (targetDays - 1));
        
        const formattedStart = adjustedStart.toISOString().split('T')[0];
        const formattedEnd = end.toISOString().split('T')[0];
        
        return { 
          adjustedStartDate: formattedStart, 
          adjustedEndDate: formattedEnd,
          wasAdjusted: true,
          originalDays: diffDays,
          reason: `${reportType}_adjustment`
        };
      }
    }
    
    // For daily reports, ensure single day
    if (reportType === REPORT_TYPES.DAILY && diffDays !== 1) {
      console.log(`[Dashboard] 📅 DAILY: Adjusting to single day`);
      
      return { 
        adjustedStartDate: endDate, 
        adjustedEndDate: endDate,
        wasAdjusted: true,
        originalDays: diffDays,
        reason: 'daily_adjustment'
      };
    }
    
    // No adjustment needed
    return { 
      adjustedStartDate: startDate, 
      adjustedEndDate: endDate,
      wasAdjusted: false,
      originalDays: diffDays,
      reason: 'no_adjustment'
    };
  } catch (error) {
    console.error('[Dashboard] ❌ Error adjusting date range:', error);
    return { 
      adjustedStartDate: startDate, 
      adjustedEndDate: endDate,
      wasAdjusted: false,
      originalDays: 0,
      reason: 'error'
    };
  }
}

/**
 * ✅ Generate date range for common report types
 */
function generateDateRangeForReportType(reportType, endDate = null) {
  const now = endDate ? new Date(endDate) : new Date();
  const today = new Date(now.setHours(0, 0, 0, 0));
  
  switch(reportType.toLowerCase()) {
    case REPORT_TYPES.LAST7:
    case REPORT_TYPES.WEEKLY:
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - 6); // 7 days inclusive
      return {
        startDate: weekStart.toISOString().split('T')[0],
        endDate: today.toISOString().split('T')[0],
        days: 7
      };
      
    case REPORT_TYPES.LAST30:
    case REPORT_TYPES.MONTHLY:
      const monthStart = new Date(today);
      monthStart.setDate(today.getDate() - 29); // 30 days inclusive
      return {
        startDate: monthStart.toISOString().split('T')[0],
        endDate: today.toISOString().split('T')[0],
        days: 30
      };
      
    case REPORT_TYPES.DAILY:
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      return {
        startDate: yesterday.toISOString().split('T')[0],
        endDate: yesterday.toISOString().split('T')[0],
        days: 1
      };
      
    default:
      // For custom, just use today as default
      return {
        startDate: today.toISOString().split('T')[0],
        endDate: today.toISOString().split('T')[0],
        days: 1
      };
  }
}

/**
 * ✅ OPTIMIZED: Resolve account number with aggressive caching
 */
async function resolveClientId(accountNumber) {
  const cacheKey = String(accountNumber).trim().toUpperCase();
  
  const cached = accountCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ACCOUNT_CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const pool = await poolPromise;
    const cleanAccount = cacheKey;
    const numericPart = cleanAccount.startsWith('A') ? cleanAccount.substring(1) : null;
    
    const result = await pool.request()
      .input('accountNumber', sql.NVarChar, cleanAccount)
      .input('numericPart', sql.NVarChar, numericPart)
      .query(`
        SELECT TOP 1 cue_iid, cue_ncuenta, cue_cnombre
        FROM [_Datos].[dbo].[m_cuentas]
        WHERE cue_ncuenta = @accountNumber
           OR (ISNULL(@numericPart, '') != '' AND cue_ncuenta = @numericPart)
      `);
    
    if (result.recordset.length > 0) {
      const data = {
        success: true,
        clientId: result.recordset[0].cue_iid,
        accountNumber: result.recordset[0].cue_ncuenta,
        clientName: result.recordset[0].cue_cnombre
      };
      
      accountCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    }
    
    const error = { success: false, error: `Account ${accountNumber} not found` };
    accountCache.set(cacheKey, { data: error, timestamp: Date.now() - ACCOUNT_CACHE_TTL + 30000 });
    return error;
    
  } catch (error) {
    console.error('[Dashboard] Account resolution error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * ✅ ULTRA-FAST: Generate report cache key
 */
function generateCacheKey(clientId, startDate, endDate, reportType = REPORT_TYPES.CUSTOM) {
  return `report_${clientId}_${reportType}_${startDate}_${endDate}`;
}

/**
 * ✅ OPTIMIZED: Get cached report or fetch new
 */
async function getCachedOrFetchReport(clientId, startDate, endDate, reportType = REPORT_TYPES.CUSTOM) {
  const cacheKey = generateCacheKey(clientId, startDate, endDate, reportType);
  
  // Check cache first
  const cached = reportCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < REPORT_CACHE_TTL) {
    console.log(`[Dashboard] 🎯 CACHE HIT for ${cacheKey}`);
    return { ...cached.data, fromCache: true };
  }
  
  // Fetch fresh data
  console.log(`[Dashboard] 📥 CACHE MISS - Fetching fresh data for ${cacheKey}`);
  
  try {
    // Use the flexible model with report type
    const reportData = await fetchWeeklyReport(clientId, startDate, endDate, true);
    
    // Enrich with report type
    reportData.metadata.reportType = reportType;
    
    // Cache the result
    reportCache.set(cacheKey, {
      data: reportData,
      timestamp: Date.now()
    });
    
    return { ...reportData, fromCache: false };
  } catch (error) {
    console.error(`[Dashboard] ❌ Report fetch failed for ${cacheKey}:`, error.message);
    
    // Return error structure
    return {
      posts: [],
      events: [],
      guardReports: [],
      metadata: {
        success: false,
        error: error.message,
        clientId: parseInt(clientId) || 0,
        startDate: startDate,
        endDate: endDate,
        calendarDays: 0,
        reportType: reportType,
        dataQuality: { isValid: false },
        generatedAt: new Date()
      },
      fromCache: false
    };
  }
}

/**
 * ✅ ULTRA-FAST: Batch normalize events (single pass)
 */
function normalizeDashboardEvents(events = []) {
  if (!Array.isArray(events) || events.length === 0) return [];
  
  return events.map(event => ({
    date: event.Date || event.date || '-',
    time: event.Time || event.time || '-',
    event: event.Event || event.event || 'VigiControl Arrival',
    zone: event.Zone || event.zone || 'Unknown Zone',
    code: event.AlarmCode || event.code || '-',
    rawDate: event.Date ? new Date(event.Date) : null
  }));
}

/**
 * ✅ ULTRA-FAST: Generate summary with pre-calculated values
 */
function generateDashboardSummary(reportData, accountNumber, reportType = REPORT_TYPES.CUSTOM, dateAdjustment = {}) {
  const { posts = [], metadata = {}, events = [] } = reportData;
  
  const totalEvents = events.length;
  const totalPosts = posts.length;
  const performanceScore = metadata.overallPerformance || 0;
  const expectedPatrols = metadata.totalExpectedPatrols || 0;
  const completedPatrols = metadata.totalCompleted || 0;
  const daysCovered = metadata.calendarDays || 1;
  
  // Single-pass unique zone calculation
  const uniqueZones = new Set();
  events.forEach(event => {
    const zone = event.zone || event.Zone;
    if (zone && zone !== 'Unknown Zone') uniqueZones.add(zone);
  });
  
  const avgPerDay = totalEvents > 0 ? Math.round(totalEvents / daysCovered) : 0;
  
  let performanceTier = 'Needs Improvement';
  if (performanceScore >= 90) performanceTier = 'Excellent';
  else if (performanceScore >= 80) performanceTier = 'Good';
  else if (performanceScore >= 70) performanceTier = 'Fair';
  
  return {
    summary: {
      totalEvents,
      totalPosts,
      performanceScore: Math.round(performanceScore),
      performanceTier,
      expectedPatrols,
      completedPatrols,
      zoneCoverage: uniqueZones.size,
      avgPerDay,
      daysCovered,
      dataSource: metadata.dataSource || 'Unknown',
      startDate: metadata.startDate || '-',
      endDate: metadata.endDate || '-',
      generatedAt: metadata.generatedAt || new Date(),
      dateAdjusted: dateAdjustment.wasAdjusted || false,
      originalDateRange: dateAdjustment.originalDays && dateAdjustment.originalDays !== daysCovered 
        ? `${dateAdjustment.originalStart || metadata.startDate} to ${dateAdjustment.originalEnd || metadata.endDate}` 
        : null,
      reportType: reportType
    },
    metadata: {
      clientId: metadata.clientId,
      clientName: metadata.clientName || 'Unknown',
      accountNumber: metadata.clientAccountNumber || accountNumber,
      patrolsPerDay: metadata.patrolsPerDay || 11,
      timezone: metadata.timezone || 'Africa/Nairobi',
      usingAPI: metadata.usingAPI || false,
      dataQuality: metadata.dataQuality || { isValid: false },
      reportType: reportType,
      patrolWindow: `${DEFAULT_SHIFT_START_HOUR}:00 - ${DEFAULT_SHIFT_END_HOUR}:00 next day`
    },
    posts: posts.map(post => ({
      name: post.SecurityPost,
      zoneCode: post.ZoneCode,
      completed: post.Completed,
      expected: post.Expected,
      performance: post.Performance,
      percentage: post.Percentage
    })),
    quickStats: [
      {
        title: 'Completion Rate',
        value: `${Math.round(performanceScore)}%`,
        description: `${completedPatrols}/${expectedPatrols} patrols`,
        icon: 'check-circle',
        color: performanceScore >= 80 ? 'green' : performanceScore >= 70 ? 'yellow' : 'red'
      },
      {
        title: 'Active Zones',
        value: uniqueZones.size,
        description: `of ${totalPosts} total zones`,
        icon: 'map-pin',
        color: 'blue'
      },
      {
        title: 'Daily Average',
        value: avgPerDay,
        description: `over ${daysCovered} days`,
        icon: 'calendar',
        color: 'purple'
      },
      {
        title: 'Days Covered',
        value: daysCovered,
        description: reportType === REPORT_TYPES.CUSTOM ? 'Custom range' : `${reportType} report`,
        icon: 'clock',
        color: 'indigo'
      }
    ]
  };
}

/**
 * ✅ FLEXIBLE: Get dashboard patrol events
 */
export const getDashboardPatrolEvents = async ({ 
  clientId, 
  startDate, 
  endDate, 
  forceWeekly = false,
  reportType = REPORT_TYPES.CUSTOM 
}) => {
  const startTime = Date.now();
  
  try {
    console.log(`[Dashboard] Fetching patrol events for ${clientId}: ${startDate} to ${endDate} (type: ${reportType}, forceWeekly: ${forceWeekly})`);
    
    // Adjust date range only if forceWeekly is true
    const dateAdjustment = adjustDateRange(startDate, endDate, forceWeekly, reportType);
    const { adjustedStartDate, adjustedEndDate, wasAdjusted } = dateAdjustment;
    
    if (wasAdjusted) {
      console.log(`[Dashboard] ⚠️ Date range adjusted: ${startDate}-${endDate} → ${adjustedStartDate}-${adjustedEndDate}`);
    }
    
    // Resolve account (uses cache)
    const resolution = await resolveClientId(clientId);
    if (!resolution.success) {
      throw new Error(resolution.error || 'Failed to resolve account');
    }
    
    const numericClientId = resolution.clientId;
    
    // Get cached or fresh report
    const reportData = await getCachedOrFetchReport(numericClientId, adjustedStartDate, adjustedEndDate, reportType);
    
    if (!reportData.metadata.success) {
      throw new Error(reportData.metadata.error?.message || 'Failed to generate report');
    }
    
    // Normalize events once
    const events = normalizeDashboardEvents(reportData.events || []);
    
    const duration = Date.now() - startTime;
    console.log(`[Dashboard] ✅ Patrol events fetched in ${duration}ms (${events.length} events)${reportData.fromCache ? ' [CACHED]' : ' [FRESH]'}`);
    
    return {
      success: true,
      data: events,
      metadata: {
        clientId: numericClientId,
        clientName: reportData.metadata.clientName,
        accountNumber: reportData.metadata.clientAccountNumber,
        startDate: reportData.metadata.startDate,
        endDate: reportData.metadata.endDate,
        calendarDays: reportData.metadata.calendarDays,
        totalEvents: events.length,
        generatedAt: new Date(),
        dataSource: reportData.metadata.dataSource,
        dataQuality: reportData.metadata.dataQuality,
        processingTime: duration,
        cached: reportData.fromCache,
        dateAdjusted: wasAdjusted,
        originalRequest: wasAdjusted ? `${startDate} to ${endDate}` : null,
        forceWeekly: forceWeekly,
        reportType: reportType,
        shiftWindow: `${DEFAULT_SHIFT_START_HOUR}:00 - ${DEFAULT_SHIFT_END_HOUR}:00 next day`
      },
      dataSource: reportData.metadata.dataSource
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] ❌ Patrol events error after ${duration}ms:`, error);
    return {
      success: false,
      message: error.message || 'Failed to fetch patrol events',
      data: [],
      metadata: null
    };
  }
};

/**
 * ✅ FLEXIBLE: Get dashboard summary
 */
export const getDashboardSummary = async ({ 
  clientId, 
  startDate, 
  endDate, 
  forceWeekly = false,
  reportType = REPORT_TYPES.CUSTOM 
}) => {
  const startTime = Date.now();
  
  try {
    console.log(`[Dashboard] Fetching summary for ${clientId}: ${startDate} to ${endDate} (type: ${reportType}, forceWeekly: ${forceWeekly})`);
    
    // Adjust date range based on forceWeekly flag
    const dateAdjustment = adjustDateRange(startDate, endDate, forceWeekly, reportType);
    const { adjustedStartDate, adjustedEndDate, wasAdjusted, originalDays } = dateAdjustment;
    
    if (wasAdjusted) {
      console.log(`[Dashboard] ⚠️ Date range adjusted: ${originalDays} → ${adjustedStartDate} to ${adjustedEndDate}`);
    }
    
    // Resolve account (uses cache)
    const resolution = await resolveClientId(clientId);
    if (!resolution.success) {
      throw new Error(resolution.error || 'Failed to resolve account');
    }
    
    const numericClientId = resolution.clientId;
    
    // Get cached or fresh report
    const reportData = await getCachedOrFetchReport(numericClientId, adjustedStartDate, adjustedEndDate, reportType);
    
    if (!reportData.metadata.success) {
      throw new Error(reportData.metadata.error?.message || 'Failed to generate report');
    }
    
    // Generate summary
    const dashboardSummary = generateDashboardSummary(
      reportData, 
      clientId, 
      reportType,
      {
        wasAdjusted,
        originalDays,
        originalStart: startDate,
        originalEnd: endDate,
        adjustedStart: adjustedStartDate,
        adjustedEnd: adjustedEndDate
      }
    );
    
    const duration = Date.now() - startTime;
    console.log(`[Dashboard] ✅ Summary generated in ${duration}ms${reportData.fromCache ? ' [CACHED]' : ' [FRESH]'}`);
    
    return {
      success: true,
      data: {
        summary: dashboardSummary.summary,
        metadata: dashboardSummary.metadata,
        posts: dashboardSummary.posts,
        quickStats: dashboardSummary.quickStats
      },
      events: reportData.events || [],
      guardReports: reportData.guardReports || [],
      dataSource: reportData.metadata.dataSource,
      processingTime: duration,
      cached: reportData.fromCache,
      dateAdjusted: wasAdjusted,
      reportType: reportType
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] ❌ Summary error after ${duration}ms:`, error);
    return {
      success: false,
      message: error.message || 'Failed to fetch dashboard summary',
      data: {
        summary: {
          totalEvents: 0,
          totalPosts: 0,
          performanceScore: 0,
          performanceTier: 'Unknown',
          expectedPatrols: 0,
          completedPatrols: 0,
          zoneCoverage: 0,
          avgPerDay: 0,
          daysCovered: 0,
          dataSource: 'Error',
          startDate,
          endDate,
          generatedAt: new Date(),
          reportType: reportType
        },
        metadata: {
          clientId: null,
          clientName: 'Error',
          accountNumber: clientId,
          patrolsPerDay: 11,
          timezone: 'Africa/Nairobi',
          usingAPI: false,
          dataQuality: { isValid: false },
          reportType: reportType
        },
        posts: [],
        quickStats: []
      },
      events: [],
      guardReports: [],
      dataSource: 'ERROR'
    };
  }
};

/**
 * ✅ FLEXIBLE: Generate PDF report
 */
export const generateDashboardPDF = async ({ 
  clientId, 
  startDate, 
  endDate, 
  clientName,
  forceWeekly = false,
  reportType = REPORT_TYPES.CUSTOM 
}) => {
  const startTime = Date.now();
  
  try {
    console.log(`[Dashboard] Generating PDF for ${clientId}: ${startDate} to ${endDate} (type: ${reportType}, forceWeekly: ${forceWeekly})`);
    
    // Adjust date range based on forceWeekly flag
    const dateAdjustment = adjustDateRange(startDate, endDate, forceWeekly, reportType);
    const { adjustedStartDate, adjustedEndDate, wasAdjusted } = dateAdjustment;
    
    if (wasAdjusted) {
      console.log(`[Dashboard] ⚠️ PDF: Date range adjusted from ${startDate}-${endDate} to ${adjustedStartDate}-${adjustedEndDate}`);
    }
    
    // Resolve account
    const resolution = await resolveClientId(clientId);
    if (!resolution.success) {
      throw new Error(resolution.error || 'Failed to resolve account');
    }
    
    const numericClientId = resolution.clientId;
    const resolvedClientName = clientName || resolution.clientName;
    
    // Build client data for PDF service
    const pdfData = {
      clientId: numericClientId,
      clientName: resolvedClientName,
      startDate: adjustedStartDate,
      endDate: adjustedEndDate,
      dateAdjusted: wasAdjusted,
      originalRequest: wasAdjusted ? `${startDate} to ${endDate}` : null,
      reportType: reportType,
      forceWeekly: forceWeekly
    };
    
    // Generate PDF
    const pdfBuffer = await pdfService.generateDashboardPDF(pdfData);
    
    const duration = Date.now() - startTime;
    console.log(`[Dashboard] ✅ PDF generated in ${duration}ms`);
    
    return {
      success: true,
      pdfBuffer,
      filename: `${resolvedClientName.replace(/[^a-z0-9]/gi, '_')}_${reportType}_${adjustedStartDate}_to_${adjustedEndDate}.pdf`,
      metadata: {
        clientId: numericClientId,
        clientName: resolvedClientName,
        startDate: adjustedStartDate,
        endDate: adjustedEndDate,
        generatedAt: new Date(),
        processingTime: duration,
        dateAdjusted: wasAdjusted,
        reportType: reportType
      }
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] ❌ PDF generation error after ${duration}ms:`, error);
    throw error;
  }
};

/**
 * Get last 7 days summary - ENFORCES 7 DAYS
 */
export const getWeeklySummary = async (clientId) => {
  const dateRange = generateDateRangeForReportType(REPORT_TYPES.WEEKLY);
  
  return await getDashboardSummary({
    clientId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    forceWeekly: true, // ✅ Enforce 7 days
    reportType: REPORT_TYPES.WEEKLY
  });
};

/**
 * Get last 30 days summary - FLEXIBLE: No enforcement
 */
export const getLast30DaysSummary = async (clientId) => {
  const dateRange = generateDateRangeForReportType(REPORT_TYPES.LAST30);
  
  return await getDashboardSummary({
    clientId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    forceWeekly: false, // ✅ Allow 30 days
    reportType: REPORT_TYPES.LAST30
  });
};

/**
 * Get last 7 days summary (same as weekly but with different name)
 */
export const getLast7DaysSummary = async (clientId) => {
  return await getWeeklySummary(clientId);
};

/**
 * Get daily summary (yesterday)
 */
export const getDailySummary = async (clientId) => {
  const dateRange = generateDateRangeForReportType(REPORT_TYPES.DAILY);
  
  return await getDashboardSummary({
    clientId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    forceWeekly: false,
    reportType: REPORT_TYPES.DAILY
  });
};

/**
 * Get custom range summary - FLEXIBLE: No enforcement
 */
export const getCustomRangeSummary = async (clientId, startDate, endDate) => {
  return await getDashboardSummary({
    clientId,
    startDate,
    endDate,
    forceWeekly: false, // ✅ Allow any range
    reportType: REPORT_TYPES.CUSTOM
  });
};

/**
 * Get monthly summary - Now correctly returns 30 days
 */
export const getMonthlySummary = async (clientId) => {
  return await getLast30DaysSummary(clientId);
};

/**
 * ✅ NEW: Clear all caches
 */
export const clearAllCaches = () => {
  const accountSize = accountCache.size;
  const reportSize = reportCache.size;
  
  accountCache.clear();
  reportCache.clear();
  
  console.log(`[Dashboard] Cleared ${accountSize} account cache entries and ${reportSize} report cache entries`);
  
  return {
    accountsCleared: accountSize,
    reportsCleared: reportSize,
    totalCleared: accountSize + reportSize
  };
};

/**
 * ✅ NEW: Get cache statistics
 */
export const getCacheStats = () => {
  const now = Date.now();
  
  const accountStats = Array.from(accountCache.entries()).map(([key, value]) => ({
    account: key,
    age: now - value.timestamp,
    success: value.data.success
  }));
  
  const reportStats = Array.from(reportCache.entries()).map(([key, value]) => ({
    key,
    age: now - value.timestamp,
    eventsCount: value.data.events?.length || 0,
    postsCount: value.data.posts?.length || 0,
    reportType: value.data.metadata?.reportType || 'unknown'
  }));
  
  const activeReports = reportStats.filter(r => r.age < REPORT_CACHE_TTL);
  const expiredReports = reportStats.filter(r => r.age >= REPORT_CACHE_TTL);
  
  return {
    accounts: {
      size: accountCache.size,
      active: accountStats.filter(a => a.age < ACCOUNT_CACHE_TTL).length,
      expired: accountStats.filter(a => a.age >= ACCOUNT_CACHE_TTL).length
    },
    reports: {
      size: reportCache.size,
      active: activeReports.length,
      expired: expiredReports.length,
      byType: activeReports.reduce((acc, curr) => {
        const type = curr.reportType;
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {})
    },
    cacheHitRate: activeReports.length / Math.max(reportStats.length, 1)
  };
};

/**
 * ✅ UPDATED: Warmup cache for faster initial load
 */
export const warmupCache = async (clientId, reportType = REPORT_TYPES.WEEKLY) => {
  try {
    console.log(`[Dashboard] Warming up cache for ${clientId} (${reportType})...`);
    
    const dateRange = generateDateRangeForReportType(reportType);
    
    let forceWeekly = false;
    if (reportType === REPORT_TYPES.WEEKLY || reportType === REPORT_TYPES.LAST7) {
      forceWeekly = true; // ✅ Only enforce for weekly reports
    }
    
    console.log(`[Dashboard] Warmup range: ${dateRange.startDate} to ${dateRange.endDate} (${dateRange.days} days)`);
    
    await getDashboardSummary({
      clientId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      forceWeekly: forceWeekly,
      reportType: reportType
    });
    
    console.log(`[Dashboard] ✅ Cache warmed up for ${clientId} (${reportType})`);
    
    return { 
      success: true, 
      range: `${dateRange.startDate} to ${dateRange.endDate}`, 
      days: dateRange.days,
      reportType: reportType,
      forceWeekly: forceWeekly 
    };
  } catch (error) {
    console.error(`[Dashboard] ❌ Cache warmup failed:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * ✅ NEW: Get available report types
 */
export const getAvailableReportTypes = () => {
  return {
    reportTypes: REPORT_TYPES,
    defaults: {
      weekly: WEEKLY_DEFAULT_DAYS,
      monthly: MONTHLY_DEFAULT_DAYS,
      shiftWindow: `${DEFAULT_SHIFT_START_HOUR}:00 - ${DEFAULT_SHIFT_END_HOUR}:00 next day`
    },
    descriptions: {
      [REPORT_TYPES.WEEKLY]: `Last ${WEEKLY_DEFAULT_DAYS} days (enforced)`,
      [REPORT_TYPES.LAST7]: `Last ${WEEKLY_DEFAULT_DAYS} days`,
      [REPORT_TYPES.LAST30]: `Last ${MONTHLY_DEFAULT_DAYS} days`,
      [REPORT_TYPES.MONTHLY]: `Last ${MONTHLY_DEFAULT_DAYS} days`,
      [REPORT_TYPES.DAILY]: 'Yesterday',
      [REPORT_TYPES.CUSTOM]: 'Custom date range'
    }
  };
};

export default {
  // Main flexible functions
  getDashboardPatrolEvents,
  getDashboardSummary,
  
  // Preset report functions
  getWeeklySummary,
  getLast30DaysSummary,
  getLast7DaysSummary,
  getDailySummary,
  getCustomRangeSummary,
  getMonthlySummary,
  
  // PDF generation
  generateDashboardPDF,
  
  // Account resolution
  resolveClientId,
  
  // Cache management
  clearAllCaches,
  getCacheStats,
  warmupCache,
  
  // Metadata
  getAvailableReportTypes,
  REPORT_TYPES
};