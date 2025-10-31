import { fetchWeeklyReport } from "../models/reportModel.js";
import { generateWeeklyReportPDF } from "../service/pdfService.js";
import { getClientSchedule } from "../scripts/managePatrolSchedules.js";
import { sql, poolPromise } from "../config/database.js";

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

/**
 * 🔧 Helper: Get client ID from name
 */
async function getClientIdFromName(clientName) {
  const pool = await poolPromise;
  try {
    const result = await pool.request()
      .input("clientName", sql.NVarChar, clientName)
      .query(`
        SELECT cue_iid AS id 
        FROM [_Datos].[dbo].[m_cuentas] 
        WHERE cue_cnombre = @clientName
      `);
    
    return result.recordset.length > 0 ? result.recordset[0].id : null;
  } catch (error) {
    console.error("❌ Error getting client ID:", error);
    return null;
  }
}

/**
 * 📊 Get patrol report data with automatic schedule integration
 * ✅ NO HARDCODED EXPECTED PATROLS - Uses patrol schedule
 */
export const getPatrolReport = async (req, res) => {
  try {
    const client = req.query.client || req.body.client;
    const startDateTime = req.query.startDateTime || req.body.startDateTime;
    const endDateTime = req.query.endDateTime || req.body.endDateTime;
    const shiftType = req.query.shiftType || req.body.shiftType || "Day/Night";

    if (!client || !startDateTime || !endDateTime) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: client, startDateTime, and endDateTime.",
      });
    }

    console.log(`\n📊 [Patrol Report Request]`);
    console.log(`   Client: ${client}`);
    console.log(`   Period: ${startDateTime} → ${endDateTime}`);
    console.log(`   Requested Shift: ${shiftType}`);

    // Fetch report data - AUTOMATICALLY calculates expected patrols from schedule
    const reportData = await fetchWeeklyReport(
      client,
      startDateTime,
      endDateTime,
      shiftType
    );

    if (!reportData.success) {
      console.error(`❌ Report fetch failed: ${reportData.message}`);
      return res.status(500).json({
        success: false,
        message: reportData.message || "Failed to fetch report data",
        sqlMessage: reportData.sqlMessage,
      });
    }

    // Check if we have any data
    const hasData = 
      (reportData.summary && reportData.summary.length > 0) ||
      (reportData.events && reportData.events.length > 0);

    if (!hasData) {
      console.warn(`⚠️ No data found for ${client}`);
      return res.status(404).json({
        success: false,
        message: `No patrol data found for ${client} in the specified period.`,
        details: {
          client,
          period: { startDateTime, endDateTime },
          shift: reportData.metadata?.shift || { requested: shiftType }
        }
      });
    }

    console.log(`✅ Report data retrieved successfully`);
    console.log(`   Summary rows: ${reportData.summary.length}`);
    console.log(`   Event rows: ${reportData.events.length}`);
    console.log(`   Effective shift: ${reportData.metadata?.shift?.description}`);
    console.log(`   Expected patrols (from schedule): ${reportData.metadata?.calculations?.totalExpectedPatrols}`);
    console.log(`   Schedule found: ${reportData.metadata?.schedule ? 'Yes' : 'No'}`);

    // Return enhanced response with schedule metadata
    return res.status(200).json({
      success: true,
      client,
      clientId: reportData.metadata?.clientId || null,
      period: { 
        startDateTime, 
        endDateTime,
        daysInRange: reportData.metadata?.calculations?.daysInRange
      },
      shift: reportData.metadata?.shift || {
        requested: shiftType,
        effective: shiftType,
        description: "Unknown"
      },
      schedule: reportData.metadata?.schedule || null,
      calculations: reportData.metadata?.calculations || null,
      incident: reportData.incident,
      summary: reportData.summary,
      events: reportData.events,
    });

  } catch (error) {
    console.error("❌ Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching report data",
      error: error.message,
    });
  }
};

/**
 * 🧾 Generate and download PDF report with automatic schedule integration
 * ✅ PDF uses schedule-based expected patrols
 */
