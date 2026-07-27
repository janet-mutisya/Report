// server/routes/archiveRoutes.js
'use strict';

const express = require('express');
const router  = express.Router();
const auth    = require('./auth');

const {
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
} = require('../controllers/archiveController');

// All archive routes require a valid JWT.
// Client role is auto-pinned to their own clientId in the controller.
router.use(auth.useAuth);

// ── Archive health ────────────────────────────────────────────────────────────
router.get('/status',  archiveStatus);

// ── Clients & months in PatrolEventsArchive ───────────────────────────────────
router.get('/clients', listClients);
router.get('/months',  listMonths);     // months with RAW EVENTS

// ── Raw events (with zone names via LEFT JOIN) ────────────────────────────────
router.get('/events',     listEvents);
router.get('/events/pdf', downloadEventsPdf);  // PDF for any date range

// ── Alarm-code breakdown ──────────────────────────────────────────────────────
router.get('/summary',   eventSummary);

// ── Incidents (delegates to incidentModel, same as report pipeline) ───────────
router.get('/incidents', listIncidents);

// ── Generated reports (dbo.GeneratedReports) ─────────────────────────────────
// NOTE: /reports/months must be registered BEFORE /reports/:id so Express
// doesn't treat "months" as an :id param.
router.get('/reports/months',    listReportMonths);
router.get('/reports',           listReports);
router.get('/reports/:id',       getReport);
router.get('/reports/:id/pdf',   downloadReportPdf);

module.exports = router;