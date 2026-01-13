// server/service/scheduler.js - OPTIMIZED FOR 60-SECOND CHECKS

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

// ✅ OPTIMIZED: Run every 60 seconds (1 minute) for faster response
const SCHEDULER_CONFIG = {
  SCHEDULER_CHECK_INTERVAL: process.env.SCHEDULER_CHECK_INTERVAL || "* * * * *", // Every 1 minute
  EMAIL_SUBJECT_PREFIX: process.env.EMAIL_SUBJECT_PREFIX || "Security Report",
  DELAY_BETWEEN_CLIENTS: parseInt(process.env.DELAY_BETWEEN_CLIENTS) || 500, // Reduced from 1000ms
  LOG_ERRORS_TO_FILE: process.env.LOG_ERRORS_TO_FILE === 'true',
  ERROR_LOG_FILE: process.env.ERROR_LOG_FILE || 'scheduler_errors.log',
  SUCCESS_LOG_FILE: process.env.SUCCESS_LOG_FILE || 'scheduler_success.log',
  MAX_CONCURRENT_PDFS: parseInt(process.env.MAX_CONCURRENT_PDFS) || 5, // Increased from 3
  PDF_GENERATION_TIMEOUT: parseInt(process.env.PDF_GENERATION_TIMEOUT) || 45000, // Reduced from 60000
  EMAIL_SEND_TIMEOUT: parseInt(process.env.EMAIL_SEND_TIMEOUT) || 20000, // Reduced from 30000
  PROCESS_PAST_DUE_UP_TO_HOURS: parseInt(process.env.PROCESS_PAST_DUE_UP_TO_HOURS) || 1, // Reduced from 24
  GRACE_PERIOD_MINUTES: parseInt(process.env.GRACE_PERIOD_MINUTES) || 10 // New: 10-minute grace period
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
 * ✅ ENHANCED: Log both success and error to files
 */
function logToFile(logType, clientId, clientName, message, details = {}) {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: logType,
      clientId,
      clientName,
      message,
      details
    };
    
    const logFile = logType === 'SUCCESS' || logType === 'EMAIL_SENT' 
      ? SCHEDULER_CONFIG.SUCCESS_LOG_FILE 
      : SCHEDULER_CONFIG.ERROR_LOG_FILE;
    
    const shouldLog = logType === 'SUCCESS' || logType === 'EMAIL_SENT' 
      ? SCHEDULER_CONFIG.LOG_ERRORS_TO_FILE 
      : SCHEDULER_CONFIG.LOG_ERRORS_TO_FILE;
    
    if (shouldLog) {
      fs.appendFileSync(
        path.join(__dirname, '..', '..', logFile),
        JSON.stringify(logEntry) + '\n',
        { encoding: 'utf8' }
      );
    }
  } catch (logError) {
    console.error('[SCHEDULER] Failed to write log:', logError.message);
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
    if (!pdfService || (!pdfService.generateDashboardPDF && !pdfService.default?.generateDashboardPDF)) {
      throw new Error('PDF generation function not found');
    }

    // Determine which function to call
    const pdfFunc = typeof pdfService.generateDashboardPDF === 'function'
      ? pdfService.generateDashboardPDF
      : pdfService.default.generateDashboardPDF;

    // Adjust timeout dynamically based on number of days or expected data volume
    const days = pdfData.startDate && pdfData.endDate
      ? Math.max(1, Math.ceil(
          (new Date(pdfData.endDate) - new Date(pdfData.startDate)) / (1000 * 60 * 60 * 24)
        ))
      : 1;

    const dynamicTimeout = Math.max(SCHEDULER_CONFIG.PDF_GENERATION_TIMEOUT, days * 10000); 
    // 10 seconds per day minimum

    console.log(`[PDF] 🕒 Generating PDF with timeout ${dynamicTimeout}ms for ${days} day(s)`);

    const pdfBuffer = await withTimeout(
      pdfFunc(pdfData),
      dynamicTimeout,
      'PDF generation'
    );

    if (!pdfBuffer || !(pdfBuffer instanceof Buffer) || pdfBuffer.length === 0) {
      throw new Error('PDF generation returned empty or invalid buffer');
    }

    console.log(`[PDF] ✅ PDF generated successfully (${Math.round(pdfBuffer.length / 1024)} KB)`);

    return pdfBuffer;
  } catch (error) {
    console.error(`[PDF] ❌ PDF generation error: ${error.message}`);
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
 * ✅ OPTIMIZED: Get schedules with 10-minute grace period
 */
async function getDueSchedules() {
  try {
    const pool = await poolPromise;
    const now = dayjs().tz(TZ);
    
    // Only process schedules from the last 10 minutes (reduced from 24 hours)
    const gracePeriodStart = now.subtract(SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES, 'minute');
    
    console.log(`[SCHEDULER] ⏱️ Checking schedules due by ${now.format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`[SCHEDULER] 🔍 Grace period: ${SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES} minutes (since ${gracePeriodStart.format('HH:mm:ss')})`);

    const result = await pool.request()
      .input('currentTime', sql.DateTime, now.format('YYYY-MM-DD HH:mm:ss'))
      .input('gracePeriodStart', sql.DateTime, gracePeriodStart.format('YYYY-MM-DD HH:mm:ss'))
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
          AND R.rep_tproximoenvio >= @gracePeriodStart
          AND R.rep_nfrecuencia IN (1, 2, 3)
        ORDER BY R.rep_tproximoenvio ASC
      `);

    const validSchedules = (result.recordset || []).filter(schedule => {
      if (!schedule.ClientID) {
        console.warn(`[SCHEDULER] ⚠️ Skipping schedule ${schedule.ScheduleID}: Missing ClientID`);
        return false;
      }
      
      const email = schedule.ReportEmail || schedule.ClientEmail;
      if (!email || email.includes('{') || email.includes('patrolsPerDay')) {
        console.warn(`[SCHEDULER] ⚠️ Skipping ${schedule.ClientName}: Invalid email`);
        return false;
      }
      
      return true;
    });

    console.log(`[SCHEDULER] 📋 Found ${validSchedules.length} due schedules (${result.recordset.length - validSchedules.length} skipped)`);
    
    if (validSchedules.length > 0) {
      console.log(`[SCHEDULER] 📊 Due schedules:`);
      validSchedules.slice(0, 5).forEach(schedule => {
        const freqMap = {1: 'Daily', 2: 'Weekly', 3: 'Monthly'};
        const dueTime = dayjs(schedule.NextRun).tz(TZ);
        const minutesLate = Math.floor(now.diff(dueTime, 'minute'));
        console.log(`  - ${schedule.ClientName} (${freqMap[schedule.Frequency] || 'Unknown'}): ${dueTime.format('HH:mm:ss')} (${minutesLate}m late)`);
      });
      if (validSchedules.length > 5) {
        console.log(`  ... and ${validSchedules.length - 5} more`);
      }
    }
    
    return validSchedules;
  } catch (error) {
    console.error('[SCHEDULER] ❌ Error fetching schedules:', error.message);
    logToFile('FETCH_SCHEDULES_ERROR', null, null, error.message);
    return [];
  }
}

/**
 * ✅ Get date range based on frequency
 */
function getDateRangeForFrequency(frequency, intervalDays = 1, runTime = null) {
  const runDate = runTime ? dayjs(runTime).tz(TZ) : dayjs().tz(TZ);
  
  switch (frequency) {
    case 1: // Daily - Previous FULL day (start to end)
      const previousDay = runDate.subtract(1, 'day');
      
      return {
        startDate: previousDay.format('YYYY-MM-DD'),
        endDate: previousDay.format('YYYY-MM-DD'),
        rangeLabel: `Daily Report: ${previousDay.format('MMM D, YYYY')}`,
        frequency: 'daily',
        reportDate: previousDay.format('YYYY-MM-DD')
      };
      
    case 2: // Weekly - Last 7 days up to TODAY
  const weeklyEnd = runDate.endOf('day');           // TODAY
  const weeklyStart = weeklyEnd.subtract(6, 'day'); // TODAY - 7 days

  return {
    startDate: weeklyStart.format('YYYY-MM-DD'),
    endDate: weeklyEnd.format('YYYY-MM-DD'),
    rangeLabel: `Weekly Report: ${weeklyStart.format('MMM D')} - ${weeklyEnd.format('MMM D, YYYY')}`,
    frequency: 'weekly',
    reportDate: weeklyEnd.format('YYYY-MM-DD')
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
 * ✅ Update next run time
 */
async function updateNextRunTime(schedule) {
  try {
    const pool = await poolPromise;
    
    const lastScheduledRun = dayjs(schedule.NextRun).tz(TZ);
    let newNextRun = lastScheduledRun;
    
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
    
    const now = dayjs().tz(TZ);
    
    // Ensure next run is at least 5 minutes in the future to avoid immediate re-processing
    const minimumFutureTime = now.add(5, 'minute');
    if (newNextRun.isBefore(minimumFutureTime)) {
      switch (schedule.Frequency) {
        case 1: newNextRun = minimumFutureTime.add(schedule.IntervalDays || 1, "day").startOf('day'); break;
        case 2: newNextRun = minimumFutureTime.add(schedule.IntervalDays || 1, "week"); break;
        case 3: newNextRun = minimumFutureTime.add(schedule.IntervalDays || 1, "month").startOf('day'); break;
        default: newNextRun = minimumFutureTime.add(1, "day").startOf('day');
      }
    }
    
    const originalTime = lastScheduledRun.format('YYYY-MM-DD HH:mm:ss');
    const newTime = newNextRun.format('YYYY-MM-DD HH:mm:ss');
    
    console.log(`[SCHEDULER] 🔄 Updating schedule ${schedule.ScheduleID}: ${originalTime} → ${newTime}`);
    
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
    console.error(`[SCHEDULER] ❌ Failed to update schedule: ${error.message}`);
    throw error;
  }
}

/**
 * ✅ OPTIMIZED: Process single schedule with faster execution
 */
async function processSchedule(schedule, customDateRange = null) {
  const { ClientID, ClientName, ReportEmail, ClientEmail, Frequency, IntervalDays, NextRun } = schedule;
  const startTime = Date.now();
  
  try {
    const freqMap = {1: 'Daily', 2: 'Weekly', 3: 'Monthly'};
    const frequencyLabel = freqMap[Frequency] || `Unknown (${Frequency})`;
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[SCHEDULER] 🚀 PROCESSING: ${ClientName} (ID: ${ClientID})`);
    console.log(`${'='.repeat(70)}`);
    console.log(`[SCHEDULER] 📊 Frequency: ${frequencyLabel}`);
    console.log(`[SCHEDULER] ⏰ Scheduled time: ${dayjs(NextRun).tz(TZ).format('YYYY-MM-DD HH:mm:ss')}`);
    
    // Quick validation
    if (!ClientID) {
      console.warn(`[SCHEDULER] ⚠️ Skipping: Missing ClientID`);
      return { success: false, skipped: true, reason: 'Missing ClientID' };
    }
    
    let finalEmail = ReportEmail || ClientEmail;
    if (finalEmail && (finalEmail.includes('{') || finalEmail.includes('patrolsPerDay'))) {
      finalEmail = ClientEmail;
    }
    
    if (!finalEmail) {
      console.warn(`[SCHEDULER] ⚠️ Skipping ${ClientName}: No valid email`);
      return { success: false, skipped: true, reason: 'No email address' };
    }

    // Get date range
    const dateRange = customDateRange || getDateRangeForFrequency(Frequency, IntervalDays, NextRun);
    const isManualTest = customDateRange !== null;

    console.log(`[SCHEDULER] 📧 Email: ${finalEmail}`);
    console.log(`[SCHEDULER] 📅 Date Range: ${dateRange.startDate} to ${dateRange.endDate}`);

    // Generate PDF with timeout
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
      const pdfTime = Date.now() - startTime;
      console.log(`[SCHEDULER] ✅ PDF generated: ${sizeKB} KB in ${pdfTime}ms`);
    } catch (pdfError) {
      console.error(`[SCHEDULER] ❌ PDF generation failed: ${pdfError.message}`);
      logToFile('PDF_GENERATION_ERROR', ClientID, ClientName, pdfError.message, { dateRange });
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
      reportDate: dateRange.reportDate,
      client: {
        ClientID: ClientID,
        ClientName: ClientName
      },
      dateRange: dateRange
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
      console.log(`[SCHEDULER] ✅ ✅ ✅ EMAIL SENT SUCCESSFULLY! ✅ ✅ ✅`);
      console.log(`[SCHEDULER]    - Recipient: ${finalEmail}`);
      console.log(`[SCHEDULER]    - Frequency: ${frequencyLabel}`);
      console.log(`[SCHEDULER]    - Total Time: ${totalTime}ms`);
      console.log(`${'='.repeat(70)}\n`);
      
      logToFile('EMAIL_SENT', ClientID, ClientName, 'Report sent successfully', {
        email: finalEmail,
        frequency: frequencyLabel,
        dateRange: `${dateRange.startDate} to ${dateRange.endDate}`,
        totalTime: totalTime
      });
      
      return { 
        success: true, 
        email: finalEmail,
        frequency: frequencyLabel,
        processingTime: totalTime,
        isManualTest
      };
      
    } catch (emailError) {
      console.error(`[SCHEDULER] ❌ Email failed: ${emailError.message}`);
      logToFile('EMAIL_SEND_ERROR', ClientID, ClientName, emailError.message, { to: finalEmail });
      return { success: false, error: 'Email sending failed', details: emailError.message };
    }

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[SCHEDULER] ❌ Failed after ${totalTime}ms: ${error.message}`);
    logToFile('PROCESS_SCHEDULE_ERROR', ClientID, ClientName, error.message);
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
    errors: [],
    successDetails: []
  };

  const batchSize = SCHEDULER_CONFIG.MAX_CONCURRENT_PDFS;
  
  for (let i = 0; i < schedules.length; i += batchSize) {
    const batch = schedules.slice(i, i + batchSize);
    console.log(`\n[SCHEDULER] 📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(schedules.length / batchSize)}`);
    
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
          results.errors.push({ 
            client: schedule.ClientName, 
            clientId: schedule.ClientID,
            error: error.message 
          });
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
          
          // Store success details
          results.successDetails.push({
            client: schedule.ClientName,
            clientId: schedule.ClientID,
            email: result.email,
            frequency: result.frequency,
            time: result.processingTime
          });
          
          // Update schedule if successful and not in test mode
          if (!result.emailSkipped && !skipScheduleUpdate && !result.isManualTest) {
            try {
              await updateNextRunTime(schedule);
            } catch (updateError) {
              console.warn(`[SCHEDULER] ⚠️ Failed to update schedule: ${updateError.message}`);
            }
          }
        } else {
          results.failed++;
          results.errors.push({ 
            client: schedule.ClientName, 
            clientId: schedule.ClientID,
            error: result.error || 'Unknown error',
            details: result.details
          });
        }
      } else {
        // Promise rejected
        results.failed++;
        results.errors.push({ 
          client: 'Unknown', 
          error: settledResult.reason?.message || 'Unknown error' 
        });
      }
    }
    
    // Delay between batches (reduced from 1000ms to 500ms)
    if (i + batchSize < schedules.length) {
      await delay(SCHEDULER_CONFIG.DELAY_BETWEEN_CLIENTS);
    }
  }
  
  return results;
}

