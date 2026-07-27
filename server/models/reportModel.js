// server/models/reportModel.js
// ✅ FIX 1–19: (see full history above)
// ✅ FIX 20: SHIFT TYPE — informational only for the CLIENT'S configured
//    shift (used to compute expected patrols/day), but does NOT restrict
//    which V04 events are returned, by default.
// ✅ FIX 21: ALL V04 + ALL ZONES (default) — when no explicit shift scope
//    is requested, the query window is a plain full-day range (startDate
//    00:00 → endDate 23:59:59, ± grace). Every V04 event in that range is
//    returned, and every zone registered for the client is included in
//    `posts` (ghost zones are flagged, not dropped).
// ✅ FIX 22: MOCK DATA REMOVED.
// ✅ FIX 23: PER-CLIENT ZONE-NAME EXCLUSIONS.
// ✅ FIX 24: CHRONOLOGICAL EVENT ORDER.
// ✅ FIX 26: EXPLICIT SHIFT-WINDOW SCOPING — fetchPatrolReport accepts an
//    optional 6th parameter, requestedShiftType ('day' | 'night' | 'both' |
//    null), which narrows the actual query window:
//      day   → 06:00 (startDate) → 18:00 (endDate), same-day span
//      night → 18:00 (startDate) → 06:00 (endDate + 1 day), crosses midnight
//      both  → unchanged FIX 21 behavior: full calendar-day span
//    Incident windowing is intentionally left as a full calendar-day range
//    regardless of shift scope (incidents aren't a "which shift" concept
//    the way patrol arrivals are).
// ✅ FIX 27: DEFAULT SHIFT SCOPE FIXED — FIX 20/21 made the client's
//    configured shift type purely informational (expected-patrol math
//    only), and FIX 26 only scoped the query when a caller EXPLICITLY
//    passed requestedShiftType. In practice, callers (scheduler, quick
//    report triggers, etc.) frequently generate a report for a client
//    configured as "Day" or "Night" WITHOUT passing requestedShiftType —
//    so the query silently fell back to the full 24hr window while the
//    generated PDF's title/label still reflected the client's configured
//    shift (e.g. "Day Shift"). Net effect: a report titled "Day Shift"
//    could contain 18:00–06:00 night-only patrol events, because nothing
//    ever told the QUERY to scope down to 06:00–18:00 — only the LABEL
//    knew the client was configured as day-shift.
//      FIX: when requestedShiftType is not explicitly passed (null/undefined),
//      the scoping now falls back to the CLIENT'S configured shift type
//      (earlyShiftType) instead of falling back to "no scoping / full day".
//      A caller that explicitly wants the old "everything" behavior can
//      still get it by explicitly passing requestedShiftType = 'both'.
//      This guarantees a report labeled Day/Night can never silently pull
//      events from the opposite shift again.
//
//    Day shift window:   06:00 → 18:00 (same day)
//    Night shift window: 18:00 → 06:00 (next day, crosses midnight)
//
// ✅ FIX 28: DB-ONLY / ARCHIVE-ONLY PATROL EVENT SOURCE — patrol
//    events are no longer fetched live from the BM Security API inside
//    fetchPatrolReport, and no longer read from the BM-owned
//    p_recepcionYYYYMM partition tables either. The single source of
//    truth for patrol events is now dbo.PatrolEventsArchive, populated
//    independently by eventArchiveJob.js on its own schedule (API → DB).
//    fetchPatrolReport purely READS from that archive table. This removes
//    an entire class of bugs where a report's data source depended on
//    live API availability/latency at request time, and guarantees every
//    report reads from the exact same durable, gap-monitored source that
//    eventArchiveJob.js maintains. (fetchPatrolEventsFromAPI and
//    fetchPatrolEventsFromDB — the old live-API and partition-table
//    readers — have been removed from the report path entirely.)
// ✅ FIX 29 (SUPERSEDED BY FIX 31 — see below): an earlier build of this
//    file dropped zero-patrol ("ghost") zones from the report entirely.
//    That's been reverted — zero-patrol zones are shown again, just
//    labeled instead of hidden. Left here for history only.
//
// ✅ FIX 30: CAP COMPLETED AT EXPECTED — see calculatePerformance() below.
//    A guard who patrols more than the configured Patrols/Day no longer
//    inflates Completed past Expected (no more 155%-style numbers). The
//    true raw count is preserved as RawCompleted, just not shown/used for
//    the percentage.
//
// ✅ FIX 31 (NEW): ZERO-PATROL ZONES ARE SHOWN IN FULL, LABELED INSTEAD OF
//    DROPPED. FIX 29's "just drop anything with 0 patrols" approach was
//    too blunt — it also silently hid genuinely active zones that a guard
//    simply skipped for the whole period, with no way to tell the two
//    cases apart on the PDF. Every zone with zero patrols this period now
//    gets a `ZoneStatus` instead, based only on data we actually have (no
//    guessing at BM's "enabled" field, which is still unconfirmed):
//      UNKNOWN_ZONE      — the zone code never resolved to a real name
//                          from ANY source (placeholder "Zone <code>"),
//                          i.e. we don't know what this zone even is.
//      DELETED_FROM_API  — this zone came from a DB/patrol-event
//                          fallback, not a successful live API zone
//                          fetch this run, so we have no live confirmation
//                          it still exists on BM's side — most likely
//                          deleted/decommissioned there.
//      ACTIVE_NO_PATROLS — the zone DID come back from a successful live
//                          API fetch (source: 'API'), so it's confirmed
//                          to currently exist — it just had no patrols
//                          logged in this specific reporting window.
//    Zones with patrols > 0 keep ZoneStatus: 'ACTIVE'. Nothing is dropped;
//    `posts` always reflects every zone the source data returned.

process.env.TZ = 'Africa/Nairobi';
console.log('🔧 FORCED TZ:', process.env.TZ);

const { sql, poolPromise } = require("../config/database.js");
const { getClientSchedule, getPatrolScheduleConfig } = require("../scripts/managePatrolSchedules.js");
const bmSecurityAPI = require("../service/bmSecurityAPI.js");
const { getIncidentCount } = require('./incidentModel.js');
const { saveGeneratedReport } = require('../service/reportArchiveService');
const { fetchEventsFromArchive } = require('../service/eventArchiveService');
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore.js');
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter.js');
const isBetween = require('dayjs/plugin/isBetween.js');
const customParseFormat = require('dayjs/plugin/customParseFormat.js');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

// ========== CONFIGURATION ==========
const TZ            = process.env.TZ || 'Africa/Nairobi';
const DB_CACHE_TTL  = 60000;
const API_CACHE_TTL = 5 * 60 * 1000;

// Shift-hour boundaries. Used for (a) expected-patrols/day math, and
// (b) FIX 26/27's query-window scoping (explicit request OR, as of FIX 27,
// the client's own configured shift when nothing explicit was requested).
const SHIFT_START_HOUR     = 18;   // night shift start
const SHIFT_END_HOUR       = 6;    // night shift end
const DAY_SHIFT_START_HOUR = 6;    // day shift start
const DAY_SHIFT_END_HOUR   = 18;   // day shift end

const PATROL_ARRIVAL_CODE = 'V04';
const INCIDENT_CODE       = 'V03';

const SHIFT_GRACE_MINUTES = parseInt(process.env.SHIFT_GRACE_MINUTES || '10', 10);

const WEEK_START_DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const WEEK_START_DAY = (process.env.WEEK_START_DAY !== undefined && !isNaN(parseInt(process.env.WEEK_START_DAY)))
  ? Math.max(0, Math.min(6, parseInt(process.env.WEEK_START_DAY)))
  : 3;

const API_RETRY_ATTEMPTS = parseInt(process.env.API_RETRY_ATTEMPTS || '3', 10);
const API_RETRY_DELAY_MS = parseInt(process.env.API_RETRY_DELAY_MS  || '1500', 10);

console.log(`📅 Week start day configured: ${WEEK_START_DAY_NAMES[WEEK_START_DAY]} (day index ${WEEK_START_DAY})`);
console.log(`⏱️  Shift grace window: ±${SHIFT_GRACE_MINUTES} minutes`);
console.log(`🔁 API retry attempts: ${API_RETRY_ATTEMPTS} (delay ${API_RETRY_DELAY_MS}ms)`);
console.log(`🗄️  Patrol event source: dbo.PatrolEventsArchive (DB-only — no live API/partition-table reads in the report path)`);
console.log(`👻 Zero-patrol zones: SHOWN in report output, labeled via ZoneStatus (FIX 31 — UNKNOWN_ZONE / DELETED_FROM_API / ACTIVE_NO_PATROLS)`);

// ═══════════════════════════════════════════════════════════════════════
// SHIFT TYPE NORMALISATION
// ═══════════════════════════════════════════════════════════════════════
// Returns NULL for missing/unknown values.
// ═══════════════════════════════════════════════════════════════════════
function normaliseShiftType(raw) {
  if (!raw) return null;
  const lower = String(raw).toLowerCase().trim();
  if (lower === 'day'   || lower === 'day only'   || lower === 'day shift only'   || lower === 'dayshift')   return 'day';
  if (lower === 'night' || lower === 'night only' || lower === 'night shift only' || lower === 'nightshift') return 'night';
  if (lower === 'both'  || lower === 'day/night'  || lower === 'daynightshift'    || lower === '24/7')        return 'both';
  return null;   // unknown value — treat as not configured
}

// Kept for callers that still want shift-window hours for display/metadata
// purposes.
function getShiftWindowHours(normShiftType) {
  switch (normShiftType) {
    case 'day':
      return { startHour: DAY_SHIFT_START_HOUR, endHour: DAY_SHIFT_END_HOUR, crossesMidnight: false };
    case 'night':
      return { startHour: SHIFT_START_HOUR, endHour: SHIFT_END_HOUR, crossesMidnight: true };
    case 'both':
      return { startHour: 0, endHour: 23, crossesMidnight: false };
    default:
      return { startHour: 0, endHour: 23, crossesMidnight: false };
  }
}


// ═══════════════════════════════════════════════════════════════════════
// EXCLUDED SITES & POST-COUNT OVERRIDES
// ═══════════════════════════════════════════════════════════════════════

