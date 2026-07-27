// routes/reportRoutes.js - WITH ROLE-BASED ACCESS CONTROL
// 🔧 CRITICAL: ASCII ENCODING FIX - MUST BE FIRST, BEFORE ANY IMPORTS
if (typeof global.TextDecoder === 'undefined' || !global.__ascii_encoding_fixed__) {
  const { StringDecoder } = require('string_decoder');
  
  global.TextDecoder = class TextDecoder {
    constructor(encoding = 'utf-8') {
      const enc = String(encoding).toLowerCase().replace(/[-_\s]/g, '');
      const map = {
        'utf8': 'utf8', 'utf-8': 'utf8',
        'ascii': 'ascii', 'usascii': 'ascii', 'ansi': 'latin1',
        'latin1': 'latin1', 'iso88591': 'latin1', 'iso-8859-1': 'latin1',
        'binary': 'latin1', 'base64': 'base64', 'hex': 'hex',
        'ucs2': 'ucs2', 'ucs-2': 'ucs2', 'utf16le': 'utf16le', 'utf-16le': 'utf16le'
      };
      this.encoding = encoding;
      this.nodeEncoding = map[enc] || 'utf8';
      try {
        this.decoder = new StringDecoder(this.nodeEncoding);
      } catch (error) {
        this.decoder = new StringDecoder('utf8');
        this.nodeEncoding = 'utf8';
      }
    }
    
    decode(input, options = {}) {
      if (!input) return '';
      if (typeof input === 'string') return input;
      try {
        let buffer;
        if (Buffer.isBuffer(input)) {
          buffer = input;
        } else if (input instanceof ArrayBuffer) {
          buffer = Buffer.from(input);
        } else if (ArrayBuffer.isView(input)) {
          buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
        } else {
          buffer = Buffer.from(input);
        }
        return buffer.toString(this.nodeEncoding);
      } catch (error) {
        return '';
      }
    }
  };
  
  global.TextEncoder = class TextEncoder {
    constructor() { this.encoding = 'utf-8'; }
    encode(input = '') { return Buffer.from(String(input), 'utf8'); }
  };
  
  global.__ascii_encoding_fixed__ = true;
}

const express = require('express');
const reportController = require('../controllers/reportController.js');
const { auth, requireAdmin, requireAny } = require('../middleware/auth.js');

const router = express.Router();

// =====================================================
// 📄 PDF REPORT ROUTES
// =====================================================

/**
 * @route   GET /api/reports/weekly/pdf
 * @desc    Download weekly PDF report - admin + client (own data only)
 * @note    Client-side filtering by clientName enforced in controller
 */
router.get('/weekly/pdf', auth, requireAny, reportController.getWeeklyReportPDF);

/**
 * @route   GET /api/reports/dashboard-pdf
 * @desc    Download dashboard PDF - admin + client (own data only)
 */
router.get('/dashboard-pdf', auth, requireAny, reportController.getDashboardPDF);

/**
 * @route   GET /api/reports/comprehensive-pdf
 * @desc    Download comprehensive PDF with service choice - admin + client
 */
router.get('/comprehensive-pdf', auth, requireAny, reportController.getComprehensivePDF);

// =====================================================
// 📊 DATA REPORT ROUTES
// =====================================================

/**
 * @route   GET /api/reports/patrol
 * @desc    Get patrol report data - admin + client (own data only)
 */
router.get('/patrol', auth, requireAny, reportController.getPatrolReport);

/**
 * @route   GET /api/reports/weekly
 * @desc    Get weekly report (alias for patrol) - admin + client
 */
router.get('/weekly', auth, requireAny, reportController.getWeeklyReport);

/**
 * @route   GET /api/reports/comprehensive/:clientName
 * @desc    Get comprehensive client report - admin + client (own data only)
 */
router.get('/comprehensive/:clientName', auth, requireAny, reportController.getComprehensiveClientReport);

/**
 * @route   GET /api/reports/performance-trends/:clientName
 * @desc    Get client performance trends - admin + client (own data only)
 */
router.get('/performance-trends/:clientName', auth, requireAny, reportController.getClientPerformanceTrends);

// =====================================================
// 📧 MANUAL REPORT TRIGGER (NEW)
// =====================================================

/**
 * @route   POST /api/reports/trigger-manual
 * @desc    Trigger a manual report for a specific client - admin + client (own data only)
 * @body    { clientId, recipientEmail, startDate, endDate, reportPeriod }
 */
router.post('/trigger-manual', auth, requireAny, reportController.triggerManualReport);

// =====================================================
// 👥 CLIENT MANAGEMENT ROUTES
// =====================================================

