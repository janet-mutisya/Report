// server/service/scheduler.js - FIXED WITH CORRECT DATE RANGES
import cron from "node-cron";
import dotenv from "dotenv";
import dayjs from "dayjs";
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { sql, poolPromise } from "../config/database.js";
import * as pdfService from './pdfService.js';
import * as emailService from './emailService.js';

dotenv.config();
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || "Africa/Nairobi";
const TEST_MODE = process.env.TEST_MODE === "true";

const SCHEDULER_CONFIG = {
  PAST_PATROL_DAYS: parseInt(process.env.PAST_PATROL_DAYS) || 7, // Changed to 7 days for weekly reports
  DYNAMIC_REPORT_INTERVAL: process.env.DYNAMIC_REPORT_INTERVAL || "*/2 * * * *",
  EMAIL_SUBJECT_PREFIX: process.env.EMAIL_SUBJECT_PREFIX || "Security Patrol Report",
  DELAY_BETWEEN_CLIENTS: parseInt(process.env.DELAY_BETWEEN_CLIENTS) || 3000,
};

/**
 * 🔧 Utility: Delay execution
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 🔧 PDF GENERATION HELPER - FIXED WITH CORRECT FUNCTION NAMES
 */
async function generatePDF(pdfData) {
  try {
    console.log('   🔍 Detecting PDF service export pattern...');
    
    let pdfBuffer = null;
    
    if (typeof pdfService.generateDashboardPDF === 'function') {
      console.log('   ✅ Using: pdfService.generateDashboardPDF');
      pdfBuffer = await pdfService.generateDashboardPDF(pdfData);
    }
    else if (typeof pdfService.generatePDFReport === 'function') {
      console.log('   ✅ Using: pdfService.generatePDFReport');
      pdfBuffer = await pdfService.generatePDFReport(pdfData);
    }
    else if (pdfService.default && typeof pdfService.default.generateDashboardPDF === 'function') {
      console.log('   ✅ Using: pdfService.default.generateDashboardPDF');
      pdfBuffer = await pdfService.default.generateDashboardPDF(pdfData);
    }
    else if (typeof pdfService.default === 'function') {
      console.log('   ✅ Using: pdfService.default');
      pdfBuffer = await pdfService.default(pdfData);
    }
    else {
      console.error('   ❌ No compatible PDF generation function found');
      console.error('   Available exports:', Object.keys(pdfService));
      throw new Error('PDF generation function not found in pdfService');
    }
    
    if (!pdfBuffer) {
      throw new Error('PDF generation returned null or undefined');
    }
    
    console.log(`   ✅ PDF generated: ${Math.round(pdfBuffer.length / 1024)} KB`);
    return pdfBuffer;
    
  } catch (error) {
    console.error('   ❌ PDF generation error:', error.message);
    throw error;
  }
}

/**
 * 🔧 EMAIL SENDING HELPER - FIXED WITH CORRECT FUNCTION NAMES
 */
async function sendPatrolEmail(emailData) {
  try {
    console.log('   🔍 Detecting email service export pattern...');
    
    if (typeof emailService.sendPatrolReport === 'function') {
      console.log('   ✅ Using: emailService.sendPatrolReport');
      return await emailService.sendPatrolReport(emailData);
    }
    else if (emailService.default && typeof emailService.default.sendPatrolReport === 'function') {
      console.log('   ✅ Using: emailService.default.sendPatrolReport');
      return await emailService.default.sendPatrolReport(emailData);
    }
    else {
      console.error('   ❌ No compatible email function found');
      console.error('   Available exports:', Object.keys(emailService));
      throw new Error('Email send function not found in emailService');
    }
  } catch (error) {
    console.error('   ❌ Email sending error:', error.message);
    throw error;
  }
}

/**
 * 🔧 Get due schedules
 */
