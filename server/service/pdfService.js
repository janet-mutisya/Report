// server/service/pdfService.js - FIXED VERSION (No Patrol Incidents in Events)
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import { sql, poolPromise } from "../config/database.js";
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getClientSchedule, getPatrolScheduleConfig } from '../scripts/managePatrolSchedules.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

// SIMPLIFIED COLOR SCHEME - Blue, White, Black only
const COLORS = {
  primary: '#1e40af',     // Blue for headers, important elements
  primaryDark: '#1e3a8a', // Darker blue
  white: '#ffffff',       // White for backgrounds, text on dark
  black: '#000000',       // Black for main text
  gray: {
    300: '#d1d5db',       // Light gray for subtle backgrounds
    600: '#4b5563',       // Medium gray for secondary text
    800: '#1f2937'        // Dark gray for body text
  }
};

/**
 * Load logo from local file system
 */
function loadLogoFromFile() {
  try {
    const possiblePaths = [
      path.join(process.cwd(), 'assets', 'BM SECURITY LOGO.jpg'),
      path.join(process.cwd(), 'server', 'assets', 'BM SECURITY LOGO.jpg'),
      path.join(__dirname, '..', 'assets', 'BM SECURITY LOGO.jpg'),
      path.join(__dirname, '..', '..', 'assets', 'BM SECURITY LOGO.jpg'),
      path.join(__dirname, '..', '..', '..', 'assets', 'BM SECURITY LOGO.jpg')
    ];

    for (const logoPath of possiblePaths) {
      if (fs.existsSync(logoPath)) {
        console.log(`✅ Logo found at: ${logoPath}`);
        return {
          buffer: fs.readFileSync(logoPath),
          path: logoPath
        };
      }
    }

    console.warn(`⚠️ Logo not found in any of the expected locations`);
    return null;
  } catch (error) {
    console.error(`❌ Error loading logo:`, error.message);
    return null;
  }
}

/**
 * Calculate days in range - EXACT SAME AS EMAIL SERVICE
 */
function calculateDaysInRange(startDate, endDate) {
  try {
    const startDateObj = dayjs.tz(startDate, TZ);
    const endDateObj = dayjs.tz(endDate, TZ);
    const daysInRange = endDateObj.diff(startDateObj, 'day') + 1;
    
    console.log(`📅 [PDF] Days in range calculation: ${daysInRange} days (${startDate} to ${endDate})`);
    return daysInRange;
  } catch (error) {
    console.error(`❌ [PDF] Error calculating days in range:`, error.message);
    // Fallback calculation
    return dayjs(endDate).diff(dayjs(startDate), 'day') + 1;
  }
}

/**
 * Fetch client schedule and calculate expected patrols
 */
async function fetchClientScheduleAndExpectedPatrols(clientId, startDate, endDate) {
  try {
    console.log(`📅 [PDF] Fetching client schedule for client ${clientId}`);
    
    // Get client schedule configuration
    const scheduleResult = await getPatrolScheduleConfig(clientId);
    
    if (scheduleResult.success && scheduleResult.data) {
      const schedule = scheduleResult.data;
      console.log(`✅ [PDF] Found custom schedule: ${schedule.PatrolsPerDay} patrols/day, ${schedule.ShiftType} shift`);
      
      // Calculate expected patrols based on schedule and date range
      const expectedPatrols = calculateExpectedPatrolsFromSchedule(schedule, startDate, endDate);
      
      return {
        shiftType: schedule.ShiftType,
        expectedPatrolsPerPost: expectedPatrols,
        patrolsPerDay: schedule.PatrolsPerDay,
        patrolDays: schedule.PatrolDays,
        hasCustomSchedule: schedule.HasCustomSchedule,
        scheduleInfo: `${schedule.PatrolsPerDay} patrols/day - ${schedule.ShiftType}`
      };
    } else {
      // Fallback to default schedule
      console.log(`📋 [PDF] Using default schedule for client ${clientId}`);
      const defaultSchedule = await getClientSchedule(clientId);
      const expectedPatrols = calculateExpectedPatrolsFromSchedule(defaultSchedule, startDate, endDate);
      
      return {
        shiftType: defaultSchedule.shift_type,
        expectedPatrolsPerPost: expectedPatrols,
        patrolsPerDay: defaultSchedule.patrols_per_day,
        patrolDays: defaultSchedule.patrol_days,
        hasCustomSchedule: defaultSchedule.has_custom_schedule,
        scheduleInfo: `${defaultSchedule.patrols_per_day} patrols/day - ${defaultSchedule.shift_type}`
      };
    }
  } catch (error) {
    console.error(`❌ [PDF] Error fetching client schedule:`, error.message);
    // Ultimate fallback
    const daysInRange = calculateDaysInRange(startDate, endDate);
    const defaultExpected = 11 * daysInRange;
    
    return {
      shiftType: "Day/Night",
      expectedPatrolsPerPost: defaultExpected,
      patrolsPerDay: 11,
      patrolDays: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
      hasCustomSchedule: false,
      scheduleInfo: `11 patrols/day - Day/Night Shift`
    };
  }
}

