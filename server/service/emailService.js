// server/service/emailService.js - OFFICE 365 SMTP VERSION
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

// =====================================================
// 🔐 OFFICE 365 SMTP CONFIGURATION
// =====================================================
function validateEmailConfig() {
  const requiredVars = {
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASS: process.env.EMAIL_PASS,
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_PORT: process.env.EMAIL_PORT
  };

  const missing = Object.entries(requiredVars)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    const error = `❌ CRITICAL: Missing required environment variables: ${missing.join(', ')}`;
    console.error(error);
    console.error('📋 Please set these variables in your .env file:');
    console.error('   EMAIL_USER=leavemanagement@bmsecurity.com');
    console.error('   EMAIL_PASS=your-office365-password');
    console.error('   EMAIL_HOST=smtp.office365.com');
    console.error('   EMAIL_PORT=587');
    throw new Error(error);
  }

  console.log('✅ Office 365 SMTP configuration validated:');
  console.log(`   EMAIL_USER: ${requiredVars.EMAIL_USER}`);
  console.log(`   EMAIL_HOST: ${requiredVars.EMAIL_HOST}`);
  console.log(`   EMAIL_PORT: ${requiredVars.EMAIL_PORT}`);
  console.log(`   EMAIL_PASS: ${'*'.repeat(16)} (configured)`);

  return requiredVars;
}

/**
 * Create Office 365 email transporter
 */
