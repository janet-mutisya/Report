// server/controllers/archiveController.js
// Serves raw event data from PatrolEventsArchive AND generated reports.
// LEFT JOINs zone names from m_zonas for every event query.
// Calls reportModel for patrol filtering and incidentModel for incidents.
// Calls pdfService for PDF generation — same pipeline as the main report flow.
'use strict';

const { getPool, sql } = require('../config/database');
const {
  getArchivedEventClients,
  getArchivedEventMonths,
  getAlarmCodeSummary,
  getArchiveStatus,
} = require('../service/eventArchiveService');
const {
  getReportsForClient,
  getReportById,
  getArchivedMonths,
} = require('../service/reportArchiveService');
const { getIncidentCount } = require('../models/incidentModel');
const { generateDashboardPDF } = require('../service/pdfService');

// ─── helpers ─────────────────────────────────────────────────────────────────
function resolveClientId(req, supplied) {
  if (req.user.role === 'client') return req.user.clientId;
  return supplied ? parseInt(supplied) : null;
}

function bad(res, msg) {
  return res.status(400).json({ success: false, error: msg });
}

function err500(res, e) {
  console.error('[archiveController]', e.message);
  return res.status(500).json({ success: false, error: e.message });
}

// ─── GET /api/archive/status ──────────────────────────────────────────────────
async function archiveStatus(req, res) {
  try {
    const status = await getArchiveStatus();
    res.json({ success: true, status });
  } catch (e) { err500(res, e); }
}

// ─── GET /api/archive/clients ─────────────────────────────────────────────────
async function listClients(req, res) {
  try {
    if (req.user.role === 'client') {
      return res.json({
        success: true,
        clients: [{ id: req.user.clientId, name: req.user.companyName || 'My Account' }],
      });
    }
    const rows = await getArchivedEventClients();
    res.json({
      success: true,
      clients: rows.map(r => ({
        id:            r.ClientId,
        name:          r.ClientName   || `Client ${r.ClientId}`,
        accountNumber: r.AccountNumber,
        eventCount:    r.EventCount,
        earliest:      r.EarliestEvent,
        latest:        r.LatestEvent,
      })),
    });
  } catch (e) { err500(res, e); }
}

// ─── GET /api/archive/months?clientId=X ──────────────────────────────────────
// Returns months that have RAW EVENTS in PatrolEventsArchive.
async function listMonths(req, res) {
  try {
    const clientId = resolveClientId(req, req.query.clientId);
    if (!clientId) return bad(res, 'clientId is required');
    const rows = await getArchivedEventMonths(clientId);
    res.json({ success: true, months: rows });
  } catch (e) { err500(res, e); }
}

