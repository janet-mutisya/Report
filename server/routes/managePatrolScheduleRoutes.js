// routes/managePatrolScheduleRoutes.js
//
// SHIFT TYPE POLICY
// ─────────────────────────────────────────────────────────────────────────────
// shiftType is REQUIRED on POST.  There is no silent default.
// Valid values: 'day' | 'night' | 'both'
// Requests that omit shiftType or pass an invalid value are rejected 400.
// ─────────────────────────────────────────────────────────────────────────────

const express        = require('express');
const patrolSchedules = require('../scripts/managePatrolSchedules.js');
const { auth, requireAdmin, requireAny } = require('../middleware/auth.js');

const router = express.Router();

// Use the single source of truth exported from the script
const { VALID_SHIFT_TYPES } = patrolSchedules;

// ==========================================
// IMPORTANT: Static routes MUST come before dynamic routes
// ==========================================

/**
 * @route   GET /api/patrol-schedules/health
 * @desc    Health check - public
 */
router.get('/health', async (req, res) => {
  try {
    const schedules = await patrolSchedules.listAllSchedules();
    res.status(200).json({
      success: true,
      message: 'Patrol schedules service is healthy',
      data: {
        totalClients: schedules.length,
        database: 'Connected',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Patrol schedules service is unhealthy',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/patrol-schedules
 * @desc    Get all client schedules - admin only
 */
router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    console.log('📋 Fetching all client schedules (root)');
    patrolSchedules.clearScheduleCache();
    const schedules = await patrolSchedules.listAllSchedules();
    res.status(200).json({
      success: true,
      data: {
        clients: schedules,
        total: schedules.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Error fetching all schedules:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch schedules', error: error.message });
  }
});

/**
 * @route   GET /api/patrol-schedules/all
 * @desc    Get all client schedules (backwards compat) - admin only
 */
router.get('/all', auth, requireAdmin, async (req, res) => {
  try {
    console.log('📋 Fetching all client schedules (/all)');
    patrolSchedules.clearScheduleCache();
    const schedules = await patrolSchedules.listAllSchedules();
    res.status(200).json({
      success: true,
      data: {
        clients: schedules,
        total: schedules.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Error fetching all schedules:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch schedules', error: error.message });
  }
});

/**
 * @route   GET /api/patrol-schedules/performance
 * @desc    Get performance metrics for ALL clients - admin only
 */
router.get('/performance', auth, requireAdmin, async (req, res) => {
  try {
    const daysRange = parseInt(req.query.days) || 7;
    console.log(`📊 Fetching performance metrics for all clients (${daysRange} days)`);
    patrolSchedules.clearScheduleCache();
    const clientsWithPerformance = await patrolSchedules.getAllClientsWithPerformance(daysRange);
    res.status(200).json({
      success: true,
      data: {
        clients: clientsWithPerformance,
        total: clientsWithPerformance.length,
        period: `${daysRange} days`,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Error fetching performance metrics:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch performance metrics', error: error.message });
  }
});

/**
 * @route   GET /api/patrol-schedules/due
 * @desc    Get clients due for reporting - admin only
 */
router.get('/due', auth, requireAdmin, async (req, res) => {
  try {
    console.log('📅 Fetching clients due for reporting');
    const dueClients = await patrolSchedules.getDueClients();
    res.status(200).json({
      success: true,
      data: {
        clients: dueClients,
        total: dueClients.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Error fetching due clients:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch due clients', error: error.message });
  }
});

// ==========================================
// Nested /client/:clientId routes
// MUST come before /:clientId to avoid param collision
// ==========================================

/**
 * @route   GET /api/patrol-schedules/client/:clientId/patrols
 * @desc    Get patrol data for a client - admin + client (own data only)
 */
router.get('/client/:clientId/patrols', auth, requireAny, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId))
      return res.status(400).json({ success: false, message: 'Invalid clientId — must be a number' });

    if (req.user.role === 'client' && req.user.clientId !== clientId)
      return res.status(403).json({ success: false, message: 'Access denied: you can only view your own patrol data' });

    const daysRange = parseInt(req.query.days) || 30;
    console.log(`📊 Fetching patrols for client ${clientId}, ${daysRange} days`);
    const patrolData = await patrolSchedules.getClientPatrols(clientId, daysRange);
    res.status(200).json({ success: true, data: patrolData });
  } catch (error) {
    console.error('❌ Error fetching patrols:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch patrol data', error: error.message });
  }
});

/**
 * @route   GET /api/patrol-schedules/client/:clientId/schedule
 * @desc    Get schedule for a client - admin + client (own data only)
 */
router.get('/client/:clientId/schedule', auth, requireAny, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId))
      return res.status(400).json({ success: false, message: 'Invalid clientId — must be a number' });

    if (req.user.role === 'client' && req.user.clientId !== clientId)
      return res.status(403).json({ success: false, message: 'Access denied: you can only view your own schedule' });

    console.log(`📅 Fetching schedule for client ${clientId}`);
    patrolSchedules.clearScheduleCache(clientId);
    const schedule = await patrolSchedules.getClientSchedule(clientId, true);
    res.status(200).json({ success: true, data: schedule });
  } catch (error) {
    console.error('❌ Error fetching schedule:', error);
    res.status(error.message.includes('FATAL') ? 404 : 500).json({
      success: false, message: 'Failed to fetch schedule', error: error.message
    });
  }
});

/**
 * @route   GET /api/patrol-schedules/client/:clientId/analytics
 * @desc    Get analytics for a client - admin + client (own data only)
 */
router.get('/client/:clientId/analytics', auth, requireAny, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId))
      return res.status(400).json({ success: false, message: 'Invalid clientId — must be a number' });

    if (req.user.role === 'client' && req.user.clientId !== clientId)
      return res.status(403).json({ success: false, message: 'Access denied: you can only view your own analytics' });

    const daysRange = parseInt(req.query.days) || 30;
    console.log(`📈 Fetching analytics for client ${clientId}, ${daysRange} days`);
    const analytics = await patrolSchedules.getClientAnalytics(clientId, daysRange);
    res.status(200).json({ success: true, data: analytics });
  } catch (error) {
    console.error('❌ Error fetching analytics:', error);
    res.status(error.message.includes('FATAL') ? 404 : 500).json({
      success: false, message: 'Failed to fetch analytics', error: error.message
    });
  }
});

/**
 * @route   GET /api/patrol-schedules/client/:clientId/email-preferences
 * @desc    Get email preferences for a client - admin + client (own data only)
 */
router.get('/client/:clientId/email-preferences', auth, requireAny, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId))
      return res.status(400).json({ success: false, message: 'Invalid clientId — must be a number' });

    if (req.user.role === 'client' && req.user.clientId !== clientId)
      return res.status(403).json({ success: false, message: 'Access denied: you can only view your own email preferences' });

    console.log(`📧 Fetching email preferences for client ${clientId}`);
    const preferences = await patrolSchedules.getClientEmailPreferences(clientId);
    res.status(200).json({
      success: true,
      data: preferences || { ReportEmail: null, Frequency: null, IntervalDays: null, NextRun: null }
    });
  } catch (error) {
    console.error('❌ Error fetching email preferences:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch email preferences', error: error.message });
  }
});