async function getDueSchedules() {
  try {
    const pool = await poolPromise;
    const now = dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss');
    
    console.log(`🕒 Checking due schedules at: ${now} (${TZ})`);

    const result = await pool.request()
      .input('currentTime', sql.DateTime, now)
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
          R.rep_cmail IS NOT NULL
          AND R.rep_cmail != ''
          AND R.rep_tproximoenvio IS NOT NULL
          AND R.rep_tproximoenvio <= @currentTime
        ORDER BY R.rep_tproximoenvio ASC
      `);

    const dueSchedules = result.recordset || [];
    console.log(`📋 Found ${dueSchedules.length} due schedule(s)`);
    
    dueSchedules.forEach(schedule => {
      const dueTime = dayjs(schedule.NextRun).tz(TZ).format('YYYY-MM-DD HH:mm:ss');
      console.log(`   - ${schedule.ClientName}: due since ${dueTime}`);
    });

    return dueSchedules;
  } catch (error) {
    console.error('❌ Error fetching due schedules:', error.message);
    return [];
  }
}

/**
 * 🔧 Get client data
 */
async function getClientData(clientId) {
  try {
    const pool = await poolPromise;
    
    const result = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          cue_iid AS ClientID,
          cue_cnombre AS ClientName,
          cue_cemail AS ClientEmail
        FROM [_Datos].[dbo].[m_cuentas]
        WHERE cue_iid = @clientId
      `);

    return result.recordset[0] || null;
  } catch (error) {
    console.error(`❌ Error fetching client data:`, error.message);
    return null;
  }
}

/**
 * 🔧 Get client patrols - FIXED WITH CURRENT DATES
 */
async function getClientPatrols(clientId, dateRange) {
  try {
    const pool = await poolPromise;
    
    console.log(`   📊 Fetching patrols for client ${clientId} from ${dateRange.startDate} to ${dateRange.endDate}`);

    // Try multiple table patterns to find patrol data
    const tablePatterns = [
      `p_recepcion${dayjs().format('YYYYMM')}`, // Current month
      `p_recepcion${dayjs().subtract(1, 'month').format('YYYYMM')}`, // Previous month
      'p_recepcion' // Generic table
    ];

    let patrols = [];
    let lastError = null;

    for (const tableName of tablePatterns) {
      try {
        console.log(`   🔍 Trying table: ${tableName}`);
        
        const result = await pool.request()
          .input('clientId', sql.Int, clientId)
          .input('startDate', sql.DateTime, dateRange.sqlStartDate)
          .input('endDate', sql.DateTime, dateRange.sqlEndDate)
          .query(`
            SELECT 
              rec_iid AS PatrolID,
              rec_tfechahora AS PatrolDate,
              rec_czona AS ZoneCode,
              rec_calarma AS AlarmType,
              rec_cContenido AS Content
            FROM [_Datos].[dbo].[${tableName}]
            WHERE rec_iidcuenta = @clientId
              AND rec_tfechahora BETWEEN @startDate AND @endDate
            ORDER BY rec_tfechahora DESC
          `);

        if (result.recordset.length > 0) {
          patrols = result.recordset;
          console.log(`   ✅ Found ${patrols.length} patrols in table ${tableName}`);
          break;
        }
      } catch (error) {
        lastError = error;
        console.log(`   ⚠️ Table ${tableName} not accessible: ${error.message}`);
        continue;
      }
    }

    if (patrols.length === 0 && lastError) {
      console.log(`   ⚠️ No patrols found in any table for client ${clientId}`);
    }

    return {
      pastPatrols: patrols,
      upcomingPatrols: [],
      summary: {
        totalPatrols: patrols.length,
        completedPatrols: patrols.filter(p => p.AlarmType?.includes('V04') || p.AlarmType?.includes('V08')).length,
        expectedPatrols: dateRange.daysInRange * 11, // Default 11 patrols per day
        complianceRate: patrols.length > 0 ? `${Math.round((patrols.length / (dateRange.daysInRange * 11)) * 100)}%` : '0%'
      }
    };

  } catch (error) {
    console.error(`   ❌ Error fetching patrols:`, error.message);
    return {
      pastPatrols: [],
      upcomingPatrols: [],
      summary: { totalPatrols: 0, completedPatrols: 0, expectedPatrols: 0, complianceRate: '0%' }
    };
  }
}

/**
 * 📅 Get previous week range - FIXED WITH CURRENT DATES
 */
function getPreviousWeekRange() {
  const currentDate = dayjs().tz(TZ);
  const startOfLastWeek = currentDate.subtract(1, 'week').startOf('isoWeek');
  const endOfLastWeek = currentDate.subtract(1, 'week').endOf('isoWeek');
  
  return {
    startDate: startOfLastWeek.format('YYYY-MM-DD'),
    endDate: endOfLastWeek.format('YYYY-MM-DD'),
    sqlStartDate: startOfLastWeek.format('YYYY-MM-DD 00:00:00'),
    sqlEndDate: endOfLastWeek.format('YYYY-MM-DD 23:59:59'),
    rangeLabel: `Week of ${startOfLastWeek.format('MMM D')} - ${endOfLastWeek.format('MMM D, YYYY')}`,
    daysInRange: 7
  };
}

