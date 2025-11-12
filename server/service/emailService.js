// server/service/emailService.js - FIXED DAYS COVERED CALCULATION
import nodemailer from 'nodemailer';
import dayjs from 'dayjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql, poolPromise } from "../config/database.js";
import { getClientSchedule, getPatrolScheduleConfig } from '../scripts/managePatrolSchedules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add timezone support for consistent date calculations
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);
const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

/**
 * Create email transporter with IPv4-only configuration
 */
function createEmailTransporter() {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    family: 4,
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    debug: process.env.NODE_ENV === 'development',
    logger: process.env.NODE_ENV === 'development'
  });

  return transporter;
}

/**
 * Get logo as base64 for email embedding
 */
function getLogoBase64() {
  try {
    const possiblePaths = [
      path.join(process.cwd(), 'assets', 'BM SECURITY LOGO.jpg'),
      path.join(process.cwd(), 'server', 'assets', 'BM SECURITY LOGO.jpg'),
      path.join(__dirname, '..', 'assets', 'BM SECURITY LOGO.jpg'),
      path.join(__dirname, '..', '..', 'assets', 'BM SECURITY LOGO.jpg')
    ];

    for (const logoPath of possiblePaths) {
      if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        const logoBase64 = logoBuffer.toString('base64');
        console.log(`✅ Logo loaded from: ${logoPath}`);
        return `data:image/jpeg;base64,${logoBase64}`;
      }
    }

    console.warn('⚠️ Logo file not found in any expected location');
    return null;
  } catch (error) {
    console.error('❌ Error loading logo:', error.message);
    return null;
  }
}

/**
 * Calculate days in range - EXACT SAME AS PDF SERVICE
 */
function calculateDaysInRange(startDate, endDate) {
  try {
    const startDateObj = dayjs.tz(startDate, TZ);
    const endDateObj = dayjs.tz(endDate, TZ);
    const daysInRange = endDateObj.diff(startDateObj, 'day') + 1;
    
    console.log(`📅 [EMAIL] Days in range calculation: ${daysInRange} days (${startDate} to ${endDate})`);
    return daysInRange;
  } catch (error) {
    console.error(`❌ [EMAIL] Error calculating days in range:`, error.message);
    // Fallback calculation
    return dayjs(endDate).diff(dayjs(startDate), 'day') + 1;
  }
}

/**
 * Send email with retry logic
 */