/**
 * ✅ MAIN SCHEDULER - CHECKING EVERY 60 SECONDS
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
  console.log("⏰ OPTIMIZED SCHEDULER TRIGGERED");
  console.log(`✅ Current time: ${now.format('YYYY-MM-DD HH:mm:ss')}`);
  console.log("✅ Checks EVERY 60 SECONDS (1 minute)");
  console.log("=".repeat(70));

  const startTime = Date.now();

  try {
    const dueSchedules = await getDueSchedules();

    if (dueSchedules.length === 0) {
      console.log("✅ No due schedules found at this time.");
      return { success: true, message: "No due schedules" };
    }

    console.log(`\n📨 Processing ${dueSchedules.length} due schedule(s)...`);
    
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

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    
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
    
    // Log successful sends
    if (results.successDetails.length > 0) {
      console.log(`\n   ✅ Successfully Sent Reports:`);
      results.successDetails.forEach(detail => {
        console.log(`      - ${detail.client} (ID: ${detail.clientId})`);
        console.log(`        Email: ${detail.email}`);
        console.log(`        Frequency: ${detail.frequency}`);
        console.log(`        Time: ${detail.time}ms`);
      });
    }
    
    if (results.errors.length > 0) {
      console.log(`\n   ⚠️  Failed Reports:`);
      results.errors.slice(0, 3).forEach(err => {
        console.log(`      - ${err.client} (ID: ${err.clientId || 'N/A'})`);
        console.log(`        Error: ${err.error}`);
      });
      if (results.errors.length > 3) {
        console.log(`      ... and ${results.errors.length - 3} more errors`);
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
    logToFile('SCHEDULER_RUNTIME_ERROR', null, null, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Warm up API cache at startup (optional optimization)
 */
