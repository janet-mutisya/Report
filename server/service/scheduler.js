// server/service/scheduler.js - PRODUCTION-READY SCHEDULER WITH EMAIL ENABLED
const cron = require("node-cron");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');
const fs = require('fs');
const path = require('path');

// =============================================
// CONFIGURATION - PRODUCTION OPTIMIZED
// =============================================
const TZ = process.env.TIMEZONE || "Africa/Nairobi";
const TEST_MODE = process.env.TEST_MODE === "true";
const EMAIL_ENABLED = process.env.ENABLE_EMAIL_SENDING === 'true' || process.env.ENABLE_EMAIL_SENDING !== 'false';
const SAVE_PDF_TO_DISK = process.env.SAVE_PDF_TO_DISK === 'true';
const PDF_TEMP_DIR = path.join(__dirname, 'temp_pdfs');

// Shift configuration
const SHIFT_START_HOUR = 18;
const SHIFT_END_HOUR = 6;

// Scheduler configuration
const SCHEDULER_CONFIG = {
  SCHEDULER_CHECK_INTERVAL: process.env.SCHEDULER_CHECK_INTERVAL || "* * * * *",
  EMAIL_SUBJECT_PREFIX: process.env.EMAIL_SUBJECT_PREFIX || "Security Report",
  DELAY_BETWEEN_CLIENTS: parseInt(process.env.DELAY_BETWEEN_CLIENTS) || 500,
  MAX_CONCURRENT_PDFS: parseInt(process.env.MAX_CONCURRENT_PDFS) || 3,
  MAX_CONCURRENT_SCHEDULES: parseInt(process.env.MAX_CONCURRENT_SCHEDULES) || 3,
  PDF_GENERATION_TIMEOUT: parseInt(process.env.PDF_GENERATION_TIMEOUT) || 90000,
  EMAIL_SEND_TIMEOUT: parseInt(process.env.EMAIL_SEND_TIMEOUT) || 15000,
  
  // Enhanced grace periods
  GRACE_PERIOD_MINUTES_PAST: parseInt(process.env.GRACE_PERIOD_MINUTES_PAST) || 60,
  GRACE_PERIOD_MINUTES_FUTURE: parseInt(process.env.GRACE_PERIOD_MINUTES_FUTURE) || 5,
  
  // Catchup mode
  ENABLE_CATCHUP_MODE: process.env.ENABLE_CATCHUP_MODE === 'true',
  CATCHUP_MAX_MINUTES_BACK: parseInt(process.env.CATCHUP_MAX_MINUTES_BACK) || 240,
  CATCHUP_MAX_SCHEDULES_PER_RUN: parseInt(process.env.CATCHUP_MAX_SCHEDULES_PER_RUN) || 20,
  
  // Logging
  LOG_ERRORS_TO_FILE: process.env.LOG_ERRORS_TO_FILE === 'true',
  ERROR_LOG_FILE: process.env.ERROR_LOG_FILE || 'scheduler_errors.log',
  SUCCESS_LOG_FILE: process.env.SUCCESS_LOG_FILE || 'scheduler_success.log',
  
  // Retry logic
  RETRY_ATTEMPTS: parseInt(process.env.EMAIL_RETRY_ATTEMPTS) || 2,
  RETRY_DELAY: parseInt(process.env.EMAIL_RETRY_DELAY) || 2000
};

console.log(`📧 EMAIL SENDING STATUS: ${EMAIL_ENABLED ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
console.log(`🔄 CATCHUP MODE: ${SCHEDULER_CONFIG.ENABLE_CATCHUP_MODE ? 'ENABLED ✅' : 'DISABLED'}`);
console.log(`⏰ GRACE WINDOW: ${SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES_PAST}m back + ${SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES_FUTURE}m forward`);

// =============================================
// PERFORMANCE STATS
// =============================================
const performanceStats = {
  totalProcessed: 0,
  successful: 0,
  failed: 0,
  timeouts: 0,
  catchupProcessed: 0,
  missedRecovered: 0,
  emailsSent: 0,
  emailsFailed: 0,
  avgProcessingTime: 0,
  lastRun: null,
  lastEmailSent: null
};

// =============================================
// DATABASE IMPORT
// =============================================
let sql, poolPromise;
try {
  const { sql: dbSql, poolPromise: dbPoolPromise } = require('../config/database');
  sql = dbSql;
  poolPromise = dbPoolPromise;
  console.log('✅ Database module loaded');
} catch (dbError) {
  console.error('❌ Database module failed to load:', dbError.message);
  throw dbError;
}

// =============================================
// SERVICE IMPORTS
// =============================================
let pdfService, emailService;
try {
  pdfService = require('./pdfService');
  emailService = require('./emailService');
  console.log('✅ PDF and Email services loaded');
} catch (error) {
  console.error('❌ Service import failed:', error.message);
  throw error;
}

// =============================================
// DAYJS PLUGINS
// =============================================
dayjs.extend(utc);
dayjs.extend(timezone);

// =============================================
// CREATE TEMP DIR IF NEEDED
// =============================================
if (SAVE_PDF_TO_DISK) {
  try {
    if (!fs.existsSync(PDF_TEMP_DIR)) {
      fs.mkdirSync(PDF_TEMP_DIR, { recursive: true });
      console.log(`📁 Created PDF temp directory: ${PDF_TEMP_DIR}`);
    }
  } catch (dirError) {
    console.warn('⚠️ Could not create PDF temp directory:', dirError.message);
  }
}

// =============================================
// HELPER FUNCTIONS
// =============================================
async function getDatabaseConnection(maxRetries = 3, retryDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const pool = await poolPromise;
      if (pool && pool.connected !== false) {
        return pool;
      }
    } catch (error) {
      if (attempt < maxRetries) {
        console.warn(`[DB] Connection attempt ${attempt} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        retryDelay *= 2;
      } else {
        throw error;
      }
    }
  }
  throw new Error('Unable to establish database connection');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================
