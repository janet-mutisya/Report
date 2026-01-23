// server/routes/reportRoutes.js - UPDATED WITH PDF SERVICE ENDPOINTS
import express from 'express';
import {
  getWeeklyReportPDF,
  getDashboardPDF,          // NEW: PDF Service endpoint
  getComprehensivePDF,      // NEW: Comprehensive PDF with choice
  getPatrolReport,
  getWeeklyReport,
  getClientShifts,
  testReportData,
  testReportGeneration,
  testPDFServices,          // NEW: Test both PDF services
  getComprehensiveClientReport,
  getClientPerformanceTrends,
  getAllClientsList,
  searchClients,
  debugPerformanceCalc,
  healthCheck
} from '../controllers/reportController.js';

const router = express.Router();

// =====================================================
// 📄 PDF REPORT ROUTES - DUAL SERVICE SUPPORT
// =====================================================

/**
 * Download PDF report (reportService.js version)
 * Query params: clientName, startDate, endDate, shiftType
 * Controller: getWeeklyReportPDF()
 * Service: reportService.js (weekly report format)
 */
router.get('/weekly/pdf', getWeeklyReportPDF);

/**
 * Download Dashboard PDF (pdfService.js version)
 * Query params: clientName, startDate, endDate
 * Controller: getDashboardPDF()
 * Service: pdfService.js (dashboard format with incidents)
 */
router.get('/dashboard-pdf', getDashboardPDF);

/**
 * Download Comprehensive PDF with service choice
 * Query params: clientName, startDate, endDate, type
 * Controller: getComprehensivePDF()
 * Service: pdfService.js OR reportService.js based on type
 */
router.get('/comprehensive-pdf', getComprehensivePDF);

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
 * Test PDF services (BOTH reportService.js AND pdfService.js)
 * Query params: clientName, startDate, endDate
 * Controller: testPDFServices()
 */
