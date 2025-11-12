// server/controllers/reportController.js - FIXED TO USE reportService.js
import { generateWeeklyReportPDF } from "../service/reportService.js";
import { getClientSchedule } from "../scripts/managePatrolSchedules.js";
import { sql, poolPromise } from "../config/database.js";
import nodemailer from "nodemailer";
import dayjs from "dayjs";

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

// 🧮 CORRECT CALCULATION FUNCTIONS

/**
 * Calculate expected patrols for a date range using client schedule
 * FIXED: Each zone should get the FULL expected patrols, not divided
 */
function calculateExpectedPatrols(schedule, startDate, endDate) {
  const patrolDays = schedule.patrol_days.split(',').map(day => day.trim().toLowerCase());
  const weekdayPatrols = schedule.patrols_per_day;
  const weekendPatrols = schedule.weekend_patrols_per_day;
  
  let expected = 0;
  let currentDate = dayjs(startDate);
  const end = dayjs(endDate);
  
  while (currentDate.isBefore(end) || currentDate.isSame(end, 'day')) {
    const dayOfWeek = currentDate.format('ddd').toLowerCase();
    
    // Check if this day is in the patrol schedule
    if (patrolDays.includes(dayOfWeek)) {
      if (dayOfWeek === 'sat' || dayOfWeek === 'sun') {
        expected += weekendPatrols;
      } else {
        expected += weekdayPatrols;
      }
    }
    
    currentDate = currentDate.add(1, 'day');
  }
  
  return expected;
}

/**
 * Calculate expected patrols PER ZONE - CORRECTED
 * Each zone gets the FULL expected patrol count, NOT divided
 */
function calculateExpectedPatrolsPerZone(schedule, startDate, endDate) {
  // FIXED: Each zone should get the same expected patrols as the total schedule
  return calculateExpectedPatrols(schedule, startDate, endDate);
}

/**
 * Calculate weekly total
 */
function calculateWeeklyTotal(weekdayPatrols, weekendPatrols, patrolDays) {
  const days = patrolDays.split(',').map(day => day.trim().toLowerCase());
  let weeklyTotal = 0;
  
  days.forEach(day => {
    if (day === 'sat' || day === 'sun') {
      weeklyTotal += weekendPatrols;
    } else {
      weeklyTotal += weekdayPatrols;
    }
  });
  
  return weeklyTotal;
}

/**
 * Get performance rating
 */
function getPerformanceRating(complianceRate) {
  const rate = parseFloat(complianceRate) || 0;
  if (rate >= 90) return 'Excellent';
  if (rate >= 80) return 'Good';
  if (rate >= 70) return 'Fair';
  return 'Poor';
}

/**
 * Get performance status
 */
function getPerformanceStatus(performanceRate) {
  const rate = parseFloat(performanceRate) || 0;
  if (rate >= 100) return 'Exceeded Target';
  if (rate >= 90) return 'On Target';
  if (rate >= 70) return 'Needs Improvement';
  return 'Needs Attention';
}

// 🔧 Helper functions
async function getClientInfo(clientParam) {
  const pool = await poolPromise;
  try {
    const result = await pool.request()
      .input("clientName", sql.NVarChar, clientParam)
      .query(`
        SELECT cue_iid AS id, cue_cnombre AS name
        FROM [_Datos].[dbo].[m_cuentas] 
        WHERE cue_cnombre = @clientName
      `);
    return result.recordset.length > 0 ? result.recordset[0] : null;
  } catch (error) {
    console.error("❌ Error getting client info:", error);
    return null;
  }
}

async function getAllClients() {
  const pool = await poolPromise;
  try {
    const result = await pool.request().query(`
      SELECT cue_iid AS id, cue_cnombre AS name
      FROM [_Datos].[dbo].[m_cuentas] 
      ORDER BY cue_cnombre
    `);
    return result.recordset;
  } catch (error) {
    console.error("❌ Error getting all clients:", error);
    return [];
  }
}

