// server/service/reportExcelExportService.js
//
// Builds .xlsx workbooks from generated patrol reports (the same shape
// returned by reportModel.fetchPatrolReport: { posts, events, guardReports,
// metadata }). Used two ways:
//
//   1. AUTO-SAVE — reportArchiveService.saveGeneratedReport() calls
//      generateAndSaveExcel() right after every report is generated, so an
//      .xlsx twin sits next to the JSON in dbo.GeneratedReports (path
//      stored in the ExcelPath column — see migration note below).
//
//   2. ON-DEMAND EXPORT — createReportExportAPI() registers two routes:
//        GET /api/reports/:id/export/excel
//          → single archived report, by GeneratedReports.Id
//        GET /api/reports/export/excel/bulk?clientId=&range=&month=&day=&startDate=&endDate=
//          → multiple archived reports for a client, one workbook, one
//            sheet-group per report, plus an Overview sheet up front.
//
// Requires: npm install exceljs
//
// ── DB MIGRATION (run once) ────────────────────────────────────────────────
//   ALTER TABLE dbo.GeneratedReports ADD ExcelPath NVARCHAR(500) NULL;
// Safe to skip — auto-save degrades gracefully (logs a warning, report
// generation itself is never blocked by an Excel failure) if the column
// doesn't exist yet.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const ExcelJS = require('exceljs');
const fs      = require('fs');
const path    = require('path');

const OUTPUT_DIR = process.env.EXCEL_EXPORT_DIR || path.join(__dirname, '..', 'generated-reports', 'excel');

// ========== SHEET NAME HELPERS ==========
// Excel sheet names: max 31 chars, no : \ / ? * [ ]
function sanitizeSheetName(name) {
  return String(name).replace(/[:\\/?*\[\]]/g, '-').slice(0, 31);
}

function uniqueSheetName(workbook, desired) {
  let name = sanitizeSheetName(desired);
  let n = 2;
  while (workbook.getWorksheet(name)) {
    const suffix = ` (${n})`;
    name = sanitizeSheetName(desired).slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  return name;
}

// ========== STYLING HELPERS ==========
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true };
const TOTAL_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };

function styleHeaderRow(row) {
  row.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  row.height = 20;
}

function autoWidth(sheet) {
  sheet.columns.forEach(col => {
    let max = 10;
    col.eachCell({ includeEmpty: true }, cell => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 50);
  });
}

// ========== SUMMARY SHEET ==========
function addSummarySheet(workbook, report, sheetName) {
  const meta  = report.metadata || {};
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, sheetName));

  sheet.columns = [{ width: 28 }, { width: 40 }];

  const title = sheet.addRow(['SECURITY PATROL REPORT', meta.clientName || 'Unknown']);
  title.font = { bold: true, size: 14 };
  sheet.addRow([]);

  const rows = [
    ['Client Name',            meta.clientName],
    ['Account Number',         meta.clientAccountNumber],
    ['Report Type',            meta.reportType],
    ['Period',                 `${meta.startDate} to ${meta.endDate}`],
    ['Shift Days',             meta.shiftDays],
    ['Generated At',           meta.generatedAt ? new Date(meta.generatedAt).toLocaleString() : ''],
    [],
    ['Overall Performance',    meta.overallPatrolPerformance != null ? meta.overallPatrolPerformance / 100 : null],
    ['Total Completed Patrols', meta.totalCompletedPatrols],
    ['Total Expected Patrols',  meta.totalExpectedPatrols],
    ['Total Incidents',         meta.totalIncidents],
    [],
    ['Total Zones',            meta.client?.zoneCount],
    ['Active Zones',           meta.client?.activeZoneCount],
    ['Ghost Zones (zero activity)', meta.client?.ghostZoneCount],
    ['Excluded Zones (bad data)',   meta.client?.excludedZoneCount],
    [],
    ['Patrol Source',          meta.patrolSource],
    ['Zone Source',            meta.zoneSource],
  ];

  for (const [label, value] of rows) {
    if (label === undefined) { sheet.addRow([]); continue; }
    const r = sheet.addRow([label, value]);
    r.getCell(1).font = { bold: true };
    if (label === 'Overall Performance') r.getCell(2).numFmt = '0.0%';
  }

  autoWidth(sheet);
  return sheet;
}