// TIMEOUT WRAPPER WITH RETRY
// =============================================
async function withTimeoutAndRetry(promiseFn, timeoutMs, operationName, clientId = null, maxRetries = 1) {
  const startTime = Date.now();
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await Promise.race([
        promiseFn(),
        new Promise((_, reject) => 
          setTimeout(() => {
            console.error(`[TIMEOUT] ${operationName} attempt ${attempt} timed out after ${timeoutMs}ms for ${clientId || 'unknown'}`);
            reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        )
      ]);
      
      const duration = Date.now() - startTime;
      console.log(`[PERF] ${operationName} completed in ${duration}ms for ${clientId || 'unknown'} (attempt ${attempt})`);
      return result;
    } catch (error) {
      if (attempt <= maxRetries) {
        console.warn(`[RETRY] ${operationName} attempt ${attempt} failed for ${clientId || 'unknown'}: ${error.message}. Retrying...`);
        await delay(SCHEDULER_CONFIG.RETRY_DELAY * attempt);
      } else {
        performanceStats.timeouts++;
        throw error;
      }
    }
  }
}

// =============================================
// ERROR LOGGING
// =============================================
function logToFile(logType, clientId, clientName, message, details = {}) {
  try {
    if (!SCHEDULER_CONFIG.LOG_ERRORS_TO_FILE) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: logType,
      clientId,
      clientName,
      message,
      details
    };
    
    const logFile = logType === 'SUCCESS' || logType === 'EMAIL_SENT' || logType === 'CATCHUP_RECOVERED'
      ? SCHEDULER_CONFIG.SUCCESS_LOG_FILE 
      : SCHEDULER_CONFIG.ERROR_LOG_FILE;
    
    const logPath = path.join(__dirname, logFile);
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n', { encoding: 'utf8' });
  } catch (logError) {
    console.error('[LOG] Failed to write log:', logError.message);
  }
}

// =============================================
// PDF DISK SAVING
// =============================================
async function savePDFToDisk(pdfBuffer, clientName, dateRange) {
  if (!SAVE_PDF_TO_DISK) return null;
  
  try {
    const timestamp = dayjs().format('YYYYMMDD_HHmmss');
    const safeClientName = clientName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const filename = `Report_${safeClientName}_${timestamp}.pdf`;
    const filepath = path.join(PDF_TEMP_DIR, filename);
    
    await fs.promises.writeFile(filepath, pdfBuffer);
    
    const stats = await fs.promises.stat(filepath);
    console.log(`[PDF] Saved to disk: ${filename} (${Math.round(stats.size / 1024)}KB)`);
    
    return {
      filepath,
      filename,
      sizeKB: Math.round(stats.size / 1024)
    };
  } catch (error) {
    console.warn(`[PDF SAVE] Failed: ${error.message}`);
    return null;
  }
}

// =============================================
// VALIDATE EMAIL FUNCTION
// =============================================
function validateAndCleanEmail(email) {
  if (!email || typeof email !== 'string') return null;
  
  // Remove common invalid patterns
  const invalidPatterns = [
    '{', '}', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'patrol', 'Patrol', 'patrolsPerDay', 'patrolsPerWeek',
    'true', 'false', '"', '\'', ':', '[', ']', '\\'
  ];
  
  let cleanedEmail = email.trim();
  
  // Check for invalid patterns
  if (invalidPatterns.some(pattern => cleanedEmail.includes(pattern))) {
    console.log(`[EMAIL] Invalid pattern found in email: ${cleanedEmail.substring(0, 50)}...`);
    return null;
  }
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanedEmail)) {
    console.log(`[EMAIL] Invalid email format: ${cleanedEmail}`);
    return null;
  }
  
  // Check length
  if (cleanedEmail.length > 100 || cleanedEmail.length < 5) {
    console.log(`[EMAIL] Email length invalid (${cleanedEmail.length} chars): ${cleanedEmail.substring(0, 30)}...`);
    return null;
  }
  
  return cleanedEmail.toLowerCase();
}