/**
 * @route   PUT /api/patrol-schedules/client/:clientId/email-preferences
 * @desc    Update email preferences - admin only
 */
router.put('/client/:clientId/email-preferences', auth, requireAdmin, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId))
      return res.status(400).json({ success: false, message: 'Invalid clientId — must be a number' });

    const { email, frequency, intervalDays, nextRun } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: 'Email is required' });

    console.log(`📧 Updating email preferences for client ${clientId}`, { email, frequency, intervalDays, nextRun });

    const result = await patrolSchedules.updateClientEmailPreferences(clientId, {
      email,
      frequency:    frequency    || 1,
      intervalDays: intervalDays || 1,
      nextRun:      nextRun      || new Date()
    });

    if (result.success) {
      res.status(200).json({ success: true, message: 'Email preferences updated successfully', data: result });
    } else {
      res.status(400).json({ success: false, message: 'Failed to update email preferences', error: result.error });
    }
  } catch (error) {
    console.error('❌ Error updating email preferences:', error);
    res.status(500).json({ success: false, message: 'Failed to update email preferences', error: error.message });
  }
});

/**
 * @route   POST /api/patrol-schedules/client/:clientId/update-next-run
 * @desc    Update next report run time - admin only
 */
router.post('/client/:clientId/update-next-run', auth, requireAdmin, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId))
      return res.status(400).json({ success: false, message: 'Invalid clientId — must be a number' });

    const { frequency, intervalDays, currentNextRun } = req.body;
    if (!frequency || !currentNextRun)
      return res.status(400).json({ success: false, message: 'frequency and currentNextRun are required' });

    console.log(`📅 Updating next run for client ${clientId}`, { frequency, intervalDays, currentNextRun });

    const result = await patrolSchedules.updateNextRun(clientId, frequency, intervalDays || 1, currentNextRun);

    if (result.success) {
      res.status(200).json({ success: true, message: 'Next run updated successfully', data: result });
    } else {
      res.status(400).json({ success: false, message: 'Failed to update next run', error: result.error });
    }
  } catch (error) {
    console.error('❌ Error updating next run:', error);
    res.status(500).json({ success: false, message: 'Failed to update next run', error: error.message });
  }
});

