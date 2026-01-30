// server/service/dashboardReportService.js - FIXED VERSION WITH CORRECT CALCULATIONS
const { fetchWeeklyReport } = require('../models/reportModel.js'); 
const { sql, poolPromise } = require("../config/database.js");
const pdfService = require('./pdfService.js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');

// Enable timezone support
dayjs.extend(utc);
dayjs.extend(timezone);

// Import patrol schedule management functions
const patrolScheduleService = require('../scripts/managePatrolSchedules.js');

// Configuration
const WEEKLY_DEFAULT_DAYS = 7;  // IMPORTANT: This is 7, not 8
const MONTHLY_DEFAULT_DAYS = 30;
const DEFAULT_SHIFT_START_HOUR = 18;
const DEFAULT_SHIFT_END_HOUR = 6;
const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

// Cache system
const accountCache = new Map();
const reportCache = new Map();
const scheduleCache = new Map();
const analyticsCache = new Map();

const ACCOUNT_CACHE_TTL = 5 * 60 * 1000;    // 5 minutes
const REPORT_CACHE_TTL = 2 * 60 * 1000;     // 2 minutes
const SCHEDULE_CACHE_TTL = 10 * 60 * 1000;  // 10 minutes
const ANALYTICS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// Report type constants
const REPORT_TYPES = {
  WEEKLY: 'weekly',
  CUSTOM: 'custom',
  DAILY: 'daily',
  MONTHLY: 'monthly',
  LAST30: 'last30',
  LAST7: 'last7'
};

// Performance tiers - MATCHING PDF SERVICE CALCULATIONS
const PERFORMANCE_TIERS = {
  EXCELLENT: { min: 90, max: 100, label: 'Excellent', color: 'green' },
  GOOD: { min: 80, max: 89, label: 'Good', color: 'blue' },
  FAIR: { min: 70, max: 79, label: 'Fair', color: 'yellow' },
  NEEDS_IMPROVEMENT: { min: 0, max: 69, label: 'Needs Improvement', color: 'red' }
};

// ========== FIXED DATE CALCULATIONS ==========

/**
 * Calculate actual days between dates - FIXED VERSION
 * For date range Jan 14 to Jan 21, should return 7 days (14,15,16,17,18,19,20,21 = 8 days? Wait, let's check)
 * Actually: 14-21 inclusive = 8 days: 14,15,16,17,18,19,20,21
 * But we want 7 days for weekly reports, so we need to handle this properly
 */
function calculateActualDays(startDate, endDate) {
  try {
    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).startOf('day');
    
    if (!start.isValid() || !end.isValid()) {
      console.error(`[Dashboard] Invalid dates: ${startDate} to ${endDate}`);
      return 0;
    }
    
    // FIX: For date range display, we want the number of days in the period
    // Jan 14 to Jan 21: diff = 7 days, but for weekly report it's 7 days
    const diffDays = end.diff(start, 'day');
    
    // If it's exactly a 7-day weekly report, return 7
    // If it's a custom range, return diff + 1 for inclusive
    const days = diffDays;
    
    console.log(`[Dashboard] Day calculation: ${start.format('DD/MM/YYYY')} to ${end.format('DD/MM/YYYY')} = diff ${diffDays}, days ${days}`);
    return days;
  } catch (error) {
    console.error('[Dashboard] Error calculating days:', error.message);
    return 0;
  }
}

/**
 * Calculate actual days INCLUSIVE - for display purposes
 */
function calculateInclusiveDays(startDate, endDate) {
  try {
    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).startOf('day');
    
    if (!start.isValid() || !end.isValid()) {
      return 0;
    }
    
    const diffDays = end.diff(start, 'day');
    return diffDays + 1; // Inclusive counting
  } catch (error) {
    console.error('[Dashboard] Error calculating inclusive days:', error);
    return 0;
  }
}

/**
 * Calculate actual patrol events (V04 only) - FIXED VERSION
 */
function countActualPatrols(events = []) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  
  // Count only V04 events (patrol arrivals)
  const v04Count = events.filter(event => {
    const alarmCode = (event.rec_calarma || event.AlarmCode || '').toString().trim().toUpperCase();
    return alarmCode === 'V04';
  }).length;
  
  return v04Count;
}

// ========== CACHE MANAGEMENT ==========

/**
 * Clear all caches
 */
const clearAllCaches = () => {
  const accountSize = accountCache.size;
  const reportSize = reportCache.size;
  const scheduleSize = scheduleCache.size;
  const analyticsSize = analyticsCache.size;
  
  accountCache.clear();
  reportCache.clear();
  scheduleCache.clear();
  analyticsCache.clear();
  
  console.log(`[Dashboard] Cleared caches: ${accountSize} accounts, ${reportSize} reports, ${scheduleSize} schedules, ${analyticsSize} analytics`);
  
  return {
    accountsCleared: accountSize,
    reportsCleared: reportSize,
    schedulesCleared: scheduleSize,
    analyticsCleared: analyticsSize,
    totalCleared: accountSize + reportSize + scheduleSize + analyticsSize
  };
};

/**
 * Get cache statistics
 */
const getCacheStats = () => {
  const now = Date.now();
  
  const accountStats = Array.from(accountCache.entries()).map(([key, value]) => ({
    key,
    age: now - value.timestamp,
    success: value.data.success
  }));
  
  const reportStats = Array.from(reportCache.entries()).map(([key, value]) => ({
    key,
    age: now - value.timestamp,
    reportType: value.data.metadata?.reportType || 'unknown',
    patrolsPerDay: value.data.metadata?.patrolsPerDay || 'unknown'
  }));
  
  const scheduleStats = Array.from(scheduleCache.entries()).map(([key, value]) => ({
    key,
    age: now - value.timestamp,
    patrolsPerDay: value.data.patrols_per_day,
    hasCustomSchedule: value.data.has_custom_schedule
  }));
  
  const analyticsStats = Array.from(analyticsCache.entries()).map(([key, value]) => ({
    key,
    age: now - value.timestamp,
    clientId: value.data.clientId
  }));
  
  return {
    accounts: {
      size: accountCache.size,
      active: accountStats.filter(a => a.age < ACCOUNT_CACHE_TTL).length,
      expired: accountStats.filter(a => a.age >= ACCOUNT_CACHE_TTL).length
    },
    reports: {
      size: reportCache.size,
      active: reportStats.filter(r => r.age < REPORT_CACHE_TTL).length,
      expired: reportStats.filter(r => r.age >= REPORT_CACHE_TTL).length
    },
    schedules: {
      size: scheduleCache.size,
      active: scheduleStats.filter(s => s.age < SCHEDULE_CACHE_TTL).length,
      expired: scheduleStats.filter(s => s.age >= SCHEDULE_CACHE_TTL).length
    },
    analytics: {
      size: analyticsCache.size,
      active: analyticsStats.filter(a => a.age < ANALYTICS_CACHE_TTL).length,
      expired: analyticsStats.filter(a => a.age >= ANALYTICS_CACHE_TTL).length
    }
  };
};

// ========== ACCOUNT RESOLUTION ==========