/**
 * 📅 Get current week range - FOR TESTING
 */
function getCurrentWeekRange() {
  const currentDate = dayjs().tz(TZ);
  const startOfWeek = currentDate.startOf('isoWeek');
  const endOfWeek = currentDate.endOf('isoWeek');
  
  return {
    startDate: startOfWeek.format('YYYY-MM-DD'),
    endDate: endOfWeek.format('YYYY-MM-DD'),
    sqlStartDate: startOfWeek.format('YYYY-MM-DD 00:00:00'),
    sqlEndDate: endOfWeek.format('YYYY-MM-DD 23:59:59'),
    rangeLabel: `Week of ${startOfWeek.format('MMM D')} - ${endOfWeek.format('MMM D, YYYY')}`,
    daysInRange: Math.min(7, currentDate.diff(startOfWeek, 'day') + 1)
  };
}

/**
 * 📅 Get last 7 days range - ALTERNATIVE OPTION
 */
function getLast7DaysRange() {
  const currentDate = dayjs().tz(TZ);
  const startDate = currentDate.subtract(7, 'days').format('YYYY-MM-DD');
  const endDate = currentDate.subtract(1, 'day').format('YYYY-MM-DD'); // Exclude today
  
  return {
    startDate: startDate,
    endDate: endDate,
    sqlStartDate: `${startDate} 00:00:00`,
    sqlEndDate: `${endDate} 23:59:59`,
    rangeLabel: `Last 7 Days: ${startDate} to ${endDate}`,
    daysInRange: 7
  };
}

/**
 * 🔄 Transform patrols to posts
 */
function transformPatrolsToPosts(patrolData, schedule, dateRange) {
  try {
    const patrols = patrolData.patrols || patrolData.pastPatrols || [];
    if (patrols.length === 0) {
      console.log('   ⚠️ No patrols found for post transformation');
      return [];
    }

    console.log(`   🔄 Transforming ${patrols.length} patrols to posts...`);

    const postsMap = new Map();
    
    patrols.forEach(patrol => {
      const zoneKey = patrol.rec_czona || patrol.ZoneCode || 'Unknown';
      const zoneName = `Zone ${zoneKey}`;
      
      if (!postsMap.has(zoneKey)) {
        postsMap.set(zoneKey, {
          SitePost: zoneName,
          ChecksCompleted: 0,
          ExpectedChecks: 0,
          PerformanceRate: '0%'
        });
      }
      postsMap.get(zoneKey).ChecksCompleted++;
    });

    const daysInPeriod = dateRange.daysInRange || 7;
    const patrolsPerDay = schedule?.patrols_per_day || 11;
    const totalExpected = daysInPeriod * patrolsPerDay;
    const expectedPerPost = postsMap.size > 0 ? Math.ceil(totalExpected / postsMap.size) : totalExpected;

    postsMap.forEach(post => {
      post.ExpectedChecks = expectedPerPost;
      const performance = expectedPerPost > 0 ? ((post.ChecksCompleted / expectedPerPost) * 100).toFixed(1) : 0;
      post.PerformanceRate = `${performance}%`;
    });

    const posts = Array.from(postsMap.values());
    console.log(`   ✅ Transformed ${posts.length} posts`);
    return posts;
  } catch (error) {
    console.error('   ❌ Error transforming patrols to posts:', error);
    return [];
  }
}

/**
 * 🔄 Transform patrols to events
 */
function transformPatrolsToEvents(patrolData) {
  try {
    const patrols = patrolData.patrols || patrolData.pastPatrols || [];
    
    console.log(`   🔄 Transforming ${patrols.length} patrols to events...`);
    
    const events = patrols.map((patrol) => {
      return {
        rec_tfechahora: patrol.rec_tfechahora || patrol.PatrolDate,
        rec_czona: patrol.rec_czona || patrol.ZoneCode || 'Unknown',
        rec_calarma: patrol.rec_calarma || patrol.AlarmType,
        rec_cContenido: patrol.rec_cContenido || patrol.Content || 'Patrol Check'
      };
    });

    console.log(`   ✅ Transformed ${events.length} events`);
    return events;
  } catch (error) {
    console.error('   ❌ Error transforming patrols to events:', error);
    return [];
  }
}

/**
 * 🔧 Update next run time
 */