/**
 * Calculate expected patrols based on client schedule and date range
 */
function calculateExpectedPatrolsFromSchedule(schedule, startDate, endDate) {
  try {
    const patrolDays = schedule.PatrolDays ? schedule.PatrolDays.split(',').map(day => day.trim().toLowerCase()) : 
                      schedule.patrol_days ? schedule.patrol_days.split(',').map(day => day.trim().toLowerCase()) :
                      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    
    const patrolsPerDay = schedule.PatrolsPerDay || schedule.patrols_per_day || 11;
    const weekendPatrols = schedule.WeekendPatrols || schedule.weekend_patrols_per_day || patrolsPerDay;
    
    let expected = 0;
    let currentDate = dayjs(startDate);
    const endDateObj = dayjs(endDate);
    
    while (currentDate.isBefore(endDateObj) || currentDate.isSame(endDateObj, 'day')) {
      const dayOfWeek = currentDate.format('ddd').toLowerCase();
      if (patrolDays.includes(dayOfWeek)) {
        if (dayOfWeek === 'sat' || dayOfWeek === 'sun') {
          expected += weekendPatrols;
        } else {
          expected += patrolsPerDay;
        }
      }
      currentDate = currentDate.add(1, 'day');
    }
    
    console.log(`📊 [PDF] Expected patrols calculation: ${expected} total (${patrolsPerDay} weekdays, ${weekendPatrols} weekends)`);
    return expected;
  } catch (error) {
    console.error(`❌ [PDF] Error calculating expected patrols:`, error.message);
    // Fallback calculation
    const daysInRange = calculateDaysInRange(startDate, endDate);
    return 11 * daysInRange;
  }
}

/**
 * Fetch site post names from m_zonas table
 */
async function fetchSitePostNames(clientId) {
  try {
    console.log(`🏢 [PDF] Fetching site post names for client ${clientId}`);
    
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
    
    if (postsResult.recordset.length > 0) {
      postsResult.recordset.forEach(zone => {
        if (zone.ZoneCode && zone.ZoneName) {
          const cleanZoneCode = String(zone.ZoneCode).trim();
          const cleanZoneName = String(zone.ZoneName).trim();
          
          postMap.set(cleanZoneCode, cleanZoneName);
          postMap.set(cleanZoneCode.toUpperCase(), cleanZoneName);
          postMap.set(cleanZoneCode.toLowerCase(), cleanZoneName);
          
          if (!isNaN(cleanZoneCode)) {
            postMap.set(parseInt(cleanZoneCode), cleanZoneName);
          }
        }
      });
      console.log(`✅ [PDF] Found ${postsResult.recordset.length} site posts`);
    } else {
      console.log(`⚠️ [PDF] No posts found for client ${clientId}`);
    }

    return postMap;
  } catch (error) {
    console.error(`❌ [PDF] Error fetching site post names:`, error.message);
    return new Map();
  }
}

/**
 * Fetch event descriptions from m_formatos table
 */
async function fetchEventDescriptions() {
  try {
    console.log(`📋 [PDF] Fetching event descriptions`);
    
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
        let description = event.EventDescription;
        
        const translations = {
          'ARRIBO': 'Arrival',
          'SALIDA': 'Departure',
          'ENTRADA': 'Entry',
          'RONDA': 'Patrol Round',
          'INCIDENTE': 'Incident',
          'ALARMA': 'Alarm',
          'EMERGENCIA': 'Emergency',
          'PANICO': 'Panic',
          'FUEGO': 'Fire',
          'ASISTENCIA': 'Assistance',
          'INTRUSION': 'Intrusion',
          'ROBO': 'Theft',
          'VANDALISMO': 'Vandalism'
        };
        
        Object.entries(translations).forEach(([spanish, english]) => {
          description = description.replace(new RegExp(spanish, 'gi'), english);
        });
        
        eventMap.set(event.AlarmCode.trim().toUpperCase(), description);
      }
    });

    console.log(`✅ [PDF] Found ${eventMap.size} event descriptions`);
    return eventMap;
  } catch (error) {
    console.error(`❌ [PDF] Error fetching event descriptions:`, error.message);
    return new Map();
  }
}

/**
 * Fetch FILTERED events - EXCLUDING PATROL INCIDENTS (only VIGICONTROL arrivals and verified alarms)
 */