export const getWeeklyReportPDF = async (req, res) => {
  try {
    const client = req.query.client;
    const startDateTime = req.query.startDateTime;
    const endDateTime = req.query.endDateTime;
    const shiftType = req.query.shiftType || "Day/Night";

    if (!client || !startDateTime || !endDateTime) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: client, startDateTime, and endDateTime.",
      });
    }

    console.log(`\n📄 [PDF Report Request]`);
    console.log(`   Client: ${client}`);
    console.log(`   Period: ${startDateTime} → ${endDateTime}`);
    console.log(`   Shift: ${shiftType}`);

    // Get client ID
    const clientId = isNaN(client) 
      ? await getClientIdFromName(client) 
      : parseInt(client);

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Could not determine client ID. Please check client name or ID.",
      });
    }

    console.log(`   Client ID: ${clientId}`);

    // Generate PDF - pdfService will automatically fetch schedule and use it
    const pdfBuffer = await generateWeeklyReportPDF(
      clientId,
      client,
      startDateTime,
      endDateTime,
      shiftType
    );

    if (!pdfBuffer) {
      return res.status(404).json({
        success: false,
        message: `No data available for PDF generation for ${client} in the specified period.`,
      });
    }

    // Prepare safe filename with length safeguard
    const safeClientName = client.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
    const safeShiftType = shiftType.replace(/\//g, "_").replace(/\s+/g, "_");
    const filename = `Patrol_Report_${safeClientName}_${safeShiftType}_${startDateTime}_to_${endDateTime}.pdf`;

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send PDF
    res.send(pdfBuffer);

    console.log(`✅ PDF sent: ${filename} (${pdfBuffer.length} bytes)`);

  } catch (error) {
    console.error("❌ PDF generation error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating PDF report",
      error: error.message,
    });
  }
};

/**
 * 🔄 Get available shifts and schedule configuration for a client
 */