async function updateNextRunTime(schedule) {
  try {
    const pool = await poolPromise;
    const { ScheduleID, ClientName, Frequency, IntervalDays } = schedule;
    
    let newNextRun = dayjs().tz(TZ);
    
    switch (Frequency) {
      case 1:
        newNextRun = newNextRun.add(IntervalDays || 1, "day");
        break;
      case 2:
        newNextRun = newNextRun.add(IntervalDays || 1, "week");
        break;
      case 3:
        newNextRun = newNextRun.add(IntervalDays || 1, "month");
        break;
      default:
        newNextRun = newNextRun.add(1, "day");
    }
    
    const newNextRunFormatted = newNextRun.format('YYYY-MM-DD HH:mm:ss');
    
    await pool.request()
      .input('ScheduleID', sql.Int, ScheduleID)
      .input('NextRun', sql.DateTime, newNextRunFormatted)
      .query(`
        UPDATE [_Datos].[dbo].[m_reportes_automaticos]
        SET rep_tproximoenvio = @NextRun
        WHERE rep_idKey = @ScheduleID
      `);

    console.log(`   📅 Next run scheduled: ${newNextRunFormatted} for ${ClientName}`);
    return newNextRunFormatted;
  } catch (error) {
    console.error(`   ❌ Error updating next run time:`, error.message);
    throw error;
  }
}

/**
 * 🔧 Process individual schedule - FIXED WITH CORRECT DATE RANGES
 */