async function fetchFilteredEvents(clientId, startDate, endDate, receptionTables = ['p_recepcion202511', 'p_recepcion202510']) {
  try {
    console.log(`🔍 [PDF] Fetching FILTERED events (NO patrol incidents) for client ${clientId} (${startDate} to ${endDate})`);
    
    const validTables = receptionTables.filter(table => 
      /^p_recepcion\d{6}$/.test(table)
    );
    
    if (validTables.length === 0) {
      console.warn('⚠️ [PDF] No valid reception tables provided');
      return [];
    }
    
    const pool = await poolPromise;
    
    // UPDATED: Exclude _PI and patrol incident codes, only include VIGICONTROL and verified alarms
    const unions = validTables.map(table => 
      `SELECT rec_iid, rec_iidcuenta, rec_czona, rec_tfechahora, rec_cContenido, rec_calarma 
       FROM [_Datos].[dbo].[${table}]
       WHERE rec_iidcuenta = @clientId
         AND rec_tfechahora BETWEEN @startDate AND @endDate
         AND (
           rec_calarma LIKE '%VIGICONTROL%'
           OR rec_calarma IN ('V04', 'V08', 'V20', 'V21', 'V26')
         )`
    ).join('\nUNION ALL\n');

    const query = `
      ${unions}
      ORDER BY rec_tfechahora
    `;
    
    const eventsResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('startDate', sql.DateTime, startDate)
      .input('endDate', sql.DateTime, endDate)
      .query(query);

    console.log(`✅ [PDF] Found ${eventsResult.recordset.length} FILTERED events (VIGICONTROL arrivals only)`);
    return eventsResult.recordset;
  } catch (error) {
    console.error(`❌ [PDF] Error fetching filtered events:`, error.message);
    return [];
  }
}

/**
 * Fetch completed patrol counts from database - FIXED with filtered events
 */
async function fetchCompletedPatrolCounts(clientId, startDate, endDate, receptionTables = ['p_recepcion202511', 'p_recepcion202510']) {
  try {
    console.log(`📊 [PDF] Fetching completed patrol counts for client ${clientId} (${startDate} to ${endDate})`);
    
    const validTables = receptionTables.filter(table => 
      /^p_recepcion\d{6}$/.test(table)
    );
    
    if (validTables.length === 0) {
      console.warn('⚠️ [PDF] No valid reception tables provided');
      return new Map();
    }
    
    const pool = await poolPromise;
    
    // Count only VIGICONTROL arrivals for patrol completion
    const unions = validTables.map(table => 
      `SELECT rec_iid, rec_iidcuenta, rec_czona, rec_tfechahora, rec_cContenido, rec_calarma 
       FROM [_Datos].[dbo].[${table}]
       WHERE rec_iidcuenta = @clientId
         AND rec_tfechahora BETWEEN @startDate AND @endDate
         AND (
           rec_calarma LIKE '%VIGICONTROL%'
           OR rec_calarma IN ('V04', 'V08', 'V20', 'V21', 'V26')
         )`
    ).join('\nUNION ALL\n');

    const query = `
      WITH FilteredEvents AS (
        ${unions}
      )
      SELECT 
        LTRIM(RTRIM(zon.zon_cdescripcion)) AS PostName,
        COUNT(rec.rec_iid) AS CompletedCount
      FROM FilteredEvents AS rec
      INNER JOIN [_Datos].[dbo].[m_zonas] AS zon
        ON rec.rec_iidcuenta = zon.zon_iidcuenta
        AND rec.rec_czona = zon.zon_ccodigo
      WHERE zon.zon_cdescripcion IS NOT NULL
        AND zon.zon_cdescripcion != ''
      GROUP BY LTRIM(RTRIM(zon.zon_cdescripcion))
      ORDER BY LTRIM(RTRIM(zon.zon_cdescripcion))
    `;
    
    const countsResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('startDate', sql.DateTime, startDate)
      .input('endDate', sql.DateTime, endDate)
      .query(query);

    const completedMap = new Map();
    
    countsResult.recordset.forEach(row => {
      if (row.PostName && row.CompletedCount > 0) {
        completedMap.set(row.PostName, row.CompletedCount);
      }
    });

    console.log(`✅ [PDF] Found patrol counts for ${completedMap.size} posts`);
    return completedMap;
  } catch (error) {
    console.error(`❌ [PDF] Error fetching patrol counts:`, error.message);
    return new Map();
  }
}

/**
 * Fetch ONLY REPORTED INCIDENTS from m_incidencias table (no patrol incidents)
 */
