// server/models/incidentModel.js - FIXED WITH ZONE EXTRACTION AND DATE/TIME
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');
const customParseFormat = require('dayjs/plugin/customParseFormat.js');
const { getCachedPatrolEvents } = require('../service/bmSecurityAPICache.js');

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
      'M/D/YYYY h:mm:ss A',  // 12/1/2025 12:04:46 AM
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
 * ✅ Safe date parsing for user input
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
 * 🔍 Extract zone name from incident text
 * Uses pattern matching to identify zone mentions in the description
 */
function extractZoneFromText(text) {
  if (!text) return null;
  
  const lowerText = text.toLowerCase();
  
  // Common zone patterns - add more based on your clients
  const zonePatterns = [
    // ABSA BISHOP GATES zones
    { pattern: /bishop.*gate.*lobby/i, zone: 'ABSA BISHOP GATES LOBBY AREA' },
    { pattern: /bishop.*gate.*basement/i, zone: 'ABSA BISHOP GATES BASEMENT POOL AREA' },
    { pattern: /bishop.*gate.*generator/i, zone: 'ABSA BISHOP GATES GENERATOR AREA' },
    { pattern: /bishop.*gate.*garbage|bishop.*gate.*gabbage/i, zone: 'ABSA BISHOP GATES GABBAGE AREA' },
    { pattern: /bishop.*gate.*maingate|bishop.*gate.*main gate/i, zone: 'ABSA BISHOP GATES MAINGATE' },
    { pattern: /bishop.*gate/i, zone: 'ABSA BISHOP GATES' },
    
    // Generic zones
    { pattern: /\bmaingate\b|\bmain gate\b/i, zone: 'MAINGATE' },
    { pattern: /\blobby\b/i, zone: 'LOBBY' },
    { pattern: /\bbasement\b/i, zone: 'BASEMENT' },
    { pattern: /\bgenerator\b/i, zone: 'GENERATOR AREA' },
    { pattern: /\bparking\b/i, zone: 'PARKING AREA' },
    { pattern: /\breception\b/i, zone: 'RECEPTION' },
    { pattern: /\bperimeter\b/i, zone: 'PERIMETER' },
    { pattern: /\bback.*gate\b/i, zone: 'BACK GATE' },
    { pattern: /\bfront.*gate\b/i, zone: 'FRONT GATE' },
    { pattern: /\brooftop\b/i, zone: 'ROOFTOP' },
    { pattern: /\bstairwell\b/i, zone: 'STAIRWELL' },
    
    // Try to extract "at [location]" or "in [location]"
    { pattern: /(?:at|in)\s+([a-z0-9\s]+?)(?:\s+area|\s+zone|$)/i, zone: null }, // Capture group
  ];
  
  for (const { pattern, zone } of zonePatterns) {
    const match = text.match(pattern);
    if (match) {
      if (zone) {
        console.log(`   🔍 Extracted zone from text: "${zone}"`);
        return zone;
      } else if (match[1]) {
        // Captured group - clean and use it
        const extracted = match[1].trim().toUpperCase();
        console.log(`   🔍 Extracted zone from capture: "${extracted}"`);
        return extracted;
      }
    }
  }
  
  return null;
}

/**
 * 📊 Count V03 incidents from API events - FIXED WITH ZONE EXTRACTION
 */