// =============================================
// GET DUE SCHEDULES
// =============================================
async function getDueSchedules(enableCatchup = SCHEDULER_CONFIG.ENABLE_CATCHUP_MODE) {
  let pool;
  try {
    pool = await getDatabaseConnection();
    
    const now = dayjs().tz(TZ);
    const windowStart = now.subtract(SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES_PAST, 'minute');
    const windowEnd = now.add(SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES_FUTURE, 'minute');
    
    console.log(`[SCHEDULER] Checking schedules from ${windowStart.format('HH:mm:ss')} to ${windowEnd.format('HH:mm:ss')}`);
    
    let query = '';
    let parameters = {};
    
    if (enableCatchup) {
      const catchupCutoff = now.subtract(SCHEDULER_CONFIG.CATCHUP_MAX_MINUTES_BACK, 'minute');
      
      query = `
        SELECT TOP ${SCHEDULER_CONFIG.CATCHUP_MAX_SCHEDULES_PER_RUN}
          R.rep_idKey AS ScheduleID,
          R.rep_iidcuenta AS ClientID,
          C.cue_cnombre AS ClientName,
          C.cue_cemail AS ClientEmail,
          R.rep_cmail AS ReportEmail,
          R.rep_tproximoenvio AS NextRun,
          R.rep_nfrecuencia AS Frequency,
          R.rep_nCadaUnidadTiempo AS IntervalDays,
          R.rep_ntipo AS ReportType,
          CASE 
            WHEN R.rep_tproximoenvio < @catchupCutoff THEN 'MISSED'
            WHEN R.rep_tproximoenvio < @now THEN 'OVERDUE'
            ELSE 'DUE_SOON'
          END AS ScheduleStatus
        FROM [_Datos].[dbo].[m_reportes_automaticos] R
        INNER JOIN [_Datos].[dbo].[m_cuentas] C
          ON R.rep_iidcuenta = C.cue_iid
        WHERE 
          R.rep_iidcuenta IS NOT NULL
          AND R.rep_tproximoenvio IS NOT NULL
          AND (
            (R.rep_tproximoenvio >= @windowStart AND R.rep_tproximoenvio <= @windowEnd)
            OR 
            (R.rep_tproximoenvio < @now AND R.rep_tproximoenvio >= @catchupCutoff)
          )
          AND R.rep_nfrecuencia IN (1, 2, 3)
        ORDER BY 
          CASE WHEN R.rep_tproximoenvio < @now THEN 0 ELSE 1 END,
          R.rep_tproximoenvio ASC
      `;
      
      parameters = {
        windowStart: windowStart.format('YYYY-MM-DD HH:mm:ss'),
        windowEnd: windowEnd.format('YYYY-MM-DD HH:mm:ss'),
        now: now.format('YYYY-MM-DD HH:mm:ss'),
        catchupCutoff: catchupCutoff.format('YYYY-MM-DD HH:mm:ss')
      };
      
    } else {
      query = `
        SELECT 
          R.rep_idKey AS ScheduleID,
          R.rep_iidcuenta AS ClientID,
          C.cue_cnombre AS ClientName,
          C.cue_cemail AS ClientEmail,
          R.rep_cmail AS ReportEmail,
          R.rep_tproximoenvio AS NextRun,
          R.rep_nfrecuencia AS Frequency,
          R.rep_nCadaUnidadTiempo AS IntervalDays,
          R.rep_ntipo AS ReportType,
          CASE 
            WHEN R.rep_tproximoenvio < @now THEN 'OVERDUE'
            ELSE 'DUE_SOON'
          END AS ScheduleStatus
        FROM [_Datos].[dbo].[m_reportes_automaticos] R
        INNER JOIN [_Datos].[dbo].[m_cuentas] C
          ON R.rep_iidcuenta = C.cue_iid
        WHERE 
          R.rep_iidcuenta IS NOT NULL
          AND R.rep_tproximoenvio IS NOT NULL
          AND R.rep_tproximoenvio >= @windowStart
          AND R.rep_tproximoenvio <= @windowEnd
          AND R.rep_nfrecuencia IN (1, 2, 3)
        ORDER BY R.rep_tproximoenvio ASC
      `;
      
      parameters = {
        windowStart: windowStart.format('YYYY-MM-DD HH:mm:ss'),
        windowEnd: windowEnd.format('YYYY-MM-DD HH:mm:ss'),
        now: now.format('YYYY-MM-DD HH:mm:ss')
      };
    }
    
    const request = pool.request();
    Object.entries(parameters).forEach(([key, value]) => {
      request.input(key, sql.DateTime, value);
    });
    
    const result = await request.query(query);

    const validSchedules = [];
    for (const schedule of (result.recordset || [])) {
      if (!schedule.ClientID) continue;
      
      // Validate emails
      let validEmail = null;
      
      // Try report email first
      if (schedule.ReportEmail) {
        validEmail = validateAndCleanEmail(schedule.ReportEmail);
      }
      
      // Fall back to client email
      if (!validEmail && schedule.ClientEmail) {
        validEmail = validateAndCleanEmail(schedule.ClientEmail);
      }
      
      if (!validEmail) {
        console.log(`[EMAIL] No valid email for ${schedule.ClientName}. Report: "${schedule.ReportEmail}", Client: "${schedule.ClientEmail}"`);
        logToFile('INVALID_EMAIL', schedule.ClientID, schedule.ClientName, 
          `No valid email found`, { 
            reportEmail: schedule.ReportEmail,
            clientEmail: schedule.ClientEmail 
          });
        continue;
      }
      
      schedule.ValidatedEmail = validEmail;
      validSchedules.push(schedule);
    }

    // Log results
    if (validSchedules.length > 0) {
      console.log(`[SCHEDULER] ✅ Found ${validSchedules.length} schedule(s) to process`);
      
      const statusCounts = { MISSED: 0, OVERDUE: 0, DUE_SOON: 0 };
      
      validSchedules.forEach((schedule, index) => {
        const scheduleTime = dayjs(schedule.NextRun).tz(TZ).format('HH:mm:ss');
        const scheduleDate = dayjs(schedule.NextRun).tz(TZ).format('YYYY-MM-DD');
        const dueInMinutes = dayjs(schedule.NextRun).diff(now, 'minute', true);
        const status = schedule.ScheduleStatus || (dueInMinutes <= 0 ? 'OVERDUE' : 'DUE_SOON');
        
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        
        const timeDiff = Math.abs(dueInMinutes).toFixed(1);
        const timeDesc = dueInMinutes <= 0 ? `${timeDiff} minutes ago` : `${timeDiff} minutes from now`;
        
        console.log(`  ${index + 1}. ${schedule.ClientName} - ${scheduleDate} ${scheduleTime} (${timeDesc}) [${status}]`);
      });
      
      console.log(`[SCHEDULER] 📊 Status: ${statusCounts.MISSED} missed, ${statusCounts.OVERDUE} overdue, ${statusCounts.DUE_SOON} due soon`);
      
      if (statusCounts.MISSED > 0) {
        performanceStats.missedRecovered += statusCounts.MISSED;
        console.log(`[SCHEDULER] 🔄 Recovering ${statusCounts.MISSED} missed schedule(s)`);
      }
      
    } else {
      console.log(`[SCHEDULER] ℹ️ No due schedules found`);
    }
    
    return validSchedules;
  } catch (error) {
    console.error('[SCHEDULER] Error fetching schedules:', error.message);
    logToFile('DB_ERROR', null, null, `Error fetching schedules: ${error.message}`);
    return [];
  }
}