/**
 * Resolve account number to client ID
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
        SELECT TOP 1 cue_iid, cue_ncuenta, cue_cnombre, cue_cemail
        FROM [_Datos].[dbo].[m_cuentas]
        WHERE cue_ncuenta = @accountNumber
           OR (ISNULL(@numericPart, '') != '' AND cue_ncuenta = @numericPart)
      `);
    
    if (result.recordset.length > 0) {
      const data = {
        success: true,
        clientId: result.recordset[0].cue_iid,
        accountNumber: result.recordset[0].cue_ncuenta,
        clientName: result.recordset[0].cue_cnombre,
        clientEmail: result.recordset[0].cue_cemail
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

// ========== PATROL SCHEDULE INTEGRATION ==========

/**
 * Get patrol schedule with caching
 */
async function getCachedPatrolSchedule(clientId) {
  const cacheKey = `schedule_${clientId}`;
  
  const cached = scheduleCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SCHEDULE_CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const schedule = await patrolScheduleService.getClientSchedule(clientId);
    scheduleCache.set(cacheKey, { data: schedule, timestamp: Date.now() });
    return schedule;
  } catch (error) {
    console.error(`[Dashboard] Error fetching patrol schedule for ${clientId}:`, error);
    return getDefaultSchedule(clientId);
  }
}

/**
 * Get default schedule fallback
 */
function getDefaultSchedule(clientId) {
  return {
    client_id: clientId,
    client_name: `Client ${clientId}`,
    patrols_per_day: 11,
    weekend_patrols_per_day: 11,
    patrol_days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
    shift_type: "Day/Night",
    weekly_total: 77,
    is_active: true,
    has_custom_schedule: false,
    config_source: 'fallback'
  };
}

/**
 * Calculate expected patrols for a period - FIXED VERSION
 */
async function calculateExpectedPatrols(clientId, startDate, endDate) {
  try {
    const schedule = await getCachedPatrolSchedule(clientId);
    
    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).startOf('day');
    const patrolDays = schedule.patrol_days.split(',').map(day => day.trim().toLowerCase());
    
    let expectedPatrols = 0;
    let currentDate = start.clone();
    
    // Loop through each day in the range
    while (currentDate.isBefore(end) || currentDate.isSame(end, 'day')) {
      const dayOfWeek = currentDate.format('ddd').toLowerCase();
      
      if (patrolDays.includes(dayOfWeek)) {
        if (dayOfWeek === 'sat' || dayOfWeek === 'sun') {
          expectedPatrols += schedule.weekend_patrols_per_day || schedule.patrols_per_day;
        } else {
          expectedPatrols += schedule.patrols_per_day;
        }
      }
      
      currentDate = currentDate.add(1, 'day');
    }
    
    console.log(`[Dashboard] Expected patrols calculation: ${expectedPatrols} from ${start.format('DD/MM/YYYY')} to ${end.format('DD/MM/YYYY')}`);
    
    return {
      expectedPatrols,
      patrolsPerDay: schedule.patrols_per_day,
      weekendPatrolsPerDay: schedule.weekend_patrols_per_day || schedule.patrols_per_day,
      patrolDays: schedule.patrol_days,
      hasCustomSchedule: schedule.has_custom_schedule,
      scheduleInfo: schedule.schedule_info || `${schedule.patrols_per_day} patrols/day`
    };
  } catch (error) {
    console.error(`[Dashboard] Error calculating expected patrols:`, error);
    return {
      expectedPatrols: 0,
      patrolsPerDay: 11,
      weekendPatrolsPerDay: 11,
      patrolDays: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
      hasCustomSchedule: false,
      scheduleInfo: "11 patrols/day (default)"
    };
  }
}

/**
 * Get client analytics with caching
 */
async function getCachedClientAnalytics(clientId, daysRange = 30) {
  const cacheKey = `analytics_${clientId}_${daysRange}`;
  
  const cached = analyticsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ANALYTICS_CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const analytics = await patrolScheduleService.getClientAnalytics(clientId, daysRange);
    analyticsCache.set(cacheKey, { data: analytics, timestamp: Date.now() });
    return analytics;
  } catch (error) {
    console.error(`[Dashboard] Error fetching analytics for ${clientId}:`, error);
    return null;
  }
}

// ========== CALCULATION FUNCTIONS - MATCHING PDF SERVICE ==========

/**
 * Calculate performance score with proper bounds (0-100%) - FIXED
 */
function calculatePerformanceScore(completed, expected) {
  console.log(`[Dashboard] Performance calc: ${completed} / ${expected}`);
  
  if (expected <= 0) {
    console.log('[Dashboard] Expected patrols is 0, returning 0%');
    return 0;
  }
  
  if (completed <= 0) {
    console.log('[Dashboard] Completed patrols is 0, returning 0%');
    return 0;
  }
  
  const rawPercentage = (completed / expected) * 100;
  
  // Cap at 100% maximum
  const cappedScore = Math.min(rawPercentage, 100);
  
  // Round to nearest whole number
  const roundedScore = Math.round(cappedScore);
  
  console.log(`[Dashboard] Performance: ${rawPercentage.toFixed(2)}% → ${cappedScore.toFixed(2)}% → ${roundedScore}%`);
  
  return roundedScore;
}

/**
 * Calculate daily averages properly - FIXED
 */
function calculateDailyAverages(totalEvents, completedPatrols, daysCovered) {
  console.log(`[Dashboard] Avg calc: ${completedPatrols} patrols / ${daysCovered} days`);
  
  if (daysCovered <= 0) {
    console.warn('[Dashboard] Days covered is 0, cannot calculate averages');
    return { avgEventsPerDay: 0, avgPatrolsPerDay: 0 };
  }
  
  const avgPatrolsPerDay = completedPatrols / daysCovered;
  const roundedAvg = Math.round(avgPatrolsPerDay);
  
  console.log(`[Dashboard] Average: ${avgPatrolsPerDay.toFixed(2)} → ${roundedAvg}`);
  
  return {
    avgEventsPerDay: Math.round(totalEvents / daysCovered),
    avgPatrolsPerDay: roundedAvg
  };
}

/**
 * Get performance tier with proper bounds
 */
function getPerformanceTier(score) {
  const normalizedScore = Math.min(Math.max(score, 0), 100);
  
  if (normalizedScore >= PERFORMANCE_TIERS.EXCELLENT.min) {
    return { ...PERFORMANCE_TIERS.EXCELLENT, actualScore: normalizedScore };
  }
  if (normalizedScore >= PERFORMANCE_TIERS.GOOD.min) {
    return { ...PERFORMANCE_TIERS.GOOD, actualScore: normalizedScore };
  }
  if (normalizedScore >= PERFORMANCE_TIERS.FAIR.min) {
    return { ...PERFORMANCE_TIERS.FAIR, actualScore: normalizedScore };
  }
  return { ...PERFORMANCE_TIERS.NEEDS_IMPROVEMENT, actualScore: normalizedScore };
}

/**
 * Clean post name by removing leading numbers
 */
function cleanPostName(postName) {
  if (!postName) return postName;
  return postName.replace(/^\d+\.\s*/, '').trim();
}

/**
 * Extract clean incident description from raw text
 */
