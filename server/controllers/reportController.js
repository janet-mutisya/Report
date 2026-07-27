// ============================================================================
// ✅ FULLY REWRITTEN - reportController.js
// ============================================================================
// ✅ FIX 1: Displays ACTUAL ZONE NAMES from API/database - NEVER "Security Post XX"
// ✅ FIX 2: Uses PRE-FILTERED events from reportModel.js (no UNKNOWN_ZONE)
// ✅ FIX 3: Enhanced client lookup with API priority
// ✅ FIX 4: Comprehensive logging for zone name debugging
// ✅ FIX 5: Direct zone name mapping verification
// ✅ FIX 6: Google Drive archive methods added
// ✅ FIX 7: Archive clients = BM Security API list + Google Drive hasArchive flag
// ✅ FIX 8: Patrol schedule management integrated (getClientSchedule, upsertPatrolSchedule)
// ✅ FIX 9: Manual reports now respect client's configured patrolsPerDay
// ✅ FIX 10: Full CRUD operations for patrol schedules via API
// ============================================================================

const { generateWeeklyReportPDF } = require("../service/reportService.js");
const { generatePDFReport, generateDashboardPDF } = require("../service/pdfService.js");
const { fetchWeeklyReport, fetchPatrolReport, DEFAULT_REPORT_TYPES } = require("../models/reportModel.js");
const patrolScheduleManager = require("../scripts/managePatrolSchedules.js");
const { sql, poolPromise } = require("../config/database.js");
const bmSecurityAPI = require("../service/bmSecurityAPI.js");
const nodemailer = require("nodemailer");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');
const { google } = require('googleapis');

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

// ========== CONFIGURATION ==========
const SHIFT_START_HOUR = 18;
const SHIFT_END_HOUR   = 6;

// Root folder ID for the Google Drive archive — set ARCHIVE_ROOT_FOLDER_ID in your .env
const ARCHIVE_ROOT = process.env.ARCHIVE_ROOT_FOLDER_ID;

// Email sending global flag
const EMAIL_SENDING_ENABLED = process.env.ENABLE_EMAIL_SENDING === 'true';

// 🔧 Available shifts configuration
const AVAILABLE_SHIFTS = [
  {
    value: "Day/Night",
    label: "All Shifts (Day & Night)",
    description: "24-hour coverage",
    default: false,
  },
  {
    value: "Day",
    label: "Day Shift Only",
    description: "6:00 AM - 5:59 PM",
    default: false,
  },
  {
    value: "Night",
    label: "Night Shift Only",
    description: "6:00 PM - 5:59 AM",
    default: false,
  },
];

// ========== GOOGLE DRIVE HELPER ==========

/**
 * Returns an authenticated Google Drive v3 client.
 *
 * Credential resolution order (matches emailService.js / driveService.js):
 *   1. GOOGLE_SERVICE_ACCOUNT_KEY      → raw JSON string
 *   2. GOOGLE_SERVICE_ACCOUNT_JSON     → raw JSON string (alternate name)
 *   3. GOOGLE_SERVICE_ACCOUNT_KEY_FILE → path to JSON file
 */
