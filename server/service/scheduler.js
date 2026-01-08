// server/service/scheduler.js - UNIVERSAL SCHEDULER (ANY TIME)

import cron from "node-cron";
import dotenv from "dotenv";
import dayjs from "dayjs";
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql, poolPromise } from "../config/database.js";
import * as pdfService from './pdfService.js';
import * as emailService from './emailService.js';

// Import the optimized report model
import { fetchWeeklyReport } from '../models/reportModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || "Africa/Nairobi";
const TEST_MODE = process.env.TEST_MODE === "true";

// Email kill switch
const EMAIL_ENABLED = global.EMAIL_SENDING_ENABLED !== undefined 
  ? global.EMAIL_SENDING_ENABLED 
  : process.env.ENABLE_EMAIL_SENDING === 'true';

// PDF storage for debugging
const SAVE_PDF_TO_DISK = process.env.SAVE_PDF_TO_DISK === 'true';
const PDF_TEMP_DIR = path.join(__dirname, '..', '..', 'temp_pdfs');

if (SAVE_PDF_TO_DISK && !fs.existsSync(PDF_TEMP_DIR)) {
  fs.mkdirSync(PDF_TEMP_DIR, { recursive: true });
}

// ✅ UNIVERSAL: Run every 15 minutes to catch ANY scheduled time
const SCHEDULER_CONFIG = {
  // Check every 15 minutes for due schedules
  SCHEDULER_CHECK_INTERVAL: process.env.SCHEDULER_CHECK_INTERVAL || "*/15 * * * *",
  EMAIL_SUBJECT_PREFIX: process.env.EMAIL_SUBJECT_PREFIX || "Security Report",
  DELAY_BETWEEN_CLIENTS: parseInt(process.env.DELAY_BETWEEN_CLIENTS) || 1000,
  LOG_ERRORS_TO_FILE: process.env.LOG_ERRORS_TO_FILE === 'true',
  ERROR_LOG_FILE: process.env.ERROR_LOG_FILE || 'scheduler_errors.log',
  MAX_CONCURRENT_PDFS: parseInt(process.env.MAX_CONCURRENT_PDFS) || 3,
  PDF_GENERATION_TIMEOUT: parseInt(process.env.PDF_GENERATION_TIMEOUT) || 60000,
  EMAIL_SEND_TIMEOUT: parseInt(process.env.EMAIL_SEND_TIMEOUT) || 30000,
  // New: Process any schedule that's past due (even by minutes/hours)
  PROCESS_PAST_DUE_UP_TO_HOURS: parseInt(process.env.PROCESS_PAST_DUE_UP_TO_HOURS) || 24
};

/**
 * Delay utility
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Timeout wrapper for promises
 */
function withTimeout(promise, timeoutMs, operationName) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

/**
 * Log error to file
 */
function logErrorToFile(errorType, clientId, clientName, errorMessage, details = {}) {
  if (!SCHEDULER_CONFIG.LOG_ERRORS_TO_FILE) return;
  
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: errorType,
      clientId,
      clientName,
      message: errorMessage,
      details
    };
    
    fs.appendFileSync(
      path.join(__dirname, '..', '..', SCHEDULER_CONFIG.ERROR_LOG_FILE),
      JSON.stringify(logEntry) + '\n',
      { encoding: 'utf8' }
    );
  } catch (logError) {
    console.error('[SCHEDULER] Failed to write error log:', logError.message);
  }
}

/**
 * Save PDF to disk (non-blocking)
 */
async function savePDFToDisk(pdfBuffer, clientName, dateRange) {
  if (!SAVE_PDF_TO_DISK) return null;
  
  try {
    const timestamp = dayjs().format('YYYYMMDD_HHmmss');
    const safeClientName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `BM_Report_${safeClientName}_${timestamp}.pdf`;
    const filepath = path.join(PDF_TEMP_DIR, filename);
    
    await fs.promises.writeFile(filepath, pdfBuffer);
    
    const stats = await fs.promises.stat(filepath);
    return {
      filepath,
      filename,
      sizeKB: Math.round(stats.size / 1024)
    };
  } catch (error) {
    console.error(`[SCHEDULER] PDF save failed: ${error.message}`);
    return null;
  }
}

/**
 * Generate PDF with timeout and error handling
 */