// ========== PATROL PERFORMANCE SHEET ==========
function addPerformanceSheet(workbook, report, sheetName) {
  const posts = report.posts || [];
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, sheetName));

  sheet.columns = [
    { header: 'Security Post / Zone', key: 'zone',       width: 32 },
    { header: 'Completed',            key: 'completed',  width: 14 },
    { header: 'Expected',             key: 'expected',   width: 14 },
    { header: 'Performance %',        key: 'performance', width: 16 },
  ];
  styleHeaderRow(sheet.getRow(1));

  const firstDataRow = 2;
  posts.forEach(post => {
    sheet.addRow({
      zone:      post.SecurityPost,
      completed: post.Completed,
      expected:  post.Expected,
    });
  });
  const lastDataRow = firstDataRow + posts.length - 1;

  // Formula-driven performance % per row (never hardcoded)
  for (let r = firstDataRow; r <= lastDataRow; r++) {
    const cell = sheet.getCell(`D${r}`);
    cell.value = { formula: `IFERROR(B${r}/C${r},0)` };
    cell.numFmt = '0%';
  }

  // TOTAL row — SUM formulas, not JS-computed totals
  if (posts.length > 0) {
    const totalRow = sheet.addRow({
      zone: 'TOTAL',
      completed: { formula: `SUM(B${firstDataRow}:B${lastDataRow})` },
      expected:  { formula: `SUM(C${firstDataRow}:C${lastDataRow})` },
    });
    const totalRowNum = totalRow.number;
    const perfCell = sheet.getCell(`D${totalRowNum}`);
    perfCell.value = { formula: `IFERROR(B${totalRowNum}/C${totalRowNum},0)` };
    perfCell.numFmt = '0%';
    totalRow.eachCell(cell => { cell.font = { bold: true }; cell.fill = TOTAL_FILL; });
  }

  autoWidth(sheet);
  return sheet;
}

// ========== ACTIVITY LOG SHEET ==========
function addActivityLogSheet(workbook, report, sheetName) {
  const events = report.events || [];
  const sheet  = workbook.addWorksheet(uniqueSheetName(workbook, sheetName));

  sheet.columns = [
    { header: 'Date',     key: 'date',  width: 14 },
    { header: 'Time',     key: 'time',  width: 12 },
    { header: 'Event',    key: 'event', width: 22 },
    { header: 'Location', key: 'zone',  width: 32 },
  ];
  styleHeaderRow(sheet.getRow(1));

  events.forEach(ev => {
    sheet.addRow({ date: ev.Date, time: ev.Time, event: ev.Event, zone: ev.Zone });
  });

  autoWidth(sheet);
  return sheet;
}

// ========== INCIDENTS SHEET ==========
function addIncidentsSheet(workbook, report, sheetName) {
  const incidents = report.guardReports || [];
  if (incidents.length === 0) return null;

  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, sheetName));
  sheet.columns = [
    { header: 'Date',   key: 'date',   width: 20 },
    { header: 'Zone',   key: 'zone',   width: 28 },
    { header: 'Report', key: 'report', width: 60 },
  ];
  styleHeaderRow(sheet.getRow(1));

  incidents.forEach(inc => {
    sheet.addRow({ date: inc.date, zone: inc.zone, report: inc.report });
  });

  autoWidth(sheet);
  return sheet;
}

// ========== ADD ALL SHEETS FOR ONE REPORT ==========
// prefix: '' for a single-report workbook, or e.g. 'R1_' when combining
// several reports into one bulk workbook (keeps sheet names unique).
function addReportSheets(workbook, report, prefix = '') {
  const summarySheet = addSummarySheet(workbook, report, `${prefix}Summary`);
  addPerformanceSheet(workbook, report, `${prefix}Patrol Performance`);
  addActivityLogSheet(workbook, report, `${prefix}Activity Log`);
  addIncidentsSheet(workbook, report, `${prefix}Incidents`);
  return summarySheet;
}

// ========== SINGLE-REPORT WORKBOOK ==========
function buildSingleReportWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Guard Report Server';
  workbook.created = new Date();
  addReportSheets(workbook, report, '');
  return workbook;
}

