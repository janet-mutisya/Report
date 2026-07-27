// server/service/eventArchiveJob.js
//
// Two-layer archive strategy:
//
//   1. Real-time poller   — runs every POLL_MS (default 60s), fetches the last
//      POLL_LOOKBACK minutes from BM Security and archives new events immediately.
//
//   2. Daily reconciliation — runs at DAILY_CRON (default 2 AM Nairobi), fetches
//      the last DAILY_DAYS days to catch anything the poller missed.
//
// Both store EVERYTHING — no alarm code filtering.
// Deduplication is handled by the MERGE in eventArchiveService.archiveEvents().
//
// ArchiveState (dbo.ArchiveState) tracks the last successful run of each job
// so the startup fill only fetches the gap since the last known event, rather
// than always going back DAILY_DAYS.
//
// ✅ FIX: cron.schedule() takes (cronExpression, task, options) — a STRING
//    pattern first, then the callback. This previously called
//    cron.schedule(runDailyReconciliation, { timezone: TZ }) — function
//    first, no pattern at all — which threw synchronously ("path argument
//    must be of type string") and silently killed daily reconciliation
//    registration (though the poller and startup fill, registered earlier
//    in the same function via setImmediate/setInterval, were unaffected).
'use strict';

const cron     = require('node-cron');
const dayjs    = require('dayjs');
const utc      = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const { getPool, sql }                     = require('../config/database');
const bmSecurityAPI                        = require('./bmSecurityAPI');
const { archiveEvents, getArchiveStatus }  = require('./eventArchiveService');

const TZ            = process.env.TZ                    || 'Africa/Nairobi';
const DAILY_CRON    = process.env.ARCHIVE_CRON          || '0 2 * * *';   // 02:00 Nairobi
const POLL_MS       = parseInt(process.env.ARCHIVE_POLL_MS       || '60000', 10); // 60 s
const POLL_LOOKBACK = parseInt(process.env.ARCHIVE_POLL_LOOKBACK || '5',     10); // minutes back per poll
const DAILY_DAYS    = parseInt(process.env.ARCHIVE_LOOKBACK_DAYS || '7',     10); // days for daily job
const CHUNK_DAYS    = parseInt(process.env.ARCHIVE_CHUNK_DAYS    || '1',     10); // days per API call

// Gap overlap added before the last known event to avoid edge-case misses
const GAP_OVERLAP_MINUTES = 60;

let pollerRunning   = false;
let isAuthenticated = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Extract event array from whatever bmSecurityAPI.getPatrolEvents returns ───
function extractEvents(result) {
  if (!result)                                          return [];
  if (Array.isArray(result))                            return result;
  if (Array.isArray(result.data))                       return result.data;
  if (Array.isArray(result.events))                     return result.events;
  if (result.data && Array.isArray(result.data.events)) return result.data.events;
  for (const val of Object.values(result)) {
    if (Array.isArray(val) && val.length > 0)           return val;
  }
  return [];
}