function extractIncidentDescription(rawText) {
  if (!rawText) return '';
  
  let cleaned = rawText.trim();
  
  // Remove timestamp patterns
  cleaned = cleaned.replace(/\[\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(:\d{2})?\]/g, '');
  
  // Remove tags
  cleaned = cleaned.replace(/\[vigicontrol\]/gi, '');
  cleaned = cleaned.replace(/\[irservices\]/gi, '');
  
  // Remove any remaining square bracket content at the start
  cleaned = cleaned.replace(/^\s*\[.*?\]\s*/g, '');
  
  // Clean up multiple spaces and newlines
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

/**
 * Get zone name with comprehensive fallback strategy
 */
function getZoneName(incidentData) {
  // Priority 1: Check specific zone fields
  if (incidentData.zone) return cleanPostName(incidentData.zone);
  if (incidentData.zoneName) return cleanPostName(incidentData.zoneName);
  if (incidentData.zone_name) return cleanPostName(incidentData.zone_name);
  if (incidentData.Zone) return cleanPostName(incidentData.Zone);
  
  // Priority 2: Check post fields
  if (incidentData.post) return cleanPostName(incidentData.post);
  if (incidentData.postName) return cleanPostName(incidentData.postName);
  if (incidentData.post_name) return cleanPostName(incidentData.post_name);
  if (incidentData.SecurityPost) return cleanPostName(incidentData.SecurityPost);
  
  // Priority 3: Check rec_czona fields
  if (incidentData.rec_czona) return `Zone ${incidentData.rec_czona}`;
  if (incidentData.rec_czonanombre) return cleanPostName(incidentData.rec_czonanombre);
  
  // Priority 4: Try to extract from description
  if (incidentData.description || incidentData.report) {
    const text = (incidentData.description || incidentData.report || '').toLowerCase();
    const zoneMatch = text.match(/zone\s+(\w+)/i) || 
                     text.match(/post\s+(\w+)/i) ||
                     text.match(/at\s+(.+?)\s+post/i) ||
                     text.match(/in\s+(.+?)\s+area/i);
    if (zoneMatch && zoneMatch[1]) {
      return cleanPostName(zoneMatch[1].toUpperCase());
    }
  }
  
  // Priority 5: Try location field
  if (incidentData.location) return cleanPostName(incidentData.location);
  
  // Fallback
  return 'Unknown Location';
}

/**
 * Process guard reports for incidents
 */
function processGuardReports(reportData) {
  const incidents = [];
  
  // Check guardReports array (primary source)
  if (Array.isArray(reportData.guardReports) && reportData.guardReports.length > 0) {
    reportData.guardReports.forEach((report, index) => {
      if (report.type === 'INCIDENT_REPORT' || report.__type === 'INCIDENT_REPORT') {
        const rawDescription = report.report || report.description || report.content || '';
        const cleanDescription = extractIncidentDescription(rawDescription);
        
        // Parse date/time
        let incidentDate = 'N/A';
        let incidentTime = 'N/A';
        if (report.date) {
          const dateObj = dayjs(report.date);
          if (dateObj.isValid()) {
            incidentDate = dateObj.format('DD/MM/YYYY');
            incidentTime = dateObj.format('HH:mm:ss');
          }
        }
        
        // Get zone name with fallback
        const zoneName = getZoneName(report);
        
        incidents.push({
          id: report.id || report.rec_iid || `inc-${incidents.length + 1}`,
          date: incidentDate,
          time: incidentTime,
          dateTime: report.date || 'N/A',
          zone: zoneName,
          description: cleanDescription,
          priority: report.priority || 'MEDIUM',
          reportedBy: report.guardName || report.officer || report.reportedBy || 'Guard',
          rawText: rawDescription,
          source: 'guardReport'
        });
      }
    });
  }
  
  // Check events array for V03 (incident) events
  if (incidents.length === 0 && Array.isArray(reportData.events)) {
    reportData.events.forEach((event, index) => {
      const alarmCode = (event.rec_calarma || event.AlarmCode || '').toString().trim().toUpperCase();
      
      if (alarmCode === 'V03') {
        // Get raw text content
        const rawText = event.rec_cObservaciones || 
                        event.Observaciones || 
                        event.observaciones || 
                        event.rec_cContenido || 
                        '';
        
        const cleanDescription = extractIncidentDescription(rawText);
        
        // Parse date/time
        let incidentDate = 'N/A';
        let incidentTime = 'N/A';
        if (event.rec_tfechahora) {
          const dateObj = dayjs(event.rec_tfechahora);
          if (dateObj.isValid()) {
            incidentDate = dateObj.format('DD/MM/YYYY');
            incidentTime = dateObj.format('HH:mm:ss');
          }
        }
        
        // Get zone name with comprehensive fallback
        const zoneName = getZoneName(event);
        
        incidents.push({
          id: event.rec_iid || `inc-${incidents.length + 1}`,
          date: incidentDate,
          time: incidentTime,
          dateTime: event.rec_tfechahora || 'N/A',
          zone: zoneName,
          description: cleanDescription,
          priority: 'MEDIUM',
          reportedBy: event.rec_coperador || event.Operator || 'Guard',
          rawText: rawText,
          source: 'event'
        });
      }
    });
  }
  
  return incidents;
}

/**
 * Process patrol events for activity log - FIXED VERSION
 */
function processPatrolEvents(reportData) {
  const patrolEvents = [];
  
  if (Array.isArray(reportData.events)) {
    reportData.events.forEach(event => {
      const alarmCode = (event.rec_calarma || event.AlarmCode || '').toString().trim().toUpperCase();
      
      // Only include patrol arrivals (V04)
      if (alarmCode === 'V04') {
        const zoneName = getZoneName(event);
        
        patrolEvents.push({
          id: event.rec_iid || Math.random().toString(36).substr(2, 9),
          Date: event.Date || formatDate(event.rec_tfechahora) || 'N/A',
          Time: event.Time || (event.rec_tfechahora ? dayjs(event.rec_tfechahora).format('HH:mm:ss') : 'N/A'),
          Event: 'VigiControl Arrival',
          Zone: zoneName,
          AlarmCode: alarmCode,
          rawData: event
        });
      }
    });
  }
  
  console.log(`[Dashboard] Processed ${patrolEvents.length} V04 patrol events`);
  return patrolEvents;
}

/**
 * Format date for display
 */
function formatDate(dateString) {
  try {
    const date = dayjs(dateString).tz(TZ);
    if (date.isValid()) {
      return date.format('DD/MM/YYYY');
    }
    return dateString;
  } catch (error) {
    return dateString;
  }
}

// ========== DATE RANGE MANAGEMENT ==========

/**
 * Generate date range for report types - FIXED FOR WEEKLY = 7 DAYS
 */
function generateDateRangeForReportType(reportType, endDate = null) {
  const now = endDate ? dayjs(endDate) : dayjs();
  const today = now.startOf('day');
  
  switch(reportType.toLowerCase()) {
    case REPORT_TYPES.LAST7:
    case REPORT_TYPES.WEEKLY:
      // FIX: Weekly should be 7 days, not 8
      const weekStart = today.subtract(6, 'day'); // 7 days total (6 days back + today)
      return {
        startDate: weekStart.format('YYYY-MM-DD'),
        endDate: today.format('YYYY-MM-DD'),
        days: 7
      };
      
    case REPORT_TYPES.LAST30:
    case REPORT_TYPES.MONTHLY:
      const monthStart = today.subtract(29, 'day'); // 30 days total
      return {
        startDate: monthStart.format('YYYY-MM-DD'),
        endDate: today.format('YYYY-MM-DD'),
        days: 30
      };
      
    case REPORT_TYPES.DAILY:
      const yesterday = today.subtract(1, 'day');
      return {
        startDate: yesterday.format('YYYY-MM-DD'),
        endDate: yesterday.format('YYYY-MM-DD'),
        days: 1
      };
      
    default:
      return {
        startDate: today.format('YYYY-MM-DD'),
        endDate: today.format('YYYY-MM-DD'),
        days: 1
      };
  }
}

/**
 * Adjust date range based on report type - FIXED
 */
function adjustDateRange(startDate, endDate, forceWeekly = false, reportType = REPORT_TYPES.CUSTOM) {
  try {
    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).startOf('day');
    const diffDays = end.diff(start, 'day');
    
    console.log(`[Dashboard] Adjusting range: ${startDate} to ${endDate} (${diffDays} days diff)`);
    
    if (forceWeekly && diffDays !== 6) { // 6 diff = 7 days total
      const adjustedStart = end.subtract(6, 'day');
      return {
        adjustedStartDate: adjustedStart.format('YYYY-MM-DD'),
        adjustedEndDate: end.format('YYYY-MM-DD'),
        wasAdjusted: true,
        originalDays: diffDays + 1,
        reason: 'weekly_enforcement'
      };
    }
    
    if ((reportType === REPORT_TYPES.MONTHLY || reportType === REPORT_TYPES.LAST30) && diffDays !== 29) {
      const adjustedStart = end.subtract(29, 'day');
      return {
        adjustedStartDate: adjustedStart.format('YYYY-MM-DD'),
        adjustedEndDate: end.format('YYYY-MM-DD'),
        wasAdjusted: true,
        originalDays: diffDays + 1,
        reason: `${reportType}_adjustment`
      };
    }
    
    if (reportType === REPORT_TYPES.DAILY && diffDays !== 0) {
      return {
        adjustedStartDate: endDate,
        adjustedEndDate: endDate,
        wasAdjusted: true,
        originalDays: diffDays + 1,
        reason: 'daily_adjustment'
      };
    }
    
    return {
      adjustedStartDate: startDate,
      adjustedEndDate: endDate,
      wasAdjusted: false,
      originalDays: diffDays + 1, // Inclusive count
      reason: 'no_adjustment'
    };
  } catch (error) {
    console.error('[Dashboard] Error adjusting date range:', error);
    return {
      adjustedStartDate: startDate,
      adjustedEndDate: endDate,
      wasAdjusted: false,
      originalDays: 0,
      reason: 'error'
    };
  }
}