async function generatePDF(pdfData) {
  try {
    let pdfBuffer = null;
    
    if (typeof pdfService.generateDashboardPDF === 'function') {
      pdfBuffer = await withTimeout(
        pdfService.generateDashboardPDF(pdfData),
        SCHEDULER_CONFIG.PDF_GENERATION_TIMEOUT,
        'PDF generation'
      );
    } else if (pdfService.default?.generateDashboardPDF) {
      pdfBuffer = await withTimeout(
        pdfService.default.generateDashboardPDF(pdfData),
        SCHEDULER_CONFIG.PDF_GENERATION_TIMEOUT,
        'PDF generation'
      );
    } else {
      throw new Error('PDF generation function not found');
    }
    
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('PDF generation returned empty buffer');
    }
    
    return pdfBuffer;
  } catch (error) {
    throw new Error(`PDF generation failed: ${error.message}`);
  }
}

/**
 * Send email with timeout
 */
async function sendEmail(emailData) {
  if (!EMAIL_ENABLED) {
    return { 
      success: true, 
      skipped: true, 
      reason: 'Email sending disabled'
    };
  }

  try {
    let result;
    
    if (typeof emailService.sendGuardReport === 'function') {
      result = await withTimeout(
        emailService.sendGuardReport(emailData),
        SCHEDULER_CONFIG.EMAIL_SEND_TIMEOUT,
        'Email sending'
      );
    } else if (emailService.default?.sendGuardReport) {
      result = await withTimeout(
        emailService.default.sendGuardReport(emailData),
        SCHEDULER_CONFIG.EMAIL_SEND_TIMEOUT,
        'Email sending'
      );
    } else {
      throw new Error('Email function not found');
    }
    
    return result || { success: true };
  } catch (error) {
    throw new Error(`Email sending failed: ${error.message}`);
  }
}

/**
 * ✅ FIXED: Get ALL schedules that are due (at ANY time)
 */
