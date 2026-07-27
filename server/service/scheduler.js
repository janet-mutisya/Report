// server/service/scheduler.js
// ============================================================
// FIXES APPLIED IN THIS REWRITE
// ============================================================
// ✅ FIX 1: SQL queries include frequency 4 (Monthly): IN (1, 2, 3, 4)
//
// ✅ FIX 2: updateNextRunTime — correct advance per frequency
//           1 (Daily)        → +1 day
//           2 (Weekly)       → +7 days
//           3 (Twice/week)   → +IntervalDays days (default 3)
//           4 (Monthly)      → +1 calendar month
//
// ✅ FIX 3: FREQUENCY_PERIOD_MAP correct periods
//           1 → yesterday    (1 night)
//           2 → previousWeek (7 nights, boundary-to-boundary)
//           3 → last3days    (3 nights inclusive)
//           4 → last30days   (30 nights inclusive)
//
// ✅ FIX 4: Inline fallbacks use exact inclusive rolling windows:
//           yesterday   → start=today-1,  end=today-1
//           last3days   → start=today-2,  end=today     (3 inclusive)
//           last7days   → start=today-6,  end=today     (7 inclusive)
//           last30days  → start=today-29, end=today     (30 inclusive)
//
// ✅ FIX 5: SCHEDULE:: prefix filter on ALL DB queries.
//
// ✅ FIX 6: processSchedule — pdfEndDate = dateRange.endDate
//           (no subtract(1,'day') — the date range functions already
//            return correct inclusive end dates)
//
// ✅ FIX 19: SHIFT TYPE SUPPORT (day / night / both)
//           - rep_shift_type is now selected alongside every schedule row
//           - getDateRangeForSchedule / all date-range calls forward the
//             schedule's shiftType so the SQL window matches Day vs Night
//           - PDF filename, email subject, and log lines surface the
//             shift so two schedules for the same client (Day + Night)
//             are never confused with each other
// ============================================================

const cron = require("node-cron");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');
const fs = require('fs');
const path = require('path');

// =============================================
// CONFIGURATION
// =============================================
const TZ = process.env.TIMEZONE || "Africa/Nairobi";
const TEST_MODE = process.env.TEST_MODE === "true";
const EMAIL_ENABLED = process.env.ENABLE_EMAIL_SENDING === 'true' || process.env.ENABLE_EMAIL_SENDING !== 'false';
const SAVE_PDF_TO_DISK = process.env.SAVE_PDF_TO_DISK === 'true';
const PDF_TEMP_DIR = path.join(__dirname, 'temp_pdfs');

const SCHEDULER_CONFIG = {
  SCHEDULER_CHECK_INTERVAL:        process.env.SCHEDULER_CHECK_INTERVAL || "* * * * *",
  EMAIL_SUBJECT_PREFIX:            process.env.EMAIL_SUBJECT_PREFIX || "Security Report",
  DELAY_BETWEEN_CLIENTS:           parseInt(process.env.DELAY_BETWEEN_CLIENTS) || 500,
  MAX_CONCURRENT_PDFS:             parseInt(process.env.MAX_CONCURRENT_PDFS) || 3,
  MAX_CONCURRENT_SCHEDULES:        parseInt(process.env.MAX_CONCURRENT_SCHEDULES) || 3,
  PDF_GENERATION_TIMEOUT:          parseInt(process.env.PDF_GENERATION_TIMEOUT) || 180000,
  EMAIL_SEND_TIMEOUT:              parseInt(process.env.EMAIL_SEND_TIMEOUT) || 120000,
  GRACE_PERIOD_MINUTES_PAST:       0,
  GRACE_PERIOD_MINUTES_FUTURE:     parseInt(process.env.GRACE_PERIOD_MINUTES_FUTURE) || 5,
  ENABLE_CATCHUP_MODE:             process.env.ENABLE_CATCHUP_MODE === 'true',
  CATCHUP_MAX_MINUTES_BACK:        parseInt(process.env.CATCHUP_MAX_MINUTES_BACK) || 240,
  CATCHUP_MAX_SCHEDULES_PER_RUN:   parseInt(process.env.CATCHUP_MAX_SCHEDULES_PER_RUN) || 20,
  LOG_ERRORS_TO_FILE:              process.env.LOG_ERRORS_TO_FILE === 'true',
  ERROR_LOG_FILE:                  process.env.ERROR_LOG_FILE || 'scheduler_errors.log',
  SUCCESS_LOG_FILE:                process.env.SUCCESS_LOG_FILE || 'scheduler_success.log',
  RETRY_ATTEMPTS:                  parseInt(process.env.EMAIL_RETRY_ATTEMPTS) || 2,
  RETRY_DELAY:                     parseInt(process.env.EMAIL_RETRY_DELAY) || 2000,
  CATCHUP_STARTUP_DELAY_MS:        parseInt(process.env.CATCHUP_STARTUP_DELAY_MS) || 90000,
  ENABLE_DRIVE_UPLOAD:             process.env.ENABLE_DRIVE_UPLOAD === 'true',
};

// Prefix used by managePatrolSchedules.js — rows with this value are
// patrol-schedule configs, NOT email addresses.
const SCHEDULE_PREFIX = 'SCHEDULE::';

// =============================================
// ✅ FIX 19: SHIFT TYPE NORMALISATION
//
// Local copy of the same canonical enum used by schedulerController.js
// so scheduler.js can normalise a row's rep_shift_type even if the
// controller import (further down) fails and falls back to inline
// helpers.
// =============================================
const VALID_SHIFT_TYPES = ['day', 'night', 'both'];

function normaliseShiftTypeLocal(input) {
  if (!input || typeof input !== 'string') return 'both';
  const v = input.trim().toLowerCase();
  if (v === 'day' || v === 'daytime' || v === 'day shift') return 'day';
  if (v === 'night' || v === 'nighttime' || v === 'night shift') return 'night';
  if (v === 'both' || v === 'day/night' || v === 'all' || v === '24hr' || v === '') return 'both';
  return VALID_SHIFT_TYPES.includes(v) ? v : 'both';
}

function shiftLabelFor(shiftType) {
  return { day: 'Day Shift', night: 'Night Shift', both: '' }[shiftType] || '';
}

// =============================================
// FREQUENCY → REPORT PERIOD MAP
// =============================================
const FREQUENCY_PERIOD_MAP = {
  1: 'yesterday',      // Daily        → 1 night  (completed previous shift)
  2: 'previousWeek',   // Weekly       → 7 nights (boundary-to-boundary)
  3: 'last3days',      // Twice a week → 3 nights inclusive (today-2 → today)
  4: 'last30days',     // Monthly      → 30 nights inclusive (today-29 → today)
};

const FREQUENCY_LABELS = {
  1: 'Daily',
  2: 'Weekly',
  3: 'Twice a Week',
  4: 'Monthly',
};