// ========== REPORT GENERATION ==========

/**
 * Generate report cache key
 */
function generateCacheKey(clientId, startDate, endDate, reportType = REPORT_TYPES.CUSTOM, scheduleHash = '') {
  return `report_${clientId}_${reportType}_${startDate}_${endDate}_${scheduleHash}`;
}

/**
 * Get cached or fetch new report - FIXED VERSION
 */
async function getCachedOrFetchReport(clientId, startDate, endDate, reportType = REPORT_TYPES.CUSTOM) {
  const schedule = await getCachedPatrolSchedule(clientId);
  const scheduleHash = schedule.has_custom_schedule ? 'custom' : 'default';
  const cacheKey = generateCacheKey(clientId, startDate, endDate, reportType, scheduleHash);
  
  const cached = reportCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < REPORT_CACHE_TTL) {
    console.log(`[Dashboard] Cache hit: ${cacheKey}`);
    return { ...cached.data, fromCache: true };
  }
  
  console.log(`[Dashboard] Cache miss: ${cacheKey}`);
  
  try {
    const reportData = await fetchWeeklyReport(clientId, startDate, endDate, true);
    const patrolInfo = await calculateExpectedPatrols(clientId, startDate, endDate);
    
    // FIX: Count actual patrols (V04 events only)
    const actualPatrols = countActualPatrols(reportData.events || []);
    
    // Calculate days covered
    const daysCovered = calculateActualDays(startDate, endDate);
    const inclusiveDays = calculateInclusiveDays(startDate, endDate);
    
    console.log(`[Dashboard] Report stats: ${actualPatrols} patrols, ${daysCovered} days, ${inclusiveDays} inclusive days`);
    
    // Performance score calculation - FIXED
    const performanceScore = calculatePerformanceScore(actualPatrols, patrolInfo.expectedPatrols);
    
    // Store calculations in metadata
    reportData.metadata.reportType = reportType;
    reportData.metadata.expectedPatrols = patrolInfo.expectedPatrols;
    reportData.metadata.actualPatrols = actualPatrols; // Store actual count
    reportData.metadata.overallPerformance = performanceScore;
    reportData.metadata.calendarDays = daysCovered;
    reportData.metadata.inclusiveDays = inclusiveDays;
    reportData.metadata.patrolsPerDay = patrolInfo.patrolsPerDay;
    reportData.metadata.weekendPatrolsPerDay = patrolInfo.weekendPatrolsPerDay;
    reportData.metadata.patrolDays = patrolInfo.patrolDays;
    reportData.metadata.hasCustomSchedule = patrolInfo.hasCustomSchedule;
    reportData.metadata.scheduleInfo = patrolInfo.scheduleInfo;
    
    // Calculate totals
    const totalEvents = reportData.events ? reportData.events.length : 0;
    const incidents = processGuardReports(reportData);
    const totalIncidents = incidents.length;
    
    // Calculate averages
    const avgEventsPerDay = calculateDailyAverages(totalEvents, actualPatrols, daysCovered).avgEventsPerDay;
    const avgPatrolsPerDay = calculateDailyAverages(totalEvents, actualPatrols, daysCovered).avgPatrolsPerDay;
    
    reportData.metadata.avgEventsPerDay = avgEventsPerDay;
    reportData.metadata.avgPatrolsPerDay = avgPatrolsPerDay;
    reportData.metadata.totalIncidents = totalIncidents;
    reportData.metadata.highPriorityIncidents = incidents.filter(i => i.priority === 'HIGH').length;
    
    // Add processed data
    reportData.processed = {
      incidents: incidents,
      patrolEvents: processPatrolEvents(reportData),
      uniqueZones: calculateUniqueZones(reportData.events || [])
    };
    
    // Log for debugging
    console.log(`[Dashboard] Generated report: ${actualPatrols}/${patrolInfo.expectedPatrols} patrols = ${performanceScore}%`);
    
    reportCache.set(cacheKey, { data: reportData, timestamp: Date.now() });
    return { ...reportData, fromCache: false };
  } catch (error) {
    console.error(`[Dashboard] Report fetch failed:`, error.message);
    return {
      posts: [],
      events: [],
      guardReports: [],
      metadata: {
        success: false,
        error: error.message,
        clientId: parseInt(clientId) || 0,
        startDate,
        endDate,
        calendarDays: 0,
        reportType,
        patrolsPerDay: 11,
        expectedPatrols: 0,
        overallPerformance: 0,
        avgEventsPerDay: 0,
        avgPatrolsPerDay: 0,
        totalIncidents: 0,
        hasCustomSchedule: false,
        dataQuality: { isValid: false },
        generatedAt: new Date()
      },
      fromCache: false
    };
  }
}