async function fetchReportedIncidents(clientId, startDate, endDate) {
  try {
    console.log(`🚨 [PDF] Fetching REPORTED incidents ONLY for client ${clientId}`);
    
    const pool = await poolPromise;
    
    const query = `
      SELECT COUNT(*) AS IncidentCount
      FROM [_Datos].[dbo].[m_incidencias]
      WHERE inc_iidcuenta = @clientId
        AND inc_tfecha >= @startDate 
        AND inc_tfecha <= @endDate
        AND inc_cestatus != 'CANCELADO'
    `;
    
    const incidentResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('startDate', sql.DateTime, startDate)
      .input('endDate', sql.DateTime, endDate)
      .query(query);

    const incidentCount = incidentResult.recordset[0]?.IncidentCount || 0;
    
    console.log(`✅ [PDF] Found ${incidentCount} REPORTED incidents`);
    return incidentCount;
  } catch (error) {
    console.error(`❌ [PDF] Error fetching reported incidents:`, error.message);
    return 0;
  }
}

/**
 * Format event description from alarm code - ENGLISH ONLY
 */
function formatEventDescription(alarmCode, eventMap, fallbackContent = '') {
  if (!alarmCode) {
    if (fallbackContent && fallbackContent.trim()) {
      return fallbackContent.trim();
    }
    return "Unknown Event";
  }
  
  const code = String(alarmCode).trim().toUpperCase();
  
  const dbDescription = eventMap.get(code);
  if (dbDescription) return dbDescription;
  
  const commonMappings = {
    'V04': 'Patrol Check',
    'V08': 'Patrol Verification',
    'V20': 'Area Check',
    'V21': 'Zone Patrol',
    'V26': 'Security Round',
    'V10': 'Login',
    'V11': 'Logout',
    'VIGICONTROL: ARRIBO': 'Arrival',
    'VIGICONTROL: LOGIN': 'Login',
    'VIGICONTROL: LOGOUT': 'Logout',
    'VIGICONTROL: SALIDA': 'Departure',
    'VIGICONTROL: ENTRADA': 'Entry',
    'ARRIBO': 'Arrival',
    'SALIDA': 'Departure',
    'ENTRADA': 'Entry',
    'RONDA': 'Patrol Round'
  };

  return commonMappings[code] || code || "Unknown Event";
}

/**
 * Extract and format event data from reception records
 */
function extractEventData(event, zoneMap, eventMap) {
  try {
    let eventDate = 'N/A';
    let eventTime = 'N/A';
    let timestamp = null;
    
    if (event.rec_tfechahora) {
      try {
        let parsedDate = dayjs(event.rec_tfechahora);
        const hasExplicitTZ = /([zZ]|[+\-]\d{2}:\d{2})$/.test(String(event.rec_tfechahora).trim());
        if (!parsedDate.isValid() || !hasExplicitTZ) {
          parsedDate = dayjs.tz(event.rec_tfechahora, TZ);
        }

        if (parsedDate.isValid()) {
          timestamp = parsedDate;
          eventDate = parsedDate.tz(TZ).format('DD/MM/YYYY');
          eventTime = parsedDate.tz(TZ).format('HH:mm:ss');
        }
      } catch (e) {
        console.warn(`Date parse failed for: ${event.rec_tfechahora}`, e.message);
      }
    }

    let zoneName = 'Unknown Post';
    if (event.rec_czona) {
      const zoneCode = String(event.rec_czona).trim();
      zoneName = zoneMap.get(zoneCode) || 
                 zoneMap.get(zoneCode.toUpperCase()) || 
                 zoneMap.get(zoneCode.toLowerCase()) ||
                 (zoneCode ? `Post ${zoneCode}` : 'Unknown Post');
    }

    const eventDescription = formatEventDescription(
      event.rec_calarma, 
      eventMap, 
      event.rec_cContenido
    );

    return {
      Date: eventDate,
      Time: eventTime,
      Event: eventDescription,
      Zone: zoneName,
      timestamp: timestamp,
      rawData: event
    };
  } catch (error) {
    console.error('Error extracting event data:', error);
    return {
      Date: 'N/A',
      Time: 'N/A',
      Event: 'Error Processing Event',
      Zone: 'Unknown Post',
      rawData: event
    };
  }
}

/**
 * Clean post name by removing leading numbers and dots
 */
function cleanPostName(postName) {
  if (!postName) return postName;
  
  // Remove leading numbers followed by dot and space (e.g., "6. Aloy" -> "Aloy")
  // Matches patterns like: "1. ", "14. ", "123. "
  return postName.replace(/^\d+\.\s*/, '').trim();
}

/**
 * Calculate performance metrics - NO DECIMALS IN PERCENTAGES
 */