console.log(`📧 EMAIL SENDING STATUS: ${EMAIL_ENABLED ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
console.log(`🔄 CATCHUP MODE: ${SCHEDULER_CONFIG.ENABLE_CATCHUP_MODE ? 'ENABLED ✅' : 'DISABLED'}`);
console.log(`⏰ GRACE WINDOW: ${SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES_PAST}m back + ${SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES_FUTURE}m forward`);
console.log(`⏱️  EMAIL TIMEOUT: ${SCHEDULER_CONFIG.EMAIL_SEND_TIMEOUT / 1000}s`);
console.log(`⏱️  PDF TIMEOUT: ${SCHEDULER_CONFIG.PDF_GENERATION_TIMEOUT / 1000}s`);
console.log(`💾 DRIVE UPLOAD: ${SCHEDULER_CONFIG.ENABLE_DRIVE_UPLOAD ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
console.log(`📅 FREQUENCY MAP: Daily→yesterday | Weekly→previousWeek | Twice/wk→last3days | Monthly→last30days`);
console.log(`📐 ROLLING WINDOWS: yesterday=1shift | last3days=today-2→today | last7days=today-6→today | last30days=today-29→today`);
console.log(`🕒 SHIFT TYPES: day (06:00-18:00) | night (18:00-06:00) | both (legacy 24hr) — unique per (clientId, shiftType)`);

// =============================================
// PERFORMANCE STATS
// =============================================
const performanceStats = {
  totalProcessed:    0,
  successful:        0,
  failed:            0,
  skipped:           0,
  timeouts:          0,
  catchupProcessed:  0,
  missedRecovered:   0,
  emailsSent:        0,
  emailsFailed:      0,
  avgProcessingTime: 0,
  lastRun:           null,
  lastEmailSent:     null,
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
  pdfService   = require('./pdfService');
  emailService = require('./emailService');
  console.log('✅ PDF and Email services loaded');
} catch (error) {
  console.error('❌ Service import failed:', error.message);
  throw error;
}

// =============================================
// SINGLETON EMAIL TRANSPORTER
// =============================================
let cachedTransporter = null;

async function getEmailTransporter() {
  if (!cachedTransporter) {
    try {
      const getTransporterFn =
        emailService?.getTransporter ||
        emailService?.default?.getTransporter;

      if (!getTransporterFn || typeof getTransporterFn !== 'function') {
        throw new Error(
          'emailService does not export getTransporter. ' +
          'Available exports: ' + Object.keys(emailService || {}).join(', ')
        );
      }

      cachedTransporter = getTransporterFn();
      console.log('✅ Email transporter obtained from emailService.getTransporter()');

      if (process.env.NODE_ENV === 'development') {
        await cachedTransporter.verify();
        console.log('✅ SMTP connection verified (development mode)');
      }
    } catch (error) {
      console.error('❌ Failed to obtain email transporter:', error.message);
      throw error;
    }
  }
  return cachedTransporter;
}

// =============================================
// CONTROLLER DATE-RANGE HELPERS
// =============================================
dayjs.extend(utc);
dayjs.extend(timezone);

let controllerDateHelpers;

const _WEEK_START_DAY = parseInt(process.env.WEEK_START_DAY || '3');

// ── Inline fallback builders ────────────────────────────────────────────────
// Used only when the controller import fails.
// All rolling windows use the INCLUSIVE pattern: today.subtract(N-1, 'day') → today
// ✅ FIX 19: fallbacks also accept/forward a shiftType param, even though
// they don't build a real SQL window here (that's controller-side) — this
// keeps the function signatures identical whichever path is used, so
// getDateRangeForSchedule never has to special-case which helpers loaded.
// ──────────────────────────────────────────────────────────────────────────
const _buildInlineFallbacks = () => {
  const _getPreviousWeekRange = (shiftType = 'both') => {
    const today    = dayjs().tz(TZ).startOf('day');
    const todayDow = today.day();
    let daysBack   = (todayDow - _WEEK_START_DAY + 7) % 7;
    if (daysBack === 0) daysBack = 7;
    const startDay = today.subtract(daysBack, 'day');
    const endDay   = startDay.add(7, 'day');
    return {
      startDate:     startDay.format('YYYY-MM-DD'),
      endDate:       endDay.format('YYYY-MM-DD'),
      rangeLabel:    `Previous Week: ${startDay.format('MMM D')} – ${endDay.format('MMM D, YYYY')}`,
      nightsInRange: 7,
      daysInRange:   7,
      periodType:    'previousWeek',
      shiftType:     normaliseShiftTypeLocal(shiftType),
    };
  };

  const _getDateRangeForPeriod = (period, customStart = null, customEnd = null, shiftType = 'both') => {
    const today = dayjs().tz(TZ).startOf('day');
    const normalisedShift = normaliseShiftTypeLocal(shiftType);

    switch (period) {
      // ✅ FIX 4: yesterday — single completed shift (start = end = yesterday)
      case 'yesterday':
        return {
          startDate:     today.subtract(1, 'day').format('YYYY-MM-DD'),
          endDate:       today.subtract(1, 'day').format('YYYY-MM-DD'),
          rangeLabel:    `Yesterday: ${today.subtract(1, 'day').format('MMM D, YYYY')}`,
          nightsInRange: 1,
          daysInRange:   1,
          periodType:    'yesterday',
          shiftType:     normalisedShift,
        };

      // ✅ FIX 4: last3days — 3 days inclusive (today-2 → today)
      case 'last3days':
        return {
          startDate:     today.subtract(2, 'day').format('YYYY-MM-DD'),
          endDate:       today.format('YYYY-MM-DD'),
          rangeLabel:    `Last 3 Days: ${today.subtract(2, 'day').format('MMM D')} – ${today.format('MMM D, YYYY')}`,
          nightsInRange: 3,
          daysInRange:   3,
          periodType:    'last3days',
          shiftType:     normalisedShift,
        };

      // ✅ FIX 4: last7days — 7 days inclusive (today-6 → today)
      case 'last7days':
        return {
          startDate:     today.subtract(6, 'day').format('YYYY-MM-DD'),
          endDate:       today.format('YYYY-MM-DD'),
          rangeLabel:    `Last 7 Days: ${today.subtract(6, 'day').format('MMM D')} – ${today.format('MMM D, YYYY')}`,
          nightsInRange: 7,
          daysInRange:   7,
          periodType:    'last7days',
          shiftType:     normalisedShift,
        };

      // ✅ FIX 4: last30days — 30 days inclusive (today-29 → today)
      case 'last30days':
        return {
          startDate:     today.subtract(29, 'day').format('YYYY-MM-DD'),
          endDate:       today.format('YYYY-MM-DD'),
          rangeLabel:    `Last 30 Days: ${today.subtract(29, 'day').format('MMM D')} – ${today.format('MMM D, YYYY')}`,
          nightsInRange: 30,
          daysInRange:   30,
          periodType:    'last30days',
          shiftType:     normalisedShift,
        };

      case 'previousMonth': {
        const prev   = dayjs().tz(TZ).subtract(1, 'month');
        const start  = prev.startOf('month');
        const end    = prev.endOf('month').startOf('day');
        const nights = end.diff(start, 'day') + 1;
        return {
          startDate:     start.format('YYYY-MM-DD'),
          endDate:       end.format('YYYY-MM-DD'),
          rangeLabel:    `Previous Month: ${start.format('MMMM YYYY')}`,
          nightsInRange: nights,
          daysInRange:   nights,
          periodType:    'previousMonth',
          shiftType:     normalisedShift,
        };
      }

      case 'custom':
        if (customStart && customEnd) {
          const s      = dayjs(customStart).tz(TZ);
          const e      = dayjs(customEnd).tz(TZ);
          const nights = e.diff(s, 'day') || 1;
          return {
            startDate:     s.format('YYYY-MM-DD'),
            endDate:       e.format('YYYY-MM-DD'),
            rangeLabel:    `Custom: ${s.format('MMM D')} – ${e.format('MMM D, YYYY')}`,
            nightsInRange: nights,
            daysInRange:   nights,
            periodType:    'custom',
            shiftType:     normalisedShift,
          };
        }
        console.warn('⚠️  Custom period without dates — falling back to previousWeek');
        return _getPreviousWeekRange(normalisedShift);

      case 'previousWeek':
      default:
        return _getPreviousWeekRange(normalisedShift);
    }
  };

  return {
    getPreviousWeekRange:  _getPreviousWeekRange,
    getLast7DaysRange:     (shiftType = 'both') => _getDateRangeForPeriod('last7days', null, null, shiftType),
    getPreviousMonthRange: (shiftType = 'both') => _getDateRangeForPeriod('previousMonth', null, null, shiftType),
    getDateRangeForPeriod: _getDateRangeForPeriod,
  };
};

// Try the controller first; fall back to inline if it crashes
try {
  const ctrl = require('../controllers/schedulerController');

  if (
    typeof ctrl.getDateRangeForPeriod  !== 'function' ||
    typeof ctrl.getPreviousWeekRange   !== 'function'
  ) {
    throw new Error('Controller is missing required date-range helpers');
  }

  const fallbacks = _buildInlineFallbacks();

  controllerDateHelpers = {
    getPreviousWeekRange:  ctrl.getPreviousWeekRange,
    getLast7DaysRange:     ctrl.getLast7DaysRange     || fallbacks.getLast7DaysRange,
    getPreviousMonthRange: ctrl.getPreviousMonthRange || fallbacks.getPreviousMonthRange,
    getDateRangeForPeriod: ctrl.getDateRangeForPeriod,
  };
  console.log('✅ Controller date-range helpers loaded (shift-type aware)');
} catch (ctrlError) {
  console.warn('⚠️  Could not import controller date helpers — using inline fallbacks:', ctrlError.message);
  controllerDateHelpers = _buildInlineFallbacks();
}

// =============================================
// getDateRangeForSchedule
//
// Resolution order:
//   1. Explicit reportPeriod stored on the schedule
//   2. FREQUENCY_PERIOD_MAP[frequency]
//   3. Hard fallback to previousWeek
//
// ✅ FIX 19: accepts an optional shiftType ('day' | 'night' | 'both',
// default 'both') and forwards it to every call into
// controllerDateHelpers.getDateRangeForPeriod / getPreviousWeekRange,
// so a schedule row's rep_shift_type actually changes the SQL window
// used to build its report.
// =============================================
function getDateRangeForSchedule(frequency, reportPeriod, customStartDate = null, customEndDate = null, shiftType = 'both') {
  const freq = parseInt(frequency, 10);
  const normalisedShift = normaliseShiftTypeLocal(shiftType);

  // 1. Honour an explicit period stored on the schedule
  if (reportPeriod && reportPeriod.trim() !== '') {
    try {
      const range = controllerDateHelpers.getDateRangeForPeriod(
        reportPeriod,
        customStartDate || null,
        customEndDate   || null,
        normalisedShift
      );
      if (range && range.startDate) {
        console.log(
          `📅 [DATE] Stored reportPeriod="${reportPeriod}" [shift=${normalisedShift}] → ` +
          `${range.rangeLabel} (${range.nightsInRange} shifts)`
        );
        return range;
      }
    } catch (e) {
      console.warn(`⚠️  getDateRangeForPeriod("${reportPeriod}") failed: ${e.message} — falling through to frequency map`);
    }
  }

  // 2. Map frequency → natural period
  const period = FREQUENCY_PERIOD_MAP[freq];
  if (period) {
    try {
      const range = controllerDateHelpers.getDateRangeForPeriod(period, null, null, normalisedShift);
      if (range && range.startDate) {
        console.log(
          `📅 [DATE] frequency=${freq} (${FREQUENCY_LABELS[freq] || 'Unknown'}) [shift=${normalisedShift}] → ` +
          `period="${period}" → ${range.rangeLabel} (${range.nightsInRange} shifts)`
        );
        return range;
      }
    } catch (e) {
      console.warn(`⚠️  getDateRangeForPeriod("${period}") failed: ${e.message} — using hard fallback`);
    }
  } else {
    console.warn(`⚠️  No FREQUENCY_PERIOD_MAP entry for frequency=${freq} — using hard fallback`);
  }

  // 3. Hard fallback
  const fallback = controllerDateHelpers.getPreviousWeekRange(normalisedShift);
  console.warn(`📅 [DATE] Hard fallback to previousWeek for frequency=${freq} [shift=${normalisedShift}]: ${fallback.rangeLabel}`);
  return fallback;
}

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
// API CLIENT ENRICHMENT HELPER
// =============================================
async function enrichSchedulesWithApiClients(schedules) {
  const hasNulls = schedules.some(s => !s.ClientName);
  if (!hasNulls) return schedules;

  let apiMap = new Map();
  try {
    const bmSecurityAPI = require('./bmSecurityAPI');
    const apiClients    = await bmSecurityAPI.getClients();
    for (const c of (apiClients || [])) {
      apiMap.set(String(c.id), {
        name:  c.name          || `Client ${c.id}`,
        email: c.email         || '',
        acct:  c.accountNumber || '',
      });
    }
    console.log(`[ENRICHMENT] Loaded ${apiMap.size} clients from BM Security API`);
  } catch (err) {
    console.warn(`[ENRICHMENT] API call failed: ${err.message}`);
  }

  for (const s of schedules) {
    if (!s.ClientName) {
      const entry = apiMap.get(String(s.ClientID));
      if (entry) {
        s.ClientName  = entry.name;
        s.ClientEmail = s.ClientEmail || entry.email;
        console.log(`[ENRICHMENT] Resolved ClientID ${s.ClientID} → "${s.ClientName}" (API)`);
      } else {
        s.ClientName  = `Client ${s.ClientID}`;
        s.ClientEmail = s.ClientEmail || '';
        console.warn(`[ENRICHMENT] ClientID ${s.ClientID} not found — using fallback name`);
      }
    }
  }

  return schedules;
}

// =============================================
// EMAIL VALIDATION
// =============================================
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith(SCHEDULE_PREFIX)) return false;
  const invalidPatterns = [
    'test@test.com', 'example@example.com', 'user@example.com',
    'email@email.com', 'mail@mail.com', 'test@test.test',
    'none', 'null', 'undefined', '""', "''", '[]', '{}',
  ];
  if (invalidPatterns.includes(trimmed.toLowerCase())) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function normalizeEmailList(emails) {
  if (!emails) return [];
  if (typeof emails === 'string' && emails.startsWith(SCHEDULE_PREFIX)) return [];
  if (Array.isArray(emails)) {
    return emails
      .map(e => (typeof e === 'string' ? e.trim() : ''))
      .filter(e => e.length > 0)
      .filter(e => isValidEmail(e));
  }
  if (typeof emails === 'string') {
    const trimmed = emails.trim();
    if (trimmed.length === 0) return [];
    return trimmed
      .split(/[\s,;\n]+/)
      .map(e => e.trim())
      .filter(e => e.length > 0)
      .filter(e => isValidEmail(e))
      .filter((email, index, self) => self.indexOf(email) === index);
  }
  return [];
}

function getValidatedEmailsFromSchedule(schedule) {
  const { ReportEmail, ClientEmail, ClientName } = schedule;
  console.log(`\n[EMAIL VALIDATION] Processing emails for ${ClientName}:`);
  console.log(`   📥 ReportEmail raw: "${ReportEmail || '(empty)'}"`);
  console.log(`   📥 ClientEmail raw: "${ClientEmail || '(empty)'}"`);

  if (ReportEmail && typeof ReportEmail === 'string' && ReportEmail.startsWith(SCHEDULE_PREFIX)) {
    console.warn(`   ⚠️  ReportEmail contains SCHEDULE:: config — should have been excluded by SQL. Skipping.`);
  }

  let emailList = [];
  let source    = 'none';

  if (ReportEmail && typeof ReportEmail === 'string' && ReportEmail.trim().length > 0) {
    emailList = normalizeEmailList(ReportEmail);
    if (emailList.length > 0) source = 'ReportEmail';
  }
  if (emailList.length === 0 && ClientEmail && typeof ClientEmail === 'string' && ClientEmail.trim().length > 0) {
    emailList = normalizeEmailList(ClientEmail);
    if (emailList.length > 0) source = 'ClientEmail';
  }

  if (emailList.length > 0) {
    console.log(`   ✅ Using ${source}: Found ${emailList.length} valid email(s)`);
    emailList.forEach((email, index) => { console.log(`      ${index + 1}. ${email}`); });
    return emailList;
  }

  console.log(`   ❌ No valid emails found`);
  return null;
}

// =============================================
// HELPERS
// =============================================
async function getDatabaseConnection(maxRetries = 3, retryDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const pool = await poolPromise;
      if (pool && pool.connected !== false) return pool;
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

async function withTimeoutAndRetry(promiseFn, timeoutMs, operationName, clientId = null, maxRetries = 1) {
  const startTime = Date.now();
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await Promise.race([
        promiseFn(),
        new Promise((_, reject) =>
          setTimeout(() => {
            reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        ),
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

function logToFile(logType, clientId, clientName, message, details = {}) {
  try {
    if (!SCHEDULER_CONFIG.LOG_ERRORS_TO_FILE) return;
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: logType, clientId, clientName, message, details,
    };
    const logFile = ['SUCCESS', 'EMAIL_SENT', 'CATCHUP_RECOVERED', 'LOCK_SKIPPED', 'SCHEDULE_UPDATED'].includes(logType)
      ? SCHEDULER_CONFIG.SUCCESS_LOG_FILE
      : SCHEDULER_CONFIG.ERROR_LOG_FILE;
    fs.appendFileSync(
      path.join(__dirname, logFile),
      JSON.stringify(logEntry) + '\n',
      { encoding: 'utf8' }
    );
  } catch (logError) {
    console.error('[LOG] Failed to write log:', logError.message);
  }
}

async function savePDFToDisk(pdfBuffer, clientName, dateRange) {
  if (!SAVE_PDF_TO_DISK) return null;
  try {
    const timestamp      = dayjs().format('YYYYMMDD_HHmmss');
    const safeClientName = clientName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const shiftSuffix    = dateRange?.shiftType && dateRange.shiftType !== 'both' ? `_${dateRange.shiftType}` : '';
    const filename       = `Report_${safeClientName}${shiftSuffix}_${timestamp}.pdf`;
    const filepath       = path.join(PDF_TEMP_DIR, filename);
    await fs.promises.writeFile(filepath, pdfBuffer);
    const stats = await fs.promises.stat(filepath);
    console.log(`[PDF] Saved to disk: ${filename} (${Math.round(stats.size / 1024)}KB)`);
    return { filepath, filename, sizeKB: Math.round(stats.size / 1024) };
  } catch (error) {
    console.warn(`[PDF SAVE] Failed: ${error.message}`);
    return null;
  }
}

// =============================================
// GET DUE SCHEDULES
//
// ✅ FIX 1: IN (1, 2, 3, 4) — includes Monthly
// ✅ FIX 5: SCHEDULE:: filter on all queries
// ✅ FIX 19: R.rep_shift_type AS ShiftType selected in both branches
//           so processSchedule() knows which window to build
// =============================================
async function getDueSchedules(enableCatchup = SCHEDULER_CONFIG.ENABLE_CATCHUP_MODE) {
  let pool;
  try {
    pool = await getDatabaseConnection();
    const now         = dayjs().tz(TZ);
    const windowStart = now.subtract(SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES_PAST, 'minute');
    const windowEnd   = now.add(SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES_FUTURE, 'minute');

    console.log(`\n[SCHEDULER] Checking schedules from ${windowStart.format('HH:mm:ss')} to ${windowEnd.format('HH:mm:ss')}`);

    let query, parameters;

    if (enableCatchup) {
      const catchupCutoff = now.subtract(SCHEDULER_CONFIG.CATCHUP_MAX_MINUTES_BACK, 'minute');

      query = `
        SELECT TOP ${SCHEDULER_CONFIG.CATCHUP_MAX_SCHEDULES_PER_RUN}
          R.rep_idKey              AS ScheduleID,
          R.rep_iidcuenta          AS ClientID,
          C.cue_cnombre            AS ClientName,
          C.cue_cemail             AS ClientEmail,
          R.rep_cmail              AS ReportEmail,
          R.rep_tproximoenvio      AS NextRun,
          R.rep_nfrecuencia        AS Frequency,
          R.rep_nCadaUnidadTiempo  AS IntervalDays,
          R.rep_ntipo              AS ReportType,
          R.rep_shift_type         AS ShiftType,
          CASE
            WHEN R.rep_tproximoenvio < @catchupCutoff THEN 'MISSED'
            WHEN R.rep_tproximoenvio < @now           THEN 'OVERDUE'
            ELSE 'DUE_SOON'
          END AS ScheduleStatus
        FROM [_Datos].[dbo].[m_reportes_automaticos] R
        LEFT JOIN [_Datos].[dbo].[m_cuentas] C
          ON R.rep_iidcuenta = C.cue_iid
        WHERE
          R.rep_iidcuenta IS NOT NULL
          AND R.rep_tproximoenvio IS NOT NULL
          AND (R.rep_cmail IS NULL OR R.rep_cmail NOT LIKE 'SCHEDULE::%')
          AND (
            (R.rep_tproximoenvio >= @windowStart AND R.rep_tproximoenvio <= @windowEnd)
            OR
            (R.rep_tproximoenvio < @now AND R.rep_tproximoenvio >= @catchupCutoff)
          )
          AND R.rep_nfrecuencia IN (1, 2, 3, 4)
        ORDER BY
          CASE WHEN R.rep_tproximoenvio < @now THEN 0 ELSE 1 END,
          R.rep_tproximoenvio ASC
      `;

      parameters = {
        windowStart:   windowStart.toDate(),
        windowEnd:     windowEnd.toDate(),
        now:           now.toDate(),
        catchupCutoff: catchupCutoff.toDate(),
      };
    } else {
      query = `
        SELECT
          R.rep_idKey              AS ScheduleID,
          R.rep_iidcuenta          AS ClientID,
          C.cue_cnombre            AS ClientName,
          C.cue_cemail             AS ClientEmail,
          R.rep_cmail              AS ReportEmail,
          R.rep_tproximoenvio      AS NextRun,
          R.rep_nfrecuencia        AS Frequency,
          R.rep_nCadaUnidadTiempo  AS IntervalDays,
          R.rep_ntipo              AS ReportType,
          R.rep_shift_type         AS ShiftType,
          CASE
            WHEN R.rep_tproximoenvio < @now THEN 'OVERDUE'
            ELSE 'DUE_SOON'
          END AS ScheduleStatus
        FROM [_Datos].[dbo].[m_reportes_automaticos] R
        LEFT JOIN [_Datos].[dbo].[m_cuentas] C
          ON R.rep_iidcuenta = C.cue_iid
        WHERE
          R.rep_iidcuenta IS NOT NULL
          AND R.rep_tproximoenvio IS NOT NULL
          AND (R.rep_cmail IS NULL OR R.rep_cmail NOT LIKE 'SCHEDULE::%')
          AND R.rep_tproximoenvio >= @windowStart
          AND R.rep_tproximoenvio <= @windowEnd
          AND R.rep_nfrecuencia IN (1, 2, 3, 4)
        ORDER BY R.rep_tproximoenvio ASC
      `;

      parameters = {
        windowStart: windowStart.toDate(),
        windowEnd:   windowEnd.toDate(),
        now:         now.toDate(),
      };
    }

    const request = pool.request();
    Object.entries(parameters).forEach(([key, value]) => {
      request.input(key, sql.DateTime, value);
    });

    const result    = await request.query(query);
    let schedules   = result.recordset || [];
    schedules       = await enrichSchedulesWithApiClients(schedules);

    // ✅ FIX 19: normalise ShiftType on every row up-front so downstream
    // code (logging, processSchedule, email/pdf naming) never has to
    // re-derive it or guess at a raw/blank DB value.
    schedules.forEach(s => { s.ShiftType = normaliseShiftTypeLocal(s.ShiftType); });

    // De-duplicate by ScheduleID
    const seen    = new Set();
    const deduped = [];
    for (const s of schedules) {
      if (seen.has(s.ScheduleID)) {
        console.warn(`[SCHEDULER] ⚠️  Duplicate ScheduleID ${s.ScheduleID} in result set — dropping extra`);
        continue;
      }
      seen.add(s.ScheduleID);
      deduped.push(s);
    }
    schedules = deduped;

    const validSchedules = [];
    let invalidCount     = 0;

    for (const schedule of schedules) {
      if (!schedule.ClientID) {
        console.warn(`[SCHEDULER] Skipping schedule with no ClientID`);
        continue;
      }

      const validatedEmails = getValidatedEmailsFromSchedule(schedule);
      if (!validatedEmails || validatedEmails.length === 0) {
        console.log(`[SCHEDULER] ❌ Skipping ${schedule.ClientName} — no valid emails`);
        invalidCount++;
        logToFile('INVALID_EMAIL', schedule.ClientID, schedule.ClientName,
          'No valid emails found',
          { reportEmail: schedule.ReportEmail, clientEmail: schedule.ClientEmail });
        continue;
      }

      schedule.ValidatedEmail = validatedEmails.join(', ');
      schedule.EmailList      = validatedEmails;
      validSchedules.push(schedule);
    }

    if (validSchedules.length > 0) {
      console.log(`\n[SCHEDULER] ✅ Found ${validSchedules.length} schedule(s) to process`);
      if (invalidCount > 0)
        console.log(`[SCHEDULER] ⚠️  Skipped ${invalidCount} schedule(s) — invalid emails`);

      const statusCounts = { MISSED: 0, OVERDUE: 0, DUE_SOON: 0 };
      validSchedules.forEach((schedule, index) => {
        const scheduleTime = dayjs(schedule.NextRun).tz(TZ).format('HH:mm:ss');
        const scheduleDate = dayjs(schedule.NextRun).tz(TZ).format('YYYY-MM-DD');
        const dueInMinutes = dayjs(schedule.NextRun).diff(now, 'minute', true);
        const status       = schedule.ScheduleStatus || (dueInMinutes <= 0 ? 'OVERDUE' : 'DUE_SOON');
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        const timeDiff = Math.abs(dueInMinutes).toFixed(1);
        const timeDesc = dueInMinutes <= 0 ? `${timeDiff} minutes ago` : `${timeDiff} minutes from now`;
        const freqLabel = FREQUENCY_LABELS[schedule.Frequency] || `Frequency ${schedule.Frequency}`;
        const period    = FREQUENCY_PERIOD_MAP[schedule.Frequency] || 'previousWeek';
        const shiftTag  = schedule.ShiftType !== 'both' ? ` [${schedule.ShiftType}]` : '';
        console.log(`\n  ${index + 1}. ${schedule.ClientName}${shiftTag}`);
        console.log(`     ⏰ ${scheduleDate} ${scheduleTime} (${timeDesc}) [${status}]`);
        console.log(`     📅 ${freqLabel} → will use period: ${period}`);
        console.log(`     📧 ${schedule.EmailList.length} email(s)`);
      });

      const totalEmails = validSchedules.reduce((sum, s) => sum + s.EmailList.length, 0);
      console.log(`\n[SCHEDULER] 📨 Total emails to send: ${totalEmails}`);
      if (statusCounts.MISSED > 0) {
        performanceStats.missedRecovered += statusCounts.MISSED;
        console.log(`[SCHEDULER] 🔄 Will recover ${statusCounts.MISSED} missed schedule(s)`);
      }
    } else {
      console.log(`\n[SCHEDULER] ℹ️ No due schedules found with valid emails`);
    }

    return validSchedules;
  } catch (error) {
    console.error('[SCHEDULER] Error fetching schedules:', error.message);
    logToFile('DB_ERROR', null, null, `Error fetching schedules: ${error.message}`);
    return [];
  }
}

// =============================================
// ATOMIC COMPARE-AND-SWAP LOCK
//
// ✅ FIX 2: Correct next-run advancement per frequency
//   1 (Daily)        → +IntervalDays days   (default 1)
//   2 (Weekly)       → +7 days
//   3 (Twice/week)   → +IntervalDays days   (default 3)
//   4 (Monthly)      → +1 calendar month
//
// Note: locking remains scoped to ScheduleID (rep_idKey), which is
// already unique per (clientId, shiftType) row after the FIX 19
// migration — so Day and Night schedules for the same client lock
// and advance completely independently of each other.
// =============================================
async function updateNextRunTime(schedule) {
  try {
    const pool            = await getDatabaseConnection();
    const now             = dayjs().tz(TZ);
    const originalRunTime = schedule.NextRun instanceof Date
      ? dayjs(schedule.NextRun).tz(TZ)
      : dayjs.tz(schedule.NextRun, TZ);

    const scheduledHour   = originalRunTime.hour();
    const scheduledMinute = originalRunTime.minute();
    let   baseTime        = originalRunTime;

    const advanceTime = (base) => {
      switch (parseInt(schedule.Frequency, 10)) {
        case 1: return base.add(schedule.IntervalDays || 1, 'day');
        case 2: return base.add(7, 'day');
        case 3: return base.add(schedule.IntervalDays || 3, 'day');
        case 4: return base.add(1, 'month');
        default: return base.add(1, 'day');
      }
    };

    baseTime = advanceTime(baseTime);

    let newNextRun = baseTime
      .set('hour', scheduledHour)
      .set('minute', scheduledMinute)
      .set('second', 0)
      .set('millisecond', 0);

    // Safety: never schedule in the past
    const minFutureTime = now.add(1, 'minute');
    if (newNextRun.isBefore(minFutureTime)) {
      console.log(`[LOCK] Calculated time is too soon, adding another interval`);
      baseTime = advanceTime(baseTime);
      newNextRun = baseTime
        .set('hour', scheduledHour)
        .set('minute', scheduledMinute)
        .set('second', 0)
        .set('millisecond', 0);
    }

    const formattedNextRun     = newNextRun.format('YYYY-MM-DD HH:mm:ss');
    const expectedCurrentValue = originalRunTime.format('YYYY-MM-DD HH:mm:ss');
    const freqLabel            = FREQUENCY_LABELS[schedule.Frequency] || `Freq ${schedule.Frequency}`;
    const shiftTag             = schedule.ShiftType && schedule.ShiftType !== 'both' ? ` [${schedule.ShiftType}]` : '';

    const result = await pool.request()
      .input('ScheduleID',   sql.Int,      schedule.ScheduleID)
      .input('NextRun',      sql.DateTime, newNextRun.toDate())
      .input('ExpectedTime', sql.DateTime, originalRunTime.toDate())
      .query(`
        UPDATE [_Datos].[dbo].[m_reportes_automaticos]
        SET    rep_tproximoenvio = @NextRun
        WHERE  rep_idKey         = @ScheduleID
          AND  rep_tproximoenvio = @ExpectedTime
      `);

    if (result.rowsAffected[0] === 0) {
      const err  = new Error(`Schedule ${schedule.ScheduleID} already locked by another process`);
      err.code   = 'ALREADY_LOCKED';
      throw err;
    }

    console.log(`[LOCK] ✅ Acquired for schedule ${schedule.ScheduleID}${shiftTag} (${freqLabel}) → next run: ${formattedNextRun}`);
    logToFile('SCHEDULE_UPDATED', schedule.ClientID, schedule.ClientName,
      'Next run updated (lock acquired)',
      { scheduleId: schedule.ScheduleID, frequency: freqLabel, shiftType: schedule.ShiftType, originalTime: expectedCurrentValue, newTime: formattedNextRun });

    return formattedNextRun;
  } catch (error) {
    if (error.code === 'ALREADY_LOCKED') throw error;
    console.error(`[LOCK] ❌ DB error updating schedule ${schedule.ScheduleID}:`, error.message);
    logToFile('SCHEDULE_UPDATE_ERROR', schedule.ClientID, schedule.ClientName,
      `DB error during lock: ${error.message}`);
    throw error;
  }
}

// =============================================
// SEND EMAIL WITH RETRY
// =============================================
async function sendEmailWithRetry(emailData, clientName, maxRetries = SCHEDULER_CONFIG.RETRY_ATTEMPTS) {
  const sendFn =
    emailService?.sendWithTransporter ||
    emailService?.default?.sendWithTransporter;

  if (!sendFn || typeof sendFn !== 'function') {
    throw new Error(
      'emailService.sendWithTransporter is not a function. ' +
      'Available exports: ' + Object.keys(emailService || {}).join(', ')
    );
  }

  const transporter    = await getEmailTransporter();
  const recipientCount = emailData.to.split(',').length;
  console.log(`[EMAIL] Preparing to send to ${recipientCount} recipient(s) for ${clientName}`);

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      console.log(`[EMAIL] Attempt ${attempt}/${maxRetries + 1} for ${clientName} → ${emailData.to}`);

      await withTimeoutAndRetry(
        () => sendFn(transporter, emailData),
        SCHEDULER_CONFIG.EMAIL_SEND_TIMEOUT,
        'Email sending',
        clientName,
        0
      );

      performanceStats.emailsSent  += recipientCount;
      performanceStats.lastEmailSent = new Date().toISOString();
      console.log(`[EMAIL] ✅ Sent to ${recipientCount} recipient(s) (attempt ${attempt})`);
      return true;
    } catch (emailError) {
      if (attempt <= maxRetries) {
        console.warn(`[EMAIL] Attempt ${attempt} failed for ${clientName}: ${emailError.message}. Retrying...`);
        await delay(SCHEDULER_CONFIG.RETRY_DELAY * attempt);
      } else {
        performanceStats.emailsFailed += recipientCount;
        console.error(`[EMAIL] ❌ All attempts failed for ${clientName}: ${emailError.message}`);
        throw emailError;
      }
    }
  }
}

// =============================================
// PROCESS SINGLE SCHEDULE
//
// ✅ FIX 19: destructures ShiftType off the schedule row and forwards
// it to getDateRangeForSchedule, the PDF generator, and the outgoing
// email — including the filename and a shiftLabel field so a client
// receiving both a Day and Night report can immediately tell them
// apart from the subject/attachment name alone.
// =============================================
async function processSchedule(schedule, customDateRange = null, isCatchup = false) {
  const {
    ClientID, ClientName, ValidatedEmail, Frequency,
    IntervalDays, ScheduleID, NextRun, EmailList,
    ReportPeriod, CustomStartDate, CustomEndDate,
    ShiftType,
  } = schedule;
  const startTime = Date.now();
  const prefix    = isCatchup ? '[CATCHUP]' : '[SCHEDULER]';
  const freqLabel = FREQUENCY_LABELS[Frequency] || `Frequency ${Frequency}`;
  const shiftType = normaliseShiftTypeLocal(ShiftType);
  const shiftTag  = shiftType !== 'both' ? ` [${shiftType}]` : '';

  console.log(`\n${prefix} 📋 Processing: ${ClientName}${shiftTag} (ID: ${ClientID})`);
  console.log(`${prefix} 📅 Frequency: ${freqLabel} (${Frequency})`);
  console.log(`${prefix} 📧 Recipients: ${EmailList.length} email(s)`);

  // STEP 1: LOCK
  let updatedNextRun;
  try {
    console.log(`${prefix} 🔒 Attempting lock for schedule ${ScheduleID}...`);
    updatedNextRun = await updateNextRunTime(schedule);
    console.log(`${prefix} 🔒 Lock acquired → next run: ${updatedNextRun}`);
  } catch (lockError) {
    if (lockError.code === 'ALREADY_LOCKED') {
      console.log(`${prefix} ⏭️  Schedule ${ScheduleID} already locked — skipping (no duplicate)`);
      logToFile('LOCK_SKIPPED', ClientID, ClientName,
        'Schedule already processed by concurrent tick',
        { scheduleId: ScheduleID, isCatchup, shiftType });
      performanceStats.skipped++;
    } else {
      console.error(`${prefix} ❌ LOCK FAILED (DB error) for ${ClientName}: ${lockError.message}`);
      logToFile('LOCK_FAILED', ClientID, ClientName,
        `DB error during lock: ${lockError.message}`,
        { scheduleId: ScheduleID, isCatchup, shiftType });
      updateStats(false, Date.now() - startTime, isCatchup);
    }
    return {
      success:        false,
      scheduleId:     ScheduleID,
      clientId:       ClientID,
      clientName:     ClientName,
      shiftType,
      error:          lockError.message,
      processingTime: Date.now() - startTime,
      isCatchup,
      skipped:        lockError.code === 'ALREADY_LOCKED',
    };
  }

  // STEP 2: VALIDATE AND PROCESS
  try {
    if (!ClientID)       throw new Error('Missing ClientID');
    if (!ValidatedEmail) throw new Error('Missing valid email');

    // STEP 3: DATE RANGE
    // ✅ FIX 3 + FIX 4 + FIX 19: Uses correct FREQUENCY_PERIOD_MAP, exact
    // rolling windows, AND the schedule's own shiftType so a Day schedule
    // queries 06:00-18:00 and a Night schedule queries 18:00-06:00.
    let dateRange;
    if (customDateRange && customDateRange.startDate) {
      dateRange = customDateRange;
      console.log(`${prefix} 📅 Using injected custom date range: ${dateRange.startDate} → ${dateRange.endDate}`);
    } else {
      dateRange = getDateRangeForSchedule(
        Frequency,
        ReportPeriod    || null,
        CustomStartDate || null,
        CustomEndDate   || null,
        shiftType
      );
    }

    const pdfStartDate = dateRange.startDate;

    // ✅ FIX 6: pdfEndDate = dateRange.endDate directly.
    // The date range functions now return correct inclusive end dates.
    // For night-shift context: getYesterdayRange returns yesterday as both
    // start and end; the DB query uses getDatabaseQueryDates which adds the
    // correct shift-specific window automatically. No extra subtract needed here.
    const pdfEndDate = dateRange.endDate;

    console.log(`${prefix} 📅 Date range resolved:`, {
      frequency:  freqLabel,
      period:     dateRange.periodType,
      shiftType,
      startDate:  pdfStartDate,
      endDate:    pdfEndDate,
      nights:     dateRange.nightsInRange,
      label:      dateRange.rangeLabel,
    });

    if (!pdfStartDate || !pdfEndDate) {
      throw new Error(`Invalid date range computed: start=${pdfStartDate} end=${pdfEndDate}`);
    }

    // STEP 4: PDF GENERATION
    const pdfFunc =
      pdfService?.generateDashboardPDF ||
      pdfService?.default?.generateDashboardPDF;
    if (!pdfFunc) throw new Error('PDF generation function not available');

    const shiftLabel = shiftLabelFor(shiftType);

    console.log(`${prefix} 📄 Generating PDF${shiftTag}...`);
    const pdfBuffer = await withTimeoutAndRetry(
      () => pdfFunc({
        clientId:   ClientID,
        clientName: ClientName,
        startDate:  pdfStartDate,
        endDate:    pdfEndDate,
        frequency:  dateRange.periodType || 'weekly',
        reportDate: pdfEndDate,
        shiftType,
        shiftLabel,
        isCatchup,
      }),
      SCHEDULER_CONFIG.PDF_GENERATION_TIMEOUT,
      'PDF generation',
      ClientID,
      0
    );

    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0)
      throw new Error('PDF generation returned empty buffer');
    console.log(`${prefix} ✅ PDF generated (${Math.round(pdfBuffer.length / 1024)}KB)`);

    if (SAVE_PDF_TO_DISK) await savePDFToDisk(pdfBuffer, ClientName, dateRange);

    // STEP 5: EMAIL SENDING
    const filenameShiftSuffix = shiftType !== 'both' ? `_${shiftType}` : '';
    const emailData = {
      to:                ValidatedEmail,
      clientName:        ClientName,
      startDate:         pdfStartDate,
      endDate:           pdfEndDate,
      shiftType,
      shiftLabel,
      pdfBuffer,
      pdfFilename:       `Security_Report_${ClientName.replace(/\s+/g, '_')}${filenameShiftSuffix}_${pdfStartDate}_${pdfEndDate}${isCatchup ? '_CATCHUP' : ''}.pdf`,
      frequency:         dateRange.periodType || 'weekly',
      reportDate:        pdfEndDate,
      subjectPrefix:     SCHEDULER_CONFIG.EMAIL_SUBJECT_PREFIX + (shiftLabel ? ` — ${shiftLabel}` : ''),
      isCatchup,
      enableDriveUpload: SCHEDULER_CONFIG.ENABLE_DRIVE_UPLOAD,
    };

    let emailSuccess = false;
    let emailError   = null;

    try {
      await sendEmailWithRetry(emailData, ClientName);
      emailSuccess = true;
      logToFile(
        isCatchup ? 'CATCHUP_RECOVERED' : 'EMAIL_SENT',
        ClientID, ClientName,
        `Report sent${isCatchup ? ' (catchup)' : ''}`,
        {
          emailCount: EmailList.length,
          emails:     EmailList,
          frequency:  freqLabel,
          period:     dateRange.periodType,
          shiftType,
          dateRange:  `${pdfStartDate} to ${pdfEndDate}`,
          nights:     dateRange.nightsInRange,
          nextRun:    updatedNextRun,
        }
      );
      console.log(`${prefix} 📧 Email sent to ${EmailList.length} recipient(s)`);
    } catch (emailSendError) {
      emailError = emailSendError.message;
      logToFile('EMAIL_SEND_ERROR', ClientID, ClientName,
        `Email failed: ${emailError}`,
        { emailCount: EmailList.length, emails: EmailList, shiftType, nextRun: updatedNextRun, isCatchup });
      console.error(`${prefix} ❌ Email failed: ${emailError}`);
    }

    const duration = Date.now() - startTime;
    updateStats(emailSuccess, duration, isCatchup);

    return {
      success:        emailSuccess,
      email:          ValidatedEmail,
      emailCount:     EmailList.length,
      scheduleId:     ScheduleID,
      clientId:       ClientID,
      clientName:     ClientName,
      shiftType,
      nextRun:        updatedNextRun,
      processingTime: duration,
      isCatchup,
      error:          emailError,
      dateRange: {
        startDate: pdfStartDate,
        endDate:   pdfEndDate,
        nights:    dateRange.nightsInRange,
        label:     dateRange.rangeLabel,
        period:    dateRange.periodType,
        frequency: freqLabel,
        shiftType,
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`${prefix} ❌ Failed for ${ClientName}${shiftTag} after ${duration}ms:`, error.message);
    updateStats(false, duration, isCatchup);
    logToFile('PROCESS_ERROR', ClientID, ClientName, error.message,
      { scheduleId: ScheduleID, processingTime: duration, isCatchup, shiftType, nextRun: updatedNextRun });
    return {
      success:        false,
      scheduleId:     ScheduleID,
      clientId:       ClientID,
      clientName:     ClientName,
      shiftType,
      error:          error.message,
      processingTime: duration,
      isCatchup,
      nextRun:        updatedNextRun,
    };
  }
}

// =============================================
// UPDATE PERFORMANCE STATS
// =============================================
function updateStats(success, duration, isCatchup = false) {
  performanceStats.totalProcessed++;
  if (success) performanceStats.successful++; else performanceStats.failed++;
  if (isCatchup) performanceStats.catchupProcessed++;
  const prevTotal = performanceStats.avgProcessingTime * (performanceStats.totalProcessed - 1);
  performanceStats.avgProcessingTime = (prevTotal + duration) / performanceStats.totalProcessed;
  performanceStats.lastRun = new Date().toISOString();
}

// =============================================
// PROCESS SCHEDULES CONCURRENTLY
// =============================================
async function processSchedulesConcurrently(schedules, customDateRange = null) {
  const results   = { processed: 0, successful: 0, failed: 0, skipped: 0, catchup: 0, details: [] };
  const batchSize = Math.min(SCHEDULER_CONFIG.MAX_CONCURRENT_SCHEDULES, SCHEDULER_CONFIG.MAX_CONCURRENT_PDFS);

  // Final de-duplication guard
  const seen   = new Set();
  const unique = [];
  for (const s of schedules) {
    if (seen.has(s.ScheduleID)) {
      console.warn(`[BATCH] ⚠️  Dropping duplicate ScheduleID ${s.ScheduleID} before batching`);
      continue;
    }
    seen.add(s.ScheduleID);
    unique.push(s);
  }

  if (unique.length < schedules.length) {
    console.warn(`[BATCH] Reduced ${schedules.length} → ${unique.length} after de-duplication`);
  }

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    console.log(`\n[SCHEDULER] Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(unique.length / batchSize)} (${batch.length} schedules)`);

    const batchPromises = batch.map(schedule => {
      const isCatchup = schedule.ScheduleStatus === 'MISSED' || schedule.ScheduleStatus === 'OVERDUE';
      return processSchedule(schedule, customDateRange, isCatchup)
        .then(result  => ({ schedule, result }))
        .catch(error  => ({ schedule, result: null, error }));
    });

    const batchResults = await Promise.allSettled(batchPromises);

    for (const settled of batchResults) {
      results.processed++;
      if (settled.status === 'fulfilled') {
        const { result, error } = settled.value;
        if (error) {
          results.failed++;
          results.details.push({
            client:  settled.value.schedule?.ClientName || 'Unknown',
            shiftType: settled.value.schedule?.ShiftType,
            success: false,
            error:   error.message,
          });
          continue;
        }
        if (result) {
          if (result.skipped) {
            results.skipped++;
          } else if (result.success) {
            results.successful++;
            if (result.isCatchup) results.catchup++;
          } else {
            results.failed++;
          }
          results.details.push({
            client:         result.clientName,
            shiftType:      result.shiftType,
            success:        result.success,
            skipped:        result.skipped || false,
            email:          result.email,
            emailCount:     result.emailCount,
            nextRun:        result.nextRun,
            processingTime: result.processingTime,
            isCatchup:      result.isCatchup,
            error:          result.error,
            dateRange:      result.dateRange,
          });
        }
      } else {
        results.failed++;
        results.details.push({
          client:  'Unknown',
          success: false,
          error:   settled.reason?.message || 'Unknown error',
        });
      }
    }

    if (i + batchSize < unique.length) await delay(SCHEDULER_CONFIG.DELAY_BETWEEN_CLIENTS);
  }

  return results;
}

// =============================================
// CATCHUP MODE
// =============================================
async function runCatchupMode(minutesBack = SCHEDULER_CONFIG.CATCHUP_MAX_MINUTES_BACK) {
  console.log(`\n🔄 MANUAL CATCHUP MODE: Looking for missed schedules up to ${minutesBack} minutes back`);
  const now        = dayjs().tz(TZ);
  const cutoffTime = now.subtract(minutesBack, 'minute');

  try {
    const pool = await getDatabaseConnection();

    const result = await pool.request()
      .input('cutoffTime', sql.DateTime, cutoffTime.toDate())
      .input('now',        sql.DateTime, now.toDate())
      .query(`
        SELECT TOP ${SCHEDULER_CONFIG.CATCHUP_MAX_SCHEDULES_PER_RUN}
          R.rep_idKey              AS ScheduleID,
          R.rep_iidcuenta          AS ClientID,
          C.cue_cnombre            AS ClientName,
          C.cue_cemail             AS ClientEmail,
          R.rep_cmail              AS ReportEmail,
          R.rep_tproximoenvio      AS NextRun,
          R.rep_nfrecuencia        AS Frequency,
          R.rep_nCadaUnidadTiempo  AS IntervalDays,
          R.rep_ntipo              AS ReportType,
          R.rep_shift_type         AS ShiftType,
          'MISSED'                 AS ScheduleStatus
        FROM [_Datos].[dbo].[m_reportes_automaticos] R
        LEFT JOIN [_Datos].[dbo].[m_cuentas] C
          ON R.rep_iidcuenta = C.cue_iid
        WHERE
          R.rep_iidcuenta IS NOT NULL
          AND R.rep_tproximoenvio IS NOT NULL
          AND (R.rep_cmail IS NULL OR R.rep_cmail NOT LIKE 'SCHEDULE::%')
          AND R.rep_tproximoenvio < @now
          AND R.rep_tproximoenvio >= @cutoffTime
          AND R.rep_nfrecuencia IN (1, 2, 3, 4)
        ORDER BY R.rep_tproximoenvio ASC
      `);

    let missedSchedules = result.recordset || [];
    missedSchedules.forEach(s => { s.ShiftType = normaliseShiftTypeLocal(s.ShiftType); });

    if (missedSchedules.length === 0) {
      console.log(`[CATCHUP] No missed schedules found in the last ${minutesBack} minutes`);
      return { success: true, message: 'No missed schedules found', count: 0 };
    }

    console.log(`[CATCHUP] Found ${missedSchedules.length} missed schedule(s) to recover`);
    missedSchedules = await enrichSchedulesWithApiClients(missedSchedules);

    const validSchedules = [];
    for (const schedule of missedSchedules) {
      const validatedEmails = getValidatedEmailsFromSchedule(schedule);
      if (validatedEmails && validatedEmails.length > 0) {
        schedule.ValidatedEmail = validatedEmails.join(', ');
        schedule.EmailList      = validatedEmails;
        validSchedules.push(schedule);
      }
    }

    if (validSchedules.length === 0) {
      console.log(`[CATCHUP] No valid emails found for any missed schedules`);
      return { success: false, message: 'No valid emails found', count: 0 };
    }

    const results = await processSchedulesConcurrently(validSchedules);
    console.log(`[CATCHUP] ✅ Complete: ${results.successful} recovered, ${results.skipped} skipped, ${results.failed} failed`);

    return {
      success:      true,
      results,
      catchupCount: validSchedules.length,
      timestamp:    now.format('YYYY-MM-DD HH:mm:ss'),
    };
  } catch (error) {
    console.error(`[CATCHUP] Failed:`, error.message);
    return { success: false, error: error.message, timestamp: now.format('YYYY-MM-DD HH:mm:ss') };
  }
}

// =============================================
// MAIN SCHEDULER FUNCTION
// =============================================
async function runDynamicReportScheduler(options = {}) {
  const {
    useCustomDateRange = false,
    customDateRange    = null,
    enableCatchup      = SCHEDULER_CONFIG.ENABLE_CATCHUP_MODE,
  } = options;

  const startTime = Date.now();
  const now       = dayjs().tz(TZ);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`⏰ SCHEDULER RUN STARTED: ${now.format('YYYY-MM-DD HH:mm:ss')}`);
  console.log(`📧 Email sending: ${EMAIL_ENABLED ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
  console.log(`🔄 Catchup mode: ${enableCatchup ? 'ENABLED' : 'DISABLED'}`);
  console.log(`💾 Drive upload: ${SCHEDULER_CONFIG.ENABLE_DRIVE_UPLOAD ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
  console.log(`📅 Daily→yesterday | Weekly→previousWeek | Twice/wk→last3days | Monthly→last30days`);
  console.log(`📐 yesterday=1shift | last3days=today-2→today | last7days=today-6→today | last30days=today-29→today`);
  console.log(`🕒 Shift-aware windows: day=06:00-18:00 | night=18:00-06:00 | both=legacy 24hr`);
  console.log(`${'='.repeat(70)}`);

  try {
    const dueSchedules = await getDueSchedules(enableCatchup);
    if (dueSchedules.length === 0) {
      console.log('[SCHEDULER] No due schedules found');
      return { success: true, message: 'No due schedules' };
    }

    console.log(`\n[SCHEDULER] Processing ${dueSchedules.length} schedule(s)...`);
    const results   = await processSchedulesConcurrently(
      dueSchedules,
      useCustomDateRange ? customDateRange : null
    );
    const totalTime = Date.now() - startTime;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`📊 SCHEDULER COMPLETE in ${totalTime}ms`);
    console.log(`${'='.repeat(70)}`);
    console.log(`  Processed:           ${results.processed}`);
    console.log(`  Successful:          ${results.successful}`);
    console.log(`  Skipped (race-won):  ${results.skipped}`);
    console.log(`  Catchup Recovered:   ${results.catchup}`);
    console.log(`  Failed:              ${results.failed}`);

    const totalEmailsSent = results.details
      .filter(d => d.success && d.emailCount)
      .reduce((sum, d) => sum + d.emailCount, 0);

    console.log(`\n  📈 Performance Stats:`);
    console.log(`     Total processed:  ${performanceStats.totalProcessed}`);
    console.log(`     Emails sent:      ${performanceStats.emailsSent} (${totalEmailsSent} recipients)`);
    console.log(`     Emails failed:    ${performanceStats.emailsFailed}`);
    console.log(`     Skipped (lock):   ${performanceStats.skipped}`);
    console.log(`     Success rate:     ${performanceStats.totalProcessed > 0
      ? Math.round(performanceStats.successful / performanceStats.totalProcessed * 100)
      : 0}%`);
    console.log(`     Avg time:         ${Math.round(performanceStats.avgProcessingTime)}ms`);

    const rangesUsed = results.details
      .filter(d => d.dateRange)
      .map(d => {
        const shiftTag = d.dateRange.shiftType && d.dateRange.shiftType !== 'both' ? ` [${d.dateRange.shiftType}]` : '';
        return `${d.client}${shiftTag} [${d.dateRange.frequency}]: ${d.dateRange.period} → ${d.dateRange.startDate}→${d.dateRange.endDate} (${d.dateRange.nights} shifts)`;
      });
    if (rangesUsed.length > 0) {
      console.log(`\n  📅 Date ranges used:`);
      rangesUsed.forEach(r => console.log(`     • ${r}`));
    }

    if (results.failed > 0) {
      console.log(`\n  ⚠️  Errors:`);
      results.details.filter(d => !d.success && !d.skipped).slice(0, 5).forEach(err => {
        const shiftTag = err.shiftType && err.shiftType !== 'both' ? ` [${err.shiftType}]` : '';
        console.log(`     • ${err.isCatchup ? '[CATCHUP] ' : ''}${err.client}${shiftTag}: ${err.error}`);
      });
    }

    console.log(`${'='.repeat(70)}\n`);

    logToFile('SCHEDULER_COMPLETE', null, null, 'Scheduler run completed', {
      processed:      results.processed,
      successful:     results.successful,
      skipped:        results.skipped,
      catchup:        results.catchup,
      failed:         results.failed,
      totalEmailsSent,
      totalTime,
      timestamp:      now.format('YYYY-MM-DD HH:mm:ss'),
    });

    return {
      success:         true,
      results,
      timestamp:       now.format('YYYY-MM-DD HH:mm:ss'),
      totalTime,
      emailsSent:      performanceStats.emailsSent,
      totalEmailsSent,
      performance:     { ...performanceStats },
    };
  } catch (error) {
    console.error(`[SCHEDULER] Fatal error:`, error.message);
    logToFile('SCHEDULER_FATAL_ERROR', null, null, `Fatal error: ${error.message}`);
    return { success: false, error: error.message, timestamp: now.format('YYYY-MM-DD HH:mm:ss') };
  }
}

// =============================================
// CRON + MANUAL CONTROLS
// =============================================
let schedulerTask = null;

function initializeScheduler(intervalPattern = SCHEDULER_CONFIG.SCHEDULER_CHECK_INTERVAL) {
  try {
    if (schedulerTask) {
      schedulerTask.stop();
      console.log('🔄 Stopped previous scheduler instance');
    }

    console.log(`⏰ Initializing scheduler`);
    console.log(`📧 EMAIL SENDING: ${EMAIL_ENABLED ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
    console.log(`🔄 CATCHUP MODE: ${SCHEDULER_CONFIG.ENABLE_CATCHUP_MODE ? 'ENABLED ✅' : 'DISABLED'}`);
    console.log(`💾 DRIVE UPLOAD: ${SCHEDULER_CONFIG.ENABLE_DRIVE_UPLOAD ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
    console.log(`⏱️  EMAIL TIMEOUT: ${SCHEDULER_CONFIG.EMAIL_SEND_TIMEOUT / 1000}s`);
    console.log(`⏱️  PDF TIMEOUT: ${SCHEDULER_CONFIG.PDF_GENERATION_TIMEOUT / 1000}s`);
    console.log(`🔒 LOCK STRATEGY: Atomic SQL compare-and-swap (ALREADY_LOCKED → skip)`);
    console.log(`📅 1=Daily→yesterday | 2=Weekly→previousWeek | 3=TwiceWeek→last3days | 4=Monthly→last30days`);
    console.log(`📐 yesterday=1shift | last3days=today-2→today | last7days=today-6→today | last30days=today-29→today`);
    console.log(`🕒 Shift types: day / night / both — unique per (clientId, shiftType)`);
    console.log(`🚫 SCHEDULE:: FILTER: Active on all DB queries`);

    schedulerTask = cron.schedule(intervalPattern, async () => {
      try {
        console.log(`\n⏰ SCHEDULER TRIGGERED AT: ${dayjs().tz(TZ).format('HH:mm:ss')}`);
        await runDynamicReportScheduler();
      } catch (error) {
        console.error('❌ Scheduler execution error:', error.message);
      }
    }, { scheduled: true, timezone: TZ });

    schedulerTask.start();
    console.log('✅ Scheduler initialized and started');

    if (SCHEDULER_CONFIG.ENABLE_CATCHUP_MODE) {
      const delayMs = SCHEDULER_CONFIG.CATCHUP_STARTUP_DELAY_MS;
      console.log(`\n🕐 Startup catchup scheduled in ${delayMs / 1000}s...`);
      setTimeout(() => {
        console.log('\n🚀 Running startup catchup...');
        runCatchupMode().catch(err => { console.warn('Startup catchup failed:', err.message); });
      }, delayMs);
    }

    return schedulerTask;
  } catch (error) {
    console.error('❌ Failed to initialize scheduler:', error.message);
    throw error;
  }
}

async function triggerManualRun(customDateRange = null, enableCatchup = true) {
  console.log(`\n🚀 Triggering manual scheduler run...`);
  const options = customDateRange
    ? { useCustomDateRange: true, customDateRange, enableCatchup }
    : { enableCatchup };
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
    if (schedulerTask) schedulerTask.stop();
    schedulerTask = cron.schedule(newIntervalPattern, async () => {
      try {
        console.log(`\n⏰ SCHEDULER TRIGGERED AT: ${dayjs().tz(TZ).format('HH:mm:ss')}`);
        await runDynamicReportScheduler();
      } catch (error) {
        console.error('❌ Scheduler execution error:', error.message);
      }
    }, { scheduled: true, timezone: TZ });
    schedulerTask.start();
    console.log(`✅ Scheduler interval updated`);
    return schedulerTask;
  } catch (error) {
    console.error('❌ Failed to update scheduler interval:', error.message);
    throw error;
  }
}

function getSchedulerStatus() {
  const status = schedulerTask ? schedulerTask.getStatus() : 'not_initialized';
  return {
    running:       status === 'scheduled',
    status,
    timezone:      TZ,
    checkInterval: SCHEDULER_CONFIG.SCHEDULER_CHECK_INTERVAL,
    emailEnabled:  EMAIL_ENABLED,
    lockStrategy:  'Atomic SQL compare-and-swap (ALREADY_LOCKED → skip)',
    dateRangeStrategy: 'getDateRangeForSchedule → FREQUENCY_PERIOD_MAP → getDateRangeForPeriod (shift-aware)',
    scheduleConfigFilter: `Rows where rep_cmail LIKE '${SCHEDULE_PREFIX}%' are excluded from all email queries`,
    rollingWindowRules: {
      note:         'All rolling windows are INCLUSIVE — subtract(N-1) gives exactly N days',
      yesterday:    'start = today-1,  end = today-1  (1 completed shift)',
      last3days:    'start = today-2,  end = today    (3 days inclusive)',
      last7days:    'start = today-6,  end = today    (7 days inclusive)',
      last30days:   'start = today-29, end = today    (30 days inclusive)',
    },
    frequencyPeriodMapping: {
      1: { label: 'Daily',        period: 'yesterday',    nights: 1  },
      2: { label: 'Weekly',       period: 'previousWeek', nights: 7  },
      3: { label: 'Twice a Week', period: 'last3days',    nights: 3  },
      4: { label: 'Monthly',      period: 'last30days',   nights: 30 },
    },
    shiftTypeSupport: {
      enabled: true,
      values:  VALID_SHIFT_TYPES,
      bounds:  { day: '06:00-18:00', night: '18:00-06:00', both: 'legacy full window' },
      uniquenessKey: '(clientId, shiftType) — a client can have independent Day and Night schedules',
    },
    graceWindow: {
      pastMinutes:   SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES_PAST,
      futureMinutes: SCHEDULER_CONFIG.GRACE_PERIOD_MINUTES_FUTURE,
    },
    catchupMode: {
      enabled:        SCHEDULER_CONFIG.ENABLE_CATCHUP_MODE,
      maxMinutesBack: SCHEDULER_CONFIG.CATCHUP_MAX_MINUTES_BACK,
      startupDelayMs: SCHEDULER_CONFIG.CATCHUP_STARTUP_DELAY_MS,
    },
    timeouts: {
      emailTimeoutMs: SCHEDULER_CONFIG.EMAIL_SEND_TIMEOUT,
      pdfTimeoutMs:   SCHEDULER_CONFIG.PDF_GENERATION_TIMEOUT,
    },
    driveUpload: {
      enabled: SCHEDULER_CONFIG.ENABLE_DRIVE_UPLOAD,
    },
    performanceStats: { ...performanceStats },
  };
}

async function getPerformanceStats() {
  return { ...performanceStats };
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
  getPerformanceStats,
  getDueSchedules,
  processSchedule,
  getDateRangeForSchedule,
  updateNextRunTime,
  isValidEmail,
  normalizeEmailList,
  getValidatedEmailsFromSchedule,
  getEmailTransporter,
  normaliseShiftTypeLocal,
  VALID_SHIFT_TYPES,
  FREQUENCY_PERIOD_MAP,
  FREQUENCY_LABELS,
};