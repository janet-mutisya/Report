// routes/schedulerRoutes.js — FIX 20: SHIFT-AWARE REWRITE
//
// This version features:
// 1. Clean separation of concerns with proper error handling
// 2. Full integration with managePatrolSchedules.js
// 3. No patrol JSON pollution in rep_cmail field
// 4. Graceful fallbacks for API failures
// 5. Consistent response structure
// 6. Comprehensive logging
//
// ✅ FIX 20 (this rewrite): every route that can create or look up a
// schedule row is now shift-aware and uses the SAME canonical enum as
// schedulerController.js / managePatrolSchedules.js:
//
//     'day'   → 06:00 – 18:00                (same calendar day)
//     'night' → 18:00 – 06:00 (next day)      (rolls over midnight)
//     'both'  → full 24hr window: 06:00 – 06:00 (next day)
//               (i.e. the day window + the night window back to back)
//
// Previously, PUT /clients/:clientId/email-config created a NEW schedule
// row with rep_shift_type left NULL whenever a client had no existing
// row, and its "does a schedule already exist" check looked ONLY at
// rep_iidcuenta — not at (rep_iidcuenta, rep_shift_type). That meant:
//   - a client could silently get an untyped/legacy row from this route
//   - createSchedule()'s (clientId, shiftType) duplicate check couldn't
//     see that untyped row, so a client could end up with THREE
//     uncoordinated rows (untyped + day + night) instead of at most
//     one row per shift.
// This rewrite fixes that: every create/lookup path here is scoped to
// (clientId, shiftType), exactly like schedulerController.createSchedule.
//
// REQUIRED DB MIGRATION (run once, if not already applied):
//   ALTER TABLE _Datos.dbo.m_reportes_automaticos
//   ADD rep_patrol_config NVARCHAR(MAX) NULL;
//
//   -- Migrate any existing patrol JSON from rep_cmail to rep_patrol_config
//   UPDATE _Datos.dbo.m_reportes_automaticos
//   SET rep_patrol_config = rep_cmail, rep_cmail = NULL
//   WHERE rep_cmail LIKE '{%patrolsPerDay%}';

const express = require("express");
const database = require('../config/database.js');
const sql = require('mssql');
const schedulerController = require("../controllers/schedulerController.js");
const patrolSchedules = require('../scripts/managePatrolSchedules.js');
const { auth, requireAdmin, requireAny } = require('../middleware/auth.js');

const router = express.Router();

// =============================================
// CONSTANTS & CONFIGURATION
// =============================================

const DEFAULT_DAYS_BACK = 7;
const MAX_DAYS_BACK = 90;

// Human-readable shift type values shown/accepted in the patrol-config UI
const VALID_SHIFT_TYPES_UI = ['Day/Night', 'Night Only', 'Day Only'];
const VALID_SCHEDULE_TYPES = ['daily', 'weekly', 'custom'];

// ✅ Canonical lowercase enum — same one schedulerController.js and
// managePatrolSchedules.js require. This is the single source of truth
// for hour semantics used across the whole app:
//
//   day   → 06:00 – 18:00 (same day)
//   night → 18:00 – 06:00 (next day)
//   both  → 06:00 – 06:00 (next day)  — full 24hr window (day + night back to back)
const { VALID_SHIFT_TYPES, normaliseShiftType } = schedulerController;

const SHIFT_TYPE_LABELS = {
  day:   'Day Only (06:00–18:00)',
  night: 'Night Only (18:00–06:00)',
  both:  'Day/Night (24hr: 06:00–06:00)',
};

// UI → canonical enum. Both directions are supported on input so the
// frontend can send either the human-readable label or the raw enum;
// everything is normalised to the canonical enum before it touches the DB.
const SHIFT_TYPE_UI_TO_ENUM = {
  'Day/Night':  'both',
  'Day Only':   'day',
  'Night Only': 'night',
};

/**
 * resolveShiftTypeInput
 * Accepts either the human-readable UI label ('Day/Night', 'Day Only',
 * 'Night Only') or the canonical enum ('day' | 'night' | 'both') or any
 * of the loose synonyms normaliseShiftType() already understands, and
 * always returns a valid canonical enum value.
 *
 * Returns null if the input is present but not resolvable to a valid
 * shift type — callers should treat that as a 400, NOT silently default,
 * per the "shiftType has no silent default" policy used elsewhere.
 */
const resolveShiftTypeInput = (input) => {
  if (input === undefined || input === null || input === '') return null;
  if (SHIFT_TYPE_UI_TO_ENUM[input]) return SHIFT_TYPE_UI_TO_ENUM[input];
  if (VALID_SHIFT_TYPES.includes(input)) return input;
  const normalised = normaliseShiftType(input);
  // normaliseShiftType() defaults unrecognised input to 'both' — that's
  // the right behaviour deep in date-range math, but wrong here where we
  // want to REJECT garbage input rather than silently coerce it. So we
  // only trust the normalised result if the raw input was one of the
  // synonyms normaliseShiftType() explicitly recognises.
  const knownSynonyms = [
    'day', 'daytime', 'day shift',
    'night', 'nighttime', 'night shift',
    'both', 'day/night', 'all', '24hr',
  ];
  if (typeof input === 'string' && knownSynonyms.includes(input.trim().toLowerCase())) {
    return normalised;
  }
  return null;
};

// =============================================
// UTILITY FUNCTIONS
// =============================================

const validateClientId = (clientId) => {
  const id = parseInt(clientId);
  return isNaN(id) || id <= 0 ? null : id;
};

const validatePatrolConfig = (config) => {
  const errors = [];

  if (config.patrolsPerDay !== undefined && (isNaN(config.patrolsPerDay) || config.patrolsPerDay < 0)) {
    errors.push('patrolsPerDay must be a non-negative number');
  }

  if (config.weekendPatrols !== undefined && (isNaN(config.weekendPatrols) || config.weekendPatrols < 0)) {
    errors.push('weekendPatrols must be a non-negative number');
  }

  if (config.shiftType && !VALID_SHIFT_TYPES_UI.includes(config.shiftType) && !VALID_SHIFT_TYPES.includes(config.shiftType)) {
    errors.push(`shiftType must be one of: ${VALID_SHIFT_TYPES_UI.join(', ')} (or the raw values: ${VALID_SHIFT_TYPES.join(', ')})`);
  }

  if (config.scheduleType && !VALID_SCHEDULE_TYPES.includes(config.scheduleType)) {
    errors.push(`scheduleType must be one of: ${VALID_SCHEDULE_TYPES.join(', ')}`);
  }

  return errors;
};