/**
 * @route   GET /api/reports/clients
 * @desc    Get all clients list - admin only (cross-client data)
 */
router.get('/clients', auth, requireAdmin, reportController.getAllClientsList);

/**
 * @route   GET /api/reports/clients/search
 * @desc    Search clients by name - admin only
 */
router.get('/clients/search', auth, requireAdmin, reportController.searchClients);

// =====================================================
// ⚙️ CLIENT CONFIGURATION ROUTES
// =====================================================

/**
 * @route   GET /api/reports/shifts
 * @desc    Get available shifts for a client (query param) - admin + client
 */
router.get('/shifts', auth, requireAny, reportController.getClientShifts);

/**
 * @route   GET /api/reports/shifts/:client
 * @desc    Get available shifts for a client (route param) - admin + client
 */
router.get('/shifts/:client', auth, requireAny, reportController.getClientShifts);

// =====================================================
// 🗓️ PATROL SCHEDULE MANAGEMENT ROUTES (NEW)
// =====================================================

/**
 * @route   GET /api/reports/patrol-schedules
 * @desc    List all clients with their patrol schedules - admin only
 */
router.get('/patrol-schedules', auth, requireAdmin, reportController.listAllPatrolSchedules);

/**
 * @route   GET /api/reports/patrol-schedule/:clientId
 * @desc    Get patrol schedule for a client - admin + client (own data only)
 */
router.get('/patrol-schedule/:clientId', auth, requireAny, reportController.getPatrolSchedule);

/**
 * @route   PUT /api/reports/patrol-schedule/:clientId
 * @desc    Create or update patrol schedule for a client - admin only (schedule modification)
 */
router.put('/patrol-schedule/:clientId', auth, requireAdmin, reportController.upsertPatrolSchedule);

/**
 * @route   DELETE /api/reports/patrol-schedule/:clientId
 * @desc    Delete patrol schedule for a client - admin only
 */
router.delete('/patrol-schedule/:clientId', auth, requireAdmin, reportController.deletePatrolSchedule);

/**
 * @route   GET /api/reports/patrol-schedule/:clientId/analytics
 * @desc    Get client analytics with patrol schedule info - admin + client (own data only)
 */
router.get('/patrol-schedule/:clientId/analytics', auth, requireAny, reportController.getPatrolAnalytics);

// =====================================================
// 🗂️ REPORT ARCHIVE ROUTES (Google Drive)
// =====================================================

/**
 * @route   GET /api/reports/archive/clients
 * @desc    List all archived clients - admin only (exposes all client names)
 */
router.get('/archive/clients', auth, requireAdmin, reportController.getArchiveClients);

/**
 * @route   GET /api/reports/archive/months
 * @desc    List available months for an archived client - admin + client (own data only)
 */
router.get('/archive/months', auth, requireAny, reportController.getArchiveMonths);

/**
 * @route   GET /api/reports/archive/list
 * @desc    List archived report files for a client - admin + client (own data only)
 */
router.get('/archive/list', auth, requireAny, reportController.getArchiveList);

/**
 * @route   GET /api/reports/archive/download/:fileId
 * @desc    Download a specific archived report from Google Drive - admin + client
 * @note    File-level ownership cannot be enforced here without a lookup;
 *          ensure the controller validates the file belongs to the requesting client
 */
router.get('/archive/download/:fileId', auth, requireAny, reportController.downloadArchiveFile);

/**
 * @route   DELETE /api/reports/archive/:fileId
 * @desc    Delete (trash) an archived report from Google Drive - admin only
 *          Destructive operation; clients should never delete files
 */
router.delete('/archive/:fileId', auth, requireAdmin, reportController.deleteArchiveFile);

// =====================================================
// 🧪 TESTING & DEBUGGING ROUTES (Admin only)
// =====================================================

/**
 * @route   GET /api/reports/debug-zones
 * @desc    Debug zone names - admin only
 */
router.get('/debug-zones', auth, requireAdmin, reportController.debugZoneNames);

/**
 * @route   GET /api/reports/test
 * @desc    Test report data flow - admin only
 */
router.get('/test', auth, requireAdmin, reportController.testReportData);

/**
 * @route   GET /api/reports/test-pdf-services
 * @desc    Test both PDF generation services - admin only
 */
router.get('/test-pdf-services', auth, requireAdmin, reportController.testPDFServices);

/**
 * @route   GET /api/reports/debug
 * @desc    Debug performance calculations - admin only
 */
router.get('/debug', auth, requireAdmin, reportController.debugPerformanceCalc);

/**
 * @route   GET /api/reports/test/:clientName
 * @route   POST /api/reports/test/:clientName
 * @desc    Test report generation for specific client - admin only
 * ⚠️ IMPORTANT: Must come AFTER /test and /test-pdf-services
 */