// ─── GET /api/archive/events ──────────────────────────────────────────────────
// Raw events with zone names via LEFT JOIN on m_zonas.
// Query params: clientId, startDate, endDate, alarmCode, limit (max 5000)
async function listEvents(req, res) {
  try {
    const clientId = resolveClientId(req, req.query.clientId);
    if (!clientId) return bad(res, 'clientId is required');

    const { startDate, endDate, alarmCode, limit = 500 } = req.query;
    const maxLimit = Math.min(parseInt(limit) || 500, 5000);

    const pool    = await getPool();
    const request = pool.request()
      .input('clientId', sql.Int, clientId)
      .input('limit',    sql.Int, maxLimit);

    const filters = ['a.ClientId = @clientId'];
    if (startDate) {
      request.input('startDate', sql.DateTime2, new Date(startDate));
      filters.push('a.EventDateTime >= @startDate');
    }
    if (endDate) {
      request.input('endDate', sql.DateTime2, new Date(endDate));
      filters.push('a.EventDateTime <= @endDate');
    }
    if (alarmCode) {
      request.input('alarmCode', sql.VarChar(20), String(alarmCode).trim().toUpperCase());
      filters.push('a.AlarmCode = @alarmCode');
    }

    const result = await request.query(`
      SELECT TOP (@limit)
        a.Id,
        a.SourceEventId,
        a.ClientId,
        a.ZoneCode,
        LTRIM(RTRIM(ISNULL(z.zon_cdescripcion, ''))) AS ZoneName,
        a.AlarmCode,
        a.EventDateTime,
        a.Content,
        a.Observations,
        a.UserId,
        a.FetchedAt,
        a.RawPayload
      FROM dbo.PatrolEventsArchive a
      LEFT JOIN [_Datos].[dbo].[m_zonas] z
        ON  z.zon_iidcuenta = a.ClientId
        AND LTRIM(RTRIM(z.zon_ccodigo)) = LTRIM(RTRIM(a.ZoneCode))
      WHERE ${filters.join(' AND ')}
      ORDER BY a.EventDateTime DESC
    `);

    const events = result.recordset.map(row => {
      let rawEvent = null;
      if (row.RawPayload) {
        try { rawEvent = JSON.parse(row.RawPayload); } catch {}
      }
      return {
        _archiveId:    row.Id,
        _fetchedAt:    row.FetchedAt,
        clientId:      row.ClientId,
        zoneCode:      row.ZoneCode,
        zoneName:      row.ZoneName || row.ZoneCode || 'Unknown Zone',
        alarmCode:     row.AlarmCode,
        eventDateTime: row.EventDateTime,
        content:       row.Content,
        observations:  row.Observations,
        userId:        row.UserId,
        rawEvent:      rawEvent ?? {
          rec_iid:            row.SourceEventId,
          rec_iidcuenta:      row.ClientId,
          rec_czona:          row.ZoneCode,
          rec_calarma:        row.AlarmCode,
          rec_tfechahora:     row.EventDateTime,
          rec_cContenido:     row.Content,
          rec_cObservaciones: row.Observations,
          rec_iusuario:       row.UserId,
        },
      };
    });

    res.json({
      success: true,
      count:   events.length,
      filterHint: {
        patrolArrivals: 'alarmCode=V04',
        incidents:      'alarmCode=V03',
        checkIns:       'alarmCode=_PI',
        allEvents:      '(no alarmCode filter)',
      },
      events,
    });
  } catch (e) { err500(res, e); }
}

// ─── GET /api/archive/summary ─────────────────────────────────────────────────
async function eventSummary(req, res) {
  try {
    const clientId = resolveClientId(req, req.query.clientId);
    if (!clientId) return bad(res, 'clientId is required');

    const { startDate, endDate } = req.query;
    const summary = await getAlarmCodeSummary(clientId, { startDate, endDate });

    res.json({
      success: true,
      summary,
      alarmCodeReference: {
        V04: 'Patrol arrival (VigiControl)',
        V03: 'Incident',
        V05: 'Check-in / departure',
        V10: 'GPS event',
        V11: 'Battery event',
        _PI: 'Check-in from invalid position',
        _PD: 'Check-out',
        S51: 'Panic alarm',
        S55: 'Arm/Disarm',
      },
    });
  } catch (e) { err500(res, e); }
}

// ─── GET /api/archive/incidents ───────────────────────────────────────────────
// Incidents (V03) for a client + date range, with zone names via LEFT JOIN.
// Delegates to incidentModel for consistency with the report pipeline.
async function listIncidents(req, res) {
  try {
    const clientId = resolveClientId(req, req.query.clientId);
    if (!clientId) return bad(res, 'clientId is required');

    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return bad(res, 'startDate and endDate are required');

    const result = await getIncidentCount(clientId, new Date(startDate), new Date(endDate));
    if (!result.success) throw new Error(result.error || 'Incident fetch failed');

    // Also fetch zone names for the incidents via archive LEFT JOIN
    const pool    = await getPool();
    const request = pool.request()
      .input('clientId',  sql.Int,       clientId)
      .input('startDate', sql.DateTime2, new Date(startDate))
      .input('endDate',   sql.DateTime2, new Date(endDate));

    const zoneResult = await request.query(`
      SELECT
        a.ZoneCode,
        LTRIM(RTRIM(ISNULL(z.zon_cdescripcion, ''))) AS ZoneName
      FROM dbo.PatrolEventsArchive a
      LEFT JOIN [_Datos].[dbo].[m_zonas] z
        ON  z.zon_iidcuenta = a.ClientId
        AND LTRIM(RTRIM(z.zon_ccodigo)) = LTRIM(RTRIM(a.ZoneCode))
      WHERE a.ClientId  = @clientId
        AND a.AlarmCode = 'V03'
        AND a.EventDateTime >= @startDate
        AND a.EventDateTime <= @endDate
      GROUP BY a.ZoneCode, z.zon_cdescripcion
    `);

    const zoneNames = new Map(
      zoneResult.recordset.map(r => [r.ZoneCode, r.ZoneName || r.ZoneCode])
    );

    const incidents = result.incidents.map(i => ({
      ...i,
      zoneName: zoneNames.get(String(i.zone || '').trim()) || i.zone || 'Unknown Zone',
    }));

    res.json({
      success:        true,
      totalIncidents: result.totalIncidents,
      incidents,
    });
  } catch (e) { err500(res, e); }
}