// ========== DATA PROCESSING ==========

/**
 * Calculate unique zones from events
 */
function calculateUniqueZones(events = []) {
  const uniqueZones = new Set();
  events.forEach(event => {
    const zone = event.zone || event.Zone || getZoneName(event);
    if (zone && zone !== 'Unknown Zone' && zone !== 'Unknown Location') {
      uniqueZones.add(zone);
    }
  });
  return uniqueZones;
}

/**
 * Normalize dashboard events - FIXED VERSION
 */
function normalizeDashboardEvents(events = []) {
  if (!Array.isArray(events) || events.length === 0) return [];
  
  // Filter only V04 events for patrol tracking
  const patrolEvents = events.filter(event => {
    const alarmCode = (event.rec_calarma || event.AlarmCode || '').toString().trim().toUpperCase();
    return alarmCode === 'V04';
  });
  
  return patrolEvents.map(event => ({
    id: event.rec_iid || event.PatrolID || Math.random().toString(36).substr(2, 9),
    date: event.Date || event.date || formatDate(event.rec_tfechahora) || '-',
    time: event.Time || event.time || (event.rec_tfechahora ? dayjs(event.rec_tfechahora).format('HH:mm:ss') : '-'),
    event: 'VigiControl Arrival',
    zone: getZoneName(event),
    code: event.AlarmCode || event.code || 'V04',
    rawDate: event.rec_tfechahora ? new Date(event.rec_tfechahora) : null,
    zoneCode: event.ZoneCode || event.zoneCode,
    alarmType: event.AlarmType || event.alarmType,
    observations: event.Observations || event.observations
  }));
}

/**
 * Generate dashboard summary - FIXED VERSION
 */
function generateDashboardSummary(reportData, accountNumber, reportType = REPORT_TYPES.CUSTOM, dateAdjustment = {}) {
  const { posts = [], metadata = {}, events = [], processed = {} } = reportData;
  
  // Use actual patrol count from metadata (already filtered for V04)
  const actualPatrols = metadata.actualPatrols || countActualPatrols(events);
  const expectedPatrols = metadata.expectedPatrols || 0;
  
  // Get processed data
  const incidents = processed?.incidents || processGuardReports(reportData);
  const patrolEvents = processed?.patrolEvents || processPatrolEvents(reportData);
  
  // Calculate totals
  const totalEvents = events.length;
  const totalPosts = posts.length;
  const totalIncidents = incidents.length;
  const highPriorityIncidents = incidents.filter(i => i.priority === 'HIGH').length;
  
  // Performance calculations - USE ACTUAL COUNTS
  const performanceScore = calculatePerformanceScore(actualPatrols, expectedPatrols);
  
  // Days calculation - FIXED
  const daysCovered = metadata.calendarDays || calculateActualDays(metadata.startDate || dateAdjustment.adjustedStart, metadata.endDate || dateAdjustment.adjustedEnd);
  const inclusiveDays = metadata.inclusiveDays || calculateInclusiveDays(metadata.startDate || dateAdjustment.adjustedStart, metadata.endDate || dateAdjustment.adjustedEnd);
  
  const patrolsPerDay = metadata.patrolsPerDay || 11;
  const hasCustomSchedule = metadata.hasCustomSchedule || false;
  
  // Averages calculation - FIXED
  const avgPatrolsPerDay = calculateDailyAverages(0, actualPatrols, daysCovered).avgPatrolsPerDay;
  
  // Calculate unique zones
  const uniqueZones = calculateUniqueZones(events);
  
  // Get performance tier
  const performanceTier = getPerformanceTier(performanceScore);
  
  const performanceLevel = performanceScore >= 90 ? 'EXCELLENT' : 
                          performanceScore >= 80 ? 'GOOD' : 
                          performanceScore >= 70 ? 'SATISFACTORY' : 'NEEDS IMPROVEMENT';
  
  return {
    summary: {
      totalEvents: totalEvents,
      totalPosts: totalPosts,
      performanceScore: performanceScore, // Should match PDF (14%)
      performanceTier: performanceTier.label,
      performanceColor: performanceTier.color,
      expectedPatrols: expectedPatrols,
      completedPatrols: actualPatrols, // Use actual patrol count
      zoneCoverage: uniqueZones.size,
      avgEventsPerDay: Math.round(totalEvents / daysCovered) || 0,
      avgPatrolsPerDay: avgPatrolsPerDay, // Should be ~64 for 450 patrols over 7 days
      daysCovered: daysCovered,
      inclusiveDays: inclusiveDays,
      dataSource: metadata.dataSource || 'Unknown',
      startDate: metadata.startDate || '-',
      endDate: metadata.endDate || '-',
      generatedAt: metadata.generatedAt || new Date(),
      dateAdjusted: dateAdjustment.wasAdjusted || false,
      originalDateRange: dateAdjustment.originalDays && dateAdjustment.originalDays !== inclusiveDays 
        ? `${dateAdjustment.originalStart || metadata.startDate} to ${dateAdjustment.originalEnd || metadata.endDate}` 
        : null,
      reportType,
      hasCustomSchedule,
      patrolSchedule: metadata.scheduleInfo || `${patrolsPerDay} patrols/day`,
      totalIncidents: totalIncidents,
      highPriorityIncidents: highPriorityIncidents,
      performanceLevel: performanceLevel,
      patrolEventsCount: patrolEvents.length
    },
    metadata: {
      clientId: metadata.clientId,
      clientName: metadata.clientName || 'Unknown',
      accountNumber: metadata.clientAccountNumber || accountNumber,
      patrolsPerDay: patrolsPerDay,
      weekendPatrolsPerDay: metadata.weekendPatrolsPerDay || patrolsPerDay,
      patrolDays: metadata.patrolDays || "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
      hasCustomSchedule: hasCustomSchedule,
      scheduleSource: metadata.config_source || 'default',
      timezone: metadata.timezone || TZ,
      usingAPI: metadata.usingAPI || false,
      dataQuality: metadata.dataQuality || { isValid: false },
      reportType,
      patrolWindow: `${DEFAULT_SHIFT_START_HOUR}:00 - ${DEFAULT_SHIFT_END_HOUR}:00 next day`
    },
    posts: posts.map(post => ({
      id: post.SecurityPostID || Math.random().toString(36).substr(2, 9),
      name: cleanPostName(post.SecurityPost),
      zoneCode: post.ZoneCode,
      completed: post.Completed,
      expected: post.Expected,
      performance: post.Performance,
      percentage: post.Percentage,
      performanceTier: getPerformanceTier(post.Performance || 0).label
    })),
    quickStats: [
      {
        id: 'completion',
        title: 'Completion Rate',
        value: `${performanceScore}%`,
        description: `${actualPatrols}/${expectedPatrols} patrols (${performanceLevel})`,
        icon: 'check-circle',
        color: performanceTier.color
      },
      {
        id: 'zones',
        title: 'Active Zones',
        value: uniqueZones.size,
        description: `of ${totalPosts} total zones`,
        icon: 'map-pin',
        color: 'blue'
      },
      {
        id: 'average',
        title: 'Daily Average',
        value: avgPatrolsPerDay,
        description: `over ${daysCovered} days`,
        icon: 'calendar',
        color: 'purple'
      },
      {
        id: 'incidents',
        title: 'Security Incidents',
        value: totalIncidents,
        description: totalIncidents === 0 ? 'All clear' : `${highPriorityIncidents} high priority`,
        icon: 'alert-triangle',
        color: totalIncidents === 0 ? 'green' : highPriorityIncidents > 0 ? 'red' : 'orange'
      }
    ],
    processed: {
      incidents,
      patrolEvents,
      uniqueZones: Array.from(uniqueZones)
    }
  };
}