// =============================================
// GET DATE RANGE FOR FREQUENCY
// =============================================
function getDateRangeForFrequency(frequency, intervalDays = 1, runTime = null) {
  const runDate = runTime ? dayjs(runTime).tz(TZ) : dayjs().tz(TZ);
  
  let lastCompletedShiftDay;
  if (runDate.hour() < SHIFT_END_HOUR) {
    lastCompletedShiftDay = runDate.subtract(1, 'day').startOf('day');
  } else {
    lastCompletedShiftDay = runDate.startOf('day');
  }
  
  const reportEndDate = lastCompletedShiftDay.subtract(1, 'day');
  
  switch (frequency) {
    case 1: {
      const shiftDay = reportEndDate;
      return {
        startDate: shiftDay.format('YYYY-MM-DD'),
        endDate: shiftDay.format('YYYY-MM-DD'),
        frequency: 'daily',
        reportDate: shiftDay.format('YYYY-MM-DD')
      };
    }
      
    case 2: {
      const end = reportEndDate;
      const start = end.subtract(6, 'day');
      return {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
        frequency: 'weekly',
        reportDate: end.format('YYYY-MM-DD')
      };
    }

    case 3: {
      const previousMonth = runDate.subtract(1, 'month');
      const monthStart = previousMonth.startOf('month');
      const monthEnd = previousMonth.endOf('month');
      
      return {
        startDate: monthStart.format('YYYY-MM-DD'),
        endDate: monthEnd.format('YYYY-MM-DD'),
        frequency: 'monthly',
        reportDate: monthEnd.format('YYYY-MM-DD')
      };
    }
      
    default: {
      const defaultDay = reportEndDate;
      return {
        startDate: defaultDay.format('YYYY-MM-DD'),
        endDate: defaultDay.format('YYYY-MM-DD'),
        frequency: 'unknown',
        reportDate: defaultDay.format('YYYY-MM-DD')
      };
    }
  }
}

// =============================================
// UPDATE NEXT RUN TIME
// =============================================
async function updateNextRunTime(schedule) {
  let pool;
  try {
    pool = await getDatabaseConnection();
    
    const now = dayjs().tz(TZ);
    const originalRunTime = schedule.NextRun instanceof Date 
      ? dayjs(schedule.NextRun).tz(TZ)
      : dayjs.tz(schedule.NextRun, TZ);
    
    const scheduledHour = originalRunTime.hour();
    const scheduledMinute = originalRunTime.minute();
    
    let baseTime = originalRunTime;
    
    // Calculate next run based on frequency
    switch (schedule.Frequency) {
      case 1:
        baseTime = baseTime.add(schedule.IntervalDays || 1, 'day');
        break;
      case 2:
        const weeks = schedule.IntervalDays || 1;
        baseTime = baseTime.add(weeks, 'week');
        break;
      case 3:
        const months = schedule.IntervalDays || 1;
        baseTime = baseTime.add(months, 'month');
        break;
      default:
        baseTime = baseTime.add(1, 'day');
    }
    
    // Preserve the scheduled time
    let newNextRun = baseTime
      .set('hour', scheduledHour)
      .set('minute', scheduledMinute)
      .set('second', 0)
      .set('millisecond', 0);
    
    // Ensure it's in the future
    const minFutureTime = now.add(1, 'minute');
    if (newNextRun.isBefore(minFutureTime)) {
      console.log(`[UPDATE] Calculated time is too soon, adding another interval`);
      
      if (schedule.Frequency === 1) {
        baseTime = baseTime.add(schedule.IntervalDays || 1, 'day');
      } else if (schedule.Frequency === 2) {
        baseTime = baseTime.add(schedule.IntervalDays || 1, 'week');
      } else if (schedule.Frequency === 3) {
        baseTime = baseTime.add(schedule.IntervalDays || 1, 'month');
      }
      
      newNextRun = baseTime
        .set('hour', scheduledHour)
        .set('minute', scheduledMinute)
        .set('second', 0)
        .set('millisecond', 0);
    }
    
    const formattedNextRun = newNextRun.format('YYYY-MM-DD HH:mm:ss');
    
    // Update database
    const result = await pool.request()
      .input('ScheduleID', sql.Int, schedule.ScheduleID)
      .input('NextRun', sql.DateTime, formattedNextRun)
      .query(`
        UPDATE [_Datos].[dbo].[m_reportes_automaticos]
        SET rep_tproximoenvio = @NextRun
        WHERE rep_idKey = @ScheduleID
      `);

    console.log(`[UPDATE] ✅ Schedule ${schedule.ScheduleID} updated to ${formattedNextRun}`);

    logToFile('SCHEDULE_UPDATED', schedule.ClientID, schedule.ClientName, 
      `Next run updated`, { 
        scheduleId: schedule.ScheduleID,
        originalTime: originalRunTime.format('YYYY-MM-DD HH:mm:ss'),
        newTime: formattedNextRun
      });
    
    return formattedNextRun;
  } catch (error) {
    console.error(`[UPDATE] ❌ Failed to update schedule ${schedule.ScheduleID}:`, error.message);
    logToFile('SCHEDULE_UPDATE_ERROR', schedule.ClientID, schedule.ClientName, 
      `Failed to update schedule: ${error.message}`);
    throw error;
  }
}

