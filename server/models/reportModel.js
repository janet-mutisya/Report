// server/models/reportModel.js - FIXED VERSION
// ✅ FIXED: Daily reports now properly calculate shift days
// ✅ FIXED: Daily = 1 shift day (same start and end date represents ONE night shift)

process.env.TZ = 'Africa/Nairobi';
console.log('🔧 FORCED TZ:', process.env.TZ);

const { sql, poolPromise } = require("../config/database.js");
const { getClientSchedule, getPatrolScheduleConfig } = require("../scripts/managePatrolSchedules.js");
const bmSecurityAPI = require("../service/bmSecurityAPI.js");
const { getCachedPatrolEvents } = require('../service/bmSecurityAPICache.js');
const { getIncidentCount } = require('./incidentModel.js');
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore.js');
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter.js');
const isBetween = require('dayjs/plugin/isBetween.js');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);
dayjs.extend(isBetween);

// ========== CONFIGURATION ==========
const TZ = process.env.TZ || 'Africa/Nairobi';
const USE_API = process.env.USE_BMSECURITY_API !== 'false';
const DB_CACHE_TTL = 60000;

// ✅ SHIFT CONFIGURATION (NIGHT SHIFT ONLY)
const SHIFT_START_HOUR = 18; // 18:00
const SHIFT_END_HOUR = 6;    // 06:00 next day
const PATROLS_PER_DAY_PER_POST = 11;

// ✅ CANONICAL EVENT CODES
const PATROL_ARRIVAL_CODE = 'V04';   // Patrol arrival (PERFORMANCE METRIC)
const INCIDENT_CODE = 'V03';         // Incidents (handled by incidentModel.js)

const DEFAULT_REPORT_TYPES = {
  WEEKLY: 'weekly',
  CUSTOM: 'custom',
  DAILY: 'daily',
  MONTHLY: 'monthly'
};

// 📦 Caching
const zoneCache = new Map(); // Combined cache for posts and zone maps
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

// ========== HELPER FUNCTIONS ==========

/**
 * Parse event date properly
 */
function parseEventDate(rawDate) {
  if (!rawDate) return null;
  
  try {
    // Try UTC first
    let parsed = dayjs.utc(rawDate);
    if (parsed.isValid()) {
      return parsed.tz(TZ, true);
    }
    
    // Try local
    parsed = dayjs(rawDate);
    if (parsed.isValid()) {
      return parsed.tz(TZ, true);
    }
    
    // Try common formats
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
    logger.debug(`Date parsing error: ${rawDate}`, error.message);
    return null;
  }
}

/**
 * ✅ FIXED: SHIFT-BASED DATE RANGE WITH INCLUSIVE DAY COUNT
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
    
    // ✅ FIXED: Calculate SHIFT DAYS with INCLUSIVE count
    const daysDiff = end.diff(start, 'day');
    const shiftDays = daysDiff + 1; // Add 1 for inclusive counting

    if (shiftDays < 1) {
      throw new Error(`Invalid shiftDays calculation: ${shiftDays}`);
    }
    
    // Validate expected shift days for specific report types
    if (reportType === DEFAULT_REPORT_TYPES.WEEKLY && shiftDays !== 7) {
      logger.warn(`⚠️ Weekly report expected 7 shift days, but got ${shiftDays}`);
    }
    
    if (reportType === DEFAULT_REPORT_TYPES.DAILY && shiftDays !== 1) {
      logger.warn(`⚠️ Daily report expected 1 shift day, but got ${shiftDays}`);
    }
    
    logger.info(`✅ ${reportType.toUpperCase()} report: ${shiftDays} shift day(s)`);
    logger.info(`   Start: ${start.format('YYYY-MM-DD')}, End: ${end.format('YYYY-MM-DD')}, Diff: ${daysDiff} days`);
    
    // 🚨 SHIFT-BASED QUERY RANGE for PATROLS (V04)
    const patrolQueryStart = start.hour(SHIFT_START_HOUR).minute(0).second(0);
    const patrolQueryEnd = end.add(1, 'day')
                              .hour(SHIFT_END_HOUR)
                              .minute(0)
                              .second(0);
    
    // 🚨 CALENDAR-BASED QUERY RANGE for INCIDENTS (V03)
    const incidentQueryStart = start.hour(0).minute(0).second(0);
    const incidentQueryEnd = end.hour(23).minute(59).second(59);
    
    logger.info(`🕕 PATROL WINDOW (V04):`);
    logger.info(`   ${patrolQueryStart.format('DD/MM/YYYY HH:mm')} → ${patrolQueryEnd.format('DD/MM/YYYY HH:mm')}`);
    logger.info(`📅 INCIDENT WINDOW (V03):`);
    logger.info(`   ${incidentQueryStart.format('DD/MM/YYYY HH:mm')} → ${incidentQueryEnd.format('DD/MM/YYYY HH:mm')}`);
    
    // Convert to UTC for queries
    const patrolStartUTC = patrolQueryStart.utc().toDate();
    const patrolEndUTC = patrolQueryEnd.utc().toDate();
    const incidentStartUTC = incidentQueryStart.utc().toDate();
    const incidentEndUTC = incidentQueryEnd.utc().toDate();
    
    return {
      // For database/API queries
      patrolStartUTC,
      patrolEndUTC,
      incidentStartUTC,
      incidentEndUTC,
      
      // For filtering
      patrolQueryStart,
      patrolQueryEnd,
      incidentQueryStart,
      incidentQueryEnd,
      
      // Metadata
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
 * ✅ FIXED: Generate date range for common report types with better logging
 */