async function getDueSchedules() {
  try {
    const pool = await poolPromise;
    const now = dayjs().tz(TZ);
    
    // ✅ Get schedules that are due (next run time <= now)
    // Also include schedules that are up to X hours past due (in case server was down)
    const pastDueThreshold = now.subtract(SCHEDULER_CONFIG.PROCESS_PAST_DUE_UP_TO_HOURS, 'hour');
    
    console.log(`[SCHEDULER] Checking schedules due by ${now.format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`[SCHEDULER] Including past due up to: ${pastDueThreshold.format('YYYY-MM-DD HH:mm:ss')}`);

    const result = await pool.request()
      .input('currentTime', sql.DateTime, now.format('YYYY-MM-DD HH:mm:ss'))
      .input('pastDueThreshold', sql.DateTime, pastDueThreshold.format('YYYY-MM-DD HH:mm:ss'))
      .query(`
        SELECT 
          R.rep_idKey AS ScheduleID,
          R.rep_iidcuenta AS ClientID,
          C.cue_cnombre AS ClientName,
          C.cue_cemail AS ClientEmail,
          R.rep_cmail AS ReportEmail,
          R.rep_tproximoenvio AS NextRun,
          R.rep_nfrecuencia AS Frequency,
          R.rep_nCadaUnidadTiempo AS IntervalDays,
          R.rep_ntipo AS ReportType
        FROM [_Datos].[dbo].[m_reportes_automaticos] R
        INNER JOIN [_Datos].[dbo].[m_cuentas] C
          ON R.rep_iidcuenta = C.cue_iid
        WHERE 
          R.rep_iidcuenta IS NOT NULL
          AND R.rep_tproximoenvio IS NOT NULL
          AND R.rep_tproximoenvio <= @currentTime
          AND R.rep_tproximoenvio >= @pastDueThreshold
          AND R.rep_nfrecuencia IN (1, 2, 3) -- Daily, Weekly, Monthly only
        ORDER BY R.rep_tproximoenvio ASC
      `);

    // Validate schedules
    const validSchedules = (result.recordset || []).filter(schedule => {
      if (!schedule.ClientID) {
        console.warn(`[SCHEDULER] Skipping schedule ${schedule.ScheduleID}: Missing ClientID`);
        return false;
      }
      
      const email = schedule.ReportEmail || schedule.ClientEmail;
      if (!email || email.includes('{') || email.includes('patrolsPerDay')) {
        console.warn(`[SCHEDULER] Skipping ${schedule.ClientName}: Invalid email`);
        return false;
      }
      
      return true;
    });

    console.log(`[SCHEDULER] Found ${validSchedules.length} due schedules (${result.recordset.length - validSchedules.length} skipped)`);
    
    // Log next run times for debugging
    if (validSchedules.length > 0) {
      console.log(`[SCHEDULER] Due schedules:`);
      validSchedules.slice(0, 5).forEach(schedule => {
        const freqMap = {1: 'Daily', 2: 'Weekly', 3: 'Monthly'};
        console.log(`  - ${schedule.ClientName} (${freqMap[schedule.Frequency] || 'Unknown'}): Due at ${dayjs(schedule.NextRun).tz(TZ).format('YYYY-MM-DD HH:mm:ss')}`);
      });
      if (validSchedules.length > 5) {
        console.log(`  ... and ${validSchedules.length - 5} more`);
      }
    }
    
    return validSchedules;
  } catch (error) {
    console.error('[SCHEDULER] Error fetching schedules:', error.message);
    logErrorToFile('FETCH_SCHEDULES_ERROR', null, null, error.message);
    return [];
  }
}

/**
 * ✅ FIXED: Get date range based on frequency AND current date
 * This respects whatever day/time the scheduler runs
 */
function getDateRangeForFrequency(frequency, intervalDays = 1, runTime = null) {
  const runDate = runTime ? dayjs(runTime).tz(TZ) : dayjs().tz(TZ);
  
  switch (frequency) {
    case 1: // Daily - Previous day
      const previousDay = runDate.subtract(1, 'day');
      return {
        startDate: previousDay.format('YYYY-MM-DD'),
        endDate: previousDay.format('YYYY-MM-DD'),
        rangeLabel: `Daily Report: ${previousDay.format('MMM D, YYYY')}`,
        frequency: 'daily',
        reportDate: previousDay.format('YYYY-MM-DD')
      };
      
    case 2: // Weekly - Previous completed week (Monday-Sunday)
      const previousWeekStart = runDate.subtract(1, 'week').startOf('isoWeek');
      const previousWeekEnd = runDate.subtract(1, 'week').endOf('isoWeek');
      return {
        startDate: previousWeekStart.format('YYYY-MM-DD'),
        endDate: previousWeekEnd.format('YYYY-MM-DD'),
        rangeLabel: `Weekly Report: ${previousWeekStart.format('MMM D')} - ${previousWeekEnd.format('MMM D, YYYY')}`,
        frequency: 'weekly',
        reportDate: previousWeekEnd.format('YYYY-MM-DD')
      };
      
    case 3: // Monthly - Previous completed month
      const previousMonthStart = runDate.subtract(1, 'month').startOf('month');
      const previousMonthEnd = runDate.subtract(1, 'month').endOf('month');
      return {
        startDate: previousMonthStart.format('YYYY-MM-DD'),
        endDate: previousMonthEnd.format('YYYY-MM-DD'),
        rangeLabel: `Monthly Report: ${previousMonthStart.format('MMMM YYYY')}`,
        frequency: 'monthly',
        reportDate: previousMonthEnd.format('YYYY-MM-DD')
      };
      
    default:
      // Default to previous day if unknown frequency
      const defaultDay = runDate.subtract(1, 'day');
      return {
        startDate: defaultDay.format('YYYY-MM-DD'),
        endDate: defaultDay.format('YYYY-MM-DD'),
        rangeLabel: `Report: ${defaultDay.format('MMM D, YYYY')}`,
        frequency: 'unknown',
        reportDate: defaultDay.format('YYYY-MM-DD')
      };
  }
}

/**
 * Get current week range (for testing)
 */
function getCurrentWeekRange() {
  const currentDate = dayjs().tz(TZ);
  const startOfWeek = currentDate.startOf('isoWeek');
  const endOfWeek = currentDate.endOf('isoWeek');
  
  return {
    startDate: startOfWeek.format('YYYY-MM-DD'),
    endDate: endOfWeek.format('YYYY-MM-DD'),
    rangeLabel: `Current Week: ${startOfWeek.format('MMM D')} - ${endOfWeek.format('MMM D, YYYY')}`,
    frequency: 'weekly'
  };
}

/**
 * Get last 7 days range
 */
function getLast7DaysRange() {
  const currentDate = dayjs().tz(TZ);
  const startDate = currentDate.subtract(7, 'days');
  const endDate = currentDate.subtract(1, 'day');
  
  return {
    startDate: startDate.format('YYYY-MM-DD'),
    endDate: endDate.format('YYYY-MM-DD'),
    rangeLabel: `Last 7 Days: ${startDate.format('MMM D')} - ${endDate.format('MMM D, YYYY')}`,
    frequency: 'weekly'
  };
}

/**
 * ✅ FIXED: Update next run time based on frequency and current schedule
 */
async function updateNextRunTime(schedule) {
  try {
    const pool = await poolPromise;
    
    // Use the ORIGINAL next run time as base (not current time)
    // This prevents schedule drift if processing is delayed
    const lastScheduledRun = dayjs(schedule.NextRun).tz(TZ);
    let newNextRun = lastScheduledRun;
    
    // Calculate next run based on frequency FROM THE SCHEDULED TIME
    switch (schedule.Frequency) {
      case 1: // Daily
        newNextRun = newNextRun.add(schedule.IntervalDays || 1, "day");
        break;
      case 2: // Weekly
        newNextRun = newNextRun.add(schedule.IntervalDays || 1, "week");
        break;
      case 3: // Monthly
        newNextRun = newNextRun.add(schedule.IntervalDays || 1, "month");
        break;
      default:
        newNextRun = newNextRun.add(1, "day");
    }
    
    // Ensure next run is in the future (at least 1 minute from now)
    const now = dayjs().tz(TZ);
    if (newNextRun.isBefore(now.add(1, 'minute'))) {
      // If calculated time is in the past, add one more interval
      switch (schedule.Frequency) {
        case 1: newNextRun = now.add(schedule.IntervalDays || 1, "day"); break;
        case 2: newNextRun = now.add(schedule.IntervalDays || 1, "week"); break;
        case 3: newNextRun = now.add(schedule.IntervalDays || 1, "month"); break;
        default: newNextRun = now.add(1, "day");
      }
    }
    
    const originalTime = lastScheduledRun.format('YYYY-MM-DD HH:mm:ss');
    const newTime = newNextRun.format('YYYY-MM-DD HH:mm:ss');
    
    console.log(`[SCHEDULER] Updating schedule ${schedule.ScheduleID}: ${originalTime} → ${newTime}`);
    
    await pool.request()
      .input('ScheduleID', sql.Int, schedule.ScheduleID)
      .input('NextRun', sql.DateTime, newTime)
      .query(`
        UPDATE [_Datos].[dbo].[m_reportes_automaticos]
        SET rep_tproximoenvio = @NextRun
        WHERE rep_idKey = @ScheduleID
      `);

    return newTime;
  } catch (error) {
    console.error(`[SCHEDULER] Failed to update schedule: ${error.message}`);
    throw error;
  }
}

/**
 * ✅ FIXED: Process individual schedule - Respects scheduled time
 */
async function processSchedule(schedule, customDateRange = null) {
  const { ClientID, ClientName, ReportEmail, ClientEmail, Frequency, IntervalDays, NextRun } = schedule;
  const startTime = Date.now();
  
  try {
    const freqMap = {1: 'Daily', 2: 'Weekly', 3: 'Monthly'};
    const frequencyLabel = freqMap[Frequency] || `Unknown (${Frequency})`;
    
    console.log(`\n[SCHEDULER] Processing: ${ClientName} (ID: ${ClientID})`);
    console.log(`[SCHEDULER] Frequency: ${frequencyLabel}`);
    console.log(`[SCHEDULER] Scheduled time: ${dayjs(NextRun).tz(TZ).format('YYYY-MM-DD HH:mm:ss')}`);
    
    // Validate ClientID early
    if (!ClientID) {
      console.warn(`[SCHEDULER] ⚠️ Skipping: Missing ClientID`);
      return { success: false, skipped: true, reason: 'Missing ClientID' };
    }
    
    // Validate email early
    let finalEmail = ReportEmail || ClientEmail;
    if (finalEmail && (finalEmail.includes('{') || finalEmail.includes('patrolsPerDay'))) {
      finalEmail = ClientEmail;
    }
    
    if (!finalEmail) {
      console.warn(`[SCHEDULER] ⚠️ Skipping ${ClientName}: No valid email`);
      return { success: false, skipped: true, reason: 'No email address' };
    }

    // ✅ CRITICAL FIX: Use scheduled run time for date calculation
    // This ensures reports are for the correct period regardless of when processed
    const dateRange = customDateRange || getDateRangeForFrequency(Frequency, IntervalDays, NextRun);
    const isManualTest = customDateRange !== null;

    console.log(`[SCHEDULER] 📧 Email: ${finalEmail}`);
    console.log(`[SCHEDULER] 📅 Period: ${dateRange.startDate} to ${dateRange.endDate}`);
    console.log(`[SCHEDULER] 📅 Report date: ${dateRange.reportDate}`);

    // Generate PDF
    console.log('[SCHEDULER] 🎨 Generating PDF...');
    
    const pdfData = {
      clientId: ClientID,
      clientName: ClientName,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      frequency: dateRange.frequency,
      reportDate: dateRange.reportDate
    };

    let pdfBuffer;
    try {
      pdfBuffer = await generatePDF(pdfData);
      const sizeKB = Math.round(pdfBuffer.length / 1024);
      console.log(`[SCHEDULER] ✅ PDF generated: ${sizeKB} KB in ${Date.now() - startTime}ms`);
    } catch (pdfError) {
      console.error(`[SCHEDULER] ❌ PDF generation failed: ${pdfError.message}`);
      logErrorToFile('PDF_GENERATION_ERROR', ClientID, ClientName, pdfError.message, { dateRange });
      return { success: false, error: 'PDF generation failed', details: pdfError.message };
    }

    // Save PDF to disk (non-blocking)
    if (SAVE_PDF_TO_DISK) {
      savePDFToDisk(pdfBuffer, ClientName, dateRange).catch(err => 
        console.warn(`[SCHEDULER] PDF save failed: ${err.message}`)
      );
    }

    // Skip email in test mode
    if (TEST_MODE) {
      console.log(`[SCHEDULER] 🚫 TEST MODE - Would send to ${finalEmail}`);
      return { 
        success: true, 
        testMode: true, 
        email: finalEmail,
        frequency: frequencyLabel,
        isManualTest
      };
    }

    // Send email
    console.log('[SCHEDULER] 📧 Sending email...');
    
    const emailData = {
      to: finalEmail,
      clientName: ClientName,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      pdfBuffer: pdfBuffer,
      pdfFilename: `BM_Security_Report_${ClientName.replace(/\s+/g, '_')}_${dateRange.startDate}.pdf`,
      frequency: frequencyLabel,
      reportDate: dateRange.reportDate
    };

    try {
      const emailResult = await sendEmail(emailData);
      
      if (emailResult.skipped) {
        console.log(`[SCHEDULER] 🛑 Email skipped: ${emailResult.reason}`);
        return { 
          success: true, 
          emailSkipped: true, 
          email: finalEmail,
          reason: emailResult.reason,
          frequency: frequencyLabel,
          isManualTest
        };
      }
      
      const totalTime = Date.now() - startTime;
      console.log(`[SCHEDULER] ✅ ${frequencyLabel} report sent to ${finalEmail} in ${totalTime}ms`);
      
      return { 
        success: true, 
        email: finalEmail,
        frequency: frequencyLabel,
        processingTime: totalTime,
        isManualTest
      };
      
    } catch (emailError) {
      console.error(`[SCHEDULER] ❌ Email failed: ${emailError.message}`);
      logErrorToFile('EMAIL_SEND_ERROR', ClientID, ClientName, emailError.message, { to: finalEmail });
      return { success: false, error: 'Email sending failed', details: emailError.message };
    }

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[SCHEDULER] ❌ Failed after ${totalTime}ms: ${error.message}`);
    logErrorToFile('PROCESS_SCHEDULE_ERROR', ClientID, ClientName, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Process schedules with concurrency control
 */
async function processSchedulesWithConcurrency(schedules, customDateRange = null, skipScheduleUpdate = false) {
  const results = {
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    testMode: 0,
    byFrequency: { daily: 0, weekly: 0, monthly: 0 },
    errors: []
  };

  const batchSize = SCHEDULER_CONFIG.MAX_CONCURRENT_PDFS;
  
  for (let i = 0; i < schedules.length; i += batchSize) {
    const batch = schedules.slice(i, i + batchSize);
    console.log(`\n[SCHEDULER] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(schedules.length / batchSize)}`);
    
    const batchPromises = batch.map(schedule => 
      processSchedule(schedule, customDateRange)
        .then(result => ({ schedule, result, error: null }))
        .catch(error => ({ schedule, result: null, error }))
    );
    
    const batchResults = await Promise.allSettled(batchPromises);
    
    // Process batch results
    for (const settledResult of batchResults) {
      results.processed++;
      
      if (settledResult.status === 'fulfilled') {
        const { schedule, result, error } = settledResult.value;
        
        if (error) {
          results.failed++;
          results.errors.push({ client: schedule.ClientName, error: error.message });
          continue;
        }
        
        if (!result) {
          results.failed++;
          continue;
        }
        
        // Track by frequency
        const freq = schedule.Frequency === 1 ? 'daily' : schedule.Frequency === 2 ? 'weekly' : 'monthly';
        results.byFrequency[freq]++;
        
        if (result.skipped) {
          results.skipped++;
        } else if (result.testMode || result.isManualTest) {
          results.testMode++;
        } else if (result.success) {
          results.successful++;
          
          // Only update schedule if successful and not in test mode
          if (!result.emailSkipped && !skipScheduleUpdate && !result.isManualTest) {
            try {
              await updateNextRunTime(schedule);
            } catch (updateError) {
              console.warn(`[SCHEDULER] Failed to update schedule: ${updateError.message}`);
            }
          }
        } else {
          results.failed++;
          results.errors.push({ client: schedule.ClientName, error: result.error || 'Unknown error' });
        }
      } else {
        // Promise rejected
        results.failed++;
        results.errors.push({ client: 'Unknown', error: settledResult.reason?.message || 'Unknown error' });
      }
    }
    
    // Only delay between batches if there are more batches
    if (i + batchSize < schedules.length) {
      await delay(SCHEDULER_CONFIG.DELAY_BETWEEN_CLIENTS);
    }
  }
  
  return results;
}

/**
 * ✅ UNIVERSAL: Main Scheduler - Runs frequently to catch ANY scheduled time
 */
export async function runDynamicReportScheduler(options = {}) {
  const { 
    useCustomDateRange = false,
    customDateRange = null,
    skipScheduleUpdate = false,
    forceProcessAll = false
  } = options;
  
  const now = dayjs().tz(TZ);
  console.log("\n" + "=".repeat(70));
  console.log("⏰ UNIVERSAL SCHEDULER TRIGGERED");
  console.log(`✅ Current time: ${now.format('YYYY-MM-DD HH:mm:ss')}`);
  console.log("✅ Checks EVERY 15 minutes for due schedules");
  console.log("✅ Supports ANY scheduled time (Daily, Weekly, Monthly)");
  console.log("✅ Non-blocking parallel processing");
  
  if (useCustomDateRange && customDateRange) {
    console.log(`🔧 CUSTOM DATE RANGE: ${customDateRange.startDate} to ${customDateRange.endDate}`);
  }
  
  if (skipScheduleUpdate) {
    console.log("⏸️  SCHEDULE UPDATE: DISABLED");
  }
  
  if (forceProcessAll) {
    console.log("🔧 FORCE PROCESS ALL: ENABLED");
  }
  
  if (!EMAIL_ENABLED) {
    console.log("🛑 EMAIL SENDING DISABLED");
  }
  
  console.log(`🔧 Max concurrent: ${SCHEDULER_CONFIG.MAX_CONCURRENT_PDFS}`);
  console.log("=".repeat(70));

  const startTime = now;

  try {
    const dueSchedules = await getDueSchedules();

    if (dueSchedules.length === 0) {
      console.log("✅ No due schedules found at this time.");
      return { success: true, message: "No due schedules" };
    }

    console.log(`\n📨 Processing ${dueSchedules.length} due schedule(s)...`);
    
    // Show breakdown by frequency
    const freqCount = { daily: 0, weekly: 0, monthly: 0, unknown: 0 };
    dueSchedules.forEach(s => {
      if (s.Frequency === 1) freqCount.daily++;
      else if (s.Frequency === 2) freqCount.weekly++;
      else if (s.Frequency === 3) freqCount.monthly++;
      else freqCount.unknown++;
    });
    
    console.log(`   📊 Frequency breakdown:`);
    console.log(`      Daily: ${freqCount.daily}`);
    console.log(`      Weekly: ${freqCount.weekly}`);
    console.log(`      Monthly: ${freqCount.monthly}`);
    if (freqCount.unknown > 0) console.log(`      Unknown: ${freqCount.unknown}`);

    const results = await processSchedulesWithConcurrency(
      dueSchedules, 
      useCustomDateRange ? customDateRange : null,
      skipScheduleUpdate
    );

    const endTime = dayjs().tz(TZ);
    const duration = endTime.diff(startTime, 'second');
    
    console.log("\n" + "=".repeat(70));
    console.log("📊 SCHEDULER RUN COMPLETED");
    console.log("=".repeat(70));
    console.log(`   ⏰ Duration: ${duration} seconds`);
    console.log(`   ✅ Successful: ${results.successful}`);
    console.log(`   🔧 Test runs: ${results.testMode}`);
    console.log(`   🛑 Skipped: ${results.skipped}`);
    console.log(`   ❌ Failed: ${results.failed}`);
    console.log(`   📋 Total processed: ${results.processed}`);
    
    console.log(`\n   📈 By Frequency:`);
    console.log(`      Daily: ${results.byFrequency.daily}`);
    console.log(`      Weekly: ${results.byFrequency.weekly}`);
    console.log(`      Monthly: ${results.byFrequency.monthly}`);
    
    if (results.errors.length > 0) {
      console.log(`\n   ⚠️  Errors:`);
      results.errors.slice(0, 5).forEach(err => {
        console.log(`      - ${err.client}: ${err.error}`);
      });
      if (results.errors.length > 5) {
        console.log(`      ... and ${results.errors.length - 5} more errors`);
      }
    }
    
    if (!EMAIL_ENABLED) {
      console.log(`\n   ⚠️  EMAIL SENDING IS DISABLED`);
    }
    
    console.log("=".repeat(70) + "\n");

    return {
      success: true,
      results: results,
      processedAt: now.format('YYYY-MM-DD HH:mm:ss'),
      duration: duration
    };

  } catch (error) {
    console.error("[SCHEDULER] ❌ Runtime error:", error.message);
    logErrorToFile('SCHEDULER_RUNTIME_ERROR', null, null, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * ✅ Get upcoming schedules (for monitoring)
 */
export async function getUpcomingSchedules(hoursAhead = 24) {
  try {
    const pool = await poolPromise;
    const now = dayjs().tz(TZ);
    const futureTime = now.add(hoursAhead, 'hour');
    
    const result = await pool.request()
      .input('currentTime', sql.DateTime, now.format('YYYY-MM-DD HH:mm:ss'))
      .input('futureTime', sql.DateTime, futureTime.format('YYYY-MM-DD HH:mm:ss'))
      .query(`
        SELECT 
          R.rep_idKey AS ScheduleID,
          R.rep_iidcuenta AS ClientID,
          C.cue_cnombre AS ClientName,
          R.rep_tproximoenvio AS NextRun,
          R.rep_nfrecuencia AS Frequency,
          R.rep_nCadaUnidadTiempo AS IntervalDays
        FROM [_Datos].[dbo].[m_reportes_automaticos] R
        INNER JOIN [_Datos].[dbo].[m_cuentas] C
          ON R.rep_iidcuenta = C.cue_iid
        WHERE 
          R.rep_tproximoenvio > @currentTime
          AND R.rep_tproximoenvio <= @futureTime
          AND R.rep_nfrecuencia IN (1, 2, 3)
        ORDER BY R.rep_tproximoenvio ASC
      `);
    
    return result.recordset.map(schedule => ({
      ...schedule,
      NextRunFormatted: dayjs(schedule.NextRun).tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
      FrequencyName: schedule.Frequency === 1 ? 'Daily' : schedule.Frequency === 2 ? 'Weekly' : 'Monthly'
    }));
  } catch (error) {
    console.error('[SCHEDULER] Error fetching upcoming schedules:', error.message);
    return [];
  }
}

// Initialize
console.log("\n" + "⭐".repeat(70));
console.log("🚀 UNIVERSAL SCHEDULER INITIALIZED");
console.log("⭐".repeat(70));
console.log("📊 Configuration:");
console.log(`   - Check Interval: ${SCHEDULER_CONFIG.SCHEDULER_CHECK_INTERVAL}`);
console.log(`   - Timezone: ${TZ}`);
console.log(`   - Test Mode: ${TEST_MODE}`);
console.log(`   - Email: ${EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}`);
console.log(`   - Max Concurrent: ${SCHEDULER_CONFIG.MAX_CONCURRENT_PDFS}`);
console.log(`   - Process Past Due: ${SCHEDULER_CONFIG.PROCESS_PAST_DUE_UP_TO_HOURS} hours`);
console.log(`   - Current Time: ${dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')}`);
console.log("⭐".repeat(70) + "\n");

// ✅ UNIVERSAL: Start cron job that checks frequently for due schedules
if (!TEST_MODE) {
  cron.schedule(SCHEDULER_CONFIG.SCHEDULER_CHECK_INTERVAL, () => {
    const triggerTime = dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss');
    console.log(`\n⏰ SCHEDULER CHECK TRIGGERED: ${triggerTime}`);
    runDynamicReportScheduler();
  });
  console.log(`✅ Scheduler active: Checking every 15 minutes for due schedules`);
} else {
  console.log("🛑 TEST MODE: Scheduler disabled");
}

// Manual triggers
export async function triggerDynamicReportsNow() {
  console.log("[SCHEDULER] 🔧 Manual trigger...");
  return await runDynamicReportScheduler();
}

export async function triggerTestWithCurrentWeek() {
  console.log("[SCHEDULER] 🔧 TEST: Current week...");
  const dateRange = getCurrentWeekRange();
  return await runDynamicReportScheduler({
    useCustomDateRange: true,
    customDateRange: dateRange,
    skipScheduleUpdate: true
  });
}

export async function triggerTestWithLast7Days() {
  console.log("[SCHEDULER] 🔧 TEST: Last 7 days...");
  const dateRange = getLast7DaysRange();
  return await runDynamicReportScheduler({
    useCustomDateRange: true,
    customDateRange: dateRange,
    skipScheduleUpdate: true
  });
}

/**
 * Test specific time simulation
 */
export async function triggerTestAtTime(simulatedTime) {
  console.log(`[SCHEDULER] 🔧 TEST: Simulating time ${simulatedTime}...`);
  
  const simTime = dayjs(simulatedTime).tz(TZ);
  const dateRange = getDateRangeForFrequency(1, 1, simTime); // Daily report
  
  console.log(`Simulated report for: ${dateRange.rangeLabel}`);
  
  // Create mock schedule for testing
  const mockSchedule = {
    ScheduleID: 999,
    ClientID: 48,
    ClientName: 'Test Client',
    ReportEmail: process.env.TEST_EMAIL || 'test@example.com',
    Frequency: 1,
    IntervalDays: 1,
    NextRun: simTime.toDate()
  };
  
  return await processSchedule(mockSchedule, dateRange);
}

/**
 * Force process ALL schedules (regardless of next run time)
 */
export async function forceProcessAllSchedules() {
  console.log("[SCHEDULER] 🔧 FORCE: Processing ALL schedules...");
  
  try {
    const pool = await poolPromise;
    
    // Get ALL active schedules
    const result = await pool.request()
      .query(`
        SELECT 
          R.rep_idKey AS ScheduleID,
          R.rep_iidcuenta AS ClientID,
          C.cue_cnombre AS ClientName,
          C.cue_cemail AS ClientEmail,
          R.rep_cmail AS ReportEmail,
          R.rep_tproximoenvio AS NextRun,
          R.rep_nfrecuencia AS Frequency,
          R.rep_nCadaUnidadTiempo AS IntervalDays
        FROM [_Datos].[dbo].[m_reportes_automaticos] R
        INNER JOIN [_Datos].[dbo].[m_cuentas] C
          ON R.rep_iidcuenta = C.cue_iid
        WHERE 
          R.rep_nfrecuencia IN (1, 2, 3)
          AND C.cue_cemail IS NOT NULL
          AND C.cue_cemail != ''
        ORDER BY R.rep_iidcuenta
      `);
    
    const schedules = result.recordset || [];
    console.log(`[SCHEDULER] Found ${schedules.length} total schedules to force process`);
    
    const results = await processSchedulesWithConcurrency(
      schedules,
      null,
      true // Skip schedule update
    );
    
    return results;
    
  } catch (error) {
    console.error("[SCHEDULER] Force process error:", error.message);
    return { success: false, error: error.message };
  }
}

export async function triggerPatrolReportsNow() {
  console.log("[SCHEDULER] 🔧 Patrol reports trigger...");
  return await runDynamicReportScheduler();
}

export async function triggerDebugStatus() {
  console.log("[SCHEDULER] 🔧 Debug status...");
  
  const now = dayjs().tz(TZ);
  const upcoming = await getUpcomingSchedules(24);
  
  const status = {
    timestamp: now.format('YYYY-MM-DD HH:mm:ss'),
    emailEnabled: EMAIL_ENABLED,
    testMode: TEST_MODE,
    savePDFToDisk: SAVE_PDF_TO_DISK,
    errorLogging: SCHEDULER_CONFIG.LOG_ERRORS_TO_FILE,
    timezone: TZ,
    checkInterval: SCHEDULER_CONFIG.SCHEDULER_CHECK_INTERVAL,
    maxConcurrent: SCHEDULER_CONFIG.MAX_CONCURRENT_PDFS,
    processPastDueHours: SCHEDULER_CONFIG.PROCESS_PAST_DUE_UP_TO_HOURS,
    upcomingSchedules: upcoming.length,
    nextCheck: now.add(15, 'minute').format('HH:mm')
  };
  
  console.log("\n📊 Scheduler Status:");
  console.log(JSON.stringify(status, null, 2));
  
  if (upcoming.length > 0) {
    console.log("\n📅 Upcoming schedules (next 24 hours):");
    upcoming.slice(0, 10).forEach(schedule => {
      console.log(`   - ${schedule.ClientName} (${schedule.FrequencyName}): ${schedule.NextRunFormatted}`);
    });
    if (upcoming.length > 10) {
      console.log(`   ... and ${upcoming.length - 10} more`);
    }
  }
  
  if (SAVE_PDF_TO_DISK && fs.existsSync(PDF_TEMP_DIR)) {
    const files = fs.readdirSync(PDF_TEMP_DIR);
    console.log(`\n💾 Temp PDFs (${files.length} files):`);
    files.slice(0, 10).forEach(file => {
      const stats = fs.statSync(path.join(PDF_TEMP_DIR, file));
      console.log(`   - ${file} (${Math.round(stats.size / 1024)} KB)`);
    });
    if (files.length > 10) {
      console.log(`   ... and ${files.length - 10} more files`);
    }
  }
  
  return status;
}

export default {
  runDynamicReportScheduler,
  triggerDynamicReportsNow,
  triggerDebugStatus, 
  triggerPatrolReportsNow,
  triggerTestWithCurrentWeek,
  triggerTestWithLast7Days,
  triggerTestAtTime,          // ✅ NEW: Test specific time
  forceProcessAllSchedules,   // ✅ NEW: Force process all
  getUpcomingSchedules,       // ✅ NEW: View upcoming schedules
  setEmailEnabled: (enabled) => {
    global.EMAIL_SENDING_ENABLED = enabled;
    console.log(`[SCHEDULER] Email sending ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }
};