// ─── GET /api/archive/reports ─────────────────────────────────────────────────
// Generated reports from dbo.GeneratedReports.
// Supports range: all | month | day | custom
async function listReports(req, res) {
  try {
    const clientId = resolveClientId(req, req.query.clientId);
    if (!clientId) return bad(res, 'clientId is required');

    const { range = 'all', month, day, startDate, endDate, limit } = req.query;
    const reports = await getReportsForClient(clientId, { range, month, day, startDate, endDate, limit });
    res.json({ success: true, reports });
  } catch (e) { err500(res, e); }
}

// ─── GET /api/archive/reports/months ─────────────────────────────────────────
// Months that have GENERATED REPORTS for a client (from dbo.GeneratedReports).
async function listReportMonths(req, res) {
  try {
    const clientId = resolveClientId(req, req.query.clientId);
    if (!clientId) return bad(res, 'clientId is required');
    const months = await getArchivedMonths(clientId);
    res.json({ success: true, months });
  } catch (e) { err500(res, e); }
}

// ─── GET /api/archive/reports/:id ────────────────────────────────────────────
// Full report JSON for the View button.
async function getReport(req, res) {
  try {
    const report = await getReportById(parseInt(req.params.id));
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });

    if (req.user.role === 'client' && report.ClientId !== req.user.clientId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    res.json({ success: true, data: report.ReportData });
  } catch (e) { err500(res, e); }
}

// ─── GET /api/archive/reports/:id/pdf ────────────────────────────────────────
// Re-generates a PDF for a stored report using the same pdfService pipeline.
async function downloadReportPdf(req, res) {
  try {
    const report = await getReportById(parseInt(req.params.id));
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });

    if (req.user.role === 'client' && report.ClientId !== req.user.clientId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const { ClientId, ClientName, StartDate, EndDate } = report;

    // pdfService.generateDashboardPDF re-runs fetchPatrolReport internally —
    // same pipeline as the live PDF endpoint, ensuring PDF and JSON match.
    const pdfBuffer = await generateDashboardPDF({
      clientId:   ClientId,
      clientName: ClientName,
      startDate:  StartDate,
      endDate:    EndDate,
    });

    const filename = `patrol-report-${ClientName.replace(/\s+/g, '-')}-${StartDate}-${EndDate}.pdf`
      .replace(/[^a-zA-Z0-9\-_.]/g, '');

    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length',      pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (e) { err500(res, e); }
}

// ─── GET /api/archive/events/pdf ─────────────────────────────────────────────
// Generate a PDF directly from a raw event date range query (not a stored report).
async function downloadEventsPdf(req, res) {
  try {
    const clientId = resolveClientId(req, req.query.clientId);
    if (!clientId) return bad(res, 'clientId is required');

    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return bad(res, 'startDate and endDate are required');

    // Resolve client name for the PDF header
    const pool     = await getPool();
    const clientR  = await pool.request()
      .input('cid', sql.Int, clientId)
      .query(`SELECT LTRIM(RTRIM(cue_cnombre)) AS name FROM [_Datos].[dbo].[m_cuentas] WHERE cue_iid = @cid`);
    const clientName = clientR.recordset[0]?.name || `Client ${clientId}`;

    const pdfBuffer = await generateDashboardPDF({ clientId, clientName, startDate, endDate });

    const filename = `patrol-report-${clientName.replace(/\s+/g, '-')}-${startDate}-${endDate}.pdf`
      .replace(/[^a-zA-Z0-9\-_.]/g, '');

    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length',      pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (e) { err500(res, e); }
}

module.exports = {
  archiveStatus,
  listClients,
  listMonths,
  listEvents,
  eventSummary,
  listIncidents,
  listReports,
  listReportMonths,
  getReport,
  downloadReportPdf,
  downloadEventsPdf,
};