// =============================================
// SEND EMAIL WITH RETRY LOGIC
// =============================================
async function sendEmailWithRetry(emailData, clientName, maxRetries = SCHEDULER_CONFIG.RETRY_ATTEMPTS) {
  const emailFunc = emailService?.sendGuardReport || emailService?.default?.sendGuardReport;
  if (!emailFunc || typeof emailFunc !== 'function') {
    throw new Error('Email service function not available');
  }
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      console.log(`[EMAIL] Attempt ${attempt} for ${clientName} to ${emailData.to}`);
      
      await withTimeoutAndRetry(
        () => emailFunc(emailData),
        SCHEDULER_CONFIG.EMAIL_SEND_TIMEOUT,
        'Email sending',
        clientName,
        0 // No retry inside timeout wrapper (we handle retries here)
      );
      
      performanceStats.emailsSent++;
      performanceStats.lastEmailSent = new Date().toISOString();
      
      console.log(`[EMAIL] ✅ Successfully sent to ${emailData.to} (attempt ${attempt})`);
      return true;
      
    } catch (emailError) {
      if (attempt <= maxRetries) {
        console.warn(`[EMAIL] Attempt ${attempt} failed for ${clientName}: ${emailError.message}. Retrying in ${SCHEDULER_CONFIG.RETRY_DELAY}ms...`);
        await delay(SCHEDULER_CONFIG.RETRY_DELAY * attempt);
      } else {
        performanceStats.emailsFailed++;
        console.error(`[EMAIL] ❌ All attempts failed for ${clientName}: ${emailError.message}`);
        throw emailError;
      }
    }
  }
}

// =============================================
// PROCESS SINGLE SCHEDULE
// =============================================
async function processSchedule(schedule, customDateRange = null, isCatchup = false) {
  const { ClientID, ClientName, ValidatedEmail, Frequency, IntervalDays, ScheduleID, NextRun } = schedule;
  const startTime = Date.now();
  
  const prefix = isCatchup ? '[CATCHUP]' : '[SCHEDULER]';
  console.log(`\n${prefix} Processing: ${ClientName} (ID: ${ClientID})`);
  
  if (isCatchup) {
    performanceStats.catchupProcessed++;
    console.log(`${prefix} 🔄 Catchup run for missed schedule`);
  }
  
  try {
    // Validate required fields
    if (!ClientID || !ValidatedEmail) {
      throw new Error(!ClientID ? 'Missing ClientID' : 'Missing valid email');
    }
    
    // Get date range
    const dateRange = customDateRange || getDateRangeForFrequency(Frequency, IntervalDays, NextRun);
    console.log(`${prefix} Period: ${dateRange.startDate} to ${dateRange.endDate}`);
    
    // Generate PDF
    const pdfData = {
      clientId: ClientID,
      clientName: ClientName,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      frequency: dateRange.frequency,
      reportDate: dateRange.reportDate,
      isCatchup: isCatchup
    };
    
    const pdfFunc = pdfService?.generateDashboardPDF || pdfService?.default?.generateDashboardPDF;
    if (!pdfFunc || typeof pdfFunc !== 'function') {
      throw new Error('PDF generation function not available');
    }
    
    console.log(`${prefix} Generating PDF...`);
    const pdfBuffer = await withTimeoutAndRetry(
      () => pdfFunc(pdfData),
      SCHEDULER_CONFIG.PDF_GENERATION_TIMEOUT,
      'PDF generation',
      ClientID,
      0
    );
    
    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
      throw new Error('PDF generation returned empty buffer');
    }
    
    console.log(`${prefix} PDF generated (${Math.round(pdfBuffer.length / 1024)}KB)`);
    
    // Save PDF to disk if enabled
    if (SAVE_PDF_TO_DISK) {
      await savePDFToDisk(pdfBuffer, ClientName, dateRange);
    }
    
    // Update next run time BEFORE sending email
    let updatedNextRun = null;
    try {
      updatedNextRun = await updateNextRunTime(schedule);
      console.log(`${prefix} Next run updated to: ${updatedNextRun}`);
    } catch (updateError) {
      console.error(`${prefix} Failed to update schedule: ${updateError.message}`);
      // Continue with email sending
    }
    
    // SEND EMAIL (ALWAYS ENABLED IN THIS VERSION)
    const emailData = {
      to: ValidatedEmail,
      clientName: ClientName,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      pdfBuffer: pdfBuffer,
      pdfFilename: `Security_Report_${ClientName.replace(/\s+/g, '_')}_${dateRange.startDate}_${dateRange.endDate}${isCatchup ? '_CATCHUP' : ''}.pdf`,
      frequency: dateRange.frequency,
      reportDate: dateRange.reportDate,
      subjectPrefix: SCHEDULER_CONFIG.EMAIL_SUBJECT_PREFIX,
      isCatchup: isCatchup
    };
    
    let emailSuccess = false;
    let emailError = null;
    
    try {
      await sendEmailWithRetry(emailData, ClientName);
      emailSuccess = true;
      
      const logType = isCatchup ? 'CATCHUP_RECOVERED' : 'EMAIL_SENT';
      logToFile(logType, ClientID, ClientName, `Report sent successfully${isCatchup ? ' (catchup)' : ''}`, {
        email: ValidatedEmail,
        dateRange: `${dateRange.startDate} to ${dateRange.endDate}`,
        nextRun: updatedNextRun
      });
      
    } catch (emailSendError) {
      emailError = emailSendError.message;
      logToFile('EMAIL_SEND_ERROR', ClientID, ClientName, `Email failed: ${emailError}`, {
        email: ValidatedEmail,
        nextRun: updatedNextRun,
        isCatchup
      });
    }
    
    const duration = Date.now() - startTime;
    updateStats(emailSuccess, duration, isCatchup);
    
    return {
      success: emailSuccess,
      email: ValidatedEmail,
      scheduleId: ScheduleID,
      clientId: ClientID,
      clientName: ClientName,
      nextRun: updatedNextRun,
      processingTime: duration,
      isCatchup,
      error: emailError
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`${prefix} Failed for ${ClientName} after ${duration}ms:`, error.message);
    
    updateStats(false, duration, isCatchup);
    logToFile('PROCESS_ERROR', ClientID, ClientName, error.message, {
      scheduleId: ScheduleID,
      processingTime: duration,
      isCatchup
    });
    
    // Try to update schedule even on failure
    try {
      await updateNextRunTime(schedule).catch(e => {
        console.warn(`${prefix} Failed to update on error: ${e.message}`);
      });
    } catch (updateError) {
      // Ignore
    }
    
    return {
      success: false,
      scheduleId: ScheduleID,
      clientId: ClientID,
      clientName: ClientName,
      error: error.message,
      processingTime: duration,
      isCatchup
    };
  }
}