// ========== BULK WORKBOOK (multiple reports, one file) ==========
// reports: array of full report objects (posts/events/guardReports/metadata),
// most recent first or in whatever order the caller passes them.
function buildBulkReportWorkbook(reports) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Guard Report Server';
  workbook.created = new Date();

  const overview = workbook.addWorksheet('Overview');
  overview.columns = [
    { header: 'Client',      key: 'client',   width: 26 },
    { header: 'Report Type', key: 'type',     width: 14 },
    { header: 'Period',      key: 'period',   width: 26 },
    { header: 'Performance', key: 'perf',     width: 14 },
    { header: 'Completed',   key: 'completed',width: 12 },
    { header: 'Expected',    key: 'expected', width: 12 },
    { header: 'Incidents',   key: 'incidents',width: 12 },
    { header: 'Detail',      key: 'link',     width: 14 },
  ];
  styleHeaderRow(overview.getRow(1));

  reports.forEach((report, i) => {
    const meta   = report.metadata || {};
    const prefix = `R${i + 1}_`;
    const summarySheet = addReportSheets(workbook, report, prefix);

    const row = overview.addRow({
      client:    meta.clientName,
      type:      meta.reportType,
      period:    `${meta.startDate} - ${meta.endDate}`,
      perf:      meta.overallPatrolPerformance != null ? meta.overallPatrolPerformance / 100 : null,
      completed: meta.totalCompletedPatrols,
      expected:  meta.totalExpectedPatrols,
      incidents: meta.totalIncidents,
      link:      'View →',
    });
    row.getCell('perf').numFmt = '0.0%';
    if (summarySheet) {
      row.getCell('link').value = {
        text: 'View →',
        hyperlink: `#'${summarySheet.name}'!A1`,
      };
      row.getCell('link').font = { color: { argb: 'FF0563C1' }, underline: true };
    }
  });

  autoWidth(overview);
  return workbook;
}

// ========== SAVE / STREAM ==========
async function ensureOutputDir(dir = OUTPUT_DIR) {
  await fs.promises.mkdir(dir, { recursive: true });
}

function buildFilename(meta) {
  const safe = s => String(s || 'unknown').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const start = String(meta.startDate || '').replace(/\//g, '-');
  const end   = String(meta.endDate   || '').replace(/\//g, '-');
  const stamp = Date.now();
  return `${safe(meta.clientName)}_${safe(meta.reportType)}_${start}_to_${end}_${stamp}.xlsx`;
}

// Called from reportArchiveService right after a report is generated.
// Never throws — a failed Excel export must not block report generation.
async function generateAndSaveExcel(report, outputDir = OUTPUT_DIR) {
  try {
    await ensureOutputDir(outputDir);
    const workbook = buildSingleReportWorkbook(report);
    const filename = buildFilename(report.metadata || {});
    const filePath = path.join(outputDir, filename);
    await workbook.xlsx.writeFile(filePath);
    return filePath;
  } catch (err) {
    console.error('⚠️  Failed to auto-save Excel export:', err.message);
    return null;
  }
}

async function streamWorkbook(workbook, res, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ========== API ENDPOINTS ==========
// Wired up separately from reportModel.js's createPatrolReportAPI, since
// this reads from the archive (GeneratedReports), not from a live report run.
function createReportExportAPI(app, reportArchiveService) {
  const { getReportById, getReportsForClientWithData } = reportArchiveService;

  // Single archived report → .xlsx
  app.get('/api/reports/:id/export/excel', async (req, res) => {
    try {
      const row = await getReportById(parseInt(req.params.id, 10));
      if (!row) return res.status(404).json({ success: false, error: 'Report not found' });

      const report   = row.ReportData; // already JSON.parse'd by getReportById
      const workbook = buildSingleReportWorkbook(report);
      const filename = buildFilename(report.metadata || {});
      await streamWorkbook(workbook, res, filename);
    } catch (error) {
      console.error('❌ Excel export (single) failed:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Multiple archived reports for a client → one workbook, sheet-group per report
  app.get('/api/reports/export/excel/bulk', async (req, res) => {
    try {
      const { clientId, range = 'all', month, day, startDate, endDate, limit = 100 } = req.query;
      if (!clientId) return res.status(400).json({ success: false, error: 'clientId is required' });

      const reports = await getReportsForClientWithData(parseInt(clientId, 10), {
        range, month, day, startDate, endDate, limit: parseInt(limit, 10),
      });

      if (reports.length === 0) return res.status(404).json({ success: false, error: 'No reports found for that range' });

      const workbook = buildBulkReportWorkbook(reports);
      const clientName = reports[0]?.metadata?.clientName || 'client';
      const filename = `${clientName.replace(/[^a-z0-9]+/gi, '_')}_bulk_export_${Date.now()}.xlsx`;
      await streamWorkbook(workbook, res, filename);
    } catch (error) {
      console.error('❌ Excel export (bulk) failed:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = {
  buildSingleReportWorkbook,
  buildBulkReportWorkbook,
  generateAndSaveExcel,
  streamWorkbook,
  createReportExportAPI,
  OUTPUT_DIR,
};