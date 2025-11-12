// server/routes/managePatrolScheduleRoutes.js
import express from 'express';
import {
  getClientPatrols,
  getClientSchedule,
  listAllSchedules,
  getClientAnalytics,
  getAllClientsWithPerformance,
  getClientEmailPreferences,
  updateClientEmailPreferences,
  getDueClients,
  updateNextRun,
  // NEW IMPORTS
  upsertPatrolSchedule,
  deletePatrolSchedule,
  getPatrolScheduleConfig
} from '../scripts/managePatrolSchedules.js';

const router = express.Router();

// ==========================================
// IMPORTANT: Static routes MUST come before dynamic routes
// Order matters in Express routing!
// ==========================================

/**
 * GET /api/patrol-schedules/health
 * Health check for schedules
 */
router.get('/health', async (req, res) => {
  try {
    // Test database connection by fetching one client
    const schedules = await listAllSchedules();
    
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
 * GET /api/patrol-schedules/all
 * List all clients with their schedules
 * MUST BE BEFORE /:clientId route
 */
router.get('/all', async (req, res) => {
  try {
    console.log('📋 Fetching all client schedules');
    
    const schedules = await listAllSchedules();
    
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
    res.status(500).json({
      success: false,
      message: 'Failed to fetch schedules',
      error: error.message
    });
  }
});

/**
 * GET /api/patrol-schedules/performance
 * Get all clients with performance metrics
 */
router.get('/performance', async (req, res) => {
  try {
    const daysRange = parseInt(req.query.days) || 7;
    
    console.log(`📊 Fetching performance metrics for all clients (${daysRange} days)`);
    
    const clientsWithPerformance = await getAllClientsWithPerformance(daysRange);
    
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
    res.status(500).json({
      success: false,
      message: 'Failed to fetch performance metrics',
      error: error.message
    });
  }
});

/**
 * GET /api/patrol-schedules/due
 * Get clients due for reporting
 */
router.get('/due', async (req, res) => {
  try {
    console.log('📅 Fetching clients due for reporting');
    
    const dueClients = await getDueClients();
    
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
    res.status(500).json({
      success: false,
      message: 'Failed to fetch due clients',
      error: error.message
    });
  }
});

// ==========================================
// Dynamic routes with :clientId parameter
// MUST come after static routes
// ==========================================

/**
 * POST /api/patrol-schedules/:clientId
 * Create or update patrol schedule for a client
 */
router.post('/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const scheduleData = req.body;
    
    console.log(`📝 Creating/updating patrol schedule for client ${clientId}`, scheduleData);
    
    // Validate required fields
    if (!scheduleData.patrolsPerDay) {
      return res.status(400).json({
        success: false,
        message: 'patrolsPerDay is required'
      });
    }
    
    if (!scheduleData.patrolDays) {
      return res.status(400).json({
        success: false,
        message: 'patrolDays is required'
      });
    }
    
    const result = await upsertPatrolSchedule(parseInt(clientId), scheduleData);
    
    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error creating/updating patrol schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save patrol schedule',
      error: error.message
    });
  }
});

/**
 * GET /api/patrol-schedules/:clientId
 * Get patrol schedule configuration for a specific client
 */
router.get('/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    console.log(`📋 Fetching patrol schedule config for client ${clientId}`);
    
    const result = await getPatrolScheduleConfig(parseInt(clientId));
    
    if (result.success) {
      res.status(200).json({
        success: true,
        data: result.data
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error fetching patrol schedule config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch patrol schedule',
      error: error.message
    });
  }
});

/**
 * DELETE /api/patrol-schedules/:clientId
 * Delete patrol schedule for a client
 */
router.delete('/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    console.log(`🗑️ Deleting patrol schedule for client ${clientId}`);
    
    const result = await deletePatrolSchedule(parseInt(clientId));
    
    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error deleting patrol schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete patrol schedule',
      error: error.message
    });
  }
});

// ==========================================
// Nested routes with client prefix
// ==========================================