// =============================================
// UPDATE PERFORMANCE STATS
// =============================================
function updateStats(success, duration, isCatchup = false) {
  performanceStats.totalProcessed++;
  
  if (success) {
    performanceStats.successful++;
  } else {
    performanceStats.failed++;
  }
  
  if (isCatchup) {
    performanceStats.catchupProcessed++;
  }
  
  const prevTotalTime = performanceStats.avgProcessingTime * (performanceStats.totalProcessed - 1);
  performanceStats.avgProcessingTime = (prevTotalTime + duration) / performanceStats.totalProcessed;
  
  performanceStats.lastRun = new Date().toISOString();
}

// =============================================
// PROCESS SCHEDULES CONCURRENTLY
// =============================================
async function processSchedulesConcurrently(schedules, customDateRange = null) {
  const results = {
    processed: 0,
    successful: 0,
    failed: 0,
    catchup: 0,
    details: []
  };
  
  const batchSize = Math.min(SCHEDULER_CONFIG.MAX_CONCURRENT_SCHEDULES, SCHEDULER_CONFIG.MAX_CONCURRENT_PDFS);
  
  for (let i = 0; i < schedules.length; i += batchSize) {
    const batch = schedules.slice(i, i + batchSize);
    console.log(`\n[SCHEDULER] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(schedules.length / batchSize)} (${batch.length} schedules)`);
    
    const batchPromises = batch.map(schedule => {
      const isCatchup = schedule.ScheduleStatus === 'MISSED' || schedule.ScheduleStatus === 'OVERDUE';
      return processSchedule(schedule, customDateRange, isCatchup)
        .then(result => ({ schedule, result }))
        .catch(error => ({ schedule, result: null, error }))
    });
    
    const batchResults = await Promise.allSettled(batchPromises);
    
    for (const settledResult of batchResults) {
      results.processed++;
      
      if (settledResult.status === 'fulfilled') {
        const { schedule, result, error } = settledResult.value;
        
        if (error) {
          results.failed++;
          results.details.push({
            client: schedule?.ClientName || 'Unknown',
            success: false,
            error: error.message
          });
          continue;
        }
        
        if (result) {
          if (result.success) {
            results.successful++;
            if (result.isCatchup) results.catchup++;
          } else {
            results.failed++;
          }
          
          results.details.push({
            client: result.clientName,
            success: result.success,
            email: result.email,
            nextRun: result.nextRun,
            processingTime: result.processingTime,
            isCatchup: result.isCatchup,
            error: result.error
          });
        }
      } else {
        results.failed++;
        results.details.push({
          client: 'Unknown',
          success: false,
          error: settledResult.reason?.message || 'Unknown error'
        });
      }
    }
    
    if (i + batchSize < schedules.length) {
      await delay(SCHEDULER_CONFIG.DELAY_BETWEEN_CLIENTS);
    }
  }
  
  return results;
}

