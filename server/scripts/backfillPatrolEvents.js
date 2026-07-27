// server/scripts/backfillPatrolEvents.js
//
// Backfills PatrolEventsArchive from:
//   Phase 1 — SQL Server partition tables (p_recepcionYYYYMM) — ALL rows, ALL clients, ALL alarm codes
//   Phase 2 — BM Security live API — last RECENT_DAYS days (overlap is safe, MERGE deduplicates)
//
// This is a Node.js script — it calls the BM Security REST API and uses the
// mssql JS driver for bulk inserts, so it must be run from a terminal, not
// from SSMS (SSMS only executes T-SQL).
//
// Usage (from the server/ directory):
//   node scripts/backfillPatrolEvents.js              # DB + API
//   node scripts/backfillPatrolEvents.js --db-only    # skip API phase
//   node scripts/backfillPatrolEvents.js --api-only   # skip DB phase
//
// Safe to re-run — MERGE deduplicates automatically.
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const dayjs = require('dayjs');
const utc   = require('dayjs/plugin/utc');
const tz    = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(tz);

const { getPool, sql }  = require('../config/database');
const bmSecurityAPI     = require('../service/bmSecurityAPI');
const { archiveEvents } = require('../service/eventArchiveService');

// ── Config ────────────────────────────────────────────────────────────────────
const TZ          = process.env.TZ || 'Africa/Nairobi';
const DELAY_MS    = parseInt(process.env.BACKFILL_DELAY || '1000', 10);
const API_CHUNK   = parseInt(process.env.BACKFILL_CHUNK || '3',    10);  // days per API call
const RECENT_DAYS = 240;     // API phase covers last 8 months (overlaps DB phase — MERGE handles it)
const BATCH_SIZE  = 10000;   // rows per batch from partition tables

// ── Date range ────────────────────────────────────────────────────────────────
// START is fixed at Jan 2024. END stays dynamic ("today") on every run, so
// re-running this later automatically picks up newer months too — you don't
// need to edit this file again to extend coverage.
const START = dayjs.tz('2024-01-01', TZ).startOf('month');
const END   = dayjs().tz(TZ).startOf('day');                  // today, dynamic

// API phase starts at (today - RECENT_DAYS), DB phase covers everything up to END
const API_CUTOFF = END.subtract(RECENT_DAYS, 'day').startOf('day');

const DB_ONLY  = process.argv.includes('--db-only');
const API_ONLY = process.argv.includes('--api-only');
const RUN_DB   = !API_ONLY;
const RUN_API  = !DB_ONLY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Extract a plain array from whatever getPatrolEvents returns ───────────────
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

// ── Map a DB row → raw event shape (same fields archiveEvents expects) ────────
function dbRowToEvent(row) {
  return {
    rec_iid:            row.rec_iid,
    rec_iidcuenta:      row.rec_iidcuenta,
    rec_czona:          row.rec_czona,
    rec_calarma:        row.rec_calarma,
    rec_tfechahora:     row.rec_tfechahora,
    rec_cContenido:     row.rec_cContenido     || null,
    rec_cObservaciones: row.rec_cObservaciones || null,
    rec_iusuario:       row.rec_iusuario       || null,
  };
}

// ── Check if table exists ─────────────────────────────────────────────────────
async function tableExists(pool, tableName) {
  const r = await pool.request()
    .input('tbl', sql.NVarChar(100), tableName)
    .query(`
      SELECT 1 AS Found
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tbl
    `);
  return r.recordset.length > 0;
}

