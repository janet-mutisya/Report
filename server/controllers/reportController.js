// server/controllers/reportController.js - FULLY UPDATED & SYNCHRONIZED
import { generateWeeklyReportPDF } from "../service/reportService.js";
import { fetchWeeklyReport } from "../models/reportModel.js";
import { getClientSchedule } from "../scripts/managePatrolSchedules.js";
import { sql, poolPromise } from "../config/database.js";
import nodemailer from "nodemailer";
import dayjs from "dayjs";
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

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
/**
 * Get client info from database - FIXED VERSION
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
// 📊 MAIN CONTROLLER FUNCTIONS - FULLY SYNCHRONIZED
// =====================================================

/**
 * 📄 Generate and download PDF report
 * Uses: generateWeeklyReportPDF from reportService.js
 */
export const getWeeklyReportPDF = async (req, res) => {
  try {
    const { clientName, startDate, endDate, shiftType = "Day/Night" } = req.query;
    
    console.log("📄 [CONTROLLER] PDF Request:", { clientName, startDate, endDate, shiftType });

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
 * 📊 Get patrol report data
 * Uses: fetchWeeklyReport from reportModel.js
 */
export const getPatrolReport = async (req, res) => {
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
                    dayjs(effectiveEndDate).diff(dayjs(effectiveStartDate), 'day') + 1
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
        notes: "Data synchronized with reportModel.js and reportService.js"
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
export const getClientShifts = async (req, res) => {
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
      hasSchedule: !!schedule
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
 * 🧪 Test report data
 */
export const testReportData = async (req, res) => {
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
 * 🧪 Test PDF generation
 */
export const testReportGeneration = async (req, res) => {
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

    // Test PDF generation
    let pdfTest = { success: false, message: "Not attempted" };
    try {
      const pdfBuffer = await generateWeeklyReportPDF(
        clientInfo.id,
        testStartDate,
        testEndDate
      );
      pdfTest = {
        success: !!pdfBuffer,
        message: pdfBuffer ? "PDF generated successfully" : "No data for PDF generation",
        size: pdfBuffer ? pdfBuffer.length : 0,
        service: 'reportService.js (synchronized)'
      };
    } catch (pdfError) {
      pdfTest = {
        success: false,
        message: pdfError.message,
        service: 'reportService.js (synchronized)'
      };
    }

    const recommendations = [];
    if (reportData.posts?.length === 0) {
      recommendations.push("⚠️ No data found for the specified period");
    }
    if (!pdfTest.success) {
      recommendations.push("❌ PDF generation failed");
    }
    
    if (reportData.metadata.success !== false) {
      recommendations.push("✅ Data model working correctly");
    }
    
    if (recommendations.length === 0) {
      recommendations.push("✅ All tests passed");
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
        pdfGeneration: pdfTest,
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
export const getComprehensiveClientReport = async (req, res) => {
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

    // Test PDF generation
    const pdfBuffer = await generateWeeklyReportPDF(
      clientInfo.id,
      startDateStr,
      endDateStr
    );

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
      pdfAvailable: !!pdfBuffer,
      pdfSize: pdfBuffer ? pdfBuffer.length : 0,
      pdfService: 'reportService.js (synchronized)',
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
export const getClientPerformanceTrends = async (req, res) => {
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
export const getAllClientsList = async (req, res) => {
  try {
    const clients = await getAllClients();
    
    res.json({
      success: true,
      count: clients.length,
      clients: clients.map(client => ({
        id: client.id,
        name: client.name
      })),
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
export const searchClients = async (req, res) => {
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
export const debugPerformanceCalc = async (req, res) => {
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
      dataSource: reportData.metadata.dataSource || 'Database'
    };
    
    res.json({ 
      success: true, 
      debug,
      notes: "Using synchronized data model with unified calculations"
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
export const healthCheck = async (req, res) => {
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
      message: "Report controller is healthy - FULLY SYNCHRONIZED ✅",
      timestamp: new Date().toISOString(),
      database: "Connected",
      services: {
        pdfService: "reportService.js (synchronized)",
        dataModel: "reportModel.js (synchronized)",
        dataFetch: testData.metadata.success ? "Working" : "Failed"
      },
      synchronization: {
        dataFlow: "Controller → reportModel.js → API/Database → reportService.js → PDF",
        consistency: "All modules use same data source and calculations",
        apiIntegration: process.env.USE_BMSECURITY_API === 'true' ? "Enabled" : "Disabled",
        fallback: "Automatic database fallback if API fails"
      },
      endpoints: {
        pdf: "/api/reports/weekly/pdf?clientName=X&startDate=Y&endDate=Z",
        patrol: "/api/reports/patrol?client=X&startDate=Y&endDate=Z",
        test: "/api/reports/test?clientName=X&startDate=Y&endDate=Z",
        debug: "/api/reports/debug?clientName=X&startDate=Y&endDate=Z",
        health: "/api/reports/health",
        clients: "/api/reports/clients",
        search: "/api/reports/clients/search?query=X",
        trends: "/api/reports/trends/:clientName?months=6"
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
export const getWeeklyReport = async (req, res) => {
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

export {
  calculateWeeklyTotal,
  getPerformanceRating,
  getPerformanceStatus,
  getShiftDescription
};

// =====================================================
// 📦 DEFAULT EXPORT
// =====================================================

export default {
  // Main endpoints
  getWeeklyReportPDF,
  getPatrolReport,
  getWeeklyReport,
  getClientShifts,
  
  // Testing endpoints
  testReportData,
  testReportGeneration,
  
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