function calculatePerformance(completedPatrols, expectedPatrolsPerPost) {
  const performanceData = [];
  let totalCompleted = 0;
  let totalExpected = 0;
  let underperformingZones = 0;
  let excellentZones = 0;
  
  completedPatrols.forEach((completed, postName) => {
    const expected = expectedPatrolsPerPost;
    const numericPercentage = expected > 0 ? ((completed / expected) * 100) : 0;
    const percentageDisplay = Math.round(numericPercentage) + '%';
    
    if (numericPercentage < 70) underperformingZones++;
    if (numericPercentage >= 90) excellentZones++;
    
    performanceData.push({
      SitePost: cleanPostName(postName), // Clean the post name
      Actual: completed,
      Expected: expected,
      Percentage: percentageDisplay,
      numericPercentage
    });
    
    totalCompleted += Number(completed) || 0;
    totalExpected += expected;
  });
  
  const overallRateNumeric = totalExpected > 0 ? ((totalCompleted / totalExpected) * 100) : 0;
  const overallRateDisplay = Math.round(overallRateNumeric);

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
 * Text wrapping utility
 */
function wrapText(doc, text, maxWidth, fontSize = 8) {
  if (!text) return [''];
  
  doc.fontSize(fontSize);
  const words = String(text).split(' ');
  const lines = [];
  let currentLine = '';
  
  for (const word of words) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    if (doc.widthOfString(testLine) <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  
  if (currentLine) lines.push(currentLine);
  return lines.length ? lines : [''];
}

/**
 * Generate Historical Report PDF
 */
export async function generateHistoricalReportPDF(data, clientName, dateRange) {
  console.log(`📊 [PDF] Generating Historical Report for: ${clientName}`);
  
  const pdfData = {
    clientId: data.clientId || data.client?.ClientID || 28,
    clientName: clientName,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    shiftType: "Day/Night",
    events: data.events || data.patrols || [],
    posts: data.posts || [],
    patrols: data.patrols || []
  };
  
  return await generateDashboardPDF(pdfData);
}

/**
 * Generate Patrol Report PDF
 */
export async function generatePatrolReportPDF(data, clientName, dateRange) {
  console.log(`📊 [PDF] Generating Patrol Report for: ${clientName}`);
  
  const pdfData = {
    clientId: data.clientId || data.client?.ClientID || 28,
    clientName: clientName,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    shiftType: "Day/Night",
    events: data.events || data.patrols || [],
    posts: data.posts || [],
    patrols: data.patrols || []
  };
  
  return await generateDashboardPDF(pdfData);
}

/**
 * MAIN: Generate Dashboard PDF - UPDATED (No Patrol Incidents, No Executive Summary)
 */
export async function generateDashboardPDF(clientData) {
  console.log(`\n🎨 [PDF Generation - Starting]`);
  
  try {
    const {
      clientId,
      clientName = "Unknown Client",
      startDate,
      endDate
    } = clientData;

    console.log(`   Client: ${clientName} (ID: ${clientId})`);
    console.log(`   Period: ${startDate} → ${endDate}`);
    
    // Calculate date range using consistent function
    const daysInRange = calculateDaysInRange(startDate, endDate);

    console.log(`📅 Date Range: ${daysInRange} days`);
    
    // Load BM Security Logo
    const logoData = loadLogoFromFile();
    
    // Fetch client schedule and expected patrols
    console.log(`\n📅 Fetching client schedule configuration...`);
    const scheduleData = await fetchClientScheduleAndExpectedPatrols(clientId, startDate, endDate);
    const expectedPatrolsPerPost = scheduleData.expectedPatrolsPerPost;
    const shiftType = scheduleData.shiftType;
    
    console.log(`🎯 Expected Patrols per Post: ${expectedPatrolsPerPost} (${scheduleData.scheduleInfo})`);
    
    // Fetch mappings and FILTERED events from database (NO patrol incidents)
    console.log(`\n🔄 Fetching database data...`);
    const zoneMap = await fetchSitePostNames(clientId);
    const eventMap = await fetchEventDescriptions();
    const filteredEvents = await fetchFilteredEvents(clientId, startDate, endDate);
    const completedPatrols = await fetchCompletedPatrolCounts(clientId, startDate, endDate);
    
    console.log(`📊 Zone mappings loaded: ${zoneMap.size} entries`);
    
    // Fetch ONLY reported incidents (no patrol incidents)
    const reportedIncidents = await fetchReportedIncidents(clientId, startDate, endDate);

    // Process FILTERED events only (VIGICONTROL arrivals)
    console.log(`\n🔄 Processing ${filteredEvents.length} FILTERED events (NO patrol incidents)...`);
    const enhancedEvents = filteredEvents.map(event => {
      return extractEventData(event, zoneMap, eventMap);
    });

    const validEvents = enhancedEvents.filter(event => 
      event.Date !== 'N/A' && event.Zone !== 'Unknown Post'
    );
    
    console.log(`Processing ${validEvents.length} valid filtered events for display`);

    const performanceResults = calculatePerformance(completedPatrols, expectedPatrolsPerPost);
    
    console.log(`\n✅ Final Metrics:`);
    console.log(`   - Days in Range: ${daysInRange}`);
    console.log(`   - Posts: ${performanceResults.totalZones}`);
    console.log(`   - Completed: ${performanceResults.totalCompleted}/${performanceResults.totalExpected} = ${performanceResults.overallRate}%`);
    console.log(`   - Reported Incidents: ${reportedIncidents}`);
    console.log(`   - Filtered Events: ${filteredEvents.length}`);
    console.log(`   - Valid Events to display: ${validEvents.length}`);
    console.log(`   - Shift Type: ${shiftType}`);

    // Create PDF
    const doc = new PDFDocument({ 
      margin: 40,
      size: "A4",
      bufferPages: true,
      autoFirstPage: true,
      compress: true,
      info: {
        Title: `Security Report - ${clientName}`,
        Author: 'BM Security',
        Subject: `Performance Report ${startDate} to ${endDate}`,
        Creator: 'BM Security PDF Service',
        Producer: 'PDFKit'
      }
    });

    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    
    const pdfPromise = new Promise((resolve, reject) => {
      doc.on("end", () => {
        try {
          const buffer = Buffer.concat(buffers);
          console.log(`✅ PDF buffer created: ${buffer.length} bytes`);
          resolve(buffer);
        } catch (error) {
          reject(error);
        }
      });
      doc.on("error", reject);
    });

    let yPos = 40;
    const pageHeight = 750;

    const checkPageBreak = (neededSpace) => {
      if (yPos + neededSpace > pageHeight) {
        doc.addPage();
        yPos = 40;
        return true;
      }
      return false;
    };

    // HEADER WITH LARGER LEFT-ALIGNED BM SECURITY LOGO 
    const logoWidth = 160;
    const logoHeight = 80;
    const logoX = 40;
    const logoY = yPos;

    if (logoData && logoData.buffer) {
      try {
        console.log(`\n🖼️ Adding BM Security logo to PDF...`);
        doc.image(logoData.buffer, logoX, logoY, {
          width: logoWidth,
          height: logoHeight,
          fit: [logoWidth, logoHeight]
        });
      } catch (logoError) {
        console.error(`❌ Error adding logo:`, logoError.message);
        doc.font('Helvetica-Bold')
           .fillColor(COLORS.primary)
           .fontSize(16)
           .text('BM SECURITY', logoX, logoY + 10);
      }
    } else {
      doc.font('Helvetica-Bold')
         .fillColor(COLORS.primary)
         .fontSize(16)
         .text('BM SECURITY', logoX, logoY + 10);
    }

    // Header text content - ALIGNED WITH LOGO HEIGHT
    const headerTextX = logoX + logoWidth + 15;
    const headerTextY = logoY + 15;
    
    doc.font('Helvetica-Bold')
       .fillColor(COLORS.primary)
       .fontSize(20)
       .text('PATROL SUMMARY', headerTextX, headerTextY);
    
    doc.fillColor(COLORS.black)
       .fontSize(14)
       .text(clientName.toUpperCase(), headerTextX, headerTextY + 28);
    
    doc.fillColor(COLORS.gray[600])
       .fontSize(10)
       .text(`Period: ${startDate} to ${endDate} (${daysInRange} days) | ${shiftType} Shift`, headerTextX, headerTextY + 50);
    
    yPos += Math.max(logoHeight, 85);

    // ========== PERFORMANCE OVERVIEW ==========
    checkPageBreak(150);
    
    doc.fillColor(COLORS.primary)
       .fontSize(16)
       .font('Helvetica-Bold')
       .text('PERFORMANCE OVERVIEW', 40, yPos);
    
    yPos += 25;

    const performanceLevel = performanceResults.overallRateNumeric >= 90 ? 'EXCELLENT' : 
                           performanceResults.overallRateNumeric >= 80 ? 'GOOD' : 
                           performanceResults.overallRateNumeric >= 70 ? 'SATISFACTORY' : 'NEEDS IMPROVEMENT';

    const complianceRate = Math.round((performanceResults.totalCompleted / performanceResults.totalExpected) * 100);
    
    // UPDATED: Single metric for reported incidents only
    const metrics = [
      { 
        label: 'Overall Performance', 
        value: `${performanceResults.overallRate}%`, 
        subtext: `${performanceResults.totalCompleted}/${performanceResults.totalExpected} patrols (${performanceLevel})`
      },
      { 
        label: 'Security Posts', 
        value: performanceResults.totalZones, 
        subtext: `${performanceResults.excellentZones} excellent, ${performanceResults.underperformingZones} needs attention`
      },
      { 
        label: 'Reported Incidents', 
        value: reportedIncidents, 
        subtext: reportedIncidents === 0 ? 'No incidents reported' : `${reportedIncidents} incident${reportedIncidents > 1 ? 's' : ''} logged`
      },
      { 
        label: 'Compliance Rate', 
        value: `${complianceRate}%`, 
        subtext: `Expected: ${expectedPatrolsPerPost} per post`
      }
    ];

    // Metrics grid - ALL IN BLUE FOR VALUES
    metrics.forEach((metric, index) => {
      const xPos = 40 + (index % 2) * 270;
      const yMetric = yPos + Math.floor(index / 2) * 50;
      
      doc.fillColor(COLORS.primary)
         .fontSize(20)
         .font('Helvetica-Bold')
         .text(String(metric.value), xPos, yMetric);
      
      doc.fillColor(COLORS.black)
         .fontSize(10)
         .font('Helvetica-Bold')
         .text(metric.label, xPos, yMetric + 22);
      
      doc.fillColor(COLORS.gray[600])
         .fontSize(8)
         .font('Helvetica')
         .text(metric.subtext, xPos, yMetric + 35, { width: 250 });
    });

    yPos += 110;

    // ========== PATROL SUMMARY TABLE WITH ACTUAL POST NAMES ==========
    if (performanceResults.performanceData.length > 0) {
      checkPageBreak(50);
      
      doc.fillColor(COLORS.primary)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('PATROL SUMMARY', 40, yPos);
      
      yPos += 20;

      doc.fillColor(COLORS.gray[600])
         .fontSize(9)
         .font('Helvetica')
         .text(`Report covers ${daysInRange} days | Expected ${expectedPatrolsPerPost} patrols per security post`, 40, yPos);
      
      yPos += 20;

      // Table header - BLUE BACKGROUND, WHITE TEXT
      doc.fillColor(COLORS.primary)
         .rect(40, yPos, 515, 20)
         .fill();
      
      doc.fillColor(COLORS.white)
         .fontSize(9)
         .font('Helvetica-Bold')
         .text('SECURITY POST', 45, yPos + 7, { width: 240 })
         .text('COMPLETED', 300, yPos + 7)
         .text('EXPECTED', 380, yPos + 7)
         .text('PERFORMANCE', 460, yPos + 7);
      
      yPos += 20;

      // Table rows - sorted by performance
      const sortedPerformance = [...performanceResults.performanceData]
        .sort((a, b) => b.numericPercentage - a.numericPercentage);

      sortedPerformance.forEach((post, index) => {
        checkPageBreak(15);
        
        if (index % 2 === 0) {
          doc.fillColor(COLORS.gray[300]).rect(40, yPos, 515, 15).fill();
        }
        
        doc.fillColor(COLORS.black)
           .fontSize(8)
           .font('Helvetica')
           .text(post.SitePost, 45, yPos + 5, { width: 240 })
           .text(String(post.Actual), 300, yPos + 5)
           .text(String(post.Expected), 380, yPos + 5)
           .text(post.Percentage, 460, yPos + 5);
        
        yPos += 15;
      });

      // Grand total - BLUE BACKGROUND, WHITE TEXT
      checkPageBreak(20);
      
      doc.fillColor(COLORS.primary)
         .rect(40, yPos, 515, 20)
         .fill();
      
      doc.fillColor(COLORS.white)
         .fontSize(9)
         .font('Helvetica-Bold')
         .text('OVERALL PERFORMANCE', 45, yPos + 7)
         .text(String(performanceResults.totalCompleted), 300, yPos + 7)
         .text(String(performanceResults.totalExpected), 380, yPos + 7)
         .text(`${performanceResults.overallRate}%`, 460, yPos + 7);
      
      yPos += 35;
    }

    // ========== PATROL EVENTS LOG - VIGICONTROL ARRIVALS ONLY ==========
    if (validEvents.length > 0) {
      checkPageBreak(50);
      
      doc.fillColor(COLORS.primary)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('PATROL EVENTS', 40, yPos);
      
      yPos += 25;
      
      // Show filtered events in chronological order (oldest first)
      const eventsToShow = [...validEvents].sort((a, b) => {
        if (a.timestamp && b.timestamp) {
          return a.timestamp - b.timestamp;
        }
        return 0;
      });
      
      doc.fillColor(COLORS.gray[600])
         .fontSize(9)
         .font('Helvetica')
         .text(`VIGICONTROL arrivals logged: ${validEvents.length}`, 40, yPos);
      
      yPos += 20;

      // Table header - BLUE BACKGROUND, WHITE TEXT
      doc.fillColor(COLORS.primary)
         .rect(40, yPos, 515, 25)
         .fill();
      
      doc.fillColor(COLORS.white)
         .fontSize(10)
         .font('Helvetica-Bold')
         .text('DATE', 45, yPos + 9, { width: 70 })
         .text('TIME', 125, yPos + 9, { width: 60 })
         .text('EVENT', 195, yPos + 9, { width: 200 })
         .text('POST', 405, yPos + 9, { width: 140 });
      
      yPos += 30;

      // Event rows - ALL BLACK TEXT, gray alternating backgrounds
      let eventsDisplayed = 0;
      eventsToShow.forEach((event, index) => {
        const eventLines = wrapText(doc, event.Event, 195, 9);
        const zoneLines = wrapText(doc, event.Zone, 135, 9);
        const maxLines = Math.max(eventLines.length, zoneLines.length);
        const rowHeight = Math.max(18, maxLines * 12);
        
        checkPageBreak(rowHeight + 5);
        
        // Background color - light gray for alternating
        if (index % 2 === 0) {
          doc.fillColor(COLORS.gray[300])
             .rect(40, yPos, 515, rowHeight)
             .fill();
        }
        
        // All text in black
        doc.fillColor(COLORS.black)
           .fontSize(9)
           .font('Helvetica')
           .text(event.Date, 45, yPos + 6, { width: 70 })
           .text(event.Time, 125, yPos + 6, { width: 60 });
        
        // Multi-line event description
        eventLines.forEach((line, lineIndex) => {
          doc.text(line, 195, yPos + 6 + (lineIndex * 12), { width: 195 });
        });
        
        // Multi-line zone
        zoneLines.forEach((line, lineIndex) => {
          doc.text(line, 405, yPos + 6 + (lineIndex * 12), { width: 135 });
        });
        
        yPos += rowHeight + 2;
        eventsDisplayed++;
      });

      console.log(`📋 Displayed ${eventsDisplayed} VIGICONTROL arrival events in PDF`);
      yPos += 20;
    } else {
      checkPageBreak(40);
      
      doc.fillColor(COLORS.black)
         .fontSize(12)
         .font('Helvetica')
         .text('No patrol event data available for this period', 40, yPos, { align: 'center' });
      
      yPos += 30;
    }

    // ========== INCIDENTS OVERVIEW (if any reported) ==========
    if (reportedIncidents > 0) {
      checkPageBreak(100);
      
      doc.fillColor(COLORS.primary)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('INCIDENTS OVERVIEW', 40, yPos);
      
      yPos += 25;
      
      doc.fillColor(COLORS.black)
         .fontSize(10)
         .font('Helvetica')
         .text(`During this reporting period, ${reportedIncidents} incident${reportedIncidents > 1 ? 's were' : ' was'} formally reported and logged in the system.`, 40, yPos, { width: 515 });
      
      yPos += 25;
      
      doc.fillColor(COLORS.gray[600])
         .fontSize(9)
         .font('Helvetica')
         .text('All incidents are documented with detailed reports including timestamps, locations, and resolution status. For complete incident details, please refer to the dedicated incident management system.', 40, yPos, { width: 515 });
      
      yPos += 40;
    }

    // ========== FOOTER ==========
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      
      let footerY = 780;
      
      doc.fillColor(COLORS.gray[600])
         .fontSize(8)
         .font('Helvetica')
         .text('Confidential Security Report - For Authorized Personnel Only', 40, footerY)
         .text(`Page ${i + 1} of ${pageCount}`, 400, footerY);
    }

    doc.end();
    
    console.log(`\n✅ PDF generated successfully!`);
    console.log(`   - Total pages: ${pageCount}`);
    console.log(`   - ${validEvents.length} VIGICONTROL arrivals displayed`);
    console.log(`   - ${performanceResults.totalZones} security posts analyzed`);
    console.log(`   - ${reportedIncidents} reported incidents`);
    console.log(`   - Shift Type: ${shiftType}`);
    console.log(`   - Expected Patrols: ${expectedPatrolsPerPost}`);
    
    return pdfPromise;

  } catch (error) {
    console.error("❌ PDF Generation Error:", error);
    throw error;
  }
}

export async function generatePDFReport(clientData) {
  console.log(`📄 [PDF] Generating PDF report...`);
  return await generateDashboardPDF(clientData);
}

export default {
  generateDashboardPDF,
  generateHistoricalReportPDF,
  generatePatrolReportPDF,
  generatePDFReport 
};