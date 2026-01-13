// server/models/reportModelOptimized.js - FLEXIBLE SHIFT-BASED MODEL WITH INCIDENT MODEL INTEGRATION
process.env.TZ = 'Africa/Nairobi';
console.log('🔧 FORCED TZ:', process.env.TZ);

import { sql, poolPromise } from "../config/database.js";
import { getClientSchedule, getPatrolScheduleConfig } from "../scripts/managePatrolSchedules.js";
import bmSecurityAPI from "../service/bmSecurityAPI.js";
import { getCachedPatrolEvents } from '../service/bmSecurityAPICache.js';
import { getIncidentCount } from './incidentModel.js'; // ✅ IMPORT INCIDENT MODEL
import dayjs from "dayjs";
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import isBetween from 'dayjs/plugin/isBetween.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);
dayjs.extend(isBetween);

// ========== FLEXIBLE CONFIGURATION ==========
const TZ = process.env.TZ || 'Africa/Nairobi';
const USE_API = process.env.USE_BMSECURITY_API !== 'false';
const DB_CACHE_TTL = 60000;

// ✅ SHIFT CONFIGURATION (PATROL DAY = 18:00 → 06:00 NEXT DAY)
const SHIFT_START_HOUR = 18; // 18:00
const SHIFT_END_HOUR = 6;    // 06:00 next day
const PATROLS_PER_DAY_PER_POST = 11;
const DEFAULT_REPORT_TYPES = {
  WEEKLY: 'weekly',
  CUSTOM: 'custom',
  DAILY: 'daily',
  MONTHLY: 'monthly'
};

// ✅ CANONICAL EVENT CODES - SINGLE SOURCE OF TRUTH
const PATROL_ARRIVAL_CODE = 'V04';   // Patrol arrival (PERFORMANCE METRIC)
// V03 incidents now handled by incidentModel.js - removed from here

// 📦 Caching
const zoneMapCache = new Map();
const eventMapCache = { data: null, timestamp: 0 };
const scheduleCache = new Map();