// ── Stream ALL rows from a partition table in BATCH_SIZE chunks ───────────────
// No alarm code filter — every row, every client, every alarm code.
async function* streamPartitionTable(pool, tableName, monthStart, monthEnd) {
  let offset = 0;
  while (true) {
    const result = await pool.request()
      .input('start',  sql.DateTime, monthStart.toDate())
      .input('end',    sql.DateTime, monthEnd.toDate())
      .input('offset', sql.Int,      offset)
      .input('batch',  sql.Int,      BATCH_SIZE)
      .query(`
        SELECT
          rec_iid,
          rec_iidcuenta,
          LTRIM(RTRIM(ISNULL(rec_czona,   ''))) AS rec_czona,
          LTRIM(RTRIM(ISNULL(rec_calarma, ''))) AS rec_calarma,
          rec_tfechahora,
          rec_cContenido,
          rec_cObservaciones,
          rec_iusuario
        FROM [_Datos].[dbo].[${tableName}]
        WHERE rec_tfechahora >= @start
          AND rec_tfechahora <  @end
        ORDER BY rec_tfechahora, rec_iid
        OFFSET @offset ROWS FETCH NEXT @batch ROWS ONLY
      `);

    const rows = result.recordset;
    if (!rows.length) break;

    yield rows;
    offset += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }
}

// ── Build list of months to process for DB phase ──────────────────────────────
function buildDbMonths() {
  const months = [];
  let cursor   = START.clone();
  while (!cursor.isAfter(END, 'month')) {
    months.push(cursor.clone());
    cursor = cursor.add(1, 'month');
  }
  return months;
}

// ── Build list of date chunks for API phase ───────────────────────────────────
function buildApiChunks() {
  const chunks = [];
  let cursor   = API_CUTOFF.clone();
  while (cursor.isBefore(END)) {
    const chunkEnd = cursor.add(API_CHUNK, 'day').isAfter(END)
      ? END
      : cursor.add(API_CHUNK, 'day');
    chunks.push({
      start: cursor.toDate(),
      end:   chunkEnd.toDate(),
      label: `${cursor.format('DD/MM/YYYY')} → ${chunkEnd.format('DD/MM/YYYY')}`,
    });
    cursor = chunkEnd;
  }
  return chunks;
}

// ── Phase 1: DB partition tables ──────────────────────────────────────────────
async function runDbPhase(pool) {
  console.log('\n📂 PHASE 1 — SQL Server partition tables');
  console.log('─'.repeat(60));
  console.log(`   Range      : ${START.format('MMM YYYY')} → ${END.format('MMM YYYY')}`);
  console.log(`   Batch size : ${BATCH_SIZE.toLocaleString()} rows`);
  console.log(`   Scope      : ALL rows, ALL clients, ALL alarm codes\n`);

  const months  = buildDbMonths();
  let totalIns  = 0;
  let totalSkip = 0;
  let missing   = 0;
  let empty     = 0;
  let errors    = 0;

  for (const month of months) {
    const tableName  = `p_recepcion${month.format('YYYYMM')}`;
    const monthStart = month.startOf('month');
    const monthEnd   = month.add(1, 'month').startOf('month');
    const label      = month.format('MMM YYYY');

    process.stdout.write(`  ${label.padEnd(10)} [${tableName}]  `);

    try {
      if (!(await tableExists(pool, tableName))) {
        missing++;
        console.log('table not found — skipped');
        continue;
      }

      // Count first so we can show progress
      const countResult = await pool.request()
        .input('start', sql.DateTime, monthStart.toDate())
        .input('end',   sql.DateTime, monthEnd.toDate())
        .query(`
          SELECT COUNT(*) AS Total
          FROM [_Datos].[dbo].[${tableName}]
          WHERE rec_tfechahora >= @start
            AND rec_tfechahora <  @end
        `);

      const total = countResult.recordset[0].Total;
      if (total === 0) {
        empty++;
        console.log('0 rows in range');
        continue;
      }

      console.log(`${total.toLocaleString()} rows`);

      let batchNum = 0;
      for await (const batch of streamPartitionTable(pool, tableName, monthStart, monthEnd)) {
        batchNum++;
        const events   = batch.map(dbRowToEvent);
        const soFar    = Math.min(batchNum * BATCH_SIZE, total);
        const pct      = Math.min(Math.round((soFar / total) * 100), 100);

        process.stdout.write(
          `    batch ${batchNum} (${soFar.toLocaleString()}/${total.toLocaleString()} ~${pct}%)  archiving… `,
        );

        const { inserted, skipped } = await archiveEvents(events);
        totalIns  += inserted || 0;
        totalSkip += skipped  || 0;
        console.log(`✅ ${inserted} new, ${skipped} skipped`);
      }

    } catch (err) {
      errors++;
      console.log(`    ❌ ${err.message}`);
    }

    await sleep(200);
  }

  console.log(
    `\n  DB done: ${totalIns.toLocaleString()} inserted | ${totalSkip.toLocaleString()} skipped | ` +
    `${empty} empty | ${missing} missing | ${errors} errors`,
  );
  return totalIns;
}