const sendJsonResponse = (res, status, success, message, data = null, extra = {}) => {
  const response = { success, message, timestamp: new Date().toISOString(), ...extra };
  if (data !== null) response.data = data;
  return res.status(status).json(response);
};

// =============================================
// HEALTH & STATUS ROUTES
// =============================================

router.get('/health', auth, requireAny, async (req, res) => {
  try {
    sendJsonResponse(res, 200, true, 'Scheduler API is running', null, {
      version: '2.1.0 - Shift-aware rewrite (FIX 20)',
      timestamp: new Date().toISOString(),
      features: {
        patrolManagement: 'managePatrolSchedules.js integration',
        emailSending: global.EMAIL_SENDING_ENABLED || false,
        dataModel: 'API-first with DB fallback',
        duplicateProtection: 'active (2-minute cooldown)',
        multiEmailSupport: true,
        patrolConfigColumn: 'rep_patrol_config',
        shiftTypeSupport: {
          enabled: true,
          values: VALID_SHIFT_TYPES,
          uniquenessKey: '(clientId, shiftType)',
          windows: SHIFT_TYPE_LABELS,
        },
      },
      endpoints: {
        clients: '/api/scheduler/clients',
        clientsBasic: '/api/scheduler/clients/basic',
        patrols: '/api/scheduler/clients/:clientId/patrols',
        emailConfig: '/api/scheduler/clients/:clientId/email-config?shiftType=day|night|both',
        analytics: '/api/scheduler/analytics',
        historical: '/api/scheduler/historical/:clientId'
      }
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    sendJsonResponse(res, 500, false, 'Health check failed', null, { error: error.message });
  }
});

router.get("/status", auth, requireAny, schedulerController.getSchedulerStatus);

// =============================================
// DIAGNOSTIC & TESTING ROUTES
// =============================================

router.get('/diagnostic/services', auth, requireAdmin, schedulerController.diagnosticServices);
router.post('/test/report-model', auth, requireAdmin, schedulerController.testReportModel);
router.post('/toggle-email', auth, requireAdmin, schedulerController.toggleEmailSending);

// =============================================
// EMAIL UTILITY ROUTES
// =============================================

router.post('/utils/parse-emails', auth, requireAny, async (req, res) => {
  try {
    const { emailString } = req.body;

    if (!emailString) {
      return sendJsonResponse(res, 400, false, 'emailString is required');
    }

    const parsedEmails = schedulerController.parseEmails(emailString);
    const formattedDisplay = schedulerController.formatEmailsForDisplay(emailString);

    sendJsonResponse(res, 200, true, 'Emails parsed successfully', {
      original: emailString,
      parsed: parsedEmails,
      count: parsedEmails.length,
      formatted: formattedDisplay,
      validation: {
        valid: parsedEmails.length > 0,
        invalidCount: emailString.split(/[,;\n]/).length - parsedEmails.length
      }
    }, {
      emailStatus: { globalEnabled: global.EMAIL_SENDING_ENABLED || false }
    });
  } catch (error) {
    console.error('❌ Error parsing emails:', error);
    sendJsonResponse(res, 500, false, 'Failed to parse emails', null, { error: error.message });
  }
});

router.get('/utils/email-stats', auth, requireAdmin, async (req, res) => {
  try {
    const pool = await database.poolPromise;
    const result = await pool.request().query(`
      SELECT 
        rep_iidcuenta AS ClientID,
        rep_shift_type AS ShiftType,
        rep_cmail AS EmailString,
        CASE 
          WHEN rep_cmail LIKE '{%' THEN 0
          ELSE LEN(rep_cmail) - LEN(REPLACE(rep_cmail, ',', '')) + 1 
        END AS EmailCount
      FROM _Datos.dbo.m_reportes_automaticos
      WHERE rep_cmail IS NOT NULL AND rep_cmail != ''
      ORDER BY EmailCount DESC
    `);

    const validSchedules = result.recordset.filter(row => row.EmailCount > 0);
    const totalRecipients = validSchedules.reduce((sum, row) => sum + row.EmailCount, 0);

    sendJsonResponse(res, 200, true, 'Email statistics retrieved', {
      totalSchedules: result.recordset.length,
      schedulesWithEmails: validSchedules.length,
      totalEmailRecipients: totalRecipients,
      averageEmailsPerSchedule: validSchedules.length > 0
        ? Math.round(totalRecipients / validSchedules.length)
        : 0,
      distribution: {
        singleEmail: validSchedules.filter(row => row.EmailCount === 1).length,
        multipleEmails: validSchedules.filter(row => row.EmailCount > 1).length,
        maxEmails: validSchedules.length > 0
          ? Math.max(...validSchedules.map(row => row.EmailCount))
          : 0
      },
      schedules: validSchedules.slice(0, 100).map(row => ({
        clientId: row.ClientID,
        shiftType: normaliseShiftType(row.ShiftType),
        emailCount: row.EmailCount,
        emailString: row.EmailString
      }))
    }, {
      emailStatus: { globalEnabled: global.EMAIL_SENDING_ENABLED || false }
    });
  } catch (error) {
    console.error('❌ Error fetching email stats:', error);
    sendJsonResponse(res, 500, false, 'Failed to fetch email statistics', null, { error: error.message });
  }
});

// =============================================
// CLIENT DATA ROUTES
// =============================================

/**
 * GET /api/scheduler/clients
 * Returns all clients with their patrol data and performance metrics.
 * ✅ FIX 20: a client can now have multiple schedule rows (one per shift),
 * so `schedules` is returned as an array instead of a single `schedule`
 * object. `schedule` is kept as a deprecated alias pointing at the first
 * row, purely for backwards compatibility with older frontend code.
 */
router.get('/clients', auth, requireAny, async (req, res) => {
  try {
    const pool = await database.poolPromise;
    const days = Math.min(parseInt(req.query.days) || DEFAULT_DAYS_BACK, MAX_DAYS_BACK);

    const result = await pool.request().query(`
      SELECT 
        C.cue_iid AS ClientID,
        C.cue_cnombre AS ClientName,
        C.cue_cemail AS ClientEmail,
        C.cue_ncuenta AS AccountNumber,
        C.cue_ctipo AS ClientType,
        R.rep_idKey AS ScheduleId,
        R.rep_tproximoenvio AS NextRun,
        R.rep_nfrecuencia AS Frequency,
        R.rep_shift_type AS ShiftType,
        CASE 
          WHEN R.rep_cmail LIKE '{%' THEN NULL
          ELSE R.rep_cmail
        END AS ReportEmail,
        R.schedule_config AS PatrolConfig
      FROM _Datos.dbo.m_cuentas C
      LEFT JOIN _Datos.dbo.m_reportes_automaticos R ON R.rep_iidcuenta = C.cue_iid
      WHERE C.cue_nmostrar IN (1, 2)
      ORDER BY C.cue_cnombre ASC, R.rep_shift_type ASC
    `);

    // Group rows by client (a client may now have up to 3 schedule rows:
    // day / night / both), then attach patrol performance once per client.
    const clientMap = new Map();
    for (const row of result.recordset) {
      if (!clientMap.has(row.ClientID)) {
        clientMap.set(row.ClientID, {
          ClientID: row.ClientID,
          ClientName: row.ClientName,
          ClientEmail: row.ClientEmail,
          AccountNumber: row.AccountNumber,
          ClientType: row.ClientType,
          PatrolConfig: row.PatrolConfig,
          rows: [],
        });
      }
      if (row.ScheduleId) {
        clientMap.get(row.ClientID).rows.push(row);
      }
    }

    const clients = await Promise.all(
      Array.from(clientMap.values()).map(async (client) => {
        let performance = {
          overallPerformance: 0,
          totalCompleted: 0,
          totalExpected: 0,
          postsCount: 0,
          eventsCount: 0,
          guardReportsCount: 0,
          dataSource: 'Unknown',
          success: false,
          error: null
        };

        try {
          const reportData = await schedulerController.getClientPatrols(client.ClientID, days);

          if (reportData?.metadata?.success) {
            performance = {
              overallPerformance: reportData.metadata.overallPerformance || 0,
              totalCompleted: reportData.metadata.totalCompleted || 0,
              totalExpected: reportData.metadata.totalExpectedPatrols || 0,
              postsCount: reportData.posts?.length || 0,
              eventsCount: reportData.events?.length || 0,
              guardReportsCount: reportData.guardReports?.length || 0,
              dataSource: reportData.metadata.dataSource || 'Unknown',
              success: true,
              error: null
            };
          } else {
            performance.error = reportData?.metadata?.error || 'No data available';
          }
        } catch (patrolErr) {
          console.warn(`⚠️ Patrol fetch failed for client ${client.ClientID}: ${patrolErr.message}`);
          performance.error = patrolErr.message;
        }

        let patrolConfig = null;
        if (client.PatrolConfig) {
          try {
            patrolConfig = JSON.parse(client.PatrolConfig);
          } catch (e) {
            console.warn(`⚠️ Invalid patrol config JSON for client ${client.ClientID}`);
          }
        }

        const schedules = client.rows.map((row) => {
          const reportEmail = row.ReportEmail || '';
          const parsedEmails = schedulerController.parseEmails(reportEmail);
          const shiftType = normaliseShiftType(row.ShiftType);
          return {
            id: row.ScheduleId,
            nextRun: row.NextRun,
            frequency: row.Frequency,
            shiftType,
            shiftLabel: SHIFT_TYPE_LABELS[shiftType],
            emailConfig: {
              raw: reportEmail,
              emails: parsedEmails,
              emailCount: parsedEmails.length,
              formattedEmails: schedulerController.formatEmailsForDisplay(reportEmail)
            },
          };
        });

        return {
          id: client.ClientID,
          ClientID: client.ClientID,
          name: client.ClientName || `Client ${client.ClientID}`,
          ClientName: client.ClientName || `Client ${client.ClientID}`,
          email: client.ClientEmail || '',
          ClientEmail: client.ClientEmail || '',
          accountNumber: client.AccountNumber || '',
          AccountNumber: client.AccountNumber || '',
          clientType: client.ClientType || '',
          schedules,
          // Deprecated: kept for older frontend code expecting a single schedule
          schedule: schedules.length > 0 ? schedules[0] : null,
          patrolConfig,
          hasCustomSchedule: !!patrolConfig,
          performance,
          lastUpdated: new Date().toISOString()
        };
      })
    );

    const clientsWithData = clients.filter(c => c.performance.success);
    const clientsWithoutData = clients.filter(c => !c.performance.success);

    sendJsonResponse(res, 200, true, 'Clients retrieved successfully', {
      clients,
      summary: {
        total: clients.length,
        withPerformanceData: clientsWithData.length,
        withoutPerformanceData: clientsWithoutData.length,
        averagePerformance: clientsWithData.length > 0
          ? Math.round(clientsWithData.reduce((sum, c) => sum + c.performance.overallPerformance, 0) / clientsWithData.length)
          : 0
      },
      timeframe: `Last ${days} days`,
      dataModel: 'API-first with DB fallback',
      shiftTypeSupport: { enabled: true, values: VALID_SHIFT_TYPES, windows: SHIFT_TYPE_LABELS },
    });
  } catch (error) {
    console.error('❌ Error getting clients:', error);
    sendJsonResponse(res, 500, false, 'Failed to retrieve clients', null, { error: error.message });
  }
});

/**
 * GET /api/scheduler/clients/basic
 * Lightweight endpoint for dropdowns - no patrol data fetching
 */
router.get('/clients/basic', auth, requireAny, async (req, res) => {
  try {
    const pool = await database.poolPromise;
    const result = await pool.request().query(`
      SELECT 
        cue_iid AS ClientID,
        cue_ncuenta AS AccountNumber,
        cue_cnombre AS ClientName,
        cue_cemail AS ClientEmail,
        cue_ctipo AS ClientType,
        cue_nmostrar AS Status
      FROM _Datos.dbo.m_cuentas
      WHERE cue_nmostrar IN (1, 2)
      ORDER BY cue_cnombre ASC
    `);

    sendJsonResponse(res, 200, true, 'Clients retrieved successfully', {
      total: result.recordset.length,
      clients: result.recordset
    });
  } catch (error) {
    console.error('❌ Error fetching basic clients:', error);
    sendJsonResponse(res, 500, false, 'Failed to fetch clients', null, { error: error.message });
  }
});

/**
 * GET /api/scheduler/clients/:clientId/patrols
 * Returns patrol data and configuration for a specific client
 */
router.get('/clients/:clientId/patrols', auth, requireAny, async (req, res) => {
  try {
    const clientId = validateClientId(req.params.clientId);
    if (!clientId) {
      return sendJsonResponse(res, 400, false, 'Invalid clientId - must be a positive integer');
    }

    const days = Math.min(parseInt(req.query.days) || DEFAULT_DAYS_BACK, MAX_DAYS_BACK);

    console.log(`📊 Fetching patrol data for client ${clientId} (${days} days)`);

    const [patrolData, scheduleConfig] = await Promise.all([
      patrolSchedules.getClientPatrols(clientId, days),
      patrolSchedules.getPatrolScheduleConfig(clientId)
    ]);

    sendJsonResponse(res, 200, true, 'Patrol data retrieved successfully', {
      patrolData,
      patrolConfig: scheduleConfig.success ? scheduleConfig.data : null,
      metadata: {
        clientId,
        daysAnalyzed: days,
        generatedAt: new Date().toISOString(),
        dataSource: scheduleConfig.success
          ? (scheduleConfig.data?.ConfigSource || 'managePatrolSchedules')
          : 'managePatrolSchedules',
        processingTime: patrolData.summary?.processingTimeMs || 0
      }
    });
  } catch (error) {
    console.error(`❌ Error fetching patrol data for client ${req.params.clientId}:`, error);
    sendJsonResponse(res, 500, false, 'Failed to fetch patrol data', null, { error: error.message });
  }
});

/**
 * PUT /api/scheduler/clients/:clientId/patrols
 * Saves patrol configuration using managePatrolSchedules.js
 * This ensures patrol JSON never pollutes the rep_cmail field.
 *
 * shiftType is REQUIRED (accepts either the human-readable UI label or
 * the raw enum) and is translated to the canonical enum before being
 * handed to managePatrolSchedules.js, which rejects anything else.
 */
router.put('/clients/:clientId/patrols', auth, requireAdmin, async (req, res) => {
  try {
    const clientId = validateClientId(req.params.clientId);
    if (!clientId) {
      return sendJsonResponse(res, 400, false, 'Invalid clientId - must be a positive integer');
    }

    const validationErrors = validatePatrolConfig(req.body);
    if (validationErrors.length > 0) {
      return sendJsonResponse(res, 400, false, 'Invalid patrol configuration', null, {
        errors: validationErrors
      });
    }

    const resolvedShiftType = resolveShiftTypeInput(req.body.shiftType);
    if (!resolvedShiftType) {
      return sendJsonResponse(res, 400, false,
        `shiftType is required. Must be one of: ${VALID_SHIFT_TYPES_UI.join(', ')} (or: ${VALID_SHIFT_TYPES.join(', ')})`);
    }

    console.log(`📝 Saving patrol config for client ${clientId} [shift=${resolvedShiftType}] via managePatrolSchedules`);

    const patrolPayload = {
      ...req.body,
      shiftType: resolvedShiftType,
    };

    const result = await patrolSchedules.upsertPatrolSchedule(clientId, patrolPayload);

    if (result.success) {
      sendJsonResponse(res, 200, true, result.message, result.data, {
        savedVia: 'managePatrolSchedules.js',
        shiftType: resolvedShiftType,
        shiftLabel: SHIFT_TYPE_LABELS[resolvedShiftType],
      });
    } else {
      sendJsonResponse(res, 400, false, result.error || 'Failed to save patrol schedule');
    }
  } catch (error) {
    console.error('❌ Error saving patrol schedule:', error);

    if (error.message && error.message.includes('rep_patrol_config')) {
      return sendJsonResponse(res, 500, false, 'Database migration required - rep_patrol_config column missing', null, {
        migration: `
ALTER TABLE _Datos.dbo.m_reportes_automaticos ADD rep_patrol_config NVARCHAR(MAX) NULL;
UPDATE _Datos.dbo.m_reportes_automaticos 
SET rep_patrol_config = rep_cmail, rep_cmail = NULL 
WHERE rep_cmail LIKE '{%patrolsPerDay%}';
        `.trim(),
        error: error.message
      });
    }

    sendJsonResponse(res, 500, false, 'Failed to save patrol schedule', null, { error: error.message });
  }
});

/**
 * GET /api/scheduler/clients/:clientId/email-config
 * Returns email configuration for a client.
 *
 * ✅ FIX 20: a client can have up to 3 schedule rows (day/night/both).
 * - No `shiftType` query param → returns ALL of the client's schedule
 *   rows under `schedules[]`, so the frontend can render Day + Night
 *   side by side.
 * - `?shiftType=day|night|both` (or a UI label) → returns just that one
 *   row under `schedule`, for backwards compatibility with single-shift
 *   callers.
 */
router.get('/clients/:clientId/email-config', auth, requireAdmin, async (req, res) => {
  try {
    const clientId = validateClientId(req.params.clientId);
    if (!clientId) {
      return sendJsonResponse(res, 400, false, 'Invalid clientId - must be a positive integer');
    }

    let filterShiftType = null;
    if (req.query.shiftType) {
      filterShiftType = resolveShiftTypeInput(req.query.shiftType);
      if (!filterShiftType) {
        return sendJsonResponse(res, 400, false,
          `Invalid shiftType query param. Must be one of: ${VALID_SHIFT_TYPES_UI.join(', ')} (or: ${VALID_SHIFT_TYPES.join(', ')})`);
      }
    }

    const pool = await database.poolPromise;

    const scheduleRequest = pool.request().input('clientId', sql.Int, clientId);
    let scheduleQuery = `
      SELECT 
        rep_idKey AS ScheduleId,
        rep_shift_type AS ShiftType,
        CASE WHEN rep_cmail LIKE '{%' THEN NULL ELSE rep_cmail END AS ReportEmail,
        rep_tproximoenvio AS NextRun,
        rep_nfrecuencia AS Frequency
      FROM _Datos.dbo.m_reportes_automaticos
      WHERE rep_iidcuenta = @clientId
    `;
    if (filterShiftType) {
      scheduleRequest.input('shiftType', sql.VarChar(10), filterShiftType);
      scheduleQuery += ` AND rep_shift_type = @shiftType`;
    }
    scheduleQuery += ` ORDER BY rep_shift_type ASC`;

    const [scheduleResult, clientResult] = await Promise.all([
      scheduleRequest.query(scheduleQuery),
      pool.request()
        .input('clientId', sql.Int, clientId)
        .query(`
          SELECT 
            cue_cemail AS ClientEmail,
            cue_ncuenta AS AccountNumber,
            cue_cnombre AS ClientName
          FROM _Datos.dbo.m_cuentas 
          WHERE cue_iid = @clientId
        `)
    ]);

    const client = clientResult.recordset[0] || {};
    const clientEmail = client.ClientEmail || '';
    const parsedClientEmails = schedulerController.parseEmails(clientEmail);

    const schedules = scheduleResult.recordset.map((row) => {
      const scheduleEmail = row.ReportEmail || '';
      const parsedScheduleEmails = schedulerController.parseEmails(scheduleEmail);
      const shiftType = normaliseShiftType(row.ShiftType);

      let primarySource = 'none';
      let primaryEmails = [];
      if (parsedScheduleEmails.length > 0) {
        primarySource = 'schedule';
        primaryEmails = parsedScheduleEmails;
      } else if (parsedClientEmails.length > 0) {
        primarySource = 'client';
        primaryEmails = parsedClientEmails;
      }

      return {
        id: row.ScheduleId,
        shiftType,
        shiftLabel: SHIFT_TYPE_LABELS[shiftType],
        nextRun: row.NextRun,
        frequency: row.Frequency,
        emails: {
          schedule: {
            raw: scheduleEmail,
            parsed: parsedScheduleEmails,
            count: parsedScheduleEmails.length,
            formatted: schedulerController.formatEmailsForDisplay(scheduleEmail)
          },
          client: {
            raw: clientEmail,
            parsed: parsedClientEmails,
            count: parsedClientEmails.length,
            formatted: schedulerController.formatEmailsForDisplay(clientEmail)
          },
          primary: {
            source: primarySource,
            emails: primaryEmails,
            count: primaryEmails.length
          }
        }
      };
    });

    sendJsonResponse(res, 200, true, 'Email configuration retrieved', {
      clientId,
      clientName: client.ClientName,
      accountNumber: client.AccountNumber,
      schedules,
      // Backwards-compat: single-shift shape when a shiftType filter was given
      schedule: filterShiftType ? (schedules[0] || null) : undefined,
    }, {
      emailSendingEnabled: global.EMAIL_SENDING_ENABLED || false,
      shiftTypeSupport: { enabled: true, values: VALID_SHIFT_TYPES, windows: SHIFT_TYPE_LABELS },
    });
  } catch (error) {
    console.error(`❌ Error fetching email config for client ${req.params.clientId}:`, error);
    sendJsonResponse(res, 500, false, 'Failed to fetch email configuration', null, { error: error.message });
  }
});

/**
 * PUT /api/scheduler/clients/:clientId/email-config
 * Creates or updates the email configuration for ONE shift of a client.
 *
 * ✅ FIX 20: `shiftType` is now REQUIRED in the body (accepts the UI
 * label or the raw enum — no silent default, consistent with the rest
 * of the app's shift-type policy). The "does a schedule already exist"
 * check — and therefore whether this does an INSERT or an UPDATE — is
 * now scoped to (clientId, shiftType), exactly like
 * schedulerController.createSchedule. This is what actually fixes the
 * bug where this route could create an untyped duplicate row alongside
 * a client's Day/Night schedules.
 */router.put('/clients/:clientId/email-config', auth, requireAdmin, async (req, res) => {
  try {
    const clientId = validateClientId(req.params.clientId);
    if (!clientId) {
      return sendJsonResponse(res, 400, false, 'Invalid clientId - must be a positive integer');
    }

    const { emails } = req.body;

    if (!emails || typeof emails !== 'string') {
      return sendJsonResponse(res, 400, false, 'emails string is required');
    }

    const resolvedShiftType = resolveShiftTypeInput(req.body.shiftType);
    if (!resolvedShiftType) {
      return sendJsonResponse(res, 400, false,
        `shiftType is required. Must be one of: ${VALID_SHIFT_TYPES_UI.join(', ')} (or: ${VALID_SHIFT_TYPES.join(', ')})`);
    }

    const parsedEmails = schedulerController.parseEmails(emails);

    if (parsedEmails.length === 0) {
      return sendJsonResponse(res, 400, false, 'No valid email addresses provided');
    }

    const pool = await database.poolPromise;

    // 🔥 CRITICAL FIX: Use a single connection for both commands
    const connection = await pool.connect();

    try {
      // Execute SET IDENTITY_INSERT OFF on the same connection
      await connection.request().query(`
        SET IDENTITY_INSERT _Datos.dbo.m_reportes_automaticos OFF
      `);

      // ✅ Scoped to (clientId, shiftType) — matches createSchedule's dedup key
      const existing = await connection.request()
        .input('clientId', sql.Int, clientId)
        .input('shiftType', sql.VarChar(10), resolvedShiftType)
        .query(`
          SELECT rep_idKey 
          FROM _Datos.dbo.m_reportes_automaticos 
          WHERE rep_iidcuenta = @clientId AND rep_shift_type = @shiftType
        `);

      let scheduleId;

      if (existing.recordset.length === 0) {
        const defaultNextRun = new Date();
        defaultNextRun.setDate(defaultNextRun.getDate() + 1);
        defaultNextRun.setHours(9, 0, 0, 0);

        const insertResult = await connection.request()
          .input('clientId', sql.Int, clientId)
          .input('nextRun', sql.DateTime, defaultNextRun)
          .input('email', sql.VarChar(4000), emails)
          .input('shiftType', sql.VarChar(10), resolvedShiftType)
          .query(`
            INSERT INTO _Datos.dbo.m_reportes_automaticos 
              (rep_iidcuenta, rep_ntipo, rep_tproximoenvio, rep_nfrecuencia, rep_cmail, rep_nCadaUnidadTiempo, rep_shift_type)
            OUTPUT INSERTED.rep_idKey
            VALUES (@clientId, 1, @nextRun, 2, @email, 1, @shiftType)
          `);
        scheduleId = insertResult.recordset[0].rep_idKey;
        console.log(`✅ Created new [${resolvedShiftType}] schedule row ${scheduleId} for client ${clientId}`);
      } else {
        scheduleId = existing.recordset[0].rep_idKey;
        await connection.request()
          .input('clientId', sql.Int, clientId)
          .input('shiftType', sql.VarChar(10), resolvedShiftType)
          .input('email', sql.VarChar(4000), emails)
          .query(`
            UPDATE _Datos.dbo.m_reportes_automaticos 
            SET rep_cmail = @email
            WHERE rep_iidcuenta = @clientId AND rep_shift_type = @shiftType
          `);
        console.log(`✅ Updated [${resolvedShiftType}] schedule row ${scheduleId} for client ${clientId}`);
      }

      console.log(`✅ Updated email config for client ${clientId} [${resolvedShiftType}]: ${parsedEmails.length} email(s)`);

      sendJsonResponse(res, 200, true, 'Email configuration updated', {
        clientId,
        scheduleId,
        shiftType: resolvedShiftType,
        shiftLabel: SHIFT_TYPE_LABELS[resolvedShiftType],
        emailsConfigured: parsedEmails,
        emailCount: parsedEmails.length
      });
    } finally {
      // Always release the connection back to the pool
      connection.release();
    }
  } catch (error) {
    console.error(`❌ Error updating email config for client ${req.params.clientId}:`, error);
    sendJsonResponse(res, 500, false, 'Failed to update email configuration', null, { error: error.message });
  }
});

// =============================================
// MANUAL TRIGGER ROUTES
// =============================================

router.post("/trigger/dynamic-reports", auth, requireAdmin, schedulerController.triggerDynamicReports);
router.post("/trigger/patrol-reports", auth, requireAdmin, schedulerController.triggerPatrolReports);

router.post('/trigger/test-email', auth, requireAdmin, async (req, res) => {
  try {
    const { to, subject = 'Test Email from Scheduler', message = 'This is a test email from the scheduler system.' } = req.body;

    if (!to) {
      return sendJsonResponse(res, 400, false, 'Recipient email (to) is required');
    }

    const emailService = require('../service/emailService.js');
    const emailResult = await emailService.sendTestEmail({ to, subject, message });

    sendJsonResponse(res, 200, true, 'Test email sent successfully', emailResult);
  } catch (error) {
    console.error('❌ Error sending test email:', error);
    sendJsonResponse(res, 500, false, 'Failed to send test email', null, { error: error.message });
  }
});

// =============================================
// ANALYTICS ROUTES
// =============================================

router.get('/analytics/summary', auth, requireAny, async (req, res) => {
  try {
    const pool = await database.poolPromise;

    const [
      clientsResult,
      dueResult,
      upcomingResult,
      totalResult,
      emailStatsResult
    ] = await Promise.all([
      pool.request().query(`
        SELECT COUNT(DISTINCT rep_iidcuenta) as activeClients 
        FROM _Datos.dbo.m_reportes_automaticos 
        WHERE rep_cmail IS NOT NULL AND rep_cmail != '' AND rep_cmail NOT LIKE '{%'
      `),
      pool.request().query(`
        SELECT COUNT(*) as dueReports 
        FROM _Datos.dbo.m_reportes_automaticos 
        WHERE rep_tproximoenvio <= GETDATE() 
          AND rep_cmail IS NOT NULL AND rep_cmail != '' AND rep_cmail NOT LIKE '{%'
      `),
      pool.request().query(`
        SELECT COUNT(*) as upcomingReports 
        FROM _Datos.dbo.m_reportes_automaticos 
        WHERE rep_tproximoenvio > GETDATE() 
          AND rep_tproximoenvio <= DATEADD(day, 7, GETDATE())
          AND rep_cmail IS NOT NULL AND rep_cmail != '' AND rep_cmail NOT LIKE '{%'
      `),
      pool.request().query(`
        SELECT COUNT(*) as totalSchedules 
        FROM _Datos.dbo.m_reportes_automaticos 
        WHERE rep_cmail IS NOT NULL AND rep_cmail != '' AND rep_cmail NOT LIKE '{%'
      `),
      pool.request().query(`
        SELECT 
          COUNT(*) AS TotalSchedules,
          SUM(
            CASE 
              WHEN rep_cmail LIKE '{%' THEN 0
              ELSE LEN(rep_cmail) - LEN(REPLACE(rep_cmail, ',', '')) + 1 
            END
          ) AS TotalEmailRecipients,
          AVG(
            CASE 
              WHEN rep_cmail LIKE '{%' THEN 0
              ELSE LEN(rep_cmail) - LEN(REPLACE(rep_cmail, ',', '')) + 1 
            END
          ) AS AvgEmailsPerSchedule
        FROM _Datos.dbo.m_reportes_automaticos 
        WHERE rep_cmail IS NOT NULL AND rep_cmail != ''
      `)
    ]);

    const emailStats = emailStatsResult.recordset[0] || {};
    const dueReports = dueResult.recordset[0]?.dueReports || 0;

    sendJsonResponse(res, 200, true, 'Analytics summary generated', {
      timestamp: new Date().toISOString(),
      summary: {
        activeClients: clientsResult.recordset[0]?.activeClients || 0,
        dueReports,
        upcomingReports: upcomingResult.recordset[0]?.upcomingReports || 0,
        totalSchedules: totalResult.recordset[0]?.totalSchedules || 0
      },
      emailAnalytics: {
        totalRecipients: emailStats.TotalEmailRecipients || 0,
        averagePerSchedule: Math.round(emailStats.AvgEmailsPerSchedule || 0),
        totalSchedules: emailStats.TotalSchedules || 0,
        multiEmailSupport: true,
        emailSendingEnabled: global.EMAIL_SENDING_ENABLED || false
      },
      performance: {
        schedulerHealth: dueReports > 10 ? 'needs_attention' : 'healthy',
        databaseHealth: 'connected',
        emailService: 'Office365 SMTP with multi-recipient support',
        dataModel: 'managePatrolSchedules.js',
        duplicateProtection: 'active (2-minute cooldown)'
      }
    });
  } catch (error) {
    console.error('❌ Error generating analytics summary:', error);
    sendJsonResponse(res, 500, false, 'Failed to generate analytics summary', null, { error: error.message });
  }
});

router.get('/analytics/client/:clientId', auth, requireAny, async (req, res) => {
  try {
    const clientId = validateClientId(req.params.clientId);
    if (!clientId) {
      return sendJsonResponse(res, 400, false, 'Invalid clientId - must be a positive integer');
    }

    const days = Math.min(parseInt(req.query.days) || DEFAULT_DAYS_BACK, MAX_DAYS_BACK);

    const patrolData = await schedulerController.getClientPatrols(clientId, days);

    const pool = await database.poolPromise;
    const clientResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          cue_cnombre AS ClientName,
          cue_ncuenta AS AccountNumber,
          cue_cemail AS ClientEmail
        FROM _Datos.dbo.m_cuentas 
        WHERE cue_iid = @clientId
      `);

    const client = clientResult.recordset[0] || {};

    sendJsonResponse(res, 200, true, 'Client analytics retrieved', {
      client: {
        id: clientId,
        name: client.ClientName || `Client ${clientId}`,
        accountNumber: client.AccountNumber || '',
        email: client.ClientEmail || ''
      },
      timeframe: `Last ${days} days`,
      analytics: {
        overallPerformance: patrolData.metadata?.overallPerformance || 0,
        totalCompleted: patrolData.metadata?.totalCompleted || 0,
        totalExpected: patrolData.metadata?.totalExpectedPatrols || 0,
        completionRate: patrolData.metadata?.totalExpectedPatrols > 0
          ? Math.round((patrolData.metadata?.totalCompleted || 0) / patrolData.metadata.totalExpectedPatrols * 100)
          : 0,
        postsCount: patrolData.posts?.length || 0,
        eventsCount: patrolData.events?.length || 0,
        guardReportsCount: patrolData.guardReports?.length || 0,
        dataSource: patrolData.metadata?.dataSource || 'Unknown',
        processingTime: patrolData.metadata?.processingTime || 0
      }
    });
  } catch (error) {
    console.error(`❌ Error fetching analytics for client ${req.params.clientId}:`, error);
    sendJsonResponse(res, 500, false, 'Failed to fetch client analytics', null, { error: error.message });
  }
});

// =============================================
// HISTORICAL DATA ROUTES
// =============================================

/**
 * GET /api/scheduler/historical/:clientId
 * ✅ FIX 20: accepts an optional ?shiftType= query param (UI label or
 * raw enum) and forwards it to getHistoricalDateRange /
 * getClientHistoricalPatrols so historical windows respect the same
 * day/night/both hour rules as everything else. Defaults to 'both'
 * (24hr) when omitted, matching the historical endpoint's prior
 * behaviour.
 */
router.get('/historical/:clientId', auth, requireAny, async (req, res) => {
  try {
    const clientId = validateClientId(req.params.clientId);
    if (!clientId) {
      return sendJsonResponse(res, 400, false, 'Invalid clientId - must be a positive integer');
    }

    const { startDate, endDate, monthsBack, specificMonth, shiftType } = req.query;

    let resolvedShiftType = 'both';
    if (shiftType) {
      const resolved = resolveShiftTypeInput(shiftType);
      if (!resolved) {
        return sendJsonResponse(res, 400, false,
          `Invalid shiftType query param. Must be one of: ${VALID_SHIFT_TYPES_UI.join(', ')} (or: ${VALID_SHIFT_TYPES.join(', ')})`);
      }
      resolvedShiftType = resolved;
    }

    const dateRange = schedulerController.getHistoricalDateRange({
      startDate,
      endDate,
      monthsBack: monthsBack ? parseInt(monthsBack) : null,
      specificMonth,
      shiftType: resolvedShiftType,
    });

    const historicalData = await schedulerController.getClientHistoricalPatrols(
      clientId,
      dateRange.startDate,
      dateRange.endDate
    );

    sendJsonResponse(res, 200, historicalData.metadata?.success || false,
      historicalData.metadata?.success ? 'Historical data retrieved' : 'Failed to retrieve historical data',
      historicalData,
      {
        dateRange: {
          display: dateRange.rangeLabel,
          start: dateRange.startDate,
          end: dateRange.endDate,
          daysInRange: dateRange.daysInRange || dateRange.nightsInRange,
          nights: dateRange.nightsInRange,
          shiftType: resolvedShiftType,
          shiftLabel: SHIFT_TYPE_LABELS[resolvedShiftType],
        },
        metadata: {
          clientId,
          generatedAt: new Date().toISOString(),
          dataSource: historicalData.metadata?.dataSource || 'Unknown',
          processingTime: historicalData.metadata?.processingTime || 0,
          usingOptimizedModel: true
        }
      }
    );
  } catch (error) {
    console.error(`❌ Error fetching historical data for client ${req.params.clientId}:`, error);
    sendJsonResponse(res, 500, false, 'Failed to fetch historical data', null, { error: error.message });
  }
});

router.get('/historical/date-ranges', auth, requireAny, async (req, res) => {
  try {
    let resolvedShiftType = 'both';
    if (req.query.shiftType) {
      const resolved = resolveShiftTypeInput(req.query.shiftType);
      if (!resolved) {
        return sendJsonResponse(res, 400, false,
          `Invalid shiftType query param. Must be one of: ${VALID_SHIFT_TYPES_UI.join(', ')} (or: ${VALID_SHIFT_TYPES.join(', ')})`);
      }
      resolvedShiftType = resolved;
    }

    const ranges = {
      previousWeek: schedulerController.getPreviousWeekRange(resolvedShiftType),
      lastMonth: schedulerController.getHistoricalDateRange({ monthsBack: 1, shiftType: resolvedShiftType }),
      last3Months: schedulerController.getHistoricalDateRange({ monthsBack: 3, shiftType: resolvedShiftType }),
      last6Months: schedulerController.getHistoricalDateRange({ monthsBack: 6, shiftType: resolvedShiftType }),
      last12Months: schedulerController.getHistoricalDateRange({ monthsBack: 12, shiftType: resolvedShiftType }),
      custom: {
        description: 'Use startDate and endDate parameters (YYYY-MM-DD format), plus optional shiftType',
        example: '/api/scheduler/historical/28?startDate=2025-01-01&endDate=2025-01-31&shiftType=night'
      }
    };

    sendJsonResponse(res, 200, true, 'Available date ranges', { ranges }, {
      timezone: process.env.TIMEZONE || 'Africa/Nairobi',
      emailSendingEnabled: global.EMAIL_SENDING_ENABLED || false,
      usingOptimizedModel: true,
      shiftType: resolvedShiftType,
      shiftTypeSupport: { enabled: true, values: VALID_SHIFT_TYPES, windows: SHIFT_TYPE_LABELS },
    });
  } catch (error) {
    console.error('❌ Error fetching date ranges:', error);
    sendJsonResponse(res, 500, false, 'Failed to fetch date ranges', null, { error: error.message });
  }
});

// =============================================
// SCHEDULE CRUD ROUTES
// (delegates to schedulerController, which already enforces the
//  (clientId, shiftType) uniqueness rule on create — see createSchedule)
// =============================================

router.get("/", auth, requireAny, schedulerController.getAllSchedules);
router.post("/", auth, requireAdmin, schedulerController.createSchedule);
router.get("/:id", auth, requireAny, schedulerController.getScheduleById);
router.put("/:id", auth, requireAdmin, schedulerController.updateSchedule);
router.delete("/:id", auth, requireAdmin, schedulerController.deleteSchedule);

// =============================================
// BULK OPERATIONS
// =============================================

router.post('/bulk/update-emails', auth, requireAdmin, async (req, res) => {
  try {
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return sendJsonResponse(res, 400, false, 'updates array is required and must not be empty');
    }

    const pool = await database.poolPromise;
    const results = [];

    for (const update of updates) {
      const { scheduleId, emails } = update;

      if (!scheduleId || !emails) {
        results.push({ scheduleId, success: false, error: 'Missing scheduleId or emails' });
        continue;
      }

      const parsedEmails = schedulerController.parseEmails(emails);

      if (parsedEmails.length === 0) {
        results.push({ scheduleId, success: false, error: 'No valid emails provided' });
        continue;
      }

      try {
        const result = await pool.request()
          .input('id', sql.Int, scheduleId)
          .input('email', sql.VarChar(4000), emails)
          .query(`
            UPDATE _Datos.dbo.m_reportes_automaticos 
            SET rep_cmail = @email 
            WHERE rep_idKey = @id
          `);

        if (result.rowsAffected[0] === 0) {
          results.push({ scheduleId, success: false, error: 'Schedule not found' });
        } else {
          results.push({
            scheduleId,
            success: true,
            emailCount: parsedEmails.length,
            message: `Updated with ${parsedEmails.length} email(s)`
          });
        }
      } catch (error) {
        results.push({ scheduleId, success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;

    sendJsonResponse(res, 200, true, 'Bulk email update completed', {
      summary: {
        total: updates.length,
        success: successCount,
        failure: updates.length - successCount
      },
      results
    }, {
      emailStatus: { globalEnabled: global.EMAIL_SENDING_ENABLED || false }
    });
  } catch (error) {
    console.error('❌ Error in bulk email update:', error);
    sendJsonResponse(res, 500, false, 'Bulk update failed', null, { error: error.message });
  }
});

router.post('/bulk/reset-next-run', auth, requireAdmin, async (req, res) => {
  try {
    const { scheduleIds } = req.body;

    if (!Array.isArray(scheduleIds) || scheduleIds.length === 0) {
      return sendJsonResponse(res, 400, false, 'scheduleIds array is required and must not be empty');
    }

    const pool = await database.poolPromise;
    const results = [];

    for (const scheduleId of scheduleIds) {
      try {
        const scheduleResult = await pool.request()
          .input('id', sql.Int, scheduleId)
          .query(`
            SELECT rep_iidcuenta, rep_nfrecuencia 
            FROM _Datos.dbo.m_reportes_automaticos 
            WHERE rep_idKey = @id
          `);

        if (scheduleResult.recordset.length === 0) {
          results.push({ scheduleId, success: false, error: 'Schedule not found' });
          continue;
        }

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);

        await pool.request()
          .input('id', sql.Int, scheduleId)
          .input('nextRun', sql.DateTime, tomorrow)
          .query(`
            UPDATE _Datos.dbo.m_reportes_automaticos 
            SET rep_tproximoenvio = @nextRun 
            WHERE rep_idKey = @id
          `);

        results.push({
          scheduleId,
          success: true,
          newNextRun: tomorrow.toISOString(),
          message: 'Next run time reset to tomorrow 09:00'
        });
      } catch (error) {
        results.push({ scheduleId, success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;

    sendJsonResponse(res, 200, true, 'Bulk reset completed', {
      summary: {
        total: scheduleIds.length,
        success: successCount,
        failure: scheduleIds.length - successCount
      },
      results
    });
  } catch (error) {
    console.error('❌ Error in bulk reset:', error);
    sendJsonResponse(res, 500, false, 'Bulk reset failed', null, { error: error.message });
  }
});

// =============================================
// DEBUG ROUTES
// =============================================

router.get('/debug/in-progress', auth, requireAdmin, async (req, res) => {
  try {
    let performanceStats = { error: 'Performance stats not available' };

    try {
      const schedulerService = require('../service/scheduler.js');
      if (schedulerService.getPerformanceStats) {
        performanceStats = await schedulerService.getPerformanceStats();
      }
    } catch (e) {
      // Non-fatal
    }

    sendJsonResponse(res, 200, true, 'Debug information retrieved', {
      inProgressReports: Array.from(schedulerController.inProgressReports || []),
      performanceStats,
      emailSendingEnabled: global.EMAIL_SENDING_ENABLED || false
    });
  } catch (error) {
    console.error('❌ Error getting debug info:', error);
    sendJsonResponse(res, 500, false, 'Failed to get debug info', null, { error: error.message });
  }
});

router.post('/debug/clear-locks', auth, requireAdmin, async (req, res) => {
  try {
    const count = schedulerController.inProgressReports?.size || 0;
    schedulerController.inProgressReports?.clear();

    sendJsonResponse(res, 200, true, `Cleared ${count} duplicate protection locks`);
  } catch (error) {
    console.error('❌ Error clearing locks:', error);
    sendJsonResponse(res, 500, false, 'Failed to clear locks', null, { error: error.message });
  }
});

module.exports = router;
module.exports.default = module.exports;