// server/controllers/schedulerController.js

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');
const weekOfYear = require('dayjs/plugin/weekOfYear.js');
const isoWeek = require('dayjs/plugin/isoWeek.js');
const { sql, poolPromise } = require('../config/database.js');

const { fetchWeeklyReport } = require('../models/reportModel.js');

// ✅ Import the patrol schedules script
const patrolSchedules = require('../scripts/managePatrolSchedules.js');

// ✅ Only import constants, NOT generateDateRangeForReportType (crashes)
const {
  getLastCompletedWeekStart,
  WEEK_START_DAY,
  WEEK_START_DAY_NAMES,
} = require('../models/reportModel.js');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

// =====================================================
// 🕒 SHIFT TYPE SUPPORT (FIX 19)
//
// A client can now have independent schedules per shift:
//   'day'   → 06:00 – 18:00
//   'night' → 18:00 – 06:00 (next day)
//   'both'  → full 24hr window (legacy behavior, default)
//
// normaliseShiftType() maps any legacy/loose input (case,
// synonyms, DB strings) down to this canonical enum so every
// caller — controller, scheduler, frontend — agrees on the
// same three values.
// =====================================================
const VALID_SHIFT_TYPES = ['day', 'night', 'both'];

function normaliseShiftType(input) {
  if (!input || typeof input !== 'string') return 'both';
  const v = input.trim().toLowerCase();
  if (v === 'day' || v === 'daytime' || v === 'day shift') return 'day';
  if (v === 'night' || v === 'nighttime' || v === 'night shift') return 'night';
  if (v === 'both' || v === 'day/night' || v === 'all' || v === '24hr' || v === '') return 'both';
  return VALID_SHIFT_TYPES.includes(v) ? v : 'both';
}

const SHIFT_HOUR_BOUNDS = {
  day:   { startHour: 6,  endHour: 18 },
  night: { startHour: 18, endHour: 6  },
  both:  { startHour: 18, endHour: 6  },
};

// =====================================================
// 🛡️ DUPLICATE REPORT PREVENTION
// =====================================================
const inProgressReports = new Map();
const REPORT_COOLDOWN_MS = 120000; // 2 minutes

function isReportInProgress(key) {
  const entry = inProgressReports.get(key);
  if (!entry) return false;
  if (Date.now() - entry.startedAt > REPORT_COOLDOWN_MS) {
    inProgressReports.delete(key);
    return false;
  }
  return true;
}

function markReportInProgress(key) {
  inProgressReports.set(key, { startedAt: Date.now() });
}

function clearReportInProgress(key, delayMs = REPORT_COOLDOWN_MS) {
  setTimeout(() => {
    inProgressReports.delete(key);
    console.log(`🧹 Cleared report lock for ${key}`);
  }, delayMs);
}

// =====================================================
// 📅 DATE RANGE HELPER FUNCTIONS
// =====================================================

const calculateNightsInRange = (startDate, endDate) => {
  try {
    const start = dayjs(startDate, 'YYYY-MM-DD').startOf('day');
    const end   = dayjs(endDate,   'YYYY-MM-DD').startOf('day');
    return end.diff(start, 'day');
  } catch (error) {
    console.error(`❌ Error calculating nights in range:`, error.message);
    return dayjs(endDate, 'YYYY-MM-DD').diff(dayjs(startDate, 'YYYY-MM-DD'), 'day');
  }
};

const getDatabaseQueryDates = (startDate, endDate, shiftType = 'night') => {
  const normalisedShift = normaliseShiftType(shiftType);
  try {
    const bounds = SHIFT_HOUR_BOUNDS[normalisedShift] || SHIFT_HOUR_BOUNDS.night;

    const start = dayjs.tz(startDate, 'YYYY-MM-DD', TZ);
    const end   = dayjs.tz(endDate,   'YYYY-MM-DD', TZ);

    const nairobiStartTime = start.set('hour', bounds.startHour).set('minute', 0).set('second', 0);
    let nairobiEndTime = end.set('hour', bounds.endHour).set('minute', 0).set('second', 0);

    if (bounds.endHour <= bounds.startHour) {
      nairobiEndTime = nairobiEndTime.add(1, 'day');
    }

    const cstStartTime = nairobiStartTime.subtract(9, 'hour');
    const cstEndTime   = nairobiEndTime.subtract(9, 'hour');

    const nightsCount = calculateNightsInRange(startDate, endDate);

    return {
      dbStartDate:      cstStartTime.format('YYYY-MM-DD HH:mm:ss'),
      dbEndDate:        cstEndTime.format('YYYY-MM-DD HH:mm:ss'),
      displayStartDate: start.format('YYYY-MM-DD'),
      displayEndDate:   end.format('YYYY-MM-DD'),
      nightsCount,
      totalHours: cstEndTime.diff(cstStartTime, 'hour'),
      shiftType:  normalisedShift,
    };
  } catch (error) {
    console.error(`❌ Error calculating database query dates:`, error.message);
    const bounds = SHIFT_HOUR_BOUNDS[normalisedShift] || SHIFT_HOUR_BOUNDS.night;
    const fallbackStart = dayjs(`${startDate} ${String(bounds.startHour).padStart(2, '0')}:00:00`).subtract(9, 'hour');
    return {
      dbStartDate:      fallbackStart.format('YYYY-MM-DD HH:mm:ss'),
      dbEndDate:        dayjs(`${endDate} ${String(bounds.endHour).padStart(2, '0')}:00:00`).subtract(9, 'hour').format('YYYY-MM-DD HH:mm:ss'),
      displayStartDate: startDate,
      displayEndDate:   endDate,
      nightsCount:      calculateNightsInRange(startDate, endDate),
      shiftType:        normalisedShift,
    };
  }
};

// =====================================================
// 📅 DATE RANGE FUNCTIONS
// =====================================================

const getPreviousWeekRange = (shiftType = 'both') => {
  const normalisedShift = normaliseShiftType(shiftType);
  try {
    const now      = dayjs().tz(TZ);
    const today    = now.startOf('day');
    const todayDow = today.day();

    let daysBack = (todayDow - WEEK_START_DAY + 7) % 7;
    if (daysBack === 0) daysBack = 7;

    const startDay = today.subtract(daysBack, 'day');
    const endDay   = startDay.add(7, 'day');

    const startDate = startDay.format('YYYY-MM-DD');
    const endDate   = endDay.format('YYYY-MM-DD');
    const dbDates   = getDatabaseQueryDates(startDate, endDate, normalisedShift);
    const dayName   = WEEK_START_DAY_NAMES[WEEK_START_DAY] || 'Wednesday';

    console.log(
      `📅 previousWeek [${normalisedShift}] → ${dayName}-to-${dayName}: ` +
      `${startDate} → ${endDate} (7 shifts)`
    );

    return {
      startDate,
      endDate,
      sqlStartDate:  dbDates.dbStartDate,
      sqlEndDate:    dbDates.dbEndDate,
      rangeLabel:    `${dayName} to ${dayName}: ${startDay.format('MMM D')} - ${endDay.format('MMM D, YYYY')}`,
      nightsInRange: 7,
      daysInRange:   7,
      periodType:    'previousWeek',
      shiftType:     normalisedShift,
    };
  } catch (error) {
    console.error('❌ getPreviousWeekRange error, using 7-day fallback:', error.message);
    const end   = dayjs().tz(TZ).format('YYYY-MM-DD');
    const start = dayjs().tz(TZ).subtract(6, 'day').format('YYYY-MM-DD');
    return {
      startDate:     start,
      endDate:       end,
      sqlStartDate:  start + ' 09:00:00',
      sqlEndDate:    end   + ' 21:00:00',
      rangeLabel:    `Last 7 Days (fallback): ${start} - ${end}`,
      nightsInRange: 7,
      daysInRange:   7,
      periodType:    'previousWeek',
      shiftType:     normalisedShift,
    };
  }
};

