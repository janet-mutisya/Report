// server/controllers/reportController.js - UPDATED WITH PDF SERVICE IMPORT
const { generateWeeklyReportPDF } = require("../service/reportService.js");
const { generatePDFReport, generateDashboardPDF } = require("../service/pdfService.js"); // ADDED PDF SERVICE
const { fetchWeeklyReport } = require("../models/reportModel.js");
const { getClientSchedule } = require("../scripts/managePatrolSchedules.js");
const { sql, poolPromise } = require("../config/database.js");
const nodemailer = require("nodemailer");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

// 🔧 Available shifts configuration
const AVAILABLE_SHIFTS = [
  { 
    value: "Day/Night", 
    label: "All Shifts (Day & Night)", 
    description: "24-hour coverage",
    default: false
  },
  { 
    value: "Day", 
    label: "Day Shift Only",
    description: "6:00 AM - 5:59 PM",
    default: false
  },
  { 
    value: "Night", 
    label: "Night Shift Only",
    description: "6:00 PM - 5:59 AM",
    default: false
  }
];

// 🔄 Helper Functions

/**
 * Calculate weekly total patrols
 */
function calculateWeeklyTotal(weekdayPatrols, weekendPatrols, patrolDays) {
  const days = patrolDays?.split(',').map(day => day.trim().toLowerCase()) || [];
  let weeklyTotal = 0;
  
  days.forEach(day => {
    if (day === 'sat' || day === 'sun') {
      weeklyTotal += weekendPatrols || weekdayPatrols || 11;
    } else {
      weeklyTotal += weekdayPatrols || 11;
    }
  });
  
  return weeklyTotal;
}

/**
 * Get performance rating
 */
function getPerformanceRating(complianceRate) {
  const rate = typeof complianceRate === 'number' ? complianceRate : parseFloat(complianceRate) || 0;
  if (rate >= 90) return 'Excellent';
  if (rate >= 80) return 'Good';
  if (rate >= 70) return 'Fair';
  return 'Poor';
}

/**
 * Get performance status
 */
function getPerformanceStatus(performanceRate) {
  const rate = typeof performanceRate === 'number' ? performanceRate : parseFloat(performanceRate) || 0;
  if (rate >= 100) return 'Exceeded Target';
  if (rate >= 90) return 'On Target';
  if (rate >= 70) return 'Needs Improvement';
  return 'Needs Attention';
}

/**
 * Get shift description
 */
function getShiftDescription(shiftType) {
  switch (shiftType?.toLowerCase()) {
    case 'day': return 'Day Shift (6:00-17:59)';
    case 'night': return 'Night Shift (18:00-5:59)';
    case 'day/night':
    default: return 'All Shifts';
  }
}

/**
 * Get client info from database
 */
async function getClientInfo(clientParam) {
  const pool = await poolPromise;
  try {
    // Check if clientParam is numeric (ID) or string (Name)
    const isNumeric = !isNaN(clientParam) && !isNaN(parseFloat(clientParam));
    
    if (isNumeric) {
      // Query by ID
      const result = await pool.request()
        .input("clientId", sql.Int, parseInt(clientParam))
        .query(`
          SELECT cue_iid AS id, cue_cnombre AS name
          FROM [_Datos].[dbo].[m_cuentas] 
          WHERE cue_iid = @clientId
        `);
      
      if (result.recordset.length > 0) {
        return result.recordset[0];
      }
    } else {
      // Query by name - try exact match first
      const result = await pool.request()
        .input("clientName", sql.NVarChar, clientParam)
        .query(`
          SELECT cue_iid AS id, cue_cnombre AS name
          FROM [_Datos].[dbo].[m_cuentas] 
          WHERE cue_cnombre = @clientName
        `);
      
      if (result.recordset.length > 0) {
        return result.recordset[0];
      }
      
      // Try partial match if exact match fails
      const partialResult = await pool.request()
        .input("clientName", sql.NVarChar, `%${clientParam}%`)
        .query(`
          SELECT cue_iid AS id, cue_cnombre AS name
          FROM [_Datos].[dbo].[m_cuentas] 
          WHERE cue_cnombre LIKE @clientName
          ORDER BY cue_cnombre
        `);
      
      return partialResult.recordset.length > 0 ? partialResult.recordset[0] : null;
    }
    
    return null;
    
  } catch (error) {
    console.error("❌ Error getting client info:", error);
    return null;
  }
}

/**
 * Get all clients
 */
async function getAllClients() {
  const pool = await poolPromise;
  try {
    const result = await pool.request().query(`
      SELECT cue_iid AS id, cue_cnombre AS name
      FROM [_Datos].[dbo].[m_cuentas] 
      WHERE cue_cnombre IS NOT NULL 
        AND cue_cnombre != ''
      ORDER BY cue_cnombre
    `);
    return result.recordset;
  } catch (error) {
    console.error("❌ Error getting all clients:", error);
    return [];
  }
}

// =====================================================
// 📊 MAIN CONTROLLER FUNCTIONS - WITH PDF SERVICE SUPPORT
// =====================================================

/**
 * 📄 Generate and download PDF report (reportService version)
 * Uses: generateWeeklyReportPDF from reportService.js
 */
