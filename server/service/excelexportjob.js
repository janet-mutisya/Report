// server/service/excelExportService.js
//
// Same export logic as the standalone exportArchiveToExcel.js script, but
// wrapped as a reusable function so excelExportJob.js can call it on a
// schedule instead of requiring a manual `node exportArchiveToExcel.js` run.
'use strict';

const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const {
  getArchiveStatus,
  getArchivedEventClients,
  getArchivedEventMonths,
  getAlarmCodeSummary,
} = require('./eventArchiveService');

const { getArchiveState } = require('./eventArchiveJob');
const { getPool } = require('../config/database');

const EXPORT_DIR      = process.env.EXCEL_EXPORT_DIR      || path.join(__dirname, '..', '..', 'exports');
const KEEP_LAST_N      = parseInt(process.env.EXCEL_EXPORT_KEEP || '20', 10); // rotate old files
const EXPORT_FILE_PREFIX = 'archive-export-';

function sheetFromRows(rows) {
  if (!rows || rows.length === 0) return XLSX.utils.aoa_to_sheet([['No data']]);
  return XLSX.utils.json_to_sheet(rows);
}

/**
 * 📊 Build the multi-sheet workbook and write it to EXPORT_DIR.
 * Returns the full path of the file that was written.
 */
async function runExcelExport(onlyClientId = null) {
  const startedAt = Date.now();
  console.log('[excelExportService] 📊 Starting scheduled archive export...');

  if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

  const wb = XLSX.utils.book_new();

  // 1. Overview
  const status = await getArchiveStatus();
  XLSX.utils.book_append_sheet(wb, sheetFromRows([
    { Metric: 'Total Events', Value: status.TotalEvents },
    { Metric: 'Earliest Event', Value: status.EarliestEvent },
    { Metric: 'Latest Event', Value: status.LatestEvent },
    { Metric: 'Last Fetched At', Value: status.LastFetchedAt },
    { Metric: 'Unique Clients', Value: status.UniqueClients },
    { Metric: 'Unique Alarm Codes', Value: status.UniqueAlarmCodes },
    { Metric: 'Minutes Since Last Event', Value: status.MinutesSinceLastEvent },
    { Metric: 'Exported At', Value: new Date().toISOString() },
  ]), 'Overview');

  // 2. ArchiveState
  try {
    const state = await getArchiveState();
    XLSX.utils.book_append_sheet(wb, sheetFromRows(state ? [{
      LastSuccessfulPoll:      state.LastSuccessfulPoll,
      LastSuccessfulFill:      state.LastSuccessfulFill,
      LastSuccessfulReconcile: state.LastSuccessfulReconcile,
      UpdatedAt:               state.UpdatedAt,
    }] : [{ Note: 'dbo.ArchiveState table not found or empty' }]), 'ArchiveState');
  } catch (err) {
    console.warn(`[excelExportService] ⚠️ ArchiveState read failed: ${err.message}`);
  }

  // 3. Clients
  let clients = await getArchivedEventClients();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(clients), 'Clients');
  if (onlyClientId) clients = clients.filter(c => c.ClientId === onlyClientId);

  // 4. Monthly by Client
  const monthlyRows = [];
  for (const c of clients) {
    try {
      const months = await getArchivedEventMonths(c.ClientId);
      for (const m of months) {
        monthlyRows.push({
          ClientId: c.ClientId, ClientName: c.ClientName, AccountNumber: c.AccountNumber,
          Month: m.Month, EventCount: m.EventCount, PatrolArrivals: m.PatrolArrivals,
          Incidents: m.Incidents, CheckIns: m.CheckIns, UniqueAlarmCodes: m.UniqueAlarmCodes,
        });
      }
    } catch (err) {
      console.warn(`[excelExportService] ⚠️ Monthly skip client ${c.ClientId}: ${err.message}`);
    }
  }
  XLSX.utils.book_append_sheet(wb, sheetFromRows(monthlyRows), 'Monthly by Client');

  // 5. Alarm Codes by Client
  const alarmRows = [];
  for (const c of clients) {
    try {
      const alarms = await getAlarmCodeSummary(c.ClientId);
      for (const a of alarms) {
        alarmRows.push({
          ClientId: c.ClientId, ClientName: c.ClientName, AlarmCode: a.AlarmCode,
          EventCount: a.EventCount, FirstSeen: a.FirstSeen, LastSeen: a.LastSeen,
        });
      }
    } catch (err) {
      console.warn(`[excelExportService] ⚠️ Alarm summary skip client ${c.ClientId}: ${err.message}`);
    }
  }
  XLSX.utils.book_append_sheet(wb, sheetFromRows(alarmRows), 'Alarm Codes by Client');

  // 6. Alarm Codes (All)
  try {
    const pool = await getPool();
    const globalAlarms = await pool.request().query(`
      SELECT AlarmCode, COUNT(*) AS EventCount, COUNT(DISTINCT ClientId) AS ClientsUsingCode,
             MIN(EventDateTime) AS FirstSeen, MAX(EventDateTime) AS LastSeen
      FROM dbo.PatrolEventsArchive
      GROUP BY AlarmCode
      ORDER BY EventCount DESC
    `);
    XLSX.utils.book_append_sheet(wb, sheetFromRows(globalAlarms.recordset), 'Alarm Codes (All)');
  } catch (err) {
    console.warn(`[excelExportService] ⚠️ Global alarm summary failed: ${err.message}`);
  }

  // ── Write file ──────────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(EXPORT_DIR, `${EXPORT_FILE_PREFIX}${timestamp}.xlsx`);
  XLSX.writeFile(wb, outPath);

  rotateOldExports();

  const elapsed = Date.now() - startedAt;
  console.log(`[excelExportService] ✅ Export written: ${outPath} (${elapsed}ms)`);
  return outPath;
}

/**
 * 🧹 Keep only the most recent KEEP_LAST_N export files so the folder
 * doesn't grow forever.
 */
function rotateOldExports() {
  try {
    const files = fs.readdirSync(EXPORT_DIR)
      .filter(f => f.startsWith(EXPORT_FILE_PREFIX) && f.endsWith('.xlsx'))
      .map(f => ({ name: f, time: fs.statSync(path.join(EXPORT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    const toDelete = files.slice(KEEP_LAST_N);
    for (const f of toDelete) {
      fs.unlinkSync(path.join(EXPORT_DIR, f.name));
    }
    if (toDelete.length > 0) {
      console.log(`[excelExportService] 🧹 Rotated out ${toDelete.length} old export(s), keeping last ${KEEP_LAST_N}`);
    }
  } catch (err) {
    console.warn(`[excelExportService] ⚠️ Rotation failed: ${err.message}`);
  }
}

module.exports = { runExcelExport, EXPORT_DIR };