async function getIncidentCount(clientId, startDate, endDate) {
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
    
    // Format dates as strings for the API
    const startStr = startDateTime.format('YYYY-MM-DD');
    const endStr = endDateTime.format('YYYY-MM-DD');
    
    console.log(`🚀 [INCIDENT] Calling getCachedPatrolEvents with: ${startStr} → ${endStr}`);
    
    // Fetch events from API using cache
    const apiResult = await getCachedPatrolEvents(
      clientId,
      startStr,
      endStr,
      null // accountNumber
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
        
        // Debug first 5 events
        if (debugCount <= 5) {
          console.log(`🔍 [INCIDENT] Event ${debugCount}:`, {
            clientId: event.rec_iidcuenta || event.cue_iid || event.clientId,
            alarmCode: event.rec_calarma || event.alarm_code,
            date: event.rec_tfechahora || event.fecha
          });
        }
        
        // Check if it's the correct client
        const eventClientId = event.rec_iidcuenta || event.cue_iid || event.clientId;
        if (parseInt(eventClientId) !== parseInt(clientId)) {
          if (debugCount <= 5) console.log(`  ❌ Wrong client`);
          continue;
        }
        
        // Check if it's a V03 incident
        const alarmCode = (event.rec_calarma || event.alarm_code || '').toString().trim().toUpperCase();
        if (alarmCode !== GUARD_REPORT_CODE) {
          if (debugCount <= 5) console.log(`  ❌ Not V03: "${alarmCode}"`);
          continue;
        }
        
        console.log(`  ✅ Found V03 incident!`);
        
        // Parse and validate date
        const eventDate = parseEventDate(event.rec_tfechahora || event.fecha);
        if (!eventDate || !eventDate.isValid()) {
          console.warn(`  ⚠️ Invalid date for incident`);
          skippedEvents++;
          continue;
        }
        
        // Check if within date range
        const eventDateInTz = eventDate.tz(TZ);
        const isInRange = eventDateInTz.isSameOrAfter(startDateTime) && 
                          eventDateInTz.isSameOrBefore(endDateTime);

        if (!isInRange) {
          console.log(`  ⚠️ Incident outside date range`);
          skippedEvents++;
          continue;
        }
        
        // ✅ EXTRACT ZONE WITH MULTIPLE FALLBACKS
        let zoneName = null;
        
        // Priority 1: Direct zone field
        if (event.rec_czona && event.rec_czona !== '0' && event.rec_czona.trim() !== '') {
          zoneName = event.rec_czona.trim();
          console.log(`   Zone from rec_czona: "${zoneName}"`);
        } else if (event.zon_ccodigo && event.zon_ccodigo !== '0') {
          zoneName = event.zon_ccodigo.trim();
          console.log(`   Zone from zon_ccodigo: "${zoneName}"`);
        }
        
        // Priority 2: Try to extract from observations/content text
        if (!zoneName || zoneName === 'UNKNOWN_ZONE') {
          const incidentText = (
            event.rec_cObservaciones || 
            event.observaciones || 
            event.rec_cContenido || 
            event.content || 
            ''
          ).trim();
          
          if (incidentText) {
            console.log(`   Incident text: "${incidentText.substring(0, 100)}..."`);
            const extractedZone = extractZoneFromText(incidentText);
            if (extractedZone) {
              zoneName = extractedZone;
            }
          }
        }
        
        // Priority 3: Use zone name if zone code was found
        if (zoneName && zoneName.match(/^\d+$/)) {
          // It's just a number, try to look up the name
          // For now, keep it as "Zone [number]"
          zoneName = `Zone ${zoneName}`;
        }
        
        // Final fallback
        if (!zoneName) {
          zoneName = 'UNKNOWN_ZONE';
        }
        
        console.log(`   ✅ Final zone: "${zoneName}"`);
        
        // Get incident description
        const incidentDescription = (
          event.rec_cObservaciones || 
          event.observaciones || 
          event.rec_cContenido || 
          event.content || 
          'No details available'
        ).trim();
        
        // ✅ FIXED: Store date/time separately for PDF
        incidents.push({
          id: event.rec_iid || event.Id,
          date: eventDate.format('DD/MM/YYYY'),  // Separate date
          time: eventDate.format('HH:mm:ss'),    // Separate time
          dateTime: eventDate.toISOString(),     // Full timestamp for sorting
          zone: zoneName,
          content: event.rec_cContenido || event.content || '',
          observations: event.rec_cObservaciones || event.observaciones || '',
          report: incidentDescription,
          details: incidentDescription,
          type: 'INCIDENT_REPORT'
        });
        
        console.log(`   📋 Incident added:`, {
          date: eventDate.format('DD/MM/YYYY'),
          time: eventDate.format('HH:mm:ss'),
          zone: zoneName,
          description: incidentDescription.substring(0, 50) + '...'
        });
        
      } catch (error) {
        console.warn(`⚠️ [INCIDENT] Error processing event:`, error.message);
        skippedEvents++;
      }
    }
    
    console.log(`📊 [INCIDENT] Found ${incidents.length} V03 incidents (processed ${allEvents.length}, skipped ${skippedEvents})`);
    
    // Sort by date/time
    incidents.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
    
    // Group by date for daily breakdown
    const dailyBreakdown = {};
    for (const incident of incidents) {
      const dateKey = incident.date; // Already formatted as DD/MM/YYYY
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
      incidents: incidents,
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
    console.error(`❌ [INCIDENT] Error:`, error);
    return {
      success: false,
      totalIncidents: 0,
      incidents: [],
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
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
async function getIncidentSummary(clientId, startDate, endDate) {
  const result = await getIncidentCount(clientId, startDate, endDate);
  
  return {
    success: result.success,
    totalIncidents: result.totalIncidents,
    dateRange: result.dateRange,
    dailyBreakdown: result.dailyBreakdown,
    metadata: result.metadata,
    error: result.error
  };
}

/**
 * 🗓️ Get incidents for common report periods
 */
async function getIncidentsForPeriod(clientId, period = 'daily') {
  try {
    console.log(`📅 [INCIDENT] Period request: ${period}, client: ${clientId}`);
    
    const nowInTz = dayjs().tz(TZ);
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
    
    const startStr = startDate.format('YYYY-MM-DD');
    const endStr = endDate.format('YYYY-MM-DD');
    
    console.log(`📅 [INCIDENT] Calculated: ${startStr} → ${endStr}`);
    
    return getIncidentSummary(clientId, startStr, endStr);
    
  } catch (error) {
    console.error(`❌ [INCIDENT] Period error:`, error);
    return {
      success: false,
      totalIncidents: 0,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      metadata: {
        clientId: parseInt(clientId),
        generatedAt: new Date()
      }
    };
  }
}

/**
 * 🌐 Create API endpoints - FIXED ROUTES
 */
function createIncidentAPI(app) {
  console.log('🔧 [INCIDENT] Registering incident routes...');
  
  // Get full incident details
  app.get('/incidents/details', async (req, res) => {
    try {
      console.log('📊 [ROUTE] GET /incidents/details', req.query);
      
      const { clientId, startDate, endDate } = req.query;
      
      if (!clientId || !startDate || !endDate) {
        console.log('❌ [ROUTE] Missing parameters');
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: clientId, startDate, endDate'
        });
      }
      
      const result = await getIncidentCount(clientId, startDate, endDate);
      
      console.log('✅ [ROUTE] /incidents/details success:', { 
        totalIncidents: result.totalIncidents 
      });
      
      res.status(200).json(result);
      
    } catch (error) {
      console.error('❌ [ROUTE] /incidents/details error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });
  
  // Get incident count for date range
  app.get('/incidents/count', async (req, res) => {
    try {
      console.log('📊 [ROUTE] GET /incidents/count', req.query);
      
      const { clientId, startDate, endDate } = req.query;
      
      if (!clientId || !startDate || !endDate) {
        console.log('❌ [ROUTE] Missing parameters');
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: clientId, startDate, endDate'
        });
      }
      
      const result = await getIncidentSummary(clientId, startDate, endDate);
      
      console.log('✅ [ROUTE] /incidents/count success:', { 
        totalIncidents: result.totalIncidents 
      });
      
      res.status(200).json(result);
      
    } catch (error) {
      console.error('❌ [ROUTE] /incidents/count error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });
  
  // Get incident count for period (monthly, weekly, etc.)
  app.get('/incidents/:period', async (req, res) => {
    try {
      console.log('📊 [ROUTE] GET /incidents/:period', { 
        period: req.params.period, 
        query: req.query 
      });
      
      const { period } = req.params;
      const { clientId } = req.query;
      
      if (!clientId) {
        console.log('❌ [ROUTE] Missing clientId');
        return res.status(400).json({
          success: false,
          error: 'Missing required parameter: clientId'
        });
      }
      
      const result = await getIncidentsForPeriod(clientId, period);
      
      console.log('✅ [ROUTE] /incidents/:period success:', { 
        period,
        totalIncidents: result.totalIncidents 
      });
      
      res.status(200).json(result);
      
    } catch (error) {
      console.error('❌ [ROUTE] /incidents/:period error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });
  
  console.log('✅ [INCIDENT] Routes registered:');
  console.log('   - GET /incidents/details');
  console.log('   - GET /incidents/count');
  console.log('   - GET /incidents/:period');
}

module.exports = {
  getIncidentCount,
  getIncidentSummary,
  getIncidentsForPeriod,
  createIncidentAPI,
  extractZoneFromText  // Export for testing
};