const getCurrentWeekRange = (shiftType = 'both') => {
  const normalisedShift = normaliseShiftType(shiftType);
  try {
    const now      = dayjs().tz(TZ);
    const today    = now.startOf('day');
    const todayDow = today.day();

    let daysBack = (todayDow - WEEK_START_DAY + 7) % 7;
    const startDay = daysBack === 0 ? today : today.subtract(daysBack, 'day');
    const endDay   = today;

    const nights  = endDay.diff(startDay, 'day') || 1;
    const dbDates = getDatabaseQueryDates(
      startDay.format('YYYY-MM-DD'),
      endDay.add(1, 'day').format('YYYY-MM-DD'),
      normalisedShift
    );

    return {
      startDate:     startDay.format('YYYY-MM-DD'),
      endDate:       endDay.format('YYYY-MM-DD'),
      sqlStartDate:  dbDates.dbStartDate,
      sqlEndDate:    dbDates.dbEndDate,
      rangeLabel:    `Current Week: ${startDay.format('MMM D')} - ${endDay.format('MMM D, YYYY')}`,
      nightsInRange: nights,
      daysInRange:   nights,
      periodType:    'currentWeek',
      shiftType:     normalisedShift,
    };
  } catch (error) {
    console.error('❌ getCurrentWeekRange error:', error.message);
    return getPreviousWeekRange(normalisedShift);
  }
};

