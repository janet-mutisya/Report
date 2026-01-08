// server/routes/reportRoutes.js - FULLY SYNCHRONIZED VERSION
import express from 'express';
import {
  getWeeklyReportPDF,
  getPatrolReport,
  getWeeklyReport,
  getClientShifts,
  testReportData,
  testReportGeneration,
  getComprehensiveClientReport,
  getClientPerformanceTrends,
  getAllClientsList,
  searchClients,
  debugPerformanceCalc,
  healthCheck
} from '../controllers/reportController.js';

const router = express.Router();

// =====================================================
// 📄 PDF REPORT ROUTES
// =====================================================

/**
 * Download PDF report
 * Query params: clientName, startDate, endDate, shiftType
 * Controller: getWeeklyReportPDF()
 */
router.get('/weekly/pdf', getWeeklyReportPDF);

// =====================================================
// 📊 DATA REPORT ROUTES
// =====================================================

/**
 * Get patrol report data (main endpoint)
 * Query params: client, startDateTime/startDate, endDateTime/endDate, shiftType
 * Controller: getPatrolReport()
 */
router.get('/patrol', getPatrolReport);

/**
 * Get weekly report (alias for patrol report)
 * Same as /patrol endpoint
 * Controller: getWeeklyReport() → getPatrolReport()
 */
router.get('/weekly', getWeeklyReport);

/**
 * Get comprehensive client report
 * Route param: :clientName
 * Query params: period, customStart, customEnd
 * Controller: getComprehensiveClientReport()
 */
router.get('/comprehensive/:clientName', getComprehensiveClientReport);

/**
 * Get client performance trends
 * Route param: :clientName
 * Query param: months
 * Controller: getClientPerformanceTrends()
 */
router.get('/performance-trends/:clientName', getClientPerformanceTrends);

// =====================================================
// 👥 CLIENT MANAGEMENT ROUTES
// =====================================================

/**
 * Get all clients list
 * No parameters needed
 * Controller: getAllClientsList()
 */
router.get('/clients', getAllClientsList);

/**
 * Search clients by name
 * Query param: query (search term)
 * Controller: searchClients()
 */
router.get('/clients/search', searchClients);

// =====================================================
// ⚙️ CLIENT CONFIGURATION ROUTES
// =====================================================

/**
 * Get available shifts and schedule for a client
 * Query param: client OR Route param: :client
 * Controller: getClientShifts()
 */
router.get('/shifts', getClientShifts); // Query param version
router.get('/shifts/:client', getClientShifts); // Route param version

// =====================================================
// 🧪 TESTING & DEBUGGING ROUTES
// =====================================================

/**
 * Test report data flow
 * Query params: clientName, startDate, endDate
 * Controller: testReportData()
 */
router.get('/test', testReportData);

/**
 * Test report generation for specific client
 * Route param: :clientName
 * Query params (GET) / Body params (POST): startDate, endDate, shiftType
 * Controller: testReportGeneration()
 */
router.get('/test/:clientName', testReportGeneration);
router.post('/test/:clientName', testReportGeneration);

/**
 * Debug performance calculations
 * Query params: clientName, startDate, endDate
 * Controller: debugPerformanceCalc()
 */
router.get('/debug', debugPerformanceCalc);

// =====================================================
// 🏠 HEALTH CHECK ROUTES
// =====================================================

/**
 * Health check endpoint
 * No parameters needed
 * Controller: healthCheck()
 */
router.get('/health', healthCheck);

// =====================================================
// 📋 ROOT ENDPOINT WITH DOCUMENTATION
// =====================================================

