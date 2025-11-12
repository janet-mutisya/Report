// server/routes/reportRoutes.js - FINAL VERSION WITH DEBUG ENDPOINT
import express from 'express';
import {
  getWeeklyReportPDF,
  getPatrolReport,
  getWeeklyReport,
  getClientShifts,
  testReportData,
  testReportGeneration,
  sendSingleClientReport,
  getComprehensiveClientReport,
  getClientPerformanceTrends,
  getAllClientsList,
  searchClients,
  debugPerformanceCalc,
  healthCheck
} from '../controllers/reportController.js';

const router = express.Router();

/**
 * 📄 PDF REPORT ROUTES
 */

// Download PDF report
router.get('/weekly/pdf', getWeeklyReportPDF);

/**
 * 📊 DATA REPORT ROUTES
 */

// Get patrol report data (main endpoint)
router.get('/patrol', getPatrolReport);

// Get weekly report (alias for patrol report - backward compatibility)
router.get('/weekly', getWeeklyReport);

// Get comprehensive client report with multiple date ranges
router.get('/comprehensive/:clientName', getComprehensiveClientReport);

// Get client performance trends
router.get('/performance-trends/:clientName', getClientPerformanceTrends);

/**
 * 👥 CLIENT MANAGEMENT ROUTES
 */

// Get all clients list
router.get('/clients', getAllClientsList);

// Search clients by name
router.get('/clients/search', searchClients);

/**
 * ⚙️ CLIENT CONFIGURATION ROUTES
 */

// Get available shifts and schedule for a client
router.get('/shifts', getClientShifts);
router.get('/shifts/:client', getClientShifts);

/**
 * 🧪 TESTING & DEBUGGING ROUTES
 */

// Test report data flow
router.get('/test', testReportData);

// Test report generation for specific client
router.get('/test/:clientName', testReportGeneration);
router.post('/test/:clientName', testReportGeneration);

// Debug performance calculations - NEW ENDPOINT
router.get('/debug', debugPerformanceCalc);

/**
 * 📧 EMAIL ROUTES
 */

// Manually send report to single client
router.post('/send/:clientName', sendSingleClientReport);

/**
 * 🏠 HEALTH CHECK ROUTES
 */

// Health check endpoint
router.get('/health', healthCheck);