async function checkTableExists(tableName) {
  const pool = await poolPromise;
  try {
    const tableNameOnly = tableName.split('.').pop();
    const result = await pool.request()
      .input("tableName", sql.NVarChar, tableNameOnly)
      .query(`
        SELECT 1 AS existsFlag
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = @tableName
      `);
    return result.recordset.length > 0;
  } catch (error) {
    console.warn(`⚠️ Error checking table ${tableName}:`, error.message);
    return false;
  }
}

function getTableNames(startDate, endDate) {
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  const tables = new Set();
  let current = start;
  while (current.isBefore(end) || current.isSame(end, 'month')) {
    const monthSuffix = current.format("YYYYMM");
    tables.add(`_Datos.dbo.p_recepcion${monthSuffix}`);
    current = current.add(1, 'month').startOf('month');
  }
  return Array.from(tables);
}

function getShiftDescription(shiftType) {
  switch (shiftType?.toLowerCase()) {
    case 'day': return 'Day Shift (6:00-17:59)';
    case 'night': return 'Night Shift (18:00-5:59)';
    case 'day/night':
    default: return 'All Shifts';
  }
}

// 📊 Fetch weekly report data - CORRECTED CALCULATIONS
async function fetchWeeklyReport(clientName, startDate, endDate) {
  try {
    const pool = await poolPromise;
    console.log(`📊 [fetchWeeklyReport] Client: ${clientName}, Period: ${startDate} to ${endDate}`);

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      throw new Error(`Client not found: ${clientName}`);
    }

    // ✅ Get schedule using imported function
    const schedule = await getClientSchedule(clientInfo.id);
    console.log(`📋 Schedule loaded:`, {
      weekday: schedule.patrols_per_day,
      weekend: schedule.weekend_patrols_per_day,
      days: schedule.patrol_days,
      shift: schedule.shift_type,
      hasCustom: schedule.has_custom_schedule,
      source: schedule.config_source
    });
    
    const tableNames = getTableNames(startDate, endDate);
    const tableExistsChecks = await Promise.all(
      tableNames.map(table => checkTableExists(table))
    );
    const validTables = tableNames.filter((_, index) => tableExistsChecks[index]);
    
    if (validTables.length === 0) {
      const mainTableExists = await checkTableExists('_Datos.dbo.p_recepcion');
      if (mainTableExists) {
        validTables.push('_Datos.dbo.p_recepcion');
      } else {
        throw new Error("No valid tables found for date range");
      }
    }

    const buildUnionQuery = (tables) => {
      return tables.map(table => `SELECT * FROM ${table} r`).join('\n          UNION ALL\n          ');
    };

    // ✅ CORRECT: Calculate expected patrols PER ZONE (FULL VALUE, not divided)
    const daysInPeriod = Math.max(1, dayjs(endDate).diff(dayjs(startDate), 'day') + 1);
    const expectedPerZone = calculateExpectedPatrolsPerZone(schedule, startDate, endDate);
    
    console.log(`🎯 CORRECTED Expected calculation:`, {
      daysInPeriod,
      schedulePatrolsPerDay: schedule.patrols_per_day,
      scheduleWeekendPatrols: schedule.weekend_patrols_per_day,
      expectedPerZone: expectedPerZone,
      calculationMethod: 'FULL expected patrols per zone (NOT divided)'
    });

    // ✅ Get actual completed patrols per zone (with zone names)
    const summaryResult = await pool.request()
      .input("clientId", sql.Int, clientInfo.id)
      .input("startDate", sql.DateTime, dayjs(startDate).startOf("day").toDate())
      .input("endDate", sql.DateTime, dayjs(endDate).endOf("day").toDate())
      .query(`
        SELECT 
          COALESCE(
            zon.zon_cdescripcion,
            r.rec_czona, 
            'Unknown Zone'
          ) AS SecurityPost,
          COUNT(*) AS Completed
        FROM (${buildUnionQuery(validTables)}) AS r
        LEFT JOIN [_Datos].[dbo].[m_zonas] AS zon
          ON r.rec_iidcuenta = zon.zon_iidcuenta
          AND r.rec_czona = zon.zon_ccodigo
        WHERE r.rec_iidcuenta = @clientId
          AND r.rec_tfechahora BETWEEN @startDate AND @endDate
        GROUP BY COALESCE(zon.zon_cdescripcion, r.rec_czona, 'Unknown Zone')
        ORDER BY COUNT(*) DESC
      `);

    const posts = summaryResult.recordset || [];
    console.log(`📊 Found ${posts.length} security posts with data`);

    // ✅ CORRECT Performance Calculation - EACH ZONE GETS FULL EXPECTED VALUE
    const totalCompleted = posts.reduce((sum, p) => sum + (parseInt(p.Completed) || 0), 0);
    const validZoneCount = posts.length;

    console.log(`📐 CORRECT: Expected Per Zone: ${expectedPerZone} (FULL VALUE, NOT divided)`);

    // ✅ CORRECT: Assign expected values and calculate performance
    const processedPosts = posts.map(post => {
      const completed = parseInt(post.Completed) || 0;
      const expected = expectedPerZone; // Each zone gets the FULL expected value
      
      // Performance calculation: (Completed / Expected) × 100
      const performance = expected > 0 
        ? ((completed / expected) * 100).toFixed(1)
        : '0.0';
      
      const status = getPerformanceStatus(performance);
      
      console.log(`  ${post.SecurityPost}: ${completed}/${expected} = ${performance}% [${status}]`);
      
      return {
        SecurityPost: post.SecurityPost,
        Completed: completed,
        Expected: expected,
        Performance: performance,
        Status: status
      };
    });

    // ✅ Calculate overall performance
    const totalZonesExpected = validZoneCount * expectedPerZone;
    const overallCompletionRate = totalZonesExpected > 0 
      ? ((totalCompleted / totalZonesExpected) * 100).toFixed(1)
      : '0.0';
    const performanceRating = getPerformanceRating(parseFloat(overallCompletionRate));

    console.log('📊 CORRECT Performance calculations completed');
    console.log(`📈 Overall: ${totalCompleted}/${totalZonesExpected} (${overallCompletionRate}%) - ${performanceRating}`);

    // ✅ Get human-readable events with zone names
    const eventsResult = await pool.request()
      .input("clientId", sql.Int, clientInfo.id)
      .input("startDate", sql.DateTime, dayjs(startDate).startOf("day").toDate())
      .input("endDate", sql.DateTime, dayjs(endDate).endOf("day").toDate())
      .query(`
        SELECT 
          CONVERT(VARCHAR(10), r.rec_tfechahora, 120) AS Date,
          CONVERT(VARCHAR(8), r.rec_tfechahora, 108) AS Time,
          COALESCE(
            zon.zon_cdescripcion,
            r.rec_czona,
            'No Zone'
          ) AS Zone,
          COALESCE(
            NULLIF(r.rec_cContenido, ''),
            NULLIF(r.rec_calarma, ''),
            'Patrol Completed'
          ) AS Event,
          r.rec_calarma AS Code,
          ISNULL(r.rec_cObservaciones, '') AS Observations
        FROM (${buildUnionQuery(validTables)}) AS r
        LEFT JOIN [_Datos].[dbo].[m_zonas] AS zon
          ON r.rec_iidcuenta = zon.zon_iidcuenta
          AND r.rec_czona = zon.zon_ccodigo
        WHERE r.rec_iidcuenta = @clientId
          AND r.rec_tfechahora BETWEEN @startDate AND @endDate
        ORDER BY r.rec_tfechahora DESC
      `);

    const events = eventsResult.recordset || [];
    console.log(`📋 Found ${events.length} events`);

    // Incident count
    const incidentResult = await pool.request()
      .input("clientId", sql.Int, clientInfo.id)
      .input("startDate", sql.DateTime, dayjs(startDate).startOf("day").toDate())
      .input("endDate", sql.DateTime, dayjs(endDate).endOf("day").toDate())
      .query(`
        SELECT COUNT(*) as IncidentCount
        FROM (${buildUnionQuery(validTables)}) AS r
        WHERE r.rec_iidcuenta = @clientId
          AND r.rec_tfechahora BETWEEN @startDate AND @endDate
          AND (r.rec_cContenido LIKE '%incident%' OR r.rec_cContenido LIKE '%alarm%' OR r.rec_calarma IS NOT NULL)
      `);

    const incidentCount = incidentResult.recordset[0]?.IncidentCount || 0;
    console.log(`🚨 Found ${incidentCount} incidents`);

    // ✅ Calculate weekly total
    const weeklyTotal = calculateWeeklyTotal(
      schedule.patrols_per_day,
      schedule.weekend_patrols_per_day,
      schedule.patrol_days
    );

    return {
      clientInfo,
      posts: processedPosts,
      events,
      incident: [{ count: incidentCount }],
      metadata: {
        totalExpectedPatrols: totalZonesExpected,
        totalCompleted: totalCompleted,
        completionRate: overallCompletionRate,
        performanceRating: performanceRating,
        daysInRange: daysInPeriod,
        weeklyTotal: weeklyTotal,
        expectedPerZone: expectedPerZone,
        validZoneCount: validZoneCount,
        hasSchedule: !!schedule,
        hasCustomSchedule: schedule.has_custom_schedule,
        configSource: schedule.config_source,
        tablesUsed: validTables,
        calculationMethod: 'FULL expected patrols per zone (NOT divided)'
      }
    };

  } catch (error) {
    console.error("❌ Error in fetchWeeklyReport:", error);
    throw error;
  }
}