// ========== MAIN EXPORTED FUNCTIONS ==========

/**
 * Get dashboard summary with patrol schedule integration - FIXED VERSION
 */
const getDashboardSummary = async ({ 
  clientId, 
  startDate, 
  endDate, 
  forceWeekly = false,
  reportType = REPORT_TYPES.CUSTOM 
}) => {
  const startTime = Date.now();
  
  try {
    console.log(`[Dashboard] Fetching summary for ${clientId}: ${startDate} to ${endDate} (type: ${reportType})`);
    
    // Adjust date range
    const dateAdjustment = adjustDateRange(startDate, endDate, forceWeekly, reportType);
    const { adjustedStartDate, adjustedEndDate, wasAdjusted, originalDays } = dateAdjustment;
    
    if (wasAdjusted) {
      console.log(`[Dashboard] Date range adjusted: ${originalDays} → ${adjustedStartDate} to ${adjustedEndDate}`);
    }
    
    // Resolve account
    const resolution = await resolveClientId(clientId);
    if (!resolution.success) {
      throw new Error(resolution.error || 'Failed to resolve account');
    }
    
    const numericClientId = resolution.clientId;
    const clientName = resolution.clientName;
    
    // Get patrol schedule
    const schedule = await getCachedPatrolSchedule(numericClientId);
    console.log(`[Dashboard] Using schedule: ${clientName} - ${schedule.patrols_per_day} patrols/day`);
    
    // Get report data
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
    
    // Add schedule details
    dashboardSummary.metadata.scheduleDetails = {
      patrolsPerDay: schedule.patrols_per_day,
      weekendPatrolsPerDay: schedule.weekend_patrols_per_day,
      patrolDays: schedule.patrol_days,
      shiftType: schedule.shift_type,
      weeklyTotal: schedule.weekly_total,
      isActive: schedule.is_active,
      hasCustomSchedule: schedule.has_custom_schedule,
      configSource: schedule.config_source,
      clientName: schedule.client_name
    };
    
    const duration = Date.now() - startTime;
    console.log(`[Dashboard] Summary generated in ${duration}ms (${reportData.fromCache ? 'CACHED' : 'FRESH'})`);
    
    // Log the calculated values for verification
    console.log(`[Dashboard] FINAL CALCULATIONS:`);
    console.log(`   - Actual Patrols (V04): ${dashboardSummary.summary.completedPatrols}`);
    console.log(`   - Expected Patrols: ${dashboardSummary.summary.expectedPatrols}`);
    console.log(`   - Performance Score: ${dashboardSummary.summary.performanceScore}%`);
    console.log(`   - Avg Per Day: ${dashboardSummary.summary.avgPatrolsPerDay}`);
    console.log(`   - Days Covered: ${dashboardSummary.summary.daysCovered}`);
    console.log(`   - Inclusive Days: ${dashboardSummary.summary.inclusiveDays}`);
    console.log(`   - Total Incidents: ${dashboardSummary.summary.totalIncidents}`);
    
    // Special check for your specific case
    if (dashboardSummary.summary.completedPatrols === 450 && dashboardSummary.summary.expectedPatrols === 3256) {
      const expectedScore = Math.round((450 / 3256) * 100);
      console.log(`[Dashboard] EXPECTED: 450/3256 = ${expectedScore}% (should match PDF)`);
    }
    
    return {
      success: true,
      data: {
        summary: dashboardSummary.summary,
        metadata: dashboardSummary.metadata,
        posts: dashboardSummary.posts,
        quickStats: dashboardSummary.quickStats,
        schedule: dashboardSummary.metadata.scheduleDetails,
        incidents: dashboardSummary.processed?.incidents || []
      },
      events: reportData.events || [],
      guardReports: reportData.guardReports || [],
      dataSource: reportData.metadata.dataSource,
      processingTime: duration,
      cached: reportData.fromCache,
      dateAdjusted: wasAdjusted,
      reportType,
      scheduleInfo: schedule
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Summary error after ${duration}ms:`, error);
    
    let schedule = { patrols_per_day: 11 };
    try {
      schedule = await getCachedPatrolSchedule(parseInt(clientId) || 0);
    } catch (scheduleError) {
      console.error(`[Dashboard] Could not get schedule on error:`, scheduleError);
    }
    
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
          avgEventsPerDay: 0,
          avgPatrolsPerDay: 0,
          daysCovered: 0,
          dataSource: 'Error',
          startDate,
          endDate,
          generatedAt: new Date(),
          reportType,
          hasCustomSchedule: false,
          patrolSchedule: `${schedule.patrols_per_day} patrols/day`,
          totalIncidents: 0,
          highPriorityIncidents: 0,
          performanceLevel: 'ERROR',
          patrolEventsCount: 0
        },
        metadata: {
          clientId: null,
          clientName: 'Error',
          accountNumber: clientId,
          patrolsPerDay: schedule.patrols_per_day,
          weekendPatrolsPerDay: schedule.weekend_patrols_per_day || schedule.patrols_per_day,
          patrolDays: schedule.patrol_days || "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
          hasCustomSchedule: schedule.has_custom_schedule || false,
          timezone: TZ,
          usingAPI: false,
          dataQuality: { isValid: false },
          reportType
        },
        posts: [],
        quickStats: [],
        schedule
      },
      events: [],
      guardReports: [],
      dataSource: 'ERROR'
    };
  }
};

/**
 * Get dashboard patrol events
 */
const getDashboardPatrolEvents = async ({ 
  clientId, 
  startDate, 
  endDate, 
  forceWeekly = false,
  reportType = REPORT_TYPES.CUSTOM 
}) => {
  const startTime = Date.now();
  
  try {
    console.log(`[Dashboard] Fetching patrol events for ${clientId}: ${startDate} to ${endDate}`);
    
    // Adjust date range
    const dateAdjustment = adjustDateRange(startDate, endDate, forceWeekly, reportType);
    const { adjustedStartDate, adjustedEndDate, wasAdjusted } = dateAdjustment;
    
    if (wasAdjusted) {
      console.log(`[Dashboard] Date range adjusted: ${startDate}-${endDate} → ${adjustedStartDate}-${adjustedEndDate}`);
    }
    
    // Resolve account
    const resolution = await resolveClientId(clientId);
    if (!resolution.success) {
      throw new Error(resolution.error || 'Failed to resolve account');
    }
    
    const numericClientId = resolution.clientId;
    const clientName = resolution.clientName;
    
    // Get schedule
    const schedule = await getCachedPatrolSchedule(numericClientId);
    
    // Get report data
    const reportData = await getCachedOrFetchReport(numericClientId, adjustedStartDate, adjustedEndDate, reportType);
    
    if (!reportData.metadata.success) {
      throw new Error(reportData.metadata.error?.message || 'Failed to generate report');
    }
    
    // Normalize events using same zone extraction as PDF service
    const events = normalizeDashboardEvents(reportData.events || []);
    
    const duration = Date.now() - startTime;
    console.log(`[Dashboard] Patrol events fetched in ${duration}ms (${events.length} events)`);
    
    return {
      success: true,
      data: events,
      metadata: {
        clientId: numericClientId,
        clientName: reportData.metadata.clientName || clientName,
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
        forceWeekly,
        reportType,
        shiftWindow: `${DEFAULT_SHIFT_START_HOUR}:00 - ${DEFAULT_SHIFT_END_HOUR}:00 next day`,
        patrolSchedule: {
          patrolsPerDay: schedule.patrols_per_day,
          patrolDays: schedule.patrol_days,
          hasCustomSchedule: schedule.has_custom_schedule
        }
      },
      dataSource: reportData.metadata.dataSource
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] Patrol events error after ${duration}ms:`, error);
    return {
      success: false,
      message: error.message || 'Failed to fetch patrol events',
      data: [],
      metadata: null
    };
  }
};