const getWeeklyReportPDF = async (req, res) => {
  try {
    const { clientName, startDate, endDate, shiftType = "Day/Night" } = req.query;
    
    console.log("📄 [CONTROLLER] PDF Request (ReportService):", { clientName, startDate, endDate, shiftType });

    if (!clientName) {
      return res.status(400).json({
        success: false,
        message: "Client Name is required",
        example: "/api/reports/weekly/pdf?clientName=Client Name&startDate=2024-01-01&endDate=2024-01-08"
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Start date and end date are required",
        example: "/api/reports/weekly/pdf?clientName=Client Name&startDate=2024-01-01&endDate=2024-01-08"
      });
    }

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: `Client not found: ${clientName}`
      });
    }

    console.log(`✅ Client found: ${clientInfo.name} (ID: ${clientInfo.id})`);

    // ✅ Use the synchronized reportService.js for PDF generation
    const pdfBuffer = await generateWeeklyReportPDF(
      clientInfo.id,
      startDate,
      endDate
    );
    
    if (!pdfBuffer) {
      console.error("❌ PDF generation returned null buffer");
      return res.status(500).json({
        success: false,
        message: "PDF generation failed - no buffer returned"
      });
    }

    const safeClientName = clientInfo.name.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
    const filename = `Security_Patrol_Report_${safeClientName}_${startDate.replace(/-/g, '')}_${endDate.replace(/-/g, '')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    console.log("✅ PDF generated successfully:", {
      filename,
      size: `${(pdfBuffer.length / 1024).toFixed(2)} KB`,
      service: 'reportService.js (synchronized)'
    });

    res.send(pdfBuffer);

  } catch (error) {
    console.error("❌ PDF Generation Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating PDF report",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * 📄 Generate Dashboard PDF (pdfService version)
 * NEW ENDPOINT: Uses generateDashboardPDF from pdfService.js
 */
const getDashboardPDF = async (req, res) => {
  try {
    const { clientName, startDate, endDate } = req.query;
    
    console.log("📊 [CONTROLLER] Dashboard PDF Request (PDFService):", { clientName, startDate, endDate });

    if (!clientName) {
      return res.status(400).json({
        success: false,
        message: "Client Name is required",
        example: "/api/reports/dashboard-pdf?clientName=Client Name&startDate=2024-01-01&endDate=2024-01-08"
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Start date and end date are required",
        example: "/api/reports/dashboard-pdf?clientName=Client Name&startDate=2024-01-01&endDate=2024-01-08"
      });
    }

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: `Client not found: ${clientName}`
      });
    }

    console.log(`✅ Client found for dashboard: ${clientInfo.name} (ID: ${clientInfo.id})`);

    // ✅ Use the pdfService.js for dashboard PDF generation
    const pdfResult = await generatePDFReport({
      clientId: clientInfo.id,
      clientName: clientInfo.name,
      startDate,
      endDate
    });
    
    if (!pdfResult.success || !pdfResult.pdfBuffer) {
      console.error("❌ Dashboard PDF generation failed:", pdfResult.error);
      return res.status(500).json({
        success: false,
        message: "Dashboard PDF generation failed",
        error: pdfResult.error || "No buffer returned"
      });
    }

    const safeClientName = clientInfo.name.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
    const filename = `Security_Dashboard_${safeClientName}_${startDate.replace(/-/g, '')}_${endDate.replace(/-/g, '')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfResult.pdfBuffer.length);
    
    console.log("✅ Dashboard PDF generated successfully:", {
      filename,
      size: `${(pdfResult.pdfBuffer.length / 1024).toFixed(2)} KB`,
      service: 'pdfService.js',
      pages: pdfResult.metadata?.pages || 'Unknown'
    });

    res.send(pdfResult.pdfBuffer);

  } catch (error) {
    console.error("❌ Dashboard PDF Generation Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating dashboard PDF",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * 📄 Generate Comprehensive PDF with choice of service
 * NEW ENDPOINT: Allows choosing between reportService and pdfService
 */
const getComprehensivePDF = async (req, res) => {
  try {
    const { clientName, startDate, endDate, type = 'dashboard' } = req.query;
    
    console.log("📄 [CONTROLLER] Comprehensive PDF Request:", { clientName, startDate, endDate, type });

    if (!clientName) {
      return res.status(400).json({
        success: false,
        message: "Client Name is required",
        example: "/api/reports/comprehensive-pdf?clientName=Client Name&startDate=2024-01-01&endDate=2024-01-08&type=dashboard"
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Start date and end date are required"
      });
    }

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: `Client not found: ${clientName}`
      });
    }

    let pdfBuffer;
    let serviceUsed;
    let filenamePrefix;

    if (type === 'dashboard' || type === 'pdfservice') {
      // Use pdfService.js for dashboard-style PDF
      console.log(`📊 Using pdfService.js for ${type} PDF`);
      const pdfResult = await generatePDFReport({
        clientId: clientInfo.id,
        clientName: clientInfo.name,
        startDate,
        endDate
      });
      
      if (!pdfResult.success || !pdfResult.pdfBuffer) {
        throw new Error(pdfResult.error || "PDF Service failed");
      }
      
      pdfBuffer = pdfResult.pdfBuffer;
      serviceUsed = 'pdfService.js';
      filenamePrefix = type === 'dashboard' ? 'Security_Dashboard' : 'Security_Report_PDFService';
    } else {
      // Default to reportService.js for weekly report
      console.log(`📄 Using reportService.js for ${type} PDF`);
      pdfBuffer = await generateWeeklyReportPDF(
        clientInfo.id,
        startDate,
        endDate
      );
      serviceUsed = 'reportService.js';
      filenamePrefix = 'Security_Patrol_Report';
    }
    
    if (!pdfBuffer) {
      throw new Error("PDF generation returned null buffer");
    }

    const safeClientName = clientInfo.name.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
    const filename = `${filenamePrefix}_${safeClientName}_${startDate.replace(/-/g, '')}_${endDate.replace(/-/g, '')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    console.log("✅ PDF generated successfully:", {
      filename,
      size: `${(pdfBuffer.length / 1024).toFixed(2)} KB`,
      service: serviceUsed,
      type
    });

    res.send(pdfBuffer);

  } catch (error) {
    console.error("❌ Comprehensive PDF Generation Error:", error);
    res.status(500).json({
      success: false,
      message: `Error generating ${req.query.type || 'dashboard'} PDF`,
      error: error.message,
      timestamp: new Date().toISOString(),
      availableTypes: ['dashboard', 'pdfservice', 'weekly', 'reportservice']
    });
  }
};

/**
 * 📊 Get patrol report data
 * Uses: fetchWeeklyReport from reportModel.js
 */
const getPatrolReport = async (req, res) => {
  try {
    const { 
      client, 
      startDate, 
      endDate,
      startDateTime,
      endDateTime,
      shiftType = "Day/Night" 
    } = req.query;

    // Support both naming conventions
    const effectiveStartDate = startDate || startDateTime;
    const effectiveEndDate = endDate || endDateTime;

    if (!client || !effectiveStartDate || !effectiveEndDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: client, startDate, and endDate.",
        example: "/api/reports/patrol?client=ClientName&startDate=2024-01-01&endDate=2024-01-08"
      });
    }

    console.log(`\n📊 [CONTROLLER] Patrol Report Request:`, {
      client,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      shiftType
    });

    const clientInfo = await getClientInfo(client);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: `Client not found: ${client}`
      });
    }

    const schedule = await getClientSchedule(clientInfo.id);
    const effectiveShiftType = schedule?.shift_type || shiftType;

    // ✅ Use the synchronized reportModel.js for data fetching
    const reportData = await fetchWeeklyReport(
      clientInfo.id,
      effectiveStartDate.split('T')[0],
      effectiveEndDate.split('T')[0]
    );

    if (!reportData.metadata.success) {
      const errorMsg = reportData.metadata.error?.message || "Unknown error";
      console.error("❌ Data fetch failed:", errorMsg);
      return res.status(500).json({
        success: false,
        message: "Data fetch failed",
        error: errorMsg,
        metadata: reportData.metadata
      });
    }

    // Transform data for response
    const transformedSummary = reportData.posts.map(post => ({
      SitePost: post.SecurityPost,
      ChecksCompleted: post.Completed,
      ExpectedChecks: post.Expected,
      PerformanceRate: `${post.Performance}%`,
      Percentage: post.Percentage,
      Status: getPerformanceStatus(post.Performance)
    }));

    const transformedEvents = reportData.events.map(event => ({
      Date: event.Date,
      Time: event.Time,
      Zone: event.Zone,
      Event: event.Event,
      Code: event.Code || '',
      Observations: event.Observations || ''
    }));

    const weeklyTotal = schedule ? calculateWeeklyTotal(
      schedule.patrols_per_day,
      schedule.weekend_patrols_per_day,
      schedule.patrol_days
    ) : 0;

    console.log(`✅ Report data retrieved:`, {
      posts: transformedSummary.length,
      events: transformedEvents.length,
      guardReports: reportData.guardReports.length,
      overallPerformance: `${reportData.metadata.overallPerformance}%`,
      dataSource: reportData.metadata.dataSource || 'Database'
    });

    return res.status(200).json({
      success: true,
      client: {
        id: clientInfo.id,
        name: reportData.metadata.clientName || clientInfo.name
      },
      period: { 
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
        daysInRange: reportData.metadata.daysInRange || 
                    dayjs(effectiveEndDate).diff(dayjs(effectiveStartDate), 'day') 
      },
      shift: {
        requested: shiftType,
        effective: effectiveShiftType,
        description: getShiftDescription(effectiveShiftType)
      },
      schedule: schedule ? {
        patrolsPerDay: schedule.patrols_per_day,
        patrolDays: schedule.patrol_days,
        shiftType: schedule.shift_type,
        weekendPatrols: schedule.weekend_patrols_per_day,
        weeklyTotal: weeklyTotal,
        hasCustomSchedule: schedule.has_custom_schedule,
        configSource: schedule.config_source
      } : null,
      calculations: {
        totalExpectedPatrols: reportData.metadata.totalExpectedPatrols,
        totalCompleted: reportData.metadata.totalCompleted,
        completionRate: `${reportData.metadata.overallPerformance}%`,
        performanceRating: getPerformanceRating(reportData.metadata.overallPerformance),
        expectedPerZone: reportData.posts.length > 0 ? reportData.posts[0].Expected : 0,
        validZoneCount: reportData.posts.length,
        dataSource: reportData.metadata.dataSource || 'Database'
      },
      incidents: {
        count: reportData.guardReports.length,
        reports: reportData.guardReports.map(report => ({
          id: report.id,
          date: report.date,
          zone: report.zone,
          details: report.report
        }))
      },
      summary: transformedSummary,
      events: transformedEvents,
      guardReports: reportData.guardReports,
      dataQuality: reportData.metadata.dataQuality,
      metadata: {
        generatedAt: reportData.metadata.generatedAt || new Date(),
        success: true,
        notes: "Data synchronized with reportModel.js, reportService.js, and pdfService.js"
      },
      pdfOptions: {
        available: true,
        services: {
          reportService: "/api/reports/weekly/pdf?clientName=X&startDate=Y&endDate=Z",
          pdfService: "/api/reports/dashboard-pdf?clientName=X&startDate=Y&endDate=Z",
          comprehensive: "/api/reports/comprehensive-pdf?clientName=X&startDate=Y&endDate=Z&type=dashboard"
        }
      }
    });

  } catch (error) {
    console.error("❌ Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching report data",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * 🔄 Get available shifts and schedule configuration
 */
const getClientShifts = async (req, res) => {
  try {
    const { client } = req.query;

    if (!client) {
      return res.status(400).json({
        success: false,
        message: "Client parameter is required",
      });
    }

    const clientInfo = await getClientInfo(client);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    const schedule = await getClientSchedule(clientInfo.id);
    const availableShifts = JSON.parse(JSON.stringify(AVAILABLE_SHIFTS));

    // Set default shift based on schedule
    if (schedule?.shift_type) {
      const normalizedShift = schedule.shift_type.toLowerCase().replace(/\s+/g, "_");
      let defaultShift = "Day/Night";
      
      if (normalizedShift.includes("day") && normalizedShift.includes("night")) {
        defaultShift = "Day/Night";
      } else if (normalizedShift.includes("night")) {
        defaultShift = "Night";
      } else if (normalizedShift.includes("day")) {
        defaultShift = "Day";
      }
      
      availableShifts.forEach(shift => {
        shift.default = (shift.value === defaultShift);
      });
    } else {
      availableShifts[0].default = true;
    }

    const weeklyTotal = schedule ? calculateWeeklyTotal(
      schedule.patrols_per_day,
      schedule.weekend_patrols_per_day,
      schedule.patrol_days
    ) : 0;

    res.json({
      success: true,
      clientId: clientInfo.id,
      clientName: clientInfo.name,
      schedule: schedule ? {
        patrolsPerDay: schedule.patrols_per_day,
        patrolDays: schedule.patrol_days,
        scheduleType: schedule.schedule_type,
        weekendPatrols: schedule.weekend_patrols_per_day,
        weeklyTotal: weeklyTotal,
        shiftType: schedule.shift_type,
        customIntervalDays: schedule.custom_interval_days,
        hasCustomSchedule: schedule.has_custom_schedule,
        configSource: schedule.config_source,
        createdAt: schedule.created_at,
        updatedAt: schedule.updated_at
      } : null,
      availableShifts,
      hasSchedule: !!schedule,
      pdfServices: {
        reportService: "Weekly Patrol Report",
        pdfService: "Dashboard Report with Incidents"
      }
    });

  } catch (error) {
    console.error("❌ Error getting client shifts:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching client shift information",
      error: error.message,
    });
  }
};

/**
 * 🧪 Test PDF services
 */
const testPDFServices = async (req, res) => {
  try {
    const { clientName, startDate, endDate } = req.query;

    console.log("🧪 [CONTROLLER] Test PDF Services:", { clientName, startDate, endDate });

    if (!clientName) {
      return res.status(400).json({
        success: false,
        message: "Client Name is required for testing"
      });
    }

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: `Client not found: ${clientName}`
      });
    }

    const testStartDate = startDate || dayjs().subtract(7, 'day').format('YYYY-MM-DD');
    const testEndDate = endDate || dayjs().format('YYYY-MM-DD');

    // Test both PDF services
    const results = {
      reportService: { success: false, size: 0, error: null },
      pdfService: { success: false, size: 0, error: null }
    };

    // Test reportService.js
    try {
      const reportServicePDF = await generateWeeklyReportPDF(
        clientInfo.id,
        testStartDate,
        testEndDate
      );
      results.reportService = {
        success: !!reportServicePDF,
        size: reportServicePDF ? reportServicePDF.length : 0,
        service: 'reportService.js'
      };
    } catch (error) {
      results.reportService.error = error.message;
    }

    // Test pdfService.js
    try {
      const pdfServiceResult = await generatePDFReport({
        clientId: clientInfo.id,
        clientName: clientInfo.name,
        startDate: testStartDate,
        endDate: testEndDate
      });
      results.pdfService = {
        success: pdfServiceResult.success,
        size: pdfServiceResult.pdfBuffer ? pdfServiceResult.pdfBuffer.length : 0,
        service: 'pdfService.js',
        metadata: pdfServiceResult.metadata
      };
    } catch (error) {
      results.pdfService.error = error.message;
    }

    res.json({
      success: true,
      client: {
        id: clientInfo.id,
        name: clientInfo.name
      },
      period: {
        startDate: testStartDate,
        endDate: testEndDate
      },
      pdfServices: results,
      recommendations: [
        results.reportService.success ? "✅ reportService.js is working" : "❌ reportService.js failed",
        results.pdfService.success ? "✅ pdfService.js is working" : "❌ pdfService.js failed",
        "Use /api/reports/weekly/pdf for weekly reports",
        "Use /api/reports/dashboard-pdf for dashboard reports",
        "Use /api/reports/comprehensive-pdf?type=dashboard for comprehensive reports"
      ],
      endpoints: {
        weeklyReport: `/api/reports/weekly/pdf?clientName=${encodeURIComponent(clientName)}&startDate=${testStartDate}&endDate=${testEndDate}`,
        dashboardPDF: `/api/reports/dashboard-pdf?clientName=${encodeURIComponent(clientName)}&startDate=${testStartDate}&endDate=${testEndDate}`,
        comprehensivePDF: `/api/reports/comprehensive-pdf?clientName=${encodeURIComponent(clientName)}&startDate=${testStartDate}&endDate=${testEndDate}&type=dashboard`
      }
    });

  } catch (error) {
    console.error("❌ Test PDF Services Error:", error);
    res.status(500).json({
      success: false,
      message: "Test failed",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * 🧪 Test report data
 */
const testReportData = async (req, res) => {
  try {
    const { clientName, startDate, endDate } = req.query;

    console.log("🧪 [CONTROLLER] Test Report Request:", { clientName, startDate, endDate });

    if (!clientName) {
      return res.status(400).json({
        success: false,
        message: "Client Name is required for testing"
      });
    }

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: `Client not found: ${clientName}`
      });
    }

    const testStartDate = startDate || dayjs().subtract(7, 'day').format('YYYY-MM-DD');
    const testEndDate = endDate || dayjs().format('YYYY-MM-DD');

    // ✅ Use synchronized reportModel.js
    const reportData = await fetchWeeklyReport(
      clientInfo.id,
      testStartDate,
      testEndDate
    );

    const schedule = await getClientSchedule(clientInfo.id);

    const analysis = {
      client: {
        id: clientInfo.id,
        name: clientInfo.name,
        valid: true
      },
      dataStructure: {
        hasPosts: Array.isArray(reportData.posts),
        hasEvents: Array.isArray(reportData.events),
        hasGuardReports: Array.isArray(reportData.guardReports),
        hasMetadata: !!reportData.metadata,
        success: reportData.metadata?.success !== false
      },
      dataContent: {
        postsCount: reportData.posts?.length || 0,
        eventsCount: reportData.events?.length || 0,
        guardReportsCount: reportData.guardReports?.length || 0,
        postsSample: reportData.posts?.slice(0, 2).map(p => ({
          zone: p.SecurityPost,
          completed: p.Completed,
          expected: p.Expected,
          performance: p.Percentage
        })) || [],
        eventsSample: reportData.events?.slice(0, 2) || [],
        guardReportsSample: reportData.guardReports?.slice(0, 1) || []
      },
      schedule: schedule ? {
        configured: true,
        patrolsPerDay: schedule.patrols_per_day,
        weekendPatrols: schedule.weekend_patrols_per_day,
        patrolDays: schedule.patrol_days,
        shiftType: schedule.shift_type,
        hasCustomSchedule: schedule.has_custom_schedule
      } : { configured: false },
      metadata: {
        clientName: reportData.metadata?.clientName,
        overallPerformance: reportData.metadata?.overallPerformance,
        dataSource: reportData.metadata?.dataSource || 'Database',
        dataQuality: reportData.metadata?.dataQuality || {}
      },
      pdfServices: {
        available: true,
        reportService: "Weekly Patrol Report",
        pdfService: "Dashboard with Incidents"
      }
    };

    const recommendations = [];
    if (analysis.dataContent.postsCount === 0) {
      recommendations.push("⚠️ No data found - check client name and date range");
    }
    
    if (analysis.dataStructure.success) {
      recommendations.push("✅ Data fetch successful using synchronized reportModel.js");
    } else {
      recommendations.push("❌ Data fetch failed");
    }
    
    if (analysis.metadata.dataQuality?.isValid) {
      recommendations.push("✅ Data quality validation passed");
    } else if (analysis.metadata.dataQuality?.issues) {
      recommendations.push("⚠️ Data quality issues detected");
    }
    
    if (schedule?.has_custom_schedule) {
      recommendations.push("✅ Using custom schedule from " + schedule.config_source);
    } else {
      recommendations.push("ℹ️ Using default schedule");
    }

    res.json({
      success: true,
      testTimestamp: new Date().toISOString(),
      client: analysis.client,
      period: { startDate: testStartDate, endDate: testEndDate },
      analysis,
      recommendations,
      pdfEndpoints: {
        weekly: `/api/reports/weekly/pdf?clientName=${encodeURIComponent(clientName)}&startDate=${testStartDate}&endDate=${testEndDate}`,
        dashboard: `/api/reports/dashboard-pdf?clientName=${encodeURIComponent(clientName)}&startDate=${testStartDate}&endDate=${testEndDate}`,
        test: `/api/reports/test-pdf-services?clientName=${encodeURIComponent(clientName)}&startDate=${testStartDate}&endDate=${testEndDate}`
      },
      notes: "Using synchronized data model with API/Database integration"
    });

  } catch (error) {
    console.error("❌ Test Error:", error);
    res.status(500).json({
      success: false,
      message: "Test failed",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * 🧪 Test report generation
 */
const testReportGeneration = async (req, res) => {
  try {
    const { clientName } = req.params;
    const { startDate, endDate } = req.body;

    if (!clientName) {
      return res.status(400).json({
        success: false,
        message: "Client Name is required",
      });
    }

    console.log(`\n🧪 [CONTROLLER] Test PDF Generation:`, { clientName, startDate, endDate });

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    const testStartDate = startDate || dayjs().subtract(7, 'day').format('YYYY-MM-DD');
    const testEndDate = endDate || dayjs().format('YYYY-MM-DD');

    console.log(`   Period: ${testStartDate} → ${testEndDate}`);

    // Test data fetch
    const reportData = await fetchWeeklyReport(
      clientInfo.id,
      testStartDate,
      testEndDate
    );

    // Test both PDF services
    let pdfTestReport = { success: false, message: "Not attempted" };
    let pdfTestDashboard = { success: false, message: "Not attempted" };
    
    try {
      const pdfBuffer = await generateWeeklyReportPDF(
        clientInfo.id,
        testStartDate,
        testEndDate
      );
      pdfTestReport = {
        success: !!pdfBuffer,
        message: pdfBuffer ? "PDF generated successfully" : "No data for PDF generation",
        size: pdfBuffer ? pdfBuffer.length : 0,
        service: 'reportService.js (weekly report)'
      };
    } catch (pdfError) {
      pdfTestReport = {
        success: false,
        message: pdfError.message,
        service: 'reportService.js'
      };
    }

    try {
      const pdfResult = await generatePDFReport({
        clientId: clientInfo.id,
        clientName: clientInfo.name,
        startDate: testStartDate,
        endDate: testEndDate
      });
      pdfTestDashboard = {
        success: pdfResult.success,
        message: pdfResult.success ? "Dashboard PDF generated" : "Dashboard PDF failed",
        size: pdfResult.pdfBuffer ? pdfResult.pdfBuffer.length : 0,
        service: 'pdfService.js (dashboard)',
        metadata: pdfResult.metadata
      };
    } catch (pdfError) {
      pdfTestDashboard = {
        success: false,
        message: pdfError.message,
        service: 'pdfService.js'
      };
    }

    const recommendations = [];
    if (reportData.posts?.length === 0) {
      recommendations.push("⚠️ No data found for the specified period");
    }
    if (!pdfTestReport.success) {
      recommendations.push("❌ Weekly PDF generation failed");
    }
    if (!pdfTestDashboard.success) {
      recommendations.push("❌ Dashboard PDF generation failed");
    }
    
    if (reportData.metadata.success !== false) {
      recommendations.push("✅ Data model working correctly");
    }
    
    if (recommendations.length === 0) {
      recommendations.push("✅ All tests passed - both PDF services working");
    }

    res.json({
      success: true,
      testDetails: {
        client: {
          id: clientInfo.id,
          name: clientInfo.name
        },
        period: {
          startDate: testStartDate,
          endDate: testEndDate
        },
        dataFetch: {
          success: reportData.metadata.success !== false,
          postsCount: reportData.posts?.length || 0,
          eventsCount: reportData.events?.length || 0,
          guardReportsCount: reportData.guardReports?.length || 0,
          dataQuality: reportData.metadata.dataQuality,
          dataSource: reportData.metadata.dataSource || 'Database'
        },
        pdfGeneration: {
          reportService: pdfTestReport,
          pdfService: pdfTestDashboard
        },
        recommendations
      }
    });

  } catch (error) {
    console.error("❌ Error testing report generation:", error);
    res.status(500).json({
      success: false,
      message: "Error testing report generation",
      error: error.message
    });
  }
};

/**
 * 📊 Get comprehensive client report
 */
const getComprehensiveClientReport = async (req, res) => {
  try {
    const { clientName } = req.params;
    const { 
      period = 'last7days',
      customStart,
      customEnd
    } = req.query;

    if (!clientName) {
      return res.status(400).json({
        success: false,
        message: "Client Name is required",
      });
    }

    let startDate, endDate;
    const today = new Date();
    
    switch (period) {
      case 'last7days':
        startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        endDate = today;
        break;
      case 'last30days':
        startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        endDate = today;
        break;
      case 'last90days':
        startDate = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
        endDate = today;
        break;
      case 'custom':
        if (!customStart || !customEnd) {
          return res.status(400).json({
            success: false,
            message: "Custom period requires customStart and customEnd parameters"
          });
        }
        startDate = new Date(customStart);
        endDate = new Date(customEnd);
        break;
      default:
        startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        endDate = today;
    }

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    const schedule = await getClientSchedule(clientInfo.id);
    
    // ✅ Use synchronized reportModel.js
    const reportData = await fetchWeeklyReport(
      clientInfo.id,
      startDateStr,
      endDateStr
    );

    if (!reportData.metadata.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch report data",
        error: reportData.metadata.error?.message || "Unknown error"
      });
    }

    // Test both PDF services
    const reportServicePDF = await generateWeeklyReportPDF(
      clientInfo.id,
      startDateStr,
      endDateStr
    );

    const pdfServiceResult = await generatePDFReport({
      clientId: clientInfo.id,
      clientName: clientInfo.name,
      startDate: startDateStr,
      endDate: endDateStr
    });

    res.json({
      success: true,
      client: {
        id: clientInfo.id,
        name: clientInfo.name
      },
      period: {
        type: period,
        start: startDateStr,
        end: endDateStr,
        days: Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
      },
      schedule: schedule ? {
        patrolsPerDay: schedule.patrols_per_day,
        shiftType: schedule.shift_type,
        patrolDays: schedule.patrol_days,
        weekendPatrols: schedule.weekend_patrols_per_day,
        weeklyTotal: calculateWeeklyTotal(
          schedule.patrols_per_day,
          schedule.weekend_patrols_per_day,
          schedule.patrol_days
        )
      } : null,
      data: {
        postsCount: reportData.posts?.length || 0,
        eventsCount: reportData.events?.length || 0,
        guardReportsCount: reportData.guardReports?.length || 0,
        hasData: (reportData.posts?.length > 0) || (reportData.events?.length > 0),
        overallPerformance: reportData.metadata.overallPerformance,
        dataQuality: reportData.metadata.dataQuality,
        dataSource: reportData.metadata.dataSource || 'Database'
      },
      pdfServices: {
        reportService: {
          available: !!reportServicePDF,
          size: reportServicePDF ? reportServicePDF.length : 0,
          endpoint: `/api/reports/weekly/pdf?clientName=${encodeURIComponent(clientName)}&startDate=${startDateStr}&endDate=${endDateStr}`,
          description: "Weekly Patrol Report"
        },
        pdfService: {
          available: pdfServiceResult.success,
          size: pdfServiceResult.pdfBuffer ? pdfServiceResult.pdfBuffer.length : 0,
          endpoint: `/api/reports/dashboard-pdf?clientName=${encodeURIComponent(clientName)}&startDate=${startDateStr}&endDate=${endDateStr}`,
          description: "Dashboard Report with Incidents",
          metadata: pdfServiceResult.metadata
        },
        comprehensive: {
          endpoint: `/api/reports/comprehensive-pdf?clientName=${encodeURIComponent(clientName)}&startDate=${startDateStr}&endDate=${endDateStr}&type=dashboard`,
          description: "Choose between dashboard or weekly report"
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Error generating comprehensive report:", error);
    res.status(500).json({
      success: false,
      message: "Error generating comprehensive report",
      error: error.message,
    });
  }
};

/**
 * 📈 Get client performance trends
 */
const getClientPerformanceTrends = async (req, res) => {
  try {
    const { clientName } = req.params;
    const { months = 6 } = req.query;

    if (!clientName) {
      return res.status(400).json({
        success: false,
        message: "Client Name is required",
      });
    }

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    const schedule = await getClientSchedule(clientInfo.id);
    const trends = [];
    const today = new Date();
    const monthsInt = parseInt(months);
    
    for (let i = 0; i < monthsInt; i++) {
      const monthDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
      
      // ✅ Use synchronized reportModel.js
      const monthData = await fetchWeeklyReport(
        clientInfo.id,
        monthStart.toISOString().split('T')[0],
        monthEnd.toISOString().split('T')[0]
      );

      const totalExpected = monthData.metadata?.totalExpectedPatrols || 0;
      const totalCompleted = monthData.metadata?.totalCompleted || 0;
      const performanceRate = monthData.metadata?.overallPerformance || 0;
      const rating = getPerformanceRating(performanceRate);

      trends.push({
        month: monthDate.toLocaleString('default', { month: 'long', year: 'numeric' }),
        period: `${monthStart.toISOString().split('T')[0]} to ${monthEnd.toISOString().split('T')[0]}`,
        expected: totalExpected,
        completed: totalCompleted,
        performanceRate: performanceRate,
        rating: rating,
        postsCount: monthData.posts?.length || 0,
        expectedPerZone: monthData.posts.length > 0 ? monthData.posts[0].Expected : 0,
        dataQuality: monthData.metadata.dataQuality,
        dataSource: monthData.metadata.dataSource || 'Database'
      });
    }

    trends.reverse();

    res.json({
      success: true,
      client: {
        id: clientInfo.id,
        name: clientInfo.name
      },
      period: {
        months: monthsInt,
        start: trends[0]?.period.split(' to ')[0],
        end: trends[trends.length - 1]?.period.split(' to ')[1]
      },
      schedule: schedule ? {
        patrolsPerDay: schedule.patrols_per_day,
        shiftType: schedule.shift_type,
        weekendPatrols: schedule.weekend_patrols_per_day
      } : null,
      trends,
      summary: {
        averagePerformance: (trends.reduce((sum, month) => sum + parseFloat(month.performanceRate), 0) / trends.length).toFixed(1),
        totalCompleted: trends.reduce((sum, month) => sum + month.completed, 0),
        bestMonth: trends.reduce((best, month) => 
          parseFloat(month.performanceRate) > parseFloat(best.performanceRate) ? month : trends[0]
        ),
        worstMonth: trends.reduce((worst, month) => 
          parseFloat(month.performanceRate) < parseFloat(worst.performanceRate) ? month : trends[0]
        )
      },
      pdfServices: {
        available: true,
        endpoints: {
          monthlyReport: `/api/reports/weekly/pdf?clientName=${encodeURIComponent(clientName)}&startDate=${trends[0]?.period.split(' to ')[0]}&endDate=${trends[trends.length - 1]?.period.split(' to ')[1]}`,
          dashboardReport: `/api/reports/dashboard-pdf?clientName=${encodeURIComponent(clientName)}&startDate=${trends[0]?.period.split(' to ')[0]}&endDate=${trends[trends.length - 1]?.period.split(' to ')[1]}`
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Error getting performance trends:", error);
    res.status(500).json({
      success: false,
      message: "Error getting performance trends",
      error: error.message,
    });
  }
};

/**
 * 👥 Get all clients list
 */
const getAllClientsList = async (req, res) => {
  try {
    const clients = await getAllClients();
    
    res.json({
      success: true,
      count: clients.length,
      clients: clients.map(client => ({
        id: client.id,
        name: client.name
      })),
      pdfServicesInfo: {
        reportService: "Weekly patrol report PDF",
        pdfService: "Dashboard report with incidents PDF",
        endpoints: {
          weeklyPDF: "/api/reports/weekly/pdf?clientName={name}&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD",
          dashboardPDF: "/api/reports/dashboard-pdf?clientName={name}&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD",
          comprehensivePDF: "/api/reports/comprehensive-pdf?clientName={name}&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&type=dashboard"
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Error getting clients list:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching clients list",
      error: error.message
    });
  }
};

/**
 * 🔍 Search clients by name
 */
const searchClients = async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search query must be at least 2 characters long"
      });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input("searchQuery", sql.NVarChar, `%${query}%`)
      .query(`
        SELECT cue_iid AS id, cue_cnombre AS name
        FROM [_Datos].[dbo].[m_cuentas] 
        WHERE cue_cnombre LIKE @searchQuery
          AND cue_cnombre IS NOT NULL
          AND cue_cnombre != ''
        ORDER BY cue_cnombre
      `);

    res.json({
      success: true,
      count: result.recordset.length,
      clients: result.recordset,
      pdfServices: {
        note: "Use client names with /api/reports/weekly/pdf or /api/reports/dashboard-pdf endpoints",
        example: `/api/reports/dashboard-pdf?clientName=${encodeURIComponent(query)}&startDate=2024-01-01&endDate=2024-01-08`
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Error searching clients:", error);
    res.status(500).json({
      success: false,
      message: "Error searching clients",
      error: error.message
    });
  }
};

/**
 * 🧪 Debug performance calculations
 */
const debugPerformanceCalc = async (req, res) => {
  try {
    const { clientName, startDate, endDate } = req.query;
    
    if (!clientName) {
      return res.status(400).json({
        success: false,
        message: "clientName is required"
      });
    }

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // ✅ Use synchronized reportModel.js
    const reportData = await fetchWeeklyReport(
      clientInfo.id,
      startDate || dayjs().subtract(7, 'day').format('YYYY-MM-DD'),
      endDate || dayjs().format('YYYY-MM-DD')
    );
    
    const debug = {
      client: reportData.metadata.clientName,
      calculationMethod: "Synchronized with reportModel.js",
      totalExpected: reportData.metadata.totalExpectedPatrols,
      totalCompleted: reportData.metadata.totalCompleted,
      completionRate: `${reportData.metadata.overallPerformance}%`,
      performanceRating: getPerformanceRating(reportData.metadata.overallPerformance),
      expectedPerZone: reportData.posts.length > 0 ? reportData.posts[0].Expected : 0,
      validZoneCount: reportData.posts.length,
      zones: reportData.posts.slice(0, 3).map(post => ({
        name: post.SecurityPost,
        completed: post.Completed,
        expected: post.Expected,
        performance: `${post.Performance}%`,
        calculation: `${post.Completed} / ${post.Expected} × 100 = ${post.Performance}%`
      })),
      events: reportData.events.slice(0, 3).map(e => ({
        date: e.Date,
        zone: e.Zone,
        event: e.Event
      })),
      guardReports: reportData.guardReports.slice(0, 2).map(r => ({
        date: r.date,
        zone: r.zone,
        report: r.report.substring(0, 100) + '...'
      })),
      dataQuality: reportData.metadata.dataQuality,
      dataSource: reportData.metadata.dataSource || 'Database',
      pdfServices: {
        reportService: "Generates weekly patrol reports",
        pdfService: "Generates dashboard reports with incidents",
        endpoints: {
          weekly: `/api/reports/weekly/pdf?clientName=${encodeURIComponent(clientName)}&startDate=${startDate}&endDate=${endDate}`,
          dashboard: `/api/reports/dashboard-pdf?clientName=${encodeURIComponent(clientName)}&startDate=${startDate}&endDate=${endDate}`
        }
      }
    };
    
    res.json({ 
      success: true, 
      debug,
      notes: "Using synchronized data model with unified calculations and dual PDF services"
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * 🏠 Health check endpoint
 */
const healthCheck = async (req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request().query('SELECT 1 as test');
    
    // Test data model
    const testData = await fetchWeeklyReport(1001, 
      dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
      dayjs().format('YYYY-MM-DD')
    );
    
    res.json({
      success: true,
      message: "Report controller is healthy - DUAL PDF SERVICES ✅",
      timestamp: new Date().toISOString(),
      database: "Connected",
      services: {
        pdfService: "reportService.js (weekly reports)",
        pdfService2: "pdfService.js (dashboard reports)",
        dataModel: "reportModel.js (synchronized)",
        dataFetch: testData.metadata.success ? "Working" : "Failed"
      },
      pdfServices: {
        reportService: "Weekly patrol report generation",
        pdfService: "Dashboard report with incident details",
        endpoints: {
          weeklyPDF: "/api/reports/weekly/pdf?clientName=X&startDate=Y&endDate=Z",
          dashboardPDF: "/api/reports/dashboard-pdf?clientName=X&startDate=Y&endDate=Z",
          comprehensivePDF: "/api/reports/comprehensive-pdf?clientName=X&startDate=Y&endDate=Z&type=dashboard",
          testPDF: "/api/reports/test-pdf-services?clientName=X&startDate=Y&endDate=Z"
        }
      },
      synchronization: {
        dataFlow: "Controller → reportModel.js → API/Database → reportService.js/pdfService.js → PDF",
        consistency: "All modules use same data source and calculations",
        apiIntegration: process.env.USE_BMSECURITY_API === 'true' ? "Enabled" : "Disabled",
        fallback: "Automatic database fallback if API fails"
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Health check failed",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * 📋 Get Weekly Report - Alias for getPatrolReport
 */
const getWeeklyReport = async (req, res) => {
  try {
    console.log("📋 [CONTROLLER] Weekly Report Alias - Using getPatrolReport...");
    return await getPatrolReport(req, res);
  } catch (error) {
    console.error("❌ Error in weekly report alias:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching weekly report",
      error: error.message,
    });
  }
};

// =====================================================
// 🎯 EXPORT HELPER FUNCTIONS
// =====================================================

// Export all functions
module.exports = {
  // Main endpoints
  getWeeklyReportPDF,
  getDashboardPDF,          // NEW: PDF Service endpoint
  getComprehensivePDF,      // NEW: Comprehensive PDF with choice
  getPatrolReport,
  getWeeklyReport,
  getClientShifts,
  
  // Testing endpoints
  testReportData,
  testReportGeneration,
  testPDFServices,          // NEW: Test both PDF services
  
  // Client endpoints
  getComprehensiveClientReport,
  getClientPerformanceTrends,
  getAllClientsList,
  searchClients,
  
  // Debug endpoints
  debugPerformanceCalc,
  healthCheck,
  
  // Helper functions
  calculateWeeklyTotal,
  getPerformanceRating,
  getPerformanceStatus,
  getShiftDescription
};

// Keep default export for compatibility
module.exports.default = {
  // Main endpoints
  getWeeklyReportPDF,
  getDashboardPDF,          // NEW: PDF Service endpoint
  getComprehensivePDF,      // NEW: Comprehensive PDF with choice
  getPatrolReport,
  getWeeklyReport,
  getClientShifts,
  
  // Testing endpoints
  testReportData,
  testReportGeneration,
  testPDFServices,          // NEW: Test both PDF services
  
  // Client endpoints
  getComprehensiveClientReport,
  getClientPerformanceTrends,
  getAllClientsList,
  searchClients,
  
  // Debug endpoints
  debugPerformanceCalc,
  healthCheck,
  
  // Helper functions
  calculateWeeklyTotal,
  getPerformanceRating,
  getPerformanceStatus,
  getShiftDescription
};