router.get('/test/:clientName', auth, requireAdmin, reportController.testReportGeneration);
router.post('/test/:clientName', auth, requireAdmin, reportController.testReportGeneration);

// =====================================================
// 🏠 HEALTH CHECK (Public - no auth)
// =====================================================

/**
 * @route   GET /api/reports/health
 * @desc    System health check - public (monitoring tools need this)
 */
router.get('/health', reportController.healthCheck);

// =====================================================
// 📋 ROOT ENDPOINT WITH DOCUMENTATION (Public)
// =====================================================

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Security Reports API - DUAL PDF SERVICE VERSION ✅',
    version: '4.0.0',
    description: 'Enhanced with patrol schedule management, dual PDF generation, and Google Drive archive',

    authentication: {
      type: 'Bearer JWT',
      header: 'Authorization: Bearer <token>',
      roles: {
        admin: 'Full access to all endpoints',
        client: 'Read-only access to own data (scoped by clientName in JWT)'
      }
    },

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

    patrolScheduleManagement: {
      description: 'Configure custom patrol schedules per client',
      endpoints: {
        listAllSchedules: {
          method: 'GET', path: '/api/reports/patrol-schedules',
          auth: 'admin only'
        },
        getSchedule: {
          method: 'GET', path: '/api/reports/patrol-schedule/:clientId',
          auth: 'admin | client (own data)'
        },
        upsertSchedule: {
          method: 'PUT', path: '/api/reports/patrol-schedule/:clientId',
          auth: 'admin only',
          body: {
            patrolsPerDay: 'number (required)',
            patrolDays: 'string (e.g., "Mon,Tue,Wed,Thu,Fri,Sat,Sun")',
            weekendPatrols: 'number (optional, defaults to patrolsPerDay)',
            shiftType: 'string (Day/Night, Day, Night)',
            scheduleType: 'string (daily, weekly, custom)',
            customIntervalDays: 'number (optional)'
          }
        },
        deleteSchedule: {
          method: 'DELETE', path: '/api/reports/patrol-schedule/:clientId',
          auth: 'admin only'
        },
        getAnalytics: {
          method: 'GET', path: '/api/reports/patrol-schedule/:clientId/analytics',
          auth: 'admin | client (own data)',
          parameters: 'days (optional, default: 30)'
        }
      }
    },

    manualReportTrigger: {
      description: 'Generate and email a report on demand',
      endpoint: '/api/reports/trigger-manual',
      method: 'POST',
      auth: 'admin | client (own data)',
      body: {
        clientId: 'number (required)',
        recipientEmail: 'string (required)',
        startDate: 'string (YYYY-MM-DD, optional)',
        endDate: 'string (YYYY-MM-DD, optional)',
        reportPeriod: 'string (previousWeek, last7days, custom)'
      }
    },

    endpoints: {
      // PDF Generation
      getWeeklyPDF: {
        method: 'GET', path: '/api/reports/weekly/pdf',
        auth: 'admin | client (own data)',
        parameters: 'clientName, startDate, endDate, shiftType'
      },
      getDashboardPDF: {
        method: 'GET', path: '/api/reports/dashboard-pdf',
        auth: 'admin | client (own data)',
        parameters: 'clientName, startDate, endDate'
      },
      getComprehensivePDF: {
        method: 'GET', path: '/api/reports/comprehensive-pdf',
        auth: 'admin | client (own data)',
        parameters: 'clientName, startDate, endDate, type'
      },
      
      // Client Management
      getAllClients: {
        method: 'GET', path: '/api/reports/clients',
        auth: 'admin only'
      },
      searchClients: {
        method: 'GET', path: '/api/reports/clients/search',
        auth: 'admin only',
        parameters: 'query'
      },
      
      // Data Reports
      getPatrolReport: {
        method: 'GET', path: '/api/reports/patrol',
        auth: 'admin | client (own data)',
        parameters: 'client, startDate, endDate, shiftType'
      },
      getComprehensiveReport: {
        method: 'GET', path: '/api/reports/comprehensive/:clientName',
        auth: 'admin | client (own data)',
        parameters: 'period, customStart, customEnd'
      },
      getPerformanceTrends: {
        method: 'GET', path: '/api/reports/performance-trends/:clientName',
        auth: 'admin | client (own data)',
        parameters: 'months'
      },
      
      // Configuration
      getClientShifts: {
        method: 'GET', path: '/api/reports/shifts',
        auth: 'admin | client',
        parameters: 'client (query)'
      },
      
      // Archive
      getArchiveClients: {
        method: 'GET', path: '/api/reports/archive/clients',
        auth: 'admin only'
      },
      getArchiveMonths: {
        method: 'GET', path: '/api/reports/archive/months',
        auth: 'admin | client (own data)',
        parameters: 'client'
      },
      getArchiveList: {
        method: 'GET', path: '/api/reports/archive/list',
        auth: 'admin | client (own data)',
        parameters: 'client, month (optional)'
      },
      downloadArchiveFile: {
        method: 'GET', path: '/api/reports/archive/download/:fileId',
        auth: 'admin | client'
      },
      deleteArchiveFile: {
        method: 'DELETE', path: '/api/reports/archive/:fileId',
        auth: 'admin only'
      },
      
      // Patrol Schedule (NEW)
      listPatrolSchedules: {
        method: 'GET', path: '/api/reports/patrol-schedules',
        auth: 'admin only'
      },
      getPatrolSchedule: {
        method: 'GET', path: '/api/reports/patrol-schedule/:clientId',
        auth: 'admin | client (own data)'
      },
      upsertPatrolSchedule: {
        method: 'PUT', path: '/api/reports/patrol-schedule/:clientId',
        auth: 'admin only'
      },
      deletePatrolSchedule: {
        method: 'DELETE', path: '/api/reports/patrol-schedule/:clientId',
        auth: 'admin only'
      },
      getPatrolAnalytics: {
        method: 'GET', path: '/api/reports/patrol-schedule/:clientId/analytics',
        auth: 'admin | client (own data)',
        parameters: 'days (optional)'
      },
      
      // Manual Trigger (NEW)
      triggerManualReport: {
        method: 'POST', path: '/api/reports/trigger-manual',
        auth: 'admin | client (own data)'
      },
      
      // Debug / Test
      debugZones: {
        method: 'GET', path: '/api/reports/debug-zones',
        auth: 'admin only'
      },
      testPDFServices: {
        method: 'GET', path: '/api/reports/test-pdf-services',
        auth: 'admin only'
      },
      testReport: {
        method: 'GET', path: '/api/reports/test',
        auth: 'admin only'
      },
      testGeneration: {
        method: 'GET/POST', path: '/api/reports/test/:clientName',
        auth: 'admin only'
      },
      debugPerformance: {
        method: 'GET', path: '/api/reports/debug',
        auth: 'admin only'
      },
      
      // Health
      healthCheck: {
        method: 'GET', path: '/api/reports/health',
        auth: 'public'
      }
    },

    synchronization: {
      status: 'COMPLETE ✅',
      dataFlow: 'Routes → Auth Middleware → Controller → Dual PDF Services',
      services: {
        pdfService1: 'reportService.js (weekly reports)',
        pdfService2: 'pdfService.js (dashboard reports)',
        dataFetching: 'reportModel.js (synchronized)',
        scheduleManager: 'managePatrolSchedules.js (patrol schedule management)',
        calculations: 'Shared logic across all modules'
      },
      zoneHandling: {
        status: 'FIXED ✅',
        source: 'BM Security API (priority) → Database (fallback)',
        filtering: 'UNKNOWN_ZONE removed automatically',
        names: 'Real zone names from API/Database'
      }
    },

    technicalDetails: {
      architecture: 'Routes → Auth Middleware → Controller → Dual PDF Services → Database/API',
      dataSources: {
        primary: 'SQL Server database tables',
        secondary: 'BMSecurity API (configurable)',
        fallback: 'Automatic database fallback if API fails'
      },
      timezone: process.env.TIMEZONE || 'Africa/Nairobi'
    },

    timestamp: new Date().toISOString(),
    status: 'operational'
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
    availablePatrolScheduleEndpoints: {
      listSchedules: '/api/reports/patrol-schedules',
      getSchedule: '/api/reports/patrol-schedule/:clientId',
      upsertSchedule: 'PUT /api/reports/patrol-schedule/:clientId',
      deleteSchedule: 'DELETE /api/reports/patrol-schedule/:clientId',
      analytics: '/api/reports/patrol-schedule/:clientId/analytics'
    },
    availableManualTrigger: {
      triggerManual: 'POST /api/reports/trigger-manual'
    },
    availableArchiveEndpoints: {
      archiveMonths: '/api/reports/archive/months',
      archiveList: '/api/reports/archive/list',
      archiveDownload: '/api/reports/archive/download/:fileId'
    },
    availableEndpoints: {
      patrol: '/api/reports/patrol',
      shifts: '/api/reports/shifts',
      health: '/api/reports/health'
    },
    suggestion: 'Visit /api/reports for full documentation'
  });
});

module.exports = router;