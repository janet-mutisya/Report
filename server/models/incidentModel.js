// server/models/incidentModel.js - FIXED INCIDENT COUNTER - DATE HANDLING CORRECTED
import dayjs from "dayjs";
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { getCachedPatrolEvents } from '../service/bmSecurityAPICache.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const TZ = process.env.TZ || 'Africa/Nairobi';
const GUARD_REPORT_CODE = 'V03'; // Incident/update/narrative code

/**
 * ✅ Parse event date properly with better error handling
 */
function parseEventDate(rawDate) {
  if (!rawDate) return null;
  
  try {
    // Try parsing as ISO/standard format
    let parsed = dayjs(rawDate);
    if (parsed.isValid()) {
      return parsed.tz(TZ);
    }
    
    // Try UTC parsing
    parsed = dayjs.utc(rawDate);
    if (parsed.isValid()) {
      return parsed.tz(TZ);
    }
    
    // Try common formats
    const formats = [
      'YYYY-MM-DD HH:mm:ss',
      'DD/MM/YYYY HH:mm:ss',
      'YYYY-MM-DD',
      'DD/MM/YYYY'
    ];
    
    for (const format of formats) {
      parsed = dayjs(rawDate, format);
      if (parsed.isValid()) {
        return parsed.tz(TZ);
      }
    }
    
    return null;
  } catch (error) {
    console.warn(`Date parsing error: ${rawDate}`, error.message);
    return null;
  }
}

/**
 * ✅ Safe date parsing for user input - ULTRA DEFENSIVE
 */
function parseDateSafely(dateString, timezone) {
  try {
    console.log(`🔍 [INCIDENT] Parsing date: "${dateString}" in timezone: ${timezone}`);
    
    // Method 1: Try direct dayjs parse first
    let parsed = dayjs(dateString);
    if (parsed.isValid()) {
      console.log(`✅ [INCIDENT] Method 1 worked: ${parsed.format()}`);
      return parsed.tz(timezone);
    }
    
    // Method 2: Try with timezone
    parsed = dayjs.tz(dateString, timezone);
    if (parsed.isValid()) {
      console.log(`✅ [INCIDENT] Method 2 worked: ${parsed.format()}`);
      return parsed;
    }
    
    // Method 3: Try parsing with format
    parsed = dayjs(dateString, 'YYYY-MM-DD');
    if (parsed.isValid()) {
      console.log(`✅ [INCIDENT] Method 3 worked: ${parsed.format()}`);
      return parsed.tz(timezone);
    }
    
    // If all failed
    console.error(`❌ [INCIDENT] All parsing methods failed for: ${dateString}`);
    throw new Error(`Could not parse date: ${dateString}`);
    
  } catch (error) {
    console.error(`❌ [INCIDENT] Date parsing exception:`, error);
    throw new Error(`Failed to parse date "${dateString}": ${error.message}`);
  }
}

/**
 * 📊 Count V03 incidents from API events
 */