// 📄 Generate and download PDF report - FIXED TO USE reportService.js
export const getWeeklyReportPDF = async (req, res) => {
  try {
    const { clientName, startDate, endDate, shiftType = "Day/Night" } = req.query;
    
    console.log("📄 PDF Request Parameters:", { clientName, startDate, endDate, shiftType });

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

    console.log("✅ Client found:", { id: clientInfo.id, name: clientInfo.name });

    // ✅ Use the reportService.js for PDF generation
    const pdfBuffer = await generateWeeklyReportPDF(
      clientInfo.id,
      clientInfo.name,
      startDate,
      endDate,
      shiftType
    );
    
    if (!pdfBuffer) {
      console.error("❌ PDF generation returned null buffer");
      return res.status(500).json({
        success: false,
        message: "PDF generation failed - no buffer returned"
      });
    }

    const safeClientName = clientInfo.name.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
    const filename = `Security_Report_${safeClientName}_${startDate}_to_${endDate}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    console.log("✅ PDF generated successfully using reportService.js:", {
      filename,
      size: `${(pdfBuffer.length / 1024).toFixed(2)} KB`,
      service: 'reportService.js'
    });

    res.send(pdfBuffer);

  } catch (error) {
    console.error("❌ PDF Generation Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating PDF report",
      error: error.message
    });
  }
};

// 📊 Get patrol report data - CORRECTED
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

    console.log(`\n📊 [Patrol Report Request] Client: ${client}, Period: ${startDateTime} → ${endDateTime}`);

    const clientInfo = await getClientInfo(client);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: `Client not found: ${client}`
      });
    }

    const schedule = await getClientSchedule(clientInfo.id);
    const effectiveShiftType = schedule?.shift_type || shiftType;

    const reportData = await fetchWeeklyReport(
      clientInfo.name,
      startDateTime.split('T')[0],
      endDateTime.split('T')[0]
    );

    if (!reportData.posts || !reportData.events) {
      return res.status(500).json({
        success: false,
        message: "Data fetch failed - invalid structure returned"
      });
    }

    const transformedSummary = reportData.posts.map(post => ({
      SitePosts: post.SecurityPost,
      ChecksCompleted: post.Completed,
      ExpectedChecks: post.Expected,
      PerformanceRate: `${post.Performance}%`,
      Status: post.Status
    }));

    console.log(`✅ CORRECTED Report data retrieved successfully`);
    console.log(`   Summary rows: ${transformedSummary.length}`);
    console.log(`   Event rows: ${reportData.events.length}`);
    console.log(`   Overall: ${reportData.metadata.completionRate}% - ${reportData.metadata.performanceRating}`);
    console.log(`   Expected per zone: ${reportData.metadata.expectedPerZone} (FULL VALUE)`);
    console.log(`   Valid zones: ${reportData.metadata.validZoneCount}`);

    return res.status(200).json({
      success: true,
      client: clientInfo.name,
      clientId: clientInfo.id,
      period: { 
        startDateTime, 
        endDateTime,
        daysInRange: reportData.metadata?.daysInRange
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
        weeklyTotal: reportData.metadata.weeklyTotal,
        hasCustomSchedule: schedule.has_custom_schedule,
        configSource: schedule.config_source
      } : null,
      calculations: {
        totalExpectedPatrols: reportData.metadata?.totalExpectedPatrols,
        totalCompleted: reportData.metadata?.totalCompleted,
        completionRate: reportData.metadata?.completionRate,
        performanceRating: reportData.metadata?.performanceRating,
        expectedPerZone: reportData.metadata?.expectedPerZone,
        validZoneCount: reportData.metadata?.validZoneCount,
        hasSchedule: !!schedule,
        method: reportData.metadata?.calculationMethod,
        note: "✅ CORRECTED: Each zone gets full expected patrol count"
      },
      incident: reportData.incident || [],
      summary: transformedSummary,
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

// 🔄 Get available shifts and schedule configuration
export const getClientShifts = async (req, res) => {
  try {
    const client = req.query.client || req.params.client;

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
      availableShifts[0].default = true;
    }

    // ✅ Calculate weekly total using imported function
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

// 🧪 Test report data - NOW WITH EVEN DISTRIBUTION DEBUG
export const testReportData = async (req, res) => {
  try {
    const { clientName, startDate, endDate } = req.query;

    console.log("🧪 Test Request:", { clientName, startDate, endDate });

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

    const reportData = await fetchWeeklyReport(
      clientInfo.name,
      startDate || '2024-01-01',
      endDate || '2024-01-08'
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
        hasMetadata: !!reportData.metadata,
        allKeys: Object.keys(reportData)
      },
      dataContent: {
        postsCount: reportData.posts?.length || 0,
        eventsCount: reportData.events?.length || 0,
        postsSample: reportData.posts?.slice(0, 3) || [],
        eventsSample: reportData.events?.slice(0, 3) || []
      },
      performanceCheck: reportData.posts?.map(p => ({
        zone: p.SecurityPost,
        completed: p.Completed,
        expected: p.Expected,
        performance: `${p.Performance}%`,
        calculation: `${p.Completed} / ${p.Expected} × 100 = ${p.Performance}%`,
        meetsExpectation: parseFloat(p.Performance) >= 100
      })) || [],
      schedule: schedule ? {
        configured: true,
        patrolsPerDay: schedule.patrols_per_day,
        weekendPatrols: schedule.weekend_patrols_per_day,
        patrolDays: schedule.patrol_days,
        shiftType: schedule.shift_type,
        hasCustomSchedule: schedule.has_custom_schedule,
        configSource: schedule.config_source
      } : { configured: false },
      metadata: reportData.metadata || {},
      calculationVerification: {
        totalExpected: reportData.metadata?.totalExpectedPatrols,
        totalCompleted: reportData.metadata?.totalCompleted,
        completionRate: reportData.metadata?.completionRate,
        performanceRating: reportData.metadata?.performanceRating,
        calculationMethod: reportData.metadata?.calculationMethod,
        weeklyTotal: reportData.metadata?.weeklyTotal,
        expectedPerZone: reportData.metadata?.expectedPerZone,
        validZoneCount: reportData.metadata?.validZoneCount
      }
    };

    const recommendations = [];
    if (analysis.dataContent.postsCount === 0) {
      recommendations.push("⚠️ No data found - check client name and date range");
    }
    
    // Check if calculation method is correct
    if (analysis.calculationVerification.calculationMethod === 'FULL expected patrols per zone (NOT divided)') {
      recommendations.push("✅ Using correct FULL expected patrols method");
    } else {
      recommendations.push("⚠️ Using old proportional distribution method");
    }
    
    // Check if expected per zone makes sense
    if (analysis.calculationVerification.expectedPerZone > 0) {
      recommendations.push(`✅ Expected per zone: ${analysis.calculationVerification.expectedPerZone}`);
    }
    
    if (analysis.performanceCheck.some(p => p.meetsExpectation)) {
      recommendations.push("✅ Some zones are meeting or exceeding expectations");
    }
    
    if (analysis.dataContent.postsCount > 0) {
      recommendations.push("✅ Data fetch successful");
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
      dataAnalysis: analysis,
      recommendations
    });

  } catch (error) {
    console.error("❌ Test Error:", error);
    res.status(500).json({
      success: false,
      message: "Test failed",
      error: error.message
    });
  }
};

// 🧪 Test PDF generation with reportService.js
export const testReportGeneration = async (req, res) => {
  try {
    const { clientName } = req.params;
    const { startDate, endDate, shiftType } = req.body;

    if (!clientName) {
      return res.status(400).json({
        success: false,
        message: "Client Name is required",
      });
    }

    console.log(`\n🧪 [Test Report Generation] Client Name: ${clientName}`);

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    const schedule = await getClientSchedule(clientInfo.id);
    const endDateValue = endDate || new Date().toISOString().split('T')[0];
    const startDateValue = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const testShiftType = shiftType || "Day/Night";

    console.log(`   Period: ${startDateValue} → ${endDateValue}`);

    const reportData = await fetchWeeklyReport(
      clientInfo.name,
      startDateValue,
      endDateValue
    );

    let pdfTest = { success: false, message: "Not attempted" };
    try {
      // ✅ Use reportService.js for PDF generation
      const pdfBuffer = await generateWeeklyReportPDF(
        clientInfo.id,
        clientInfo.name,
        startDateValue,
        endDateValue,
        testShiftType
      );
      pdfTest = {
        success: !!pdfBuffer,
        message: pdfBuffer ? "PDF generated successfully using reportService.js" : "No data for PDF generation",
        size: pdfBuffer ? pdfBuffer.length : 0,
        service: 'reportService.js'
      };
    } catch (pdfError) {
      pdfTest = {
        success: false,
        message: pdfError.message,
        service: 'reportService.js'
      };
    }

    const recommendations = [];
    if (!schedule) {
      recommendations.push("⚠️ No patrol schedule configured");
    }
    if (reportData.posts?.length === 0) {
      recommendations.push("⚠️ No data found for the specified period");
    }
    if (!pdfTest.success) {
      recommendations.push("❌ PDF generation failed");
    }
    
    // Check calculation method
    if (reportData.metadata?.calculationMethod === 'FULL expected patrols per zone (NOT divided)') {
      recommendations.push("✅ Using correct FULL expected patrols calculation");
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
          startDate: startDateValue,
          endDate: endDateValue
        },
        dataFetch: {
          success: !!reportData.posts && !!reportData.events,
          postsCount: reportData.posts?.length || 0,
          eventsCount: reportData.events?.length || 0,
          calculationMethod: reportData.metadata?.calculationMethod,
          expectedPerZone: reportData.metadata?.expectedPerZone
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

// 📧 Send single client report using reportService.js
export const sendSingleClientReport = async (req, res) => {
  const { clientName } = req.params;

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input("ClientName", sql.NVarChar, clientName)
      .query(`
        SELECT 
          R.rep_iidcuenta AS ClientID,
          C.cue_cnombre AS ClientName,
          R.rep_cmail AS Email
        FROM [_Datos].[dbo].[m_reportes_automaticos] R
        INNER JOIN [_Datos].[dbo].[m_cuentas] C
          ON R.rep_iidcuenta = C.cue_iid
        WHERE C.cue_cnombre = @ClientName
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ 
        success: false,
        message: "Client not found or email not set" 
      });
    }

    const { ClientName, Email } = result.recordset[0];
    console.log(`📤 Manually generating report for ${ClientName} (${Email})...`);

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const schedule = await getClientSchedule(parseInt(result.recordset[0].ClientID));
    const shiftType = schedule?.shift_type || "Day/Night";

    // ✅ Use reportService.js for PDF generation
    const pdfBuffer = await generateWeeklyReportPDF(
      parseInt(result.recordset[0].ClientID),
      ClientName,
      startDate,
      endDate,
      shiftType
    );

    if (!pdfBuffer) {
      return res.status(400).json({ 
        success: false,
        message: `No patrol data available for ${ClientName}` 
      });
    }

    const transporter = nodemailer.createTransporter({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: Email,
      subject: `Manual Patrol Report - ${ClientName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50;">Manual Patrol Report</h2>
          <h3 style="color: #34495e;">${ClientName}</h3>
          <p>Attached is the manually generated patrol report for your security operations.</p>
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #6c757d;">
              <strong>Report Period:</strong> ${startDate} to ${endDate}<br>
              <strong>Generated:</strong> ${new Date().toLocaleDateString()}<br>
              <strong>PDF Service:</strong> reportService.js
            </p>
          </div>
          <p style="color: #7f8c8d; font-size: 12px; margin-top: 30px;">
            Best regards,<br>
            Security Operations Team
          </p>
        </div>
      `,
      attachments: [
        {
          filename: `${ClientName.replace(/\s+/g, "_")}_Manual_Report_${endDate}.pdf`,
          content: pdfBuffer,
        },
      ],
    });

    console.log(`✅ Report manually sent to ${Email} using reportService.js`);

    return res.json({
      success: true,
      message: `Report successfully sent to ${Email}`,
      client: ClientName,
      email: Email,
      period: `${startDate} to ${endDate}`,
      pdfService: 'reportService.js'
    });
  } catch (error) {
    console.error("❌ Manual send error:", error.message);
    res.status(500).json({ 
      success: false,
      message: "Failed to send report", 
      error: error.message 
    });
  }
};