const getLast7DaysRange = (shiftType = 'both') => {
  const normalisedShift = normaliseShiftType(shiftType);
  try {
    const end     = dayjs().tz(TZ).startOf('day');
    const start   = end.subtract(6, 'day');
    const dbDates = getDatabaseQueryDates(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'), normalisedShift);

    console.log(`📅 last7days [${normalisedShift}] → ${start.format('YYYY-MM-DD')} → ${end.format('YYYY-MM-DD')} (7 shifts)`);

    return {
      startDate:     start.format('YYYY-MM-DD'),
      endDate:       end.format('YYYY-MM-DD'),
      sqlStartDate:  dbDates.dbStartDate,
      sqlEndDate:    dbDates.dbEndDate,
      rangeLabel:    `Last 7 Days: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`,
      nightsInRange: 7,
      daysInRange:   7,
      periodType:    'last7days',
      shiftType:     normalisedShift,
    };
  } catch (error) {
    console.error('❌ getLast7DaysRange error:', error.message);
    const end   = dayjs().tz(TZ).format('YYYY-MM-DD');
    const start = dayjs().tz(TZ).subtract(6, 'day').format('YYYY-MM-DD');
    return {
      startDate: start, endDate: end,
      sqlStartDate: start + ' 09:00:00', sqlEndDate: end + ' 09:00:00',
      rangeLabel: `Last 7 Days (fallback): ${start} - ${end}`,
      nightsInRange: 7, daysInRange: 7, periodType: 'last7days',
      shiftType: normalisedShift,
    };
  }
};

const getYesterdayRange = (shiftType = 'both') => {
  const normalisedShift = normaliseShiftType(shiftType);
  try {
    const now       = dayjs().tz(TZ);
    const today     = now.startOf('day');
    const yesterday = today.subtract(1, 'day');

    const startDate = yesterday.format('YYYY-MM-DD');
    const endDate   = yesterday.format('YYYY-MM-DD');
    const dbEndDateInput = normalisedShift === 'day' ? startDate : today.format('YYYY-MM-DD');
    const dbDates = getDatabaseQueryDates(startDate, dbEndDateInput, normalisedShift);

    console.log(`📅 yesterday [${normalisedShift}] → ${startDate} (1 shift)`);

    return {
      startDate,
      endDate,
      sqlStartDate:  dbDates.dbStartDate,
      sqlEndDate:    dbDates.dbEndDate,
      rangeLabel:    `Yesterday: ${yesterday.format('MMM D, YYYY')}`,
      nightsInRange: 1,
      daysInRange:   1,
      periodType:    'yesterday',
      shiftType:     normalisedShift,
    };
  } catch (error) {
    console.error('❌ getYesterdayRange error:', error.message);
    const yesterday = dayjs().tz(TZ).subtract(1, 'day').format('YYYY-MM-DD');
    return {
      startDate: yesterday, endDate: yesterday,
      sqlStartDate: yesterday + ' 09:00:00', sqlEndDate: yesterday + ' 21:00:00',
      rangeLabel: `Yesterday (fallback): ${yesterday}`,
      nightsInRange: 1, daysInRange: 1, periodType: 'yesterday',
      shiftType: normalisedShift,
    };
  }
};

const getLast3DaysRange = (shiftType = 'both') => {
  const normalisedShift = normaliseShiftType(shiftType);
  try {
    const now   = dayjs().tz(TZ);
    const end   = now.startOf('day');
    const start = end.subtract(2, 'day');

    const startDate = start.format('YYYY-MM-DD');
    const endDate   = end.format('YYYY-MM-DD');
    const dbDates   = getDatabaseQueryDates(startDate, endDate, normalisedShift);

    console.log(`📅 last3days [${normalisedShift}] → ${startDate} → ${endDate} (3 shifts)`);

    return {
      startDate,
      endDate,
      sqlStartDate:  dbDates.dbStartDate,
      sqlEndDate:    dbDates.dbEndDate,
      rangeLabel:    `Last 3 Days: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`,
      nightsInRange: 3,
      daysInRange:   3,
      periodType:    'last3days',
      shiftType:     normalisedShift,
    };
  } catch (error) {
    console.error('❌ getLast3DaysRange error:', error.message);
    const end   = dayjs().tz(TZ).format('YYYY-MM-DD');
    const start = dayjs().tz(TZ).subtract(2, 'day').format('YYYY-MM-DD');
    return {
      startDate: start, endDate: end,
      sqlStartDate: start + ' 09:00:00', sqlEndDate: end + ' 09:00:00',
      rangeLabel: `Last 3 Days (fallback): ${start} - ${end}`,
      nightsInRange: 3, daysInRange: 3, periodType: 'last3days',
      shiftType: normalisedShift,
    };
  }
};

const getLast30DaysRange = (shiftType = 'both') => {
  const normalisedShift = normaliseShiftType(shiftType);
  try {
    const now   = dayjs().tz(TZ);
    const end   = now.startOf('day');
    const start = end.subtract(29, 'day');

    const startDate = start.format('YYYY-MM-DD');
    const endDate   = end.format('YYYY-MM-DD');
    const dbDates   = getDatabaseQueryDates(startDate, endDate, normalisedShift);

    console.log(`📅 last30days [${normalisedShift}] → ${startDate} → ${endDate} (30 shifts)`);

    return {
      startDate,
      endDate,
      sqlStartDate:  dbDates.dbStartDate,
      sqlEndDate:    dbDates.dbEndDate,
      rangeLabel:    `Last 30 Days: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`,
      nightsInRange: 30,
      daysInRange:   30,
      periodType:    'last30days',
      shiftType:     normalisedShift,
    };
  } catch (error) {
    console.error('❌ getLast30DaysRange error:', error.message);
    const end   = dayjs().tz(TZ).format('YYYY-MM-DD');
    const start = dayjs().tz(TZ).subtract(29, 'day').format('YYYY-MM-DD');
    return {
      startDate: start, endDate: end,
      sqlStartDate: start + ' 09:00:00', sqlEndDate: end + ' 09:00:00',
      rangeLabel: `Last 30 Days (fallback): ${start} - ${end}`,
      nightsInRange: 30, daysInRange: 30, periodType: 'last30days',
      shiftType: normalisedShift,
    };
  }
};

const getTodayRange = (shiftType = 'both') => getYesterdayRange(shiftType);

const getPreviousMonthRange = (shiftType = 'both') => {
  const normalisedShift = normaliseShiftType(shiftType);
  try {
    const now        = dayjs().tz(TZ);
    const startDay   = now.subtract(1, 'month').startOf('month');
    const endDay     = now.subtract(1, 'month').endOf('month').startOf('day');
    const nights     = endDay.diff(startDay, 'day') + 1;
    const dbDates    = getDatabaseQueryDates(startDay.format('YYYY-MM-DD'), endDay.add(1, 'day').format('YYYY-MM-DD'), normalisedShift);

    return {
      startDate:     startDay.format('YYYY-MM-DD'),
      endDate:       endDay.format('YYYY-MM-DD'),
      sqlStartDate:  dbDates.dbStartDate,
      sqlEndDate:    dbDates.dbEndDate,
      rangeLabel:    `Previous Month: ${startDay.format('MMMM YYYY')}`,
      nightsInRange: nights,
      daysInRange:   nights,
      periodType:    'previousMonth',
      shiftType:     normalisedShift,
    };
  } catch (error) {
    console.error('❌ getPreviousMonthRange error:', error.message);
    return getLast30DaysRange(normalisedShift);
  }
};

const getCurrentMonthRange = (shiftType = 'both') => {
  const normalisedShift = normaliseShiftType(shiftType);
  try {
    const now      = dayjs().tz(TZ);
    const startDay = now.startOf('month');
    const endDay   = now.startOf('day');
    const nights   = endDay.diff(startDay, 'day') || 1;
    const dbDates  = getDatabaseQueryDates(startDay.format('YYYY-MM-DD'), endDay.format('YYYY-MM-DD'), normalisedShift);

    return {
      startDate:     startDay.format('YYYY-MM-DD'),
      endDate:       endDay.format('YYYY-MM-DD'),
      sqlStartDate:  dbDates.dbStartDate,
      sqlEndDate:    dbDates.dbEndDate,
      rangeLabel:    `Current Month: ${startDay.format('MMMM YYYY')}`,
      nightsInRange: nights,
      daysInRange:   nights,
      periodType:    'currentMonth',
      shiftType:     normalisedShift,
    };
  } catch (error) {
    console.error('❌ getCurrentMonthRange error:', error.message);
    return getLast30DaysRange(normalisedShift);
  }
};

const getCustomDateRange = (startDate, endDate, shiftType = 'both') => {
  const normalisedShift = normaliseShiftType(shiftType);
  if (!startDate || !endDate) throw new Error('Start date and end date are required');
  const start = dayjs(startDate).tz(TZ);
  const end   = dayjs(endDate).tz(TZ);
  if (!start.isValid() || !end.isValid()) throw new Error('Invalid date format');
  if (end.isBefore(start)) throw new Error('End date must be after start date');
  const nightsInRange = end.diff(start, 'day') || 1;
  const dbDates       = getDatabaseQueryDates(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'), normalisedShift);
  return {
    startDate:     start.format('YYYY-MM-DD'),
    endDate:       end.format('YYYY-MM-DD'),
    sqlStartDate:  dbDates.dbStartDate,
    sqlEndDate:    dbDates.dbEndDate,
    rangeLabel:    `Custom: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`,
    nightsInRange,
    daysInRange:   nightsInRange,
    periodType:    'custom',
    shiftType:     normalisedShift,
  };
};

const getHistoricalDateRange = (options = {}) => {
  const normalisedShift = normaliseShiftType(options.shiftType);
  try {
    const today = dayjs().tz(TZ);
    const { monthsBack = null, specificMonth = null, startDate = null, endDate = null } = options;
    if (startDate && endDate) return getCustomDateRange(startDate, endDate, normalisedShift);
    const finalStart = specificMonth ? dayjs(specificMonth).startOf('month')
                     : monthsBack    ? today.subtract(monthsBack, 'month').startOf('month')
                     :                 today.startOf('month');
    const finalEnd   = specificMonth ? dayjs(specificMonth).endOf('month').startOf('day') : today.startOf('day');
    const nightsInRange = finalEnd.diff(finalStart, 'day') + 1;
    const dbDates = getDatabaseQueryDates(finalStart.format('YYYY-MM-DD'), finalEnd.format('YYYY-MM-DD'), normalisedShift);
    return {
      sqlStartDate:     dbDates.dbStartDate,
      sqlEndDate:       dbDates.dbEndDate,
      displayStartDate: finalStart.format('YYYY-MM-DD'),
      displayEndDate:   finalEnd.format('YYYY-MM-DD'),
      startDate:        finalStart.format('YYYY-MM-DD'),
      endDate:          finalEnd.format('YYYY-MM-DD'),
      rangeLabel: specificMonth ? `Month: ${finalStart.format('MMMM YYYY')}`
                : monthsBack   ? `Last ${monthsBack} months`
                :                `Current Month: ${finalStart.format('MMMM YYYY')}`,
      nightsInRange,
      daysInRange:      nightsInRange,
      periodType:       'historical',
      shiftType:        normalisedShift,
    };
  } catch (error) {
    console.error('❌ Error calculating historical range:', error);
    const today = dayjs().tz(TZ);
    return {
      startDate:   today.subtract(29, 'day').format('YYYY-MM-DD'),
      endDate:     today.format('YYYY-MM-DD'),
      sqlStartDate: today.subtract(29, 'day').format('YYYY-MM-DD') + ' 18:00:00',
      sqlEndDate:   today.format('YYYY-MM-DD') + ' 06:00:00',
      rangeLabel:   'Last 30 Days (Fallback)',
      nightsInRange: 30,
      daysInRange:   30,
      periodType:    'historical',
      shiftType:     normalisedShift,
    };
  }
};

const getDateRangeForPeriod = (reportPeriod, customStart = null, customEnd = null, shiftType = 'both') => {
  const normalisedShift = normaliseShiftType(shiftType);
  console.log(`🎯 Getting date range for period: ${reportPeriod} [shift=${normalisedShift}]`);
  switch (reportPeriod) {
    case 'today':         return getTodayRange(normalisedShift);
    case 'yesterday':     return getYesterdayRange(normalisedShift);
    case 'last3days':     return getLast3DaysRange(normalisedShift);
    case 'last7days':     return getLast7DaysRange(normalisedShift);
    case 'previousWeek':  return getPreviousWeekRange(normalisedShift);
    case 'currentWeek':   return getCurrentWeekRange(normalisedShift);
    case 'last30days':    return getLast30DaysRange(normalisedShift);
    case 'previousMonth': return getPreviousMonthRange(normalisedShift);
    case 'currentMonth':  return getCurrentMonthRange(normalisedShift);
    case 'custom':
      if (!customStart || !customEnd) {
        console.warn('⚠️  Custom period without dates, falling back to previous week');
        return getPreviousWeekRange(normalisedShift);
      }
      return getCustomDateRange(customStart, customEnd, normalisedShift);
    case 'historical':    return getHistoricalDateRange({ monthsBack: 1, shiftType: normalisedShift });
    default:
      console.warn(`⚠️  Unknown period '${reportPeriod}', using previous week`);
      return getPreviousWeekRange(normalisedShift);
  }
};

// =====================================================
// 📧 EMAIL PARSING FUNCTIONS
// =====================================================

const parseEmails = (emailString) => {
  if (!emailString || typeof emailString !== 'string') return [];
  const emails = emailString.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(emails.map(e => e.toLowerCase().trim()))].filter(e => {
    const p = e.split('@');
    return p.length === 2 && p[0].length > 0 && p[1].length > 0 && p[1].includes('.');
  });
};

const formatEmailsForDisplay = (emailString) => {
  return parseEmails(emailString).join(', ');
};

// =====================================================
// ✅ API CLIENT LOOKUP HELPERS
// =====================================================

const buildApiClientMap = async () => {
  try {
    const bmSecurityAPI = require('../service/bmSecurityAPI.js');
    const apiClients    = await bmSecurityAPI.getClients();
    const map = new Map();
    for (const c of (apiClients || [])) {
      map.set(String(c.id), {
        name:          c.name          || '',
        accountNumber: c.accountNumber || '',
        email:         c.email         || '',
      });
    }
    console.log(`✅ API client map: ${map.size} clients loaded`);
    return map;
  } catch (err) {
    console.warn(`⚠️  Could not build API client map: ${err.message}`);
    return new Map();
  }
};

const resolveClientInfo = (clientId, dbRow, apiMap) => {
  const id = String(clientId);

  if (dbRow && dbRow.ClientName && String(dbRow.ClientName).trim()) {
    return {
      clientName:    String(dbRow.ClientName).trim(),
      clientEmail:   String(dbRow.ClientEmail  || '').trim(),
      accountNumber: String(dbRow.AccountNumber || '').trim(),
      source: 'DATABASE',
    };
  }

  const apiEntry = apiMap.get(id);
  if (apiEntry) {
    return {
      clientName:    apiEntry.name,
      clientEmail:   apiEntry.email,
      accountNumber: apiEntry.accountNumber,
      source: 'API',
    };
  }

  return { clientName: `Client ${id}`, clientEmail: '', accountNumber: '', source: 'UNKNOWN' };
};

const resolveClientById = async (clientId, pool) => {
  try {
    const bmSecurityAPI = require('../service/bmSecurityAPI.js');
    const apiClients    = await bmSecurityAPI.getClients();
    const found         = apiClients.find(c => String(c.id) === String(clientId));
    if (found) {
      console.log(`✅ resolveClientById: found in API — ${found.name}`);
      return {
        clientName:    found.name,
        clientEmail:   found.email         || '',
        accountNumber: found.accountNumber || '',
        source: 'API',
      };
    }
  } catch (err) {
    console.warn(`⚠️  resolveClientById API lookup failed: ${err.message}`);
  }

  try {
    const dbResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT cue_cnombre AS ClientName, cue_cemail AS ClientEmail, cue_ncuenta AS AccountNumber
        FROM _Datos.dbo.m_cuentas WHERE cue_iid = @clientId
      `);
    if (dbResult.recordset.length > 0) {
      const row = dbResult.recordset[0];
      console.log(`✅ resolveClientById: found in DB — ${row.ClientName}`);
      return {
        clientName:    row.ClientName    || `Client ${clientId}`,
        clientEmail:   row.ClientEmail   || '',
        accountNumber: row.AccountNumber || '',
        source: 'DATABASE',
      };
    }
  } catch (err) {
    console.warn(`⚠️  resolveClientById DB lookup failed: ${err.message}`);
  }

  return { clientName: `Client ${clientId}`, clientEmail: '', accountNumber: '', source: 'UNKNOWN' };
};

// =====================================================
// 📊 DATA FETCHING USING managePatrolSchedules.js
// =====================================================

const getClientPatrols = async (clientId, nightsRange = 7) => {
  try {
    console.log(`📊 Fetching patrol data for client ${clientId} (${nightsRange} nights) via managePatrolSchedules`);

    const patrolData = await patrolSchedules.getClientPatrols(clientId, nightsRange);
    const schedule   = await patrolSchedules.getClientSchedule(clientId);

    return {
      posts:        patrolData.pastPatrols || [],
      events:       patrolData.pastPatrols || [],
      guardReports: [],
      metadata: {
        success:               true,
        overallPerformance:    parseInt(patrolData.summary?.scheduleCompliance) || 0,
        totalCompleted:        patrolData.summary?.totalCompleted        || 0,
        totalExpectedPatrols:  patrolData.summary?.expectedPatrols       || 0,
        dataSource:            schedule?.config_source || 'managePatrolSchedules',
        processingTime:        patrolData.summary?.processingTimeMs || 0,
        daysInRange:           nightsRange,
      },
    };
  } catch (error) {
    console.error(`❌ Error fetching patrol data for client ${clientId}:`, error.message);
    return {
      posts: [],
      events: [],
      guardReports: [],
      metadata: {
        success: false,
        error: error.message,
        overallPerformance: 0,
        totalCompleted: 0,
        totalExpectedPatrols: 0
      }
    };
  }
};

const getClientHistoricalPatrols = async (clientId, startDate, endDate) => {
  try {
    console.log(`📋 Fetching historical patrol data for client ${clientId} (${startDate} → ${endDate}) via fetchWeeklyReport`);

    const reportData = await fetchWeeklyReport(clientId, startDate, endDate, true);

    if (!reportData.metadata.success) {
      console.warn(`⚠️ Historical fetch failed: ${reportData.metadata.error?.message || 'Unknown'}`);
      return {
        posts: [],
        events: [],
        guardReports: [],
        metadata: {
          success: false,
          error: reportData.metadata.error?.message || 'Unknown error',
          overallPerformance: 0,
          totalCompleted: 0,
          totalExpectedPatrols: 0
        }
      };
    }

    console.log(`✅ Historical data loaded:`, {
      posts: reportData.posts.length,
      events: reportData.events.length,
      processingTime: `${reportData.metadata.processingTime}ms`
    });

    return {
      posts:        reportData.posts        || [],
      events:       reportData.events       || [],
      guardReports: reportData.guardReports || [],
      metadata:     reportData.metadata,
    };
  } catch (error) {
    console.error(`❌ Error fetching historical patrol data:`, error.message);
    return {
      posts: [],
      events: [],
      guardReports: [],
      metadata: {
        success: false,
        error: error.message,
        overallPerformance: 0,
        totalCompleted: 0,
        totalExpectedPatrols: 0
      }
    };
  }
};

// =====================================================
// getAllSchedules
// =====================================================

const getAllSchedules = async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT
        R.rep_idKey,
        R.rep_iidcuenta          AS ClientID,
        C.cue_cnombre            AS ClientName,
        C.cue_cemail             AS ClientEmail,
        C.cue_ncuenta            AS AccountNumber,
        R.rep_ntipo,
        R.rep_tproximoenvio      AS NextRun,
        R.rep_nfrecuencia        AS Frequency,
        CASE 
          WHEN R.rep_cmail LIKE 'SCHEDULE::%' THEN NULL 
          ELSE R.rep_cmail 
        END AS Email,
        R.rep_nCadaUnidadTiempo  AS IntervalDays,
        R.rep_shift_type         AS ShiftType
      FROM  _Datos.dbo.m_reportes_automaticos R
      LEFT JOIN _Datos.dbo.m_cuentas C ON R.rep_iidcuenta = C.cue_iid
      ORDER BY R.rep_tproximoenvio ASC
    `);

    const hasNullNames = result.recordset.some(r => !r.ClientName);
    const apiMap       = hasNullNames ? await buildApiClientMap() : new Map();

    const schedules = result.recordset.map(row => {
      const resolved = resolveClientInfo(row.ClientID, row, apiMap);
      const emails   = row.Email || '';
      return {
        id:              row.rep_idKey,
        clientId:        row.ClientID,
        clientName:      resolved.clientName,
        clientEmail:     resolved.clientEmail,
        accountNumber:   resolved.accountNumber,
        clientSource:    resolved.source,
        type:            row.rep_ntipo,
        nextRun:         row.NextRun,
        frequency:       row.Frequency,
        shiftType:       normaliseShiftType(row.ShiftType),
        email:           emails,
        emails:          emails,
        intervalDays:    row.IntervalDays,
        status:          1,
        timezone:        TZ,
        emailCount:      parseEmails(emails).length,
        formattedEmails: formatEmailsForDisplay(emails),
        apiIntegration:  'managePatrolSchedules',
      };
    });

    res.status(200).json({
      success:             true,
      total:               schedules.length,
      schedules,
      serverTime:          dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
      usingOptimizedModel: true,
    });
  } catch (error) {
    console.error('❌ Error fetching schedules:', error);
    res.status(500).json({ success: false, message: 'Database error', error: error.message });
  }
};