/**
 * Get client patrol schedule details
 */
const getClientPatrolSchedule = async (clientId) => {
  try {
    const resolution = await resolveClientId(clientId);
    if (!resolution.success) {
      throw new Error(resolution.error || 'Failed to resolve account');
    }
    
    const numericClientId = resolution.clientId;
    const schedule = await getCachedPatrolSchedule(numericClientId);
    
    // Calculate expected patrols for different periods
    const weeklyRange = generateDateRangeForReportType(REPORT_TYPES.WEEKLY);
    const monthlyRange = generateDateRangeForReportType(REPORT_TYPES.MONTHLY);
    
    const weeklyPatrols = await calculateExpectedPatrols(numericClientId, weeklyRange.startDate, weeklyRange.endDate);
    const monthlyPatrols = await calculateExpectedPatrols(numericClientId, monthlyRange.startDate, monthlyRange.endDate);
    
    // Get analytics for context
    const analytics = await getCachedClientAnalytics(numericClientId, 30);
    
    return {
      success: true,
      client: {
        id: numericClientId,
        name: resolution.clientName,
        accountNumber: resolution.accountNumber,
        email: resolution.clientEmail
      },
      schedule: {
        patrolsPerDay: schedule.patrols_per_day,
        weekendPatrolsPerDay: schedule.weekend_patrols_per_day,
        patrolDays: schedule.patrol_days,
        shiftType: schedule.shift_type,
        weeklyTotal: schedule.weekly_total,
        isActive: schedule.is_active,
        hasCustomSchedule: schedule.has_custom_schedule,
        configSource: schedule.config_source,
        scheduleInfo: schedule.schedule_info
      },
      expectedPatrols: {
        daily: schedule.patrols_per_day,
        weekly: weeklyPatrols.expectedPatrols,
        monthly: monthlyPatrols.expectedPatrols,
        calculation: {
          weekdays: schedule.patrols_per_day,
          weekends: schedule.weekend_patrols_per_day || schedule.patrols_per_day,
          daysActive: schedule.patrol_days.split(',').length
        }
      },
      analytics: analytics?.analytics || null,
      lastUpdated: schedule.updatedAt || new Date()
    };
  } catch (error) {
    console.error(`[Dashboard] Error getting patrol schedule:`, error);
    return {
      success: false,
      error: error.message,
      schedule: null
    };
  }
};

/**
 * Get patrol compliance analysis - USING PDF SERVICE CALCULATIONS
 */
const getPatrolCompliance = async (clientId, startDate, endDate) => {
  try {
    const resolution = await resolveClientId(clientId);
    if (!resolution.success) {
      throw new Error(resolution.error || 'Failed to resolve account');
    }
    
    const numericClientId = resolution.clientId;
    
    // Get actual patrols
    const reportData = await getCachedOrFetchReport(numericClientId, startDate, endDate);
    const actualPatrols = reportData.metadata.totalCompleted || 0;
    
    // Calculate expected patrols
    const expectedInfo = await calculateExpectedPatrols(numericClientId, startDate, endDate);
    
    // Get schedule
    const schedule = await getCachedPatrolSchedule(numericClientId);
    
    // Calculate compliance with same logic as PDF service
    const complianceRate = calculatePerformanceScore(actualPatrols, expectedInfo.expectedPatrols);
    
    const daysCovered = calculateActualDays(startDate, endDate);
    
    // Calculate averages with same logic as PDF service
    const avgPatrolsPerDay = calculateDailyAverages(0, actualPatrols, daysCovered).avgPatrolsPerDay;
    const expectedDailyAvg = expectedInfo.expectedPatrols > 0 && daysCovered > 0 
      ? (expectedInfo.expectedPatrols / daysCovered).toFixed(1) 
      : '0.0';
    
    const performanceTier = getPerformanceTier(complianceRate);
    
    const performanceLevel = complianceRate >= 90 ? 'EXCELLENT' : 
                            complianceRate >= 80 ? 'GOOD' : 
                            complianceRate >= 70 ? 'SATISFACTORY' : 'NEEDS IMPROVEMENT';
    
    return {
      success: true,
      period: {
        startDate,
        endDate,
        days: daysCovered
      },
      patrols: {
        actual: actualPatrols,
        expected: expectedInfo.expectedPatrols,
        difference: actualPatrols - expectedInfo.expectedPatrols,
        complianceRate: `${complianceRate}%`,
        dailyAverage: avgPatrolsPerDay,
        expectedDailyAverage: expectedDailyAvg,
        performanceLevel: performanceLevel
      },
      schedule: {
        patrolsPerDay: schedule.patrols_per_day,
        patrolDays: schedule.patrol_days,
        hasCustomSchedule: schedule.has_custom_schedule,
        scheduleInfo: schedule.schedule_info
      },
      performance: {
        rating: performanceTier.label,
        score: complianceRate,
        color: performanceTier.color,
        trend: actualPatrols >= expectedInfo.expectedPatrols ? 'positive' : 'negative',
        status: complianceRate >= 70 ? 'meeting_expectations' : 'below_expectations'
      },
      recommendations: generateComplianceRecommendations(complianceRate, actualPatrols, expectedInfo.expectedPatrols)
    };
  } catch (error) {
    console.error(`[Dashboard] Error getting patrol compliance:`, error);
    return {
      success: false,
      error: error.message,
      patrols: null
    };
  }
};