// =============================================
// MANUAL CATCHUP FUNCTION
// =============================================
async function runCatchupMode(minutesBack = SCHEDULER_CONFIG.CATCHUP_MAX_MINUTES_BACK) {
  console.log(`\n🔄 MANUAL CATCHUP MODE: Looking for missed schedules up to ${minutesBack} minutes back`);
  
  const now = dayjs().tz(TZ);
  const cutoffTime = now.subtract(minutesBack, 'minute');
  
  let pool;
  try {
    pool = await getDatabaseConnection();
    
    const result = await pool.request()
      .input('cutoffTime', sql.DateTime, cutoffTime.format('YYYY-MM-DD HH:mm:ss'))
      .input('now', sql.DateTime, now.format('YYYY-MM-DD HH:mm:ss'))
      .query(`
        SELECT TOP ${SCHEDULER_CONFIG.CATCHUP_MAX_SCHEDULES_PER_RUN}
          R.rep_idKey AS ScheduleID,
          R.rep_iidcuenta AS ClientID,
          C.cue_cnombre AS ClientName,
          C.cue_cemail AS ClientEmail,
          R.rep_cmail AS ReportEmail,
          R.rep_tproximoenvio AS NextRun,
          R.rep_nfrecuencia AS Frequency,
          R.rep_nCadaUnidadTiempo AS IntervalDays,
          R.rep_ntipo AS ReportType,
          'MISSED' AS ScheduleStatus
        FROM [_Datos].[dbo].[m_reportes_automaticos] R
        INNER JOIN [_Datos].[dbo].[m_cuentas] C
          ON R.rep_iidcuenta = C.cue_iid
        WHERE 
          R.rep_iidcuenta IS NOT NULL
          AND R.rep_tproximoenvio IS NOT NULL
          AND R.rep_tproximoenvio < @now
          AND R.rep_tproximoenvio >= @cutoffTime
          AND R.rep_nfrecuencia IN (1, 2, 3)
        ORDER BY R.rep_tproximoenvio ASC
      `);
    
    const missedSchedules = result.recordset || [];
    
    if (missedSchedules.length === 0) {
      console.log(`[CATCHUP] No missed schedules found in the last ${minutesBack} minutes`);
      return { success: true, message: 'No missed schedules found', count: 0 };
    }
    
    console.log(`[CATCHUP] Found ${missedSchedules.length} missed schedule(s) to recover`);
    
    const results = await processSchedulesConcurrently(missedSchedules);
    
    console.log(`[CATCHUP] ✅ Catchup complete: ${results.successful} recovered, ${results.failed} failed`);
    
    return {
      success: true,
      results: results,
      catchupCount: missedSchedules.length,
      timestamp: now.format('YYYY-MM-DD HH:mm:ss')
    };
    
  } catch (error) {
    console.error(`[CATCHUP] Failed:`, error.message);
    return {
      success: false,
      error: error.message,
      timestamp: now.format('YYYY-MM-DD HH:mm:ss')
    };
  }
}

// =============================================
// MAIN SCHEDULER FUNCTION
// =============================================
async function runDynamicReportScheduler(options = {}) {
  const { 
    useCustomDateRange = false,
    customDateRange = null,
    enableCatchup = SCHEDULER_CONFIG.ENABLE_CATCHUP_MODE
  } = options;
  
  const startTime = Date.now();
  const now = dayjs().tz(TZ);
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`⏰ SCHEDULER RUN STARTED: ${now.format('YYYY-MM-DD HH:mm:ss')}`);
  console.log(`📧 Email sending: ${EMAIL_ENABLED ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
  console.log(`🔄 Catchup mode: ${enableCatchup ? 'ENABLED' : 'DISABLED'}`);
  console.log(`${'='.repeat(70)}`);
  
  try {
    const dueSchedules = await getDueSchedules(enableCatchup);
    
    if (dueSchedules.length === 0) {
      console.log('[SCHEDULER] No due schedules found');
      return { success: true, message: 'No due schedules' };
    }
    
    console.log(`[SCHEDULER] Processing ${dueSchedules.length} schedule(s)...`);
    
    const results = await processSchedulesConcurrently(
      dueSchedules, 
      useCustomDateRange ? customDateRange : null
    );
    
    const totalTime = Date.now() - startTime;
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📊 SCHEDULER COMPLETE in ${totalTime}ms`);
    console.log(`${'='.repeat(70)}`);
    console.log(`  Processed: ${results.processed}`);
    console.log(`  Successful: ${results.successful}`);
    console.log(`  Catchup Recovered: ${results.catchup}`);
    console.log(`  Failed: ${results.failed}`);
    
    console.log(`\n  📈 Performance Stats:`);
    console.log(`     Total processed: ${performanceStats.totalProcessed}`);
    console.log(`     Emails sent: ${performanceStats.emailsSent}`);
    console.log(`     Emails failed: ${performanceStats.emailsFailed}`);
    console.log(`     Success rate: ${performanceStats.totalProcessed > 0 ? 
      Math.round(performanceStats.successful / performanceStats.totalProcessed * 100) : 0}%`);
    console.log(`     Avg time: ${Math.round(performanceStats.avgProcessingTime)}ms`);
    console.log(`     Last email: ${performanceStats.lastEmailSent ? new Date(performanceStats.lastEmailSent).toLocaleTimeString() : 'Never'}`);
    
    if (results.failed > 0) {
      console.log(`\n  ⚠️  Errors:`);
      results.details.filter(d => !d.success).slice(0, 5).forEach(err => {
        const catchupTag = err.isCatchup ? '[CATCHUP] ' : '';
        console.log(`     • ${catchupTag}${err.client}: ${err.error}`);
      });
    }

    console.log(`${'='.repeat(70)}\n`);

    logToFile('SCHEDULER_COMPLETE', null, null, `Scheduler run completed`, {
      processed: results.processed,
      successful: results.successful,
      catchup: results.catchup,
      failed: results.failed,
      totalTime,
      emailsSent: performanceStats.emailsSent,
      timestamp: now.format('YYYY-MM-DD HH:mm:ss')
    });

    return {
      success: true,
      results: results,
      timestamp: now.format('YYYY-MM-DD HH:mm:ss'),
      totalTime,
      emailsSent: performanceStats.emailsSent,
      performance: { ...performanceStats }
    };
    
  } catch (error) {
    console.error(`[SCHEDULER] Fatal error:`, error.message);
    
    logToFile('SCHEDULER_FATAL_ERROR', null, null, `Scheduler fatal error: ${error.message}`);
    
    return {
      success: false,
      error: error.message,
      timestamp: now.format('YYYY-MM-DD HH:mm:ss')
    };
  }
}