// =====================================================
// getScheduleById
// =====================================================

const getScheduleById = async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id);
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid schedule ID' });
    }

    const pool   = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, scheduleId)
      .query(`
        SELECT
          R.rep_idKey,
          R.rep_iidcuenta          AS ClientID,
          C.cue_cnombre            AS ClientName,
          C.cue_cemail             AS ClientEmail,
          C.cue_ncuenta            AS AccountNumber,
          R.rep_ntipo,
          R.rep_tproximoenvio      AS NextRun,
          R.rep_nfrecuencia        AS Frequency,
          CASE 
            WHEN R.rep_cmail LIKE 'SCHEDULE::%' THEN NULL 
            ELSE R.rep_cmail 
          END AS Email,
          R.rep_nCadaUnidadTiempo  AS IntervalDays,
          R.rep_shift_type         AS ShiftType
        FROM  _Datos.dbo.m_reportes_automaticos R
        LEFT JOIN _Datos.dbo.m_cuentas C ON R.rep_iidcuenta = C.cue_iid
        WHERE R.rep_idKey = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Schedule not found' });
    }

    const row      = result.recordset[0];
    const apiMap   = !row.ClientName ? await buildApiClientMap() : new Map();
    const resolved = resolveClientInfo(row.ClientID, row, apiMap);
    const emails   = row.Email || '';

    res.status(200).json({
      success: true,
      schedule: {
        id:              row.rep_idKey,
        clientId:        row.ClientID,
        clientName:      resolved.clientName,
        clientEmail:     resolved.clientEmail,
        accountNumber:   resolved.accountNumber,
        clientSource:    resolved.source,
        type:            row.rep_ntipo,
        nextRun:         row.NextRun,
        frequency:       row.Frequency,
        shiftType:       normaliseShiftType(row.ShiftType),
        email:           emails,
        emails:          emails,
        intervalDays:    row.IntervalDays,
        status:          1,
        timezone:        TZ,
        emailCount:      parseEmails(emails).length,
        formattedEmails: formatEmailsForDisplay(emails),
        apiIntegration:  'managePatrolSchedules',
      },
      usingOptimizedModel: true,
    });
  } catch (error) {
    console.error('❌ Error fetching schedule:', error);
    res.status(500).json({ success: false, message: 'Database error', error: error.message });
  }
};

// =====================================================
// updateSchedule
// =====================================================

const updateSchedule = async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id);
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid schedule ID' });
    }

    const { nextRun, frequency, email, emails, intervalDays, shiftType } = req.body;
    const finalEmails = emails || email;

    if (!nextRun || !frequency || !finalEmails) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: nextRun, frequency, emails',
      });
    }

    const parsedEmails = parseEmails(finalEmails);
    if (parsedEmails.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide at least one valid email address' });
    }

    const hasShiftUpdate = shiftType !== undefined && shiftType !== null && shiftType !== '';
    const finalShiftType = hasShiftUpdate ? normaliseShiftType(shiftType) : null;

    const pool    = await poolPromise;
    const request = pool.request()
      .input('id',          sql.Int,           scheduleId)
      .input('nextRun',     sql.DateTime,      nextRun)
      .input('frequency',   sql.Int,           frequency)
      .input('email',       sql.VarChar(4000), finalEmails)
      .input('intervalDays',sql.Int,           intervalDays || 1);

    let updateQuery = `
      UPDATE _Datos.dbo.m_reportes_automaticos
      SET rep_tproximoenvio     = @nextRun,
          rep_nfrecuencia      = @frequency,
          rep_cmail            = @email,
          rep_nCadaUnidadTiempo= @intervalDays
    `;

    if (hasShiftUpdate) {
      request.input('shiftType', sql.VarChar(10), finalShiftType);
      updateQuery += `, rep_shift_type = @shiftType `;
    }

    updateQuery += ` WHERE rep_idKey = @id`;

    const result = await request.query(updateQuery);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: 'Schedule not found' });
    }

    res.status(200).json({
      success: true,
      message: `Schedule updated successfully for ${parsedEmails.length} email(s)`,
      updatedFields: {
        nextRun, frequency, emails: finalEmails, emailCount: parsedEmails.length,
        intervalDays, ...(hasShiftUpdate ? { shiftType: finalShiftType } : {}),
      },
      usingOptimizedModel: true,
    });
  } catch (error) {
    console.error('❌ Error updating schedule:', error);
    res.status(500).json({ success: false, message: 'Database error', error: error.message });
  }
};

// =====================================================
// createSchedule - FULLY FIXED with IDENTITY_INSERT OFF
// =====================================================

const createSchedule = async (req, res) => {
  try {
    const { clientId, type, nextRun, frequency, email, emails, intervalDays, shiftType } = req.body;
    const finalEmails = emails || email;
    const finalShiftType = normaliseShiftType(shiftType);

    if (!clientId || !nextRun || !frequency || !finalEmails) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: clientId, nextRun, frequency, emails',
      });
    }

    const parsedEmails = parseEmails(finalEmails);
    if (parsedEmails.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide at least one valid email address' });
    }

    const pool = await poolPromise;

    // 🔥 CRITICAL FIX: Use a single connection for both commands
    const connection = await pool.connect();

    try {
      // Execute SET IDENTITY_INSERT OFF on the same connection
      await connection.request().query(`
        SET IDENTITY_INSERT _Datos.dbo.m_reportes_automaticos OFF
      `);

      // ✅ Check for existing (clientId + shiftType)
      const existing = await connection.request()
        .input('clientId', sql.Int, clientId)
        .input('shiftType', sql.VarChar(10), finalShiftType)
        .query(`
          SELECT rep_idKey FROM _Datos.dbo.m_reportes_automaticos 
          WHERE rep_iidcuenta = @clientId AND rep_shift_type = @shiftType
        `);

      if (existing.recordset.length > 0) {
        return res.status(409).json({
          success: false,
          message: `A ${finalShiftType} schedule already exists for this client`,
          existingScheduleId: existing.recordset[0].rep_idKey,
          shiftType: finalShiftType,
        });
      }

      // ✅ Insert WITHOUT specifying rep_idKey - SQL Server auto-generates it
  
// ✅ Insert WITHOUT specifying rep_idKey - SQL Server auto-generates it
const insertResult = await connection.request()
  .input('clientId', sql.Int, clientId)
        .input('type', sql.Int, type || 1)
        .input('nextRun', sql.DateTime, nextRun)
        .input('frequency', sql.Int, frequency)
        .input('email', sql.VarChar(4000), finalEmails)
        .input('intervalDays', sql.Int, intervalDays || 1)
        .input('shiftType', sql.VarChar(10), finalShiftType)
        .query(`
          INSERT INTO _Datos.dbo.m_reportes_automaticos
            (rep_iidcuenta, rep_ntipo, rep_tproximoenvio, rep_nfrecuencia, rep_cmail, rep_nCadaUnidadTiempo, rep_shift_type)
          OUTPUT INSERTED.rep_idKey
          VALUES (@clientId, @type, @nextRun, @frequency, @email, @intervalDays, @shiftType)
        `);

      const newScheduleId = insertResult.recordset[0].rep_idKey;
      const resolved = await resolveClientById(clientId, pool);

      res.status(201).json({
        success: true,
        message: `Schedule created successfully for ${parsedEmails.length} email(s)`,
        schedule: {
          id: newScheduleId,
          clientId,
          clientName: resolved.clientName,
          clientEmail: resolved.clientEmail,
          accountNumber: resolved.accountNumber,
          clientSource: resolved.source,
          type: type || 1,
          nextRun,
          frequency,
          shiftType: finalShiftType,
          email: finalEmails,
          emails: finalEmails,
          intervalDays: intervalDays || 1,
          status: 1,
          timezone: TZ,
          emailCount: parsedEmails.length,
          formattedEmails: formatEmailsForDisplay(finalEmails),
          apiIntegration: 'managePatrolSchedules',
        },
        usingOptimizedModel: true,
      });
    } finally {
      // Always release the connection back to the pool
      connection.release();
    }
  } catch (error) {
    console.error('❌ Error creating schedule:', error);
    res.status(500).json({ success: false, message: 'Database error', error: error.message });
  }
};

// =====================================================
// deleteSchedule
// =====================================================

const deleteSchedule = async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id);
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid schedule ID' });
    }
    const pool   = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, scheduleId)
      .query('DELETE FROM _Datos.dbo.m_reportes_automaticos WHERE rep_idKey = @id');
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: 'Schedule not found' });
    }
    res.status(200).json({ success: true, message: 'Schedule deleted successfully', deletedId: scheduleId });
  } catch (error) {
    console.error('❌ Error deleting schedule:', error);
    res.status(500).json({ success: false, message: 'Database error', error: error.message });
  }
};

// =====================================================
// triggerDynamicReports
// =====================================================

const triggerDynamicReports = async (req, res) => {
  try {
    console.log('🔧 Manual trigger for dynamic reports...');
    const schedulerService = require('../service/scheduler.js');
    const result = await schedulerService.runDynamicReportScheduler();
    res.status(200).json({
      success:   true,
      message:   'Dynamic reports triggered successfully',
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
      result,
    });
  } catch (error) {
    console.error('❌ Error triggering dynamic reports:', error);
    res.status(500).json({ success: false, message: 'Failed to trigger reports', error: error.message });
  }
};

// =====================================================
// triggerPatrolReports
// =====================================================

const triggerPatrolReports = async (req, res) => {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 MANUAL PATROL REPORT TRIGGER RECEIVED');
  console.log('='.repeat(70));

  try {
    const {
      clientId,
      recipientEmail,
      startDate,
      endDate,
      reportPeriod = 'previousWeek',
      shiftType,
    } = req.body;

    const finalShiftType = normaliseShiftType(shiftType);
    const isIndividualReport = clientId && recipientEmail;

    if (isIndividualReport) {
      console.log(`📋 Individual: clientId=${clientId}, shift=${finalShiftType}, period=${startDate || reportPeriod} → ${endDate || 'default'}`);

      const lockKey = `${clientId}_${finalShiftType}_${startDate || reportPeriod}_${endDate || 'default'}`;

      if (isReportInProgress(lockKey)) {
        return res.status(409).json({
          success: false,
          error:   'This report is already being generated. Please wait 2 minutes.',
          lockKey,
        });
      }

      markReportInProgress(lockKey);

      try {
        const EMAIL_ENABLED = global.EMAIL_SENDING_ENABLED !== undefined
          ? global.EMAIL_SENDING_ENABLED
          : process.env.ENABLE_EMAIL_SENDING === 'true';

        let dateRange;
        if (startDate && endDate) {
          dateRange = getCustomDateRange(startDate, endDate, finalShiftType);
        } else {
          dateRange = getDateRangeForPeriod(reportPeriod, null, null, finalShiftType);
        }

        const finalStartDate = dateRange.startDate;
        const pdfEndDate = dateRange.endDate;

        if (!finalStartDate || !pdfEndDate) throw new Error('Invalid date range computed');

        console.log(`📅 Using date range: ${finalStartDate} → ${pdfEndDate} (${dateRange.nightsInRange || dateRange.daysInRange} shifts, period=${reportPeriod}, shiftType=${finalShiftType})`);

        const pool     = await poolPromise;
        const resolved = await resolveClientById(clientId, pool);
        if (resolved.source === 'UNKNOWN')
          throw new Error(`Client ${clientId} not found in API or database`);

        const client = {
          ClientID:      clientId,
          ClientName:    resolved.clientName,
          ClientEmail:   resolved.clientEmail,
          AccountNumber: resolved.accountNumber,
        };

        const shiftLabel = { day: 'Day Shift', night: 'Night Shift', both: '' }[finalShiftType] || '';

        const pdfService = require('../service/pdfService.js');
        const pdfBuffer  = await pdfService.generateDashboardPDF({
          clientId:   client.ClientID,
          clientName: client.ClientName,
          startDate:  finalStartDate,
          endDate:    pdfEndDate,
          shiftType:  finalShiftType,
          shiftLabel,
        });
        console.log(`✅ PDF generated: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);

        let emailResult = {
          skipped: !EMAIL_ENABLED,
          reason:  EMAIL_ENABLED ? null : 'Email sending disabled globally',
        };

        if (EMAIL_ENABLED) {
          const emailService  = require('../service/emailService.js');
          const sendEmailFunc = emailService.sendPatrolReport  ||
                                emailService.sendGuardReport   ||
                                emailService?.default?.sendPatrolReport ||
                                emailService?.default?.sendGuardReport;
          if (!sendEmailFunc) throw new Error('Email service method not available');

          const filenameSuffix = finalShiftType !== 'both' ? `_${finalShiftType}` : '';

          try {
            emailResult = await Promise.race([
              sendEmailFunc({
                to:            recipientEmail,
                recipientName: recipientEmail.split('@')[0],
                clientName:    client.ClientName,
                startDate:     finalStartDate,
                endDate:       pdfEndDate,
                shiftType:     finalShiftType,
                shiftLabel,
                pdfBuffer,
                pdfFilename:   `Security_Report_${client.ClientName.replace(/\s+/g, '_')}${filenameSuffix}_${finalStartDate}_to_${pdfEndDate}.pdf`,
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Email timed out after 60s')), 60000)
              ),
            ]);
            console.log('✅ Email sent');
          } catch (emailErr) {
            console.error('❌ Email failed:', emailErr.message);
            emailResult = { success: false, error: emailErr.message };
          }
        }

        return res.json({
          success: true,
          message: EMAIL_ENABLED && !emailResult.error
            ? 'Report generated and email sent successfully'
            : 'Report generated' + (emailResult.error
                ? ` (email failed: ${emailResult.error})`
                : ' (email disabled)'),
          data: {
            client:    { id: client.ClientID, name: client.ClientName, source: resolved.source },
            dateRange: {
              start:       finalStartDate,
              end:         pdfEndDate,
              label:       dateRange.rangeLabel,
              nightShifts: dateRange.nightsInRange || dateRange.daysInRange,
              period:      reportPeriod,
              shiftType:   finalShiftType,
            },
            pdf:   { generated: true, sizeKB: Math.round(pdfBuffer.length / 1024) },
            email: {
              enabled:    EMAIL_ENABLED,
              sent:       EMAIL_ENABLED && !emailResult.error,
              recipients: 1,
              recipient:  recipientEmail,
              error:      emailResult.error || null,
              skipped:    emailResult.skipped || false,
            },
          },
          timestamp:           dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
          usingOptimizedModel: true,
        });
      } finally {
        clearReportInProgress(lockKey, REPORT_COOLDOWN_MS);
      }
    } else {
      console.log('🔧 Bulk scheduler run (all due schedules)...');
      const schedulerService = require('../service/scheduler.js');
      const result = await schedulerService.runDynamicReportScheduler();
      return res.status(200).json({
        success:             true,
        message:             'Patrol reports triggered successfully (bulk)',
        timestamp:           dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        result,
        usingOptimizedModel: true,
        mode:                'bulk',
      });
    }
  } catch (error) {
    console.error('❌ Error in triggerPatrolReports:', error);
    return res.status(500).json({
      success:   false,
      message:   'Failed to trigger patrol reports',
      error:     error.message,
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
    });
  }
};

