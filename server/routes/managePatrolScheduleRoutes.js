import express from 'express';
import {
  ensurePatrolScheduleTable,
  listAllSchedules,
  getClientSchedule,
  updateClientSchedule,
  bulkUpdateSchedules
} from '../scripts/managePatrolSchedules.js';
import { poolPromise } from "../config/database.js";
const router = express.Router();

// ✅ Get all patrol schedules
router.get('/patrol-schedules', async (req, res) => {
  try {
    await ensurePatrolScheduleTable();
    const schedules = await listAllSchedules();
    
    res.json({
      success: true,
      schedules: schedules,
      count: schedules.length
    });
  } catch (error) {
    console.error('Error fetching patrol schedules:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch patrol schedules',
      error: error.message
    });
  }
});

// ✅ Get patrol schedule for a specific client
router.get('/patrol-schedules/client/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    if (!clientId || isNaN(parseInt(clientId))) {
      return res.status(400).json({
        success: false,
        message: 'Valid client ID is required'
      });
    }

    const schedule = await getClientSchedule(parseInt(clientId));
    
    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'No schedule found for this client'
      });
    }

    res.json({
      success: true,
      schedule: schedule
    });
  } catch (error) {
    console.error(`Error fetching schedule for client ${req.params.clientId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch client schedule',
      error: error.message
    });
  }
});

// ✅ Update patrol schedule for a specific client
router.put('/patrol-schedules/client/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const scheduleConfig = req.body;

    if (!clientId || isNaN(parseInt(clientId))) {
      return res.status(400).json({
        success: false,
        message: 'Valid client ID is required'
      });
    }

    if (!scheduleConfig || typeof scheduleConfig !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Schedule configuration is required'
      });
    }

    await updateClientSchedule(parseInt(clientId), scheduleConfig);
    
    res.json({
      success: true,
      message: 'Schedule updated successfully',
      clientId: parseInt(clientId),
      config: scheduleConfig
    });
  } catch (error) {
    console.error(`Error updating schedule for client ${req.params.clientId}:`, error);
    
    if (error.message.includes('Invalid') || error.message.includes('must be')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update schedule',
      error: error.message
    });
  }
});

// ✅ Bulk update multiple client schedules
router.post('/patrol-schedules/bulk-update', async (req, res) => {
  try {
    const { schedules } = req.body;

    if (!Array.isArray(schedules) || schedules.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Schedules array is required and cannot be empty'
      });
    }

    // Validate each schedule in the array
    for (const schedule of schedules) {
      if (!schedule.clientId || isNaN(parseInt(schedule.clientId))) {
        return res.status(400).json({
          success: false,
          message: `Invalid client ID in schedule: ${schedule.clientId}`
        });
      }
      if (!schedule.config || typeof schedule.config !== 'object') {
        return res.status(400).json({
          success: false,
          message: `Invalid config for client ${schedule.clientId}`
        });
      }
    }

    await bulkUpdateSchedules(schedules);
    
    res.json({
      success: true,
      message: 'Bulk update completed successfully',
      count: schedules.length
    });
  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform bulk update',
      error: error.message
    });
  }
});

// ✅ Get available clients (clients without schedules)
router.get('/patrol-schedules/available-clients', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        C.cue_iid AS id,
        C.cue_cnombre AS name,
        C.cue_cemail AS email
      FROM [_Datos].[dbo].[m_cuentas] C
      LEFT JOIN [_Datos].[dbo].[m_patrol_schedule] PS
        ON C.cue_iid = PS.client_id
      WHERE PS.client_id IS NULL
      ORDER BY C.cue_cnombre
    `);

    res.json({
      success: true,
      availableClients: result.recordset,
      count: result.recordset.length
    });
  } catch (error) {
    console.error('Error fetching available clients:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available clients',
      error: error.message
    });
  }
});

// ✅ Initialize/ensure table exists
router.post('/patrol-schedules/init-table', async (req, res) => {
  try {
    await ensurePatrolScheduleTable();
    
    res.json({
      success: true,
      message: 'Patrol schedule table initialized successfully'
    });
  } catch (error) {
    console.error('Error initializing table:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize patrol schedule table',
      error: error.message
    });
  }
});

// ✅ Get clients with their schedule status
router.get('/clients', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        C.cue_iid AS id,
        C.cue_cnombre AS name,
        C.cue_cemail AS email,
        CASE 
          WHEN PS.client_id IS NOT NULL THEN 'configured'
          ELSE 'not_configured'
        END AS schedule_status,
        PS.patrols_per_day AS patrols_per_day,
        PS.patrol_days AS patrol_days,
        PS.schedule_type AS schedule_type
      FROM [_Datos].[dbo].[m_cuentas] C
      LEFT JOIN [_Datos].[dbo].[m_patrol_schedule] PS
        ON C.cue_iid = PS.client_id
      ORDER BY C.cue_cnombre
    `);

    res.json({
      success: true,
      clients: result.recordset,
      count: result.recordset.length
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch clients',
      error: error.message
    });
  }
});

// Export the router as a named export
export { router as patrolSchedulesRoutes };