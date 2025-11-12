// routes/schedularRoutes.js - COMPLETE FIXED VERSION
import express from "express";
import sql from 'mssql';
import { poolPromise } from '../config/database.js';
import {
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  createSchedule,
  deleteSchedule,
  triggerDynamicReports,
  triggerPatrolReports,
  sendEnhancedClientReport,
  getPatrolReportPreview,
  getSchedulerStatus,
  getAllClientsPerformance,
  getClientAnalyticsData,
  getHistoricalDateRange,
  getClientHistoricalPatrols,
  getPreviousWeekRange,
  transformPatrolsToPosts,
  transformPatrolsToEvents,
  calculateSummary,
  diagnosticServices
} from "../controllers/schedulerController.js";

const router = express.Router();

// =============================================
// 🏥 HEALTH & STATUS ROUTES (First)
// =============================================

/**
 * @route   GET /api/scheduler/health
 * @desc    Health check endpoint
 */
router.get('/health', async (req, res) => {
  try {
    let dbConnected = false;
    let dbError = null;

    try {
      const pool = await poolPromise;
      if (pool) {
        await pool.request().query('SELECT 1 AS test');
        dbConnected = true;
      } else {
        dbError = 'Database pool not available';
      }
    } catch (error) {
      dbError = error.message;
    }

    res.status(200).json({
      success: true,
      message: 'Scheduler API is running',
      timestamp: new Date().toISOString(),
      database: {
        connected: dbConnected,
        status: dbConnected ? 'healthy' : 'disconnected',
        error: dbError
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      },
      endpoints: {
        diagnostic: '/api/scheduler/diagnostic/services',
        clients: '/api/scheduler/clients',
        schedules: '/api/scheduler',
        historical: '/api/scheduler/historical/:clientId',
        analytics: '/api/scheduler/analytics/summary',
        triggers: '/api/scheduler/trigger/*',
        debug: '/api/scheduler/debug/data/:clientId',
        testPdf: '/api/scheduler/test/pdf/:clientId'
      }
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.status(200).json({
      success: true,
      message: 'Scheduler API is running',
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        status: 'disconnected',
        error: error.message
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: process.uptime()
      }
    });
  }
});

/**
 * @route   GET /api/scheduler/status
 * @desc    Get scheduler system status
 */
router.get("/status", getSchedulerStatus);

// =============================================
// 🔍 DIAGNOSTIC ROUTES (Critical - Must be early!)
// =============================================

/**
 * @route   GET /api/scheduler/diagnostic/services
 * @desc    🔍 CRITICAL - Check PDF and Email service exports
 */
router.get('/diagnostic/services', diagnosticServices);

// =============================================
// 🧪 DEBUG & TEST ROUTES
// =============================================

/**
 * @route   GET /api/scheduler/debug/data/:clientId
 * @desc    Debug endpoint to see what data would be sent to PDF
 */
router.get('/debug/data/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { days = 30 } = req.query;
    
    console.log(`🔍 Debugging data structure for client ${clientId}`);
    
    const pool = await poolPromise;
    const clientResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          cue_iid AS ClientID,
          cue_cnombre AS ClientName,
          cue_cemail AS ClientEmail
        FROM _Datos.dbo.m_cuentas
        WHERE cue_iid = @clientId
      `);

    if (clientResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    const client = clientResult.recordset[0];
    
    const dateRange = {
      startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0]
    };
    
    const patrolData = await getClientHistoricalPatrols(
      parseInt(clientId),
      dateRange.startDate + ' 00:00:00',
      dateRange.endDate + ' 23:59:59'
    );
    
    const posts = transformPatrolsToPosts(patrolData, {}, dateRange);
    const events = transformPatrolsToEvents(patrolData);
    const summary = calculateSummary(patrolData, {}, dateRange);
    
    const pdfData = {
      clientId: client.ClientID,
      clientName: client.ClientName,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      shiftType: 'Day/Night',
      posts: posts,
      events: events,
      summary: summary,
      patrolData: patrolData
    };
    
    res.status(200).json({
      success: true,
      debug: {
        message: 'This is the data structure that would be sent to PDF generation',
        clientInfo: {
          id: pdfData.clientId,
          name: pdfData.clientName,
          dateRange: `${pdfData.startDate} to ${pdfData.endDate}`,
          shiftType: pdfData.shiftType
        },
        dataStructure: {
          posts: {
            count: pdfData.posts.length,
            sample: pdfData.posts[0] || null,
            structure: pdfData.posts.length > 0 ? Object.keys(pdfData.posts[0]) : []
          },
          events: {
            count: pdfData.events.length,
            sample: pdfData.events[0] || null,
            structure: pdfData.events.length > 0 ? Object.keys(pdfData.events[0]) : []
          },
          summary: pdfData.summary,
          rawPatrolData: {
            pastPatrolsCount: patrolData.pastPatrols?.length || 0,
            upcomingPatrolsCount: patrolData.upcomingPatrols?.length || 0,
            patrols: patrolData.patrols?.length || 0
          }
        },
        validation: {
          hasClientId: !!pdfData.clientId,
          hasClientName: !!pdfData.clientName,
          hasDateRange: !!pdfData.startDate && !!pdfData.endDate,
          hasPosts: pdfData.posts.length > 0,
          hasEvents: pdfData.events.length > 0,
          hasSummary: !!pdfData.summary
        },
        warnings: [
          ...(pdfData.posts.length === 0 ? ['⚠️ No posts data - PDF will show empty performance table'] : []),
          ...(pdfData.events.length === 0 ? ['⚠️ No events data - PDF will show empty events log'] : []),
          ...(!pdfData.clientId ? ['❌ CRITICAL: No clientId - PDF generation will fail'] : [])
        ]
      },
      fullData: pdfData
    });
    
  } catch (error) {
    console.error('❌ Debug endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Debug failed',
      error: error.message,
      stack: error.stack
    });
  }
});

/**
 * @route   POST /api/scheduler/test/pdf/:clientId
 * @desc    Test PDF generation with mock data
 */
router.post('/test/pdf/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    console.log(`🧪 Testing PDF generation for client ${clientId}`);
    
    const pool = await poolPromise;
    const clientResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          cue_iid AS ClientID,
          cue_cnombre AS ClientName,
          cue_cemail AS ClientEmail
        FROM _Datos.dbo.m_cuentas
        WHERE cue_iid = @clientId
      `);

    if (clientResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    const client = clientResult.recordset[0];
    
    const testData = {
      clientId: client.ClientID,
      clientName: client.ClientName,
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      shiftType: 'Day/Night',
      
      posts: [
        {
          SitePost: 'Main Entrance Gate',
          ChecksCompleted: 85,
          ExpectedChecks: 100,
          PerformanceRate: '85.0%'
        },
        {
          SitePost: 'Parking Lot A',
          ChecksCompleted: 75,
          ExpectedChecks: 100,
          PerformanceRate: '75.0%'
        }
      ],
      
      events: [
        {
          rec_tfechahora: '2025-01-15 08:30:00',
          rec_czona: 'NW-01',
          rec_calarma: 'V04',
          rec_cContenido: 'VIGICONTROL: Arrival'
        },
        {
          rec_tfechahora: '2025-01-15 09:15:00',
          rec_czona: 'SW-01',
          rec_calarma: 'V04',
          rec_cContenido: 'Patrol Check'
        }
      ],
      
      summary: {
        totalPatrols: 320,
        completedPatrols: 320,
        totalExpected: 400,
        complianceRate: '80.0%',
        postsCount: 2,
        eventsCount: 2
      }
    };
    
    console.log(`📊 Test data prepared for ${client.ClientName}`);
    
    // Try to dynamically import and use PDF service
    try {
      const pdfModule = await import('../service/pdfService.js');
      console.log('📦 PDF Module loaded:', Object.keys(pdfModule));
      
      let pdfBuffer = null;
      
      // Try different function names
      if (typeof pdfModule.generateDashboardPDF === 'function') {
        pdfBuffer = await pdfModule.generateDashboardPDF(testData);
      } else if (typeof pdfModule.generatePatrolReportPDF === 'function') {
        pdfBuffer = await pdfModule.generatePatrolReportPDF(testData);
      } else if (typeof pdfModule.default?.generateDashboardPDF === 'function') {
        pdfBuffer = await pdfModule.default.generateDashboardPDF(testData);
      } else if (typeof pdfModule.default === 'function') {
        pdfBuffer = await pdfModule.default(testData);
      } else {
        throw new Error(`No compatible PDF function found. Available: ${Object.keys(pdfModule).join(', ')}`);
      }
      
      if (!pdfBuffer) {
        throw new Error('PDF generation returned null or undefined');
      }
      
      console.log(`✅ Test PDF generated successfully, size: ${pdfBuffer.length} bytes`);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="TEST_${client.ClientName.replace(/\s+/g, '_')}_Report.pdf"`);
      res.send(pdfBuffer);
      
    } catch (pdfError) {
      console.error('❌ PDF generation error:', pdfError);
      throw pdfError;
    }
    
  } catch (error) {
    console.error('❌ PDF test error:', error);
    res.status(500).json({
      success: false,
      message: 'PDF test failed',
      error: error.message,
      stack: error.stack
    });
  }
});

// =============================================
// 📋 CLIENT ROUTES
// =============================================

/**
 * @route   GET /api/scheduler/clients
 * @desc    Get all clients with performance metrics
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
      clients: result.recordset
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

// =============================================
// 📊 REPORT ROUTES (Must be before /:id routes!)
// =============================================

/**
 * @route   POST /api/scheduler/send-enhanced/:clientId
 * @desc    Send enhanced client report
 */
router.post("/send-enhanced/:clientId", sendEnhancedClientReport);

/**
 * @route   GET /api/scheduler/preview/:clientId
 * @desc    Get patrol report preview
 */
router.get("/preview/:clientId", getPatrolReportPreview);

// =============================================
// 🚀 TRIGGER ROUTES
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
// 📈 ANALYTICS ROUTES
// =============================================

/**
 * @route   GET /api/scheduler/analytics/summary
 * @desc    Get analytics summary
 */
router.get('/analytics/summary', async (req, res) => {
  try {
    const pool = await poolPromise;
    
    const [clientsResult, dueResult, upcomingResult, totalResult, patrolResult] = await Promise.all([
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
        SELECT COUNT(*) as recentPatrols
        FROM [_Datos].[dbo].[p_recepcion]
        WHERE rec_tfechahora >= DATEADD(day, -1, GETDATE())
      `)
    ]);

    res.status(200).json({
      success: true,
      analytics: {
        timestamp: new Date().toISOString(),
        summary: {
          activeClients: clientsResult.recordset[0]?.activeClients || 0,
          dueReports: dueResult.recordset[0]?.dueReports || 0,
          upcomingReports: upcomingResult.recordset[0]?.upcomingReports || 0,
          totalSchedules: totalResult.recordset[0]?.totalSchedules || 0,
          recentPatrols: patrolResult.recordset[0]?.recentPatrols || 0
        },
        performance: {
          schedulerHealth: dueResult.recordset[0]?.dueReports > 0 ? 'needs_attention' : 'healthy',
          databaseHealth: 'connected'
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
router.get('/analytics/client/:clientId', getClientAnalyticsData);

// =============================================
// 📅 HISTORICAL DATA ROUTES
// =============================================

/**
 * @route   GET /api/scheduler/historical/:clientId
 * @desc    Get historical patrol data
 */
router.get('/historical/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { startDate, endDate, monthsBack } = req.query;

    console.log(`📅 Fetching historical data for client ${clientId}`);

    const dateRange = getHistoricalDateRange({
      startDate,
      endDate,
      monthsBack: monthsBack ? parseInt(monthsBack) : null
    });

    const historicalData = await getClientHistoricalPatrols(
      parseInt(clientId),
      dateRange.sqlStartDate,
      dateRange.sqlEndDate
    );

    res.status(200).json({
      success: true,
      data: historicalData,
      dateRange: {
        display: dateRange.rangeLabel,
        start: dateRange.displayStartDate,
        end: dateRange.displayEndDate
      },
      metadata: {
        clientId: parseInt(clientId),
        generatedAt: new Date().toISOString()
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

// =============================================
// 📅 SCHEDULE CRUD ROUTES
// =============================================

/**
 * @route   POST /api/scheduler/schedule/:id
 * @desc    Create schedule
 */
router.post("/schedule/:id", createSchedule);

/**
 * @route   PUT /api/scheduler/schedule/:id
 * @desc    Update schedule
 */
router.put("/schedule/:id", updateSchedule);

/**
 * @route   DELETE /api/scheduler/schedule/:id
 * @desc    Delete schedule
 */
router.delete("/schedule/:id", deleteSchedule);

/**
 * @route   GET /api/scheduler/schedule/:id
 * @desc    Get schedule by ID
 */
router.get("/schedule/:id", getScheduleById);

// =============================================
// 📅 GENERIC ROUTES (MUST BE LAST!)
// =============================================

/**
 * @route   GET /api/scheduler
 * @desc    Get all schedules
 */
router.get("/", getAllSchedules);

/**
 * @route   GET /api/scheduler/:id
 * @desc    Get schedule by ID (fallback)
 */
router.get("/:id", getScheduleById);

export default router;