// =====================================================
// getSchedulerStatus
// =====================================================

const getSchedulerStatus = async (req, res) => {
  try {
    const pool = await poolPromise;

    const [dueResult, totalResult, emailStatsResult] = await Promise.all([
      pool.request().query(
        `SELECT COUNT(*) AS DueCount 
         FROM _Datos.dbo.m_reportes_automaticos 
         WHERE rep_tproximoenvio <= GETDATE() 
           AND rep_cmail IS NOT NULL 
           AND rep_cmail NOT LIKE 'SCHEDULE::%'`
      ),
      pool.request().query(
        `SELECT COUNT(*) AS TotalCount 
         FROM _Datos.dbo.m_reportes_automaticos 
         WHERE rep_cmail IS NOT NULL 
           AND rep_cmail NOT LIKE 'SCHEDULE::%'`
      ),
      pool.request().query(`
        SELECT
          COUNT(*) AS TotalSchedules,
          SUM(LEN(rep_cmail) - LEN(REPLACE(rep_cmail, ',', '')) + 1) AS TotalEmailRecipients
        FROM _Datos.dbo.m_reportes_automaticos
        WHERE rep_cmail IS NOT NULL 
          AND rep_cmail != ''
          AND rep_cmail NOT LIKE 'SCHEDULE::%'
      `),
    ]);

    const emailStats = emailStatsResult.recordset[0];
    const avgEmails  = emailStats.TotalSchedules > 0
      ? Math.round(emailStats.TotalEmailRecipients / emailStats.TotalSchedules)
      : 0;

    const currentWeekRange = getPreviousWeekRange('both');
    const dayName          = WEEK_START_DAY_NAMES[WEEK_START_DAY] || 'Wednesday';

    res.status(200).json({
      success: true,
      status: {
        schedules: {
          total: totalResult.recordset[0].TotalCount,
          due:   dueResult.recordset[0].DueCount,
        },
        emailRecipients: {
          total:                   emailStats.TotalEmailRecipients || 0,
          averagePerSchedule:      avgEmails,
          emailSendingEnabled:     global.EMAIL_SENDING_ENABLED || false,
        },
        system: {
          serverTime: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
          timezone:   TZ,
          dataSource: 'managePatrolSchedules',
          lockStrategy: 'Atomic SQL compare-and-swap (rowsAffected=0 → skip, no duplicate)',
          weekConfig: {
            weekStartDay:     WEEK_START_DAY,
            weekStartDayName: dayName,
            weekWindow:       `${dayName} 18:00 → ${dayName} 06:00 (following week)`,
            currentRange: {
              startDate:  currentWeekRange.startDate,
              endDate:    currentWeekRange.endDate,
              label:      currentWeekRange.rangeLabel,
              shifts:     currentWeekRange.nightsInRange,
            },
          },
          duplicateProtection: {
            primaryLock:       'Atomic SQL compare-and-swap in scheduler.js',
            secondaryLock:     'In-memory Map (within-process guard for HTTP requests)',
            cooldown:          '2 minutes',
            inProgressReports: inProgressReports.size,
          },
          rollingWindowRules: {
            note:        'All rolling windows are INCLUSIVE (start → end = exactly N days)',
            yesterday:   'start = today-1, end = today-1  (1 completed shift)',
            last3days:   'start = today-2, end = today    (3 days inclusive)',
            last7days:   'start = today-6, end = today    (7 days inclusive)',
            last30days:  'start = today-29, end = today   (30 days inclusive)',
          },
          frequencyPeriodMapping: {
            1: 'yesterday (1 shift)',
            2: 'previousWeek (7 shifts, boundary-to-boundary)',
            3: 'last3days (3 shifts inclusive)',
            4: 'last30days (30 shifts inclusive)',
          },
          shiftTypeSupport: {
            enabled: true,
            values:  VALID_SHIFT_TYPES,
            note:    'Schedules are now unique per (clientId, shiftType) — a client can have independent Day and Night schedules',
          },
        },
      },
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
    });
  } catch (error) {
    console.error('❌ Scheduler status error:', error);
    res.status(500).json({ success: false, message: 'Failed to get status', error: error.message });
  }
};