// ── Ensure authenticated before any API call ──────────────────────────────────
async function ensureAuth() {
  try {
    await bmSecurityAPI.ensureAuthenticated();
    isAuthenticated = true;
  } catch (err) {
    isAuthenticated = false;
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ARCHIVE STATE — dbo.ArchiveState (singleton row, Id = 1)
//
// Tracks when each job last ran successfully so we can:
//   • Start the startup fill from the real gap, not always 7 days back
//   • Surface health info on the admin dashboard
//   • Detect silent failures (last poll was 3 hours ago → alert)
//
// SQL to create the table (run once during migration):
//
//   CREATE TABLE dbo.ArchiveState (
//     Id                       INT          NOT NULL PRIMARY KEY DEFAULT 1,
//     LastSuccessfulPoll       DATETIME2    NULL,
//     LastSuccessfulFill       DATETIME2    NULL,
//     LastSuccessfulReconcile  DATETIME2    NULL,
//     UpdatedAt                DATETIME2    NOT NULL DEFAULT GETUTCDATE(),
//     CONSTRAINT chk_singleton CHECK (Id = 1)
//   );
//   INSERT INTO dbo.ArchiveState (Id) VALUES (1);
// ════════════════════════════════════════════════════════════════════════════

async function getArchiveState() {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(`
      SELECT
        LastSuccessfulPoll,
        LastSuccessfulFill,
        LastSuccessfulReconcile,
        UpdatedAt
      FROM dbo.ArchiveState
      WHERE Id = 1
    `);
    return result.recordset[0] ?? null;
  } catch (err) {
    // Table may not exist yet on first run — non-fatal
    console.warn('[eventArchiveJob] ⚠️  Could not read ArchiveState (table missing?):', err.message);
    return null;
  }
}

async function updateArchiveState(field) {
  // field: 'LastSuccessfulPoll' | 'LastSuccessfulFill' | 'LastSuccessfulReconcile'
  const allowed = new Set(['LastSuccessfulPoll', 'LastSuccessfulFill', 'LastSuccessfulReconcile']);
  if (!allowed.has(field)) return;

  try {
    const pool = await getPool();
    await pool.request().query(`
      UPDATE dbo.ArchiveState
      SET ${field} = GETUTCDATE(), UpdatedAt = GETUTCDATE()
      WHERE Id = 1
    `);
  } catch (err) {
    // Non-fatal — archive still works without state tracking
    console.warn(`[eventArchiveJob] ⚠️  Could not update ArchiveState.${field}:`, err.message);
  }
}

// ── Fetch and archive a date range in CHUNK_DAYS-sized pieces ─────────────────
async function fetchAndArchive(start, end, label = '') {
  const startDj = dayjs(start).tz(TZ);
  const endDj   = dayjs(end).tz(TZ);
  let   cursor  = startDj.clone();
  let   totalInserted = 0;
  let   totalFetched  = 0;

  while (cursor.isBefore(endDj)) {
    const chunkEnd = cursor.add(CHUNK_DAYS, 'day').isAfter(endDj)
      ? endDj
      : cursor.add(CHUNK_DAYS, 'day');

    try {
      const raw    = await bmSecurityAPI.getPatrolEvents('', cursor.toDate(), chunkEnd.toDate());
      const events = extractEvents(raw);

      if (events.length > 0) {
        const { inserted } = await archiveEvents(events);
        totalFetched  += events.length;
        totalInserted += inserted || 0;
      }
    } catch (err) {
      console.error(
        `[eventArchiveJob] ${label} chunk ${cursor.format('DD/MM HH:mm')} → ${chunkEnd.format('DD/MM HH:mm')}: ❌ ${err.message}`,
      );
    }

    cursor = chunkEnd;
    if (cursor.isBefore(endDj)) await sleep(500);
  }

  return { totalFetched, totalInserted };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. REAL-TIME POLLER — every POLL_MS (default 60 seconds)
//    Fetches the last POLL_LOOKBACK minutes. Near real-time coverage.
//    Skips if the previous run is still in progress.
// ════════════════════════════════════════════════════════════════════════════
async function runRealtimePoller() {
  if (pollerRunning) return;
  pollerRunning = true;

  try {
    if (!isAuthenticated) await ensureAuth();

    const now   = dayjs().tz(TZ);
    const start = now.subtract(POLL_LOOKBACK, 'minute').toDate();
    const end   = now.toDate();

    const raw    = await bmSecurityAPI.getPatrolEvents('', start, end);
    const events = extractEvents(raw);

    if (events.length > 0) {
      const { inserted, duplicates } = await archiveEvents(events);
      if (inserted > 0) {
        console.log(
          `[eventArchiveJob] 🔄 Poll: ${events.length} fetched → ${inserted} new, ${duplicates} already stored`,
        );
      }
    }

    await updateArchiveState('LastSuccessfulPoll');
  } catch (err) {
    console.error(`[eventArchiveJob] 🔄 Poll failed: ${err.message}`);
    isAuthenticated = false; // force re-auth on next poll
  } finally {
    pollerRunning = false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. DAILY RECONCILIATION — runs at DAILY_CRON (default 2 AM Nairobi)
//    Fetches the last DAILY_DAYS days to recover anything the poller missed.
//    Safe to re-run — MERGE deduplicates existing events automatically.
// ════════════════════════════════════════════════════════════════════════════
async function runDailyReconciliation() {
  console.log(`\n[eventArchiveJob] ══ Daily reconciliation starting ══`);

  try {
    await ensureAuth();

    const now   = dayjs().tz(TZ);
    const start = now.subtract(DAILY_DAYS, 'day').startOf('day').toDate();
    const end   = now.startOf('day').toDate();

    console.log(
      `[eventArchiveJob] Range: ${dayjs(start).format('DD/MM/YYYY')} → ${dayjs(end).format('DD/MM/YYYY')} (${DAILY_DAYS} days)`,
    );

    const { totalFetched, totalInserted } = await fetchAndArchive(start, end, 'daily');

    const status = await getArchiveStatus();
    console.log(`[eventArchiveJob] ✅ Daily done: ${totalFetched} fetched → ${totalInserted} new rows`);
    console.log(
      `[eventArchiveJob] 📊 Archive: ${status.TotalEvents?.toLocaleString()} total events | ` +
      `${status.UniqueClients} clients | Latest: ${dayjs(status.LatestEvent).format('DD/MM/YYYY HH:mm')}`,
    );

    await updateArchiveState('LastSuccessfulReconcile');
  } catch (err) {
    console.error(`[eventArchiveJob] ❌ Daily reconciliation failed: ${err.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3. STARTUP FILL — runs once immediately when the server starts.
//
//    Smart gap detection:
//      • If the archive has events, start from (LatestEvent - GAP_OVERLAP_MINUTES)
//        to cover only the real gap since the last run.
//      • If the archive is empty, fall back to DAILY_DAYS to seed it.
//
//    This avoids unnecessarily re-fetching 7 days of data on every restart.
// ════════════════════════════════════════════════════════════════════════════
async function runStartupFill() {
  console.log(`[eventArchiveJob] 🚀 Startup fill — checking archive…`);

  try {
    await ensureAuth();

    const status = await getArchiveStatus();
    const now    = dayjs().tz(TZ);
    let   start;

    if (status?.LatestEvent) {
      // Resume from just before the last known event
      const minutesBehind = status.MinutesSinceLastEvent ?? 0;
      start = dayjs(status.LatestEvent)
        .subtract(GAP_OVERLAP_MINUTES, 'minute')
        .toDate();
      console.log(
        `[eventArchiveJob] Archive is ${minutesBehind} minutes behind — ` +
        `filling gap from ${dayjs(start).format('DD/MM/YYYY HH:mm')}`,
      );
    } else {
      // Empty archive — full seed
      start = now.subtract(DAILY_DAYS, 'day').startOf('day').toDate();
      console.log(`[eventArchiveJob] Archive is empty — seeding last ${DAILY_DAYS} days`);
    }

    const end = now.toDate();
    const { totalFetched, totalInserted } = await fetchAndArchive(start, end, 'startup');
    console.log(`[eventArchiveJob] 🚀 Startup fill done: ${totalFetched} fetched → ${totalInserted} new rows`);

    await updateArchiveState('LastSuccessfulFill');
  } catch (err) {
    console.error(`[eventArchiveJob] 🚀 Startup fill failed: ${err.message}`);
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────
function startEventArchiveJob() {
  console.log(`[eventArchiveJob] Starting event archive system`);
  console.log(`[eventArchiveJob]   Real-time poller : every ${POLL_MS / 1000}s (${POLL_LOOKBACK}min lookback)`);
  console.log(`[eventArchiveJob]   Daily reconcile  : cron "${DAILY_CRON}" (last ${DAILY_DAYS} days)`);
  console.log(`[eventArchiveJob]   Startup gap fill : overlap ${GAP_OVERLAP_MINUTES}min before last event`);

  // 1. Startup fill — smart gap catch-up from last known event
  setImmediate(runStartupFill);

  // 2. Real-time poller — every POLL_MS
  setInterval(runRealtimePoller, POLL_MS);
  console.log(`[eventArchiveJob] ✅ Real-time poller started (every ${POLL_MS / 1000}s)`);

  // 3. Daily reconciliation — 2 AM Nairobi
  // FIX: cron.schedule(pattern, task, options) — pattern STRING first,
  // then the callback function, then options. Previously called as
  // cron.schedule(runDailyReconciliation, { timezone: TZ }) which passed
  // the function where the pattern string was expected — threw
  // synchronously and never registered.
  cron.schedule(DAILY_CRON, runDailyReconciliation, { timezone: TZ });
  console.log(`[eventArchiveJob] ✅ Daily reconciliation scheduled: "${DAILY_CRON}"`);
}

module.exports = {
  startEventArchiveJob,
  runRealtimePoller,
  runDailyReconciliation,
  getArchiveState,     // exported so admin dashboard / health endpoint can read it
};