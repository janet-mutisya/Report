const express        = require('express');
const { auth, requireAdmin } = require('../middleware/auth');
const bmSecurityAPI  = require('../service/bmSecurityAPI');
const { fetchPatrolReport, generateDateRangeForReportType } = require('../models/reportModel');

// ─── db + mssql helpers ───────────────────────────────────────────────────────
let db;
try { db = require('../config/database'); } catch (e) { console.error('[admin] db load failed:', e.message); }

async function sqlQuery(queryStr, paramsArray = []) {
  const pool    = await db.getPool();
  const request = pool.request();
  let i = 0;
  const named = queryStr.replace(/\?/g, () => { const n = `p${i}`; request.input(n, paramsArray[i++]); return `@${n}`; });
  return request.query(named);
}
async function queryRows(q, p = []) {
  try { return (await sqlQuery(q, p)).recordset || []; } catch (e) { console.error('[admin] queryRows:', e.message); return []; }
}

const router = express.Router();
router.use(auth, requireAdmin);

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const userRows   = await queryRows('SELECT COUNT(*) AS total FROM Users WHERE IsActive = 1');
    const clientRows = await queryRows('SELECT COUNT(*) AS total FROM Clients WHERE IsActive = 1');

    let apiStats = null, apiConnected = false, bmClientCount = 0;
    try {
      const cacheStats  = bmSecurityAPI.getCacheStats();
      const statsReport = bmSecurityAPI.getStatsReport();
      apiStats     = { ...statsReport, cache: cacheStats };
      apiConnected = true;

      const cached = cacheStats.rawCache?.keys?.includes('all_clients');
      if (cached) {
        const clients = await bmSecurityAPI.getClients();
        bmClientCount = clients.length;
      }
    } catch (apiErr) { console.error('Admin stats API error:', apiErr.message); }

    res.json({
      portal:     { activeStaff: userRows[0]?.total, activeClients: clientRows[0]?.total },
      bmSecurity: { connected: apiConnected, clientCount: bmClientCount, stats: apiStats },
      generatedAt: new Date()
    });
  } catch (e) { console.error('Admin stats error:', e); res.status(500).json({ message: 'Server error' }); }
});

// ─── GET /api/admin/clients-overview ─────────────────────────────────────────
router.get('/clients-overview', async (req, res) => {
  try {
    const portalClients = await queryRows(`
      SELECT ClientID, Account_Name, Account_Number, Email_Address AS Email,
             First_Name AS ContactName, Telephone_Number AS Telephone,
             IsActive, CreatedAt, BmClientId
      FROM Clients WHERE IsActive = 1 ORDER BY Account_Name
    `);

    let bmClients = [];
    try { bmClients = await bmSecurityAPI.getClients(); }
    catch (err) { console.warn('Could not fetch BM clients for overview:', err.message); }

    const bmMap   = new Map(bmClients.map(c => [String(c.id), c]));
    const overview = portalClients.map(c => {
      const bm = bmMap.get(String(c.BmClientId)) || null;
      return {
        id: c.ClientID, accountName: c.Account_Name, accountNumber: c.Account_Number,
        email: c.Email, contactName: c.ContactName, telephone: c.Telephone,
        isActive: c.IsActive, createdAt: c.CreatedAt, bmClientId: c.BmClientId,
        bmData: bm ? { name: bm.name, accountNumber: bm.accountNumber, active: bm.active, phone: bm.phone } : null
      };
    });

    res.json({ clients: overview, total: overview.length });
  } catch (e) { console.error('Clients overview error:', e); res.status(500).json({ message: 'Server error' }); }
});

// ─── GET /api/admin/client-report/:clientId ───────────────────────────────────
router.get('/client-report/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { reportType = 'weekly', startDate, endDate } = req.query;

    let resolvedStart = startDate, resolvedEnd = endDate;
    if (!resolvedStart || !resolvedEnd) {
      const range = generateDateRangeForReportType(reportType);
      resolvedStart = range.startDate; resolvedEnd = range.endDate;
    }

    const clients = await queryRows(
      'SELECT ClientID, Account_Name, BmClientId FROM Clients WHERE ClientID = ?', [clientId]
    );
    if (!clients.length) return res.status(404).json({ message: 'Client not found in portal' });

    const bmId  = clients[0].BmClientId || clientId;
    const report = await fetchPatrolReport(bmId, resolvedStart, resolvedEnd, true, reportType);

    res.json({
      success: report.metadata.success, client: clients[0].Account_Name,
      dateRange: { start: resolvedStart, end: resolvedEnd }, reportType, data: report
    });
  } catch (e) { console.error('Admin client report error:', e); res.status(500).json({ message: 'Server error', error: e.message }); }
});

// ─── GET /api/admin/all-reports ───────────────────────────────────────────────
router.get('/all-reports', async (req, res) => {
  try {
    const portalClients = await queryRows(
      `SELECT ClientID, Account_Name, BmClientId FROM Clients WHERE IsActive = 1 ORDER BY Account_Name`
    );

    const range = generateDateRangeForReportType('weekly');
    const results = [], errors = [];
    const BATCH = 3;

    for (let i = 0; i < portalClients.length; i += BATCH) {
      const batch   = portalClients.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(async c => {
          const bmId  = c.BmClientId || c.ClientID;
          const report = await fetchPatrolReport(bmId, range.startDate, range.endDate, true, 'weekly');
          return {
            clientId: c.ClientID, accountName: c.Account_Name,
            performance: report.metadata.overallPatrolPerformance,
            completed:   report.metadata.totalCompletedPatrols,
            expected:    report.metadata.totalExpectedPatrols,
            incidents:   report.metadata.totalIncidents,
            zones:       report.metadata.client?.activeZoneCount || 0,
            success:     report.metadata.success
          };
        })
      );

      settled.forEach((r, j) => {
        if (r.status === 'fulfilled') results.push(r.value);
        else errors.push({ clientId: batch[j].ClientID, error: r.reason?.message });
      });

      if (i + BATCH < portalClients.length) await new Promise(r => setTimeout(r, 500));
    }

    results.sort((a, b) => (b.performance || 0) - (a.performance || 0));
    const avgPerformance = results.length
      ? Math.round(results.reduce((s, r) => s + (r.performance || 0), 0) / results.length) : 0;

    res.json({
      reports: results, errors,
      summary: { total: portalClients.length, successful: results.length, failed: errors.length, avgPerformance, dateRange: range }
    });
  } catch (e) { console.error('All reports error:', e); res.status(500).json({ message: 'Server error', error: e.message }); }
});

// ─── POST /api/admin/clear-cache ──────────────────────────────────────────────
router.post('/clear-cache', async (req, res) => {
  try {
    const result = bmSecurityAPI.clearCache();
    res.json({ message: 'Cache cleared successfully', ...result });
  } catch (e) { console.error('Clear cache error:', e); res.status(500).json({ message: 'Server error' }); }
});

// ─── GET /api/admin/api-test ──────────────────────────────────────────────────
router.get('/api-test', async (req, res) => {
  try {
    const result = await bmSecurityAPI.testConnection();
    res.json(result);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;