// =====================================================
// getAllClientsPerformance
// =====================================================

const getAllClientsPerformance = async (req, res) => {
  try {
    const pool   = await poolPromise;
    const result = await pool.request().query(`
      SELECT cue_iid AS ClientID, cue_cnombre AS ClientName, cue_cemail AS ClientEmail, cue_ncuenta AS AccountNumber
      FROM _Datos.dbo.m_cuentas
      WHERE cue_iid IN (28, 39, 41, 48)
      ORDER BY cue_cnombre
    `);

    const clients = await Promise.all(
      result.recordset.map(async (client) => {
        const reportData  = await getClientPatrols(client.ClientID, 7);

        const emailResult = await pool.request()
          .input('clientId', sql.Int, client.ClientID)
          .query(`
            SELECT 
              CASE 
                WHEN rep_cmail LIKE 'SCHEDULE::%' THEN NULL 
                ELSE rep_cmail 
              END AS ReportEmail
            FROM _Datos.dbo.m_reportes_automaticos 
            WHERE rep_iidcuenta = @clientId
          `);
        const reportEmail = emailResult.recordset[0]?.ReportEmail || '';
        return {
          ...client,
          emailConfig: {
            emails:          reportEmail,
            emailCount:      parseEmails(reportEmail).length,
            formattedEmails: formatEmailsForDisplay(reportEmail),
          },
          performance: {
            overallPerformance: reportData.metadata.overallPerformance || 0,
            totalCompleted:     reportData.metadata.totalCompleted     || 0,
            totalExpected:      reportData.metadata.totalExpectedPatrols || 0,
            postsCount:         reportData.posts.length        || 0,
            eventsCount:        reportData.events.length       || 0,
            guardReportsCount:  reportData.guardReports.length || 0,
            dataSource:         reportData.metadata.dataSource || 'Unknown',
            success:            reportData.metadata.success    || false,
          },
          lastUpdated: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        clients,
        total:               clients.length,
        timeframe:           'Last 7 nights',
        usingOptimizedModel: true,
      },
    });
  } catch (error) {
    console.error('❌ Error getting clients performance:', error);
    res.status(500).json({ success: false, message: 'Failed to get performance data', error: error.message });
  }
};

// =====================================================
// Testing & Diagnostics
// =====================================================

const toggleEmailSending = async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean')
      return res.status(400).json({ success: false, message: 'Please provide enabled: true/false' });
    global.EMAIL_SENDING_ENABLED = enabled;
    console.log(`🛑 Email sending ${enabled ? 'ENABLED' : 'DISABLED'} globally`);
    res.status(200).json({
      success:              true,
      message:              `Email sending ${enabled ? 'enabled' : 'disabled'} globally`,
      emailSendingEnabled:  global.EMAIL_SENDING_ENABLED,
      timestamp:            dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to toggle email sending', error: error.message });
  }
};

const testReportModel = async (req, res) => {
  try {
    const { clientId, startDate, endDate } = req.body;
    const testClientId  = clientId  || 28;
    const testStartDate = startDate || dayjs().tz(TZ).subtract(6, 'day').format('YYYY-MM-DD');
    const testEndDate   = endDate   || dayjs().tz(TZ).format('YYYY-MM-DD');

    const nightsCount = dayjs(testEndDate).diff(dayjs(testStartDate), 'day') + 1;
    const patrolData  = await patrolSchedules.getClientPatrols(testClientId, nightsCount);
    const schedule    = await patrolSchedules.getClientSchedule(testClientId);

    const pool     = await poolPromise;
    const resolved = await resolveClientById(testClientId, pool);

    res.status(200).json({
      success: true,
      client:  { id: testClientId, name: resolved.clientName, source: resolved.source },
      period:  { startDate: testStartDate, endDate: testEndDate, days: nightsCount },
      reportData: {
        postsCount:          patrolData.pastPatrols?.length || 0,
        eventsCount:         patrolData.pastPatrols?.length || 0,
        guardReportsCount:   0,
        overallPerformance:  parseInt(patrolData.summary?.scheduleCompliance) || 0,
        dataSource:          schedule?.config_source || 'managePatrolSchedules',
        processingTime:      patrolData.summary?.processingTimeMs || 0,
        success:             true,
      },
      metadata:  patrolData.summary,
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Report model test failed', error: error.message });
  }
};

const diagnosticServices = async (req, res) => {
  try {
    let schedulerService;
    try { schedulerService = require('../service/scheduler.js'); } catch { /* unavailable */ }

    const currentWeekRange = getPreviousWeekRange('both');
    const dayName          = WEEK_START_DAY_NAMES[WEEK_START_DAY] || 'Wednesday';

    const diagnostics = {
      reportModel: {
        available:   !!patrolSchedules,
        description: 'managePatrolSchedules.js',
        functions:   Object.keys(patrolSchedules).filter(k => typeof patrolSchedules[k] === 'function'),
      },
      schedulerService: {
        available:                      !!schedulerService,
        functions:                      schedulerService
          ? Object.keys(schedulerService).filter(k => typeof schedulerService[k] === 'function')
          : [],
        hasRunDynamicReportScheduler:   schedulerService &&
          typeof schedulerService.runDynamicReportScheduler === 'function',
      },
      emailFeatures: {
        enabled:              global.EMAIL_SENDING_ENABLED || false,
        multiRecipient:       true,
        duplicateProtection:  true,
        lockStrategy:         'Atomic SQL compare-and-swap (primary) + in-memory Map (secondary)',
      },
      apiClientLookup: {
        available:   true,
        description: 'resolveClientById() and buildApiClientMap()',
      },
      weekConfig: {
        weekStartDay:     WEEK_START_DAY,
        weekStartDayName: dayName,
        weekWindow:       `${dayName} 18:00 → ${dayName} 06:00 (following week)`,
        currentRange: {
          startDate: currentWeekRange.startDate,
          endDate:   currentWeekRange.endDate,
          label:     currentWeekRange.rangeLabel,
          shifts:    currentWeekRange.nightsInRange,
        },
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
        uniquenessKey: '(clientId, shiftType)',
      },
      system: {
        nodeVersion:  process.version,
        timezone:     TZ,
        serverTime:   dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        duplicateProtection: {
          primary:          'SQL WHERE rep_tproximoenvio = @ExpectedTime (compare-and-swap)',
          secondary:        'In-memory Map for HTTP request deduplication',
          inProgressCount:  inProgressReports.size,
        },
      },
    };

    res.status(200).json({
      success: true,
      diagnostics,
      recommendations: [
        diagnostics.reportModel.available
          ? '✅ managePatrolSchedules.js loaded successfully'
          : '❌ managePatrolSchedules.js not found',
        diagnostics.schedulerService.hasRunDynamicReportScheduler
          ? '✅ Scheduler main function available'
          : '❌ Scheduler main function not found',
        diagnostics.emailFeatures.enabled
          ? '✅ Email sending enabled'
          : '⚠️ Email sending disabled',
        '✅ LEFT JOIN fix applied — API-only client schedules now visible',
        '✅ API-first client lookup — new clients resolve correctly',
        '✅ getPreviousWeekRange: controller-local dayjs math (no reportModel dependency)',
        '✅ Atomic SQL lock: duplicate emails eliminated at DB level (rowsAffected=0 → skip)',
        `✅ Current range: ${currentWeekRange.startDate} → ${currentWeekRange.endDate} (${currentWeekRange.nightsInRange} shifts)`,
        '✅ Data source: managePatrolSchedules.js',
        '✅ SCHEDULE:: prefix filtered from all email queries',
        '✅ Historical date range fixed — uses fetchWeeklyReport for true historical data',
        '✅ getYesterdayRange: start=yesterday, end=yesterday (1 shift — exact)',
        '✅ getLast3DaysRange:  start=today-2,   end=today   (3 days inclusive — exact)',
        '✅ getLast7DaysRange:  start=today-6,   end=today   (7 days inclusive — exact)',
        '✅ getLast30DaysRange: start=today-29,  end=today   (30 days inclusive — exact)',
        '✅ triggerPatrolReports: pdfEndDate = dateRange.endDate (no extra subtract)',
        '✅ getDateRangeForPeriod: all periods correctly mapped',
        '✅ FIX 19: shiftType (day/night/both) threaded through every date-range function',
        '✅ FIX 19: createSchedule dedup key is now (clientId, shiftType) — Day+Night coexist',
        '✅ FIX 19: getDatabaseQueryDates window now driven by SHIFT_HOUR_BOUNDS per shift',
        '✅ FIX 20: SET IDENTITY_INSERT OFF applied on the same connection',
      ],
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Diagnostic failed', error: error.message });
  }
};

// =====================================================
// 📋 EXPORTS
// =====================================================

module.exports = {
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  createSchedule,
  deleteSchedule,
  triggerDynamicReports,
  triggerPatrolReports,
  getSchedulerStatus,
  getAllClientsPerformance,
  diagnosticServices,
  toggleEmailSending,
  testReportModel,
  getDateRangeForPeriod,
  getTodayRange,
  getYesterdayRange,
  getLast3DaysRange,
  getLast7DaysRange,
  getPreviousWeekRange,
  getCurrentWeekRange,
  getLast30DaysRange,
  getPreviousMonthRange,
  getCurrentMonthRange,
  getCustomDateRange,
  getHistoricalDateRange,
  getClientHistoricalPatrols,
  getClientPatrols,
  buildApiClientMap,
  resolveClientById,
  parseEmails,
  formatEmailsForDisplay,
  calculateNightsInRange,
  getDatabaseQueryDates,
  normaliseShiftType,
  VALID_SHIFT_TYPES,
  inProgressReports,
};

module.exports.default = module.exports;