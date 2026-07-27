// server/routes/dashboardRoutes.js
// Monitor Dashboard API — supplies all endpoints consumed by monitorDashboard.jsx
// All routes require admin or monitor role
'use strict';

const express = require('express');
const router  = express.Router();

let db, sql, authRouter;

try {
  const d = require('../config/database');
  db  = d;
  sql = d.sql ?? require('mssql');
} catch (e) { console.error('[dashboard] db:', e.message); }

try { authRouter = require('./auth'); } catch (e) { console.error('[dashboard] auth:', e.message); }

// Pull shared helpers from reportModel so shift logic is consistent across
// reports AND the live dashboard — one source of truth.
const {
  SHIFT_START_HOUR,     // 18
  SHIFT_END_HOUR,       // 6
  SHIFT_GRACE_MINUTES,  // configurable, default 10
  PATROL_ARRIVAL_CODE,  // 'V04'
  INCIDENT_CODE,        // 'V03'
  WEEK_START_DAY,
  WEEK_START_DAY_NAMES,
  isUnknownZone,
  normalizeZoneCode,
  resolveZoneName,
  fetchZoneData,
} = require('../models/reportModel');

// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Verify JWT and attach req.user.
 * Falls back to an inline check if the auth router doesn't export useAuth.
 */
function useAuth(req, res, next) {
  if (typeof authRouter?.useAuth === 'function') return authRouter.useAuth(req, res, next);
  try {
    const jwt   = require('jsonwebtoken');
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

/**
 * Allow only 'admin' and 'monitor' roles.
 * 'monitor' is the control-room role — read-only access to live data.
 */
function requireAdminOrMonitor(req, res, next) {
  if (typeof authRouter?.requireAdminOrMonitor === 'function') {
    return authRouter.requireAdminOrMonitor(req, res, next);
  }
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'monitor') {
    return res.status(403).json({ success: false, message: 'Admin or Monitor access required' });
  }
  next();
}

function requireDb(req, res, next) {
  if (!db) return res.status(503).json({ success: false, message: 'Database unavailable' });
  next();
}

async function getPool() { return db.getPool(); }

// ── Shift / date helpers ──────────────────────────────────────────────────────

/**
 * Current calendar day: 00:00 → 23:59:59.999 (Nairobi local wall clock).
 * Used for incident windows that follow the calendar day, not the shift window.
 */
function todayRange() {
  const now   = new Date();
  const start = new Date(now); start.setHours(0,  0,  0,   0);
  const end   = new Date(now); end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Current night shift window derived from SHIFT_START_HOUR / SHIFT_END_HOUR
 * exported by reportModel — the same constants used to build PDF reports.
 *
 *   Evening:   today  at SHIFT_START_HOUR:00 (18:00)
 *   Morning:   tomorrow at SHIFT_END_HOUR:00  (06:00)
 *
 * If the wall-clock hour is before SHIFT_END_HOUR we are in the early-morning
 * half of last night's shift, so we step both boundaries back by one day.
 *
 * A ±SHIFT_GRACE_MINUTES buffer is applied so guards who scan a few minutes
 * early or late are not missed — matching the grace window in reportModel.
 */
function currentShiftRange() {
  const now   = new Date();
  const start = new Date(now);
  start.setHours(SHIFT_START_HOUR, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setHours(SHIFT_END_HOUR, 0, 0, 0);

  // Post-midnight: we are in the morning portion of the previous evening's shift
  if (now.getHours() < SHIFT_END_HOUR) {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }

  // Apply grace window (matches reportModel RECOVERY FIX C)
  const graceMs = SHIFT_GRACE_MINUTES * 60 * 1000;
  return {
    start: new Date(start.getTime() - graceMs),
    end:   new Date(end.getTime()   + graceMs),
  };
}

/**
 * Return the dynamic partition table name for the given Date, e.g.
 * p_recepcion202506 for June 2025.  The dashboard only ever queries the
 * current month, but providing a helper makes the logic explicit.
 */
function partitionTable(date = new Date()) {
  return `p_recepcion${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * When a shift spans two calendar months (e.g. 31 May 18:00 → 01 Jun 06:00)
 * we need both partition tables.  Returns a deduplicated list.
 */
function shiftPartitionTables(shiftStart, shiftEnd) {
  const tables = new Set([partitionTable(shiftStart), partitionTable(shiftEnd)]);
  return Array.from(tables);
}

// ── Safe query wrapper ────────────────────────────────────────────────────────

/**
 * Execute a parameterised query and return the recordset.
 * Returns [] on error so callers don't need individual try/catch blocks.
 * Logs the error with the partial query text for easier debugging.
 */
async function safeQuery(pool, query, inputs = []) {
  try {
    const req = pool.request();
    for (const [name, type, value] of inputs) req.input(name, type, value);
    const result = await req.query(query);
    return result.recordset || [];
  } catch (err) {
    // Include first 120 chars of query to help identify the failing statement
    console.error(`[dashboard] query error (${query.slice(0, 120).replace(/\s+/g, ' ')}):`, err.message);
    return [];
  }
}

// ── UNION helper for multi-partition queries ──────────────────────────────────

/**
 * Build a UNION ALL across every partition table in `tables` for V04 / V03
 * events in the given time window.  The caller gets a flat recordset.
 */
async function queryAcrossPartitions(pool, tables, alarmCodes, startDate, endDate, extraInputs = []) {
  const codeList = alarmCodes.map(c => `'${c}'`).join(',');
  const unions   = tables.map(table => `
    SELECT
      r.rec_iid             AS id,
      r.rec_tfechahora      AS time,
      r.rec_calarma         AS alarmCode,
      r.rec_czona           AS zoneCode,
      r.rec_iidcuenta       AS siteId,
      r.rec_iusuario        AS guardId,
      r.rec_cObservaciones  AS description,
      r.rec_cContenido      AS content
    FROM [_Datos].[dbo].[${table}] r
    WHERE r.rec_tfechahora BETWEEN @start AND @end
      AND r.rec_calarma IN (${codeList})
  `).join('\nUNION ALL\n');

  const inputs = [
    ['start', sql.DateTime, startDate],
    ['end',   sql.DateTime, endDate],
    ...extraInputs,
  ];
  return safeQuery(pool, `${unions} ORDER BY time DESC`, inputs);
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/stats
// KPI numbers shown at the top of the monitor dashboard.
//
// Fields returned:
//   activeGuards      — distinct guards who sent a V04 this shift
//   openIncidents     — V03 events fired today (calendar day)
//   completedPatrols  — V04 events in the current shift window
//   missedPatrols     — max(0, totalExpected - completed)  [best-effort]
//   latePatrols       — placeholder (requires schedule comparison)
//   sitesMonitored    — active accounts in m_cuentas
//   totalPatrols      — from patrol_schedules if available, else completedPatrols
// ═══════════════════════════════════════════════════════════════════════════
router.get('/stats', useAuth, requireAdminOrMonitor, requireDb, async (req, res) => {
  try {
    const pool  = await getPool();
    const shift = currentShiftRange();
    const today = todayRange();
    const tables = shiftPartitionTables(shift.start, shift.end);

    // ── Active accounts (sites monitored) ───────────────────────────────────
    const sitesRows = await safeQuery(pool,
      `SELECT COUNT(*) AS cnt FROM [_Datos].[dbo].[m_cuentas] WHERE cue_cestado = 'A'`
    );
    const sitesMonitored = sitesRows[0]?.cnt ?? 0;

    // ── Guards on duty — distinct rec_iusuario with a V04 this shift ────────
    // Uses the same shift window + grace as reportModel (via currentShiftRange).
    const guardUnion = tables.map(t => `
      SELECT DISTINCT rec_iusuario
      FROM [_Datos].[dbo].[${t}]
      WHERE rec_tfechahora BETWEEN @start AND @end
        AND rec_calarma = '${PATROL_ARRIVAL_CODE}'
        AND rec_iusuario IS NOT NULL
    `).join('\nUNION\n');  // UNION (not ALL) to deduplicate across months

    const guardRows   = await safeQuery(pool,
      `SELECT COUNT(*) AS cnt FROM (${guardUnion}) AS g`,
      [['start', sql.DateTime, shift.start], ['end', sql.DateTime, shift.end]]
    );
    const activeGuards = guardRows[0]?.cnt ?? 0;

    // ── Completed patrols (V04) this shift ──────────────────────────────────
    const v04Union = tables.map(t => `
      SELECT rec_iid
      FROM [_Datos].[dbo].[${t}]
      WHERE rec_tfechahora BETWEEN @start AND @end
        AND rec_calarma = '${PATROL_ARRIVAL_CODE}'
    `).join('\nUNION ALL\n');

    const completedRows = await safeQuery(pool,
      `SELECT COUNT(*) AS cnt FROM (${v04Union}) AS p`,
      [['start', sql.DateTime, shift.start], ['end', sql.DateTime, shift.end]]
    );
    const completedPatrols = completedRows[0]?.cnt ?? 0;

    // ── Incidents today (V03, calendar day) ─────────────────────────────────
    // Incidents use the calendar day window (00:00–23:59), not the shift window.
    const incidentTable = partitionTable(new Date());
    const incidentRows  = await safeQuery(pool,
      `SELECT COUNT(*) AS cnt
       FROM [_Datos].[dbo].[${incidentTable}]
       WHERE rec_tfechahora BETWEEN @start AND @end
         AND rec_calarma = '${INCIDENT_CODE}'`,
      [['start', sql.DateTime, today.start], ['end', sql.DateTime, today.end]]
    );
    const openIncidents = incidentRows[0]?.cnt ?? 0;

    // ── Expected patrols from schedule table (best-effort) ──────────────────
    let totalPatrols = completedPatrols; // safe fallback
    try {
      const schedRows = await safeQuery(pool,
        `SELECT SUM(PatrolsPerDay) AS total FROM [dbo].[patrol_schedules] WHERE IsActive = 1`
      );
      if (schedRows[0]?.total) totalPatrols = schedRows[0].total;
    } catch { /* patrol_schedules may not exist */ }

    res.json({
      success: true,
      stats: {
        activeGuards,
        openIncidents,
        completedPatrols,
        missedPatrols:  Math.max(0, totalPatrols - completedPatrols),
        latePatrols:    0, // requires per-post schedule comparison — see /missed-patrols
        sitesMonitored,
        totalPatrols,
        shiftWindow: {
          start:          shift.start,
          end:            shift.end,
          graceMinutes:   SHIFT_GRACE_MINUTES,
        },
      },
    });
  } catch (err) {
    console.error('[dashboard/stats]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/events
// Live feed — most recent patrol (V04) and incident (V03) events.
//
// Query params:
//   limit  (default 40, max 100)
//   hours  (default 8) — look-back window in hours
// ═══════════════════════════════════════════════════════════════════════════
router.get('/events', useAuth, requireAdminOrMonitor, requireDb, async (req, res) => {
  try {
    const pool    = await getPool();
    const limit   = Math.min(100, parseInt(req.query.limit || '40', 10));
    const hours   = Math.min(48, parseInt(req.query.hours  || '8',  10));
    const now     = new Date();
    const since   = new Date(now.getTime() - hours * 3600 * 1000);
    const tables  = shiftPartitionTables(since, now);

    const unions = tables.map(table => `
      SELECT TOP (${limit})
        r.rec_iid            AS id,
        r.rec_tfechahora     AS time,
        r.rec_calarma        AS alarmCode,
        r.rec_czona          AS zoneCode,
        r.rec_cObservaciones AS description,
        r.rec_cContenido     AS content,
        c.cue_cnombre        AS site,
        z.zon_cdescripcion   AS zone,
        f.for_cdescripcion   AS eventType
      FROM [_Datos].[dbo].[${table}] r
      LEFT JOIN [_Datos].[dbo].[m_cuentas]  c ON c.cue_iid = r.rec_iidcuenta
      LEFT JOIN [_Datos].[dbo].[m_zonas]    z ON z.zon_iidcuenta = r.rec_iidcuenta
                                               AND z.zon_ccodigo  = r.rec_czona
      LEFT JOIN [_Datos].[dbo].[m_formatos] f ON f.for_calarma    = r.rec_calarma
      WHERE r.rec_tfechahora >= @since
        AND r.rec_calarma IN ('${PATROL_ARRIVAL_CODE}','${INCIDENT_CODE}')
    `).join('\nUNION ALL\n');

    const rows = await safeQuery(pool,
      `SELECT TOP (${limit}) * FROM (${unions}) AS combined ORDER BY time DESC`,
      [['since', sql.DateTime, since]]
    );

    const events = rows.map(r => {
      // Filter out truly unknown zone codes from live feed display
      const rawZone = String(r.zoneCode || '').trim();
      const displayZone = isUnknownZone(rawZone) ? '' : (r.zone || normalizeZoneCode(rawZone));

      return {
        id:          r.id,
        time:        r.time,
        alarmCode:   r.alarmCode,
        type:        r.alarmCode === INCIDENT_CODE       ? 'incident'  :
                     r.alarmCode === PATROL_ARRIVAL_CODE ? 'check-in'  : 'normal',
        text:        r.description || r.content || r.eventType || r.alarmCode,
        description: r.description || r.content || '',
        site:        r.site      || 'Unknown Site',
        zone:        displayZone,
        eventType:   r.eventType || r.alarmCode,
        message:     r.description || r.content || r.eventType || '',
      };
    });

    res.json({ success: true, events, meta: { limit, hours, since } });
  } catch (err) {
    console.error('[dashboard/events]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/attendance
// Guard attendance breakdown for the current shift.
//
// "On duty"  = distinct guards with at least one V04 in the shift window.
// "Off duty" = total registered guards minus on-duty.
// on leave / absent are placeholders pending an HR integration table.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/attendance', useAuth, requireAdminOrMonitor, requireDb, async (req, res) => {
  try {
    const pool   = await getPool();
    const shift  = currentShiftRange();
    const tables = shiftPartitionTables(shift.start, shift.end);

    // Distinct guards on duty this shift
    const dutyUnion = tables.map(t => `
      SELECT DISTINCT rec_iusuario
      FROM [_Datos].[dbo].[${t}]
      WHERE rec_tfechahora BETWEEN @start AND @end
        AND rec_calarma = '${PATROL_ARRIVAL_CODE}'
        AND rec_iusuario IS NOT NULL
    `).join('\nUNION\n');

    const onDutyRows = await safeQuery(pool,
      `SELECT COUNT(*) AS cnt FROM (${dutyUnion}) AS d`,
      [['start', sql.DateTime, shift.start], ['end', sql.DateTime, shift.end]]
    );
    const onDuty = onDutyRows[0]?.cnt ?? 0;

    // Total active guard-type users (usu_ntipo = 3)
    const totalRows = await safeQuery(pool,
      `SELECT COUNT(*) AS cnt FROM [dbo].[m_usuarios] WHERE usu_ntipo = 3 AND usu_cestado = 'A'`
    );
    const total = totalRows[0]?.cnt ?? onDuty;

    res.json({
      success: true,
      attendance: {
        onDuty,
        offDuty:  Math.max(0, total - onDuty),
        onLeave:  0,   // requires HR/leave table integration
        absent:   0,   // requires schedule vs actual comparison
        total,
        shiftWindow: { start: shift.start, end: shift.end },
      },
    });
  } catch (err) {
    console.error('[dashboard/attendance]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/missed-patrols
// Active sites that have sent zero V04 events in the current shift window.
//
// A site appearing here means no guard has checked in at all this shift.
// For per-zone missed patrols the full report endpoint should be used.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/missed-patrols', useAuth, requireAdminOrMonitor, requireDb, async (req, res) => {
  try {
    const pool   = await getPool();
    const shift  = currentShiftRange();
    const tables = shiftPartitionTables(shift.start, shift.end);

    // Build aggregated patrol count per site across all relevant partitions
    const countUnion = tables.map(t => `
      SELECT rec_iidcuenta, rec_iid
      FROM [_Datos].[dbo].[${t}]
      WHERE rec_tfechahora BETWEEN @start AND @end
        AND rec_calarma = '${PATROL_ARRIVAL_CODE}'
    `).join('\nUNION ALL\n');

    const rows = await safeQuery(pool,
      `SELECT
         c.cue_iid    AS siteId,
         c.cue_cnombre AS site,
         ISNULL(ev.patrolCount, 0) AS patrolCount
       FROM [_Datos].[dbo].[m_cuentas] c
       LEFT JOIN (
         SELECT rec_iidcuenta, COUNT(*) AS patrolCount
         FROM (${countUnion}) AS p
         GROUP BY rec_iidcuenta
       ) ev ON ev.rec_iidcuenta = c.cue_iid
       WHERE c.cue_cestado = 'A'
         AND ISNULL(ev.patrolCount, 0) = 0
       ORDER BY c.cue_cnombre`,
      [['start', sql.DateTime, shift.start], ['end', sql.DateTime, shift.end]]
    );

    const missed = rows.map(r => ({
      id:           r.siteId,
      site:         r.site,
      zone:         'All Zones',
      guard:        'Unassigned',
      scheduled:    shift.start.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
      status:       'missed',
      acknowledged: false,
    }));

    res.json({
      success: true,
      missed,
      meta: { shiftWindow: { start: shift.start, end: shift.end }, total: missed.length },
    });
  } catch (err) {
    console.error('[dashboard/missed-patrols]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/patrol-progress
// Per-site V04 completion as a percentage for the current shift.
//
// The denominator (total expected) defaults to 8 per site but respects an
// optional ?expected= query param so the frontend can pass the schedule
// value from the report API if available.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/patrol-progress', useAuth, requireAdminOrMonitor, requireDb, async (req, res) => {
  try {
    const pool     = await getPool();
    const shift    = currentShiftRange();
    const expected = Math.max(1, parseInt(req.query.expected || '8', 10));
    const tables   = shiftPartitionTables(shift.start, shift.end);

    // Aggregate completed V04s per site
    const countUnion = tables.map(t => `
      SELECT rec_iidcuenta, rec_iid
      FROM [_Datos].[dbo].[${t}]
      WHERE rec_tfechahora BETWEEN @start AND @end
        AND rec_calarma = '${PATROL_ARRIVAL_CODE}'
    `).join('\nUNION ALL\n');

    const rows = await safeQuery(pool,
      `SELECT
         c.cue_cnombre AS name,
         ISNULL(p.completed, 0) AS completed,
         ${expected} AS total
       FROM [_Datos].[dbo].[m_cuentas] c
       LEFT JOIN (
         SELECT rec_iidcuenta, COUNT(*) AS completed
         FROM (${countUnion}) AS v
         GROUP BY rec_iidcuenta
       ) p ON p.rec_iidcuenta = c.cue_iid
       WHERE c.cue_cestado = 'A'
       ORDER BY c.cue_cnombre`,
      [['start', sql.DateTime, shift.start], ['end', sql.DateTime, shift.end]]
    );

    const sites = rows.map(r => ({
      name:      r.name,
      completed: r.completed,
      total:     r.total,
      pct:       r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
    }));

    res.json({ success: true, sites });
  } catch (err) {
    console.error('[dashboard/patrol-progress]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/active-incidents
// Open V03 incidents from the last 24 hours.
//
// Zone names are resolved through reportModel.fetchZoneData when a
// clientId query param is supplied, giving consistent zone names with
// reports.  Falls back to the raw zone join if no clientId is provided.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/active-incidents', useAuth, requireAdminOrMonitor, requireDb, async (req, res) => {
  try {
    const pool      = await getPool();
    const now       = new Date();
    const since     = new Date(now.getTime() - 24 * 3600 * 1000);
    const tables    = shiftPartitionTables(since, now);
    const clientId  = req.query.clientId ? parseInt(req.query.clientId, 10) : null;

    // Optional: load zone map from reportModel for consistent naming
    let zoneMap = null;
    if (clientId) {
      try {
        const zoneData = await fetchZoneData(clientId);
        zoneMap = zoneData?.zoneMap ?? null;
      } catch (e) {
        console.warn(`[dashboard/active-incidents] zone fetch failed for client ${clientId}:`, e.message);
      }
    }

    const unions = tables.map(t => `
      SELECT TOP 50
        r.rec_iid            AS id,
        r.rec_tfechahora     AS time,
        r.rec_cObservaciones AS description,
        r.rec_czona          AS zoneCode,
        c.cue_cnombre        AS site,
        z.zon_cdescripcion   AS zoneDb
      FROM [_Datos].[dbo].[${t}] r
      LEFT JOIN [_Datos].[dbo].[m_cuentas] c ON c.cue_iid = r.rec_iidcuenta
      LEFT JOIN [_Datos].[dbo].[m_zonas]   z ON z.zon_iidcuenta = r.rec_iidcuenta
                                              AND z.zon_ccodigo  = r.rec_czona
      WHERE r.rec_tfechahora >= @since
        AND r.rec_calarma = '${INCIDENT_CODE}'
    `).join('\nUNION ALL\n');

    const rows = await safeQuery(pool,
      `SELECT TOP 50 * FROM (${unions}) AS combined ORDER BY time DESC`,
      [['since', sql.DateTime, since]]
    );

    const incidents = rows.map(r => {
      const rawCode = String(r.zoneCode || '').trim();
      // Resolve zone name: reportModel zoneMap → DB join result → empty string
      let zoneName = '';
      if (zoneMap && rawCode && !isUnknownZone(rawCode)) {
        zoneName = resolveZoneName(normalizeZoneCode(rawCode), zoneMap) || r.zoneDb || '';
      } else {
        zoneName = r.zoneDb || '';
      }
      return {
        id:          r.id,
        time:        r.time,
        site:        r.site || 'Unknown',
        zone:        zoneName,
        type:        r.description || 'Security Incident',
        description: r.description || '',
        status:      'active',
      };
    });

    res.json({ success: true, incidents, meta: { since, total: incidents.length } });
  } catch (err) {
    console.error('[dashboard/active-incidents]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/alerts
// High-priority alarm events in the last N hours (default 4).
//
// Query params:
//   hours  (default 4, max 24)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/alerts', useAuth, requireAdminOrMonitor, requireDb, async (req, res) => {
  try {
    const pool    = await getPool();
    const hours   = Math.min(24, parseInt(req.query.hours || '4', 10));
    const now     = new Date();
    const since   = new Date(now.getTime() - hours * 3600 * 1000);
    const tables  = shiftPartitionTables(since, now);

    // Alert alarm codes — V03 is critical, others are warnings
    const ALERT_CODES = ['V03', 'V01', 'V02', 'V05', 'V06'];
    const codeList    = ALERT_CODES.map(c => `'${c}'`).join(',');

    const unions = tables.map(t => `
      SELECT TOP 20
        r.rec_iid            AS id,
        r.rec_tfechahora     AS time,
        r.rec_calarma        AS code,
        r.rec_cObservaciones AS text,
        c.cue_cnombre        AS site
      FROM [_Datos].[dbo].[${t}] r
      LEFT JOIN [_Datos].[dbo].[m_cuentas] c ON c.cue_iid = r.rec_iidcuenta
      WHERE r.rec_tfechahora >= @since
        AND r.rec_calarma IN (${codeList})
    `).join('\nUNION ALL\n');

    const rows = await safeQuery(pool,
      `SELECT TOP 20 * FROM (${unions}) AS combined ORDER BY time DESC`,
      [['since', sql.DateTime, since]]
    );

    const alerts = rows.map(r => ({
      id:       r.id,
      time:     r.time,
      message:  r.text || (r.site ? `Alert at ${r.site}` : `Alert (${r.code})`),
      severity: r.code === INCIDENT_CODE ? 'critical' : 'warning',
      site:     r.site || '',
      code:     r.code,
    }));

    res.json({ success: true, alerts, meta: { hours, since } });
  } catch (err) {
    console.error('[dashboard/alerts]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/guard-performance
// Top guards ranked by V04 patrol count in the current shift.
//
// Query params:
//   expected  (default 8) — expected patrols per guard per shift
//   limit     (default 20, max 50)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/guard-performance', useAuth, requireAdminOrMonitor, requireDb, async (req, res) => {
  try {
    const pool     = await getPool();
    const shift    = currentShiftRange();
    const expected = Math.max(1, parseInt(req.query.expected || '8', 10));
    const limit    = Math.min(50, parseInt(req.query.limit   || '20', 10));
    const tables   = shiftPartitionTables(shift.start, shift.end);

    // Aggregate per guard across partitions, then rank
    const countUnion = tables.map(t => `
      SELECT rec_iusuario, rec_iid
      FROM [_Datos].[dbo].[${t}]
      WHERE rec_tfechahora BETWEEN @start AND @end
        AND rec_calarma = '${PATROL_ARRIVAL_CODE}'
        AND rec_iusuario IS NOT NULL
    `).join('\nUNION ALL\n');

    const rows = await safeQuery(pool,
      `SELECT TOP (${limit})
         p.rec_iusuario      AS guardId,
         ISNULL(u.usu_cnombre, CAST(p.rec_iusuario AS VARCHAR)) AS name,
         COUNT(p.rec_iid)    AS patrolCount
       FROM (${countUnion}) AS p
       LEFT JOIN [dbo].[m_usuarios] u ON u.usu_iid = p.rec_iusuario
       GROUP BY p.rec_iusuario, u.usu_cnombre
       ORDER BY patrolCount DESC`,
      [['start', sql.DateTime, shift.start], ['end', sql.DateTime, shift.end]]
    );

    const guards = rows.map(r => ({
      id:      r.guardId,
      name:    r.name || `Guard #${r.guardId}`,
      patrols: r.patrolCount,
      score:   Math.min(100, Math.round((r.patrolCount / expected) * 100)),
    }));

    res.json({ success: true, guards, meta: { expectedPerShift: expected, shiftWindow: { start: shift.start, end: shift.end } } });
  } catch (err) {
    console.error('[dashboard/guard-performance]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/shift-summary
// Full summary of the current shift: stats + per-site patrol counts + top guards.
// Single round-trip for dashboards that want everything at once.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/shift-summary', useAuth, requireAdminOrMonitor, requireDb, async (req, res) => {
  try {
    const pool   = await getPool();
    const shift  = currentShiftRange();
    const tables = shiftPartitionTables(shift.start, shift.end);

    // ── All V04 events this shift ────────────────────────────────────────────
    const v04Union = tables.map(t => `
      SELECT
        r.rec_iid        AS id,
        r.rec_iidcuenta  AS siteId,
        r.rec_iusuario   AS guardId,
        r.rec_czona      AS zoneCode,
        r.rec_tfechahora AS time
      FROM [_Datos].[dbo].[${t}] r
      WHERE r.rec_tfechahora BETWEEN @start AND @end
        AND r.rec_calarma = '${PATROL_ARRIVAL_CODE}'
    `).join('\nUNION ALL\n');

    const patrolRows = await safeQuery(pool,
      `${v04Union} ORDER BY time DESC`,
      [['start', sql.DateTime, shift.start], ['end', sql.DateTime, shift.end]]
    );

    // Per-site counts
    const bySite = patrolRows.reduce((acc, r) => {
      acc[r.siteId] = (acc[r.siteId] || 0) + 1;
      return acc;
    }, {});

    // Per-guard counts
    const byGuard = patrolRows.reduce((acc, r) => {
      if (!r.guardId) return acc;
      acc[r.guardId] = (acc[r.guardId] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      summary: {
        completedPatrols:  patrolRows.length,
        activeGuards:      Object.keys(byGuard).length,
        patrolsBySite:     bySite,
        patrolsByGuard:    byGuard,
        shiftWindow:       { start: shift.start, end: shift.end, graceMinutes: SHIFT_GRACE_MINUTES },
        weekConfig: {
          weekStartDay:     WEEK_START_DAY,
          weekStartDayName: WEEK_START_DAY_NAMES[WEEK_START_DAY],
        },
        generatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error('[dashboard/shift-summary]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/dashboard/missed/:id/acknowledge
// Mark a missed patrol as acknowledged (optimistic UI state update).
//
// A full implementation would INSERT into an acknowledgements table.
// Returning success here keeps the dashboard UI working while that table
// is built out.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/missed/:id/acknowledge', useAuth, requireAdminOrMonitor, (req, res) => {
  // TODO: INSERT INTO patrol_acknowledgements (siteId, acknowledgedBy, acknowledgedAt)
  // VALUES (@id, @userId, GETDATE())
  const { id } = req.params;
  res.json({
    success: true,
    message: `Patrol ${id} acknowledged`,
    acknowledgedBy: req.user?.sub || req.user?.id || 'unknown',
    acknowledgedAt: new Date(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/dashboard/incidents/:id/close
// Close an active incident.
//
// A full implementation would UPDATE the incident record or INSERT into a
// resolution table.  The optimistic response keeps the UI working now.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/incidents/:id/close', useAuth, requireAdminOrMonitor, (req, res) => {
  // TODO: UPDATE p_recepcionYYYYMM SET rec_cEstado = 'CLOSED', rec_tCierre = GETDATE()
  //       WHERE rec_iid = @id
  const { id } = req.params;
  res.json({
    success: true,
    message: `Incident ${id} closed`,
    closedBy: req.user?.sub || req.user?.id || 'unknown',
    closedAt: new Date(),
  });
});

module.exports = router;