// ── Phase 2: BM Security live API ─────────────────────────────────────────────
async function runApiPhase() {
  console.log('\n🌐 PHASE 2 — BM Security live API');
  console.log('─'.repeat(60));
  console.log(`   Range : ${API_CUTOFF.format('DD/MM/YYYY')} → ${END.format('DD/MM/YYYY')}`);
  console.log(`   Chunk : ${API_CHUNK} days per call`);
  console.log(`   Scope : ALL clients (empty account filter)\n`);

  let totalIns  = 0;
  let totalSkip = 0;
  let empty     = 0;
  let errors    = 0;
  const chunks  = buildApiChunks();

  for (let i = 0; i < chunks.length; i++) {
    const { start, end, label } = chunks[i];
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${chunks.length}] ${label}  fetching… `);

    try {
      const raw    = await bmSecurityAPI.getPatrolEvents('', start, end);
      const events = extractEvents(raw);

      if (!events.length) {
        empty++;
        console.log('no events');
        await sleep(DELAY_MS);
        continue;
      }

      process.stdout.write(`${events.length.toLocaleString()} events  archiving… `);
      const { inserted, skipped } = await archiveEvents(events);
      totalIns  += inserted || 0;
      totalSkip += skipped  || 0;
      console.log(`✅ ${inserted} new, ${skipped} skipped`);

    } catch (err) {
      errors++;
      console.log(`❌ ${err.message}`);
    }

    if (i < chunks.length - 1) await sleep(DELAY_MS);
  }

  console.log(
    `\n  API done: ${totalIns.toLocaleString()} inserted | ${totalSkip.toLocaleString()} skipped | ` +
    `${empty} empty chunks | ${errors} errors`,
  );
  return totalIns;
}

// ── Main entry point ────────────────────────────────────────────────────────
async function run() {
  console.log('═'.repeat(60));
  console.log('  PatrolEventsArchive — full raw backfill');
  console.log(`  ${START.format('MMMM YYYY')} → ${END.format('DD/MM/YYYY')}`);
  console.log('═'.repeat(60));
  console.log(`  Mode       : ${DB_ONLY ? 'DB only' : API_ONLY ? 'API only' : 'DB + API'}`);
  console.log(`  DB range   : ${START.format('MMM YYYY')} → ${END.format('MMM YYYY')} (ALL alarm codes)`);
  console.log(`  API range  : last ${RECENT_DAYS} days (ALL clients)`);
  console.log(`  Batch size : ${BATCH_SIZE.toLocaleString()} rows`);
  console.log('  Safe to re-run — MERGE deduplicates automatically');
  console.log('═'.repeat(60));

  const pool  = await getPool();
  let   total = 0;

  if (RUN_DB) total += await runDbPhase(pool);

  if (RUN_API) {
    let apiOk = false;
    try {
      process.stdout.write('\nAuthenticating with BM Security API… ');
      await bmSecurityAPI.ensureAuthenticated();
      console.log('✅');
      apiOk = true;
    } catch (err) {
      console.error(`\n❌ API auth failed: ${err.message}`);
      if (!RUN_DB) {
        try { await pool.close(); } catch {}
        process.exit(1);
      }
      console.error('   Skipping API phase.');
    }

    if (apiOk) total += await runApiPhase();
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`  Total new rows inserted: ${total.toLocaleString()}`);
  console.log('═'.repeat(60));

  try { await pool.close(); } catch {}
  process.exit(0);
}

run().catch(err => {
  console.error('\n💥 Backfill crashed:', err.message);
  console.error(err.stack);
  process.exit(1);
});