// =============================================
// INITIALIZE CRON SCHEDULER
// =============================================
let schedulerTask = null;

function initializeScheduler(intervalPattern = SCHEDULER_CONFIG.SCHEDULER_CHECK_INTERVAL) {
  try {
    if (schedulerTask) {
      schedulerTask.stop();
      console.log('🔄 Stopped previous scheduler instance');
    }
    
    console.log(`⏰ Initializing scheduler to run every minute`);
    console.log(`📧 EMAIL SENDING: ${EMAIL_ENABLED ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
    console.log(`🔄 CATCHUP MODE: ${SCHEDULER_CONFIG.ENABLE_CATCHUP_MODE ? 'ENABLED ✅' : 'DISABLED'}`);
    
    schedulerTask = cron.schedule(intervalPattern, async () => {
      try {
        console.log(`\n⏰ SCHEDULER TRIGGERED AT: ${dayjs().tz(TZ).format('HH:mm:ss')}`);
        await runDynamicReportScheduler();
      } catch (error) {
        console.error('❌ Scheduler execution error:', error.message);
      }
    }, {
      scheduled: true,
      timezone: TZ
    });
    
    schedulerTask.start();
    console.log('✅ Scheduler initialized and started');
    
    // Initial catchup on startup
    if (SCHEDULER_CONFIG.ENABLE_CATCHUP_MODE) {
      setTimeout(() => {
        console.log('\n🚀 Running initial startup catchup...');
        runCatchupMode().catch(err => {
          console.warn('Startup catchup failed:', err.message);
        });
      }, 15000);
    }
    
    return schedulerTask;
  } catch (error) {
    console.error('❌ Failed to initialize scheduler:', error.message);
    throw error;
  }
}

// =============================================
// MANUAL CONTROL FUNCTIONS
// =============================================
async function triggerManualRun(customDateRange = null, enableCatchup = true) {
  console.log(`\n🚀 Triggering manual scheduler run...`);
  const options = customDateRange ? {
    useCustomDateRange: true,
    customDateRange: customDateRange,
    enableCatchup: enableCatchup
  } : {
    enableCatchup: enableCatchup
  };
  
  return await runDynamicReportScheduler(options);
}

function stopScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    console.log('🛑 Scheduler stopped');
    return true;
  }
  console.log('ℹ️ No scheduler running to stop');
  return false;
}

function startScheduler() {
  if (schedulerTask && schedulerTask.getStatus() === 'scheduled') {
    console.log('ℹ️ Scheduler already running');
    return schedulerTask;
  }
  
  console.log('🚀 Starting scheduler...');
  return initializeScheduler();
}

function updateSchedulerInterval(newIntervalPattern) {
  try {
    console.log(`⏰ Updating scheduler interval to: "${newIntervalPattern}"`);
    
    if (schedulerTask) {
      schedulerTask.stop();
    }
    
    schedulerTask = cron.schedule(newIntervalPattern, async () => {
      try {
        console.log(`\n⏰ SCHEDULER TRIGGERED AT: ${dayjs().tz(TZ).format('HH:mm:ss')}`);
        await runDynamicReportScheduler();
      } catch (error) {
        console.error('❌ Scheduler execution error:', error.message);
      }
    }, {
      scheduled: true,
      timezone: TZ
    });
    
    schedulerTask.start();
    console.log(`✅ Scheduler interval updated`);
    
    return schedulerTask;
  } catch (error) {
    console.error('❌ Failed to update scheduler interval:', error.message);
    throw error;
  }
}

// =============================================
// GET SCHEDULER STATUS
// =============================================
function getSchedulerStatus() {
  const status = schedulerTask ? schedulerTask.getStatus() : 'not_initialized';
  
  return {
    running: status === 'scheduled',
    status: status,
    timezone: TZ,
    checkInterval: SCHEDULER_CONFIG.SCHEDULER_CHECK_INTERVAL,
    emailEnabled: EMAIL_ENABLED,
    catchupMode: {
      enabled: SCHEDULER_CONFIG.ENABLE_CATCHUP_MODE,
      maxMinutesBack: SCHEDULER_CONFIG.CATCHUP_MAX_MINUTES_BACK
    },
    performanceStats: { 
      totalProcessed: performanceStats.totalProcessed,
      successful: performanceStats.successful,
      emailsSent: performanceStats.emailsSent,
      emailsFailed: performanceStats.emailsFailed,
      catchupProcessed: performanceStats.catchupProcessed,
      lastRun: performanceStats.lastRun,
      lastEmailSent: performanceStats.lastEmailSent
    }
  };
}

// =============================================
// EXPORTS
// =============================================
module.exports = {
  runDynamicReportScheduler,
  initializeScheduler,
  stopScheduler,
  startScheduler,
  updateSchedulerInterval,
  triggerManualRun,
  runCatchupMode,
  getSchedulerStatus,
  getDueSchedules,
  processSchedule,
  getDateRangeForFrequency,
  updateNextRunTime
};