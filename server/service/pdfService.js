import PDFDocument from "pdfkit";
import { sql, poolPromise } from "../config/database.js";
import dayjs from "dayjs";
import { getClientSchedule } from "../scripts/managePatrolSchedules.js";

/**
 * 🔧 Helper: Normalize shift type
 */
function normalizeShiftType(shiftType) {
  if (!shiftType) return "day_night";
  const normalized = shiftType.toLowerCase().replace(/\s+/g, "_").replace(/\//g, "_");
  if (normalized.includes("day") && normalized.includes("night")) return "day_night";
  if (normalized.includes("night")) return "night";
  if (normalized.includes("day")) return "day";
  return "day_night";
}

/**
 * 🔧 Helper: Get user-friendly shift label
 */
function getShiftLabel(shiftType) {
  const normalized = normalizeShiftType(shiftType);
  switch (normalized) {
    case "day": return "Day Shift (6:00-17:59)";
    case "night": return "Night Shift (18:00-5:59)";
    case "day_night": 
    default: return "All Shifts";
  }
}

/**
 * 🔧 Helper: Build time condition for SQL
 */
function buildTimeCondition(shiftType) {
  const normalized = normalizeShiftType(shiftType);
  switch (normalized) {
    case "day":
      return "AND DATEPART(HOUR, r.rec_tfechahora) BETWEEN 6 AND 17";
    case "night":
      return "AND (DATEPART(HOUR, r.rec_tfechahora) >= 18 OR DATEPART(HOUR, r.rec_tfechahora) < 6)";
    case "day_night":
    default:
      return "";
  }
}

/**
 * 🧮 Calculate expected patrols for each day based on schedule
 */
function calculateDailyExpectedPatrols(date, schedule) {
  if (!schedule) return 11; // Default fallback
  
  const dayOfWeek = dayjs(date).format("ddd");
  const isWeekend = ["Sat", "Sun"].includes(dayOfWeek);
  
  // Check if patrols are scheduled for this day
  const patrolDays = (schedule.patrol_days || "Mon,Tue,Wed,Thu,Fri,Sat,Sun")
    .split(",")
    .map(d => d.trim());
  
  if (!patrolDays.includes(dayOfWeek)) {
    return 0; // No patrols scheduled for this day
  }
  
  // Safe access to weekend patrols
  const weekendCount = schedule.weekend_patrols_per_day ?? null;
  
  // Return appropriate patrol count
  return isWeekend && weekendCount !== null
    ? weekendCount
    : schedule.patrols_per_day;
}

/**
 * 🗓️ Get table names for monthly partitions
 * Returns array of table names if range spans multiple months
 */
function getTableNames(startDate, endDate, usePartitions = true) {
  if (!usePartitions) {
    return ["_Datos.dbo.p_recepcion"];
  }
  
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

/**
 * 🔍 Check if table exists in database
 */
async function checkTableExists(pool, tableName) {
  try {
    const result = await pool.request()
      .input("tableName", sql.NVarChar, tableName.split(".").pop())
      .query(`
        SELECT 1 AS existsFlag
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = PARSENAME(@tableName, 1)
      `);
    return result.recordset.length > 0;
  } catch (error) {
    console.warn(`⚠️ Error checking table ${tableName}:`, error.message);
    return false;
  }
}

/**
 * 🧾 Generate a weekly report PDF with DYNAMIC expected patrols and multi-month support
 * ✅ Fully synchronized with fetchWeeklyReport logic
 * @param {number} clientId
 * @param {string} client - Client name
 * @param {string} startDate
 * @param {string} endDate
 * @param {string} shiftType - "Day", "Night", or "Day/Night"
 * @param {boolean} useMonthlyPartitions - Toggle for partition support
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generateWeeklyReportPDF(
  clientId, 
  client, 
  startDate, 
  endDate, 
  shiftType = "Day/Night",
  useMonthlyPartitions = true
) {
  console.log(`\n🧾 [PDF Generation]`);
  console.log(`   Client: ${client} (ID: ${clientId})`);
  console.log(`   Period: ${startDate} → ${endDate}`);
  console.log(`   Requested Shift: ${shiftType}`);

  try {
    const pool = await poolPromise;
    const start = dayjs(startDate).startOf("day").toDate();
    const end = dayjs(endDate).endOf("day").toDate();

    // 1️⃣ Get table names (handles multi-month ranges)
    const tableNames = getTableNames(start, end, useMonthlyPartitions);
    console.log(`   Using tables: ${tableNames.join(', ')}`);

    // 2️⃣ Verify at least one table exists
    const tableExistsChecks = await Promise.all(
      tableNames.map(table => checkTableExists(pool, table))
    );
    
    const validTables = tableNames.filter((_, index) => tableExistsChecks[index]);
    
    if (validTables.length === 0) {
      console.warn(`⚠️ No valid tables found for date range`);
      return null;
    }

    console.log(`   Valid tables: ${validTables.join(', ')}`);

    // 3️⃣ Get client schedule configuration
    const schedule = await getClientSchedule(clientId);
    
    if (!schedule) {
      console.warn(`⚠️ No schedule found for client ${clientId}, using default fallback (11 patrols/day)`);
    } else {
      console.log(`   ✅ Schedule found:`);
      console.log(`      Patrols/Day: ${schedule.patrols_per_day}`);
      console.log(`      Weekend Patrols: ${schedule.weekend_patrols_per_day ?? schedule.patrols_per_day}`);
      console.log(`      Patrol Days: ${schedule.patrol_days}`);
      console.log(`      Shift Type: ${schedule.shift_type}`);
    }

    // 4️⃣ Determine effective shift type (from schedule or parameter)
    const effectiveShiftType = schedule?.shift_type 
      ? normalizeShiftType(schedule.shift_type)
      : normalizeShiftType(shiftType);
    
    const timeCondition = buildTimeCondition(effectiveShiftType);
    console.log(`   Effective shift: ${getShiftLabel(effectiveShiftType)}`);

    // 5️⃣ Build UNION query for multi-month support
    const buildUnionQuery = (tables) => {
      return tables.map(table => `SELECT * FROM ${table} r`).join('\n          UNION ALL\n          ');
    };

    // 6️⃣ Fetch events data with multi-table support
    const eventsResult = await pool.request()
      .input("clientId", sql.Int, clientId)
      .input("startDate", sql.DateTime, start)
      .input("endDate", sql.DateTime, end)
      .query(`
        SELECT 
          CONVERT(VARCHAR(10), r.rec_tfechahora, 120) AS Date,
          CONVERT(VARCHAR(8), r.rec_tfechahora, 108) AS Time,
          r.rec_czona AS Zone,
          r.rec_cContenido AS Event,
          r.rec_calarma AS Code,
          r.rec_cObservaciones AS Observations
        FROM (
          ${buildUnionQuery(validTables)}
        ) AS r
        WHERE r.rec_iidcuenta = @clientId
          AND r.rec_tfechahora BETWEEN @startDate AND @endDate
          ${timeCondition}
        ORDER BY r.rec_tfechahora DESC
      `);

    const events = eventsResult.recordset || [];
    
    if (events.length === 0) {
      console.warn(`⚠️ No events found for ${client}`);
      return null;
    }

    console.log(`   Events found: ${events.length}`);

    // 7️⃣ Fetch patrol counts per day
    const patrolsResult = await pool.request()
      .input("clientId", sql.Int, clientId)
      .input("startDate", sql.DateTime, start)
      .input("endDate", sql.DateTime, end)
      .query(`
        SELECT 
          CAST(r.rec_tfechahora AS DATE) AS PatrolDate,
          COUNT(*) AS PatrolCount
        FROM (
          ${buildUnionQuery(validTables)}
        ) AS r
        WHERE r.rec_iidcuenta = @clientId
          AND r.rec_tfechahora BETWEEN @startDate AND @endDate
          ${timeCondition}
        GROUP BY CAST(r.rec_tfechahora AS DATE)
        ORDER BY PatrolDate
      `);

    const patrolData = patrolsResult.recordset || [];

    // 8️⃣ ✅ Calculate daily summary with SCHEDULE-AWARE expected counts
    const dailySummary = patrolData.map(row => {
      const expected = calculateDailyExpectedPatrols(row.PatrolDate, schedule);
      const variance = row.PatrolCount - expected;
      const status = variance >= 0 ? "✅ OK" : "⚠️ Missed";

      return {
        date: dayjs(row.PatrolDate).format("YYYY-MM-DD"),
        day: dayjs(row.PatrolDate).format("ddd"),
        expected,
        actual: row.PatrolCount,
        variance,
        status
      };
    });

    // Log calculations for verification
    console.log(`   Daily Summary Calculations:`);
    dailySummary.forEach(day => {
      console.log(`      ${day.date} (${day.day}): Expected=${day.expected}, Actual=${day.actual}, Variance=${day.variance}`);
    });

    // 9️⃣ ✅ Calculate total expected from daily summary (DYNAMIC)
    const totalExpectedForPeriod = dailySummary.reduce((sum, day) => sum + day.expected, 0);
    console.log(`   📊 Total Expected Patrols (calculated): ${totalExpectedForPeriod}`);

    // 🔟 Fetch zone performance summary using DYNAMIC expected
    const summaryResult = await pool.request()
      .input("clientId", sql.Int, clientId)
      .input("startDate", sql.DateTime, start)
      .input("endDate", sql.DateTime, end)
      .input("totalExpected", sql.Int, totalExpectedForPeriod || 1)
      .query(`
        SELECT 
          ISNULL(r.rec_czona, 'Unknown') AS SitePosts,
          COUNT(*) AS ChecksCompleted,
          @totalExpected AS ExpectedChecks,
          CAST(
            (CAST(COUNT(*) AS FLOAT) / NULLIF(@totalExpected, 0)) * 100
            AS DECIMAL(5,1)
          ) AS PerformanceRate
        FROM (
          ${buildUnionQuery(validTables)}
        ) AS r
        WHERE r.rec_iidcuenta = @clientId
          AND r.rec_tfechahora BETWEEN @startDate AND @endDate
          ${timeCondition}
        GROUP BY r.rec_czona
        ORDER BY PerformanceRate DESC
      `);

    const zoneSummary = summaryResult.recordset || [];
    console.log(`   Zone summaries: ${zoneSummary.length}`);

    // 1️⃣1️⃣ Generate PDF document
    const doc = new PDFDocument({ 
      margin: 40, 
      size: "A4",
      info: {
        Title: `Weekly Patrol Report - ${client}`,
        Author: 'Guard Report System',
        Subject: `Patrol Report for ${client}`,
        Keywords: `patrol, report, ${client}, ${getShiftLabel(effectiveShiftType)}`,
        CreationDate: new Date()
      }
    });

    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    const pdfPromise = new Promise((resolve) => 
      doc.on("end", () => resolve(Buffer.concat(buffers)))
    );

    // === HEADER SECTION ===
    doc.fontSize(20).font('Helvetica-Bold')
       .text("Weekly Patrol Report", { align: "center" });
    doc.moveDown();
    
    doc.fontSize(12).font('Helvetica');
    doc.text(`Client: ${client}`);
    doc.text(`Period: ${startDate} → ${endDate}`);
    doc.text(`Report Shift: ${getShiftLabel(effectiveShiftType)}`);
    
    if (validTables.length > 1) {
      doc.fontSize(10).fillColor('blue')
         .text(`Multi-month data: ${validTables.length} tables queried`)
         .fillColor('black');
      doc.fontSize(12);
    }
    
    doc.moveDown(0.5);
    
    // Schedule configuration section
    if (schedule) {
      doc.font('Helvetica-Bold').text("✅ Patrol Schedule Configuration:");
      doc.font('Helvetica');
      doc.text(`• Configured Shift: ${getShiftLabel(schedule.shift_type)}`);
      doc.text(`• Patrols per Weekday: ${schedule.patrols_per_day}`);
      
      const weekendCount = schedule.weekend_patrols_per_day ?? null;
      if (weekendCount !== null && weekendCount !== schedule.patrols_per_day) {
        doc.text(`• Patrols per Weekend Day: ${weekendCount}`);
      }
      
      doc.text(`• Patrol Days: ${schedule.patrol_days}`);
      doc.text(`• Schedule Type: ${schedule.schedule_type.charAt(0).toUpperCase() + schedule.schedule_type.slice(1)}`);
      
      if (schedule.custom_interval_days) {
        doc.text(`• Custom Interval: Every ${schedule.custom_interval_days} days`);
      }
      
      doc.fontSize(10).font('Helvetica-Oblique')
         .text(`Total Expected for Period: ${totalExpectedForPeriod} patrols`, { underline: true });
      doc.fontSize(12).font('Helvetica');
    } else {
      doc.font('Helvetica-Bold').fillColor('orange')
         .text("⚠️ No Patrol Schedule Configured");
      doc.font('Helvetica').fillColor('black');
      doc.fontSize(10).text("Using default fallback: 11 patrols per day");
      doc.text(`Total Expected for Period: ${totalExpectedForPeriod} patrols (estimated)`);
      doc.fontSize(12);
    }
    
    doc.moveDown(1);

    // === DAILY PATROL SUMMARY ===
    doc.fontSize(16).font('Helvetica-Bold')
       .text("📊 Daily Patrol Summary", { underline: true });
    doc.moveDown(0.5);
    
    if (dailySummary.length > 0) {
      doc.fontSize(10).font('Helvetica');
      
      dailySummary.forEach((row) => {
        const varianceText = row.variance > 0 
          ? `+${row.variance}` 
          : row.variance.toString();
        
        const expectedText = row.expected === 0 
          ? "No patrols scheduled" 
          : `Expected: ${row.expected}`;
        
        doc.text(
          `${row.date} (${row.day}) - ${expectedText}, Actual: ${row.actual}, ` +
          `Variance: ${varianceText} → ${row.status}`
        );
      });
      
      // Calculate totals
      const totalExpected = dailySummary.reduce((sum, row) => sum + row.expected, 0);
      const totalActual = dailySummary.reduce((sum, row) => sum + row.actual, 0);
      const totalVariance = totalActual - totalExpected;
      const complianceRate = totalExpected > 0 
        ? ((totalActual / totalExpected) * 100).toFixed(1)
        : "N/A";
      
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold');
      doc.text(
        `TOTAL - Expected: ${totalExpected}, Actual: ${totalActual}, ` +
        `Variance: ${totalVariance > 0 ? '+' : ''}${totalVariance}`
      );
      
      const complianceColor = parseFloat(complianceRate) >= 90 ? 'green' : 
                              parseFloat(complianceRate) >= 70 ? 'orange' : 'red';
      doc.fillColor(complianceColor)
         .text(`Overall Compliance Rate: ${complianceRate}%`)
         .fillColor('black');
    } else {
      doc.fontSize(10).text("No daily patrol data available for the selected period.");
    }

    doc.moveDown(1);

    // === ZONE PERFORMANCE SUMMARY ===
    doc.fontSize(16).font('Helvetica-Bold')
       .text("📋 Zone Performance Summary", { underline: true });
    doc.moveDown(0.5);
    
    if (zoneSummary.length > 0) {
      doc.fontSize(10).font('Helvetica');
      
      zoneSummary.forEach((row, i) => {
        const performanceRate = parseFloat(row.PerformanceRate);
        const performanceIcon = 
          performanceRate >= 90 ? '✅' : 
          performanceRate >= 70 ? '⚠️' : '❌';
        
        doc.text(
          `${i + 1}. ${row.SitePosts} — ${row.ChecksCompleted}/${row.ExpectedChecks} ` +
          `checks ${performanceIcon} (${row.PerformanceRate}%)`
        );
      });
    } else {
      doc.fontSize(10).text("No zone performance data available.");
    }

    doc.moveDown(1);

    // === EVENT LOG ===
    doc.fontSize(16).font('Helvetica-Bold')
       .text("🕒 Event Log", { underline: true });
    doc.moveDown(0.5);

    if (events.length > 0) {
      doc.fontSize(9).font('Helvetica');
      
      events.forEach((e, i) => {
        // Check if we need a new page
        if (doc.y > 700) {
          doc.addPage();
          doc.fontSize(9);
        }
        
        doc.text(
          `${i + 1}. [${e.Date} ${e.Time}] ${e.Zone || "N/A"} - ${e.Event || "No description"}`
        );
        
        if (e.Code) {
          doc.text(`   Code: ${e.Code}`);
        }
        
        if (e.Observations) {
          doc.text(`   Notes: ${e.Observations}`);
        }
        
        doc.moveDown(0.2);
      });
    } else {
      doc.fontSize(10).text("No events recorded for the selected period.");
    }

    // === FOOTER ===
    doc.moveDown(2);
    doc.fontSize(8).font('Helvetica-Oblique')
       .text(
         `Generated on ${dayjs().format('YYYY-MM-DD HH:mm:ss')} • ` +
         `Guard Report System • ${getShiftLabel(effectiveShiftType)}`,
         { align: "center" }
       );

    if (schedule) {
      doc.text(`Expected patrols calculated from patrol schedule configuration`, { align: "center" });
    } else {
      doc.text(`Expected patrols estimated using default values`, { align: "center" });
    }
    
    if (validTables.length > 1) {
      doc.text(`Data retrieved from ${validTables.length} monthly partition tables`, { align: "center" });
    }

    doc.end();
    
    console.log(`✅ PDF generated successfully`);
    console.log(`   Total Expected Used: ${totalExpectedForPeriod}`);
    console.log(`   Tables Queried: ${validTables.length}`);
    
    return pdfPromise;

  } catch (error) {
    console.error("❌ PDF Service Error:", error);
    throw error;
  }
}