export const getClientShifts = async (req, res) => {
  try {
    const client = req.query.client || req.params.client;

    if (!client) {
      return res.status(400).json({
        success: false,
        message: "Client parameter is required",
      });
    }

    // Get client ID
    const clientId = isNaN(client) 
      ? await getClientIdFromName(client) 
      : parseInt(client);

    if (!clientId) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    // Get client schedule configuration
    const schedule = await getClientSchedule(clientId);
    
    // Create a copy of available shifts to avoid mutation
    const availableShifts = JSON.parse(JSON.stringify(AVAILABLE_SHIFTS));

    // Mark the configured shift as default
    if (schedule?.shift_type) {
      const normalizedScheduleShift = schedule.shift_type.toLowerCase().replace(/\s+/g, "_");
      
      let defaultShift = "Day/Night";
      if (normalizedScheduleShift.includes("day") && normalizedScheduleShift.includes("night")) {
        defaultShift = "Day/Night";
      } else if (normalizedScheduleShift.includes("night")) {
        defaultShift = "Night";
      } else if (normalizedScheduleShift.includes("day")) {
        defaultShift = "Day";
      }
      
      const defaultOption = availableShifts.find(s => s.value === defaultShift);
      if (defaultOption) {
        defaultOption.default = true;
      }
    } else {
      // No schedule configured, default to Day/Night
      availableShifts[0].default = true;
    }

    res.json({
      success: true,
      clientId,
      clientName: client,
      schedule: schedule ? {
        patrolsPerDay: schedule.patrols_per_day,
        patrolDays: schedule.patrol_days,
        scheduleType: schedule.schedule_type,
        weekendPatrols: schedule.weekend_patrols_per_day,
        shiftType: schedule.shift_type,
        customIntervalDays: schedule.custom_interval_days,
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
 * 🧪 Test report generation and schedule integration for a client
 */
export const testReportGeneration = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { startDate, endDate, shiftType } = req.body;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required",
      });
    }

    console.log(`\n🧪 [Test Report Generation]`);
    console.log(`   Client ID: ${clientId}`);

    // Get client details with proper resource management
    const pool = await poolPromise;
    let clientResult;
    try {
      clientResult = await pool.request()
        .input('clientId', sql.Int, parseInt(clientId))
        .query(`
          SELECT 
            cue_iid AS ClientID,
            cue_cnombre AS ClientName
          FROM [_Datos].[dbo].[m_cuentas] 
          WHERE cue_iid = @clientId
        `);
    } finally {
      // Pool connection is managed automatically
    }

    if (clientResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    const client = clientResult.recordset[0];
    
    // Get schedule configuration
    const schedule = await getClientSchedule(parseInt(clientId));

    // Use provided dates or default to last 7 days
    const endDateValue = endDate || new Date().toISOString().split('T')[0];
    const startDateValue = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const testShiftType = shiftType || "Day/Night";

    console.log(`   Period: ${startDateValue} → ${endDateValue}`);
    console.log(`   Test Shift: ${testShiftType}`);
    console.log(`   Schedule: ${schedule ? 'Found' : 'Not configured'}`);

    // Test 1: Data fetch with schedule integration
    console.log(`\n🔍 Testing data fetch...`);
    const reportData = await fetchWeeklyReport(
      client.ClientName,
      startDateValue,
      endDateValue,
      testShiftType
    );

    // Test 2: PDF generation with schedule integration
    console.log(`\n📄 Testing PDF generation...`);
    let pdfTest = { success: false, message: "Not attempted" };
    try {
      const pdfBuffer = await generateWeeklyReportPDF(
        client.ClientID,
        client.ClientName,
        startDateValue,
        endDateValue,
        testShiftType
      );
      pdfTest = {
        success: !!pdfBuffer,
        message: pdfBuffer ? "PDF generated successfully" : "No data for PDF generation",
        size: pdfBuffer ? pdfBuffer.length : 0,
        sizeKB: pdfBuffer ? (pdfBuffer.length / 1024).toFixed(2) : 0
      };
    } catch (pdfError) {
      pdfTest = {
        success: false,
        message: pdfError.message,
        error: pdfError.stack
      };
    }

    console.log(`✅ Test completed`);

    // Build recommendations
    const recommendations = [];
    
    if (!schedule) {
      recommendations.push("⚠️ No patrol schedule configured - consider setting one up using managePatrolSchedules.js");
      recommendations.push("ℹ️ System is using default fallback (11 patrols/day)");
    }
    
    if (!reportData.success) {
      recommendations.push("❌ Data fetch failed - check database connectivity and table structure");
    }
    
    if (reportData.success && !reportData.summary?.length && !reportData.events?.length) {
      recommendations.push("⚠️ No data found - verify client has patrol records in the specified date range");
    }
    
    if (!pdfTest.success) {
      recommendations.push("❌ PDF generation failed - check pdfService.js configuration");
    }
    
    if (recommendations.length === 0) {
      recommendations.push("✅ All tests passed - system is working correctly");
      if (schedule) {
        recommendations.push(`✅ Using schedule: ${schedule.patrols_per_day} patrols/day, ${schedule.shift_type} shift`);
      }
    }

    // Enable compression for large responses
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    
    res.json({
      success: true,
      testDetails: {
        client: {
          id: client.ClientID,
          name: client.ClientName
        },
        period: {
          startDate: startDateValue,
          endDate: endDateValue,
          daysInRange: reportData.metadata?.calculations?.daysInRange
        },
        shift: {
          requested: testShiftType,
          effective: reportData.metadata?.shift?.effective || testShiftType,
          description: reportData.metadata?.shift?.description || "Unknown",
          configured: schedule?.shift_type || "Not configured"
        },
        schedule: schedule ? {
          configured: true,
          patrolsPerDay: schedule.patrols_per_day,
          weekendPatrols: schedule.weekend_patrols_per_day,
          patrolDays: schedule.patrol_days,
          scheduleType: schedule.schedule_type,
          shiftType: schedule.shift_type,
          customIntervalDays: schedule.custom_interval_days
        } : {
          configured: false,
          message: "No schedule configured for this client",
          fallback: "Using default 11 patrols/day"
        },
        dataFetch: {
          success: reportData.success,
          incidentCount: reportData.incident?.length || 0,
          summaryCount: reportData.summary?.length || 0,
          eventsCount: reportData.events?.length || 0,
          hasData: reportData.success && (
            (reportData.summary?.length > 0) || 
            (reportData.events?.length > 0)
          ),
          metadata: reportData.metadata ? {
            hasSchedule: reportData.metadata.calculations?.hasSchedule,
            totalExpectedPatrols: reportData.metadata.calculations?.totalExpectedPatrols,
            calculationMethod: reportData.metadata.calculations?.hasSchedule 
              ? "From patrol schedule" 
              : "Default fallback"
          } : null
        },
        pdfGeneration: pdfTest,
        testTimestamp: new Date().toISOString(),
        recommendations
      }
    });

  } catch (error) {
    console.error("❌ Error testing report generation:", error);
    res.status(500).json({
      success: false,
      message: "Error testing report generation",
      error: error.message,
      stack: error.stack
    });
  }
};

// 📝 Export both names for backward compatibility
export { getPatrolReport as getWeeklyReport };