// Root endpoint with documentation
router.get('/', (req, res) => {
  res.json({
    message: 'Security Reports API',
    version: '2.0.0',
    description: 'All endpoints now use client names. Calculations imported from managePatrolSchedules.js',
    improvements: {
      calculations: 'Using shared calculation functions from managePatrolSchedules.js',
      zoneNames: 'Displaying actual zone names instead of IDs',
      performance: 'Proportional distribution for realistic performance rates',
      events: 'Human-readable event descriptions with fallbacks'
    },
    endpoints: {
      // Client Management
      clients: {
        method: 'GET',
        path: '/api/reports/clients',
        description: 'Get list of all available clients',
        example: '/api/reports/clients'
      },
      search: {
        method: 'GET',
        path: '/api/reports/clients/search',
        description: 'Search clients by name',
        parameters: {
          query: 'Search term (min 2 characters)'
        },
        example: '/api/reports/clients/search?query=client'
      },
      
      // PDF Reports
      pdf: {
        method: 'GET',
        path: '/api/reports/weekly/pdf',
        description: 'Download PDF report',
        parameters: {
          clientName: 'Client name (required)',
          startDate: 'Start date YYYY-MM-DD (required)',
          endDate: 'End date YYYY-MM-DD (required)',
          shiftType: 'Shift type (optional: Day/Night, Day, Night)'
        },
        example: '/api/reports/weekly/pdf?clientName=Client Name&startDate=2024-01-01&endDate=2024-01-08'
      },
      
      // Data Reports
      data: {
        method: 'GET',
        path: '/api/reports/patrol',
        description: 'Get patrol report data (JSON)',
        parameters: {
          client: 'Client name (required)',
          startDateTime: 'Start date/time (required)',
          endDateTime: 'End date/time (required)',
          shiftType: 'Shift type (optional)'
        },
        example: '/api/reports/patrol?client=Client Name&startDateTime=2024-01-01&endDateTime=2024-01-08',
        returns: {
          summary: 'Zone performance with proportional expected patrols',
          events: 'Event log with zone names',
          calculations: 'Total expected, completed, completion rate, performance rating',
          schedule: 'Client schedule details including custom schedule info'
        }
      },
      
      comprehensive: {
        method: 'GET',
        path: '/api/reports/comprehensive/:clientName',
        description: 'Get comprehensive report with trends',
        parameters: {
          period: 'last7days, last30days, last90days, custom',
          customStart: 'Required if period=custom',
          customEnd: 'Required if period=custom'
        },
        example: '/api/reports/comprehensive/Client Name?period=last30days'
      },
      
      trends: {
        method: 'GET',
        path: '/api/reports/performance-trends/:clientName',
        description: 'Get client performance trends over time',
        parameters: {
          months: 'Number of months to analyze (default: 6)'
        },
        example: '/api/reports/performance-trends/Client Name?months=12',
        returns: {
          trends: 'Monthly performance data with ratings',
          summary: 'Average performance, best/worst months'
        }
      },
      
      // Configuration
      shifts: {
        method: 'GET',
        path: '/api/reports/shifts',
        description: 'Get available shifts and schedule for client',
        parameters: {
          client: 'Client name (required)'
        },
        example: '/api/reports/shifts?client=Client Name',
        returns: {
          schedule: 'Patrol schedule with weekday/weekend patrols',
          availableShifts: 'Available shift options',
          weeklyTotal: 'Calculated weekly patrol total'
        }
      },
      
      // Testing & Debugging
      test: {
        method: 'GET',
        path: '/api/reports/test',
        description: 'Test report generation with detailed analysis',
        parameters: {
          clientName: 'Client name (required)',
          startDate: 'Start date (optional)',
          endDate: 'End date (optional)'
        },
        example: '/api/reports/test?clientName=Client Name&startDate=2024-01-01&endDate=2024-01-08',
        returns: {
          dataAnalysis: 'Structure validation',
          performanceCheck: 'Per-zone calculations with realism check',
          recommendations: 'Issues and suggestions',
          calculationVerification: 'Total expected, completed, rates'
        }
      },
      
      testClient: {
        method: 'GET/POST',
        path: '/api/reports/test/:clientName',
        description: 'Test report generation for specific client',
        example: '/api/reports/test/Client Name'
      },
      
      debug: {
        method: 'GET',
        path: '/api/reports/debug',
        description: '🆕 Debug performance calculations in detail',
        parameters: {
          clientName: 'Client name (required)',
          startDate: 'Start date (optional)',
          endDate: 'End date (optional)'
        },
        example: '/api/reports/debug?clientName=Client Name&startDate=2024-01-01&endDate=2024-01-08',
        returns: {
          calculationMethod: 'Method used (imported from managePatrolSchedules.js)',
          totalExpected: 'Total expected patrols',
          totalCompleted: 'Total completed patrols',
          completionRate: 'Overall completion percentage',
          performanceRating: 'Rating (Excellent/Good/Fair/Poor)',
          weeklyTotal: 'Weekly patrol total from schedule',
          zones: 'Per-zone breakdown with calculations',
          events: 'Sample events'
        }
      },
      
      // Email
      email: {
        method: 'POST',
        path: '/api/reports/send/:clientName',
        description: 'Manually send report via email',
        example: '/api/reports/send/Client Name'
      },
      
      // Health
      health: {
        method: 'GET',
        path: '/api/reports/health',
        description: 'Health check with fix verification',
        returns: {
          status: 'System health status',
          fixes: 'Applied fixes verification',
          endpoints: 'Available endpoints list'
        }
      }
    },
    
    usageTips: {
      clientNames: 'Use exact client names as they appear in the system',
      encoding: 'URL encode client names with spaces or special characters',
      calculations: 'All calculations now use shared functions from managePatrolSchedules.js',
      debugging: 'Use /debug endpoint to verify calculations are working correctly',
      examples: [
        'Find clients: /api/reports/clients',
        'Get data: /api/reports/patrol?client=Acme%20Corporation&startDateTime=2024-01-01&endDateTime=2024-01-08',
        'Download PDF: /api/reports/weekly/pdf?clientName=Acme Corporation&startDate=2024-01-01&endDate=2024-01-08',
        'Debug calcs: /api/reports/debug?clientName=Acme Corporation&startDate=2024-01-01&endDate=2024-01-08',
        'Test system: /api/reports/test?clientName=Acme Corporation'
      ]
    },
    
    fixes: {
      zoneNames: {
        status: 'FIXED ✅',
        description: 'Zone names now display correctly (e.g., "Main Entrance" instead of "5")',
        implementation: 'LEFT JOIN with m_zonas table using COALESCE'
      },
      performanceCalc: {
        status: 'FIXED ✅',
        description: 'Performance rates now realistic (no more 3466%)',
        implementation: 'Proportional distribution based on actual activity + imported calculations'
      },
      eventDescriptions: {
        status: 'FIXED ✅',
        description: 'Events show descriptions (no more "Unknown Event")',
        implementation: 'COALESCE with multiple fallbacks including "Patrol Completed"'
      },
      importedCalculations: {
        status: 'IMPLEMENTED ✅',
        description: 'All three files now use same calculation methods',
        implementation: 'Imported from managePatrolSchedules.js for consistency'
      }
    },
    
    architecture: {
      controller: 'reportController.js - Uses imported calculations',
      service: 'generatePatrolReport.js - Uses imported calculations',
      scheduler: 'managePatrolSchedules.js - Source of truth for calculations',
      routes: 'reportRoutes.js - API endpoints',
      consistency: 'All three layers use identical calculation logic'
    }
  });
});

export default router;