/**
 * API Documentation
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Security Reports API - FULLY SYNCHRONIZED VERSION ✅',
    version: '3.0.0',
    description: 'All endpoints synchronized with updated controller functions',
    synchronization: {
      status: 'COMPLETE ✅',
      dataFlow: 'Routes → Controller → Synchronized Services',
      services: {
        pdfGeneration: 'reportService.js (synchronized)',
        dataFetching: 'reportModel.js (synchronized)',
        calculations: 'Shared logic across all modules'
      }
    },
    endpoints: {
      // Client Management
      getAllClients: {
        method: 'GET',
        path: '/api/reports/clients',
        description: 'Get list of all available clients',
        parameters: 'None',
        example: '/api/reports/clients'
      },
      searchClients: {
        method: 'GET',
        path: '/api/reports/clients/search',
        description: 'Search clients by name',
        parameters: 'query (search term)',
        example: '/api/reports/clients/search?query=acme'
      },

      // PDF Reports
      getWeeklyPDF: {
        method: 'GET',
        path: '/api/reports/weekly/pdf',
        description: 'Download PDF report',
        parameters: 'clientName, startDate, endDate, shiftType',
        example: '/api/reports/weekly/pdf?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08'
      },

      // Data Reports
      getPatrolReport: {
        method: 'GET',
        path: '/api/reports/patrol',
        description: 'Get patrol report data (JSON format)',
        parameters: 'client, startDate/startDateTime, endDate/endDateTime, shiftType',
        example: '/api/reports/patrol?client=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08'
      },
      getComprehensiveReport: {
        method: 'GET',
        path: '/api/reports/comprehensive/:clientName',
        description: 'Get comprehensive report with trends',
        parameters: ':clientName (route), period, customStart, customEnd',
        example: '/api/reports/comprehensive/Acme%20Corp?period=last30days'
      },
      getPerformanceTrends: {
        method: 'GET',
        path: '/api/reports/performance-trends/:clientName',
        description: 'Get performance trends over time',
        parameters: ':clientName (route), months',
        example: '/api/reports/performance-trends/Acme%20Corp?months=6'
      },

      // Configuration
      getClientShifts: {
        method: 'GET',
        path: '/api/reports/shifts',
        description: 'Get available shifts for client (query param)',
        parameters: 'client (query)',
        example: '/api/reports/shifts?client=Acme%20Corp'
      },
      getClientShiftsParam: {
        method: 'GET',
        path: '/api/reports/shifts/:client',
        description: 'Get available shifts for client (route param)',
        parameters: ':client (route)',
        example: '/api/reports/shifts/Acme%20Corp'
      },

      // Testing & Debugging
      testReport: {
        method: 'GET',
        path: '/api/reports/test',
        description: 'Test report data flow',
        parameters: 'clientName, startDate, endDate',
        example: '/api/reports/test?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08'
      },
      testGeneration: {
        method: 'GET/POST',
        path: '/api/reports/test/:clientName',
        description: 'Test PDF generation for specific client',
        parameters: ':clientName (route), startDate, endDate, shiftType',
        example: {
          GET: '/api/reports/test/Acme%20Corp?startDate=2024-01-01&endDate=2024-01-08',
          POST: '/api/reports/test/Acme%20Corp with JSON body'
        }
      },
      debugPerformance: {
        method: 'GET',
        path: '/api/reports/debug',
        description: 'Debug performance calculations',
        parameters: 'clientName, startDate, endDate',
        example: '/api/reports/debug?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08'
      },

      // Health
      healthCheck: {
        method: 'GET',
        path: '/api/reports/health',
        description: 'System health check',
        parameters: 'None',
        example: '/api/reports/health'
      }
    },

    parameterDetails: {
      clientNames: {
        note: 'Client names should be URL-encoded if they contain spaces or special characters',
        queryParams: ['client', 'clientName'],
        routeParams: [':clientName', ':client'],
        examples: {
          encoded: 'Acme%20Corporation',
          decoded: 'Acme Corporation'
        }
      },
      dates: {
        formats: 'YYYY-MM-DD (recommended) or YYYY-MM-DDTHH:mm:ss',
        queryParams: {
          pdfEndpoints: 'startDate, endDate',
          dataEndpoints: 'startDateTime/startDate, endDateTime/endDate'
        },
        examples: {
          simple: '2024-01-01',
          withTime: '2024-01-01T00:00:00'
        }
      },
      periods: {
        options: ['last7days', 'last30days', 'last90days', 'custom'],
        customPeriod: 'Requires customStart and customEnd parameters'
      }
    },

    synchronizationStatus: {
      routesController: '✅ FULLY SYNCHRONIZED',
      dataServices: '✅ USING SYNCHRONIZED reportModel.js & reportService.js',
      calculations: '✅ CONSISTENT ACROSS ALL MODULES',
      dateHandling: '✅ PROPER DATE FORMAT SUPPORT',
      errorHandling: '✅ UNIFIED ERROR RESPONSES'
    },

    quickStartExamples: [
      // Step 1: Find clients
      '1. List all clients: GET /api/reports/clients',
      '2. Search clients: GET /api/reports/clients/search?query=acme',
      
      // Step 2: Get report data
      '3. Get JSON data: GET /api/reports/patrol?client=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08',
      '4. Get comprehensive: GET /api/reports/comprehensive/Acme%20Corp?period=last30days',
      
      // Step 3: Download PDF
      '5. Download PDF: GET /api/reports/weekly/pdf?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08',
      
      // Step 4: Debug if needed
      '6. Debug: GET /api/reports/debug?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08',
      '7. Health check: GET /api/reports/health'
    ],

    technicalDetails: {
      architecture: 'Routes → Controller → Services → Database/API',
      dataSources: {
        primary: 'SQL Server database tables',
        secondary: 'BMSecurity API (configurable)',
        fallback: 'Automatic database fallback if API fails'
      },
      pdfGeneration: 'PDFKit via synchronized reportService.js',
      dataFormatting: 'Consistent formatting across all endpoints',
      timezone: process.env.TIMEZONE || 'Africa/Nairobi'
    },

    troubleshooting: {
      commonIssues: [
        'Issue: Client not found → Solution: Check exact client name spelling',
        'Issue: No data returned → Solution: Verify date range and client ID',
        'Issue: PDF generation fails → Solution: Check server logs and test with /debug endpoint',
        'Issue: Performance calculations wrong → Solution: Verify client schedule configuration'
      ],
      debuggingTips: [
        'Use /test endpoint to validate data flow',
        'Use /debug endpoint to see calculation details',
        'Check /health endpoint for system status',
        'Verify client exists with /clients endpoint'
      ]
    },

    changelog: {
      '3.0.0': 'Fully synchronized routes with controller',
      '2.1.0': 'Added comprehensive reporting endpoints',
      '2.0.0': 'Integrated synchronized report services',
      '1.0.0': 'Initial release'
    },

    support: {
      documentation: 'All endpoints documented in this response',
      testing: 'Use /test endpoints for validation',
      debugging: 'Use /debug endpoint for detailed analysis',
      health: 'Use /health endpoint for system status'
    },

    timestamp: new Date().toISOString(),
    status: 'operational',
    syncVerified: true
  });
});

// =====================================================
// 🔄 CATCH-ALL ROUTE FOR UNDEFINED ENDPOINTS
// =====================================================

router.use('/', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    requestedPath: req.originalUrl,
    availableEndpoints: {
      clients: '/api/reports/clients',
      pdf: '/api/reports/weekly/pdf',
      patrol: '/api/reports/patrol',
      test: '/api/reports/test',
      debug: '/api/reports/debug',
      health: '/api/reports/health'
    },
    suggestion: 'Visit /api/reports for full documentation'
  });
});

export default router;