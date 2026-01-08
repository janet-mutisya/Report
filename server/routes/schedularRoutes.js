// routes/schedulerRoutes.js - FIXED & ALIGNED WITH OPTIMIZED CONTROLLER
import express from "express";
import { poolPromise } from '../config/database.js';
import sql from 'mssql';
import {
  // Schedule CRUD
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  createSchedule,
  deleteSchedule,
  
  // Manual Triggers
  triggerDynamicReports,
  triggerPatrolReports,
  
  // Analytics & Status
  getSchedulerStatus,
  getAllClientsPerformance,
  
  // Testing & Diagnostics
  diagnosticServices,
  toggleEmailSending,
  testReportModel,
  
  // Date Range Functions
  getDateRangeForPeriod,
  getCustomDateRange,
  getHistoricalDateRange,
  getPreviousWeekRange,
  
  // Data Fetching (using optimized report model)
  getClientHistoricalPatrols,
  getClientPatrols,
  
  // Helper Functions
  parseEmails,
  formatEmailsForDisplay,
  calculateNightsInRange
} from "../controllers/schedulerController.js";

const router = express.Router();

// =============================================
// HEALTH & STATUS ROUTES
// =============================================

/**
 * @route   GET /api/scheduler/health
 * @desc    Health check endpoint with optimized model info
 */