function getDrive() {
  let credentials;

  const rawKey =
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (rawKey) {
    try {
      credentials = JSON.parse(rawKey);
    } catch {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_KEY / GOOGLE_SERVICE_ACCOUNT_JSON contains invalid JSON"
      );
    }
  }

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;

  if (!credentials && !keyFile) {
    throw new Error(
      "No Google Drive credentials found. " +
        "Set GOOGLE_SERVICE_ACCOUNT_KEY (JSON string) or GOOGLE_SERVICE_ACCOUNT_KEY_FILE (path)."
    );
  }

  const auth = new google.auth.GoogleAuth({
    ...(credentials ? { credentials } : { keyFile }),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({ version: "v3", auth });
}

/**
 * Lists all non-trashed files/folders inside a Drive folder.
 * @param {object}      drive    - authenticated Drive client
 * @param {string}      parentId - Drive folder ID to list
 * @param {string|null} mimeType - optional MIME type filter
 */
async function listFolderContents(drive, parentId, mimeType = null) {
  const queryParts = [`'${parentId}' in parents`, `trashed = false`];
  if (mimeType) queryParts.push(`mimeType = '${mimeType}'`);

  const res = await drive.files.list({
    q: queryParts.join(" and "),
    fields: "files(id, name, mimeType, size, createdTime, modifiedTime)",
    orderBy: "name desc",
    pageSize: 1000,
  });

  return res.data.files || [];
}

// ========== HELPER FUNCTIONS ==========

/**
 * ✅ Calculate weekly total patrols
 */
function calculateWeeklyTotal(weekdayPatrols, weekendPatrols, patrolDays) {
  const days =
    patrolDays?.split(",").map((day) => day.trim().toLowerCase()) || [];
  let weeklyTotal = 0;

  days.forEach((day) => {
    if (day === "sat" || day === "sun") {
      weeklyTotal += weekendPatrols || weekdayPatrols || 0;
    } else {
      weeklyTotal += weekdayPatrols || 0;
    }
  });

  return weeklyTotal;
}

/**
 * ✅ Calculate expected patrols for a date range
 */
function calculateExpectedPatrolsForRange(schedule, startDate, endDate) {
  if (!schedule) return 0;
  
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  const days = end.diff(start, 'day') + 1;
  
  const patrolDaysSet = new Set(
    (schedule.patrol_days || 'Mon,Tue,Wed,Thu,Fri,Sat,Sun')
      .split(',')
      .map(d => d.trim().toLowerCase())
  );
  
  const weekdayPatrols = schedule.patrols_per_day || 11;
  const weekendPatrols = schedule.weekend_patrols_per_day || weekdayPatrols;
  
  let expectedPatrols = 0;
  let currentDate = start;
  
  for (let i = 0; i < days; i++) {
    const dayOfWeek = currentDate.format('ddd').toLowerCase();
    const isWeekend = dayOfWeek === 'sat' || dayOfWeek === 'sun';
    
    if (patrolDaysSet.has(dayOfWeek)) {
      expectedPatrols += isWeekend ? weekendPatrols : weekdayPatrols;
    }
    
    currentDate = currentDate.add(1, 'day');
  }
  
  return expectedPatrols;
}

/**
 * ✅ Get performance rating
 */
function getPerformanceRating(complianceRate) {
  const rate =
    typeof complianceRate === "number"
      ? complianceRate
      : parseFloat(complianceRate) || 0;
  if (rate >= 90) return "Excellent";
  if (rate >= 80) return "Good";
  if (rate >= 70) return "Fair";
  return "Poor";
}

/**
 * ✅ Get performance status
 */
function getPerformanceStatus(performanceRate) {
  const rate =
    typeof performanceRate === "number"
      ? performanceRate
      : parseFloat(performanceRate) || 0;
  if (rate >= 100) return "Exceeded Target";
  if (rate >= 90)  return "On Target";
  if (rate >= 70)  return "Needs Improvement";
  return "Needs Attention";
}

/**
 * ✅ Get shift description
 */
function getShiftDescription(shiftType) {
  switch (shiftType?.toLowerCase()) {
    case "day":   return "Day Shift (6:00-17:59)";
    case "night": return "Night Shift (18:00-5:59)";
    case "day/night":
    default:      return "All Shifts";
  }
}

/**
 * ✅ De-duplicate an array of client objects by name.
 */
function deduplicateClientNames(clients) {
  const seen = {};
  return clients.map((c) => {
    const base = c.name || "";
    if (!seen[base]) {
      seen[base] = 1;
      return { ...c, uniqueKey: `${c.id}-${base}` };
    } else {
      seen[base] += 1;
      const displayName = `${base} (${seen[base]})`;
      return { ...c, displayName, uniqueKey: `${c.id}-${base}-${seen[base]}` };
    }
  });
}

/**
 * ✅ Get client info from API (PRIMARY) with database fallback
 */
async function getClientInfo(clientParam) {
  try {
    console.log(`🔍 Looking up client: "${clientParam}"`);

    const isNumeric =
      !isNaN(clientParam) && !isNaN(parseFloat(clientParam));

    // PRIMARY: Fetch from BM Security API
    try {
      console.log(`🌐 Checking API for client: ${clientParam}`);
      const apiClients = await bmSecurityAPI.getClients();

      let apiClient;
      if (isNumeric) {
        apiClient = apiClients.find(
          (c) => String(c.id) === String(clientParam)
        );
      } else {
        apiClient = apiClients.find(
          (c) =>
            c.name &&
            c.name.trim().toUpperCase() === clientParam.trim().toUpperCase()
        );
        if (!apiClient) {
          apiClient = apiClients.find(
            (c) =>
              c.name &&
              c.name.toUpperCase().includes(clientParam.toUpperCase())
          );
        }
      }

      if (apiClient) {
        console.log(
          `✅ Found in API: ${apiClient.name} (ID: ${apiClient.id}, Account: ${apiClient.accountNumber})`
        );

        try {
          const zones = await bmSecurityAPI.getClientZones(apiClient.id);
          console.log(`   Zone count from API: ${zones?.length || 0}`);
          if (zones && zones.length > 0) {
            console.log(
              `   Sample zones: ${zones
                .slice(0, 3)
                .map((z) => `${z.code}:${z.name}`)
                .join(", ")}`
            );
          }
        } catch (zoneError) {
          console.log(`   ⚠️ Could not fetch zones: ${zoneError.message}`);
        }

        return {
          id: apiClient.id,
          name: apiClient.name,
          accountNumber: apiClient.accountNumber,
          source: "API",
        };
      }
    } catch (apiError) {
      console.log(`⚠️ API client lookup failed: ${apiError.message}`);
    }

    // FALLBACK: database
    console.log(
      `⚠️ Client "${clientParam}" not found in API, checking database...`
    );

    const pool = await poolPromise;
    let result;

    if (isNumeric) {
      result = await pool
        .request()
        .input("clientId", sql.Int, parseInt(clientParam))
        .query(`
          SELECT
            cue_iid AS id,
            LTRIM(RTRIM(cue_cnombre)) AS name,
            LTRIM(RTRIM(cue_ncuenta)) AS accountNumber
          FROM [_Datos].[dbo].[m_cuentas]
          WHERE cue_iid = @clientId
        `);
    } else {
      result = await pool
        .request()
        .input("clientName", sql.NVarChar, clientParam.trim())
        .query(`
          SELECT
            cue_iid AS id,
            LTRIM(RTRIM(cue_cnombre)) AS name,
            LTRIM(RTRIM(cue_ncuenta)) AS accountNumber
          FROM [_Datos].[dbo].[m_cuentas]
          WHERE LTRIM(RTRIM(cue_cnombre)) = @clientName
        `);

      if (result.recordset.length === 0) {
        result = await pool
          .request()
          .input("clientName", sql.NVarChar, `%${clientParam}%`)
          .query(`
            SELECT
              cue_iid AS id,
              LTRIM(RTRIM(cue_cnombre)) AS name,
              LTRIM(RTRIM(cue_ncuenta)) AS accountNumber
            FROM [_Datos].[dbo].[m_cuentas]
            WHERE cue_cnombre LIKE @clientName
            ORDER BY cue_cnombre
          `);
      }
    }

    if (result.recordset.length > 0) {
      console.log(`✅ Found in database: ${result.recordset[0].name}`);
      return { ...result.recordset[0], source: "DATABASE" };
    }

    console.log(
      `❌ Client "${clientParam}" not found in API or database`
    );
    return null;
  } catch (error) {
    console.error("❌ Error getting client info:", error);
    return null;
  }
}

/**
 * ✅ Get all clients with API priority, de-duplicated
 */
async function getAllClients() {
  try {
    try {
      const apiClients = await bmSecurityAPI.getClients();
      if (apiClients && apiClients.length > 0) {
        console.log(`✅ Retrieved ${apiClients.length} clients from API`);
        const mapped = apiClients.map((c) => ({
          id: c.id,
          name: c.name,
          accountNumber: c.accountNumber,
          source: "API",
        }));
        return deduplicateClientNames(mapped);
      }
    } catch (apiError) {
      console.log(`⚠️ API client list failed: ${apiError.message}`);
    }

    const pool   = await poolPromise;
    const result = await pool.request().query(`
      SELECT
        cue_iid AS id,
        LTRIM(RTRIM(cue_cnombre)) AS name
      FROM [_Datos].[dbo].[m_cuentas]
      WHERE cue_cnombre IS NOT NULL
        AND cue_cnombre != ''
      ORDER BY cue_cnombre
    `);

    console.log(
      `✅ Retrieved ${result.recordset.length} clients from database`
    );
    const mapped = result.recordset.map((c) => ({ ...c, source: "DATABASE" }));
    return deduplicateClientNames(mapped);
  } catch (error) {
    console.error("❌ Error getting all clients:", error);
    return [];
  }
}

// =====================================================
// 📊 MAIN CONTROLLER FUNCTIONS
// =====================================================

/**
 * 📄 Generate and download PDF report (reportService version)
 */
const getWeeklyReportPDF = async (req, res) => {
  try {
    const {
      clientName,
      startDate,
      endDate,
      shiftType = "Day/Night",
    } = req.query;

    console.log("📄 [CONTROLLER] PDF Request (ReportService):", {
      clientName,
      startDate,
      endDate,
      shiftType,
    });

    if (!clientName) {
      return res.status(400).json({
        success: false,
        message: "Client Name is required",
        example:
          "/api/reports/weekly/pdf?clientName=Client Name&startDate=2024-01-01&endDate=2024-01-08",
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Start date and end date are required",
      });
    }

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      return res
        .status(404)
        .json({ success: false, message: `Client not found: ${clientName}` });
    }

    console.log(
      `✅ Client found: ${clientInfo.name} (ID: ${clientInfo.id})`
    );

    const pdfBuffer = await generateWeeklyReportPDF(
      clientInfo.id,
      startDate,
      endDate
    );

    if (!pdfBuffer) {
      return res.status(500).json({
        success: false,
        message: "PDF generation failed - no buffer returned",
      });
    }

    const safeClientName = clientInfo.name
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 50);
    const filename = `Security_Patrol_Report_${safeClientName}_${startDate.replace(
      /-/g,
      ""
    )}_${endDate.replace(/-/g, "")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("❌ PDF Generation Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating PDF report",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * 📄 Generate Dashboard PDF (pdfService version)
 */
const getDashboardPDF = async (req, res) => {
  try {
    const { clientName, startDate, endDate } = req.query;

    console.log(
      "📊 [CONTROLLER] Dashboard PDF Request (PDFService):",
      { clientName, startDate, endDate }
    );

    if (!clientName) {
      return res
        .status(400)
        .json({ success: false, message: "Client Name is required" });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Start date and end date are required",
      });
    }

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo) {
      return res
        .status(404)
        .json({ success: false, message: `Client not found: ${clientName}` });
    }

    // Get client's patrol schedule for PDF
    const schedule = await patrolScheduleManager.getClientSchedule(clientInfo.id);
    const expectedPatrols = calculateExpectedPatrolsForRange(schedule, startDate, endDate);

    const pdfResult = await generatePDFReport({
      clientId: clientInfo.id,
      clientName: clientInfo.name,
      startDate,
      endDate,
      patrolSchedule: schedule,
      expectedPatrols,
    });

    if (!pdfResult.success || !pdfResult.pdfBuffer) {
      return res.status(500).json({
        success: false,
        message: "Dashboard PDF generation failed",
        error: pdfResult.error || "No buffer returned",
      });
    }

    const safeClientName = clientInfo.name
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 50);
    const filename = `Security_Dashboard_${safeClientName}_${startDate.replace(
      /-/g,
      ""
    )}_${endDate.replace(/-/g, "")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader("Content-Length", pdfResult.pdfBuffer.length);
    res.send(pdfResult.pdfBuffer);
  } catch (error) {
    console.error("❌ Dashboard PDF Generation Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating dashboard PDF",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * 📄 Generate Comprehensive PDF with choice of service
 */
const getComprehensivePDF = async (req, res) => {
  try {
    const {
      clientName,
      startDate,
      endDate,
      type = "dashboard",
    } = req.query;

    if (!clientName)
      return res
        .status(400)
        .json({ success: false, message: "Client Name is required" });
    if (!startDate || !endDate)
      return res.status(400).json({
        success: false,
        message: "Start date and end date are required",
      });

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo)
      return res
        .status(404)
        .json({ success: false, message: `Client not found: ${clientName}` });

    let pdfBuffer;
    let filenamePrefix;

    if (type === "dashboard" || type === "pdfservice") {
      const schedule = await patrolScheduleManager.getClientSchedule(clientInfo.id);
      const expectedPatrols = calculateExpectedPatrolsForRange(schedule, startDate, endDate);
      
      const pdfResult = await generatePDFReport({
        clientId: clientInfo.id,
        clientName: clientInfo.name,
        startDate,
        endDate,
        patrolSchedule: schedule,
        expectedPatrols,
      });
      if (!pdfResult.success || !pdfResult.pdfBuffer)
        throw new Error(pdfResult.error || "PDF Service failed");
      pdfBuffer      = pdfResult.pdfBuffer;
      filenamePrefix = "Security_Dashboard";
    } else {
      pdfBuffer      = await generateWeeklyReportPDF(clientInfo.id, startDate, endDate);
      filenamePrefix = "Security_Patrol_Report";
    }

    if (!pdfBuffer) throw new Error("PDF generation returned null buffer");

    const safeClientName = clientInfo.name
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 50);
    const filename = `${filenamePrefix}_${safeClientName}_${startDate.replace(
      /-/g,
      ""
    )}_${endDate.replace(/-/g, "")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("❌ Comprehensive PDF Error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating PDF",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * 📊 ✅ Get patrol report data (ENHANCED with patrol schedule)
 */
const getPatrolReport = async (req, res) => {
  try {
    const {
      client,
      startDate,
      endDate,
      startDateTime,
      endDateTime,
      shiftType = "Day/Night",
    } = req.query;

    const effectiveStartDate = startDate || startDateTime;
    const effectiveEndDate   = endDate   || endDateTime;

    if (!client || !effectiveStartDate || !effectiveEndDate) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required parameters: client, startDate, and endDate.",
        example:
          "/api/reports/patrol?client=ClientName&startDate=2024-01-01&endDate=2024-01-08",
      });
    }

    const clientInfo = await getClientInfo(client);
    if (!clientInfo)
      return res
        .status(404)
        .json({ success: false, message: `Client not found: ${client}` });

    // ✅ Get client's patrol schedule
    const schedule = await patrolScheduleManager.getClientSchedule(clientInfo.id);
    const effectiveShiftType = schedule?.shift_type || shiftType;
    
    // Calculate expected patrols for the date range
    const expectedPatrolsTotal = calculateExpectedPatrolsForRange(
      schedule, 
      effectiveStartDate.split("T")[0], 
      effectiveEndDate.split("T")[0]
    );

    const reportData = await fetchPatrolReport(
      clientInfo.id,
      effectiveStartDate.split("T")[0],
      effectiveEndDate.split("T")[0],
      true,
      "custom"
    );

    if (!reportData.metadata.success) {
      return res.status(500).json({
        success: false,
        message: "Data fetch failed",
        error: reportData.metadata.error?.message,
        metadata: reportData.metadata,
      });
    }

    const genericZones =
      reportData.posts?.filter(
        (p) =>
          p.SecurityPost?.startsWith("Security Post") ||
          p.SecurityPost?.includes("UNKNOWN")
      ) || [];

    const transformedSummary = reportData.posts.map((post) => ({
      SecurityPost:   post.SecurityPost,
      ZoneCode:       post.ZoneCode,
      ChecksCompleted: post.Completed || 0,
      ExpectedChecks:  post.Expected  || 0,
      PerformanceRate: post.Performance ? `${post.Performance}%` : "0%",
      Percentage:      post.Percentage  || "0%",
      Status:          getPerformanceStatus(post.Performance || 0),
    }));

    const transformedEvents = reportData.events.map((event) => ({
      Date:         event.Date,
      Time:         event.Time,
      Zone:         event.Zone,
      ZoneCode:     event.ZoneCode,
      Event:        event.Event,
      AlarmCode:    event.AlarmCode    || "",
      Observations: event.Observations || "",
      Type:         event.Type         || "PATROL",
    }));

    const transformedGuardReports = reportData.guardReports.map((report) => ({
      id:      report.id,
      date:    report.date,
      zone:    report.zone,
      details: report.report || "No details available",
      type:    report.type   || "INCIDENT_REPORT",
    }));

    const weeklyTotal = schedule
      ? calculateWeeklyTotal(
          schedule.patrols_per_day,
          schedule.weekend_patrols_per_day,
          schedule.patrol_days
        )
      : 0;

    return res.status(200).json({
      success: true,
      client: {
        id:            clientInfo.id,
        name:          reportData.metadata.clientName || clientInfo.name,
        accountNumber: clientInfo.accountNumber,
        source:        clientInfo.source,
      },
      period: {
        startDate:  effectiveStartDate,
        endDate:    effectiveEndDate,
        shiftDays:
          reportData.metadata.shiftDays ||
          dayjs(effectiveEndDate).diff(dayjs(effectiveStartDate), "day") + 1,
        reportType: reportData.metadata.reportType || "CUSTOM",
      },
      shift: {
        requested:   shiftType,
        effective:   effectiveShiftType,
        description: getShiftDescription(effectiveShiftType),
      },
      schedule: schedule
        ? {
            patrolsPerDay:  schedule.patrols_per_day,
            patrolDays:     schedule.patrol_days,
            shiftType:      schedule.shift_type,
            weekendPatrols: schedule.weekend_patrols_per_day,
            weeklyTotal,
            hasCustomSchedule: schedule.has_custom_schedule,
            configSource: schedule.config_source,
          }
        : null,
      calculations: {
        totalExpectedPatrols:  expectedPatrolsTotal || reportData.metadata.totalExpectedPatrols || 0,
        totalCompletedPatrols: reportData.metadata.totalCompletedPatrols || 0,
        completionRate:        `${reportData.metadata.overallPatrolPerformance || 0}%`,
        completionRateNumeric:  reportData.metadata.overallPatrolPerformance || 0,
        performanceRating:      getPerformanceRating(reportData.metadata.overallPatrolPerformance || 0),
        validZoneCount:         reportData.posts.length,
        zoneSource:             reportData.metadata.zoneSource || "Unknown",
      },
      incidents: {
        count:   transformedGuardReports.length,
        reports: transformedGuardReports,
      },
      summary:       transformedSummary,
      events:        transformedEvents,
      guardReports:  transformedGuardReports,
      dataQuality: {
        ...reportData.metadata.dataQuality,
        zoneSource:        reportData.metadata.zoneSource,
        patrolSource:      reportData.metadata.patrolSource,
        hasActualZoneNames: genericZones.length === 0,
        genericZoneCount:   genericZones.length,
      },
      metadata: {
        generatedAt: reportData.metadata.generatedAt || new Date(),
        timezone:    TZ,
        success:     true,
        zoneNameStatus:
          genericZones.length === 0 ? "ALL_ACTUAL_NAMES" : "HAS_GENERIC_NAMES",
      },
      pdfOptions: {
        available: true,
        services: {
          reportService: `/api/reports/weekly/pdf?clientName=${encodeURIComponent(
            clientInfo.name
          )}&startDate=${effectiveStartDate}&endDate=${effectiveEndDate}`,
          pdfService: `/api/reports/dashboard-pdf?clientName=${encodeURIComponent(
            clientInfo.name
          )}&startDate=${effectiveStartDate}&endDate=${effectiveEndDate}`,
        },
      },
    });
  } catch (error) {
    console.error("❌ Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * 📋 Get Weekly Report — alias for getPatrolReport
 */
const getWeeklyReport = async (req, res) => {
  try {
    return await getPatrolReport(req, res);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching weekly report",
      error: error.message,
    });
  }
};

/**
 * 🔄 Get available shifts and schedule configuration
 */
const getClientShifts = async (req, res) => {
  try {
    const client = req.query.client || req.params.client;
    if (!client)
      return res
        .status(400)
        .json({ success: false, message: "Client parameter is required" });

    const clientInfo = await getClientInfo(client);
    if (!clientInfo)
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });

    const schedule        = await patrolScheduleManager.getClientSchedule(clientInfo.id);
    const availableShifts = JSON.parse(JSON.stringify(AVAILABLE_SHIFTS));

    if (schedule?.shift_type) {
      const normalizedShift = schedule.shift_type
        .toLowerCase()
        .replace(/\s+/g, "_");
      let defaultShift = "Day/Night";
      if (normalizedShift.includes("day") && normalizedShift.includes("night"))
        defaultShift = "Day/Night";
      else if (normalizedShift.includes("night")) defaultShift = "Night";
      else if (normalizedShift.includes("day"))   defaultShift = "Day";
      availableShifts.forEach(
        (shift) => (shift.default = shift.value === defaultShift)
      );
    } else {
      availableShifts[0].default = true;
    }

    const weeklyTotal = schedule
      ? calculateWeeklyTotal(
          schedule.patrols_per_day,
          schedule.weekend_patrols_per_day,
          schedule.patrol_days
        )
      : 0;

    res.json({
      success:      true,
      clientId:     clientInfo.id,
      clientName:   clientInfo.name,
      clientSource: clientInfo.source,
      schedule:     schedule
        ? {
            patrolsPerDay:    schedule.patrols_per_day,
            patrolDays:       schedule.patrol_days,
            scheduleType:     schedule.schedule_type,
            weekendPatrols:   schedule.weekend_patrols_per_day,
            weeklyTotal,
            shiftType:        schedule.shift_type,
            hasCustomSchedule: schedule.has_custom_schedule,
            configSource:      schedule.config_source,
          }
        : null,
      availableShifts,
      hasSchedule: !!schedule,
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

// =====================================================
// 📧 MANUAL REPORT TRIGGER (ENHANCED with patrol schedule)
// =====================================================

/**
 * 🚀 Manual report trigger that respects client's patrol schedule
 */
const triggerManualReport = async (req, res) => {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 MANUAL REPORT TRIGGER RECEIVED');
  console.log('='.repeat(70));

  try {
    const { 
      clientId, 
      recipientEmail, 
      startDate, 
      endDate, 
      reportPeriod = 'previousWeek' 
    } = req.body;

    if (!clientId || !recipientEmail) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: clientId and recipientEmail are required',
      });
    }

    console.log(`📋 Manual report: clientId=${clientId}, period=${reportPeriod}`);

    // Calculate date range
    let dateRange;
    if (startDate && endDate) {
      dateRange = { startDate, endDate };
    } else {
      // Default to previous week
      const end = dayjs().tz(TZ);
      const start = end.subtract(7, 'day');
      dateRange = {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
      };
    }

    const finalStartDate = dateRange.startDate;
    const finalEndDate = dateRange.endDate;

    // Get client info
    const clientInfo = await getClientInfo(clientId);
    if (!clientInfo) {
      return res.status(404).json({
        success: false,
        message: `Client ${clientId} not found`,
      });
    }

    // ✅ Get client's patrol schedule
    const schedule = await patrolScheduleManager.getClientSchedule(clientInfo.id);
    const expectedPatrols = calculateExpectedPatrolsForRange(schedule, finalStartDate, finalEndDate);

    console.log(`📊 Using patrol schedule for ${clientInfo.name}:`);
    console.log(`   - Patrols/day: ${schedule?.patrols_per_day || 11}`);
    console.log(`   - Patrol days: ${schedule?.patrol_days || 'Mon,Tue,Wed,Thu,Fri,Sat,Sun'}`);
    console.log(`   - Expected patrols: ${expectedPatrols}`);

    // Generate PDF
    const pdfResult = await generatePDFReport({
      clientId: clientInfo.id,
      clientName: clientInfo.name,
      startDate: finalStartDate,
      endDate: finalEndDate,
      patrolSchedule: schedule,
      expectedPatrols,
    });

    if (!pdfResult.success || !pdfResult.pdfBuffer) {
      throw new Error(pdfResult.error || 'PDF generation failed');
    }

    console.log(`✅ PDF generated: ${(pdfResult.pdfBuffer.length / 1024).toFixed(2)} KB`);

    // Send email if enabled
    let emailResult = { success: false, error: null };
    
    if (EMAIL_SENDING_ENABLED) {
      try {
        const emailService = require('../service/emailService.js');
        const sendEmailFunc = emailService.sendPatrolReport || 
                              emailService.sendGuardReport ||
                              emailService?.default?.sendPatrolReport;
        
        if (sendEmailFunc) {
          emailResult = await sendEmailFunc({
            to: recipientEmail,
            recipientName: recipientEmail.split('@')[0],
            clientName: clientInfo.name,
            startDate: finalStartDate,
            endDate: finalEndDate,
            pdfBuffer: pdfResult.pdfBuffer,
            pdfFilename: `Security_Report_${clientInfo.name.replace(/\s+/g, '_')}_${finalStartDate}_to_${finalEndDate}.pdf`,
          });
          console.log('✅ Email sent successfully');
        } else {
          emailResult.error = 'Email service method not available';
        }
      } catch (emailErr) {
        console.error('❌ Email failed:', emailErr.message);
        emailResult.error = emailErr.message;
      }
    } else {
      emailResult.error = 'Email sending disabled globally';
    }

    return res.json({
      success: true,
      message: EMAIL_SENDING_ENABLED && emailResult.success 
        ? 'Report generated and email sent successfully'
        : 'Report generated' + (emailResult.error ? ` (email failed: ${emailResult.error})` : ' (email disabled)'),
      data: {
        client: {
          id: clientInfo.id,
          name: clientInfo.name,
          source: clientInfo.source,
        },
        dateRange: {
          start: finalStartDate,
          end: finalEndDate,
        },
        patrolSchedule: {
          patrolsPerDay: schedule?.patrols_per_day || 11,
          patrolDays: schedule?.patrol_days || 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
          weekendPatrols: schedule?.weekend_patrols_per_day || 11,
          expectedPatrols,
          hasCustomSchedule: schedule?.has_custom_schedule || false,
        },
        pdf: {
          generated: true,
          sizeKB: Math.round(pdfResult.pdfBuffer.length / 1024),
        },
        email: {
          enabled: EMAIL_SENDING_ENABLED,
          sent: EMAIL_SENDING_ENABLED && emailResult.success,
          recipient: recipientEmail,
          error: emailResult.error || null,
        },
      },
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
    });
  } catch (error) {
    console.error('❌ Error in triggerManualReport:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate report',
      error: error.message,
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
    });
  }
};

// =====================================================
// 🗓️ PATROL SCHEDULE MANAGEMENT ENDPOINTS
// =====================================================

/**
 * GET /api/reports/patrol-schedule/:clientId
 * Get patrol schedule for a client
 */
const getPatrolSchedule = async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId) || clientId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid client ID' });
    }

    const result = await patrolScheduleManager.getPatrolScheduleConfig(clientId);
    
    if (!result.success) {
      return res.status(404).json({ success: false, message: result.error || 'Schedule not found' });
    }

    res.status(200).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error('❌ Error getting patrol schedule:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

/**
 * PUT /api/reports/patrol-schedule/:clientId
 * Create or update patrol schedule for a client
 */
const upsertPatrolSchedule = async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId) || clientId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid client ID' });
    }

    const {
      patrolsPerDay,
      patrolDays,
      scheduleType = 'daily',
      weekendPatrols,
      customIntervalDays,
      shiftType = 'Day/Night',
    } = req.body;

    if (!patrolsPerDay || patrolsPerDay < 1) {
      return res.status(400).json({ success: false, message: 'patrolsPerDay must be at least 1' });
    }

    const result = await patrolScheduleManager.upsertPatrolSchedule(clientId, {
      patrolsPerDay,
      patrolDays,
      scheduleType,
      weekendPatrols,
      customIntervalDays,
      shiftType,
    });

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error('❌ Error upserting patrol schedule:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

/**
 * DELETE /api/reports/patrol-schedule/:clientId
 * Delete patrol schedule for a client
 */
const deletePatrolSchedule = async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId) || clientId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid client ID' });
    }

    const result = await patrolScheduleManager.deletePatrolSchedule(clientId);
    
    if (!result.success) {
      return res.status(404).json({ success: false, message: result.error });
    }

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error('❌ Error deleting patrol schedule:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

/**
 * GET /api/reports/patrol-schedules
 * List all clients with their patrol schedules
 */
const listAllPatrolSchedules = async (req, res) => {
  try {
    const schedules = await patrolScheduleManager.listAllSchedules();
    
    res.status(200).json({
      success: true,
      total: schedules.length,
      data: schedules,
    });
  } catch (error) {
    console.error('❌ Error listing patrol schedules:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

/**
 * GET /api/reports/patrol-schedule/:clientId/analytics
 * Get client analytics with patrol schedule info
 */
const getPatrolAnalytics = async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    const daysRange = parseInt(req.query.days) || 30;
    
    if (isNaN(clientId) || clientId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid client ID' });
    }

    const analytics = await patrolScheduleManager.getClientAnalytics(clientId, daysRange);
    
    if (!analytics) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    console.error('❌ Error getting client analytics:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// =====================================================
// 🗂️ GOOGLE DRIVE ARCHIVE METHODS
// =====================================================

/**
 * GET /api/reports/archive/clients
 */
const getArchiveClients = async (req, res) => {
  try {
    if (!ARCHIVE_ROOT) {
      return res.status(500).json({
        success: false,
        error: "ARCHIVE_ROOT_FOLDER_ID is not configured in environment variables",
      });
    }

    console.log(`🗂️ [ARCHIVE] Building archive client list...`);

    let driveFolders = [];
    try {
      const drive  = getDrive();
      driveFolders = await listFolderContents(
        drive,
        ARCHIVE_ROOT,
        "application/vnd.google-apps.folder"
      );
      console.log(`   Google Drive: found ${driveFolders.length} top-level folders`);
    } catch (driveErr) {
      console.warn(`   ⚠️ Could not read Google Drive folders: ${driveErr.message}`);
    }

    const driveMap = {};
    for (const f of driveFolders) {
      driveMap[f.name.trim().toUpperCase()] = { id: f.id, name: f.name };
    }

    const clients = await getAllClients();

    console.log(`✅ [ARCHIVE] ${clients.length} clients from API/DB, cross-referencing with Drive...`);

    const enriched = clients.map((c) => {
      const key    = (c.name || "").trim().toUpperCase();
      const folder = driveMap[key] || null;
      return {
        id:            c.id,
        name:          c.name,
        displayName:   c.displayName || c.name,
        uniqueKey:     c.uniqueKey,
        accountNumber: c.accountNumber || null,
        source:        c.source,
        hasArchive:    !!folder,
        archiveFolderId: folder ? folder.id   : null,
        archiveFolderName: folder ? folder.name : null,
      };
    });

    const withArchive    = enriched.filter((c) => c.hasArchive).length;
    const withoutArchive = enriched.length - withArchive;

    console.log(`✅ [ARCHIVE] ${withArchive} clients have archived folders, ${withoutArchive} do not`);

    return res.json({
      success: true,
      count:   enriched.length,
      stats: {
        total:       enriched.length,
        withArchive,
        withoutArchive,
      },
      clients: enriched,
    });
  } catch (err) {
    console.error("[ARCHIVE] getArchiveClients error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/reports/archive/months?client=ABSA
 */
const getArchiveMonths = async (req, res) => {
  try {
    const { client } = req.query;

    if (!client) {
      return res.status(400).json({
        success: false,
        error: "client query parameter is required",
      });
    }
    if (!ARCHIVE_ROOT) {
      return res.status(500).json({
        success: false,
        error: "ARCHIVE_ROOT_FOLDER_ID is not configured",
      });
    }

    console.log(`🗂️ [ARCHIVE] Listing months for client: ${client}`);

    const drive         = getDrive();
    const clientFolders = await listFolderContents(
      drive,
      ARCHIVE_ROOT,
      "application/vnd.google-apps.folder"
    );
    const clientFolder  = clientFolders.find(
      (f) => f.name.trim().toUpperCase() === client.trim().toUpperCase()
    );

    if (!clientFolder) {
      console.log(`⚠️ [ARCHIVE] Client folder not found: ${client}`);
      return res.json({ success: true, months: [] });
    }

    const monthFolders = await listFolderContents(
      drive,
      clientFolder.id,
      "application/vnd.google-apps.folder"
    );
    const months = monthFolders.map((f) => f.name).sort().reverse();

    console.log(`✅ [ARCHIVE] Found ${months.length} month folders for ${client}`);
    return res.json({ success: true, months });
  } catch (err) {
    console.error("[ARCHIVE] getArchiveMonths error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/reports/archive/list?client=ABSA&month=2024-01
 */
const getArchiveList = async (req, res) => {
  try {
    const { client, month } = req.query;

    if (!client) {
      return res.status(400).json({
        success: false,
        error: "client query parameter is required",
      });
    }
    if (!ARCHIVE_ROOT) {
      return res.status(500).json({
        success: false,
        error: "ARCHIVE_ROOT_FOLDER_ID is not configured",
      });
    }

    console.log(`🗂️ [ARCHIVE] Listing files — client: ${client}, month: ${month || "all"}`);

    const drive         = getDrive();
    const clientFolders = await listFolderContents(
      drive,
      ARCHIVE_ROOT,
      "application/vnd.google-apps.folder"
    );
    const clientFolder  = clientFolders.find(
      (f) => f.name.trim().toUpperCase() === client.trim().toUpperCase()
    );

    if (!clientFolder) {
      console.log(`⚠️ [ARCHIVE] Client folder not found: ${client}`);
      return res.json({ success: true, reports: [] });
    }

    let rawFiles = [];

    if (month) {
      const monthFolders = await listFolderContents(
        drive,
        clientFolder.id,
        "application/vnd.google-apps.folder"
      );
      const monthFolder = monthFolders.find((f) => f.name === month);

      if (monthFolder) {
        const files = await listFolderContents(drive, monthFolder.id);
        rawFiles    = files.map((f) => ({ ...f, month }));
      }
    } else {
      const monthFolders = await listFolderContents(
        drive,
        clientFolder.id,
        "application/vnd.google-apps.folder"
      );

      for (const mf of monthFolders) {
        const files = await listFolderContents(drive, mf.id);
        rawFiles.push(...files.map((f) => ({ ...f, month: mf.name })));
      }
    }

    const reports = rawFiles.map((f) => ({
      id:          f.id,
      name:        f.name,
      month:       f.month || month || null,
      size:        f.size  || null,
      createdTime: f.createdTime || null,
      mimeType:    f.mimeType,
    }));

    console.log(`✅ [ARCHIVE] Found ${reports.length} files for ${client}${month ? ` / ${month}` : ""}`);
    return res.json({ success: true, reports });
  } catch (err) {
    console.error("[ARCHIVE] getArchiveList error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/reports/archive/download/:fileId
 */
const downloadArchiveFile = async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!fileId) {
      return res
        .status(400)
        .json({ success: false, error: "fileId is required" });
    }

    console.log(`⬇️ [ARCHIVE] Downloading file: ${fileId}`);

    const drive = getDrive();

    const meta     = await drive.files.get({ fileId, fields: "name, mimeType" });
    const fileName = meta.data.name  || `report-${fileId}.pdf`;
    const mimeType = meta.data.mimeType || "application/pdf";

    const fileStream = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`
    );
    res.setHeader("Content-Type", mimeType);

    fileStream.data.pipe(res);

    fileStream.data.on("error", (streamErr) => {
      console.error("[ARCHIVE] Stream error:", streamErr.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "File stream error" });
      }
    });

    fileStream.data.on("end", () => {
      console.log(`✅ [ARCHIVE] File streamed successfully: ${fileName}`);
    });
  } catch (err) {
    console.error("[ARCHIVE] downloadArchiveFile error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
};

/**
 * DELETE /api/reports/archive/:fileId
 */
const deleteArchiveFile = async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!fileId) {
      return res
        .status(400)
        .json({ success: false, error: "fileId is required" });
    }

    console.log(`🗑️ [ARCHIVE] Trashing file: ${fileId}`);

    const drive = getDrive();

    await drive.files.update({
      fileId,
      requestBody: { trashed: true },
    });

    console.log(`✅ [ARCHIVE] File moved to trash: ${fileId}`);
    return res.json({
      success: true,
      message: "File moved to trash. Recoverable from Google Drive within 30 days.",
    });
  } catch (err) {
    console.error("[ARCHIVE] deleteArchiveFile error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// =====================================================
// 🧪 DEBUG / TESTING METHODS
// =====================================================

/**
 * 🧪 DEBUG: Zone name verification endpoint
 */
const debugZoneNames = async (req, res) => {
  try {
    const { clientId, clientName } = req.query;

    let clientInfo;
    if (clientId)        clientInfo = await getClientInfo(clientId);
    else if (clientName) clientInfo = await getClientInfo(clientName);
    else
      return res
        .status(400)
        .json({ success: false, message: "Either clientId or clientName is required" });

    if (!clientInfo)
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });

    const { fetchZoneData } = require("../models/reportModel.js");
    const zoneData = await fetchZoneData(clientInfo.id);

    const testEndDate   = dayjs().format("YYYY-MM-DD");
    const testStartDate = dayjs().subtract(1, "day").format("YYYY-MM-DD");

    const reportData = await fetchPatrolReport(
      clientInfo.id,
      testStartDate,
      testEndDate,
      true,
      "custom"
    );

    res.json({
      success: true,
      client: clientInfo,
      zoneData: {
        source:     zoneData.source,
        totalZones: zoneData.allPosts.length,
        zones:      zoneData.allPosts
          .slice(0, 20)
          .map((z) => ({ code: z.zoneCode, name: z.zoneName, id: z.zoneId })),
        mapKeys: Array.from(zoneData.zoneMap.keys()).slice(0, 30),
      },
      reportSample: {
        posts:  reportData.posts?.slice(0, 10).map((p) => ({
          code:      p.ZoneCode,
          name:      p.SecurityPost,
          completed: p.Completed,
          expected:  p.Expected,
        })),
        events: reportData.events?.slice(0, 5).map((e) => ({
          date:     e.Date,
          time:     e.Time,
          zoneCode: e.ZoneCode,
          zoneName: e.Zone,
          event:    e.Event,
        })),
      },
      hasGenericNames:
        reportData.posts?.some(
          (p) =>
            p.SecurityPost?.startsWith("Security Post") ||
            p.SecurityPost?.includes("UNKNOWN")
        ) || false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Debug error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 🧪 Test PDF services
 */
const testPDFServices = async (req, res) => {
  try {
    const { clientName, startDate, endDate } = req.query;

    if (!clientName)
      return res
        .status(400)
        .json({ success: false, message: "Client Name is required for testing" });

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo)
      return res
        .status(404)
        .json({ success: false, message: `Client not found: ${clientName}` });

    const testStartDate = startDate || dayjs().subtract(7, "day").format("YYYY-MM-DD");
    const testEndDate   = endDate   || dayjs().format("YYYY-MM-DD");

    const results = {
      reportService: { success: false, size: 0, error: null },
      pdfService:    { success: false, size: 0, error: null },
    };

    try {
      const buf = await generateWeeklyReportPDF(
        clientInfo.id,
        testStartDate,
        testEndDate
      );
      results.reportService = {
        success: !!buf,
        size:    buf ? buf.length : 0,
        service: "reportService.js",
      };
    } catch (e) {
      results.reportService.error = e.message;
    }

    try {
      const schedule = await patrolScheduleManager.getClientSchedule(clientInfo.id);
      const expectedPatrols = calculateExpectedPatrolsForRange(schedule, testStartDate, testEndDate);
      
      const r = await generatePDFReport({
        clientId:   clientInfo.id,
        clientName: clientInfo.name,
        startDate:  testStartDate,
        endDate:    testEndDate,
        patrolSchedule: schedule,
        expectedPatrols,
      });
      results.pdfService = {
        success:  r.success,
        size:     r.pdfBuffer ? r.pdfBuffer.length : 0,
        service:  "pdfService.js",
        metadata: r.metadata,
      };
    } catch (e) {
      results.pdfService.error = e.message;
    }

    res.json({
      success: true,
      client: { id: clientInfo.id, name: clientInfo.name, source: clientInfo.source },
      period: { startDate: testStartDate, endDate: testEndDate },
      pdfServices: results,
      recommendations: [
        results.reportService.success
          ? "✅ reportService.js is working"
          : "❌ reportService.js failed",
        results.pdfService.success
          ? "✅ pdfService.js is working"
          : "❌ pdfService.js failed",
      ],
    });
  } catch (error) {
    console.error("❌ Test PDF Services Error:", error);
    res.status(500).json({
      success: false,
      message: "Test failed",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * 🧪 Test report data
 */
const testReportData = async (req, res) => {
  try {
    const { clientName, startDate, endDate } = req.query;

    if (!clientName)
      return res
        .status(400)
        .json({ success: false, message: "Client Name is required for testing" });

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo)
      return res
        .status(404)
        .json({ success: false, message: `Client not found: ${clientName}` });

    const testStartDate = startDate || dayjs().subtract(7, "day").format("YYYY-MM-DD");
    const testEndDate   = endDate   || dayjs().format("YYYY-MM-DD");

    const reportData = await fetchPatrolReport(
      clientInfo.id,
      testStartDate,
      testEndDate,
      true,
      "custom"
    );
    const schedule = await patrolScheduleManager.getClientSchedule(clientInfo.id);
    const expectedPatrols = calculateExpectedPatrolsForRange(schedule, testStartDate, testEndDate);

    res.json({
      success: true,
      testTimestamp: new Date().toISOString(),
      client: {
        id:     clientInfo.id,
        name:   clientInfo.name,
        source: clientInfo.source,
        valid:  true,
      },
      period: { startDate: testStartDate, endDate: testEndDate },
      analysis: {
        zoneData: {
          source:       reportData.metadata.zoneSource,
          totalZones:   reportData.posts?.length || 0,
          genericZones: reportData.posts?.filter(
            (p) =>
              p.SecurityPost?.startsWith("Security Post") ||
              p.SecurityPost?.includes("UNKNOWN")
          ).length || 0,
          sampleZones: reportData.posts
            ?.slice(0, 5)
            .map((p) => ({ code: p.ZoneCode, name: p.SecurityPost })) || [],
        },
        eventData: {
          total: reportData.events?.length || 0,
          unknownZoneEvents: reportData.events?.filter(
            (e) =>
              e.Zone === "UNKNOWN_ZONE" || e.Zone?.includes("UNKNOWN")
          ).length || 0,
        },
        schedule: schedule
          ? {
              configured:   true,
              patrolsPerDay: schedule.patrols_per_day,
              shiftType:    schedule.shift_type,
              expectedPatrols,
            }
          : { configured: false, expectedPatrols: 0 },
        metadata: {
          overallPerformance: reportData.metadata?.overallPatrolPerformance,
          patrolSource:       reportData.metadata?.patrolSource,
          zoneSource:         reportData.metadata?.zoneSource,
        },
      },
    });
  } catch (error) {
    console.error("❌ Test Error:", error);
    res.status(500).json({
      success: false,
      message: "Test failed",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * 🧪 Test report generation
 */
const testReportGeneration = async (req, res) => {
  try {
    const { clientName }         = req.params;
    const { startDate, endDate } = req.body || req.query;

    if (!clientName)
      return res
        .status(400)
        .json({ success: false, message: "Client Name is required" });

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo)
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });

    const testStartDate = startDate || dayjs().subtract(7, "day").format("YYYY-MM-DD");
    const testEndDate   = endDate   || dayjs().format("YYYY-MM-DD");

    const reportData = await fetchPatrolReport(
      clientInfo.id,
      testStartDate,
      testEndDate,
      true,
      "custom"
    );

    let pdfTestReport    = { success: false, message: "Not attempted" };
    let pdfTestDashboard = { success: false, message: "Not attempted" };

    try {
      const buf = await generateWeeklyReportPDF(
        clientInfo.id,
        testStartDate,
        testEndDate
      );
      pdfTestReport = {
        success: !!buf,
        message: buf ? "PDF generated successfully" : "No data",
        size:    buf ? buf.length : 0,
        service: "reportService.js",
      };
    } catch (e) {
      pdfTestReport = {
        success: false,
        message: e.message,
        service: "reportService.js",
      };
    }

    try {
      const schedule = await patrolScheduleManager.getClientSchedule(clientInfo.id);
      const expectedPatrols = calculateExpectedPatrolsForRange(schedule, testStartDate, testEndDate);
      
      const r = await generatePDFReport({
        clientId:   clientInfo.id,
        clientName: clientInfo.name,
        startDate:  testStartDate,
        endDate:    testEndDate,
        patrolSchedule: schedule,
        expectedPatrols,
      });
      pdfTestDashboard = {
        success: r.success,
        message: r.success ? "Dashboard PDF generated" : "Dashboard PDF failed",
        size:    r.pdfBuffer ? r.pdfBuffer.length : 0,
        service: "pdfService.js",
      };
    } catch (e) {
      pdfTestDashboard = {
        success: false,
        message: e.message,
        service: "pdfService.js",
      };
    }

    res.json({
      success: true,
      testDetails: {
        client: { id: clientInfo.id, name: clientInfo.name, source: clientInfo.source },
        period: { startDate: testStartDate, endDate: testEndDate },
        dataFetch: {
          success:    reportData.metadata.success !== false,
          postsCount: reportData.posts?.length  || 0,
          eventsCount: reportData.events?.length || 0,
          zoneSource: reportData.metadata.zoneSource,
        },
        pdfGeneration: {
          reportService: pdfTestReport,
          pdfService:    pdfTestDashboard,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error testing report generation:", error);
    res.status(500).json({
      success: false,
      message: "Error testing report generation",
      error: error.message,
    });
  }
};

/**
 * 📊 Get comprehensive client report
 */
const getComprehensiveClientReport = async (req, res) => {
  try {
    const { clientName } = req.params;
    const { period = "last7days", customStart, customEnd } = req.query;

    if (!clientName)
      return res
        .status(400)
        .json({ success: false, message: "Client Name is required" });

    let startDate, endDate;
    const today = new Date();

    switch (period) {
      case "last30days":
        startDate = new Date(today.getTime() - 30 * 86400000);
        endDate   = today;
        break;
      case "last90days":
        startDate = new Date(today.getTime() - 90 * 86400000);
        endDate   = today;
        break;
      case "custom":
        if (!customStart || !customEnd)
          return res.status(400).json({
            success: false,
            message: "Custom period requires customStart and customEnd",
          });
        startDate = new Date(customStart);
        endDate   = new Date(customEnd);
        break;
      default:
        startDate = new Date(today.getTime() - 7 * 86400000);
        endDate   = today;
    }

    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr   = endDate.toISOString().split("T")[0];

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo)
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });

    const schedule   = await patrolScheduleManager.getClientSchedule(clientInfo.id);
    const expectedPatrols = calculateExpectedPatrolsForRange(schedule, startDateStr, endDateStr);
    
    const reportData = await fetchPatrolReport(
      clientInfo.id,
      startDateStr,
      endDateStr,
      true,
      "custom"
    );

    if (!reportData.metadata.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch report data",
        error: reportData.metadata.error?.message,
      });
    }

    res.json({
      success: true,
      client: { id: clientInfo.id, name: clientInfo.name, source: clientInfo.source },
      period: {
        type:  period,
        start: startDateStr,
        end:   endDateStr,
        days:  Math.ceil((endDate - startDate) / 86400000),
      },
      schedule: schedule
        ? {
            patrolsPerDay: schedule.patrols_per_day,
            shiftType:     schedule.shift_type,
            patrolDays:    schedule.patrol_days,
            expectedPatrols,
            weeklyTotal:   calculateWeeklyTotal(
              schedule.patrols_per_day,
              schedule.weekend_patrols_per_day,
              schedule.patrol_days
            ),
          }
        : null,
      data: {
        postsCount:         reportData.posts?.length        || 0,
        eventsCount:        reportData.events?.length       || 0,
        guardReportsCount:  reportData.guardReports?.length || 0,
        overallPerformance: reportData.metadata.overallPatrolPerformance,
        zoneSource:         reportData.metadata.zoneSource,
      },
      pdfEndpoints: {
        weeklyReport: `/api/reports/weekly/pdf?clientName=${encodeURIComponent(
          clientName
        )}&startDate=${startDateStr}&endDate=${endDateStr}`,
        dashboardPDF: `/api/reports/dashboard-pdf?clientName=${encodeURIComponent(
          clientName
        )}&startDate=${startDateStr}&endDate=${endDateStr}`,
      },
      timestamp: new Date().toISOString(),
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
    const { clientName }     = req.params;
    const { months = 6 }     = req.query;

    if (!clientName)
      return res
        .status(400)
        .json({ success: false, message: "Client Name is required" });

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo)
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });

    const schedule  = await patrolScheduleManager.getClientSchedule(clientInfo.id);
    const trends    = [];
    const today     = new Date();
    const monthsInt = parseInt(months);

    for (let i = 0; i < monthsInt; i++) {
      const monthDate  = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const monthEnd   = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
      
      const startStr = monthStart.toISOString().split("T")[0];
      const endStr = monthEnd.toISOString().split("T")[0];
      
      const monthExpected = calculateExpectedPatrolsForRange(schedule, startStr, endStr);

      const monthData = await fetchPatrolReport(
        clientInfo.id,
        startStr,
        endStr,
        true,
        "custom"
      );

      trends.push({
        month:  monthDate.toLocaleString("default", {
          month: "long",
          year:  "numeric",
        }),
        period: `${startStr} to ${endStr}`,
        expected:       monthExpected || monthData.metadata?.totalExpectedPatrols || 0,
        completed:      monthData.metadata?.totalCompletedPatrols || 0,
        performanceRate: monthData.metadata?.overallPatrolPerformance || 0,
        rating:          getPerformanceRating(
          monthData.metadata?.overallPatrolPerformance || 0
        ),
        postsCount: monthData.posts?.length || 0,
        zoneSource: monthData.metadata.zoneSource,
      });
    }

    trends.reverse();

    res.json({
      success: true,
      client: { id: clientInfo.id, name: clientInfo.name, source: clientInfo.source },
      period: {
        months: monthsInt,
        start:  trends[0]?.period.split(" to ")[0],
        end:    trends[trends.length - 1]?.period.split(" to ")[1],
      },
      schedule: schedule
        ? { patrolsPerDay: schedule.patrols_per_day, shiftType: schedule.shift_type }
        : null,
      trends,
      summary: {
        averagePerformance: (
          trends.reduce((s, m) => s + parseFloat(m.performanceRate), 0) /
          trends.length
        ).toFixed(1),
        totalCompleted: trends.reduce((s, m) => s + m.completed, 0),
        bestMonth:  trends.reduce(
          (best, m) =>
            parseFloat(m.performanceRate) > parseFloat(best.performanceRate)
              ? m
              : best,
          trends[0]
        ),
        worstMonth: trends.reduce(
          (worst, m) =>
            parseFloat(m.performanceRate) < parseFloat(worst.performanceRate)
              ? m
              : worst,
          trends[0]
        ),
      },
      timestamp: new Date().toISOString(),
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
      count:   clients.length,
      clients: clients.map((c) => ({
        id:          c.id,
        name:        c.name,
        displayName: c.displayName || c.name,
        uniqueKey:   c.uniqueKey,
        source:      c.source,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error getting clients list:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching clients list",
      error: error.message,
    });
  }
};

/**
 * 🔍 Search clients by name
 */
const searchClients = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.length < 2)
      return res.status(400).json({
        success: false,
        message: "Search query must be at least 2 characters long",
      });

    try {
      const apiClients = await bmSecurityAPI.getClients();
      const filtered   = apiClients
        .filter(
          (c) =>
            c.name &&
            c.name.toUpperCase().includes(query.toUpperCase())
        )
        .map((c) => ({
          id:            c.id,
          name:          c.name,
          accountNumber: c.accountNumber,
          source:        "API",
        }));

      const deduped = deduplicateClientNames(filtered);
      if (deduped.length > 0)
        return res.json({
          success: true,
          count:   deduped.length,
          clients: deduped,
          source:  "API",
          timestamp: new Date().toISOString(),
        });
    } catch (apiError) {
      console.log(`⚠️ API search failed: ${apiError.message}`);
    }

    const pool   = await poolPromise;
    const result = await pool
      .request()
      .input("searchQuery", sql.NVarChar, `%${query}%`)
      .query(`
        SELECT cue_iid AS id, LTRIM(RTRIM(cue_cnombre)) AS name
        FROM [_Datos].[dbo].[m_cuentas]
        WHERE cue_cnombre LIKE @searchQuery
          AND cue_cnombre IS NOT NULL
          AND cue_cnombre != ''
        ORDER BY cue_cnombre
      `);

    const deduped = deduplicateClientNames(
      result.recordset.map((c) => ({ ...c, source: "DATABASE" }))
    );

    res.json({
      success: true,
      count:   deduped.length,
      clients: deduped,
      source:  "DATABASE",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error searching clients:", error);
    res.status(500).json({
      success: false,
      message: "Error searching clients",
      error: error.message,
    });
  }
};

/**
 * 🧪 Debug performance calculations
 */
const debugPerformanceCalc = async (req, res) => {
  try {
    const { clientName, startDate, endDate } = req.query;

    if (!clientName)
      return res
        .status(400)
        .json({ success: false, message: "clientName is required" });

    const clientInfo = await getClientInfo(clientName);
    if (!clientInfo)
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });

    const schedule = await patrolScheduleManager.getClientSchedule(clientInfo.id);
    const effectiveStartDate = startDate || dayjs().subtract(7, "day").format("YYYY-MM-DD");
    const effectiveEndDate = endDate || dayjs().format("YYYY-MM-DD");
    const expectedPatrols = calculateExpectedPatrolsForRange(schedule, effectiveStartDate, effectiveEndDate);

    const reportData = await fetchPatrolReport(
      clientInfo.id,
      effectiveStartDate,
      effectiveEndDate,
      true,
      "custom"
    );

    res.json({
      success: true,
      debug: {
        client:           reportData.metadata.clientName,
        schedule: schedule ? {
          patrolsPerDay: schedule.patrols_per_day,
          patrolDays: schedule.patrol_days,
          weekendPatrols: schedule.weekend_patrols_per_day,
        } : null,
        calculatedExpected: expectedPatrols,
        reportExpected: reportData.metadata.totalExpectedPatrols,
        totalCompleted:   reportData.metadata.totalCompletedPatrols,
        completionRate:   `${reportData.metadata.overallPatrolPerformance}%`,
        performanceRating: getPerformanceRating(
          reportData.metadata.overallPatrolPerformance
        ),
        validZoneCount: reportData.posts.length,
        zoneSource:     reportData.metadata.zoneSource,
        patrolSource:   reportData.metadata.patrolSource,
        zones:          reportData.posts.slice(0, 5).map((p) => ({
          name:        p.SecurityPost,
          code:        p.ZoneCode,
          completed:   p.Completed,
          expected:    p.Expected,
          performance: `${p.Performance}%`,
        })),
        dataQuality: reportData.metadata.dataQuality,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * 🏠 Health check endpoint
 */
const healthCheck = async (req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request().query("SELECT 1 as test");

    const testData = await fetchPatrolReport(
      1001,
      dayjs().subtract(1, "day").format("YYYY-MM-DD"),
      dayjs().format("YYYY-MM-DD"),
      true,
      "custom"
    );

    res.json({
      success: true,
      message: "Report controller is healthy ✅",
      timestamp: new Date().toISOString(),
      database: "Connected",
      services: {
        pdfService:  "reportService.js",
        pdfService2: "pdfService.js",
        dataModel:   "reportModel.js",
        scheduleManager: "managePatrolSchedules.js",
        archive:     "Google Drive",
      },
      archiveConfig: {
        rootFolderConfigured: !!ARCHIVE_ROOT,
        credentialSource: process.env.GOOGLE_SERVICE_ACCOUNT_KEY
          ? "GOOGLE_SERVICE_ACCOUNT_KEY"
          : process.env.GOOGLE_SERVICE_ACCOUNT_JSON
          ? "GOOGLE_SERVICE_ACCOUNT_JSON"
          : process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
          ? "GOOGLE_SERVICE_ACCOUNT_KEY_FILE"
          : "NOT_CONFIGURED",
      },
      emailConfig: {
        enabled: EMAIL_SENDING_ENABLED,
      },
      zoneNameStatus: {
        zoneSource: testData.metadata.zoneSource || "Unknown",
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Health check failed",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

// =====================================================
// 🎯 EXPORTS
// =====================================================

module.exports = {
  // PDF endpoints
  getWeeklyReportPDF,
  getDashboardPDF,
  getComprehensivePDF,

  // Data endpoints
  getPatrolReport,
  getWeeklyReport,
  getClientShifts,

  // Manual report trigger
  triggerManualReport,

  // Patrol Schedule Management
  getPatrolSchedule,
  upsertPatrolSchedule,
  deletePatrolSchedule,
  listAllPatrolSchedules,
  getPatrolAnalytics,

  // Archive (Google Drive)
  getArchiveClients,
  getArchiveMonths,
  getArchiveList,
  downloadArchiveFile,
  deleteArchiveFile,

  // Client endpoints
  getAllClientsList,
  searchClients,
  getComprehensiveClientReport,
  getClientPerformanceTrends,

  // Debug / testing
  debugZoneNames,
  testReportData,
  testReportGeneration,
  testPDFServices,
  debugPerformanceCalc,
  healthCheck,

  // Helpers (exported for reuse)
  calculateWeeklyTotal,
  calculateExpectedPatrolsForRange,
  getPerformanceRating,
  getPerformanceStatus,
  getShiftDescription,
  deduplicateClientNames,
  getClientInfo,
  getAllClients,
};

module.exports.default = module.exports;