function createEmailTransporter() {
  // Validate first
  const config = validateEmailConfig();
  
  console.log('📧 [EMAIL] Creating Office 365 SMTP transporter...');
  
  const smtpConfig = {
    host: config.EMAIL_HOST,
    port: parseInt(config.EMAIL_PORT),
    secure: false, // Office 365 requires secure: false for port 587
    auth: {
      user: config.EMAIL_USER,
      pass: config.EMAIL_PASS
    },
    tls: {
      ciphers: 'SSLv3',
      // Office 365 specific TLS settings
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2'
    },
    // Office 365 connection settings
    connectionTimeout: 30000, // Increased timeout for Office 365
    greetingTimeout: 15000,
    socketTimeout: 30000,
    debug: process.env.NODE_ENV === 'development',
    logger: process.env.NODE_ENV === 'development'
  };

  console.log('   Using Office 365 SMTP configuration');
  console.log(`   Host: ${smtpConfig.host}:${smtpConfig.port}`);
  console.log(`   Secure: ${smtpConfig.secure}`);
  console.log(`   User: ${smtpConfig.auth.user}`);

  const transporter = nodemailer.createTransport(smtpConfig);

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
 * Send email with retry logic - OFFICE 365 OPTIMIZED
 */
export async function sendEmailWithRetry(mailOptions, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📧 Email attempt ${attempt}/${maxRetries}...`);
      console.log(`   From: ${mailOptions.from}`);
      console.log(`   To: ${mailOptions.to}`);
      console.log(`   Subject: ${mailOptions.subject}`);
      
      const transporter = createEmailTransporter();
      
      if (attempt === 1) {
        console.log('🔧 Verifying Office 365 SMTP connection...');
        await transporter.verify();
        console.log('✅ Office 365 SMTP connection verified');
      }
      
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully: ${info.messageId}`);
      console.log(`📨 Server response: ${info.response}`);
      return info;
      
    } catch (error) {
      lastError = error;
      console.error(`❌ Email attempt ${attempt} failed:`, error.message);
      console.error(`   Error code: ${error.code}`);
      console.error(`   Command: ${error.command}`);
      
      // Handle Office 365 specific authentication errors
      if (error.code === 'EAUTH' || error.responseCode === 535) {
        console.error('❌ OFFICE 365 AUTHENTICATION FAILED!');
        console.error('   Check your .env file:');
        console.error(`   EMAIL_USER: ${process.env.EMAIL_USER}`);
        console.error('   EMAIL_PASS: Verify this is the correct Office 365 password');
        console.error('');
        console.error('💡 Office 365 Troubleshooting:');
        console.error('   1. Verify email/password in Office 365 admin center');
        console.error('   2. Check if SMTP AUTH is enabled for this account');
        console.error('   3. Ensure account has proper licenses and is active');
        console.error('   4. Check if Multi-Factor Authentication (MFA) is enabled');
        console.error('   5. If MFA is enabled, use an app-specific password');
        console.error('   6. Verify account is not locked or restricted');
        throw error; // Don't retry auth errors
      }
      
      // Handle Office 365 sending limits
      if (error.responseCode === 421 || error.responseCode === 450 || error.responseCode === 550 || error.message.includes('exceeded') || error.message.includes('quota')) {
        console.error('❌ OFFICE 365 SENDING LIMIT EXCEEDED!');
        console.error('   Office 365 has daily sending limits (typically 10,000 emails/day)');
        console.error('   Check your Office 365 admin center for current usage');
        throw error;
      }
      
      // Handle connection issues with retry
      if (error.code === 'ESOCKET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNECTION' || error.code === 'ECONNRESET' || error.message.includes('ENETUNREACH')) {
        if (attempt < maxRetries) {
          const waitTime = attempt * 5000; // Longer wait for Office 365
          console.log(`⏳ Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
      }
      
      // Handle Office 365 specific errors
      if (error.responseCode === 432 || error.message.includes('recipient')) {
        console.error('❌ OFFICE 365 RECIPIENT ERROR');
        console.error('   Check recipient email addresses for validity');
        throw error;
      }
      
      if (attempt === maxRetries) {
        console.error(`💥 Final email failure after ${maxRetries} attempts`);
        console.error('🔧 Office 365 Specific Debug Info:');
        console.error('   - Ensure SMTP AUTH is enabled in Exchange Admin Center');
        console.error('   - Check if account has "Send As" permissions if needed');
        console.error('   - Verify network can connect to Office 365 SMTP endpoints');
        throw lastError;
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
 * Fetch FILTERED events from reception tables - EXACT SAME AS PDF SERVICE (NO PATROL INCIDENTS)
 */
async function fetchFilteredEvents(clientId, startDate, endDate, receptionTables = ['p_recepcion202511', 'p_recepcion202510']) {
  try {
    console.log(`🔍 [EMAIL] Fetching FILTERED events (NO patrol incidents) for client ${clientId} (${startDate} to ${endDate})`);
    
    const validTables = receptionTables.filter(table => 
      /^p_recepcion\d{6}$/.test(table)
    );
    
    if (validTables.length === 0) {
      console.warn('⚠️ [EMAIL] No valid reception tables provided');
      return [];
    }
    
    const pool = await poolPromise;
    
    // EXACT SAME FILTERING LOGIC AS PDF SERVICE - NO PATROL INCIDENTS
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

    console.log(`✅ [EMAIL] Found ${eventsResult.recordset.length} FILTERED events (VIGICONTROL arrivals only)`);
    return eventsResult.recordset;
  } catch (error) {
    console.error(`❌ [EMAIL] Error fetching filtered events:`, error.message);
    return [];
  }
}

/**
 * Fetch completed patrol counts - EXACT SAME FILTERING AS PDF SERVICE (NO PATROL INCIDENTS)
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
    
    // EXACT SAME FILTERING AS PDF SERVICE - NO PATROL INCIDENTS
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

    console.log(`✅ [EMAIL] Found patrol counts for ${completedMap.size} posts`);
    return completedMap;
  } catch (error) {
    console.error(`❌ [EMAIL] Error fetching patrol counts:`, error.message);
    return new Map();
  }
}

/**
 * Fetch REPORTED INCIDENTS - SAME AS PDF SERVICE (NO PATROL INCIDENTS)
 */
async function fetchReportedIncidents(clientId, startDate, endDate) {
  try {
    console.log(`🚨 [EMAIL] Fetching REPORTED incidents ONLY for client ${clientId}`);
    
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
 * Clean post name by removing leading numbers and dots - SAME AS PDF SERVICE
 */
function cleanPostName(postName) {
  if (!postName) return postName;
  
  // Remove leading numbers followed by dot and space (e.g., "6. Aloy" -> "Aloy")
  return postName.replace(/^\d+\.\s*/, '').trim();
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
    const percentageDisplay = Math.round(numericPercentage) + '%';
    
    if (numericPercentage < 70) underperformingZones++;
    if (numericPercentage >= 90) excellentZones++;
    
    performanceData.push({
      SitePost: cleanPostName(postName),
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
 * Fetch and calculate all metrics - SYNCHRONIZED WITH PDF SERVICE
 */
export async function fetchAllMetrics(clientId, startDate, endDate) {
  try {
    console.log(`📊 [EMAIL] Fetching all metrics for client ${clientId}`);
    
    // Calculate days in range using SAME METHOD as PDF service
    const daysInRange = calculateDaysInRange(startDate, endDate);
    
    // Get schedule and expected patrols (same as PDF service)
    const scheduleData = await fetchClientScheduleAndExpectedPatrols(clientId, startDate, endDate);
    const expectedPatrolsPerPost = scheduleData.expectedPatrolsPerPost;
    
    // Get completed patrols using SAME FILTERING as PDF service (NO patrol incidents)
    const completedPatrols = await fetchCompletedPatrolCounts(clientId, startDate, endDate);
    
    // Calculate performance using SAME LOGIC as PDF service
    const performanceResults = calculatePerformance(completedPatrols, expectedPatrolsPerPost);
    
    // Get incidents using SAME QUERIES as PDF service (ONLY reported incidents)
    const reportedIncidents = await fetchReportedIncidents(clientId, startDate, endDate);
    const totalIncidents = reportedIncidents;
    
    // Calculate compliance rate (same as PDF service)
    const complianceRate = performanceResults.totalExpected > 0 
      ? Math.round((performanceResults.totalCompleted / performanceResults.totalExpected) * 100) 
      : 0;
    
    // Performance level (same as PDF service)
    const performanceLevel = performanceResults.overallRateNumeric >= 90 ? 'EXCELLENT' : 
                            performanceResults.overallRateNumeric >= 80 ? 'GOOD' : 
                            performanceResults.overallRateNumeric >= 70 ? 'SATISFACTORY' : 'NEEDS IMPROVEMENT';
    
    // Get filtered events count for email display (VIGICONTROL arrivals only)
    const filteredEvents = await fetchFilteredEvents(clientId, startDate, endDate);
    
    console.log(`✅ [EMAIL] Metrics calculated:`);
    console.log(`   - Days in Range: ${daysInRange} days`);
    console.log(`   - Overall Rate: ${performanceResults.overallRate}%`);
    console.log(`   - Completed: ${performanceResults.totalCompleted}/${performanceResults.totalExpected}`);
    console.log(`   - Total Incidents: ${totalIncidents} (reported incidents only)`);
    console.log(`   - Posts: ${performanceResults.totalZones}`);
    console.log(`   - Filtered Events: ${filteredEvents.length} (VIGICONTROL arrivals)`);
    console.log(`   - Schedule: ${scheduleData.scheduleInfo}`);
    
    return {
      scheduleData,
      performanceResults,
      reportedIncidents,
      totalIncidents,
      complianceRate,
      performanceLevel,
      filteredEventsCount: filteredEvents.length,
      daysInRange
    };
  } catch (error) {
    console.error(`❌ [EMAIL] Error fetching metrics:`, error.message);
    throw error;
  }
}

/**
 * Generate BM Security branded email HTML for patrol reports
 */
export function generatePatrolReportEmail(client, dateRange, metrics) {
  const logoBase64 = getLogoBase64();
  const config = validateEmailConfig();
  
  const clientName = client?.ClientName || client?.clientName || 'Unknown Client';
  const clientId = client?.ClientID || client?.clientId || 'N/A';
  
  const startDate = dateRange?.startDate || 'N/A';
  const endDate = dateRange?.endDate || 'N/A';
  const rangeLabel = dateRange?.rangeLabel || `${startDate} to ${endDate}`;
  const daysInRange = metrics?.daysInRange || dateRange?.daysInRange || 1;
  
  const {
    overallRate = 0,
    totalCompleted = 0,
    totalExpected = 0,
    totalZones = 0,
    totalIncidents = 0,
    reportedIncidents = 0,
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
                          <td align="center" style="color: #64748b; font-size: 14px;">Reported Incidents</td>
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
                        <strong>Reported Incidents:</strong> ${totalIncidents} total incidents logged<br>
                        <strong>Operational Events:</strong> ${filteredEventsCount} VIGICONTROL arrivals recorded<br>
                        <strong>Performance Level:</strong> ${performanceLevel}
                      </p>
                    </td>
                  </tr>
                </table>

                ${needsAttention ? `
                <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#fef2f2" style="margin: 20px 0; border: 1px solid #fecaca; border-radius: 8px;">
                  <tr>
                    <td style="padding: 15px;">
                      <h4 style="color: #991b1b; margin: 0 0 10px 0;">⚠️ Attention Required</h4>
                      <p style="color: #991b1b; margin: 0; line-height: 1.5;">
                        ${totalIncidents > 0 ? `<strong>${totalIncidents} security incident${totalIncidents > 1 ? 's' : ''}</strong> reported during this period. ` : ''}
                        ${overallRate < 80 ? 'Performance below target threshold. ' : ''}
                        Please review the attached detailed report.
                      </p>
                    </td>
                  </tr>
                </table>
                ` : ''}

                <p style="color: #64748b; line-height: 1.6;">
                  The detailed PDF report is attached to this email for comprehensive analysis.
                </p>

                <!-- Footer -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                  <tr>
                    <td>
                      <p style="color: #94a3b8; font-size: 14px; margin: 0;">
                        Questions? Contact: <a href="mailto:${config.EMAIL_USER}" style="color: #2c5aa0; text-decoration: none;">${config.EMAIL_USER}</a>
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
 * Generate BM Security branded email HTML for historical reports
 */
export function generateHistoricalReportEmail(client, dateRange, metrics) {
  const logoBase64 = getLogoBase64();
  const config = validateEmailConfig();
  
  const clientName = client?.ClientName || client?.clientName || 'Unknown Client';
  const clientId = client?.ClientID || client?.clientId || 'N/A';
  
  const startDate = dateRange?.startDate || 'N/A';
  const endDate = dateRange?.endDate || 'N/A';
  const rangeLabel = dateRange?.rangeLabel || `${startDate} to ${endDate}`;
  const daysInRange = metrics?.daysInRange || dateRange?.daysInRange || 1;

  const {
    overallRate = 0,
    totalCompleted = 0,
    totalExpected = 0,
    totalZones = 0,
    totalIncidents = 0,
    performanceLevel = 'N/A',
    complianceRate = 0
  } = metrics || {};

  const emailHtml = `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>BM SECURITY - Historical Analysis Report</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: Arial, sans-serif;">
  <center>
    <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f8fafc">
      <tr>
        <td align="center" style="padding: 20px 0;">
          <table width="650" border="0" cellpadding="0" cellspacing="0" style="max-width: 650px; width: 100%;">
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
                      <p style="color: #e2e8f0; margin: 10px 0 0 0; font-size: 16px;">Historical Security Analysis</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            
            <tr>
              <td bgcolor="#ffffff" style="padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h2 style="color: #1e3a8a; margin-top: 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Comprehensive Historical Analysis</h2>
                
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
                          <td style="padding: 8px 0; color: #64748b;"><strong>Overall Performance:</strong></td>
                          <td style="padding: 8px 0; color: #334155; font-weight: 600;">${overallRate}% - ${performanceLevel}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <p style="color: #64748b; line-height: 1.6;">
                  This comprehensive analysis covers ${daysInRange} days of security operations. 
                  ${totalIncidents > 0 ? `Total of ${totalIncidents} incidents were reported.` : 'No incidents reported during this period.'}
                </p>

                <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                  <tr>
                    <td>
                      <p style="color: #94a3b8; font-size: 14px; margin: 0;">
                        Contact: <a href="mailto:${config.EMAIL_USER}" style="color: #2c5aa0; text-decoration: none;">${config.EMAIL_USER}</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <table width="650" border="0" cellpadding="0" cellspacing="0" style="max-width: 650px; width: 100%;">
            <tr>
              <td align="center" style="padding: 20px 0; color: #94a3b8; font-size: 12px;">
                <p style="margin: 0;">BM SECURITY SERVICES • Strategic Security Intelligence</p>
                <p style="margin: 5px 0 0 0;">Analysis completed on ${dayjs().format('MMMM D, YYYY [at] h:mm A')}</p>
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
 * Send patrol report email - OFFICE 365 VERSION
 */
export async function sendPatrolReport({
  to,
  client,
  dateRange,
  pdfBuffer,
  pdfFilename
}) {
  const config = validateEmailConfig();
  console.log('📧 [EMAIL] Preparing patrol report email via Office 365...');
  console.log('   Client:', client?.ClientName || client?.clientName);
  console.log('   Date range:', dateRange?.rangeLabel);
  console.log('   Using Office 365:', config.EMAIL_USER);
  
  const metrics = await fetchAllMetrics(client.ClientID, dateRange.startDate, dateRange.endDate);
  
  const emailDateRange = {
    ...dateRange,
    metrics: {
      overallRate: metrics.performanceResults.overallRate,
      totalCompleted: metrics.performanceResults.totalCompleted,
      totalExpected: metrics.performanceResults.totalExpected,
      totalZones: metrics.performanceResults.totalZones,
      totalIncidents: metrics.totalIncidents,
      reportedIncidents: metrics.reportedIncidents,
      performanceLevel: metrics.performanceLevel,
      complianceRate: metrics.complianceRate,
      filteredEventsCount: metrics.filteredEventsCount,
      daysInRange: metrics.daysInRange
    }
  };
  
  const emailHtml = generatePatrolReportEmail(client, emailDateRange, emailDateRange.metrics);
  
  const clientName = client?.ClientName || client?.clientName || 'Unknown Client';
  const clientId = client?.ClientID || client?.clientId || 'UNKNOWN';
  
  const fromName = process.env.FROM_NAME || 'BM Security';
  const fromEmail = process.env.FROM_EMAIL || config.EMAIL_USER;
  
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
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
 * Send historical analysis report email - OFFICE 365 VERSION
 */
export async function sendHistoricalReport({
  to,
  client,
  dateRange,
  pdfBuffer,
  pdfFilename
}) {
  const config = validateEmailConfig();
  console.log('📧 [EMAIL] Preparing historical report email via Office 365...');
  console.log('   Using Office 365:', config.EMAIL_USER);
  
  const metrics = await fetchAllMetrics(client.ClientID, dateRange.startDate, dateRange.endDate);
  
  const emailDateRange = {
    ...dateRange,
    metrics: {
      overallRate: metrics.performanceResults.overallRate,
      totalCompleted: metrics.performanceResults.totalCompleted,
      totalExpected: metrics.performanceResults.totalExpected,
      totalZones: metrics.performanceResults.totalZones,
      totalIncidents: metrics.totalIncidents,
      reportedIncidents: metrics.reportedIncidents,
      performanceLevel: metrics.performanceLevel,
      complianceRate: metrics.complianceRate,
      filteredEventsCount: metrics.filteredEventsCount,
      daysInRange: metrics.daysInRange
    }
  };
  
  const emailHtml = generateHistoricalReportEmail(client, emailDateRange, emailDateRange.metrics);
  
  const clientName = client?.ClientName || client?.clientName || 'Unknown Client';
  const clientId = client?.ClientID || client?.clientId || 'UNKNOWN';
  
  const fromName = process.env.FROM_NAME || 'BM Security Analytics';
  const fromEmail = process.env.FROM_EMAIL || config.EMAIL_USER;
  
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
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
 * Simple email send function - OFFICE 365 VERSION
 */
export async function sendSimpleEmail({ to, subject, text, html, attachments }) {
  const config = validateEmailConfig();
  
  const fromName = process.env.FROM_NAME || 'BM Security';
  const fromEmail = process.env.FROM_EMAIL || config.EMAIL_USER;
  
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text,
    html: html || text,
    attachments
  };

  return await sendEmailWithRetry(mailOptions);
}

/**
 * Test Office 365 SMTP connection
 */
export async function testSMTPConnection() {
  try {
    console.log('🧪 Testing Office 365 SMTP connection...');
    const transporter = createEmailTransporter();
    await transporter.verify();
    console.log('✅ Office 365 SMTP connection successful!');
    return true;
  } catch (error) {
    console.error('❌ Office 365 SMTP connection failed:', error.message);
    console.error('💡 Troubleshooting tips:');
    console.error('   1. Verify EMAIL_USER and EMAIL_PASS in .env file');
    console.error('   2. Check if SMTP AUTH is enabled in Office 365 admin center');
    console.error('   3. Ensure account has proper licenses');
    console.error('   4. Verify network can connect to smtp.office365.com:587');
    console.error('   5. Check if Multi-Factor Authentication requires app password');
    return false;
  }
}

export default {
  sendEmailWithRetry,
  sendPatrolReport,
  sendHistoricalReport,
  sendSimpleEmail,
  generatePatrolReportEmail,
  generateHistoricalReportEmail,
  fetchAllMetrics,
  validateEmailConfig,
  testSMTPConnection
};