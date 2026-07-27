// server/service/reportArchiveService.js
//
// ── DB MIGRATION (run once, safe to skip — see note in
//    reportExcelExportService.js) ──────────────────────────────────────────
//   ALTER TABLE dbo.GeneratedReports ADD ExcelPath NVARCHAR(500) NULL;
// ─────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/database');
const { generateAndSaveExcel } = require('./reportExcelExportService');

async function saveGeneratedReport(report) {
  let insertedId = null;

  try {
    const pool = await getPool();
    const meta = report.metadata;

    const insertResult = await pool.request()
      .input('clientId', sql.Int, meta.clientId)
      .input('clientName', sql.NVarChar(255), meta.clientName)
      .input('reportType', sql.VarChar(20), meta.reportType)
      .input('shiftType', sql.VarChar(10), meta.shiftType)
      .input('startDate', sql.VarChar(20), meta.startDate)
      .input('endDate', sql.VarChar(20), meta.endDate)
      .input('overallPerformance', sql.Int, meta.overallPatrolPerformance)
      .input('totalExpectedPatrols', sql.Int, meta.totalExpectedPatrols)
      .input('totalCompletedPatrols', sql.Int, meta.totalCompletedPatrols)
      .input('totalIncidents', sql.Int, meta.totalIncidents)
      .input('success', sql.Bit, meta.success ? 1 : 0)
      .input('reportData', sql.NVarChar(sql.MAX), JSON.stringify(report))
      .query(`
        INSERT INTO dbo.GeneratedReports
          (ClientId, ClientName, ReportType, ShiftType, StartDate, EndDate,
           OverallPerformance, TotalExpectedPatrols, TotalCompletedPatrols, TotalIncidents,
           Success, ReportData)
        OUTPUT INSERTED.Id
        VALUES
          (@clientId, @clientName, @reportType, @shiftType, @startDate, @endDate,
           @overallPerformance, @totalExpectedPatrols, @totalCompletedPatrols, @totalIncidents,
           @success, @reportData)
      `);

    insertedId = insertResult.recordset?.[0]?.Id ?? null;
  } catch (err) {
    console.error('⚠️ Failed to save generated report to archive:', err.message);
    return; // no row was inserted — nothing to attach an Excel export to
  }

  // ── Auto-save Excel export, non-fatal ─────────────────────────────────────
  // Runs after the DB insert so a slow/failed Excel write never blocks or
  // rolls back the archive save itself.
  try {
    const excelPath = await generateAndSaveExcel(report);
    if (excelPath && insertedId) {
      try {
        const pool = await getPool();
        await pool.request()
          .input('id', sql.Int, insertedId)
          .input('excelPath', sql.NVarChar(500), excelPath)
          .query(`UPDATE dbo.GeneratedReports SET ExcelPath = @excelPath WHERE Id = @id`);
      } catch (updateErr) {
        // Most likely cause: ExcelPath column doesn't exist yet (migration
        // not run). The file itself was still written successfully.
        console.warn('⚠️ Excel file saved but could not record ExcelPath (run the migration?):', updateErr.message);
      }
    }
  } catch (excelErr) {
    console.error('⚠️ Auto Excel export failed (report archive itself succeeded):', excelErr.message);
  }
}

async function getArchivedClients() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT ClientId, ClientName
    FROM dbo.GeneratedReports
    ORDER BY ClientName
  `);
  return result.recordset;
}

async function getArchivedMonths(clientId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('clientId', sql.Int, clientId)
    .query(`
      SELECT DISTINCT FORMAT(GeneratedAt, 'yyyy-MM') AS Month
      FROM dbo.GeneratedReports
      WHERE ClientId = @clientId
      ORDER BY Month DESC
    `);
  return result.recordset.map(r => r.Month);
}

// "dateStr" is a calendar date ("YYYY-MM-DD") interpreted as a day in
// Africa/Nairobi (UTC+3, no DST). Returns the UTC instant bounds for that
// local day — `end` is an EXCLUSIVE upper bound (next local midnight) —
// matching how GeneratedAt is stored via GETUTCDATE().
function nairobiDayBounds(dateStr) {
  const start = new Date(`${dateStr}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// Shared range-filter builder used by both getReportsForClient (summary
// columns only) and getReportsForClientWithData (full ReportData, for
// bulk Excel export) so the two stay in sync.
function buildRangeFilter(request, { range = 'all', month = null, day = null, startDate = null, endDate = null }) {
  if (range === 'month' && month) {
    request.input('month', sql.VarChar(7), month);
    return `AND FORMAT(GeneratedAt, 'yyyy-MM') = @month`;
  }
  if (range === 'day' && day) {
    const { start, end } = nairobiDayBounds(day);
    request.input('dayStart', sql.DateTime2, start);
    request.input('dayEnd', sql.DateTime2, end);
    return `AND GeneratedAt >= @dayStart AND GeneratedAt < @dayEnd`;
  }
  if (range === 'custom' && startDate && endDate) {
    const { start } = nairobiDayBounds(startDate);
    const { end } = nairobiDayBounds(endDate); // endDate's "next midnight" → inclusive of endDate itself
    request.input('rangeStart', sql.DateTime2, start);
    request.input('rangeEnd', sql.DateTime2, end);
    return `AND GeneratedAt >= @rangeStart AND GeneratedAt < @rangeEnd`;
  }
  return ''; // range === 'all' (or required params missing) → no extra filter
}

async function getReportsForClient(clientId, options = {}) {
  const { limit = 100 } = options;

  const pool = await getPool();
  const request = pool.request()
    .input('clientId', sql.Int, clientId)
    .input('limit', sql.Int, limit);

  const filter = buildRangeFilter(request, options);

  const result = await request.query(`
    SELECT TOP (@limit) Id, ClientId, ClientName, ReportType, ShiftType, StartDate, EndDate,
           OverallPerformance, TotalExpectedPatrols, TotalCompletedPatrols, TotalIncidents, Success, GeneratedAt
    FROM dbo.GeneratedReports
    WHERE ClientId = @clientId
      ${filter}
    ORDER BY GeneratedAt DESC
  `);
  return result.recordset;
}

// Same filtering as getReportsForClient, but returns the FULL parsed
// report object (posts/events/guardReports/metadata) for each row — used
// by the bulk Excel export endpoint, which needs the actual patrol/zone
// data, not just the summary columns.
async function getReportsForClientWithData(clientId, options = {}) {
  const { limit = 100 } = options;

  const pool = await getPool();
  const request = pool.request()
    .input('clientId', sql.Int, clientId)
    .input('limit', sql.Int, limit);

  const filter = buildRangeFilter(request, options);

  const result = await request.query(`
    SELECT TOP (@limit) Id, ReportData, GeneratedAt
    FROM dbo.GeneratedReports
    WHERE ClientId = @clientId
      ${filter}
    ORDER BY GeneratedAt DESC
  `);

  return result.recordset
    .map(row => {
      try {
        return JSON.parse(row.ReportData);
      } catch (err) {
        console.warn(`⚠️ Skipping unparseable ReportData for GeneratedReports.Id=${row.Id}:`, err.message);
        return null;
      }
    })
    .filter(Boolean);
}

async function getReportById(id) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT * FROM dbo.GeneratedReports WHERE Id = @id`);
  if (result.recordset.length === 0) return null;
  const row = result.recordset[0];
  return { ...row, ReportData: JSON.parse(row.ReportData) };
}

module.exports = {
  saveGeneratedReport,
  getArchivedClients,
  getArchivedMonths,
  getReportsForClient,
  getReportsForClientWithData,
  getReportById,
};