function generateDateRangeForReportType(reportType, endDate = null) {
  const now = endDate ? dayjs.tz(endDate, TZ) : dayjs.tz(TZ);

  // Determine last COMPLETED shift end
  let lastCompletedShiftEnd;
  if (now.hour() < SHIFT_END_HOUR) {
    // Before 06:00 - last completed shift ended yesterday morning
    lastCompletedShiftEnd = now.subtract(1, 'day').startOf('day');
  } else {
    // After 06:00 - last completed shift ended this morning
    lastCompletedShiftEnd = now.startOf('day');
  }

  // The report end date is the day BEFORE the last completed shift end
  // This represents the LAST NIGHT's shift
  const reportEndDate = lastCompletedShiftEnd.subtract(1, 'day');
  
  logger.info(`📅 Date Range Calculation:`);
  logger.info(`   Now: ${now.format('YYYY-MM-DD HH:mm')}`);
  logger.info(`   Last completed shift end: ${lastCompletedShiftEnd.format('YYYY-MM-DD')}`);
  logger.info(`   Report end date (last night): ${reportEndDate.format('YYYY-MM-DD')}`);
  
  switch (reportType.toLowerCase()) {
    case 'daily': {
      // ✅ FIXED: For a SINGLE shift (one night)
      // Start and end are THE SAME DATE
      // Example: Jan 27 → covers Jan 27 18:00 to Jan 28 06:00
      const shiftDay = reportEndDate;
      
      logger.info(`📊 DAILY report: ${shiftDay.format('YYYY-MM-DD')} (1 shift night)`);
      
      return {
        startDate: shiftDay.format('YYYY-MM-DD'),
        endDate: shiftDay.format('YYYY-MM-DD')
      };
    }

    case 'weekly': {
      // ✅ For SEVEN shifts (7 nights)
      // End is the last completed shift day
      // Start is 6 days BEFORE (inclusive count = 7 days)
      // Example: Jan 21-27 → 7 nights
      const end = reportEndDate;
      const start = end.subtract(6, 'day');
      
      logger.info(`📊 WEEKLY report: ${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')} (7 shift nights)`);
      
      return {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD')
      };
    }

    case 'monthly': {
      // ✅ For MONTHLY (all shifts in the month)
      const end = reportEndDate;
      const start = end.startOf('month');
      
      const monthDays = end.diff(start, 'day') + 1;
      logger.info(`📊 MONTHLY report: ${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')} (${monthDays} shift nights)`);
      
      return {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD')
      };
    }

    case 'last7days': {
      // Same as weekly
      const end = reportEndDate;
      const start = end.subtract(6, 'day');
      
      logger.info(`📊 LAST 7 DAYS report: ${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')} (7 shift nights)`);
      
      return {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD')
      };
    }
      
    case 'last30days': {
      const end = reportEndDate;
      const start = end.subtract(29, 'day');
      
      logger.info(`📊 LAST 30 DAYS report: ${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')} (30 shift nights)`);
      
      return {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD')
      };
    }
      
    case 'lastmonth': {
      const lastMonth = now.subtract(1, 'month');
      const start = lastMonth.startOf('month');
      const end = lastMonth.endOf('month');
      
      const monthDays = end.diff(start, 'day') + 1;
      logger.info(`📊 LAST MONTH report: ${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')} (${monthDays} shift nights)`);
      
      return {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD')
      };
    }
      
    default:
      throw new Error(`Unsupported report type: ${reportType}`);
  }
}