// 📋 Logger
const logger = {
  level: process.env.LOG_LEVEL || 'info',
  
  log(level, ...args) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levels[level] >= (levels[this.level] || 1)) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level.toUpperCase()}]`, ...args);
    }
  },
  
  info(...args) { this.log('info', ...args); },
  warn(...args) { this.log('warn', ...args); },
  error(...args) { this.log('error', ...args); },
  debug(...args) { this.log('debug', ...args); }
};

// ========== FLEXIBLE HELPER FUNCTIONS ==========

/**
 * ✅ Parse event date properly
 */
function parseEventDate(rawDate) {
  if (!rawDate) return null;
  
  try {
    let parsed = dayjs.utc(rawDate);
    if (parsed.isValid()) {
      return parsed.tz(TZ, true);
    }
    
    parsed = dayjs(rawDate);
    if (parsed.isValid()) {
      return parsed.tz(TZ, true);
    }
    
    const formats = [
      'YYYY-MM-DD HH:mm:ss',
      'DD/MM/YYYY HH:mm:ss',
      'MM-DD-YYYY HH:mm:ss',
      'YYYY-MM-DDTHH:mm:ss',
      'YYYY-MM-DD'
    ];
    
    for (const format of formats) {
      parsed = dayjs(rawDate, format);
      if (parsed.isValid()) {
        return parsed.tz(TZ, true);
      }
    }
    
    return null;
  } catch (error) {
    logger.warn(`Date parsing error: ${rawDate}`, error.message);
    return null;
  }
}

/**
 * ✅ FIXED: SHIFT-BASED DATE RANGE FOR ANY DURATION
 */
function validateAndFormatDates(startDate, endDate, reportType = DEFAULT_REPORT_TYPES.CUSTOM) {
  try {
    // Parse user input dates
    const start = dayjs.tz(startDate, TZ).startOf('day');
    const end = dayjs.tz(endDate, TZ).startOf('day');
    
    if (!start.isValid() || !end.isValid()) {
      throw new Error("Invalid date format provided");
    }
    
    if (end.isBefore(start)) {
      throw new Error("End date cannot be before start date");
    }
    
    // ✅ Calculate SHIFT DAYS instead of calendar days
    const shiftDays = end.diff(start, 'day') + 1;

    if (shiftDays <= 0) {
      throw new Error(`Invalid shiftDays calculation: ${shiftDays}`);
    }    
    
    // For weekly reports, warn but don't enforce
    if (reportType === DEFAULT_REPORT_TYPES.WEEKLY && shiftDays !== 7) {
      logger.warn(`⚠️ Weekly report expected 7 shift days, but got ${shiftDays} shift days`);
    }
    
    logger.info(`✅ VALIDATED: ${reportType.toUpperCase()} report = ${shiftDays} shift days`);
    
    // 🚨 SHIFT-BASED QUERY RANGE
    const queryStart = start.hour(SHIFT_START_HOUR).minute(0).second(0);
    const queryEnd = end.add(1, 'day')
                        .hour(SHIFT_END_HOUR)
                        .minute(0)
                        .second(0);
    
    logger.info(`🕕 SHIFT-BASED QUERY:`);
    logger.info(`   Selected dates: ${start.format('DD/MM/YYYY')} → ${end.format('DD/MM/YYYY')}`);
    logger.info(`   Query range:    ${queryStart.format('DD/MM/YYYY HH:mm')} → ${queryEnd.format('DD/MM/YYYY HH:mm')}`);
    logger.info(`   Shift days:     ${shiftDays} days (18:00→06:00)`);
    
    // Convert to UTC for database query
    const startDateTime = queryStart.utc().toDate();
    const endDateTime = queryEnd.utc().toDate();
    
    return {
      startDateTime,
      endDateTime,
      queryStart,
      queryEnd,
      shiftDays,
      displayStart: start.format('DD/MM/YYYY'),
      displayEnd: end.format('DD/MM/YYYY'),
      reportType,
      isValid: true
    };
    
  } catch (error) {
    logger.error("Date validation error:", error.message);
    throw error;
  }
}

/**
 * ✅ FIXED BUSINESS RULE: Generate date range for common report types
 * Weekly must always = 7 shift days
 * Monthly must always = 30 or 31 shift days (depending on month)
 * Both must end at today's morning (current shift end)
 */
function generateDateRangeForReportType(reportType, endDate = null) {
  const now = endDate ? dayjs.tz(endDate, TZ) : dayjs.tz(TZ);

  // Shift day boundary: before 06:00 still counts as yesterday
  let effectiveDay = now;
  if (now.hour() < SHIFT_END_HOUR) {
    effectiveDay = now.subtract(1, 'day');
  }

  const end = effectiveDay.startOf('day');

  switch (reportType.toLowerCase()) {
    case 'daily': {
      const day = end.subtract(1, 'day');
      return {
        startDate: day.format('YYYY-MM-DD'),
        endDate: day.format('YYYY-MM-DD')
      };
    }

    case 'weekly': {
      // EXACTLY 7 shift days window
      const start = end.subtract(6, 'day'); // inclusive = 7 days
      return {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD')
      };
    }

    case 'monthly': {
      // EXACT rolling month window (30 or 31 depending on previous month)
      const daysInWindow = end.daysInMonth(); // number of days in the CURRENT ending month
      const start = end.subtract(daysInWindow - 1, 'day'); // inclusive window
      return {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD')
      };
    }

    case 'last7days':
      const last7Start = end.subtract(6, 'day');
      return {
        startDate: last7Start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD')
      };
      
    case 'last30days':
      const last30Start = end.subtract(29, 'day');
      return {
        startDate: last30Start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD')
      };
      
    case 'lastmonth':
      const lastMonth = end.subtract(1, 'month');
      const lastMonthStart = lastMonth.startOf('month');
      const lastMonthEnd = lastMonth.endOf('month');
      return {
        startDate: lastMonthStart.format('YYYY-MM-DD'),
        endDate: lastMonthEnd.format('YYYY-MM-DD')
      };
      
    default:
      throw new Error(`Unsupported report type: ${reportType}`);
  }
}

/**
 * ✅ SHIFT-AWARE EVENT FILTERING FOR PATROLS ONLY
 */
function filterEventsByDateRange(events, dates) {
  const filteredEvents = [];
  const skippedEvents = [];
  
  for (const event of events) {
    try {
      const eventDate = parseEventDate(event.rec_tfechahora);
      
      if (!eventDate || !eventDate.isValid()) {
        skippedEvents.push({ reason: 'Invalid date', eventId: event.rec_iid });
        continue;
      }
      
      // ✅ SHIFT-BASED COMPARISON: Exact time range
      const isWithinRange = eventDate.isBetween(
        dates.queryStart, 
        dates.queryEnd, 
        null, 
        '[)'
      );
      
      if (isWithinRange) {
        filteredEvents.push(event);
      } else {
        skippedEvents.push({ 
          reason: 'Outside shift window', 
          eventId: event.rec_iid,
          eventDate: eventDate.format('DD/MM/YYYY HH:mm'),
          windowStart: dates.queryStart.format('DD/MM/YYYY HH:mm'),
          windowEnd: dates.queryEnd.format('DD/MM/YYYY HH:mm')
        });
      }
      
    } catch (error) {
      logger.debug(`Error processing event date:`, error.message);
      skippedEvents.push({ reason: 'Processing error', error: error.message });
    }
  }
  
  // Log skipped events for debugging
  if (skippedEvents.length > 0 && logger.level === 'debug') {
    logger.debug(`📅 Skipped ${skippedEvents.length} events:`);
    skippedEvents.slice(0, 5).forEach(skipped => {
      logger.debug(`   ${skipped.reason}: ${skipped.eventId || 'N/A'}`);
    });
  }
  
  logger.info(`📅 Filtered events: ${events.length} total, ${filteredEvents.length} within shift window, ${skippedEvents.length} skipped`);
  
  return filteredEvents;
}

/**
 * ✅ V04 PATROL COUNTER
 */
function countV04Patrols(events) {
  const counts = new Map();

  for (const event of events) {
    try {
      const alarm = (event.rec_calarma || '').toString().trim().toUpperCase();
      const zone = String(event.rec_czona || '').trim();
      
      // Only count V04 patrols
      if (alarm !== PATROL_ARRIVAL_CODE || !zone) {
        continue;
      }
      
      counts.set(zone, (counts.get(zone) || 0) + 1);
    } catch (error) {
      // Skip malformed events
    }
  }

  logger.info(`🔢 V04 Patrols counted: ${Array.from(counts.values()).reduce((a,b)=>a+b,0)} from ${counts.size} zones`);
  return counts;
}

/**
 * ✅ API EVENT PROCESSING - V04 ONLY NOW
 */
function processAllAPIEvents(apiEvents, clientId) {
  const allEvents = []; // Only V04 patrols
  
  for (const event of apiEvents) {
    try {
      const eventClientId = event.rec_iidcuenta || event.cue_iid || event.clientId;
      const zoneCode = (event.rec_czona || event.zon_ccodigo || event.zone_code || '').toString().trim();
      const alarmCode = (event.rec_calarma || event.alarm_code || '').toString().trim().toUpperCase();
      
      // Skip if no client ID or zone
      if (!eventClientId || !zoneCode) continue;
      
      const eventClientIdNum = parseInt(eventClientId);
      const targetClientIdNum = parseInt(clientId);
      
      // Filter by client
      if (eventClientIdNum !== targetClientIdNum) continue;
      
      // ✅ ONLY PROCESS V04 PATROLS - V03 NOW HANDLED BY incidentModel.js
      if (alarmCode !== PATROL_ARRIVAL_CODE) continue;
      
      const mappedEvent = {
        rec_iid: event.rec_iid || event.Id,
        rec_iidcuenta: targetClientIdNum,
        rec_czona: zoneCode,
        rec_tfechahora: event.rec_tfechahora || event.fecha,
        rec_cContenido: event.rec_cContenido || event.content,
        rec_calarma: alarmCode,
        rec_iusuario: event.rec_iusuario || event.usuario,
        rec_cObservaciones: event.rec_cObservaciones || event.observaciones || ''
      };
      
      allEvents.push(mappedEvent);
      
    } catch (error) {
      // Skip malformed events
    }
  }
  
  // Use canonical counter for V04 patrols
  const completedCounts = countV04Patrols(allEvents);
  
  logger.info(`📊 Processed: ${allEvents.length} V04 patrol events`);
  
  return { events: allEvents, completedCounts };
}

/**
 * 📍 Fetch all security posts
 */
async function fetchAllSecurityPosts(clientId) {
  const cacheKey = `allposts_${clientId}`;
  const cached = zoneMapCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < DB_CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const pool = await poolPromise;
    const postsResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          zon_ccodigo AS ZoneCode,
          LTRIM(RTRIM(zon_cdescripcion)) AS ZoneName
        FROM [_Datos].[dbo].[m_zonas]
        WHERE zon_iidcuenta = @clientId
          AND zon_cdescripcion IS NOT NULL
          AND zon_cdescripcion != ''
        ORDER BY zon_cdescripcion
      `);

    const allPosts = [];
    postsResult.recordset.forEach(zone => {
      if (zone.ZoneCode && zone.ZoneName) {
        allPosts.push({
          zoneCode: String(zone.ZoneCode).trim(),
          zoneName: String(zone.ZoneName).trim()
        });
      }
    });

    zoneMapCache.set(cacheKey, { data: allPosts, timestamp: Date.now() });
    return allPosts;
  } catch (error) {
    logger.error(`Error fetching security posts:`, error.message);
    return [];
  }
}