router.get('/health', async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      message: 'Scheduler API is running',
      timestamp: new Date().toISOString(),
      version: 'V05 - Optimized Report Model Integration',
      features: [
        'Optimized Report Model (API-First)',
        'Multi-Table Support (p_recepcion + partitioned tables)',
        'Automatic Fallback (API → Database)',
        'Performance Caching',
        'Office365 SMTP Integration',
        'Historical Data Analysis',
        'Guard Reports Integration',
        'Filtered Events (VIGICONTROL only)',
        'PDF Generation Service',
        'Multiple Email Recipients',
        'Email Kill Switch (Global Toggle)'
      ],
      dataModel: {
        primary: 'Optimized Report Model',
        apiFirst: true,
        cachingEnabled: true,
        multiTableSupport: true
      },
      emailFeatures: {
        multipleRecipients: true,
        parsing: {
          delimiters: ['comma', 'semicolon', 'newline'],
          validation: 'basic format validation'
        },
        storage: 'VARCHAR(4000) - supports unlimited emails',
        globalEnabled: global.EMAIL_SENDING_ENABLED || false
      },
      endpoints: {
        diagnostic: '/api/scheduler/diagnostic/services',
        clients: '/api/scheduler/clients',
        schedules: '/api/scheduler',
        historical: '/api/scheduler/historical/:clientId',
        analytics: '/api/scheduler/analytics/client/:clientId',
        triggers: '/api/scheduler/trigger/*',
        test: '/api/scheduler/test/*',
        emailTools: '/api/scheduler/utils/parse-emails',
        emailToggle: '/api/scheduler/toggle-email'
      }
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/scheduler/status
 * @desc    Get scheduler system status with email statistics
 */
router.get("/status", getSchedulerStatus);

// =============================================
// DIAGNOSTIC & TESTING ROUTES
// =============================================

/**
 * @route   GET /api/scheduler/diagnostic/services
 * @desc    Check services and integrations
 */
router.get('/diagnostic/services', diagnosticServices);

/**
 * @route   POST /api/scheduler/test/report-model
 * @desc    Test optimized report model
 */
router.post('/test/report-model', testReportModel);

// =============================================
// EMAIL KILL SWITCH ROUTE
// =============================================

/**
 * @route   POST /api/scheduler/toggle-email
 * @desc    Enable/disable email sending globally
 * @body    {boolean} enabled - true to enable, false to disable
 */
router.post('/toggle-email', toggleEmailSending);

// =============================================
// EMAIL UTILITY ROUTES
// =============================================

/**
 * @route   POST /api/scheduler/utils/parse-emails
 * @desc    Parse and validate email strings
 */
router.post('/utils/parse-emails', async (req, res) => {
  try {
    const { emailString } = req.body;

    if (!emailString) {
      return res.status(400).json({
        success: false,
        message: 'emailString is required'
      });
    }

    const parsedEmails = parseEmails(emailString);
    const formattedDisplay = formatEmailsForDisplay(emailString);

    res.status(200).json({
      success: true,
      data: {
        original: emailString,
        parsed: parsedEmails,
        count: parsedEmails.length,
        formatted: formattedDisplay,
        validation: {
          valid: parsedEmails.length > 0,
          invalidCount: emailString.split(/[,;\n]/).length - parsedEmails.length
        }
      },
      emailStatus: {
        globalEnabled: global.EMAIL_SENDING_ENABLED || false
      }
    });
  } catch (error) {
    console.error('❌ Error parsing emails:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to parse emails',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/scheduler/utils/email-stats
 * @desc    Get email statistics across all schedules
 */
router.get('/utils/email-stats', async (req, res) => {
  try {
    const pool = await poolPromise;
    
    const result = await pool.request().query(`
      SELECT 
        rep_iidcuenta AS ClientID,
        rep_cmail AS EmailString,
        LEN(rep_cmail) - LEN(REPLACE(rep_cmail, ',', '')) + 1 AS EmailCount
      FROM _Datos.dbo.m_reportes_automaticos 
      WHERE rep_cmail IS NOT NULL AND rep_cmail != ''
      ORDER BY EmailCount DESC
    `);

    const stats = {
      totalSchedules: result.recordset.length,
      totalEmailRecipients: result.recordset.reduce((sum, row) => sum + (row.EmailCount || 1), 0),
      averageEmailsPerSchedule: result.recordset.length > 0 
        ? Math.round(result.recordset.reduce((sum, row) => sum + (row.EmailCount || 1), 0) / result.recordset.length)
        : 0,
      distribution: {
        singleEmail: result.recordset.filter(row => (row.EmailCount || 1) === 1).length,
        multipleEmails: result.recordset.filter(row => (row.EmailCount || 1) > 1).length,
        maxEmails: Math.max(...result.recordset.map(row => row.EmailCount || 1))
      },
      schedules: result.recordset.map(row => ({
        clientId: row.ClientID,
        emailCount: row.EmailCount || 1,
        emailString: row.EmailString
      }))
    };

    res.status(200).json({
      success: true,
      stats,
      emailStatus: {
        globalEnabled: global.EMAIL_SENDING_ENABLED || false
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error fetching email stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch email statistics',
      error: error.message
    });
  }
});

// =============================================
// CLIENT DATA ROUTES
// =============================================

/**
 * @route   GET /api/scheduler/clients
 * @desc    Get all clients with performance metrics and email configuration
 */
router.get('/clients', getAllClientsPerformance);

/**
 * @route   GET /api/scheduler/clients/basic
 * @desc    Get all clients for dropdown (basic info only)
 */
router.get('/clients/basic', async (req, res) => {
  try {
    const pool = await poolPromise;
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

    res.status(200).json({
      success: true,
      total: result.recordset.length,
      clients: result.recordset,
      usingOptimizedModel: true
    });
  } catch (error) {
    console.error('❌ Error fetching clients:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch clients',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/scheduler/clients/:clientId/patrols
 * @desc    Get comprehensive patrol data for a client using optimized model
 */
router.get('/clients/:clientId/patrols', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { days = 7 } = req.query;

    console.log(`📊 Fetching patrol data for client ${clientId} (${days} days)`);

    const patrolData = await getClientPatrols(parseInt(clientId), parseInt(days));

    res.status(200).json({
      success: patrolData.metadata.success || false,
      data: patrolData,
      metadata: {
        clientId: parseInt(clientId),
        daysAnalyzed: parseInt(days),
        generatedAt: new Date().toISOString(),
        dataSource: patrolData.metadata.dataSource || 'Unknown',
        processingTime: patrolData.metadata.processingTime || 0,
        usingOptimizedModel: true
      }
    });
  } catch (error) {
    console.error('❌ Error fetching client patrols:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch client patrol data',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/scheduler/clients/:clientId/email-config
 * @desc    Get email configuration for a specific client
 */
router.get('/clients/:clientId/email-config', async (req, res) => {
  try {
    const { clientId } = req.params;

    const pool = await poolPromise;
    
    const [scheduleResult, clientResult] = await Promise.all([
      pool.request()
        .input('clientId', sql.Int, clientId)
        .query('SELECT rep_cmail AS ReportEmail FROM _Datos.dbo.m_reportes_automaticos WHERE rep_iidcuenta = @clientId'),
      pool.request()
        .input('clientId', sql.Int, clientId)
        .query('SELECT cue_cemail AS ClientEmail, cue_ncuenta AS AccountNumber FROM _Datos.dbo.m_cuentas WHERE cue_iid = @clientId')
    ]);

    const scheduleEmail = scheduleResult.recordset[0]?.ReportEmail || '';
    const clientEmail = clientResult.recordset[0]?.ClientEmail || '';
    const accountNumber = clientResult.recordset[0]?.AccountNumber || '';

    const parsedScheduleEmails = parseEmails(scheduleEmail);
    const parsedClientEmails = parseEmails(clientEmail);

    res.status(200).json({
      success: true,
      data: {
        clientId: parseInt(clientId),
        accountNumber: accountNumber,
        scheduleEmails: {
          raw: scheduleEmail,
          parsed: parsedScheduleEmails,
          count: parsedScheduleEmails.length,
          formatted: formatEmailsForDisplay(scheduleEmail)
        },
        clientEmails: {
          raw: clientEmail,
          parsed: parsedClientEmails,
          count: parsedClientEmails.length,
          formatted: formatEmailsForDisplay(clientEmail)
        },
        defaultEmails: {
          env: process.env.TEST_EMAIL || '',
          parsed: parseEmails(process.env.TEST_EMAIL || ''),
          count: parseEmails(process.env.TEST_EMAIL || '').length
        },
        recommendations: {
          primary: parsedScheduleEmails.length > 0 ? 'schedule' : 
                   parsedClientEmails.length > 0 ? 'client' : 'default',
          totalAvailable: parsedScheduleEmails.length + parsedClientEmails.length
        },
        emailSendingStatus: {
          globalEnabled: global.EMAIL_SENDING_ENABLED || false
        }
      }
    });
  } catch (error) {
    console.error('❌ Error fetching client email config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch client email configuration',
      error: error.message
    });
  }
});

// =============================================
// MANUAL TRIGGER ROUTES
// =============================================

/**
 * @route   POST /api/scheduler/trigger/dynamic-reports
 * @desc    Manually trigger dynamic reports
 */
router.post("/trigger/dynamic-reports", triggerDynamicReports);

/**
 * @route   POST /api/scheduler/trigger/patrol-reports
 * @desc    Manually trigger patrol reports
 */
router.post("/trigger/patrol-reports", triggerPatrolReports);

// =============================================
// ANALYTICS ROUTES
// =============================================

/**
 * @route   GET /api/scheduler/analytics/summary
 * @desc    Get analytics summary dashboard
 */
router.get('/analytics/summary', async (req, res) => {
  try {
    const pool = await poolPromise;
    
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
        WHERE rep_cmail IS NOT NULL
      `),
      pool.request().query(`
        SELECT COUNT(*) as dueReports
        FROM _Datos.dbo.m_reportes_automaticos
        WHERE rep_tproximoenvio <= GETDATE()
          AND rep_cmail IS NOT NULL
      `),
      pool.request().query(`
        SELECT COUNT(*) as upcomingReports
        FROM _Datos.dbo.m_reportes_automaticos
        WHERE rep_tproximoenvio > GETDATE()
          AND rep_tproximoenvio <= DATEADD(day, 7, GETDATE())
          AND rep_cmail IS NOT NULL
      `),
      pool.request().query(`
        SELECT COUNT(*) as totalSchedules
        FROM _Datos.dbo.m_reportes_automaticos
        WHERE rep_cmail IS NOT NULL
      `),
      pool.request().query(`
        SELECT 
          COUNT(*) AS TotalSchedules,
          SUM(LEN(rep_cmail) - LEN(REPLACE(rep_cmail, ',', '')) + 1) AS TotalEmailRecipients,
          AVG(LEN(rep_cmail) - LEN(REPLACE(rep_cmail, ',', '')) + 1) AS AvgEmailsPerSchedule
        FROM _Datos.dbo.m_reportes_automaticos 
        WHERE rep_cmail IS NOT NULL AND rep_cmail != ''
      `)
    ]);

    const emailStats = emailStatsResult.recordset[0];

    res.status(200).json({
      success: true,
      analytics: {
        timestamp: new Date().toISOString(),
        summary: {
          activeClients: clientsResult.recordset[0]?.activeClients || 0,
          dueReports: dueResult.recordset[0]?.dueReports || 0,
          upcomingReports: upcomingResult.recordset[0]?.upcomingReports || 0,
          totalSchedules: totalResult.recordset[0]?.totalSchedules || 0
        },
        emailAnalytics: {
          totalRecipients: emailStats.TotalEmailRecipients || 0,
          averagePerSchedule: Math.round(emailStats.AvgEmailsPerSchedule || 1),
          totalSchedules: emailStats.TotalSchedules || 0,
          feature: 'Multiple email recipients supported',
          emailSendingEnabled: global.EMAIL_SENDING_ENABLED || false
        },
        performance: {
          schedulerHealth: dueResult.recordset[0]?.dueReports > 0 ? 'needs_attention' : 'healthy',
          databaseHealth: 'connected',
          emailService: 'Office365 SMTP with multi-recipient support',
          dataModel: 'Optimized Report Model (V05)'
        }
      }
    });

  } catch (error) {
    console.error('❌ Error in analytics summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate analytics summary',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/scheduler/analytics/client/:clientId
 * @desc    Get analytics for specific client
 */
router.get('/analytics/client/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { days = 7 } = req.query;

    const patrolData = await getClientPatrols(parseInt(clientId), parseInt(days));
    
    const pool = await poolPromise;
    const clientResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query('SELECT cue_cnombre AS ClientName, cue_ncuenta AS AccountNumber FROM _Datos.dbo.m_cuentas WHERE cue_iid = @clientId');

    const client = clientResult.recordset[0] || {};

    res.status(200).json({
      success: true,
      client: {
        id: parseInt(clientId),
        name: client.ClientName,
        accountNumber: client.AccountNumber
      },
      timeframe: `Last ${days} days`,
      analytics: {
        overallPerformance: patrolData.metadata.overallPerformance || 0,
        totalCompleted: patrolData.metadata.totalCompleted || 0,
        totalExpected: patrolData.metadata.totalExpectedPatrols || 0,
        postsCount: patrolData.posts?.length || 0,
        eventsCount: patrolData.events?.length || 0,
        guardReportsCount: patrolData.guardReports?.length || 0,
        dataSource: patrolData.metadata.dataSource || 'Unknown',
        processingTime: patrolData.metadata.processingTime || 0
      }
    });

  } catch (error) {
    console.error('❌ Error in client analytics route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get client analytics',
      error: error.message
    });
  }
});

// =============================================
// HISTORICAL DATA ROUTES
// =============================================

/**
 * @route   GET /api/scheduler/historical/:clientId
 * @desc    Get historical patrol data using optimized model
 */
router.get('/historical/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { startDate, endDate, monthsBack, specificMonth } = req.query;

    console.log(`📅 Fetching historical data for client ${clientId}`);

    const dateRange = getHistoricalDateRange({
      startDate,
      endDate,
      monthsBack: monthsBack ? parseInt(monthsBack) : null,
      specificMonth
    });

    const historicalData = await getClientHistoricalPatrols(
      parseInt(clientId),
      dateRange.startDate,
      dateRange.endDate
    );

    res.status(200).json({
      success: historicalData.metadata.success || false,
      data: historicalData,
      dateRange: {
        display: dateRange.rangeLabel,
        start: dateRange.startDate,
        end: dateRange.endDate,
        daysInRange: dateRange.daysInRange || dateRange.nightsInRange,
        nights: dateRange.nightsInRange
      },
      metadata: {
        clientId: parseInt(clientId),
        generatedAt: new Date().toISOString(),
        dataSource: historicalData.metadata.dataSource || 'Unknown',
        processingTime: historicalData.metadata.processingTime || 0,
        usingOptimizedModel: true
      }
    });

  } catch (error) {
    console.error('❌ Error fetching historical data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch historical data',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/scheduler/historical/date-ranges
 * @desc    Get available historical date ranges
 */
router.get('/historical/date-ranges', async (req, res) => {
  try {
    const ranges = {
      previousWeek: getPreviousWeekRange(),
      lastMonth: getHistoricalDateRange({ monthsBack: 1 }),
      last3Months: getHistoricalDateRange({ monthsBack: 3 }),
      last6Months: getHistoricalDateRange({ monthsBack: 6 }),
      custom: {
        description: 'Use startDate and endDate parameters',
        example: '/api/scheduler/historical/28?startDate=2025-01-01&endDate=2025-01-31'
      }
    };

    res.status(200).json({
      success: true,
      ranges,
      timezone: process.env.TIMEZONE || 'Africa/Nairobi',
      emailSendingEnabled: global.EMAIL_SENDING_ENABLED || false,
      usingOptimizedModel: true
    });
  } catch (error) {
    console.error('❌ Error fetching date ranges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch date ranges',
      error: error.message
    });
  }
});

// =============================================
// SCHEDULE CRUD ROUTES
// =============================================

/**
 * @route   GET /api/scheduler
 * @desc    Get all schedules with email counts
 */
router.get("/", getAllSchedules);

/**
 * @route   POST /api/scheduler
 * @desc    Create a new schedule with multiple email support
 */
router.post("/", createSchedule);

/**
 * @route   GET /api/scheduler/:id
 * @desc    Get schedule by ID with email configuration
 */
router.get("/:id", getScheduleById);

/**
 * @route   PUT /api/scheduler/:id
 * @desc    Update schedule with multiple email support
 */
router.put("/:id", updateSchedule);

/**
 * @route   DELETE /api/scheduler/:id
 * @desc    Delete schedule
 */
router.delete("/:id", deleteSchedule);

// =============================================
// BULK OPERATIONS
// =============================================

/**
 * @route   POST /api/scheduler/bulk/update-emails
 * @desc    Bulk update email configurations for multiple schedules
 */
router.post('/bulk/update-emails', async (req, res) => {
  try {
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Updates array is required'
      });
    }

    const pool = await poolPromise;
    const results = [];

    for (const update of updates) {
      const { scheduleId, emails } = update;

      if (!scheduleId || !emails) {
        results.push({
          scheduleId,
          success: false,
          error: 'Missing scheduleId or emails'
        });
        continue;
      }

      const parsedEmails = parseEmails(emails);
      if (parsedEmails.length === 0) {
        results.push({
          scheduleId,
          success: false,
          error: 'No valid emails provided'
        });
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
          results.push({
            scheduleId,
            success: false,
            error: 'Schedule not found'
          });
        } else {
          results.push({
            scheduleId,
            success: true,
            emailCount: parsedEmails.length,
            message: `Updated with ${parsedEmails.length} email(s)`
          });
        }
      } catch (error) {
        results.push({
          scheduleId,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.status(200).json({
      success: true,
      summary: {
        total: updates.length,
        success: successCount,
        failure: failureCount
      },
      emailStatus: {
        globalEnabled: global.EMAIL_SENDING_ENABLED || false
      },
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in bulk email update:', error);
    res.status(500).json({
      success: false,
      message: 'Bulk update failed',
      error: error.message
    });
  }
});

export default router;