const EXCLUDED_NIGHT_SHIFT_SITES = new Map([
  ['CEN357',    { name: 'Zimoli Ltd',             region: 'Airport',               reason: 'DAY_ONLY',   note: 'Day-only site — no night guard deployed' }],
  ['CEN342',    { name: 'Fruitplus JKIA',          region: 'Airport',               reason: 'DAY_ONLY',   note: 'Day-only site — no night guard deployed' }],
  ['CEN262',    { name: 'NCBA Bank Wote',           region: 'Eastern / Makueni',    reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN293',    { name: 'NCBA Bank Kitui',          region: 'Eastern / Kitui',      reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN365',    { name: 'Equity Afia Kajiado',      region: 'Eastern / Kajiado',    reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN276',    { name: 'CIMMYT Kiboko',            region: 'Eastern / Kiboko',     reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN288',    { name: 'Equity Masii Machakos',    region: 'Eastern / Masii',      reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN331',    { name: 'Equity Kimana',            region: 'Eastern / Kajiado',    reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN332',    { name: 'Equity Emali',             region: 'Eastern / Emali',      reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN333',    { name: 'Equity Kajiado',           region: 'Eastern / Kajiado',    reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN171',    { name: 'Equity Loitoktok',         region: 'Eastern / Loitoktok',  reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN344',    { name: 'WWF Oloitoktok',           region: 'Eastern / Oloitoktok', reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN270',    { name: 'Multichoice Mua Hills',    region: 'Eastern / Mua Hills',  reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN360',    { name: 'ALU Products Industries',  region: 'Eastern / Machakos',   reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN299',    { name: 'Equity Afia Loitoktok',    region: 'Eastern / Loitoktok',  reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN256',    { name: 'ABSA Machakos',            region: 'Eastern / Machakos',   reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN257',    { name: 'ABSA Wote',                region: 'Eastern / Wote',       reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN258',    { name: 'ABSA Kitui',               region: 'Eastern / Kitui',      reason: 'OUT_REGION', note: 'Eastern region site' }],
  ['CEN091',    { name: 'Arichem Limited Kisaju',   region: 'Airport 1 / Kisaju',   reason: 'OUT_REGION', note: 'Airport 1 region site' }],
  ['CMDPLT001', { name: 'Mr. Neil Property Kisaju', region: 'Airport 1 / Kisaju',   reason: 'OUT_REGION', note: 'Airport 1 region site' }],
]);

const POST_COUNT_OVERRIDES = new Map([
  ['CEN259',   { expectedPosts: 2, postTypes: ['NSO', 'DH'],          note: 'Keitt Exporters JKIA — 2 posts (NSO & Dog Handler). Industrial Area 2.' }],
  ['CKAI0112', { expectedPosts: 2, postTypes: ['NSO', 'DH'],          note: 'Kenya Alliance Assessment — 2 posts (1 NSO & 1 DH). Industrial Area 1.' }],
  ['C236',     { expectedPosts: 3, postTypes: ['NSO', 'NSO', 'NSO'], note: 'Rapid Kate Services — 3 posts, not 4. Airport.' }],
]);

const SINGLE_POST_SITES = new Map([
  // No single-post overrides currently configured.
]);

const ZONE_NAME_EXCLUSIONS_BY_CLIENT = new Map([
  ['BM POLO VIGICONTROL', new Set([
    'EQUITY KILELESHWA',
    'NCBA KILELESHWA',
    'CARREFOUR JUNCTION',
    'NAIVAS JAMES GICHURU',
    'SHELL JUNCTION',
  ])],
]);

const ZONE_NAME_ALLOWLIST_BY_CLIENT = new Map([
  ['BM POLO VIGICONTROL', new Set([
    'BM INNER GATE',
    'BM CONTROLROOM BOOSTER',
    'BM INVESTIGATION',
    'BM BEHIND THE GENERATOR',
    'BM SOLAR POWER HOUSE',
    'BM CVM OFFICE',
    'BM MICHELLE GARDENS',
    'BM SYSTEM STORE',
    'BM K9 TRAINING GROUND',
    'BM SACCO ARCHIVE',
    'BM K9 AREA/WASHROOM',   // renamed — was 'BM K9 AREA'
  ])],
]);

function getZoneAllowlistForClient(clientName) {
  if (!clientName) return null;
  return ZONE_NAME_ALLOWLIST_BY_CLIENT.get(normaliseForZoneMatch(clientName)) || null;
}

function isZoneNameAllowedForClient(clientName, zoneName) {
  const allowlist = getZoneAllowlistForClient(clientName);
  if (!allowlist) return true;
  return allowlist.has(normaliseForZoneMatch(zoneName));
}

function normaliseForZoneMatch(str) {
  return String(str).trim().toUpperCase().replace(/\s+/g, ' ');
}

function isExcludedZoneNameForClient(clientName, zoneName) {
  if (!clientName || !zoneName) return false;
  if (getZoneAllowlistForClient(clientName)) return false;
  const clientKey    = normaliseForZoneMatch(clientName);
  const excludedSet  = ZONE_NAME_EXCLUSIONS_BY_CLIENT.get(clientKey);
  if (!excludedSet) return false;
  return excludedSet.has(normaliseForZoneMatch(zoneName));
}

function isExcludedNightShiftSite(accountNumber, clientName) {
  if (accountNumber) {
    const key = String(accountNumber).trim().toUpperCase();
    if (EXCLUDED_NIGHT_SHIFT_SITES.has(key)) return EXCLUDED_NIGHT_SHIFT_SITES.get(key);
  }
  return null;
}

function getPostCountOverride(accountNumber) {
  if (accountNumber) {
    const key = String(accountNumber).trim().toUpperCase();
    if (POST_COUNT_OVERRIDES.has(key)) return POST_COUNT_OVERRIDES.get(key);
  }
  return null;
}

function getSinglePostOverride(accountNumber, clientName) {
  if (accountNumber) {
    const key = String(accountNumber).trim().toUpperCase();
    if (SINGLE_POST_SITES.has(key)) return SINGLE_POST_SITES.get(key);
  }
  if (clientName) {
    const nameUpper = String(clientName).trim().toUpperCase();
    for (const [, v] of SINGLE_POST_SITES) {
      if (v.clientNameFragment && nameUpper.includes(v.clientNameFragment)) return v;
    }
  }
  return null;
}


// ========== RETRY HELPER ==========

async function withRetry(fn, attempts = API_RETRY_ATTEMPTS, delayMs = API_RETRY_DELAY_MS, label = 'operation') {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable = (
        err.code === 'ECONNRESET'  ||
        err.code === 'ETIMEDOUT'   ||
        err.code === 'ENOTFOUND'   ||
        err.name === 'AggregateError' ||
        (err.message && err.message.includes('AggregateError')) ||
        (err.response && err.response.status >= 500)
      );
      if (!isRetryable || attempt === attempts) break;
      logger.warn(`⚠️ [${label}] attempt ${attempt}/${attempts} failed (${err.message}) — retrying in ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
  throw lastError;
}


// ========== ZONE HELPERS ==========

function normalizeZoneCode(code) {
  if (!code) return '';
  return String(code).trim().replace(/^0+/, '') || '0';
}

function isUnknownZone(zoneCode) {
  if (!zoneCode) return true;
  const z = String(zoneCode).trim();
  return (
    z === '' || z === '0' ||
    z.toUpperCase() === 'UNKNOWN_ZONE' ||
    z.toLowerCase() === 'null' ||
    z.toLowerCase() === 'undefined'
  );
}

function isPlaceholderZoneName(zoneName) {
  if (!zoneName) return true;
  return /^Zone\s+\d+$/i.test(String(zoneName).trim());
}

const DEFAULT_REPORT_TYPES = {
  WEEKLY:  'weekly',
  CUSTOM:  'custom',
  DAILY:   'daily',
  MONTHLY: 'monthly'
};

const zoneCache     = new Map();
const eventMapCache = { data: null, timestamp: 0 };
const scheduleCache = new Map();

const logger = {
  level: process.env.LOG_LEVEL || 'info',
  log(level, ...args) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levels[level] >= (levels[this.level] || 1)) {
      console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args);
    }
  },
  info(...args)  { this.log('info',  ...args); },
  warn(...args)  { this.log('warn',  ...args); },
  error(...args) { this.log('error', ...args); },
  debug(...args) { this.log('debug', ...args); }
};

// ========== ERROR RESPONSE HELPER ==========

function buildErrorResponse(startDate, endDate, reportType, message) {
  return {
    posts: [], events: [], guardReports: [],
    metadata: {
      reportType: reportType ? reportType.toUpperCase() : 'ERROR',
      shiftType:  null,
      patrolDefinition: { patrolCode: PATROL_ARRIVAL_CODE, incidentCode: INCIDENT_CODE },
      client: {
        id: 0, name: 'Unknown', accountNumber: null,
        patrolSchedule: null, performanceOverview: null,
        zoneDataSource: 'ERROR', zoneCount: 0,
      },
      clientId: 0, clientName: 'Unknown',
      startDate, endDate,
      totalExpectedPatrols: 0, totalCompletedPatrols: 0,
      overallPatrolPerformance: 0, totalIncidents: 0,
      generatedAt:   new Date(),
      patrolSource:  'ERROR',
      incidentSource:'ERROR',
      zoneSource:    'ERROR',
      error:         { message },
      dataQuality:   { isValid: false, separateSources: false },
      success:       false,
    },
  };
}

// ========== DATE PARSING ==========

function parseEventDate(rawDate) {
  if (!rawDate) return null;
  try {
    const amPmFormats = [
      'M/D/YYYY h:mm:ss A', 'M/D/YYYY h:mm A',
      'MM/DD/YYYY h:mm:ss A', 'MM/DD/YYYY h:mm A',
    ];
    for (const fmt of amPmFormats) {
      const parsed = dayjs(rawDate, fmt, true);
      if (parsed.isValid()) return parsed.tz(TZ, true);
    }
    let parsed = dayjs.utc(rawDate);
    if (parsed.isValid()) return parsed.tz(TZ, true);
    parsed = dayjs(rawDate);
    if (parsed.isValid()) return parsed.tz(TZ, true);
    const formats = [
      'YYYY-MM-DD HH:mm:ss', 'DD/MM/YYYY HH:mm:ss',
      'MM-DD-YYYY HH:mm:ss', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DD'
    ];
    for (const format of formats) {
      parsed = dayjs(rawDate, format);
      if (parsed.isValid()) return parsed.tz(TZ, true);
    }
    logger.warn(`⚠️ Could not parse date: "${rawDate}"`);
    return null;
  } catch (e) {
    logger.warn(`⚠️ Date parse exception for "${rawDate}": ${e.message}`);
    return null;
  }
}

// ========== VALIDATE DATES ==========
// ✅ FIX 26/27: 5th param `normShiftType` is the client's configured shift
// (informational, still drives expected-patrol math). 6th param
// `requestedShiftType` is the ACTUAL scoping used to build the query
// window below. As of FIX 27, callers of validateAndFormatDates should
// pass the ALREADY-RESOLVED scoping value (which fetchPatrolReport now
// computes as: explicit request, else the client's configured shift,
// else 'both'/full-day) — see fetchPatrolReport for that resolution.
//
//   requestedShiftType = null / 'both' → full calendar-day window,
//     startDate 00:00 → endDate 23:59:59 (±grace)
//   requestedShiftType = 'day'   → startDate 06:00 → endDate 18:00 (±grace)
//   requestedShiftType = 'night' → startDate 18:00 → (endDate+1) 06:00 (±grace)
//     (crosses midnight, matching SHIFT_HOUR_BOUNDS used elsewhere in the
//     codebase, e.g. schedulerController.js)
function validateAndFormatDates(startDate, endDate, reportType = DEFAULT_REPORT_TYPES.CUSTOM, normShiftType = null, requestedShiftType = null) {
  try {
    const cleanStart = String(startDate).split('T')[0];
    const cleanEnd   = String(endDate).split('T')[0];

    const start = dayjs.tz(cleanStart, TZ).startOf('day');
    let   end   = dayjs.tz(cleanEnd,   TZ).startOf('day');

    if (!start.isValid() || !end.isValid()) throw new Error("Invalid date format");
    if (end.isBefore(start))               throw new Error("End date before start date");

    const rawDaysDiff = end.diff(start, 'day');
    if (rawDaysDiff === 7 && start.day() === end.day()) {
      logger.info(`📅 Same-weekday 8-day input detected — adjusting end to ${end.subtract(1,'day').format('ddd DD/MM')}`);
      end = end.subtract(1, 'day');
    }

    const daysDiff  = end.diff(start, 'day');
    const shiftDays = daysDiff + 1;

    if (shiftDays < 1) throw new Error(`shiftDays=${shiftDays} — both dates must be valid day labels`);

    if (reportType === DEFAULT_REPORT_TYPES.WEEKLY && shiftDays !== 7)
      logger.warn(`⚠️ Weekly: expected 7 days, got ${shiftDays}`);
    if (reportType === DEFAULT_REPORT_TYPES.DAILY && shiftDays !== 1)
      logger.warn(`⚠️ Daily: expected 1 day, got ${shiftDays}`);

    // ✅ FIX 26/27: build the patrol query window based on requestedShiftType,
    // which fetchPatrolReport has already resolved (explicit request, else
    // client's configured shift, else 'both').
    const scopingShift = requestedShiftType ? normaliseShiftType(requestedShiftType) : null;
    let patrolQueryStart, patrolQueryEnd;

    if (scopingShift === 'day') {
      // Day shift: 06:00 → 18:00, same calendar day.
      patrolQueryStart = start.hour(DAY_SHIFT_START_HOUR).minute(0).second(0).subtract(SHIFT_GRACE_MINUTES, 'minute');
      patrolQueryEnd   = end.hour(DAY_SHIFT_END_HOUR).minute(0).second(0).add(SHIFT_GRACE_MINUTES, 'minute');
    } else if (scopingShift === 'night') {
      // Night shift: 18:00 → 06:00 NEXT day (crosses midnight).
      patrolQueryStart = start.hour(SHIFT_START_HOUR).minute(0).second(0).subtract(SHIFT_GRACE_MINUTES, 'minute');
      patrolQueryEnd   = end.add(1, 'day').hour(SHIFT_END_HOUR).minute(0).second(0).add(SHIFT_GRACE_MINUTES, 'minute');
    } else {
      // scopingShift is null or 'both' — full calendar-day window.
      patrolQueryStart = start.hour(0).minute(0).second(0).subtract(SHIFT_GRACE_MINUTES, 'minute');
      patrolQueryEnd   = end.hour(23).minute(59).second(59).add(SHIFT_GRACE_MINUTES, 'minute');
    }

    // Incident window intentionally stays full calendar-day regardless of
    // patrol shift scoping — an incident isn't "which shift" the way a
    // patrol arrival is, and narrowing it could hide an incident that
    // happened just outside the scoped patrol window but still within the
    // reporting day.
    const incidentQueryStart = start.hour(0).minute(0).second(0);
    const incidentQueryEnd   = end.hour(23).minute(59).second(59);

    let displayStart, displayEnd;
    if (reportType === DEFAULT_REPORT_TYPES.DAILY && shiftDays === 1) {
      displayStart = start.format('DD/MM/YYYY');
      displayEnd   = displayStart;
    } else {
      displayStart = start.format('DD/MM/YYYY');
      displayEnd   = end.format('DD/MM/YYYY');
    }

    logger.info(`✅ ${reportType.toUpperCase()} [scope=${scopingShift || 'ALL/BOTH'}]: ${shiftDays} day(s) [${start.format('ddd DD/MM')} → ${end.format('ddd DD/MM')}]`);
    logger.info(`   Patrol query (±${SHIFT_GRACE_MINUTES}min grace): ${patrolQueryStart.format('DD/MM HH:mm')} → ${patrolQueryEnd.format('DD/MM HH:mm')}`);
    logger.info(`   Incident window: ${incidentQueryStart.format('DD/MM HH:mm')} → ${incidentQueryEnd.format('DD/MM HH:mm')}`);

    return {
      patrolStartUTC:    patrolQueryStart.utc().toDate(),
      patrolEndUTC:      patrolQueryEnd.utc().toDate(),
      incidentStartUTC:  incidentQueryStart.utc().toDate(),
      incidentEndUTC:    incidentQueryEnd.utc().toDate(),
      patrolQueryStart,
      patrolQueryEnd,
      incidentQueryStart,
      incidentQueryEnd,
      shiftDays,
      displayStart,
      displayEnd,
      reportType,
      normShiftType,     // client's configured shift — informational only
      scopingShiftType: scopingShift,   // ✅ the shift actually used to build the window above (null/both/day/night)
      isValid: true
    };
  } catch (error) {
    logger.error("Date validation error:", error.message);
    throw error;
  }
}

// ========== WEEKLY WINDOW HELPER ==========

function getLastCompletedWeekStart(now) {
  const today    = now.startOf('day');
  const daysBack = (today.day() - WEEK_START_DAY + 7) % 7;
  let cursor = today.subtract(daysBack, 'day');

  for (let safety = 0; safety < 10; safety++) {
    const closingTime = cursor.add(7, 'day').hour(SHIFT_END_HOUR).minute(0).second(0);
    if (now.isAfter(closingTime) || now.isSame(closingTime)) return cursor;
    cursor = cursor.subtract(7, 'day');
  }

  logger.warn(`[weekStart] Safety limit reached, using cursor=${cursor.format('ddd DD/MM/YYYY')}`);
  return cursor;
}

// ========== DATE RANGE GENERATORS ==========

function generateDateRangeForReportType(reportType, endDate = null) {
  const now = endDate ? dayjs.tz(endDate, TZ) : dayjs.tz(TZ);

  const lastEvening = now.hour() >= SHIFT_END_HOUR
    ? now.subtract(1, 'day').startOf('day')
    : now.subtract(2, 'day').startOf('day');

  logger.info(`📅 Now: ${now.format('YYYY-MM-DD HH:mm')} | Last completed day: ${lastEvening.format('ddd DD/MM/YYYY')}`);

  switch (reportType.toLowerCase()) {
    case 'daily':
      return { startDate: lastEvening.format('YYYY-MM-DD'), endDate: lastEvening.format('YYYY-MM-DD') };

    case 'weekly':
    case 'last7days': {
      const weekStart  = getLastCompletedWeekStart(now);
      const weekEnd    = weekStart.add(6, 'day');
      return { startDate: weekStart.format('YYYY-MM-DD'), endDate: weekEnd.format('YYYY-MM-DD') };
    }

    case 'monthly': {
      const monthStart = lastEvening.startOf('month');
      return { startDate: monthStart.format('YYYY-MM-DD'), endDate: lastEvening.format('YYYY-MM-DD') };
    }

    case 'last30days': {
      const start30 = lastEvening.subtract(29, 'day');
      return { startDate: start30.format('YYYY-MM-DD'), endDate: lastEvening.format('YYYY-MM-DD') };
    }

    case 'lastmonth': {
      const prevMonth      = lastEvening.subtract(1, 'month');
      const prevMonthStart = prevMonth.startOf('month');
      const prevMonthEnd   = prevMonth.endOf('month').startOf('day');
      return { startDate: prevMonthStart.format('YYYY-MM-DD'), endDate: prevMonthEnd.format('YYYY-MM-DD') };
    }

    default:
      throw new Error(`Unsupported report type: ${reportType}`);
  }
}

// ========== EVENT FILTERING ==========
function filterV04PatrolsByDateRange(events, dates) {
  const filteredEvents = [];
  const dropReasons    = { invalidDate: 0, notV04: 0, outsideWindow: 0 };

  for (const event of events) {
    try {
      const eventDate = parseEventDate(event.rec_tfechahora);
      if (!eventDate || !eventDate.isValid()) { dropReasons.invalidDate++; continue; }

      const alarmCode = (event.rec_calarma || '').toString().trim().toUpperCase();
      if (alarmCode !== PATROL_ARRIVAL_CODE) { dropReasons.notV04++; continue; }

      if (eventDate.isBetween(dates.patrolQueryStart, dates.patrolQueryEnd, null, '[)')) {
        filteredEvents.push(event);
      } else {
        dropReasons.outsideWindow++;
      }
    } catch (error) {
      dropReasons.invalidDate++;
      logger.warn(`⚠️ Event processing error id=${event.rec_iid}: ${error.message}`);
    }
  }

  logger.info(`📅 V04 Patrols: ${events.length} total → ${filteredEvents.length} in range`);
  logger.info(`   Dropped: ${dropReasons.invalidDate} bad-date | ${dropReasons.notV04} non-V04 | ${dropReasons.outsideWindow} outside-range`);

  filteredEvents._dropReasons = dropReasons;
  return filteredEvents;
}

// ========== FIX 24: CHRONOLOGICAL SORT ==========
function sortPatrolEventsChronologically(events) {
  const dropReasons = events._dropReasons;
  events.sort((a, b) => {
    const da = parseEventDate(a.rec_tfechahora);
    const db = parseEventDate(b.rec_tfechahora);
    if (!da || !da.isValid()) return 1;
    if (!db || !db.isValid()) return -1;
    return da.valueOf() - db.valueOf();
  });
  if (dropReasons) events._dropReasons = dropReasons;
  return events;
}

function countV04Patrols(events) {
  const counts       = new Map();
  let skippedUnknown = 0;

  for (const event of events) {
    try {
      const alarm = (event.rec_calarma || '').toString().trim().toUpperCase();
      if (alarm !== PATROL_ARRIVAL_CODE) continue;

      const rawCode = String(event.rec_czona || '').trim();
      if (isUnknownZone(rawCode)) { skippedUnknown++; continue; }

      const zoneCode = normalizeZoneCode(rawCode);
      counts.set(zoneCode, (counts.get(zoneCode) || 0) + 1);
    } catch { /* skip malformed */ }
  }

  const totalCounted = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  logger.info(`🔢 V04 counted: ${totalCounted} across ${counts.size} zones (skipped ${skippedUnknown} invalid/unknown)`);

  counts._skippedUnknown  = skippedUnknown;
  counts._skippedUnmapped = 0;
  return counts;
}

// ========== ZONE LOOKUP HELPERS ==========

function resolveZoneName(rawCode, zoneMap) {
  if (!rawCode || !zoneMap) return null;
  const norm    = normalizeZoneCode(rawCode);
  const padded2 = norm.padStart(2, '0');
  const padded3 = norm.padStart(3, '0');
  return (
    zoneMap.get(norm)  || zoneMap.get(padded2) || zoneMap.get(padded3) ||
    zoneMap.get(rawCode) || zoneMap.get(rawCode.toUpperCase()) || zoneMap.get(rawCode.toLowerCase()) ||
    null
  );
}

function registerZone(rawCode, zoneName, zoneMap) {
  const norm    = normalizeZoneCode(rawCode);
  const padded2 = norm.padStart(2, '0');
  const padded3 = norm.padStart(3, '0');
  for (const key of [norm, padded2, padded3, rawCode, rawCode.toUpperCase(), rawCode.toLowerCase()]) {
    zoneMap.set(key, zoneName);
  }
}

// ========== ZONE DATA ==========
async function fetchZoneData(clientId) {
  const cacheKey = `zones_${clientId}`;
  const cached   = zoneCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < API_CACHE_TTL) {
    logger.info(`📦 Zone cache HIT for client ${clientId}: ${cached.data.allPosts.length} posts`);
    return cached.data;
  }

  let apiSuccess = false, apiZones = [], allPosts = [];
  const zoneMap = new Map();

  const isAlarmZone = (name) => {
    const n = name.toUpperCase().trim();
    return n.startsWith('SMARTPANIC') || n === 'NO' || n === 'SOS' ||
           n === 'FIRE ALARM' || n.startsWith('FIRE ALARM') ||
           n === 'MEDICAL' || n.startsWith('MEDICAL EMERGENCY') ||
           n === 'PANIC' || n.startsWith('PANIC BUTTON') ||
           n === 'ON MY WAY' || n === 'CANCELLATION' ||
           n === 'TIME START' || n === 'TIME RESTART';
  };

  try {
    apiZones = await withRetry(() => bmSecurityAPI.getClientZones(clientId), API_RETRY_ATTEMPTS, API_RETRY_DELAY_MS, `getClientZones(${clientId})`);

    if (apiZones && Array.isArray(apiZones) && apiZones.length > 0) {
      let skippedAlarm = 0;
      for (const zone of apiZones) {
        const rawCode  = String(zone.code || zone.zoneCode || '').trim();
        const zoneName = String(zone.name || zone.zoneName || '').trim();
        if (!rawCode || !zoneName) continue;
        if (isAlarmZone(zoneName)) { skippedAlarm++; continue; }
        const zoneCode = normalizeZoneCode(rawCode);
        allPosts.push({ zoneCode, zoneName, source: 'API', id: zone.id || null, partition: zone.partition || null, enabled: zone.enabled !== undefined ? zone.enabled : true });
        registerZone(zoneCode, zoneName, zoneMap);
      }
      if (allPosts.length > 0) {
        apiSuccess = true;
        logger.info(`✅ API zones: ${allPosts.length} patrol zones (${skippedAlarm} alarm zones skipped)`);
      }
    }
  } catch (apiError) {
    logger.warn(`⚠️ API zone fetch failed: ${apiError.message} — falling back to database`);
  }

  if (!apiSuccess || allPosts.length === 0) {
    try {
      const pool   = await poolPromise;
      const result = await pool.request()
        .input('clientId', sql.Int, clientId)
        .query(`
          SELECT zon_ccodigo AS ZoneCode, LTRIM(RTRIM(zon_cdescripcion)) AS ZoneName
          FROM [_Datos].[dbo].[m_zonas]
          WHERE zon_iidcuenta = @clientId
            AND zon_cdescripcion IS NOT NULL AND zon_cdescripcion != ''
            AND UPPER(LTRIM(RTRIM(zon_cdescripcion))) NOT LIKE '%SMARTPANIC%'
            AND UPPER(LTRIM(RTRIM(zon_cdescripcion))) NOT LIKE '%PANIC%'
            AND UPPER(LTRIM(RTRIM(zon_cdescripcion))) NOT LIKE '%SOS%'
            AND UPPER(LTRIM(RTRIM(zon_cdescripcion))) NOT LIKE '%ON MY WAY%'
            AND UPPER(LTRIM(RTRIM(zon_cdescripcion))) NOT LIKE '%CANCELLATION%'
            AND UPPER(LTRIM(RTRIM(zon_cdescripcion))) NOT LIKE '%TIME START%'
            AND UPPER(LTRIM(RTRIM(zon_cdescripcion))) NOT LIKE '%TIME RESTART%'
          ORDER BY zon_cdescripcion
        `);
      for (const zone of result.recordset) {
        if (!zone.ZoneCode || !zone.ZoneName) continue;
        const zoneCode = normalizeZoneCode(String(zone.ZoneCode).trim());
        const zoneName = String(zone.ZoneName).trim();
        allPosts.push({ zoneCode, zoneName, source: 'DATABASE_FALLBACK' });
        registerZone(zoneCode, zoneName, zoneMap);
      }
      logger.info(`🗄️ Database fallback: ${allPosts.length} zones`);
    } catch (dbError) {
      logger.error(`❌ Database fallback FAILED: ${dbError.message}`);
    }
  }

  if (allPosts.length === 0) {
    try {
      const now = new Date();
      for (let i = 0; i <= 5; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const table = `p_recepcion${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
        try {
          const r = await (await poolPromise).request()
            .input('cid', sql.Int, parseInt(clientId))
            .query(`
              SELECT DISTINCT LTRIM(RTRIM(rec_czona)) AS zoneCode
              FROM [_Datos].[dbo].[${table}]
              WHERE rec_iidcuenta = @cid AND rec_calarma = 'V04'
                AND rec_czona IS NOT NULL AND LTRIM(RTRIM(rec_czona)) != ''
                AND LTRIM(RTRIM(rec_czona)) != '0'
                AND UPPER(LTRIM(RTRIM(rec_czona))) != 'UNKNOWN_ZONE'
              GROUP BY rec_czona
            `);
          for (const row of r.recordset) {
            const code = normalizeZoneCode(String(row.zoneCode).trim());
            if (code && !isUnknownZone(code) && !allPosts.find(p => p.zoneCode === code)) {
              allPosts.push({ zoneCode: code, zoneName: `Zone ${code}`, source: 'PATROL_EVENTS' });
              registerZone(code, `Zone ${code}`, zoneMap);
            }
          }
        } catch { /* table may not exist */ }
      }
      if (allPosts.length > 0) logger.warn(`⚠️ Using ${allPosts.length} PLACEHOLDER zone names`);
    } catch (e) {
      logger.error(`❌ Dynamic zone build failed: ${e.message}`);
    }
  }

  const source = apiSuccess ? 'API' : (allPosts.length > 0 ? 'DATABASE_FALLBACK' : 'EMPTY');
  const data   = { allPosts, zoneMap, source, count: allPosts.length };
  zoneCache.set(cacheKey, { data, timestamp: Date.now() });
  logger.info(`✅ Zone data READY: ${allPosts.length} posts (source: ${source})`);
  return data;
}

// ========== GHOST ZONE HELPERS ==========

function filterGhostZones(allPosts, patrolCounts, minPatrols = 1) {
  return allPosts.filter(post => {
    const norm = normalizeZoneCode(post.zoneCode);
    return Math.max(
      patrolCounts.get(norm) || 0, patrolCounts.get(norm.padStart(2,'0')) || 0,
      patrolCounts.get(norm.padStart(3,'0')) || 0, patrolCounts.get(post.zoneCode) || 0
    ) >= minPatrols;
  });
}

function markGhostZones(allPosts, patrolCounts) {
  return allPosts.map(post => {
    const norm = normalizeZoneCode(post.zoneCode);
    return { ...post, isGhost: Math.max(
      patrolCounts.get(norm) || 0, patrolCounts.get(norm.padStart(2,'0')) || 0,
      patrolCounts.get(norm.padStart(3,'0')) || 0, patrolCounts.get(post.zoneCode) || 0
    ) === 0 };
  });
}

function clearZoneCache(clientId = null) {
  if (clientId) {
    const key = `zones_${clientId}`;
    if (zoneCache.has(key)) { zoneCache.delete(key); logger.info(`🧹 Cleared zone cache for client ${clientId}`); }
  } else {
    const size = zoneCache.size; zoneCache.clear();
    if (size > 0) logger.info(`🧹 Cleared all zone cache (${size} entries)`);
  }
}

// ========== EVENT DESCRIPTIONS ==========

async function fetchEventDescriptions() {
  if (eventMapCache.data && Date.now() - eventMapCache.timestamp < DB_CACHE_TTL) return eventMapCache.data;
  try {
    const pool   = await poolPromise;
    const result = await pool.request().query(`
      SELECT for_calarma AS AlarmCode, LTRIM(RTRIM(for_cdescripcion)) AS EventDescription
      FROM [_Datos].[dbo].[m_formatos]
      WHERE for_cdescripcion IS NOT NULL AND for_cdescripcion != ''
    `);
    const eventMap = new Map();
    result.recordset.forEach(e => { if (e.AlarmCode) eventMap.set(e.AlarmCode.trim().toUpperCase(), e.EventDescription); });
    eventMapCache.data = eventMap; eventMapCache.timestamp = Date.now();
    return eventMap;
  } catch (error) {
    logger.error(`Error fetching event descriptions:`, error.message);
    return new Map();
  }
}

function formatPatrolEvent(event, zoneMap, eventMap) {
  try {
    const parsedDate = parseEventDate(event.rec_tfechahora);
    const eventDate  = parsedDate?.isValid() ? parsedDate.format('DD/MM/YYYY') : 'N/A';
    const eventTime  = parsedDate?.isValid() ? parsedDate.format('HH:mm:ss')   : 'N/A';

    if (isUnknownZone(event.rec_czona)) return null;

    const zoneCode     = normalizeZoneCode(String(event.rec_czona).trim());
    const resolvedName = resolveZoneName(zoneCode, zoneMap);
    const zoneName     = resolvedName || `Zone ${zoneCode}`;

    const alarmCode = (event.rec_calarma || '').toString().trim().toUpperCase();
    const eventDescription =
      alarmCode === PATROL_ARRIVAL_CODE ? 'VigiControl Arrival' :
      eventMap.get(alarmCode) || alarmCode || 'Unknown Event';

    return { Date: eventDate, Time: eventTime, Event: eventDescription, Zone: zoneName, ZoneCode: zoneCode, AlarmCode: alarmCode, Type: 'PATROL' };
  } catch (error) {
    logger.error(`Error formatting patrol event:`, error.message);
    return null;
  }
}

// ========== FETCH PATROL EVENTS — DB-ONLY (dbo.PatrolEventsArchive) ═══════
// ✅ FIX 28: This is now the ONLY patrol-event source used by
// fetchPatrolReport. eventArchiveJob.js is solely responsible for keeping
// this table fresh from the BM Security API on its own schedule; this
// function never talks to the API and never reads the BM-owned
// p_recepcionYYYYMM partition tables.
async function fetchPatrolEventsFromArchiveStore(clientId, startDate, endDate) {
  const rawRows = await fetchEventsFromArchive(clientId, startDate, endDate);

  if (!rawRows || rawRows.length === 0)
    return { patrolEvents: [], completedCounts: new Map(), source: 'ARCHIVE_EMPTY' };

  const patrolEvents    = rawRows;
  const completedCounts = countV04Patrols(patrolEvents);

  logger.info(`📦 PatrolEventsArchive: ${patrolEvents.length} events (${completedCounts.size} zones with V04)`);
  return { patrolEvents, completedCounts, source: 'ARCHIVE' };
}

async function fetchIncidentsFromModel(clientId, startDate, endDate) {
  try {
    const incidentResult = await getIncidentCount(clientId, startDate, endDate);
    if (!incidentResult.success) { logger.warn(`⚠️ Incident model: ${incidentResult.error}`); return { incidents: [], total: 0 }; }
    return {
      incidents: incidentResult.incidents.map(i => ({
        id: i.id, date: i.date, zone: i.zone,
        report: i.observations || i.content || 'No details available',
        type: 'INCIDENT_REPORT', alarmCode: INCIDENT_CODE
      })),
      total: incidentResult.totalIncidents
    };
  } catch (error) {
    logger.error(`❌ Incident fetch error:`, error.message);
    return { incidents: [], total: 0 };
  }
}

// ========== PERFORMANCE CALC ==========

// ✅ FIX 30: CAP COMPLETED AT EXPECTED — a guard who patrols more often
// than the client's configured Patrols/Day (e.g. expected=11 but the raw
// V04 count for the period is 17) previously inflated Completed past
// Expected, producing performance >100% (e.g. "17/11 = 155%"). That's
// confusing on the client-facing PDF and makes the expected-vs-actual
// numbers hard to trust at a glance. This caps the DISPLAYED Completed
// count at Expected — the true raw patrol count is preserved separately
// as RawCompleted for anyone who needs the real number (debugging,
// internal QA), it's just not what gets shown as "Completed" or used to
// compute Performance %/isGhost.
function calculatePerformance(allPosts, patrolCounts, expectedPatrolsPerPost) {
  const performanceData = [];
  let totalCompleted = 0, totalExpected = 0, underperformingZones = 0, excellentZones = 0;

  for (const post of allPosts) {
    const norm = normalizeZoneCode(post.zoneCode);
    const rawCompleted =
      patrolCounts.get(norm)                 || patrolCounts.get(norm.padStart(2,'0')) ||
      patrolCounts.get(norm.padStart(3,'0')) || patrolCounts.get(post.zoneCode) || 0;
    const expected  = expectedPatrolsPerPost;
    const completed = expected > 0 ? Math.min(rawCompleted, expected) : rawCompleted;
    const percentage = expected > 0 ? (completed / expected) * 100 : 0;
    if (percentage < 70) underperformingZones++;
    if (percentage >= 90) excellentZones++;
    if (rawCompleted > expected) {
      logger.info(`📌 FIX30: [${post.zoneCode}] "${post.zoneName}" raw=${rawCompleted} > expected=${expected} — capped Completed to ${completed}`);
    }

    // ✅ FIX 31: zero-patrol zones are kept (not dropped) and labeled
    // based only on data we actually have — see the FIX 31 header comment
    // at the top of this file for what each status means and why.
    let zoneStatus = 'ACTIVE';
    if (rawCompleted === 0) {
      if (isPlaceholderZoneName(post.zoneName))    zoneStatus = 'UNKNOWN_ZONE';
      else if (post.source && post.source !== 'API') zoneStatus = 'DELETED_FROM_API';
      else                                            zoneStatus = 'ACTIVE_NO_PATROLS';
    }

    performanceData.push({
      SecurityPost: post.zoneName, ZoneCode: post.zoneCode,
      Completed: completed, Expected: expected, RawCompleted: rawCompleted,
      Performance: Math.round(percentage), Percentage: Math.round(percentage) + '%',
      Type: 'PATROL_PERFORMANCE', isGhost: rawCompleted === 0,
      ZoneStatus: zoneStatus, ZoneSource: post.source || 'UNKNOWN',
    });
    totalCompleted += Number(completed) || 0;
    totalExpected  += expected;
  }

  const overallRateNumeric = totalExpected > 0 ? (totalCompleted / totalExpected) * 100 : 0;
  const overallRate        = Math.round(overallRateNumeric);
  logger.info(`📊 Performance: ${totalCompleted}/${totalExpected} = ${overallRate}%`);
  return { performanceData, totalCompleted, totalExpected, overallRateNumeric, overallRate, underperformingZones, excellentZones, totalZones: performanceData.length };
}

// ========== AUTO-DETECT PATROLS PER DAY ==========
function autoDetectPatrolsPerDay(filteredPatrols, zoneCount, shiftDays) {
  if (!filteredPatrols || filteredPatrols.length === 0 || zoneCount === 0 || shiftDays === 0) {
    logger.warn(`⚠️ AUTO-DETECT: No patrol data — defaulting to 1 patrol/day`);
    return { patrolsPerDay: 1, source: 'AUTO_DETECT_DEFAULT', note: 'No events; using safe default of 1' };
  }

  const dayZoneMap = new Map();
  for (const event of filteredPatrols) {
    const eventDate = parseEventDate(event.rec_tfechahora);
    if (!eventDate?.isValid()) continue;
    if ((event.rec_calarma || '').toString().trim().toUpperCase() !== PATROL_ARRIVAL_CODE) continue;
    const rawCode = String(event.rec_czona || '').trim();
    if (isUnknownZone(rawCode)) continue;

    const dayLabel = eventDate.format('YYYY-MM-DD');
    const zoneCode = normalizeZoneCode(rawCode);
    if (!dayZoneMap.has(dayLabel)) dayZoneMap.set(dayLabel, new Map());
    const zoneCountMap = dayZoneMap.get(dayLabel);
    zoneCountMap.set(zoneCode, (zoneCountMap.get(zoneCode) || 0) + 1);
  }

  if (dayZoneMap.size === 0) {
    logger.warn(`⚠️ AUTO-DETECT: Could not parse event dates — defaulting to 1 patrol/day`);
    return { patrolsPerDay: 1, source: 'AUTO_DETECT_DEFAULT', note: 'Could not parse event dates; using safe default of 1' };
  }

  const allCounts = [];
  for (const [, zoneCountMap] of dayZoneMap) for (const [, count] of zoneCountMap) allCounts.push(count);
  allCounts.sort((a, b) => a - b);
  const mid    = Math.floor(allCounts.length / 2);
  const median = allCounts.length % 2 === 0 ? (allCounts[mid-1] + allCounts[mid]) / 2 : allCounts[mid];
  const patrolsPerDay = Math.max(1, Math.ceil(median));

  logger.info(`🔍 AUTO-DETECT: ${allCounts.length} samples | median=${median} → patrolsPerDay=${patrolsPerDay}`);
  return { patrolsPerDay, source: 'AUTO_DETECT', note: `Auto-detected from ${allCounts.length} patrol samples (median ${median.toFixed(1)})` };
}

// ========== SCHEDULE RESOLUTION ==========
async function fetchClientScheduleAndExpectedPatrols(clientId, dates, filteredPatrols = [], zoneCount = 0) {
  const cacheKey = `schedule_${clientId}_${dates.patrolStartUTC.toISOString()}_${dates.patrolEndUTC.toISOString()}`;
  const cached   = scheduleCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < DB_CACHE_TTL) return cached.data;

  let patrolsPerDay     = null;
  let shiftType         = null;
  let patrolDays        = 'Mon,Tue,Wed,Thu,Fri,Sat,Sun';
  let hasCustomSchedule = false;
  let configSource      = 'NONE';

  try {
    const scheduleResult = await getPatrolScheduleConfig(clientId);
    if (scheduleResult.success && scheduleResult.data) {
      const s = scheduleResult.data;
      if (s.PatrolsPerDay !== null && s.PatrolsPerDay !== undefined) {
        const candidate = Number(s.PatrolsPerDay);
        if (Number.isFinite(candidate) && candidate >= 1) {
          patrolsPerDay     = candidate;
          shiftType         = normaliseShiftType(s.ShiftType);
          patrolDays        = s.PatrolDays        ?? patrolDays;
          hasCustomSchedule = s.HasCustomSchedule ?? false;
          configSource      = `getPatrolScheduleConfig:${s.ConfigSource ?? 'schedule_config'}`;
          logger.info(`✅ SCHEDULE RESOLVED (primary) client=${clientId} patrolsPerDay=${patrolsPerDay} shiftType=${shiftType ?? 'NOT SET'}`);
        }
      }
    }
  } catch (e) {
    logger.error(`❌ getPatrolScheduleConfig threw for client ${clientId}: ${e.message}`);
  }

  if (patrolsPerDay === null) {
    try {
      const ds = await getClientSchedule(clientId);
      if (ds?.patrols_per_day !== null && ds?.patrols_per_day !== undefined) {
        const candidate = Number(ds.patrols_per_day);
        if (Number.isFinite(candidate) && candidate >= 1) {
          patrolsPerDay     = candidate;
          shiftType         = normaliseShiftType(ds.shift_type);
          patrolDays        = ds.patrol_days         ?? patrolDays;
          hasCustomSchedule = ds.has_custom_schedule ?? false;
          configSource      = `getClientSchedule:${ds.config_source ?? 'unknown'}`;
          logger.info(`✅ SCHEDULE RESOLVED (legacy) client=${clientId} patrolsPerDay=${patrolsPerDay} shiftType=${shiftType ?? 'NOT SET'}`);
        }
      }
    } catch (e) {
      logger.error(`❌ Legacy getClientSchedule threw for client ${clientId}: ${e.message}`);
    }
  }

  if (patrolsPerDay === null) {
    const detected = autoDetectPatrolsPerDay(filteredPatrols, zoneCount, dates.shiftDays);
    patrolsPerDay     = detected.patrolsPerDay;
    configSource      = detected.source;
    hasCustomSchedule = false;
  }

  const expectedPatrolsPerPost = dates.shiftDays * patrolsPerDay;
  logger.info(`📅 Expected patrols: ${dates.shiftDays} × ${patrolsPerDay} = ${expectedPatrolsPerPost} per post [shiftType: ${shiftType ?? 'NOT SET'}]`);

  const result = {
    shiftType,
    expectedPatrolsPerPost,
    patrolsPerDay,
    patrolDays,
    hasCustomSchedule,
    configSource,
    scheduleInfo: `${patrolsPerDay} patrols/day per post`,
    shiftDays:    dates.shiftDays,
    calculation:  `${dates.shiftDays} × ${patrolsPerDay} = ${expectedPatrolsPerPost} per post`,
  };
  scheduleCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

// ========== CLIENT LOOKUP ==========

async function resolveClientId(clientIdOrName) {
  if (/^\d+$/.test(String(clientIdOrName).trim())) return parseInt(clientIdOrName, 10);

  logger.info(`🔍 Resolving client by name: "${clientIdOrName}"`);
  try {
    const clients    = await withRetry(() => bmSecurityAPI.getClients(), API_RETRY_ATTEMPTS, API_RETRY_DELAY_MS, `getClients`);
    const searchName = String(clientIdOrName).trim().toUpperCase();
    const found      = clients.find(c => c.name && c.name.trim().toUpperCase() === searchName);
    if (found) { logger.info(`✅ Resolved "${clientIdOrName}" → ID ${found.id}`); return parseInt(found.id, 10); }
  } catch (err) {
    logger.warn(`⚠️ API name lookup failed: ${err.message} — trying database`);
  }

  try {
    const pool   = await poolPromise;
    const result = await pool.request()
      .input('name', sql.NVarChar, String(clientIdOrName).trim())
      .query(`SELECT TOP 1 cue_iid AS id FROM [_Datos].[dbo].[m_cuentas] WHERE LTRIM(RTRIM(cue_cnombre)) = LTRIM(RTRIM(@name))`);
    if (result.recordset.length > 0) {
      const id = parseInt(result.recordset[0].id, 10);
      logger.info(`✅ DB resolved "${clientIdOrName}" → ID ${id}`);
      return id;
    }
  } catch (dbErr) {
    logger.error(`❌ DB name lookup failed: ${dbErr.message}`);
  }

  throw new Error(`Client not found: "${clientIdOrName}"`);
}

// ========== CLIENT INFO ==========

async function getClientInfo(clientId, dates = null, zoneData = null, performanceResults = null) {
  try {
    const apiClients = await withRetry(() => bmSecurityAPI.getClients(), API_RETRY_ATTEMPTS, API_RETRY_DELAY_MS, `getClients for clientInfo(${clientId})`);
    const apiClient  = apiClients.find(c => String(c.id) === String(clientId));
    let clientName = 'Unknown', accountNumber = null;

    if (apiClient) {
      clientName    = apiClient.name || 'Unknown';
      accountNumber = apiClient.accountNumber ? String(apiClient.accountNumber).trim() : null;
    } else {
      const pool   = await poolPromise;
      const result = await pool.request()
        .input("clientId", sql.Int, parseInt(clientId))
        .query(`SELECT LTRIM(RTRIM(cue_cnombre)) AS name, LTRIM(RTRIM(cue_ncuenta)) AS accountNumber FROM [_Datos].[dbo].[m_cuentas] WHERE cue_iid = @clientId`);
      if (result.recordset.length > 0) {
        clientName    = result.recordset[0].name || 'Unknown';
        accountNumber = result.recordset[0].accountNumber ? String(result.recordset[0].accountNumber).trim() : null;
      } else {
        throw new Error(`Client not found with ID: ${clientId}`);
      }
    }

    let patrolSchedule = null;
    if (dates) {
      try {
        const sd = await fetchClientScheduleAndExpectedPatrols(clientId, dates);
        patrolSchedule = {
          shiftType:         sd.shiftType,
          patrolsPerDay:     sd.patrolsPerDay,
          patrolDays:        sd.patrolDays,
          hasCustomSchedule: sd.hasCustomSchedule,
          expectedPerPost:   sd.expectedPatrolsPerPost,
          description:       sd.scheduleInfo,
          calculation:       sd.calculation,
          configSource:      sd.configSource,
        };
      } catch (e) {
        patrolSchedule = {
          shiftType:         null,
          patrolsPerDay:     1,
          patrolDays:        'N/A',
          hasCustomSchedule: false,
          expectedPerPost:   dates.shiftDays,
          description:       'WARNING: Could not resolve patrol schedule — using default',
          calculation:       'AUTO-DETECT',
          configSource:      'AUTO_DETECT',
          error:             e.message,
        };
      }
    }

    let performanceOverview = null;
    if (dates && zoneData && performanceResults) {
      try {
        const totalPosts = zoneData.allPosts.length;
        const ghostCount = performanceResults.performanceData.filter(p => p.isGhost).length;
        performanceOverview = {
          reportPeriod: { startDate: dates.displayStart, endDate: dates.displayEnd, shiftDays: dates.shiftDays, reportType: dates.reportType.toUpperCase() },
          securityPosts: {
            total: totalPosts, active: totalPosts - ghostCount, ghosts: ghostCount,
            excellent: performanceResults.excellentZones, underperforming: performanceResults.underperformingZones,
            excellentPercentage:      performanceResults.totalZones > 0 ? Math.round((performanceResults.excellentZones/performanceResults.totalZones)*100) : 0,
            underperformingPercentage: performanceResults.totalZones > 0 ? Math.round((performanceResults.underperformingZones/performanceResults.totalZones)*100) : 0,
          },
          patrolPerformance: {
            completed: performanceResults.totalCompleted, expected: performanceResults.totalExpected,
            percentage: performanceResults.overallRate, percentageNumeric: performanceResults.overallRateNumeric,
            status: performanceResults.overallRateNumeric >= 90 ? 'Excellent' : performanceResults.overallRateNumeric >= 70 ? 'Good' : performanceResults.overallRateNumeric >= 50 ? 'Fair' : 'Needs Improvement',
          },
          expectations: patrolSchedule ? { perPost: patrolSchedule.expectedPerPost, total: patrolSchedule.expectedPerPost * performanceResults.totalZones, dailyRate: patrolSchedule.patrolsPerDay } : null,
          ghostZones: ghostCount,
        };
      } catch (e) { logger.warn(`⚠️ Could not build performance overview: ${e.message}`); }
    }

    return { clientName, clientId: parseInt(clientId), accountNumber, patrolSchedule, performanceOverview };
  } catch (error) {
    logger.error("❌ Client lookup error:", error.message);
    throw error;
  }
}

// ========== MAIN REPORT FUNCTION ==========
// ✅ FIX 26/27: optional 6th parameter `requestedShiftType`
// ('day' | 'night' | 'both' | null). Explicitly scopes THIS report's
// query window. As of FIX 27: if the caller does NOT pass this (null),
// the scoping now defaults to the CLIENT'S configured shift type instead
// of defaulting to "everything" — this is what fixes the "Day Shift
// report containing night events" bug. Pass 'both' explicitly if you
// truly want the full 24hr window regardless of the client's configured
// shift.
const fetchPatrolReport = async (clientIdOrName, startDate, endDate, usePartitions = true, reportType = DEFAULT_REPORT_TYPES.CUSTOM, requestedShiftType = null) => {
  const reportStartTime = Date.now();
  try {
    if (!clientIdOrName || !startDate || !endDate)
      throw new Error("clientId/client, startDate, endDate are required");

    const clientId   = await resolveClientId(clientIdOrName);
    const cleanStart = String(startDate).split('T')[0];
    const cleanEnd   = String(endDate).split('T')[0];

    // Client's configured shift type — resolved FIRST now, because as of
    // FIX 27 it doubles as the default scoping when nothing explicit was
    // requested (previously this was purely informational and resolved
    // after the scoping decision, which is exactly how a Day-labeled
    // report ended up querying the full 24hr window).
    let earlyShiftType = null;
    try {
      const earlySchedule = await getPatrolScheduleConfig(clientId);
      if (earlySchedule.success && earlySchedule.data?.ShiftType) {
        earlyShiftType = normaliseShiftType(earlySchedule.data.ShiftType);
      }
    } catch (e) {
      logger.warn(`⚠️ Could not resolve shift type early: ${e.message}`);
    }

    // ✅ FIX 27: explicit request wins; otherwise fall back to the
    // client's configured shift; otherwise (no config at all) fall back
    // to the old full-day/"both" behavior. A caller that wants the old
    // "always full day" behavior regardless of client config must now
    // explicitly pass requestedShiftType: 'both'.
    const explicitScope = requestedShiftType ? normaliseShiftType(requestedShiftType) : null;
    const scopingShiftType = explicitScope || earlyShiftType || null;

    logger.info(`🚀 ${reportType.toUpperCase()} report for client ${clientId}: ${cleanStart} → ${cleanEnd} [requested=${explicitScope || 'none'} | clientConfigured=${earlyShiftType ?? 'NOT SET'} | resolvedScope=${scopingShiftType || 'ALL/BOTH'}]`);
    logger.info(`📋 Client configured shift: "${earlyShiftType ?? 'NOT SET'}" | Report actually scoped to: "${scopingShiftType || 'ALL/BOTH'}"`);

    const dates           = validateAndFormatDates(cleanStart, cleanEnd, reportType, earlyShiftType, scopingShiftType);
    const basicClientInfo = await getClientInfo(clientId);
    logger.info(`✅ Client: ${basicClientInfo.clientName} | Days: ${dates.shiftDays} | Query scope: ${dates.scopingShiftType || 'ALL/BOTH'}`);

    // ── Site-level exclusion check (unchanged business rule) ─────────────────
    const exclusionEntry = isExcludedNightShiftSite(basicClientInfo.accountNumber, basicClientInfo.clientName);
    if (exclusionEntry) {
      logger.warn(`🚫 Client "${basicClientInfo.clientName}" EXCLUDED — ${exclusionEntry.reason}: ${exclusionEntry.note}`);
      return {
        posts: [], events: [], guardReports: [],
        metadata: {
          reportType: reportType.toUpperCase(),
          patrolDefinition: { patrolCode: PATROL_ARRIVAL_CODE, incidentCode: INCIDENT_CODE },
          client: {
            id: clientId, name: basicClientInfo.clientName, accountNumber: basicClientInfo.accountNumber,
            patrolSchedule: null, performanceOverview: null,
            zoneDataSource: 'EXCLUDED', zoneCount: 0, activeZoneCount: 0, excludedZoneCount: 0, ghostZoneCount: 0,
          },
          clientId, clientName: basicClientInfo.clientName, clientAccountNumber: basicClientInfo.accountNumber,
          startDate: dates.displayStart, endDate: dates.displayEnd, shiftDays: dates.shiftDays,
          totalExpectedPatrols: 0, totalCompletedPatrols: 0, overallPatrolPerformance: 0, totalIncidents: 0,
          patrolSource: 'EXCLUDED', incidentSource: 'EXCLUDED', zoneSource: 'EXCLUDED',
          generatedAt: new Date(), processingTime: Date.now() - reportStartTime, timezone: TZ,
          exclusion: { excluded: true, reason: exclusionEntry.reason, note: exclusionEntry.note, region: exclusionEntry.region },
          dataQuality: { isValid: false, separateSources: false, exclusionApplied: true },
          success: false,
        },
      };
    }

    const zoneData   = await fetchZoneData(clientId);
    const eventMap   = await fetchEventDescriptions();

    let patrolEvents = [], patrolCounts = new Map(), dataSource = 'UNKNOWN';
    let incidentData = { incidents: [], total: 0 };

    // ✅ FIX 28: patrol events read ONLY from dbo.PatrolEventsArchive.
    // No live API call, no p_recepcionYYYYMM partition-table read, here.
    // dates.patrolStartUTC/patrolEndUTC are already scoped to the correct
    // day/night/both window per FIX 26/27 above, so the archive query
    // itself never sees events outside the intended shift.
    const [patrolResult, incidentResult] = await Promise.allSettled([
      (async () => {
        const archiveData = await fetchPatrolEventsFromArchiveStore(clientId, dates.patrolStartUTC, dates.patrolEndUTC);
        dataSource = archiveData.source;
        if (archiveData.patrolEvents.length === 0) {
          logger.warn(`⚠️ PatrolEventsArchive returned 0 events for client ${clientId} in window ${dates.patrolQueryStart.format('DD/MM HH:mm')} → ${dates.patrolQueryEnd.format('DD/MM HH:mm')}. If this is unexpected, check that eventArchiveJob.js has ingested this date range.`);
        }
        return archiveData;
      })(),
      fetchIncidentsFromModel(clientId, dates.incidentStartUTC, dates.incidentEndUTC)
    ]);

    if (patrolResult.status === 'fulfilled')   { patrolEvents = patrolResult.value.patrolEvents; patrolCounts = patrolResult.value.completedCounts; }
    else logger.error(`❌ Patrol fetch failed:`, patrolResult.reason);
    if (incidentResult.status === 'fulfilled') incidentData = incidentResult.value;
    else logger.error(`❌ Incident fetch failed:`, incidentResult.reason);

    // ✅ FIX 26/27: patrolQueryStart/End are scoped per the resolved shift
    // (explicit request, else client-configured shift, else full day), so
    // this filter automatically respects Day/Night/Both — this is the
    // second, redundant-but-safe layer that guarantees no cross-shift
    // event can leak through even if the archive query window were ever
    // widened for some other reason.
    let filteredPatrols = filterV04PatrolsByDateRange(patrolEvents, dates);

    filteredPatrols = sortPatrolEventsChronologically(filteredPatrols);

    patrolCounts = countV04Patrols(filteredPatrols);

    const scheduleData           = await fetchClientScheduleAndExpectedPatrols(clientId, dates, filteredPatrols, zoneData.allPosts.length);
    const expectedPatrolsPerPost = scheduleData.expectedPatrolsPerPost;

    const enhancedCounts = new Map();
    for (const [zoneCode, count] of patrolCounts) {
      if (typeof count !== 'number') continue;
      const cleanCode = String(zoneCode).trim();
      if (isUnknownZone(cleanCode)) continue;
      enhancedCounts.set(cleanCode, count);
      const zoneName = resolveZoneName(cleanCode, zoneData.zoneMap);
      if (zoneName) enhancedCounts.set(zoneName, count);
    }

    const processedPatrolEvents = filteredPatrols
      .map(event => formatPatrolEvent(event, zoneData.zoneMap, eventMap))
      .filter(event => event && !(event.Date === 'N/A' && event.Zone === 'Unknown Post') && !isUnknownZone(event.ZoneCode));

    const dropReasons = filteredPatrols._dropReasons || {};

    let allRegisteredPosts = markGhostZones(zoneData.allPosts, enhancedCounts);

    const beforeZoneNameExclusion = allRegisteredPosts.length;
    const clientExclusionKey        = normaliseForZoneMatch(basicClientInfo.clientName || '');
    const hasAllowlistForClient     = !!getZoneAllowlistForClient(basicClientInfo.clientName);
    const hasExclusionListForClient = !hasAllowlistForClient && ZONE_NAME_EXCLUSIONS_BY_CLIENT.has(clientExclusionKey);

    if (hasAllowlistForClient || hasExclusionListForClient) {
      logger.info(`🔍 FIX23/25 debug: ${hasAllowlistForClient ? 'ALLOWLIST' : 'EXCLUSION'} active for key "${clientExclusionKey}"`);
      logger.info(`🔍 FIX23/25 debug: zone names present before filter: ${JSON.stringify(allRegisteredPosts.map(p => p.zoneName))}`);
    }

    allRegisteredPosts = allRegisteredPosts.filter(post =>
      isZoneNameAllowedForClient(basicClientInfo.clientName, post.zoneName) &&
      !isExcludedZoneNameForClient(basicClientInfo.clientName, post.zoneName)
    );
    const excludedZoneNameCount = beforeZoneNameExclusion - allRegisteredPosts.length;
    if (excludedZoneNameCount > 0) {
      logger.info(`🚫 FIX23/25: dropped ${excludedZoneNameCount} known-bad zone(s) for client "${basicClientInfo.clientName}"`);
    } else if (hasAllowlistForClient || hasExclusionListForClient) {
      logger.warn(`⚠️ FIX23/25: client has a zone filter configured but 0 zones were dropped — check the debug output above for a name mismatch`);
    }

    // ✅ FIX 31: zero-patrol ("ghost") zones are KEPT in the report — they
    // are no longer dropped (that was FIX 29, since reverted). They're
    // classified via ZoneStatus in calculatePerformance() below instead.
    // This block just logs the breakdown for visibility; it does not
    // filter allRegisteredPosts.
    const ghostPosts = allRegisteredPosts.filter(p => p.isGhost);
    const zeroPatrolCount = ghostPosts.length;
    if (zeroPatrolCount > 0) {
      const unknownCount = ghostPosts.filter(p => isPlaceholderZoneName(p.zoneName)).length;
      const deletedCount = ghostPosts.filter(p => !isPlaceholderZoneName(p.zoneName) && p.source && p.source !== 'API').length;
      const activeNoPatrolCount = zeroPatrolCount - unknownCount - deletedCount;
      logger.info(`👻 FIX31: ${zeroPatrolCount} zero-patrol zone(s) kept in report — ${unknownCount} UNKNOWN_ZONE, ${deletedCount} DELETED_FROM_API, ${activeNoPatrolCount} ACTIVE_NO_PATROLS:`);
      ghostPosts.forEach(p => logger.info(`   - [${p.zoneCode}] "${p.zoneName}" (source: ${p.source || 'UNKNOWN'})`));
    }

    const postCountOverride  = getPostCountOverride(basicClientInfo.accountNumber);
    const singlePostOverride = getSinglePostOverride(basicClientInfo.accountNumber, basicClientInfo.clientName);

    if (singlePostOverride && allRegisteredPosts.length > singlePostOverride.expectedPosts) {
      allRegisteredPosts = allRegisteredPosts.slice(0, singlePostOverride.expectedPosts);
      logger.warn(`⚠️ Single-post override: truncated to ${allRegisteredPosts.length} post(s)`);
    } else if (postCountOverride) {
      if (allRegisteredPosts.length > postCountOverride.expectedPosts) {
        allRegisteredPosts = allRegisteredPosts.slice(0, postCountOverride.expectedPosts);
        logger.warn(`⚠️ Post-count override: truncated to ${allRegisteredPosts.length} post(s)`);
      } else if (allRegisteredPosts.length < postCountOverride.expectedPosts) {
        logger.warn(`⚠️ Post-count override: only ${allRegisteredPosts.length} post(s) present, expected ${postCountOverride.expectedPosts}`);
      }
    }

    logger.info(`📋 Zones in report: ${allRegisteredPosts.length}/${zoneData.allPosts.length} (${excludedZoneNameCount} excluded as bad data, ${zeroPatrolCount} excluded as zero-patrol/stale)`);

    const performanceResults = calculatePerformance(allRegisteredPosts, enhancedCounts, expectedPatrolsPerPost);
    const clientInfo         = await getClientInfo(clientId, dates, zoneData, performanceResults);
    const totalTime          = Date.now() - reportStartTime;

    logger.info(`✅ Done in ${totalTime}ms | ${performanceResults.totalCompleted}/${expectedPatrolsPerPost * allRegisteredPosts.length} = ${performanceResults.overallRate}%`);
    logger.info(`   Client shiftType: ${scheduleData.shiftType ?? 'NOT SET'} | Report scope: ${dates.scopingShiftType || 'ALL/BOTH'} | patrolsPerDay: ${scheduleData.patrolsPerDay} | source: ${scheduleData.configSource}`);

    const windowDescription =
      dates.scopingShiftType === 'day'   ? `${DAY_SHIFT_START_HOUR}:00 → ${DAY_SHIFT_END_HOUR}:00 each day (Day Only — V04 events restricted to this window)` :
      dates.scopingShiftType === 'night' ? `${SHIFT_START_HOUR}:00 → ${String(SHIFT_END_HOUR).padStart(2,'0')}:00 next day (Night Only — V04 events restricted to this window)` :
      '00:00 → 23:59:59 each day (all V04 events, no shift restriction)';

    const result = {
      posts:        performanceResults.performanceData,
      events:       processedPatrolEvents,
      guardReports: incidentData.incidents,
      metadata: {
        client: {
          id:              clientInfo.clientId,
          name:            clientInfo.clientName,
          accountNumber:   clientInfo.accountNumber,
          patrolSchedule:  clientInfo.patrolSchedule,
          performanceOverview: clientInfo.performanceOverview,
          zoneDataSource:  zoneData.source,
          zoneCount:        zoneData.allPosts.length,
          activeZoneCount:  allRegisteredPosts.length - zeroPatrolCount,
          excludedZoneCount: excludedZoneNameCount,
          ghostZoneCount:   zeroPatrolCount,
        },
        reportType: reportType.toUpperCase(),
        shiftType:  scheduleData.shiftType,              // client's configured shift
        requestedShiftType: dates.scopingShiftType,       // ✅ what this specific report was ACTUALLY scoped/queried to — use this for the PDF title, not `shiftType` above
        weekConfig: {
          weekStartDay:     WEEK_START_DAY,
          weekStartDayName: WEEK_START_DAY_NAMES[WEEK_START_DAY],
        },
        patrolDefinition: {
          patrolCode:           PATROL_ARRIVAL_CODE,
          patrolWindow:          windowDescription,
          graceWindowMinutes:   SHIFT_GRACE_MINUTES,
          incidentCode:         INCIDENT_CODE,
          incidentWindow:       '00:00 → 23:59',
          shiftDays:            dates.shiftDays,
          patrolsPerDay:        scheduleData.patrolsPerDay,
          expectedPatrolsPerPost,
          scheduleConfigSource: scheduleData.configSource,
          normShiftType:        dates.normShiftType,
          requestedShiftType:   dates.scopingShiftType,
        },
        clientId:                clientInfo.clientId,
        clientName:              clientInfo.clientName,
        clientAccountNumber:     clientInfo.accountNumber,
        startDate:               dates.displayStart,
        endDate:                 dates.displayEnd,
        shiftDays:               dates.shiftDays,
        totalExpectedPatrols:    expectedPatrolsPerPost * allRegisteredPosts.length,
        totalCompletedPatrols:   performanceResults.totalCompleted,
        overallPatrolPerformance: performanceResults.overallRate,
        totalIncidents:          incidentData.total,
        patrolSource:            dataSource,
        incidentSource:          'incidentModel.js',
        zoneSource:              zoneData.source,
        usingAPI:                false,
        postCountOverrides: {
          applied:  !!(postCountOverride || singlePostOverride),
          override: postCountOverride || singlePostOverride || null,
          note:     postCountOverride?.note || singlePostOverride?.note || null,
        },
        nightShiftExclusions: {
          applied:      false,
          totalExcluded: EXCLUDED_NIGHT_SHIFT_SITES.size,
        },
        zoneNameExclusions: {
          applied:       excludedZoneNameCount > 0,
          excludedCount: excludedZoneNameCount,
          clientHasExclusionList: ZONE_NAME_EXCLUSIONS_BY_CLIENT.has(String(clientInfo.clientName).trim().toUpperCase()),
        },
        // ✅ FIX 31: ghost/zero-patrol zones are KEPT in `posts` (not
        // dropped) — see the ZoneStatus field on each post for
        // UNKNOWN_ZONE / DELETED_FROM_API / ACTIVE_NO_PATROLS. This block
        // is metadata-only visibility into the same set; `enabled: false`
        // reflects that no filtering is actually applied anymore.
        ghostZoneFilter: {
          enabled:         false,
          totalRegistered: zoneData.allPosts.length,
          activeZones:     allRegisteredPosts.length - zeroPatrolCount,
          excludedZones:   excludedZoneNameCount,
          ghostZones:      zeroPatrolCount,
          ghostZoneNames:  ghostPosts.map(p => `[${p.zoneCode}] ${p.zoneName} (${p.source || 'UNKNOWN'})`),
        },
        generatedAt:    new Date(),
        processingTime: totalTime,
        timezone:       TZ,
        dataQuality: {
          isValid:              true,
          separateSources:      true,
          rawPatrolEvents:      patrolEvents.length,
          afterDateRangeFilter: filteredPatrols.length,
          droppedInvalidDate:   dropReasons.invalidDate   || 0,
          droppedNonV04:        dropReasons.notV04        || 0,
          droppedOutsideRange:  dropReasons.outsideWindow || 0,
          droppedUnknownZone:   patrolCounts._skippedUnknown || 0,
          totalCompletedCounted: performanceResults.totalCompleted,
          afterZoneFilter:      processedPatrolEvents.length,
          zonesCount:           allRegisteredPosts.length,
          totalZonesFromSource: zoneData.allPosts.length,
          incidentsCount:       incidentData.total,
          graceWindowMinutes:   SHIFT_GRACE_MINUTES,
          eventsSortedChronologically: true,
        },
        success: true,
      },
    };

    await saveGeneratedReport(result);
    return result;

  } catch (error) {
    logger.error(`💥 Report failed:`, error.message);
    return buildErrorResponse(startDate, endDate, reportType, error.message);
  }
};

// ========== API ENDPOINTS ==========

const createPatrolReportAPI = (app) => {

  app.get('/api/reports/patrol', async (req, res) => {
    try {
      const { clientId, client, startDate, startDateTime, endDate, endDateTime, reportType = 'custom', usePartitions = 'true', shiftType } = req.query;
      const resolvedClient = clientId || client;
      const resolvedStart  = startDate  || (startDateTime  ? startDateTime.split('T')[0]  : undefined);
      const resolvedEnd    = endDate    || (endDateTime    ? endDateTime.split('T')[0]    : undefined);

      if (!resolvedClient || !resolvedStart || !resolvedEnd)
        return res.status(400).json({ success: false, error: 'Missing required parameters: clientId, startDate, endDate' });

      const data = await fetchPatrolReport(resolvedClient, resolvedStart, resolvedEnd, usePartitions === 'true', reportType, shiftType || null);
      res.status(data.metadata.success ? 200 : 422).json({
        success:   data.metadata.success,
        data,
        timestamp: new Date(),
        sources: { patrols: data.metadata.patrolSource, incidents: data.metadata.incidentSource, zones: data.metadata.zoneSource },
        counts:  { patrols: data.metadata.totalCompletedPatrols, incidents: data.metadata.totalIncidents, zones: { total: data.metadata.client.zoneCount, active: data.metadata.client.activeZoneCount } },
      });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
  });

  app.get('/api/reports/:type', async (req, res) => {
    try {
      const { type } = req.params;
      const { clientId, client, endDate = null, usePartitions = 'true', shiftType } = req.query;
      const resolvedClient = clientId || client;
      if (!resolvedClient) return res.status(400).json({ success: false, error: 'Client ID or name is required' });

      const dateRange = generateDateRangeForReportType(type, endDate);
      const data      = await fetchPatrolReport(resolvedClient, dateRange.startDate, dateRange.endDate, usePartitions === 'true', type, shiftType || null);
      res.status(data.metadata.success ? 200 : 422).json({
        success: data.metadata.success, data, timestamp: new Date(), generatedFor: type, dateRange,
        sources: { patrols: data.metadata.patrolSource, incidents: data.metadata.incidentSource, zones: data.metadata.zoneSource },
      });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
  });
};

const fetchWeeklyReport = (clientIdOrName, startDate, endDate, usePartitions = true) =>
  fetchPatrolReport(clientIdOrName, startDate, endDate, usePartitions, DEFAULT_REPORT_TYPES.WEEKLY, null);

// ========== EXPORTS ==========
module.exports = {
  fetchPatrolReport,
  fetchWeeklyReport,
  createPatrolReportAPI,
  resolveClientId,
  filterEventsByDateRange: filterV04PatrolsByDateRange,
  filterV04PatrolsByDateRange,
  sortPatrolEventsChronologically,
  countV04Patrols,
  DEFAULT_REPORT_TYPES,
  generateDateRangeForReportType,
  getLastCompletedWeekStart,
  PATROL_ARRIVAL_CODE,
  INCIDENT_CODE,
  SHIFT_START_HOUR,
  SHIFT_END_HOUR,
  DAY_SHIFT_START_HOUR,
  DAY_SHIFT_END_HOUR,
  SHIFT_GRACE_MINUTES,
  WEEK_START_DAY,
  WEEK_START_DAY_NAMES,
  fetchZoneData,
  clearZoneCache,
  filterGhostZones,
  markGhostZones,
  isUnknownZone,
  isPlaceholderZoneName,
  normalizeZoneCode,
  resolveZoneName,
  registerZone,
  autoDetectPatrolsPerDay,
  normaliseShiftType,
  getShiftWindowHours,
  EXCLUDED_NIGHT_SHIFT_SITES,
  POST_COUNT_OVERRIDES,
  SINGLE_POST_SITES,
  ZONE_NAME_EXCLUSIONS_BY_CLIENT,
  ZONE_NAME_ALLOWLIST_BY_CLIENT,
  isExcludedNightShiftSite,
  isExcludedZoneNameForClient,
  isZoneNameAllowedForClient,
  getZoneAllowlistForClient,
  getPostCountOverride,
  getSinglePostOverride,
};