export async function getIncidentCount(clientId, startDate, endDate) {
  try {
    console.log(`🔍 [INCIDENT] Fetching incidents for client ${clientId}: ${startDate} → ${endDate}`);
    
    // Parse dates with validation
    let start, end;
    try {
      start = parseDateSafely(startDate, TZ);
      end = parseDateSafely(endDate, TZ);
    } catch (dateError) {
      throw new Error(`Date parsing failed: ${dateError.message}`);
    }
    
    const startDateTime = start.startOf('day');
    const endDateTime = end.endOf('day');
    
    console.log(`📅 [INCIDENT] Date range: ${startDateTime.format('YYYY-MM-DD HH:mm')} → ${endDateTime.format('YYYY-MM-DD HH:mm')}`);
    
    // 🔥 CRITICAL FIX: Format dates as strings for the API
    const startStr = startDateTime.format('YYYY-MM-DD');
    const endStr = endDateTime.format('YYYY-MM-DD');
    
    console.log(`🚀 [INCIDENT] Calling getCachedPatrolEvents with strings: ${startStr} → ${endStr}`);
    
    // 🔥 ADD THESE DEBUG LOGS
    console.log(`🔥 [DEBUG] About to call getCachedPatrolEvents:`);
    console.log(`   Client ID: ${clientId}`);
    console.log(`   Start String: ${startStr}`);
    console.log(`   End String: ${endStr}`);
    console.log(`   Start DateTime object:`, startDateTime.toDate());
    console.log(`   End DateTime object:`, endDateTime.toDate());
    
    // Fetch events from API using cache - USE STRING FORMAT
    const apiResult = await getCachedPatrolEvents(
      clientId,
      startStr,  // 🔥 Changed from startDateTime.toDate()
      endStr,    // 🔥 Changed from endDateTime.toDate()
      null       // accountNumber
    );
    
    console.log(`📦 [INCIDENT] API Result:`, {
      success: apiResult.success,
      hasData: !!apiResult.data,
      eventCount: apiResult.data?.length || 0,
      fromCache: apiResult.fromCache
    });
    
    if (!apiResult.success || !apiResult.data) {
      console.error(`❌ [INCIDENT] API returned no data`);
      throw new Error('API returned no data');
    }
    
    const allEvents = apiResult.data;
    console.log(`✅ [INCIDENT] API returned ${allEvents.length} total events`);
    
    // Filter and count V03 incidents
    const incidents = [];
    let skippedEvents = 0;
    let debugCount = 0;
    
    for (const event of allEvents) {
      try {
        debugCount++;
        
        // Debug first 5 events to see what we're getting
        if (debugCount <= 5) {
          console.log(`🔍 [INCIDENT] Event ${debugCount}:`, {
            clientId: event.rec_iidcuenta || event.cue_iid || event.clientId,
            alarmCode: event.rec_calarma || event.alarm_code,
            date: event.rec_tfechahora || event.fecha,
            zone: event.rec_czona || event.zon_ccodigo
          });
        }
        
        // Check if it's the correct client
        const eventClientId = event.rec_iidcuenta || event.cue_iid || event.clientId;
        if (parseInt(eventClientId) !== parseInt(clientId)) {
          if (debugCount <= 5) console.log(`  ❌ Wrong client: ${eventClientId} !== ${clientId}`);
          continue;
        }
        
        // Check if it's a V03 incident
        const alarmCode = (event.rec_calarma || event.alarm_code || '').toString().trim().toUpperCase();
        if (alarmCode !== GUARD_REPORT_CODE) {
          if (debugCount <= 5) console.log(`  ❌ Wrong code: "${alarmCode}" !== "${GUARD_REPORT_CODE}"`);
          continue;
        }
        
        console.log(`  ✅ Found V03 incident!`);
        
        // Parse and validate date
        const eventDate = parseEventDate(event.rec_tfechahora || event.fecha);
        if (!eventDate || !eventDate.isValid()) {
          console.warn(`  ⚠️ Invalid date for incident ${event.rec_iid}`);
          skippedEvents++;
          continue;
        }
        
        // Check if within date range
    // ✅ FIXED: Ensure both dates are in the same timezone before comparing
const eventDateInTz = eventDate.tz(TZ);
const isInRange = eventDateInTz.isSameOrAfter(startDateTime) && 
                  eventDateInTz.isSameOrBefore(endDateTime);

if (!isInRange) {
  console.log(`  ⚠️ Incident outside date range:`);
  console.log(`     Event: ${eventDateInTz.format('YYYY-MM-DD HH:mm:ss')} (${TZ})`);
  console.log(`     Range: ${startDateTime.format('YYYY-MM-DD HH:mm:ss')} → ${endDateTime.format('YYYY-MM-DD HH:mm:ss')}`);
  skippedEvents++;
  continue;
}
        // Valid V03 incident
        incidents.push({
          id: event.rec_iid || event.Id,
          date: eventDate.format('DD/MM/YYYY HH:mm:ss'),
          zone: event.rec_czona || event.zon_ccodigo || 'Unknown',
          content: event.rec_cContenido || event.content || '',
          observations: event.rec_cObservaciones || event.observaciones || ''
        });
        
      } catch (error) {
        console.warn(`⚠️ [INCIDENT] Error processing event:`, error.message);
        skippedEvents++;
      }
    }
    
    console.log(`📊 [INCIDENT] FINAL RESULT: Found ${incidents.length} V03 incidents (processed ${allEvents.length} events, skipped ${skippedEvents})`);
    
    // Group by date for daily breakdown
    const dailyBreakdown = {};
    for (const incident of incidents) {
      const dateKey = incident.date.substring(0, 10); // DD/MM/YYYY
      dailyBreakdown[dateKey] = (dailyBreakdown[dateKey] || 0) + 1;
    }
    
    return {
      success: true,
      totalIncidents: incidents.length,
      dateRange: {
        start: startDateTime.format('DD/MM/YYYY'),
        end: endDateTime.format('DD/MM/YYYY'),
        days: endDateTime.diff(startDateTime, 'day') + 1
      },
      dailyBreakdown,
      incidents: incidents, // Full list if needed
      metadata: {
        clientId: parseInt(clientId),
        generatedAt: new Date(),
        dataSource: apiResult.fromCache ? 'CACHE' : 'API',
        cacheAge: apiResult.cacheAge || 0,
        totalEventsProcessed: allEvents.length,
        skippedEvents
      }
    };
    
  } catch (error) {
    console.error(`❌ [INCIDENT] Error fetching incidents:`, error.message);
    return {
      success: false,
      totalIncidents: 0,
      error: error.message,
      metadata: {
        clientId: parseInt(clientId),
        generatedAt: new Date()
      }
    };
  }
}