router.get('/test-pdf-services', testPDFServices);

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
    message: 'Security Reports API - DUAL PDF SERVICE VERSION ✅',
    version: '3.1.0',
    description: 'Enhanced with dual PDF generation services (reportService.js + pdfService.js)',
    pdfServices: {
      reportService: {
        name: 'reportService.js',
        description: 'Weekly patrol report generation',
        endpoint: '/api/reports/weekly/pdf'
      },
      pdfService: {
        name: 'pdfService.js',
        description: 'Dashboard report with incidents and detailed formatting',
        endpoint: '/api/reports/dashboard-pdf'
      },
      comprehensive: {
        name: 'Choice-based service',
        description: 'Choose between reportService or pdfService',
        endpoint: '/api/reports/comprehensive-pdf?type=dashboard|weekly'
      }
    },
    synchronization: {
      status: 'COMPLETE ✅',
      dataFlow: 'Routes → Controller → Dual PDF Services',
      services: {
        pdfService1: 'reportService.js (weekly reports)',
        pdfService2: 'pdfService.js (dashboard reports)',
        dataFetching: 'reportModel.js (synchronized)',
        calculations: 'Shared logic across all modules'
      }
    },
    endpoints: {
      // PDF Generation Services
      getWeeklyPDF: {
        method: 'GET',
        path: '/api/reports/weekly/pdf',
        description: 'Download PDF report (reportService.js)',
        parameters: 'clientName, startDate, endDate, shiftType',
        service: 'reportService.js',
        example: '/api/reports/weekly/pdf?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08'
      },
      getDashboardPDF: {
        method: 'GET',
        path: '/api/reports/dashboard-pdf',
        description: 'Download Dashboard PDF (pdfService.js)',
        parameters: 'clientName, startDate, endDate',
        service: 'pdfService.js',
        example: '/api/reports/dashboard-pdf?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08'
      },
      getComprehensivePDF: {
        method: 'GET',
        path: '/api/reports/comprehensive-pdf',
        description: 'Download PDF with service choice',
        parameters: 'clientName, startDate, endDate, type',
        service: 'reportService.js OR pdfService.js',
        typeOptions: ['dashboard', 'weekly', 'pdfservice', 'reportservice'],
        example: '/api/reports/comprehensive-pdf?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08&type=dashboard'
      },

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
      testPDFServices: {
        method: 'GET',
        path: '/api/reports/test-pdf-services',
        description: 'Test both PDF generation services',
        parameters: 'clientName, startDate, endDate',
        example: '/api/reports/test-pdf-services?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08'
      },
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
      pdfTypes: {
        forComprehensivePDF: {
          dashboard: 'Uses pdfService.js (dashboard format with incidents)',
          pdfservice: 'Same as dashboard',
          weekly: 'Uses reportService.js (weekly report format)',
          reportservice: 'Same as weekly'
        },
        default: 'dashboard'
      },
      periods: {
        options: ['last7days', 'last30days', 'last90days', 'custom'],
        customPeriod: 'Requires customStart and customEnd parameters'
      }
    },

    pdfServiceComparison: {
      reportService: {
        type: 'Weekly Report',
        features: [
          'Standard patrol report format',
          'Shift-based reporting',
          'Performance percentages',
          'Basic incident reporting'
        ],
        bestFor: 'Weekly compliance reports, shift-based analysis'
      },
      pdfService: {
        type: 'Dashboard Report',
        features: [
          'Professional dashboard layout',
          'Detailed incident reports with zone names',
          'Performance overview cards',
          'Security activity log',
          'Visual metrics display',
          'Comprehensive incident details'
        ],
        bestFor: 'Executive dashboards, client presentations, detailed incident reporting'
      }
    },

    synchronizationStatus: {
      routesController: '✅ FULLY SYNCHRONIZED',
      pdfServices: '✅ DUAL SERVICE SUPPORT (reportService.js + pdfService.js)',
      dataServices: '✅ USING SYNCHRONIZED reportModel.js',
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
      
      // Step 3: Download PDF - CHOOSE YOUR FORMAT
      '5. Weekly Report: GET /api/reports/weekly/pdf?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08',
      '6. Dashboard Report: GET /api/reports/dashboard-pdf?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08',
      '7. Choose Format: GET /api/reports/comprehensive-pdf?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08&type=dashboard',
      
      // Step 4: Test and debug
      '8. Test PDF Services: GET /api/reports/test-pdf-services?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08',
      '9. Debug: GET /api/reports/debug?clientName=Acme%20Corp&startDate=2024-01-01&endDate=2024-01-08',
      '10. Health check: GET /api/reports/health'
    ],

    frontendIntegration: {
      weeklyReportPDF: {
        method: 'GET',
        url: '/api/reports/weekly/pdf?clientName=${client}&startDate=${startDate}&endDate=${endDate}',
        contentType: 'application/pdf',
        note: 'Use for standard weekly compliance reports'
      },
      dashboardPDF: {
        method: 'GET',
        url: '/api/reports/dashboard-pdf?clientName=${client}&startDate=${startDate}&endDate=${endDate}',
        contentType: 'application/pdf',
        note: 'Use for executive dashboards with detailed incidents'
      },
      comprehensivePDF: {
        method: 'GET',
        url: '/api/reports/comprehensive-pdf?clientName=${client}&startDate=${startDate}&endDate=${endDate}&type=${type}',
        contentType: 'application/pdf',
        note: 'Let users choose between dashboard and weekly formats'
      }
    },

    technicalDetails: {
      architecture: 'Routes → Controller → Dual PDF Services → Database/API',
      dataSources: {
        primary: 'SQL Server database tables',
        secondary: 'BMSecurity API (configurable)',
        fallback: 'Automatic database fallback if API fails'
      },
      pdfGeneration: {
        reportService: 'PDFKit via reportService.js (weekly format)',
        pdfService: 'PDFKit via pdfService.js (dashboard format)'
      },
      dataFormatting: 'Consistent formatting across all endpoints',
      timezone: process.env.TIMEZONE || 'Africa/Nairobi'
    },

    troubleshooting: {
      commonIssues: [
        'Issue: Client not found → Solution: Check exact client name spelling',
        'Issue: No data returned → Solution: Verify date range and client ID',
        'Issue: PDF generation fails → Solution: Test with /test-pdf-services endpoint',
        'Issue: Wrong PDF format → Solution: Choose correct endpoint: weekly/pdf or dashboard-pdf'
      ],
      debuggingTips: [
        'Use /test-pdf-services to validate both PDF services',
        'Use /debug endpoint to see calculation details',
        'Check /health endpoint for system status',
        'Verify client exists with /clients endpoint',
        'Test both PDF formats to choose the right one for your needs'
      ]
    },

    changelog: {
      '3.1.0': 'Added dual PDF service support (reportService.js + pdfService.js)',
      '3.0.0': 'Fully synchronized routes with controller',
      '2.1.0': 'Added comprehensive reporting endpoints',
      '2.0.0': 'Integrated synchronized report services',
      '1.0.0': 'Initial release'
    },

    support: {
      documentation: 'All endpoints documented in this response',
      testing: 'Use /test-pdf-services endpoint to validate PDF generation',
      debugging: 'Use /debug endpoint for detailed analysis',
      health: 'Use /health endpoint for system status',
      pdfComparison: 'Compare reportService.js vs pdfService.js formats above'
    },

    timestamp: new Date().toISOString(),
    status: 'operational',
    pdfServicesVerified: true
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
    availablePDFEndpoints: {
      weeklyPDF: '/api/reports/weekly/pdf',
      dashboardPDF: '/api/reports/dashboard-pdf',
      comprehensivePDF: '/api/reports/comprehensive-pdf'
    },
    availableEndpoints: {
      clients: '/api/reports/clients',
      patrol: '/api/reports/patrol',
      test: '/api/reports/test',
      'test-pdf-services': '/api/reports/test-pdf-services',
      debug: '/api/reports/debug',
      health: '/api/reports/health'
    },
    suggestion: 'Visit /api/reports for full documentation or use /api/reports/test-pdf-services to test PDF generation'
  });
});

export default router;