/**
 * ✅ SHIFT-AWARE EVENT FILTERING FOR V04 PATROLS ONLY
 */
function filterPatrolsByShiftWindow(events, dates) {
  const filteredEvents = [];
  const skippedEvents = [];
  
  for (const event of events) {
    try {
      const eventDate = parseEventDate(event.rec_tfechahora);
      
      if (!eventDate || !eventDate.isValid()) {
        skippedEvents.push({ reason: 'Invalid date', eventId: event.rec_iid });
        continue;
      }
      
      // ✅ Only include V04 patrols within shift window
      const alarmCode = (event.rec_calarma || '').toString().trim().toUpperCase();
      if (alarmCode !== PATROL_ARRIVAL_CODE) {
        skippedEvents.push({ reason: 'Not V04 patrol', alarmCode, eventId: event.rec_iid });
        continue;
      }
      
      // ✅ SHIFT-BASED COMPARISON
      const isWithinRange = eventDate.isBetween(
        dates.patrolQueryStart, 
        dates.patrolQueryEnd, 
        null, 
        '[)'
      );
      
      if (isWithinRange) {
        filteredEvents.push(event);
      } else {
        skippedEvents.push({ 
          reason: 'Outside patrol shift window', 
          alarmCode,
          eventId: event.rec_iid,
          eventDate: eventDate.format('DD/MM/YYYY HH:mm'),
          windowStart: dates.patrolQueryStart.format('DD/MM/YYYY HH:mm'),
          windowEnd: dates.patrolQueryEnd.format('DD/MM/YYYY HH:mm')
        });
      }
      
    } catch (error) {
      logger.debug(`Error processing event:`, error.message);
      skippedEvents.push({ reason: 'Processing error', error: error.message });
    }
  }
  
  if (skippedEvents.length > 0 && logger.level === 'debug') {
    logger.debug(`📅 Skipped ${skippedEvents.length} events for V04 patrols:`);
    skippedEvents.slice(0, 5).forEach(skipped => {
      logger.debug(`   ${skipped.reason}: ${skipped.alarmCode || 'N/A'} ${skipped.eventId || ''}`);
    });
  }
  
  logger.info(`📅 V04 Patrols: ${events.length} total, ${filteredEvents.length} within shift window`);
  
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
 * ✅ FETCH ZONE DATA - UNIFIED FUNCTION
 */
async function fetchZoneData(clientId) {
  const cacheKey = `zones_${clientId}`;
  const cached = zoneCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < DB_CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const pool = await poolPromise;
    const result = await pool.request()
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
    const zoneMap = new Map();
    
    result.recordset.forEach(zone => {
      if (zone.ZoneCode && zone.ZoneName) {
        const zoneCode = String(zone.ZoneCode).trim();
        const zoneName = String(zone.ZoneName).trim();
        
        allPosts.push({ zoneCode, zoneName });
        zoneMap.set(zoneCode, zoneName);
      }
    });

    const data = { allPosts, zoneMap };
    zoneCache.set(cacheKey, { data, timestamp: Date.now() });
    
    logger.info(`✅ Fetched ${allPosts.length} zones for client ${clientId}`);
    return data;
    
  } catch (error) {
    logger.error(`Error fetching zone data:`, error.message);
    return { allPosts: [], zoneMap: new Map() };
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
    const result = await pool.request().query(`
      SELECT 
        for_calarma AS AlarmCode,
        LTRIM(RTRIM(for_cdescripcion)) AS EventDescription
      FROM [_Datos].[dbo].[m_formatos]
      WHERE for_cdescripcion IS NOT NULL
        AND for_cdescripcion != ''
    `);

    const eventMap = new Map();
    result.recordset.forEach(event => {
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
function formatPatrolEvent(event, zoneMap, eventMap) {
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
      AlarmCode: alarmCode,
      Type: 'PATROL'
    };
  } catch (error) {
    return {
      Date: 'N/A',
      Time: 'N/A',
      Event: 'Error Processing Patrol Event',
      Zone: 'Unknown Post',
      Type: 'PATROL_ERROR'
    };
  }
}

/**
 * ✅ Fetch patrol events from database - V04 ONLY
 */
async function fetchPatrolEventsFromDB(clientId, startDate, endDate, receptionTables = ['p_recepcion202512', 'p_recepcion202511']) {
  const validTables = receptionTables.filter(table => /^p_recepcion\d{6}$/.test(table));
  
  if (validTables.length === 0) {
    logger.warn('No valid partition tables found');
    return { patrolEvents: [], completedCounts: new Map() };
  }
  
  try {
    const pool = await poolPromise;
    
    // ✅ ONLY FETCH V04 PATROLS
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
         AND rec_calarma = '${PATROL_ARRIVAL_CODE}'`
    ).join('\nUNION ALL\n');

    const query = `${unions} ORDER BY rec_tfechahora`;
    
    logger.debug(`Fetching V04 patrols from DB: ${query.split('FROM').slice(0, 2).join('FROM')}...`);
    
    const result = await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('startDate', sql.DateTime, startDate)
      .input('endDate', sql.DateTime, endDate)
      .query(query);
    
    const patrolEvents = result.recordset || [];
    const completedCounts = countV04Patrols(patrolEvents);
    
    logger.info(`✅ Database V04 Patrols: ${patrolEvents.length} events, ${Array.from(completedCounts.values()).reduce((a,b)=>a+b,0)} patrols counted`);
    
    return { patrolEvents, completedCounts };
    
  } catch (error) {
    logger.error(`Error fetching V04 patrols from database:`, error.message);
    return { patrolEvents: [], completedCounts: new Map() };
  }
}

/**
 * 🌐 Fetch patrol events from API - V04 ONLY
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
    
    if (apiResult.fromCache) {
      const ageSeconds = Math.round(apiResult.cacheAge / 1000);
      logger.info(`✅ API Cache Hit (${apiResult.cacheTier}): ${apiResult.data.length} events (${ageSeconds}s old)`);
    } else {
      const durationSeconds = Math.round(apiResult.fetchDuration / 1000);
      logger.info(`✅ API Fresh Fetch: ${apiResult.data.length} events (${durationSeconds}s)`);
    }
    
    const clientEvents = apiResult.data;
    logger.info(`✅ API: ${clientEvents.length} total events for client ${clientId}`);
    
    if (clientEvents.length === 0) {
      logger.warn(`⚠️ No events found for client ${clientId}`);
      return { patrolEvents: [], completedCounts: new Map() };
    }
    
    // ✅ FILTER V04 PATROLS ONLY from API response
    const v04Patrols = [];
    for (const event of clientEvents) {
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
        
        // ✅ ONLY PROCESS V04 PATROLS
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
        
        v04Patrols.push(mappedEvent);
      } catch (error) {
        // Skip malformed events
      }
    }
    
    // Count V04 patrols
    const completedCounts = countV04Patrols(v04Patrols);
    
    logger.info(`📊 Processed: ${v04Patrols.length} V04 patrol events from API`);
    
    return { patrolEvents: v04Patrols, completedCounts };
    
  } catch (error) {
    logger.error(`❌ API fetch error:`, error.message);
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
      return { incidents: [], total: 0 };
    }
    
    logger.info(`✅ Incident model: ${incidentResult.totalIncidents} incidents found`);
    
    // Format incidents for report
    const formattedIncidents = incidentResult.incidents.map(incident => {
      return {
        id: incident.id,
        date: incident.date, // Already formatted as 'DD/MM/YYYY HH:mm:ss'
        zone: incident.zone,
        report: incident.observations || incident.content || 'No details available',
        type: 'INCIDENT_REPORT',
        alarmCode: INCIDENT_CODE
      };
    });
    
    return { incidents: formattedIncidents, total: incidentResult.totalIncidents };
    
  } catch (error) {
    logger.error(`❌ Error fetching incidents from model:`, error.message);
    return { incidents: [], total: 0 };
  }
}

/**
 * 📊 Calculate performance metrics for V04 patrols
 */
function calculatePerformance(allPosts, patrolCounts, expectedPatrolsPerPost) {
  const performanceData = [];
  let totalCompleted = 0;
  let totalExpected = 0;
  let underperformingZones = 0;
  let excellentZones = 0;
  
  for (const post of allPosts) {
    const postName = post.zoneName;
    const postCode = post.zoneCode;
    
    // Get V04 patrol count for this zone
    let completed = patrolCounts.get(postCode) || 0;
    
    // Fallback matching for zone codes
    if (completed === 0) {
      for (const [key, count] of patrolCounts) {
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
      Percentage: percentageDisplay,
      Type: 'PATROL_PERFORMANCE'
    });
    
    totalCompleted += Number(completed) || 0;
    totalExpected += expected;
  }
  
  const overallRateNumeric = totalExpected > 0 ? ((totalCompleted / totalExpected) * 100) : 0;
  const overallRateDisplay = Math.round(overallRateNumeric);

  logger.info(`📊 V04 Patrol Performance: ${totalCompleted}/${totalExpected} patrols = ${overallRateDisplay}%`);

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
 * 🗓️ Get table names for partitions
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
  const cacheKey = `schedule_${clientId}_${dates.patrolStartUTC.toISOString()}_${dates.patrolEndUTC.toISOString()}`;
  const cached = scheduleCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < DB_CACHE_TTL) {
    return cached.data;
  }
  
  try {
    // Try to get custom schedule first
    const scheduleResult = await getPatrolScheduleConfig(clientId);
    
    let patrolsPerDay = PATROLS_PER_DAY_PER_POST;
    let shiftType = "Night Shift Only";
    let patrolDays = "Mon,Tue,Wed,Thu,Fri,Sat,Sun";
    let hasCustomSchedule = false;
    
    if (scheduleResult.success && scheduleResult.data) {
      const schedule = scheduleResult.data;
      patrolsPerDay = schedule.PatrolsPerDay || PATROLS_PER_DAY_PER_POST;
      shiftType = schedule.ShiftType || "Night Shift Only";
      patrolDays = schedule.PatrolDays || "Mon,Tue,Wed,Thu,Fri,Sat,Sun";
      hasCustomSchedule = schedule.HasCustomSchedule || false;
    } else {
      // Fallback
      const defaultSchedule = await getClientSchedule(clientId);
      patrolsPerDay = defaultSchedule.patrols_per_day || PATROLS_PER_DAY_PER_POST;
      shiftType = defaultSchedule.shift_type || "Night Shift Only";
      patrolDays = defaultSchedule.patrol_days || "Mon,Tue,Wed,Thu,Fri,Sat,Sun";
      hasCustomSchedule = defaultSchedule.has_custom_schedule || false;
    }
    
    // ✅ FIXED: Expected patrols = shift days × patrols per day
    const expectedPatrolsPerPost = dates.shiftDays * patrolsPerDay;
    
    logger.info(`📅 EXPECTED V04 PATROLS: ${dates.shiftDays} shift days × ${patrolsPerDay} patrols/day = ${expectedPatrolsPerPost} per post`);
    
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
      shiftType: "Night Shift Only",
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
 * 📊 MAIN: Fetch report - WITH CLEAR SEPARATION OF V04 PATROLS AND V03 INCIDENTS
 */
const fetchPatrolReport = async (clientId, startDate, endDate, usePartitions = true, reportType = DEFAULT_REPORT_TYPES.CUSTOM) => {
  const reportStartTime = Date.now();
  
  try {
    logger.info(`🚀 Starting ${reportType.toUpperCase()} report for client ${clientId}`);
    logger.info(`   Dates: ${startDate} to ${endDate}`);

    if (!clientId || !startDate || !endDate) {
      throw new Error("Client ID, start date, and end date are required");
    }

    // ✅ Get validated dates with separate windows for patrols and incidents
    const dates = validateAndFormatDates(startDate, endDate, reportType);
    const clientInfo = await getClientInfo(clientId);
    
    logger.info(`✅ Client: ${clientInfo.clientName}`);
    logger.info(`✅ Shift days: ${dates.shiftDays}`);

    const tableNames = getTableNames(dates.patrolStartUTC, dates.patrolEndUTC, usePartitions);
    
    // Get schedule for V04 patrols
    const scheduleData = await fetchClientScheduleAndExpectedPatrols(clientId, dates);
    const expectedPatrolsPerPost = scheduleData.expectedPatrolsPerPost;
    
    logger.info(`📅 Expected V04 Patrols: ${expectedPatrolsPerPost} per post (${scheduleData.calculation})`);

    // Fetch zone data and event descriptions in parallel
    const [zoneData, eventMap] = await Promise.all([
      fetchZoneData(clientId),
      fetchEventDescriptions()
    ]);

    logger.info(`📊 Found ${zoneData.allPosts.length} security posts`);

    // ✅ PARALLEL FETCH: V04 Patrols and V03 Incidents
    let patrolEvents = [];
    let patrolCounts = new Map();
    let dataSource = 'UNKNOWN';
    let incidentData = { incidents: [], total: 0 };
    
    // Fetch patrols (V04) and incidents (V03) in parallel
    const [patrolResult, incidentResult] = await Promise.allSettled([
      // Fetch V04 Patrols
      (async () => {
        if (USE_API) {
          try {
            const apiData = await fetchPatrolEventsFromAPI(clientId, dates.patrolStartUTC, dates.patrolEndUTC);
            if (apiData.patrolEvents.length === 0) {
              throw new Error('API returned empty V04 patrol data');
            }
            dataSource = 'API';
            return apiData;
          } catch (apiError) {
            logger.warn(`⚠️ API failed for V04 patrols, falling back to DB: ${apiError.message}`);
            const dbData = await fetchPatrolEventsFromDB(clientId, dates.patrolStartUTC, dates.patrolEndUTC, tableNames);
            dataSource = 'DATABASE_FALLBACK';
            return dbData;
          }
        } else {
          const dbData = await fetchPatrolEventsFromDB(clientId, dates.patrolStartUTC, dates.patrolEndUTC, tableNames);
          dataSource = 'DATABASE_DIRECT';
          return dbData;
        }
      })(),
      
      // Fetch V03 Incidents from incidentModel
      fetchIncidentsFromModel(clientId, dates.incidentStartUTC, dates.incidentEndUTC)
    ]);

    // Process patrol result
    if (patrolResult.status === 'fulfilled') {
      patrolEvents = patrolResult.value.patrolEvents;
      patrolCounts = patrolResult.value.completedCounts;
    } else {
      logger.error(`❌ V04 Patrol fetch failed:`, patrolResult.reason);
      patrolEvents = [];
      patrolCounts = new Map();
    }

    // Process incident result
    if (incidentResult.status === 'fulfilled') {
      incidentData = incidentResult.value;
    } else {
      logger.error(`❌ V03 Incident fetch failed:`, incidentResult.reason);
      incidentData = { incidents: [], total: 0 };
    }

    logger.info(`📅 Before filtering: ${patrolEvents.length} V04 patrol events`);
    
    // Filter V04 patrols by shift window only
    const filteredPatrols = filterPatrolsByShiftWindow(patrolEvents, dates);
    
    // Re-count V04 patrols after filtering
    patrolCounts = countV04Patrols(filteredPatrols);

    logger.info(`✅ After filtering:`);
    logger.info(`   V04 Patrols: ${filteredPatrols.length} within shift window`);
    logger.info(`   V03 Incidents: ${incidentData.total} from incidentModel`);

    // Enhance zone matching for display
    const enhancedCounts = new Map();
    for (const [zoneCode, count] of patrolCounts) {
      const cleanCode = String(zoneCode).trim();
      if (!cleanCode) continue;
      enhancedCounts.set(cleanCode, count);
      const zoneName = zoneData.zoneMap.get(cleanCode);
      if (zoneName) enhancedCounts.set(zoneName, count);
    }

    // Process patrol events for display (V04 only)
    const processedPatrolEvents = filteredPatrols
      .map(event => formatPatrolEvent(event, zoneData.zoneMap, eventMap))
      .filter(event => event.Date !== 'N/A' || event.Zone !== 'Unknown Post');

    // Calculate performance using V04 counts only
    const performanceResults = calculatePerformance(
      zoneData.allPosts,
      enhancedCounts,
      expectedPatrolsPerPost
    );
    
    logger.info(`📊 V04 Performance: ${performanceResults.overallRate}% (${performanceResults.totalCompleted}/${performanceResults.totalExpected} patrols)`);

    // ✅ FINAL REPORT DATA WITH CLEAR SEPARATION
    const totalTime = Date.now() - reportStartTime;
    const reportData = {
      posts: performanceResults.performanceData,     // V04 patrol performance
      events: processedPatrolEvents,                 // V04 patrol events only
      guardReports: incidentData.incidents,          // V03 incidents only
      metadata: {
        // Report info
        reportType: reportType.toUpperCase(),
        patrolDefinition: {
          patrolCode: PATROL_ARRIVAL_CODE,
          patrolWindow: `${SHIFT_START_HOUR}:00 → ${SHIFT_END_HOUR}:00 next day`,
          incidentCode: INCIDENT_CODE,
          incidentWindow: '00:00 → 23:59 calendar days',
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
        
        // Performance metrics (V04 only)
        totalExpectedPatrols: expectedPatrolsPerPost * performanceResults.totalZones,
        totalCompletedPatrols: performanceResults.totalCompleted,
        overallPatrolPerformance: performanceResults.overallRate,
        
        // Incident metrics (V03 only)
        totalIncidents: incidentData.total,
        
        // Source tracking
        patrolSource: dataSource,
        incidentSource: 'incidentModel.js',
        usingAPI: USE_API,
        
        // System info
        generatedAt: new Date(),
        processingTime: totalTime,
        timezone: TZ,
        
        // Data quality
        dataQuality: {
          isValid: true,
          separateSources: true,
          patrolsCount: filteredPatrols.length,
          incidentsCount: incidentData.total,
          zonesCount: performanceResults.totalZones,
          shiftBasedPatrols: true,
          calendarBasedIncidents: true,
          inclusiveDayCount: true
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
      logger.warn(`⚠️ LOW V04: ${totalV04} patrols, expected ${expectedTotal} (${Math.round(completionRate)}%)`);
    } else if (completionRate > 110) {
      logger.warn(`⚠️ HIGH V04: ${totalV04} patrols, expected ${expectedTotal} (${Math.round(completionRate)}%)`);
    } else {
      logger.info(`✅ GOOD V04: ${totalV04} patrols of ${expectedTotal} expected (${Math.round(completionRate)}%)`);
    }

    logger.info(`✅ Report complete in ${totalTime}ms`);
    logger.info(`   V04 Patrols: ${totalV04}`);
    logger.info(`   V03 Incidents: ${incidentData.total}`);

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
          incidentCode: INCIDENT_CODE
        },
        clientId: parseInt(clientId) || 0,
        clientName: 'Unknown',
        startDate: startDate,
        endDate: endDate,
        totalExpectedPatrols: 0,
        totalCompletedPatrols: 0,
        overallPatrolPerformance: 0,
        totalIncidents: 0,
        generatedAt: new Date(),
        patrolSource: 'ERROR',
        incidentSource: 'ERROR',
        error: { message: error.message },
        dataQuality: { 
          isValid: false, 
          separateSources: false
        },
        success: false
      }
    };
  }
};

// ========== API ENDPOINTS ==========

const createPatrolReportAPI = (app) => {
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
        sources: {
          patrols: reportData.metadata.patrolSource,
          incidents: reportData.metadata.incidentSource
        },
        counts: {
          patrols: reportData.metadata.totalCompletedPatrols,
          incidents: reportData.metadata.totalIncidents
        }
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        note: 'Report generation failed'
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
          patrols: reportData.metadata.patrolSource,
          incidents: reportData.metadata.incidentSource
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
 * Weekly report wrapper (for backward compatibility)
 */
const fetchWeeklyReport = async (clientId, startDate, endDate, usePartitions = true) => {
  return fetchPatrolReport(clientId, startDate, endDate, usePartitions, DEFAULT_REPORT_TYPES.WEEKLY);
};

module.exports = {
  fetchPatrolReport,
  fetchWeeklyReport,
  createPatrolReportAPI,
  filterEventsByDateRange: filterPatrolsByShiftWindow,
  countV04Patrols,
  DEFAULT_REPORT_TYPES,
  generateDateRangeForReportType,
  PATROL_ARRIVAL_CODE,
  INCIDENT_CODE,
  SHIFT_START_HOUR,
  SHIFT_END_HOUR
};