/**
 * 📊 Get incident summary (count only, no details)
 */
export async function getIncidentSummary(clientId, startDate, endDate) {
  const result = await getIncidentCount(clientId, startDate, endDate);
  
  return {
    success: result.success,
    totalIncidents: result.totalIncidents,
    dateRange: result.dateRange,
    dailyBreakdown: result.dailyBreakdown,
    metadata: result.metadata
  };
}

/**
 * 🗓️ Get incidents for common report periods - ULTRA DEFENSIVE
 */
export async function getIncidentsForPeriod(clientId, period = 'daily') {
  try {
    console.log(`📅 [INCIDENT] getIncidentsForPeriod called with period: ${period}, clientId: ${clientId}, TZ: ${TZ}`);
    
    const now = dayjs();
    console.log(`📅 [INCIDENT] Current time: ${now.format('YYYY-MM-DD HH:mm:ss')}`);
    
    const nowInTz = now.tz(TZ);
    console.log(`📅 [INCIDENT] Current time in TZ: ${nowInTz.format('YYYY-MM-DD HH:mm:ss')}`);
    
    let startDate, endDate;
    
    switch(period.toLowerCase()) {
      case 'daily':
      case 'today':
        startDate = nowInTz.startOf('day');
        endDate = nowInTz.endOf('day');
        break;
        
      case 'yesterday':
        startDate = nowInTz.subtract(1, 'day').startOf('day');
        endDate = nowInTz.subtract(1, 'day').endOf('day');
        break;
        
      case 'weekly':
      case 'week':
        startDate = nowInTz.subtract(6, 'day').startOf('day');
        endDate = nowInTz.endOf('day');
        break;
        
      case 'monthly':
      case 'month':
        startDate = nowInTz.startOf('month');
        endDate = nowInTz.endOf('month');
        break;
        
      case 'last7days':
        startDate = nowInTz.subtract(6, 'day').startOf('day');
        endDate = nowInTz.endOf('day');
        break;
        
      case 'last30days':
        startDate = nowInTz.subtract(29, 'day').startOf('day');
        endDate = nowInTz.endOf('day');
        break;
        
      default:
        throw new Error(`Invalid period: ${period}`);
    }
    
    console.log(`📅 [INCIDENT] Calculated range: ${startDate.format('YYYY-MM-DD')} → ${endDate.format('YYYY-MM-DD')}`);
    
    const startStr = startDate.format('YYYY-MM-DD');
    const endStr = endDate.format('YYYY-MM-DD');
    
    console.log(`📅 [INCIDENT] Calling getIncidentSummary with: ${startStr} → ${endStr}`);
    
    return getIncidentSummary(clientId, startStr, endStr);
    
  } catch (error) {
    console.error(`❌ [INCIDENT] Error in getIncidentsForPeriod:`, error);
    return {
      success: false,
      totalIncidents: 0,
      error: error.message,
      stack: error.stack,
      metadata: {
        clientId: parseInt(clientId),
        generatedAt: new Date()
      }
    };
  }
}

/**
 * 🌐 Create API endpoints
 */
export function createIncidentAPI(app) {
  // Get full incident details (must be BEFORE the /:period route)
  app.get('/api/incidents/details', async (req, res) => {
    try {
      const { clientId, startDate, endDate } = req.query;
      
      if (!clientId || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: clientId, startDate, endDate'
        });
      }
      
      const result = await getIncidentCount(clientId, startDate, endDate);
      
      res.status(200).json(result);
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
  
  // Get incident count for date range
  app.get('/api/incidents/count', async (req, res) => {
    try {
      const { clientId, startDate, endDate } = req.query;
      
      if (!clientId || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: clientId, startDate, endDate'
        });
      }
      
      const result = await getIncidentSummary(clientId, startDate, endDate);
      
      res.status(200).json(result);
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
  
  // Get incident count for period (must be AFTER /details and /count)
  app.get('/api/incidents/:period', async (req, res) => {
    try {
      const { period } = req.params;
      const { clientId } = req.query;
      
      if (!clientId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameter: clientId'
        });
      }
      
      const result = await getIncidentsForPeriod(clientId, period);
      
      res.status(200).json(result);
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
  
  console.log('✅ Incident API endpoints registered');
}

export default {
  getIncidentCount,
  getIncidentSummary,
  getIncidentsForPeriod,
  createIncidentAPI
};