// ==========================================
// Dynamic /:clientId routes — AFTER all static and /client/* routes
// ==========================================

/**
 * @route   POST /api/patrol-schedules/:clientId
 * @desc    Create or update patrol schedule - admin only
 *
 * Required body fields:
 *   patrolsPerDay  {number}  — patrols expected per weekday
 *   patrolDays     {string}  — comma-separated e.g. "Mon,Tue,Wed,Thu,Fri"
 *   shiftType      {string}  — REQUIRED: 'day' | 'night' | 'both'  (NO default)
 *
 * Optional body fields:
 *   weekendPatrols     {number}  — defaults to patrolsPerDay if omitted
 *   scheduleType       {string}  — 'daily' (default)
 *   customIntervalDays {number}  — for custom schedules
 */
router.post('/:clientId', auth, requireAdmin, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId)) {
      return res.status(400).json({ success: false, message: 'Invalid clientId — must be a number' });
    }

    const scheduleData = req.body;
    console.log(`📝 Creating/updating patrol schedule for client ${clientId}`, scheduleData);

    if (!scheduleData.patrolsPerDay) {
      return res.status(400).json({ success: false, message: 'patrolsPerDay is required' });
    }
    if (!scheduleData.patrolDays) {
      return res.status(400).json({ success: false, message: 'patrolDays is required' });
    }

    // ✅ shiftType is REQUIRED — no silent default, reject missing or invalid value
    const shiftType = scheduleData.shiftType;
    if (!shiftType) {
      return res.status(400).json({
        success: false,
        message: `shiftType is required. Must be one of: ${VALID_SHIFT_TYPES.join(', ')}`
      });
    }
    if (!VALID_SHIFT_TYPES.includes(shiftType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid shiftType "${shiftType}". Must be one of: ${VALID_SHIFT_TYPES.join(', ')}`
      });
    }

    const result = await patrolSchedules.upsertPatrolSchedule(clientId, scheduleData);

    console.log(`📋 upsertPatrolSchedule result for client ${clientId}:`, {
      success: result.success,
      message: result.message,
      error:   result.error
    });

    if (result.success) {
      return res.status(200).json({ success: true, message: result.message, data: result.data });
    } else {
      return res.status(400).json({ success: false, message: result.error || 'Failed to save patrol schedule' });
    }
  } catch (error) {
    console.error(`❌ Unexpected error saving patrol schedule for client ${req.params.clientId}:`, error);
    return res.status(500).json({ success: false, message: 'Failed to save patrol schedule', error: error.message });
  }
});

/**
 * @route   GET /api/patrol-schedules/:clientId
 * @desc    Get patrol schedule config for a client - admin + client (own data only)
 */
router.get('/:clientId', auth, requireAny, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId)) {
      return res.status(400).json({ success: false, message: 'Invalid clientId — must be a number' });
    }

    if (req.user.role === 'client' && req.user.clientId !== clientId) {
      return res.status(403).json({ success: false, message: 'Access denied: you can only view your own patrol schedule' });
    }

    console.log(`📋 Fetching patrol schedule config for client ${clientId}`);
    patrolSchedules.clearScheduleCache(clientId);
    const result = await patrolSchedules.getPatrolScheduleConfig(clientId);

    if (result.success) {
      res.status(200).json({ success: true, data: result.data });
    } else {
      res.status(404).json({ success: false, message: result.error });
    }
  } catch (error) {
    console.error('❌ Error fetching patrol schedule config:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch patrol schedule', error: error.message });
  }
});

/**
 * @route   DELETE /api/patrol-schedules/:clientId
 * @desc    Delete patrol schedule for a client - admin only
 */
router.delete('/:clientId', auth, requireAdmin, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId)) {
      return res.status(400).json({ success: false, message: 'Invalid clientId — must be a number' });
    }

    console.log(`🗑️ Deleting patrol schedule for client ${clientId}`);
    const result = await patrolSchedules.deletePatrolSchedule(clientId);

    if (result.success) {
      patrolSchedules.clearScheduleCache(clientId);
      res.status(200).json({ success: true, message: result.message });
    } else {
      res.status(404).json({ success: false, message: result.error });
    }
  } catch (error) {
    console.error('❌ Error deleting patrol schedule:', error);
    res.status(500).json({ success: false, message: 'Failed to delete patrol schedule', error: error.message });
  }
});

module.exports = router;