/**
 * GET /api/patrol-schedules/client/:clientId/patrols
 * Get patrol data for a specific client
 */
router.get('/client/:clientId/patrols', async (req, res) => {
  try {
    const { clientId } = req.params;
    const daysRange = parseInt(req.query.days) || 30;
    
    console.log(`📊 Fetching patrols for client ${clientId}, ${daysRange} days`);
    
    const patrolData = await getClientPatrols(parseInt(clientId), daysRange);
    
    res.status(200).json({
      success: true,
      data: patrolData
    });
  } catch (error) {
    console.error('❌ Error fetching patrols:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch patrol data',
      error: error.message
    });
  }
});

/**
 * GET /api/patrol-schedules/client/:clientId/schedule
 * Get schedule for a specific client
 */
router.get('/client/:clientId/schedule', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    console.log(`📅 Fetching schedule for client ${clientId}`);
    
    const schedule = await getClientSchedule(parseInt(clientId));
    
    res.status(200).json({
      success: true,
      data: schedule
    });
  } catch (error) {
    console.error('❌ Error fetching schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch schedule',
      error: error.message
    });
  }
});

/**
 * GET /api/patrol-schedules/client/:clientId/analytics
 * Get detailed analytics for a client
 */
router.get('/client/:clientId/analytics', async (req, res) => {
  try {
    const { clientId } = req.params;
    const daysRange = parseInt(req.query.days) || 30;
    
    console.log(`📈 Fetching analytics for client ${clientId}, ${daysRange} days`);
    
    const analytics = await getClientAnalytics(parseInt(clientId), daysRange);
    
    if (!analytics) {
      return res.status(404).json({
        success: false,
        message: 'Client not found or no data available'
      });
    }
    
    res.status(200).json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('❌ Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: error.message
    });
  }
});

/**
 * GET /api/patrol-schedules/client/:clientId/email-preferences
 * Get email preferences for a client
 */
router.get('/client/:clientId/email-preferences', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    console.log(`📧 Fetching email preferences for client ${clientId}`);
    
    const preferences = await getClientEmailPreferences(parseInt(clientId));
    
    res.status(200).json({
      success: true,
      data: preferences || {
        ReportEmail: null,
        Frequency: null,
        IntervalDays: null,
        NextRun: null
      }
    });
  } catch (error) {
    console.error('❌ Error fetching email preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch email preferences',
      error: error.message
    });
  }
});

/**
 * PUT /api/patrol-schedules/client/:clientId/email-preferences
 * Update email preferences for a client
 */
router.put('/client/:clientId/email-preferences', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { email, frequency, intervalDays, nextRun } = req.body;
    
    console.log(`📧 Updating email preferences for client ${clientId}`, {
      email,
      frequency,
      intervalDays,
      nextRun
    });
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }
    
    const result = await updateClientEmailPreferences(parseInt(clientId), {
      email,
      frequency: frequency || 1,
      intervalDays: intervalDays || 1,
      nextRun: nextRun || new Date()
    });
    
    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'Email preferences updated successfully',
        data: result
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to update email preferences',
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error updating email preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update email preferences',
      error: error.message
    });
  }
});

/**
 * POST /api/patrol-schedules/client/:clientId/update-next-run
 * Update next run for a client
 */
router.post('/client/:clientId/update-next-run', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { frequency, intervalDays, currentNextRun } = req.body;
    
    console.log(`📅 Updating next run for client ${clientId}`, {
      frequency,
      intervalDays,
      currentNextRun
    });
    
    if (!frequency || !currentNextRun) {
      return res.status(400).json({
        success: false,
        message: 'Frequency and currentNextRun are required'
      });
    }
    
    const result = await updateNextRun(
      parseInt(clientId),
      frequency,
      intervalDays || 1,
      currentNextRun
    );
    
    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'Next run updated successfully',
        data: result
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to update next run',
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error updating next run:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update next run',
      error: error.message
    });
  }
});

export default router;