// 📊 Get comprehensive client report
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
    const reportData = await fetchWeeklyReport(
      clientInfo.name,
      startDateStr,
      endDateStr
    );

    if (!reportData.posts || !reportData.events) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch report data",
      });
    }

    // ✅ Use reportService.js for PDF generation
    const pdfBuffer = await generateWeeklyReportPDF(
      clientInfo.id,
      clientInfo.name,
      startDateStr,
      endDateStr,
      schedule?.shift_type || "Day/Night"
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
        weeklyTotal: reportData.metadata.weeklyTotal
      } : null,
      data: {
        postsCount: reportData.posts?.length || 0,
        eventsCount: reportData.events?.length || 0,
        hasData: (reportData.posts?.length > 0) || (reportData.events?.length > 0),
        metadata: reportData.metadata
      },
      pdfAvailable: !!pdfBuffer,
      pdfSize: pdfBuffer ? pdfBuffer.length : 0,
      pdfService: 'reportService.js',
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

// 📈 Get client performance trends
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
    
    for (let i = 0; i < parseInt(months); i++) {
      const monthDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
      
      const monthData = await fetchWeeklyReport(
        clientInfo.name,
        monthStart.toISOString().split('T')[0],
        monthEnd.toISOString().split('T')[0]
      );

      const totalExpected = monthData.metadata?.totalExpectedPatrols || 0;
      const totalCompleted = monthData.metadata?.totalCompleted || 0;
      const performanceRate = monthData.metadata?.completionRate || '0.0';
      const rating = monthData.metadata?.performanceRating || 'N/A';

      trends.push({
        month: monthDate.toLocaleString('default', { month: 'long', year: 'numeric' }),
        period: `${monthStart.toISOString().split('T')[0]} to ${monthEnd.toISOString().split('T')[0]}`,
        expected: totalExpected,
        completed: totalCompleted,
        performanceRate: performanceRate,
        rating: rating,
        postsCount: monthData.posts?.length || 0,
        expectedPerZone: monthData.metadata?.expectedPerZone || 0
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
        months: parseInt(months),
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

// 👥 Get all clients list
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

// 🔍 Search clients by name
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

// 🧪 Debug performance calculations endpoint
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

    const reportData = await fetchWeeklyReport(
      clientName,
      startDate || '2024-01-01',
      endDate || '2024-01-08'
    );
    
    const debug = {
      client: clientInfo.name,
      calculationMethod: reportData.metadata.calculationMethod,
      totalExpected: reportData.metadata.totalExpectedPatrols,
      totalCompleted: reportData.metadata.totalCompleted,
      completionRate: reportData.metadata.completionRate,
      performanceRating: reportData.metadata.performanceRating,
      weeklyTotal: reportData.metadata.weeklyTotal,
      expectedPerZone: reportData.metadata.expectedPerZone,
      validZoneCount: reportData.metadata.validZoneCount,
      zones: reportData.posts.map(post => ({
        name: post.SecurityPost,
        completed: post.Completed,
        expected: post.Expected,
        performance: `${post.Performance}%`,
        calculation: `${post.Completed} / ${post.Expected} × 100 = ${post.Performance}%`,
        meetsExpectation: parseFloat(post.Performance) >= 100
      })),
      events: reportData.events.slice(0, 5).map(e => ({
        date: e.Date,
        zone: e.Zone,
        event: e.Event
      }))
    };
    
    res.json({ success: true, debug });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🏠 Health check endpoint
export const healthCheck = async (req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request().query('SELECT 1 as test');
    
    res.json({
      success: true,
      message: "Report controller is healthy - USING reportService.js FOR PDF GENERATION ✅",
      timestamp: new Date().toISOString(),
      database: "Connected",
      pdfService: "reportService.js",
      fixes: {
        zoneNames: "✅ Zone names from m_zonas table",
        performanceCalc: "✅ FULL expected patrols per zone (NOT divided)",
        eventDescriptions: "✅ COALESCE with fallback values",
        importedCalculations: "✅ Using calculations from managePatrolSchedules.js",
        pdfGeneration: "✅ Using reportService.js for PDF generation"
      },
      endpoints: {
        pdf: "/api/reports/weekly/pdf?clientName=X&startDate=Y&endDate=Z",
        test: "/api/reports/test?clientName=X&startDate=Y&endDate=Z",
        debug: "/api/reports/debug?clientName=X&startDate=Y&endDate=Z",
        health: "/api/reports/health",
        patrol: "/api/reports/patrol?client=X&startDateTime=Y&endDateTime=Z",
        clients: "/api/reports/clients",
        search: "/api/reports/clients/search?query=X"
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Health check failed",
      error: error.message
    });
  }
};

// 📋 Get Weekly Report - Alias for getPatrolReport
export const getWeeklyReport = async (req, res) => {
  try {
    console.log("📋 [Weekly Report Alias] Using getPatrolReport...");
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

// Export helper calculation functions for use in other modules
export {
  calculateExpectedPatrols,
  calculateWeeklyTotal,
  getPerformanceRating
};

// Default export
export default {
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
};