async function warmAPICache() {
  try {
    console.log('[SCHEDULER] 🔥 Warming API cache...');
    const today = dayjs().tz(TZ);
    const todayStart = today.startOf('day').format('YYYY-MM-DD');
    const todayEnd = today.endOf('day').format('YYYY-MM-DD');
    
    // Warm cache for common clients (optional - can be configured)
    const commonClients = [48, 49, 50]; // Add your common client IDs
    
    for (const clientId of commonClients) {
      try {
        // This would trigger cache warming if your API supports it
        console.log(`[SCHEDULER]   Warming client ${clientId}...`);
        // If you have a cache warming function, call it here
      } catch (err) {
        console.log(`[SCHEDULER]   Cache warm for client ${clientId} failed: ${err.message}`);
      }
    }
  } catch (error) {
    console.error('[SCHEDULER] Cache warm failed:', error.message);
  }
}

// Export all manual triggers and utilities
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
      FrequencyName: schedule.Frequency === 1 ? 'Daily' : schedule.Frequency === 2 ? 'Weekly' : 'Monthly',
      MinutesUntil: Math.floor(dayjs(schedule.NextRun).diff(now, 'minute'))
    }));
  } catch (error) {
    console.error('[SCHEDULER] Error fetching upcoming schedules:', error.message);
    return [];
  }
}