async function processSchedule(schedule) {
  const { ClientID, ClientName, ReportEmail, ClientEmail } = schedule;
  
  try {
    console.log(`\n📤 Processing: ${ClientName} (ID: ${ClientID})`);
    
    // Use current dates instead of future dates
    const dateRange = getPreviousWeekRange(); // Changed from fixed 2025 dates
    
    // Fix email field - some clients have JSON in email field
    let finalEmail = ReportEmail || ClientEmail;
    if (finalEmail && finalEmail.includes('{') && finalEmail.includes('patrolsPerDay')) {
      console.log('   ⚠️ Email field contains schedule data, using ClientEmail instead');
      finalEmail = ClientEmail;
    }
    
    if (!finalEmail) {
      console.warn(`   ⚠️ No valid email address found for ${ClientName}`);
      return { success: false, error: 'No email address' };
    }

    console.log(`   📧 Email: ${finalEmail}`);
    console.log(`   📅 Date range: ${dateRange.startDate} to ${dateRange.endDate}`);

    const client = await getClientData(ClientID);
    if (!client) {
      console.warn(`   ⚠️ Client data not found for ${ClientName}`);
      return { success: false, error: 'Client not found' };
    }

    // Get patrols for the actual date range
    const patrolData = await getClientPatrols(ClientID, dateRange);
    
    const hasData = patrolData.pastPatrols && patrolData.pastPatrols.length > 0;
    
    if (!hasData) {
      console.warn(`   ⚠️ No patrol data found for ${ClientName} in date range ${dateRange.startDate} to ${dateRange.endDate}`);
      console.log(`   💡 Try checking if patrol data exists in the database for this period`);
      return { success: false, error: 'No patrol data' };
    }

    console.log(`   📊 Found ${patrolData.pastPatrols.length} patrols`);

    // Create PDF data in the format expected by generateDashboardPDF
    const pdfData = {
      clientId: ClientID,
      clientName: ClientName,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate
    };

    console.log('   🎨 Generating PDF...');
    const pdfBuffer = await generatePDF(pdfData);

    if (!pdfBuffer) {
      console.warn(`   ⚠️ PDF generation failed for ${ClientName}`);
      return { success: false, error: 'PDF generation failed' };
    }

    if (TEST_MODE) {
      console.log(`   🚫 [TEST MODE] Would have sent report to ${finalEmail}`);
      console.log(`   📊 Patrol data: ${patrolData.pastPatrols.length} patrols found`);
      return { success: true, testMode: true, email: finalEmail, patrols: patrolData.pastPatrols.length };
    }

    console.log('   📧 Sending email with BM Security branding...');
    
    // Prepare email data
    const emailData = {
      to: finalEmail,
      client: {
        ClientID: ClientID,
        ClientName: ClientName
      },
      dateRange: dateRange,
      pdfBuffer: pdfBuffer,
      pdfFilename: `BM_Security_Report_${ClientName.replace(/\s+/g, '_')}_${dateRange.startDate}_to_${dateRange.endDate}.pdf`
    };

    await sendPatrolEmail(emailData);

    console.log(`   ✅ Report successfully sent to ${finalEmail}`);
    return { success: true, email: finalEmail, patrols: patrolData.pastPatrols.length };

  } catch (error) {
    console.error(`   ❌ Error processing ${ClientName}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 🕒 Main Dynamic Scheduler
 */
export async function runDynamicReportScheduler() {
  console.log("\n" + "=".repeat(60));
  console.log("⏰ DYNAMIC SCHEDULER STARTED - Checking for due reports...");
  console.log("=".repeat(60));

  const startTime = dayjs().tz(TZ);
  let processedCount = 0;
  let successCount = 0;
  let errorCount = 0;

  try {
    const dueSchedules = await getDueSchedules();

    if (dueSchedules.length === 0) {
      console.log("✅ No due schedules found at this time.");
      return;
    }

    console.log(`\n📨 Processing ${dueSchedules.length} due schedule(s)...`);

    for (const schedule of dueSchedules) {
      processedCount++;
      
      try {
        const result = await processSchedule(schedule);
        
        if (result.success) {
          successCount++;
          
          if (!result.testMode) {
            await updateNextRunTime(schedule);
          } else {
            console.log(`   📅 [TEST] Would update next run time for ${schedule.ClientName}`);
          }
        } else {
          errorCount++;
          console.log(`   ❌ Failed: ${result.error}`);
        }

        if (processedCount < dueSchedules.length) {
          await delay(SCHEDULER_CONFIG.DELAY_BETWEEN_CLIENTS);
        }

      } catch (error) {
        errorCount++;
        console.error(`   💥 Unexpected error processing ${schedule.ClientName}:`, error.message);
      }
    }

  } catch (error) {
    console.error("❌ Scheduler runtime error:", error.message);
    errorCount = dueSchedules?.length || 1;
  }

  const endTime = dayjs().tz(TZ);
  const duration = endTime.diff(startTime, 'second');
  
  console.log("\n" + "=".repeat(60));
  console.log("📊 SCHEDULER RUN COMPLETED");
  console.log("=".repeat(60));
  console.log(`   ⏰ Duration: ${duration} seconds`);
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log(`   📋 Total Processed: ${processedCount}`);
  console.log(`   🕒 Next check: ${SCHEDULER_CONFIG.DYNAMIC_REPORT_INTERVAL}`);
  console.log("=".repeat(60) + "\n");
}

// 🚀 START SCHEDULERS
console.log("\n" + "⭐".repeat(70));
console.log("🚀 SECURITY REPORTING SCHEDULER SYSTEM INITIALIZED");
console.log("⭐".repeat(70));
console.log("📊 Configuration:");
console.log(`   - Dynamic Reports: ${SCHEDULER_CONFIG.DYNAMIC_REPORT_INTERVAL}`);
console.log(`   - Timezone: ${TZ}`);
console.log(`   - Test Mode: ${TEST_MODE}`);
console.log(`   - Current Date: ${dayjs().tz(TZ).format('YYYY-MM-DD')}`);
console.log("⭐".repeat(70) + "\n");

// Start cron job
cron.schedule(SCHEDULER_CONFIG.DYNAMIC_REPORT_INTERVAL, runDynamicReportScheduler);

// Manual triggers with different date ranges for testing
export async function triggerDynamicReportsNow() {
  console.log("🔧 Manual trigger for dynamic reports...");
  await runDynamicReportScheduler();
}

export async function triggerTestWithCurrentWeek() {
  console.log("🔧 TEST: Running with current week data...");
  // Temporary override for testing
  global.testDateRange = getCurrentWeekRange();
  await runDynamicReportScheduler();
}

export async function triggerTestWithLast7Days() {
  console.log("🔧 TEST: Running with last 7 days data...");
  // Temporary override for testing
  global.testDateRange = getLast7DaysRange();
  await runDynamicReportScheduler();
}

export async function triggerPatrolReportsNow() {
  console.log("🔧 Manual trigger for patrol reports...");
  await runDynamicReportScheduler();
}

export async function triggerDebugStatus() {
  console.log("🔧 Manual trigger for debug status...");
  await debugSchedulerStatus();
}

export default {
  runDynamicReportScheduler,
  triggerDynamicReportsNow,
   triggerDebugStatus, 
    triggerPatrolReportsNow,
  triggerTestWithCurrentWeek,
  triggerTestWithLast7Days
};