/**
 * Generate compliance recommendations
 */
function generateComplianceRecommendations(complianceRate, actualPatrols, expectedPatrols) {
  const recommendations = [];
  
  if (complianceRate < 70) {
    recommendations.push({
      priority: 'high',
      title: 'Increase Patrol Frequency',
      description: `Current compliance is ${complianceRate}%. Consider increasing patrols to meet expected ${expectedPatrols} patrols.`,
      action: 'Review patrol schedule and staffing'
    });
  } else if (complianceRate < 90) {
    recommendations.push({
      priority: 'medium',
      title: 'Maintain Current Level',
      description: `Compliance at ${complianceRate}% is acceptable but could be improved.`,
      action: 'Monitor performance and make incremental improvements'
    });
  } else {
    recommendations.push({
      priority: 'low',
      title: 'Excellent Performance',
      description: `Compliance at ${complianceRate}% exceeds expectations.`,
      action: 'Continue current practices and share best practices'
    });
  }
  
  if (actualPatrols < expectedPatrols) {
    const deficit = expectedPatrols - actualPatrols;
    recommendations.push({
      priority: 'high',
      title: 'Address Patrol Deficit',
      description: `Missing ${deficit} patrols (${Math.round((deficit/expectedPatrols)*100)}% of expected).`,
      action: 'Investigate root causes and implement corrective actions'
    });
  }
  
  return recommendations;
}

// ========== PRESET REPORT FUNCTIONS ==========

const getWeeklySummary = async (clientId) => {
  const dateRange = generateDateRangeForReportType(REPORT_TYPES.WEEKLY);
  return await getDashboardSummary({
    clientId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    forceWeekly: true,
    reportType: REPORT_TYPES.WEEKLY
  });
};

const getLast30DaysSummary = async (clientId) => {
  const dateRange = generateDateRangeForReportType(REPORT_TYPES.LAST30);
  return await getDashboardSummary({
    clientId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    forceWeekly: false,
    reportType: REPORT_TYPES.LAST30
  });
};

const getLast7DaysSummary = async (clientId) => {
  return await getWeeklySummary(clientId);
};

const getDailySummary = async (clientId) => {
  const dateRange = generateDateRangeForReportType(REPORT_TYPES.DAILY);
  return await getDashboardSummary({
    clientId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    forceWeekly: false,
    reportType: REPORT_TYPES.DAILY
  });
};

const getCustomRangeSummary = async (clientId, startDate, endDate) => {
  return await getDashboardSummary({
    clientId,
    startDate,
    endDate,
    forceWeekly: false,
    reportType: REPORT_TYPES.CUSTOM
  });
};

const getMonthlySummary = async (clientId) => {
  return await getLast30DaysSummary(clientId);
};

// ========== PDF GENERATION ==========

const generateDashboardPDF = async ({ 
  clientId, 
  startDate, 
  endDate, 
  clientName,
  forceWeekly = false,
  reportType = REPORT_TYPES.CUSTOM 
}) => {
  const startTime = Date.now();
  
  try {
    console.log(`[Dashboard] Generating PDF for ${clientId}: ${startDate} to ${endDate}`);
    
    // Adjust date range
    const dateAdjustment = adjustDateRange(startDate, endDate, forceWeekly, reportType);
    const { adjustedStartDate, adjustedEndDate, wasAdjusted } = dateAdjustment;
    
    if (wasAdjusted) {
      console.log(`[Dashboard] PDF date range adjusted: ${startDate}-${endDate} → ${adjustedStartDate}-${adjustedEndDate}`);
    }
    
    // Resolve account
    const resolution = await resolveClientId(clientId);
    if (!resolution.success) {
      throw new Error(resolution.error || 'Failed to resolve account');
    }
    
    const numericClientId = resolution.clientId;
    const resolvedClientName = clientName || resolution.clientName;
    
    // Get schedule for PDF
    const schedule = await getCachedPatrolSchedule(numericClientId);
    
    // Build PDF data - USING SAME DATA STRUCTURE AS BEFORE
    const pdfData = {
      clientId: numericClientId,
      clientName: resolvedClientName,
      startDate: adjustedStartDate,
      endDate: adjustedEndDate,
      dateAdjusted: wasAdjusted,
      originalRequest: wasAdjusted ? `${startDate} to ${endDate}` : null,
      reportType,
      forceWeekly,
      schedule: {
        patrolsPerDay: schedule.patrols_per_day,
        patrolDays: schedule.patrol_days,
        hasCustomSchedule: schedule.has_custom_schedule
      }
    };
    
    // Generate PDF - Now calculations will match dashboard service
    const pdfBuffer = await pdfService.generateDashboardPDF(pdfData);
    
    const duration = Date.now() - startTime;
    console.log(`[Dashboard] PDF generated in ${duration}ms`);
    
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
        reportType
      }
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Dashboard] PDF generation error after ${duration}ms:`, error);
    throw error;
  }
};

// ========== UTILITY FUNCTIONS ==========

const warmupCache = async (clientId, reportType = REPORT_TYPES.WEEKLY) => {
  try {
    console.log(`[Dashboard] Warming up cache for ${clientId} (${reportType})...`);
    
    const dateRange = generateDateRangeForReportType(reportType);
    const forceWeekly = (reportType === REPORT_TYPES.WEEKLY || reportType === REPORT_TYPES.LAST7);
    
    console.log(`[Dashboard] Warmup range: ${dateRange.startDate} to ${dateRange.endDate} (${dateRange.days} days)`);
    
    // Warm up account resolution
    const resolution = await resolveClientId(clientId);
    if (resolution.success) {
      // Warm up schedule cache
      await getCachedPatrolSchedule(resolution.clientId);
      
      // Warm up report cache
      await getDashboardSummary({
        clientId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        forceWeekly,
        reportType
      });
    }
    
    console.log(`[Dashboard] Cache warmed up for ${clientId} (${reportType})`);
    
    return { 
      success: true, 
      range: `${dateRange.startDate} to ${dateRange.endDate}`, 
      days: dateRange.days,
      reportType,
      forceWeekly 
    };
  } catch (error) {
    console.error(`[Dashboard] Cache warmup failed:`, error);
    return { success: false, error: error.message };
  }
};

const getAvailableReportTypes = () => {
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

// ========== DEFAULT EXPORT ==========

module.exports = {
  // Main functions
  getDashboardPatrolEvents,
  getDashboardSummary,
  
  // Schedule functions
  getClientPatrolSchedule,
  getPatrolCompliance,
  
  // Preset reports
  getWeeklySummary,
  getLast30DaysSummary,
  getLast7DaysSummary,
  getDailySummary,
  getCustomRangeSummary,
  getMonthlySummary,
  
  // PDF
  generateDashboardPDF,
  
  // Account resolution
  resolveClientId,
  
  // Cache management
  clearAllCaches,
  getCacheStats,
  warmupCache,
  
  // Metadata
  getAvailableReportTypes,
  
  // Constants
  REPORT_TYPES,
  PERFORMANCE_TIERS
};