// Initialize with optimizations
console.log("\n" + "🚀".repeat(35));
console.log("🚀 OPTIMIZED SCHEDULER INITIALIZED");
console.log("🚀".repeat(35));
console.log("📊 Configuration:");
console.log(`   - Check Interval: Every 60 seconds (1 minute)`);
console.log(`   - Timezone: ${TZ}`);
console.log(`   - Test Mode: ${TEST_MODE}`);
console.log(`   - Email: ${EMAIL_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}`);
console.log(`   - Max Concurrent: ${SCHEDULER_CONFIG.MAX_CONCURRENT_PDFS}`);
console.log(`   - Grace Period: ${SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES} minutes`);
console.log(`   - Current Time: ${dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')}`);
console.log("🚀".repeat(35) + "\n");

// Start cron job with 60-second checks
if (!TEST_MODE) {
  cron.schedule(SCHEDULER_CONFIG.SCHEDULER_CHECK_INTERVAL, () => {
    const triggerTime = dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss');
    console.log(`\n⏰ SCHEDULER CHECK TRIGGERED: ${triggerTime}`);
    runDynamicReportScheduler();
  });
  console.log(`✅ Scheduler active: Checking every 60 seconds for due schedules`);
} else {
  console.log("🛑 TEST MODE: Scheduler disabled");
}

// Optional: Warm cache 5 seconds after startup
setTimeout(() => {
  if (process.env.WARM_CACHE_AT_STARTUP === 'true') {
    warmAPICache();
  }
}, 5000);

// Manual trigger exports
export async function triggerDynamicReportsNow() {
  console.log("[SCHEDULER] 🔧 Manual trigger...");
  return await runDynamicReportScheduler();
}

export default {
  runDynamicReportScheduler,
  triggerDynamicReportsNow,
  getUpcomingSchedules,
  setEmailEnabled: (enabled) => {
    global.EMAIL_SENDING_ENABLED = enabled;
    console.log(`[SCHEDULER] Email sending ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }
};