/**
 * 🗺️ Fetch site post names
 */
async function fetchSitePostNames(clientId) {
  const cacheKey = `zones_${clientId}`;
  const cached = zoneMapCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < DB_CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const pool = await poolPromise;
    const postsResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          zon_ccodigo AS ZoneCode,
          LTRIM(RTRIM(zon_cdescripcion)) AS ZoneName
        FROM [_Datos].[dbo].[m_zonas]
        WHERE zon_iidcuenta = @clientId
          AND zon_cdescripcion IS NOT NULL
          AND zon_cdescripcion != ''
        ORDER BY zon_cdescripcion
      `);

    const postMap = new Map();
    postsResult.recordset.forEach(zone => {
      if (zone.ZoneCode && zone.ZoneName) {
        const cleanZoneCode = String(zone.ZoneCode).trim();
        const cleanZoneName = String(zone.ZoneName).trim();
        postMap.set(cleanZoneCode, cleanZoneName);
      }
    });

    zoneMapCache.set(cacheKey, { data: postMap, timestamp: Date.now() });
    return postMap;
  } catch (error) {
    logger.error(`Error fetching site post names:`, error.message);
    return new Map();
  }
}

/**
 * 📊 Calculate performance metrics
 */
function calculatePerformance(allPosts, completedCounts, expectedPatrolsPerPost) {
  const performanceData = [];
  let totalCompleted = 0;
  let totalExpected = 0;
  let underperformingZones = 0;
  let excellentZones = 0;
  
  for (const post of allPosts) {
    const postName = post.zoneName;
    const postCode = post.zoneCode;
    
    // Use V04 counts only
    let completed = completedCounts.get(postCode) || 0;
    
    // Fallback matching for zone codes
    if (completed === 0) {
      for (const [key, count] of completedCounts) {
        if (key.trim() === postCode) {
          completed = count;
          break;
        }
      }
    }
    
    const expected = expectedPatrolsPerPost;
    const percentage = expected > 0 ? ((completed / expected) * 100) : 0;
    const percentageDisplay = Math.round(percentage) + '%';
    
    if (percentage < 70) underperformingZones++;
    if (percentage >= 90) excellentZones++;
    
    performanceData.push({
      SecurityPost: postName,
      ZoneCode: postCode,
      Completed: completed,
      Expected: expected,
      Performance: Math.round(percentage),
      Percentage: percentageDisplay
    });
    
    totalCompleted += Number(completed) || 0;
    totalExpected += expected;
  }
  
  const overallRateNumeric = totalExpected > 0 ? ((totalCompleted / totalExpected) * 100) : 0;
  const overallRateDisplay = Math.round(overallRateNumeric);

  logger.info(`📊 Performance: ${totalCompleted}/${totalExpected} V04 patrols = ${overallRateDisplay}%`);

  return {
    performanceData,
    totalCompleted,
    totalExpected,
    overallRateNumeric,
    overallRate: overallRateDisplay,
    underperformingZones,
    excellentZones,
    totalZones: performanceData.length
  };
}

/**
 * 🌐 Fetch events from API - V04 ONLY
 */
async function fetchPatrolEventsFromAPI(clientId, startDate, endDate) {
  try {
    const accountNumber = null;
    
    // Use cached API call
    const apiResult = await getCachedPatrolEvents(
      clientId, 
      startDate, 
      endDate, 
      accountNumber
    );
    
    if (!apiResult.success || !apiResult.data) {
      throw new Error('API returned no data');
    }
    
    // Log cache performance
    if (apiResult.fromCache) {
      const ageSeconds = Math.round(apiResult.cacheAge / 1000);
      logger.info(`✅ API Cache Hit (${apiResult.cacheTier}): ${apiResult.data.length} events (${ageSeconds}s old)`);
    } else {
      const durationSeconds = Math.round(apiResult.fetchDuration / 1000);
      logger.info(`✅ API Fresh Fetch: ${apiResult.data.length} events (${durationSeconds}s)`);
    }
    
    const clientEvents = apiResult.data;
    logger.info(`✅ API: ${clientEvents.length} events for client ${clientId}`);
    
    if (clientEvents.length === 0) {
      logger.warn(`⚠️ No events found for client ${clientId}`);
      return { 
        events: [], 
        completedCounts: new Map() 
      };
    }
    
    // Process using canonical logic (V04 only now)
    const processedData = processAllAPIEvents(clientEvents, clientId);
    
    return processedData;
    
  } catch (error) {
    logger.error(`❌ API fetch error:`, error.message);
    throw error;
  }
}

/**
 * 🗃️ Fetch events from database - V04 ONLY NOW
 */
async function fetchAllEventsFromDB(clientId, startDate, endDate, receptionTables = ['p_recepcion202512', 'p_recepcion202511']) {
  const validTables = receptionTables.filter(table => /^p_recepcion\d{6}$/.test(table));
  
  if (validTables.length === 0) {
    logger.warn('No valid partition tables found');
    return { patrolEvents: [], completedCounts: new Map() };
  }
  
  try {
    const pool = await poolPromise;
    
    const unions = validTables.map(table => 
      `SELECT 
        rec_iid,
        rec_iidcuenta,
        rec_czona,
        rec_tfechahora,
        rec_cContenido,
        rec_calarma,
        rec_cObservaciones
       FROM [_Datos].[dbo].[${table}]
       WHERE rec_iidcuenta = @clientId
         AND rec_tfechahora BETWEEN @startDate AND @endDate
         AND rec_calarma = '${PATROL_ARRIVAL_CODE}'` // ✅ ONLY V04 NOW
    ).join('\nUNION ALL\n');

    const query = `${unions} ORDER BY rec_tfechahora`;
    
    const result = await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('startDate', sql.DateTime, startDate)
      .input('endDate', sql.DateTime, endDate)
      .query(query);
    
    const patrolEvents = result.recordset || [];
    
    // Use canonical counter for V04 patrols
    const completedCounts = countV04Patrols(patrolEvents);
    
    logger.info(`✅ Database: ${Array.from(completedCounts.values()).reduce((a,b)=>a+b,0)} V04 patrols`);
    
    return { patrolEvents, completedCounts };
    
  } catch (error) {
    logger.error(`Error fetching events from database:`, error.message);
    return { patrolEvents: [], completedCounts: new Map() };
  }
}

/**
 * 📝 Fetch event descriptions
 */
async function fetchEventDescriptions() {
  if (eventMapCache.data && Date.now() - eventMapCache.timestamp < DB_CACHE_TTL) {
    return eventMapCache.data;
  }
  
  try {
    const pool = await poolPromise;
    const eventsResult = await pool.request().query(`
      SELECT 
        for_calarma AS AlarmCode,
        LTRIM(RTRIM(for_cdescripcion)) AS EventDescription
      FROM [_Datos].[dbo].[m_formatos]
      WHERE for_cdescripcion IS NOT NULL
        AND for_cdescripcion != ''
    `);

    const eventMap = new Map();
    eventsResult.recordset.forEach(event => {
      if (event.AlarmCode) {
        eventMap.set(event.AlarmCode.trim().toUpperCase(), event.EventDescription);
      }
    });

    eventMapCache.data = eventMap;
    eventMapCache.timestamp = Date.now();
    
    return eventMap;
  } catch (error) {
    logger.error(`Error fetching event descriptions:`, error.message);
    return new Map();
  }
}

/**
 * ✨ Format event data (V04 patrols only)
 */
function extractEventData(event, zoneMap, eventMap) {
  try {
    const parsedDate = parseEventDate(event.rec_tfechahora);
    
    let eventDate = 'N/A';
    let eventTime = 'N/A';
    
    if (parsedDate && parsedDate.isValid()) {
      eventDate = parsedDate.format('DD/MM/YYYY');
      eventTime = parsedDate.format('HH:mm:ss');
    }

    let zoneName = 'Unknown Post';
    if (event.rec_czona) {
      const zoneCode = String(event.rec_czona).trim();
      zoneName = zoneMap.get(zoneCode) || 
                 zoneMap.get(zoneCode.toUpperCase()) || 
                 zoneMap.get(zoneCode.toLowerCase()) ||
                 (zoneCode ? `Post ${zoneCode}` : 'Unknown Post');
    }

    const alarmCode = (event.rec_calarma || '').toString().trim().toUpperCase();
    
    // Format event description
    let eventDescription;
    if (alarmCode === PATROL_ARRIVAL_CODE) {
      eventDescription = 'VigiControl Arrival';
    } else if (eventMap.get(alarmCode)) {
      eventDescription = eventMap.get(alarmCode);
    } else {
      eventDescription = alarmCode || 'Unknown Event';
    }

    return {
      Date: eventDate,
      Time: eventTime,
      Event: eventDescription,
      Zone: zoneName,
      AlarmCode: alarmCode
    };
  } catch (error) {
    return {
      Date: 'N/A',
      Time: 'N/A',
      Event: 'Error Processing Event',
      Zone: 'Unknown Post'
    };
  }
}

/**
 * 🗓️ Get table names
 */
function getTableNames(startDateTime, endDateTime, usePartitions = true) {
  if (!usePartitions) {
    return ["p_recepcion"];
  }
  
  const start = dayjs(startDateTime);
  const end = dayjs(endDateTime);
  const tables = new Set();
  
  tables.add(`p_recepcion${start.format("YYYYMM")}`);
  
  let current = start.add(1, 'month').startOf('month');
  while (current.isBefore(end) || current.isSame(end, 'month')) {
    tables.add(`p_recepcion${current.format("YYYYMM")}`);
    current = current.add(1, 'month').startOf('month');
  }
  
  return Array.from(tables);
}

/**
 * ✅ FIXED: EXPECTED PATROLS USING SHIFT DAYS
 */
async function fetchClientScheduleAndExpectedPatrols(clientId, dates) {
  const cacheKey = `schedule_${clientId}_${dates.startDateTime.toISOString()}_${dates.endDateTime.toISOString()}`;
  const cached = scheduleCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < DB_CACHE_TTL) {
    return cached.data;
  }
  
  try {
    // Try to get custom schedule first
    const scheduleResult = await getPatrolScheduleConfig(clientId);
    
    let patrolsPerDay = PATROLS_PER_DAY_PER_POST;
    let shiftType = "24-Hour Coverage";
    let patrolDays = "Mon,Tue,Wed,Thu,Fri,Sat,Sun";
    let hasCustomSchedule = false;
    
    if (scheduleResult.success && scheduleResult.data) {
      const schedule = scheduleResult.data;
      patrolsPerDay = schedule.PatrolsPerDay || PATROLS_PER_DAY_PER_POST;
      shiftType = schedule.ShiftType || "24-Hour Coverage";
      patrolDays = schedule.PatrolDays || "Mon,Tue,Wed,Thu,Fri,Sat,Sun";
      hasCustomSchedule = schedule.HasCustomSchedule || false;
    } else {
      // Fallback
      const defaultSchedule = await getClientSchedule(clientId);
      patrolsPerDay = defaultSchedule.patrols_per_day || PATROLS_PER_DAY_PER_POST;
      shiftType = defaultSchedule.shift_type || "24-Hour Coverage";
      patrolDays = defaultSchedule.patrol_days || "Mon,Tue,Wed,Thu,Fri,Sat,Sun";
      hasCustomSchedule = defaultSchedule.has_custom_schedule || false;
    }
    
    // Expected patrols = shift days × patrols per day
    const expectedPatrolsPerPost = dates.shiftDays * patrolsPerDay;
    
    logger.info(`📅 EXPECTED PATROLS: ${dates.shiftDays} shift days × ${patrolsPerDay} patrols/day = ${expectedPatrolsPerPost} per post`);
    
    const result = {
      shiftType,
      expectedPatrolsPerPost,
      patrolsPerDay,
      patrolDays,
      hasCustomSchedule,
      scheduleInfo: `${patrolsPerDay} patrols/day per post (${SHIFT_START_HOUR}:00 - ${SHIFT_END_HOUR}:00 next day)`,
      shiftDays: dates.shiftDays,
      calculation: `${dates.shiftDays} shift days × ${patrolsPerDay} patrols/day = ${expectedPatrolsPerPost} per post`
    };
    
    scheduleCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
    
  } catch (error) {
    logger.error(`Error fetching schedule:`, error.message);
    
    // DEFAULT: Shift days × patrols per day
    const expectedPatrolsPerPost = dates.shiftDays * PATROLS_PER_DAY_PER_POST;
    
    const result = {
      shiftType: "24-Hour Coverage",
      expectedPatrolsPerPost,
      patrolsPerDay: PATROLS_PER_DAY_PER_POST,
      patrolDays: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
      hasCustomSchedule: false,
      scheduleInfo: `${PATROLS_PER_DAY_PER_POST} patrols/day per post (${SHIFT_START_HOUR}:00 - ${SHIFT_END_HOUR}:00 next day)`,
      shiftDays: dates.shiftDays,
      calculation: `${dates.shiftDays} shift days × ${PATROLS_PER_DAY_PER_POST} patrols/day = ${expectedPatrolsPerPost} per post`
    };
    
    scheduleCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }
}

/**
 * 🎯 Get client information
 */
async function getClientInfo(clientId) {
  try {
    const pool = await poolPromise;
    
    const result = await pool.request()
      .input("clientId", sql.Int, parseInt(clientId))
      .query(`
        SELECT 
          cue_cnombre AS name,
          cue_iid AS clientId,
          cue_ncuenta AS accountNumber
        FROM [_Datos].[dbo].[m_cuentas] 
        WHERE cue_iid = @clientId
      `);
    
    if (result.recordset.length > 0) {
      const client = result.recordset[0];
      return {
        clientName: client.name || 'Unknown',
        clientId: client.clientId,
        accountNumber: client.accountNumber ? String(client.accountNumber).trim() : null
      };
    } else {
      throw new Error(`Client not found with ID: ${clientId}`);
    }
  } catch (error) {
    logger.error("Client lookup error:", error.message);
    throw error;
  }
}

/**
 * ✅ INTEGRATED: FETCH INCIDENTS FROM INCIDENT MODEL
 */
async function fetchIncidentsFromModel(clientId, startDate, endDate) {
  try {
    logger.info(`🔍 Fetching incidents from incidentModel: ${startDate} → ${endDate}`);
    
    const incidentResult = await getIncidentCount(
      clientId,
      startDate,
      endDate
    );
    
    if (!incidentResult.success) {
      logger.warn(`⚠️ Incident model returned no data: ${incidentResult.error}`);
      return [];
    }
    
    logger.info(`✅ Incident model: ${incidentResult.totalIncidents} incidents found`);
    
    // Map incidents into report format
    const guardReports = incidentResult.incidents.map(incident => ({
      id: incident.id,
      date: incident.date, // Already formatted as 'DD/MM/YYYY HH:mm:ss'
      zone: incident.zone,
      report: incident.observations || incident.content || 'No details available',
      type: 'INCIDENT_REPORT'
    }));
    
    return guardReports;
    
  } catch (error) {
    logger.error(`❌ Error fetching incidents from model:`, error.message);
    return [];
  }
}

/**
 * 📊 MAIN: Fetch report - WITH INCIDENT MODEL INTEGRATION
 */
export const fetchPatrolReport = async (clientId, startDate, endDate, usePartitions = true, reportType = DEFAULT_REPORT_TYPES.CUSTOM) => {
  const reportStartTime = Date.now();
  
  try {
    logger.info(`🚀 Starting FLEXIBLE ${reportType.toUpperCase()} report for client ${clientId} from ${startDate} to ${endDate}`);

    if (!clientId || !startDate || !endDate) {
      throw new Error("Client ID, start date, and end date are required");
    }

    // ✅ FLEXIBLE: Accept any date range
    const dates = validateAndFormatDates(startDate, endDate, reportType);
    const clientInfo = await getClientInfo(clientId);
    
    logger.info(`✅ Client: ${clientInfo.clientName}`);
    logger.info(`✅ Patrol window: ${dates.displayStart} ${SHIFT_START_HOUR}:00 → ${dates.displayEnd} ${SHIFT_END_HOUR}:00`);

    const tableNames = getTableNames(dates.startDateTime, dates.endDateTime, usePartitions);
    
    // Get schedule (flexible based on shift days)
    const scheduleData = await fetchClientScheduleAndExpectedPatrols(clientId, dates);
    const expectedPatrolsPerPost = scheduleData.expectedPatrolsPerPost;
    
    logger.info(`📅 Expected: ${expectedPatrolsPerPost} patrols per post (${scheduleData.calculation})`);

    const [zoneMap, eventMap, allSecurityPosts] = await Promise.all([
      fetchSitePostNames(clientId),
      fetchEventDescriptions(),
      fetchAllSecurityPosts(clientId)
    ]);

    logger.info(`📊 Found ${allSecurityPosts.length} security posts`);

    // ✅ INTEGRATION: Fetch incidents from incidentModel
    let guardReports = [];
    const incidentFetchStart = Date.now();
    
    try {
      guardReports = await fetchIncidentsFromModel(clientId, startDate, endDate);
      logger.info(`✅ Incident fetch: ${guardReports.length} incidents (${Date.now() - incidentFetchStart}ms)`);
    } catch (incidentError) {
      logger.error(`⚠️ Incident fetch failed: ${incidentError.message}`);
      guardReports = []; // Continue with empty incidents
    }

    // Fetch patrol events (V04 only)
    let allEvents = [];
    let completedCounts = new Map();
    let dataSource = 'UNKNOWN';
    
    if (USE_API) {
      try {
        const apiData = await fetchPatrolEventsFromAPI(clientId, dates.startDateTime, dates.endDateTime);
        
        if (apiData.events.length === 0) {
          logger.warn(`⚠️ API returned no events, falling back to DB`);
          throw new Error('API returned empty data');
        }
        
        allEvents = apiData.events;
        completedCounts = apiData.completedCounts;
        dataSource = 'API';
      } catch (apiError) {
        logger.warn(`⚠️ API failed, falling back to DB: ${apiError.message}`);
        const dbData = await fetchAllEventsFromDB(clientId, dates.startDateTime, dates.endDateTime, tableNames);
        allEvents = dbData.patrolEvents;
        completedCounts = dbData.completedCounts;
        dataSource = 'DATABASE_FALLBACK';
      }
    } else {
      const dbData = await fetchAllEventsFromDB(clientId, dates.startDateTime, dates.endDateTime, tableNames);
      allEvents = dbData.patrolEvents;
      completedCounts = dbData.completedCounts;
      dataSource = 'DATABASE_DIRECT';
    }
    
    logger.info(`📅 Before filtering: ${allEvents.length} V04 patrol events`);
    
    // Filter patrols by shift window only (incidents already filtered by incidentModel)
    const filteredPatrols = filterEventsByDateRange(allEvents, dates);
    
    // Re-count V04 patrols after filtering
    completedCounts = countV04Patrols(filteredPatrols);

    logger.info(`✅ After filtering:`);
    logger.info(`   Patrols (V04): ${filteredPatrols.length} within shift window`);
    logger.info(`   Incidents (V03): ${guardReports.length} from incidentModel`);

    // Enhance zone matching for display
    const enhancedCounts = new Map();
    for (const [zoneCode, count] of completedCounts) {
      const cleanCode = String(zoneCode).trim();
      if (!cleanCode) continue;
      enhancedCounts.set(cleanCode, count);
      const zoneName = zoneMap.get(cleanCode);
      if (zoneName) enhancedCounts.set(zoneName, count);
    }

    // Process events for display (V04 patrols only)
    const processedEvents = filteredPatrols
      .map(event => extractEventData(event, zoneMap, eventMap))
      .filter(event => event.Date !== 'N/A' || event.Zone !== 'Unknown Post');

    // Calculate performance using V04 counts only
    const performanceResults = calculatePerformance(
      allSecurityPosts,
      enhancedCounts,
      expectedPatrolsPerPost
    );
    
    logger.info(`📊 Performance: ${performanceResults.overallRate}% (${performanceResults.totalCompleted}/${performanceResults.totalExpected} V04 patrols)`);

    // ✅ FIXED METADATA WITH SEPARATE SOURCES
    const totalTime = Date.now() - reportStartTime;
    const reportData = {
      posts: performanceResults.performanceData,
      events: processedEvents,        // V04 patrols only
      guardReports: guardReports,     // V03 incidents from incidentModel
      metadata: {
        // Report info
        reportType: reportType.toUpperCase(),
        patrolDefinition: {
          patrolCode: PATROL_ARRIVAL_CODE,
          patrolWindow: `${SHIFT_START_HOUR}:00 → ${SHIFT_END_HOUR}:00 next day`,
          patrolFiltering: 'Shift-based (18:00→06:00)',
          incidentFiltering: 'Calendar days via incidentModel.js',
          shiftDays: dates.shiftDays,
          patrolsPerDay: scheduleData.patrolsPerDay,
          expectedPatrolsPerPost: expectedPatrolsPerPost
        },
        
        // Client info
        clientId: parseInt(clientId),
        clientName: clientInfo.clientName,
        clientAccountNumber: clientInfo.accountNumber,
        
        // Date info
        startDate: dates.displayStart,
        endDate: dates.displayEnd,
        shiftDays: dates.shiftDays,
        
        // Performance metrics
        totalExpectedPatrols: expectedPatrolsPerPost * performanceResults.totalZones,
        totalCompleted: performanceResults.totalCompleted, // V04 ONLY
        overallPerformance: performanceResults.overallRate,
        patrolsPerDay: scheduleData.patrolsPerDay,
        expectedCalculation: scheduleData.calculation,
        
        // Incident metrics
        totalIncidents: guardReports.length,
        incidentSource: 'incidentModel.js',
        
        // System info
        generatedAt: new Date(),
        dataSource,
        usingAPI: USE_API,
        processingTime: totalTime,
        timezone: TZ,
        shiftWindow: `${SHIFT_START_HOUR}:00 - ${SHIFT_END_HOUR}:00 next day`,
        incidentWindow: '00:00 - 23:59 calendar days',
        dateRangeExplanation: `Patrol window: ${dates.displayStart} ${SHIFT_START_HOUR}:00 → ${dates.displayEnd} ${SHIFT_END_HOUR}:00`,
        
        // Data quality
        dataQuality: {
          isValid: true,
          reportType: reportType,
          postsCount: performanceResults.totalZones,
          patrolsCount: filteredPatrols.length,
          incidentsCount: guardReports.length,
          underperformingZones: performanceResults.underperformingZones,
          excellentZones: performanceResults.excellentZones,
          patrolsCounted: performanceResults.totalCompleted,
          separateSources: true,
          patrolsFrom: dataSource,
          incidentsFrom: 'incidentModel.js',
          shiftBased: true,
          shiftDays: dates.shiftDays,
          flexibleRange: true
        },
        success: true
      }
    };

    // ✅ FINAL SANITY CHECK
    const totalV04 = performanceResults.totalCompleted;
    const expectedTotal = expectedPatrolsPerPost * performanceResults.totalZones;
    const completionRate = expectedTotal > 0 ? (totalV04 / expectedTotal * 100) : 0;
    
    if (totalV04 === 0) {
      logger.warn(`⚠️ No V04 patrols found for selected shift window!`);
    } else if (completionRate < 30) {
      logger.warn(`⚠️ LOW: ${totalV04} V04 patrols, expected ${expectedTotal} (${Math.round(completionRate)}%)`);
    } else if (completionRate > 110) {
      logger.warn(`⚠️ HIGH: ${totalV04} V04 patrols, expected ${expectedTotal} (${Math.round(completionRate)}%)`);
    } else {
      logger.info(`✅ GOOD: ${totalV04} V04 patrols of ${expectedTotal} expected (${Math.round(completionRate)}%)`);
    }

    return reportData;

  } catch (error) {
    logger.error(`💥 Report generation failed:`, error.message);
    
    return {
      posts: [],
      events: [],
      guardReports: [],
      metadata: {
        reportType: 'ERROR',
        patrolDefinition: {
          patrolCode: PATROL_ARRIVAL_CODE,
          patrolWindow: `${SHIFT_START_HOUR}:00 → ${SHIFT_END_HOUR}:00 next day`,
          incidentWindow: '00:00 → 23:59 calendar days'
        },
        clientId: parseInt(clientId) || 0,
        clientName: 'Unknown',
        startDate: startDate,
        endDate: endDate,
        shiftDays: 0,
        totalExpectedPatrols: 0,
        totalCompleted: 0,
        overallPerformance: 0,
        patrolsPerDay: PATROLS_PER_DAY_PER_POST,
        generatedAt: new Date(),
        usingAPI: USE_API,
        processingTime: Date.now() - reportStartTime,
        error: { message: error.message },
        dataQuality: { 
          isValid: false, 
          separateSources: false,
          flexibleRange: false 
        },
        success: false
      }
    };
  }
};

// ========== API ENDPOINTS ==========

export const createPatrolReportAPI = (app) => {
  // Flexible report endpoint
  app.get('/api/reports/patrol', async (req, res) => {
    try {
      const { clientId, startDate, endDate, reportType = 'custom', usePartitions = 'true' } = req.query;
      
      if (!clientId || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters',
          note: 'Required: clientId, startDate, endDate'
        });
      }
      
      const usePartitionsBool = usePartitions === 'true';
      const reportData = await fetchPatrolReport(
        parseInt(clientId),
        startDate,
        endDate,
        usePartitionsBool,
        reportType
      );
      
      res.status(200).json({
        success: reportData.metadata.success,
        data: reportData,
        timestamp: new Date(),
        note: `Patrols from ${reportData.metadata.dataSource}, incidents from incidentModel.js`,
        sources: {
          patrols: reportData.metadata.dataSource,
          incidents: 'incidentModel.js'
        }
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        note: 'Patrol report generation failed'
      });
    }
  });
  
  // Preset report types
  app.get('/api/reports/:type', async (req, res) => {
    try {
      const { type } = req.params;
      const { clientId, endDate = null, usePartitions = 'true' } = req.query;
      
      if (!clientId) {
        return res.status(400).json({
          success: false,
          error: 'Client ID is required'
        });
      }
      
      // Generate date range based on report type
      const dateRange = generateDateRangeForReportType(type, endDate);
      
      const usePartitionsBool = usePartitions === 'true';
      const reportData = await fetchPatrolReport(
        parseInt(clientId),
        dateRange.startDate,
        dateRange.endDate,
        usePartitionsBool,
        type
      );
      
      res.status(200).json({
        success: reportData.metadata.success,
        data: reportData,
        timestamp: new Date(),
        generatedFor: type,
        dateRange: dateRange,
        sources: {
          patrols: reportData.metadata.dataSource,
          incidents: 'incidentModel.js'
        }
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        note: `Report generation failed for type: ${req.params.type}`
      });
    }
  });
};

// ========== COMPATIBILITY WRAPPERS ==========

/**
 * 📅 Weekly report wrapper (for backward compatibility)
 */
export const fetchWeeklyReport = async (clientId, startDate, endDate, usePartitions = true) => {
  return fetchPatrolReport(clientId, startDate, endDate, usePartitions, DEFAULT_REPORT_TYPES.WEEKLY);
};

export default {
  fetchPatrolReport,
  fetchWeeklyReport, // Backward compatibility
  createPatrolReportAPI,
  filterEventsByDateRange,
  countV04Patrols,
  DEFAULT_REPORT_TYPES,
  generateDateRangeForReportType
};