export async function sendEmailWithRetry(mailOptions, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📧 Email attempt ${attempt}/${maxRetries}...`);
      
      const transporter = createEmailTransporter();
      
      if (attempt === 1) {
        console.log('🔧 Verifying SMTP connection...');
        await transporter.verify();
        console.log('✅ SMTP connection verified (IPv4)');
      }
      
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully: ${info.messageId}`);
      console.log(`   To: ${mailOptions.to}`);
      console.log(`   Subject: ${mailOptions.subject}`);
      return info;
      
    } catch (error) {
      lastError = error;
      console.error(`❌ Email attempt ${attempt} failed:`, error.message);
      console.error(`   Error code: ${error.code}`);
      
      if (error.code === 'ESOCKET' || error.code === 'ETIMEDOUT' || error.message.includes('ENETUNREACH')) {
        if (attempt < maxRetries) {
          const waitTime = attempt * 2000;
          console.log(`⏳ Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
      }
      
      if (error.code === 'EAUTH') {
        console.error('❌ Authentication failed. Check EMAIL_USER and EMAIL_PASS in .env');
        throw error;
      }
      
      if (attempt === maxRetries) {
        throw error;
      }
    }
  }
  
  throw new Error(`Failed to send email after ${maxRetries} attempts: ${lastError.message}`);
}

// ========== DATABASE QUERIES - EXACT SAME AS PDF SERVICE ==========

/**
 * Fetch client schedule and calculate expected patrols - SAME AS PDF SERVICE
 */
async function fetchClientScheduleAndExpectedPatrols(clientId, startDate, endDate) {
  try {
    console.log(`📅 [EMAIL] Fetching client schedule for client ${clientId}`);
    
    const scheduleResult = await getPatrolScheduleConfig(clientId);
    
    if (scheduleResult.success && scheduleResult.data) {
      const schedule = scheduleResult.data;
      console.log(`✅ [EMAIL] Found custom schedule: ${schedule.PatrolsPerDay} patrols/day, ${schedule.ShiftType} shift`);
      
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
      console.log(`📋 [EMAIL] Using default schedule for client ${clientId}`);
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
    console.error(`❌ [EMAIL] Error fetching client schedule:`, error.message);
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
 * Calculate expected patrols based on client schedule - SAME AS PDF SERVICE
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
    
    console.log(`📊 [EMAIL] Expected patrols calculation: ${expected} total`);
    return expected;
  } catch (error) {
    console.error(`❌ [EMAIL] Error calculating expected patrols:`, error.message);
    const daysInRange = calculateDaysInRange(startDate, endDate);
    return 11 * daysInRange;
  }
}

/**
 * Fetch site post names from m_zonas table - SAME AS PDF SERVICE
 */
async function fetchSitePostNames(clientId) {
  try {
    console.log(`🏢 [EMAIL] Fetching site post names for client ${clientId}`);
    
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
      console.log(`✅ [EMAIL] Found ${postsResult.recordset.length} site posts`);
    } else {
      console.log(`⚠️ [EMAIL] No posts found for client ${clientId}`);
    }

    return postMap;
  } catch (error) {
    console.error(`❌ [EMAIL] Error fetching site post names:`, error.message);
    return new Map();
  }
}

/**
 * Fetch FILTERED events from reception tables - EXACT SAME AS PDF SERVICE
 */
async function fetchFilteredEvents(clientId, startDate, endDate, receptionTables = ['p_recepcion202511', 'p_recepcion202510']) {
  try {
    console.log(`🔍 [EMAIL] Fetching FILTERED events for client ${clientId} (${startDate} to ${endDate})`);
    
    const validTables = receptionTables.filter(table => 
      /^p_recepcion\d{6}$/.test(table)
    );
    
    if (validTables.length === 0) {
      console.warn('⚠️ [EMAIL] No valid reception tables provided');
      return [];
    }
    
    const pool = await poolPromise;
    
    // EXACT SAME FILTERING LOGIC AS PDF SERVICE
    const unions = validTables.map(table => 
      `SELECT rec_iid, rec_iidcuenta, rec_czona, rec_tfechahora, rec_cContenido, rec_calarma 
       FROM [_Datos].[dbo].[${table}]
       WHERE rec_iidcuenta = @clientId
         AND rec_tfechahora BETWEEN @startDate AND @endDate
         AND (
           rec_calarma LIKE '%_PI%' 
           OR rec_calarma LIKE '%SMARTPANICS%'
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

    console.log(`✅ [EMAIL] Found ${eventsResult.recordset.length} FILTERED events (operational only)`);
    return eventsResult.recordset;
  } catch (error) {
    console.error(`❌ [EMAIL] Error fetching filtered events:`, error.message);
    return [];
  }
}

/**
 * Fetch completed patrol counts - EXACT SAME FILTERING AS PDF SERVICE
 */
async function fetchCompletedPatrolCounts(clientId, startDate, endDate, receptionTables = ['p_recepcion202511', 'p_recepcion202510']) {
  try {
    console.log(`📊 [EMAIL] Fetching completed patrol counts for client ${clientId}`);
    
    const validTables = receptionTables.filter(table => 
      /^p_recepcion\d{6}$/.test(table)
    );
    
    if (validTables.length === 0) {
      console.warn('⚠️ [EMAIL] No valid reception tables provided');
      return new Map();
    }
    
    const pool = await poolPromise;
    
    // EXACT SAME FILTERING AS PDF SERVICE
    const unions = validTables.map(table => 
      `SELECT rec_iid, rec_iidcuenta, rec_czona, rec_tfechahora, rec_cContenido, rec_calarma 
       FROM [_Datos].[dbo].[${table}]
       WHERE rec_iidcuenta = @clientId
         AND rec_tfechahora BETWEEN @startDate AND @endDate
         AND (
           rec_calarma LIKE '%_PI%' 
           OR rec_calarma LIKE '%SMARTPANICS%'
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

    console.log(`✅ [EMAIL] Found patrol counts for ${completedMap.size} posts`);
    return completedMap;
  } catch (error) {
    console.error(`❌ [EMAIL] Error fetching patrol counts:`, error.message);
    return new Map();
  }
}

/**
 * Fetch REPORTED INCIDENTS - SAME AS PDF SERVICE
 */
async function fetchReportedIncidents(clientId, startDate, endDate) {
  try {
    console.log(`🚨 [EMAIL] Fetching REPORTED incidents for client ${clientId}`);
    
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
    
    console.log(`✅ [EMAIL] Found ${incidentCount} REPORTED incidents`);
    return incidentCount;
  } catch (error) {
    console.error(`❌ [EMAIL] Error fetching reported incidents:`, error.message);
    return 0;
  }
}

/**
 * Fetch PATROL INCIDENTS - SAME AS PDF SERVICE
 */
async function fetchPatrolIncidents(clientId, startDate, endDate, receptionTables = ['p_recepcion202511', 'p_recepcion202510']) {
  try {
    console.log(`🚨 [EMAIL] Fetching PATROL incidents for client ${clientId}`);
    
    const validTables = receptionTables.filter(table => 
      /^p_recepcion\d{6}$/.test(table)
    );
    
    if (validTables.length === 0) {
      console.warn('⚠️ [EMAIL] No valid reception tables provided');
      return 0;
    }
    
    const pool = await poolPromise;
    
    // EXACT SAME FILTERING AS PDF SERVICE
    const unions = validTables.map(table => 
      `SELECT rec_iid, rec_iidcuenta, rec_czona, rec_tfechahora, rec_cContenido, rec_calarma 
       FROM [_Datos].[dbo].[${table}]
       WHERE rec_iidcuenta = @clientId
         AND rec_tfechahora BETWEEN @startDate AND @endDate
         AND rec_calarma IN ('_PI', 'SMARTPANICS: SOS', 'SMARTPANICS: FUEGO', 'SMARTPANICS: ASISTENCIA')`
    ).join('\nUNION ALL\n');

    const query = `
      ${unions}
    `;
    
    const incidentResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('startDate', sql.DateTime, startDate)
      .input('endDate', sql.DateTime, endDate)
      .query(query);

    const patrolIncidentCount = incidentResult.recordset.length || 0;
    
    console.log(`✅ [EMAIL] Found ${patrolIncidentCount} PATROL incidents`);
    return patrolIncidentCount;
  } catch (error) {
    console.error(`❌ [EMAIL] Error fetching patrol incidents:`, error.message);
    return 0;
  }
}

/**
 * Calculate performance metrics - SAME AS PDF SERVICE (NO DECIMALS)
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
    const percentageDisplay = Math.round(numericPercentage);
    
    if (numericPercentage < 70) underperformingZones++;
    if (numericPercentage >= 90) excellentZones++;
    
    performanceData.push({
      SitePost: postName,
      Actual: completed,
      Expected: expected,
      Percentage: percentageDisplay + '%',
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
 * Fetch and calculate all metrics - SYNCHRONIZED WITH PDF SERVICE
 */
export async function fetchAllMetrics(clientId, startDate, endDate) {
  try {
    console.log(`📊 [EMAIL] Fetching all metrics for client ${clientId}`);
    
    // Get schedule and expected patrols (same as PDF service)
    const scheduleData = await fetchClientScheduleAndExpectedPatrols(clientId, startDate, endDate);
    const expectedPatrolsPerPost = scheduleData.expectedPatrolsPerPost;
    
    // Get completed patrols using SAME FILTERING as PDF service
    const completedPatrols = await fetchCompletedPatrolCounts(clientId, startDate, endDate);
    
    // Calculate performance using SAME LOGIC as PDF service
    const performanceResults = calculatePerformance(completedPatrols, expectedPatrolsPerPost);
    
    // Get incidents using SAME QUERIES as PDF service
    const reportedIncidents = await fetchReportedIncidents(clientId, startDate, endDate);
    const patrolIncidents = await fetchPatrolIncidents(clientId, startDate, endDate);
    const totalIncidents = reportedIncidents + patrolIncidents;
    
    // Calculate compliance rate (same as PDF service)
    const complianceRate = performanceResults.totalExpected > 0 
      ? Math.round((performanceResults.totalCompleted / performanceResults.totalExpected) * 100) 
      : 0;
    
    // Performance level (same as PDF service)
    const performanceLevel = performanceResults.overallRateNumeric >= 90 ? 'EXCELLENT' : 
                            performanceResults.overallRateNumeric >= 80 ? 'GOOD' : 
                            performanceResults.overallRateNumeric >= 70 ? 'SATISFACTORY' : 'NEEDS IMPROVEMENT';
    
    // Get filtered events count for email display
    const filteredEvents = await fetchFilteredEvents(clientId, startDate, endDate);
    
    // Calculate days in range using SAME METHOD as PDF service
    const daysInRange = calculateDaysInRange(startDate, endDate);
    
    console.log(`✅ [EMAIL] Metrics calculated:`);
    console.log(`   - Overall Rate: ${performanceResults.overallRate}%`);
    console.log(`   - Completed: ${performanceResults.totalCompleted}/${performanceResults.totalExpected}`);
    console.log(`   - Total Incidents: ${totalIncidents} (${reportedIncidents} reported + ${patrolIncidents} patrol)`);
    console.log(`   - Posts: ${performanceResults.totalZones}`);
    console.log(`   - Filtered Events: ${filteredEvents.length}`);
    console.log(`   - Schedule: ${scheduleData.scheduleInfo}`);
    console.log(`   - Days Covered: ${daysInRange} days`);
    
    return {
      scheduleData,
      performanceResults,
      reportedIncidents,
      patrolIncidents,
      totalIncidents,
      complianceRate,
      performanceLevel,
      filteredEventsCount: filteredEvents.length,
      daysInRange // ADD THIS TO RETURN
    };
  } catch (error) {
    console.error(`❌ [EMAIL] Error fetching metrics:`, error.message);
    throw error;
  }
}

/**
 * Generate BM Security branded email HTML for patrol reports - FIXED DAYS COVERED
 */
export function generatePatrolReportEmail(client, dateRange, metrics) {
  const logoBase64 = getLogoBase64();
  
  const clientName = client?.ClientName || client?.clientName || 'Unknown Client';
  const clientId = client?.ClientID || client?.clientId || 'N/A';
  
  const startDate = dateRange?.startDate || 'N/A';
  const endDate = dateRange?.endDate || 'N/A';
  const rangeLabel = dateRange?.rangeLabel || `${startDate} to ${endDate}`;
  
  // USE THE CALCULATED DAYS IN RANGE FROM METRICS (same as PDF service)
  const daysInRange = metrics?.daysInRange || dateRange?.daysInRange || 1;
  
  // Use calculated metrics (these are now synchronized with PDF service)
  const {
    overallRate = 0,
    totalCompleted = 0,
    totalExpected = 0,
    totalZones = 0,
    totalIncidents = 0,
    reportedIncidents = 0,
    patrolIncidents = 0,
    performanceLevel = 'N/A',
    complianceRate = 0,
    filteredEventsCount = 0
  } = metrics || {};
  
  const needsAttention = totalIncidents > 0 || overallRate < 80;

  const emailHtml = `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>BM SECURITY - Patrol Performance Report</title>
  <style type="text/css">
    .ExternalClass { width: 100%; }
    .ExternalClass, .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div { line-height: 100%; }
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: Arial, sans-serif;">
  <center>
    <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f8fafc">
      <tr>
        <td align="center" style="padding: 20px 0;">
          <table width="650" border="0" cellpadding="0" cellspacing="0" style="max-width: 650px; width: 100%;">
            <!-- Header with BM Security Logo and Branding -->
            <tr>
              <td bgcolor="#1e3a8a" style="padding: 30px; border-radius: 10px 10px 0 0; background: linear-gradient(135deg, #2c5aa0 0%, #1e3a8a 100%);">
                <table width="100%" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    ${logoBase64 ? `
                    <td width="120" valign="middle" style="padding-right: 20px;">
                      <img src="${logoBase64}" alt="BM Security Logo" width="100" height="100" style="display: block; border: 0; border-radius: 8px; background-color: white; padding: 8px;" />
                    </td>
                    ` : ''}
                    <td valign="middle" style="text-align: ${logoBase64 ? 'left' : 'center'};">
                      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">🛡️ BM SECURITY</h1>
                      <p style="color: #e2e8f0; margin: 10px 0 0 0; font-size: 16px;">Patrol Performance Report</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            
            <!-- Content -->
            <tr>
              <td bgcolor="#ffffff" style="padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h2 style="color: #1e3a8a; margin-top: 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Security Performance Analysis</h2>
                
                <!-- Overview Table -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9" style="margin: 20px 0; border-radius: 8px;">
                  <tr>
                    <td style="padding: 20px;">
                      <h3 style="color: #475569; margin-top: 0;">📊 Report Overview</h3>
                      <table width="100%" border="0" cellpadding="0" cellspacing="0">
                        <tr>
                          <td width="40%" style="padding: 8px 0; color: #64748b;"><strong>Client:</strong></td>
                          <td width="60%" style="padding: 8px 0; color: #334155;">${clientName}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #64748b;"><strong>Report Period:</strong></td>
                          <td style="padding: 8px 0; color: #334155;">${rangeLabel}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #64748b;"><strong>Days Covered:</strong></td>
                          <td style="padding: 8px 0; color: #334155;">${daysInRange} days</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #64748b;"><strong>Overall Performance:</strong></td>
                          <td style="padding: 8px 0; color: #334155; font-weight: 600;">${overallRate}% - ${performanceLevel}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Stats Boxes -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
                  <tr>
                    <td width="25%" align="center" style="padding: 10px;">
                      <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f0f9ff" style="border-left: 4px solid #0ea5e9; padding: 15px; border-radius: 8px;">
                        <tr>
                          <td align="center" style="font-size: 24px; font-weight: bold; color: #0ea5e9;">${totalZones}</td>
                        </tr>
                        <tr>
                          <td align="center" style="color: #64748b; font-size: 14px;">Security Posts</td>
                        </tr>
                      </table>
                    </td>
                    <td width="25%" align="center" style="padding: 10px;">
                      <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f0fdf4" style="border-left: 4px solid #22c55e; padding: 15px; border-radius: 8px;">
                        <tr>
                          <td align="center" style="font-size: 24px; font-weight: bold; color: #22c55e;">${totalCompleted}</td>
                        </tr>
                        <tr>
                          <td align="center" style="color: #64748b; font-size: 14px;">Patrols Completed</td>
                        </tr>
                      </table>
                    </td>
                    <td width="25%" align="center" style="padding: 10px;">
                      <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#fef7ed" style="border-left: 4px solid #f59e0b; padding: 15px; border-radius: 8px;">
                        <tr>
                          <td align="center" style="font-size: 24px; font-weight: bold; color: #f59e0b;">${totalExpected}</td>
                        </tr>
                        <tr>
                          <td align="center" style="color: #64748b; font-size: 14px;">Expected Patrols</td>
                        </tr>
                      </table>
                    </td>
                    <td width="25%" align="center" style="padding: 10px;">
                      <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#fef2f2" style="border-left: 4px solid #ef4444; padding: 15px; border-radius: 8px;">
                        <tr>
                          <td align="center" style="font-size: 24px; font-weight: bold; color: #ef4444;">${totalIncidents}</td>
                        </tr>
                        <tr>
                          <td align="center" style="color: #64748b; font-size: 14px;">Security Incidents</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Performance Summary -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#ecfdf5" style="margin: 20px 0; border: 1px solid #a7f3d0; border-radius: 8px;">
                  <tr>
                    <td style="padding: 15px;">
                      <h4 style="color: #065f46; margin: 0 0 10px 0;">📈 Performance Highlights</h4>
                      <p style="color: #065f46; margin: 0; line-height: 1.5;">
                        <strong>Overall Performance:</strong> ${overallRate}% (${performanceLevel})<br>
                        <strong>Security Coverage:</strong> ${totalZones} posts monitored<br>
                        <strong>Patrol Compliance:</strong> ${complianceRate}% (${totalCompleted}/${totalExpected} patrols)<br>
                        <strong>Security Incidents:</strong> ${totalIncidents} total (${reportedIncidents} reported + ${patrolIncidents} patrol alerts)<br>
                        <strong>Operational Events:</strong> ${filteredEventsCount} recorded patrol activities<br>
                        <strong>Performance Level:</strong> ${performanceLevel}
                      </p>
                    </td>
                  </tr>
                </table>

                <!-- Report Features -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#fffbeb" style="margin: 20px 0; border-radius: 8px;">
                  <tr>
                    <td style="padding: 15px;">
                      <h4 style="color: #92400e; margin: 0 0 10px 0;">📄 Attached Report Includes</h4>
                      <ul style="color: #92400e; margin: 0; padding-left: 20px;">
                        <li>Detailed performance metrics for each security post</li>
                        <li>Complete patrol events log with timestamps</li>
                        <li>Incident analysis and security alerts</li>
                        <li>Compliance rates and performance trends</li>
                        <li>Executive summary with actionable insights</li>
                      </ul>
                    </td>
                  </tr>
                </table>

                <!-- Action Required -->
                ${needsAttention ? `
                <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#fef2f2" style="margin: 20px 0; border: 1px solid #fecaca; border-radius: 8px;">
                  <tr>
                    <td style="padding: 15px;">
                      <h4 style="color: #991b1b; margin: 0 0 10px 0;">⚠️ Attention Required</h4>
                      <p style="color: #991b1b; margin: 0; line-height: 1.5;">
                        ${totalIncidents > 0 ? `<strong>${totalIncidents} security incident${totalIncidents > 1 ? 's' : ''}</strong> recorded during this period (${reportedIncidents} reported + ${patrolIncidents} patrol alerts). ` : ''}
                        ${overallRate < 80 ? 'Performance below target threshold. ' : ''}
                        Please review the attached detailed report and contact your security manager for follow-up actions.
                      </p>
                    </td>
                  </tr>
                </table>
                ` : ''}

                <!-- Closing Text -->
                <p style="color: #64748b; line-height: 1.6;">
                  The detailed PDF report is attached to this email. Review the comprehensive analysis to understand 
                  patrol performance, identify areas for improvement, and ensure optimal security coverage.
                </p>

                <!-- Footer -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                  <tr>
                    <td>
                      <p style="color: #94a3b8; font-size: 14px; margin: 0;">
                        Questions or concerns about this report?<br>
                        Contact: <a href="mailto:www.bmsecurity.com" style="color: #2c5aa0; text-decoration: none;">security@bmsecurity.com</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Final Footer -->
          <table width="650" border="0" cellpadding="0" cellspacing="0" style="max-width: 650px; width: 100%;">
            <tr>
              <td align="center" style="padding: 20px 0; color: #94a3b8; font-size: 12px;">
                <p style="margin: 0;">BM SECURITY SERVICES • Professional Security Solutions</p>
                <p style="margin: 5px 0 0 0;">Report generated on ${dayjs().format('MMMM D, YYYY [at] h:mm A')}</p>
                <p style="margin: 5px 0 0 0; font-size: 11px; color: #cbd5e1;">
                  Report ID: ${clientId}-${dayjs().format('YYYYMMDD-HHmm')} | 
                  Confidential - For Authorized Personnel Only
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>
`;

  return emailHtml;
}

/**
 * Generate BM Security branded email HTML for historical reports - FIXED DAYS COVERED
 */
export function generateHistoricalReportEmail(client, dateRange, metrics) {
  const logoBase64 = getLogoBase64();
  
  const clientName = client?.ClientName || client?.clientName || 'Unknown Client';
  const clientId = client?.ClientID || client?.clientId || 'N/A';
  
  const startDate = dateRange?.startDate || 'N/A';
  const endDate = dateRange?.endDate || 'N/A';
  const rangeLabel = dateRange?.rangeLabel || `${startDate} to ${endDate}`;
  
  // USE THE CALCULATED DAYS IN RANGE FROM METRICS (same as PDF service)
  const daysInRange = metrics?.daysInRange || dateRange?.daysInRange || 1;

  // Use calculated metrics (these are now synchronized with PDF service)
  const {
    overallRate = 0,
    totalCompleted = 0,
    totalExpected = 0,
    totalZones = 0,
    totalIncidents = 0,
    reportedIncidents = 0,
    patrolIncidents = 0,
    performanceLevel = 'N/A',
    complianceRate = 0,
    filteredEventsCount = 0
  } = metrics || {};

  const emailHtml = `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>BM SECURITY - Historical Analysis Report</title>
  <style type="text/css">
    .ExternalClass { width: 100%; }
    .ExternalClass, .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div { line-height: 100%; }
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: Arial, sans-serif;">
  <center>
    <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f8fafc">
      <tr>
        <td align="center" style="padding: 20px 0;">
          <table width="650" border="0" cellpadding="0" cellspacing="0" style="max-width: 650px; width: 100%;">
            <!-- Header with Logo -->
            <tr>
              <td bgcolor="#1e3a8a" style="padding: 30px; border-radius: 10px 10px 0 0; background: linear-gradient(135deg, #2c5aa0 0%, #1e3a8a 100%);">
                <table width="100%" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    ${logoBase64 ? `
                    <td width="120" valign="middle" style="padding-right: 20px;">
                      <img src="${logoBase64}" alt="BM Security Logo" width="100" height="100" style="display: block; border: 0; border-radius: 8px; background-color: white; padding: 8px;" />
                    </td>
                    ` : ''}
                    <td valign="middle" style="text-align: ${logoBase64 ? 'left' : 'center'};">
                      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">🛡️ BM SECURITY</h1>
                      <p style="color: #e2e8f0; margin: 10px 0 0 0; font-size: 16px;">Historical Security Analysis Report</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            
            <!-- Content -->
            <tr>
              <td bgcolor="#ffffff" style="padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h2 style="color: #1e3a8a; margin-top: 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Comprehensive Historical Analysis</h2>
                
                <!-- Overview Table -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9" style="margin: 20px 0; border-radius: 8px;">
                  <tr>
                    <td style="padding: 20px;">
                      <h3 style="color: #475569; margin-top: 0;">📊 Historical Overview</h3>
                      <table width="100%" border="0" cellpadding="0" cellspacing="0">
                        <tr>
                          <td width="40%" style="padding: 8px 0; color: #64748b;"><strong>Client:</strong></td>
                          <td width="60%" style="padding: 8px 0; color: #334155;">${clientName}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #64748b;"><strong>Analysis Period:</strong></td>
                          <td style="padding: 8px 0; color: #334155;">${rangeLabel}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #64748b;"><strong>Days Analyzed:</strong></td>
                          <td style="padding: 8px 0; color: #334155;">${daysInRange} days</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #64748b;"><strong>Total Patrols:</strong></td>
                          <td style="padding: 8px 0; color: #334155;">${totalCompleted} completed of ${totalExpected} expected</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #64748b;"><strong>Overall Performance:</strong></td>
                          <td style="padding: 8px 0; color: #334155; font-weight: 600;">${overallRate}% - ${performanceLevel}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Stats Boxes -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
                  <tr>
                    <td width="25%" align="center" style="padding: 10px;">
                      <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f0f9ff" style="border-left: 4px solid #0ea5e9; padding: 15px; border-radius: 8px;">
                        <tr>
                          <td align="center" style="font-size: 24px; font-weight: bold; color: #0ea5e9;">${totalZones}</td>
                        </tr>
                        <tr>
                          <td align="center" style="color: #64748b; font-size: 14px;">Security Posts</td>
                        </tr>
                      </table>
                    </td>
                    <td width="25%" align="center" style="padding: 10px;">
                      <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f0fdf4" style="border-left: 4px solid #22c55e; padding: 15px; border-radius: 8px;">
                        <tr>
                          <td align="center" style="font-size: 24px; font-weight: bold; color: #22c55e;">${totalCompleted}</td>
                        </tr>
                        <tr>
                          <td align="center" style="color: #64748b; font-size: 14px;">Events Analyzed</td>
                        </tr>
                      </table>
                    </td>
                    <td width="25%" align="center" style="padding: 10px;">
                      <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#fef7ed" style="border-left: 4px solid #f59e0b; padding: 15px; border-radius: 8px;">
                        <tr>
                          <td align="center" style="font-size: 24px; font-weight: bold; color: #f59e0b;">${daysInRange}</td>
                        </tr>
                        <tr>
                          <td align="center" style="color: #64748b; font-size: 14px;">Days Covered</td>
                        </tr>
                      </table>
                    </td>
                    <td width="25%" align="center" style="padding: 10px;">
                      <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#fae8ff" style="border-left: 4px solid #c026d3; padding: 15px; border-radius: 8px;">
                        <tr>
                          <td align="center" style="font-size: 24px; font-weight: bold; color: #c026d3;">${overallRate}%</td>
                        </tr>
                        <tr>
                          <td align="center" style="color: #64748b; font-size: 14px;">Performance</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Performance Metrics -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#fef7ed" style="margin: 20px 0; border-radius: 8px;">
                  <tr>
                    <td style="padding: 15px;">
                      <h4 style="color: #92400e; margin: 0 0 10px 0;">📊 Performance Metrics</h4>
                      <table width="100%" border="0" cellpadding="0" cellspacing="0">
                        <tr>
                          <td width="33%" align="center">
                            <div style="font-size: 18px; font-weight: bold; color: #0ea5e9;">${totalCompleted}</div>
                            <div style="color: #64748b; font-size: 12px;">Completed Patrols</div>
                          </td>
                          <td width="33%" align="center">
                            <div style="font-size: 18px; font-weight: bold; color: #f59e0b;">${totalExpected}</div>
                            <div style="color: #64748b; font-size: 12px;">Expected Patrols</div>
                          </td>
                          <td width="33%" align="center">
                            <div style="font-size: 18px; font-weight: bold; color: #22c55e;">${complianceRate}%</div>
                            <div style="color: #64748b; font-size: 12px;">Compliance Rate</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Insights Box -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#ecfdf5" style="margin: 20px 0; border: 1px solid #a7f3d0; border-radius: 8px;">
                  <tr>
                    <td style="padding: 15px;">
                      <h4 style="color: #065f46; margin: 0 0 10px 0;">📈 Historical Insights</h4>
                      <p style="color: #065f46; margin: 0; line-height: 1.5;">
                        This comprehensive analysis reveals long-term security patterns, seasonal trends, and performance consistency 
                        across ${daysInRange} days of security operations. ${totalIncidents > 0 ? `Total of ${totalIncidents} security incidents were recorded (${reportedIncidents} reported + ${patrolIncidents} patrol alerts).` : 'No security incidents were recorded during this period.'}
                        ${filteredEventsCount > 0 ? `A total of ${filteredEventsCount} operational patrol activities were recorded and analyzed.` : ''}
                      </p>
                    </td>
                  </tr>
                </table>

                <!-- Features Box -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#fffbeb" style="margin: 20px 0; border-radius: 8px;">
                  <tr>
                    <td style="padding: 15px;">
                      <h4 style="color: #92400e; margin: 0 0 10px 0;">🔍 Report Features</h4>
                      <ul style="color: #92400e; margin: 0; padding-left: 20px;">
                        <li>Monthly performance breakdown and trends</li>
                        <li>Long-term compliance analysis</li>
                        <li>Seasonal pattern identification</li>
                        <li>Post performance evolution</li>
                        <li>Strategic recommendations</li>
                        <li>Expected vs actual patrol analysis</li>
                        <li>Performance trend analysis</li>
                      </ul>
                    </td>
                  </tr>
                </table>

                <!-- Closing Text -->
                <p style="color: #64748b; line-height: 1.6;">
                  Use this historical analysis to make data-driven decisions about your security strategy, 
                  identify areas for improvement, and benchmark future performance against historical trends.
                </p>

                <!-- Footer -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                  <tr>
                    <td>
                      <p style="color: #94a3b8; font-size: 14px; margin: 0;">
                        For strategic security consultations or detailed analysis discussions:<br>
                        Contact: <a href="mailto:strategy@bmsecurity.com" style="color: #2c5aa0; text-decoration: none;">strategy@bmsecurity.com</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Final Footer -->
          <table width="650" border="0" cellpadding="0" cellspacing="0" style="max-width: 650px; width: 100%;">
            <tr>
              <td align="center" style="padding: 20px 0; color: #94a3b8; font-size: 12px;">
                <p style="margin: 0;">BM SECURITY SERVICES • Strategic Security Intelligence</p>
                <p style="margin: 5px 0 0 0;">Analysis completed on ${dayjs().format('MMMM D, YYYY [at] h:mm A')}</p>
                <p style="margin: 5px 0 0 0; font-size: 11px; color: #cbd5e1;">
                  Report ID: ${clientId}-${dayjs().format('YYYYMMDD-HHmm')} | 
                  Data Source: Primary Database
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>
`;

  return emailHtml;
}

/**
 * Send patrol report email - WITH FIXED DAYS COVERED CALCULATION
 */
export async function sendPatrolReport({
  to,
  client,
  dateRange,
  pdfBuffer,
  pdfFilename
}) {
  console.log('📧 [EMAIL] Preparing patrol report email...');
  console.log('   Client:', client?.ClientName || client?.clientName);
  console.log('   Date range:', dateRange?.rangeLabel);
  
  // Fetch metrics using the same filtering as PDF service
  const metrics = await fetchAllMetrics(client.ClientID, dateRange.startDate, dateRange.endDate);
  
  // Add metrics to dateRange for email template - INCLUDING DAYS IN RANGE
  const emailDateRange = {
    ...dateRange,
    metrics: {
      overallRate: metrics.performanceResults.overallRate,
      totalCompleted: metrics.performanceResults.totalCompleted,
      totalExpected: metrics.performanceResults.totalExpected,
      totalZones: metrics.performanceResults.totalZones,
      totalIncidents: metrics.totalIncidents,
      reportedIncidents: metrics.reportedIncidents,
      patrolIncidents: metrics.patrolIncidents,
      performanceLevel: metrics.performanceLevel,
      complianceRate: metrics.complianceRate,
      filteredEventsCount: metrics.filteredEventsCount,
      daysInRange: metrics.daysInRange // ADD THIS LINE
    }
  };
  
  const emailHtml = generatePatrolReportEmail(client, emailDateRange, emailDateRange.metrics);
  
  const clientName = client?.ClientName || client?.clientName || 'Unknown Client';
  const clientId = client?.ClientID || client?.clientId || 'UNKNOWN';
  
  const mailOptions = {
    from: `"BM Security" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: `Security Patrol Report - ${clientName} - ${dateRange?.rangeLabel || dateRange?.startDate}`,
    html: emailHtml,
    attachments: [
      {
        filename: pdfFilename || `BM_Security_Report_${clientId}_${dayjs().format('YYYYMMDD')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  };

  return await sendEmailWithRetry(mailOptions);
}

/**
 * Send historical analysis report email - WITH FIXED DAYS COVERED CALCULATION
 */
export async function sendHistoricalReport({
  to,
  client,
  dateRange,
  pdfBuffer,
  pdfFilename
}) {
  console.log('📧 [EMAIL] Preparing historical report email...');
  
  // Fetch metrics using the same filtering as PDF service
  const metrics = await fetchAllMetrics(client.ClientID, dateRange.startDate, dateRange.endDate);
  
  // Add metrics to dateRange for email template - INCLUDING DAYS IN RANGE
  const emailDateRange = {
    ...dateRange,
    metrics: {
      overallRate: metrics.performanceResults.overallRate,
      totalCompleted: metrics.performanceResults.totalCompleted,
      totalExpected: metrics.performanceResults.totalExpected,
      totalZones: metrics.performanceResults.totalZones,
      totalIncidents: metrics.totalIncidents,
      reportedIncidents: metrics.reportedIncidents,
      patrolIncidents: metrics.patrolIncidents,
      performanceLevel: metrics.performanceLevel,
      complianceRate: metrics.complianceRate,
      filteredEventsCount: metrics.filteredEventsCount,
      daysInRange: metrics.daysInRange // ADD THIS LINE
    }
  };
  
  const emailHtml = generateHistoricalReportEmail(client, emailDateRange, emailDateRange.metrics);
  
  const clientName = client?.ClientName || client?.clientName || 'Unknown Client';
  const clientId = client?.ClientID || client?.clientId || 'UNKNOWN';
  
  const mailOptions = {
    from: `"BM Security Analytics" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: `Historical Security Analysis - ${clientName} - ${dateRange?.rangeLabel || 'Multi-Month Analysis'}`,
    html: emailHtml,
    attachments: [
      {
        filename: pdfFilename || `BM_Security_Historical_${clientId}_${dayjs().format('YYYYMMDD')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  };

  return await sendEmailWithRetry(mailOptions);
}

/**
 * Simple email send function for quick testing
 */
export async function sendSimpleEmail({ to, subject, text, html, attachments }) {
  const mailOptions = {
    from: `"BM Security" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html: html || text,
    attachments
  };

  return await sendEmailWithRetry(mailOptions);
}

export default {
  sendEmailWithRetry,
  sendPatrolReport,
  sendHistoricalReport,
  sendSimpleEmail,
  generatePatrolReportEmail,
  generateHistoricalReportEmail,
  fetchAllMetrics,
  fetchClientScheduleAndExpectedPatrols,
  calculatePerformance,
  calculateDaysInRange // EXPORT THE NEW FUNCTION
};