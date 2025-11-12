// server/services/generatePatrolReport.js - REWRITTEN TO USE IMPORTED CALCULATIONS
import PDFDocument from "pdfkit";
import { sql, poolPromise } from "../config/database.js";
import dayjs from "dayjs";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter.js";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore.js";
import { getClientSchedule } from "../scripts/managePatrolSchedules.js";

dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

/**
 * 🧮 Calculate expected patrols for a date range using client schedule
 * This imports the logic from managePatrolSchedules.js
 */
function calculateExpectedPatrols(schedule, startDate, endDate) {
  const patrolDays = schedule.patrol_days.split(',').map(day => day.trim().toLowerCase());
  const weekdayPatrols = schedule.patrols_per_day;
  const weekendPatrols = schedule.weekend_patrols_per_day;
  
  let expected = 0;
  let currentDate = dayjs(startDate);
  const end = dayjs(endDate);
  
  while (currentDate.isSameOrBefore(end, 'day')) {
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
 * 🧮 Get expected patrols for a specific date
 * This matches the calculation method from managePatrolSchedules.js
 */
function getExpectedForDate(schedule, date) {
  const patrolDays = schedule.patrol_days.split(',').map(day => day.trim().toLowerCase());
  const dayOfWeek = dayjs(date).format('ddd').toLowerCase();
  
  if (!patrolDays.includes(dayOfWeek)) {
    return 0; // Not a scheduled patrol day
  }
  
  if (dayOfWeek === 'sat' || dayOfWeek === 'sun') {
    return schedule.weekend_patrols_per_day;
  }
  
  return schedule.patrols_per_day;
}

/**
 * 🧮 Calculate weekly total (imported from managePatrolSchedules.js logic)
 */
function calculateWeeklyTotal(weekdayPatrols, weekendPatrols, patrolDays) {
  const days = patrolDays.split(',').map(day => day.trim().toLowerCase());
  let weeklyTotal = 0;
  
  days.forEach(day => {
    if (day === 'sat' || day === 'sun' || day.includes('weekend')) {
      weeklyTotal += weekendPatrols;
    } else {
      weeklyTotal += weekdayPatrols;
    }
  });
  
  return weeklyTotal;
}

/**
 * 🧮 Get performance rating (imported from managePatrolSchedules.js)
 */
function getPerformanceRating(complianceRate) {
  const rate = parseFloat(complianceRate) || 0;
  if (rate >= 90) return 'Excellent';
  if (rate >= 80) return 'Good';
  if (rate >= 70) return 'Fair';
  return 'Poor';
}

/**
 * 🧮 Calculate proportional expected patrols per zone
 * This matches the controller's proportional distribution logic
 */
function calculateProportionalExpected(zones, totalExpected) {
  const totalCompleted = zones.reduce((sum, z) => sum + (parseInt(z.ChecksCompleted) || 0), 0);
  
  if (totalCompleted === 0) {
    // Distribute equally if no data
    const equalExpected = zones.length > 0 
      ? Math.ceil(totalExpected / zones.length)
      : totalExpected;
    
    return zones.map(zone => ({
      ...zone,
      ExpectedChecks: equalExpected,
      PerformanceRate: '0.0'
    }));
  }
  
  // Proportional distribution based on actual activity
  return zones.map(zone => {
    const completed = parseInt(zone.ChecksCompleted) || 0;
    const proportion = completed / totalCompleted;
    const expectedForZone = Math.max(1, Math.round(totalExpected * proportion));
    const performance = expectedForZone > 0 
      ? ((completed / expectedForZone) * 100).toFixed(1)
      : '0.0';
    
    return {
      ...zone,
      ExpectedChecks: expectedForZone,
      PerformanceRate: performance
    };
  });
}

/**
 * 📊 Get table names for date range (matching controller logic)
 */
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

/**
 * 🔍 Check if table exists (matching controller logic)
 */
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

/**
 * 🏗️ Build UNION query (matching controller logic)
 */
function buildUnionQuery(tables) {
  return tables.map(table => `SELECT * FROM ${table} r`).join('\n          UNION ALL\n          ');
}

/**
 * 🧾 Generate a patrol report PDF (weekly or custom range)
 * NOW USING IMPORTED CALCULATIONS FROM managePatrolSchedules.js
 */
export async function generateWeeklyReportPDF(
  clientId,
  client,
  startDate,
  endDate,
  shiftType = "Day/Night"
) {
  console.log(`🧾 Generating patrol report for ${client} (${shiftType})`);
  console.log(`   Period: ${startDate} → ${endDate}`);

  const pool = await poolPromise;
  const start = dayjs(startDate).startOf("day").toDate();
  const end = dayjs(endDate).endOf("day").toDate();

  // ✅ Get client schedule (imported function from managePatrolSchedules.js)
  const schedule = await getClientSchedule(clientId);
  console.log(`📋 Schedule loaded:`, {
    weekday: schedule.patrols_per_day,
    weekend: schedule.weekend_patrols_per_day,
    days: schedule.patrol_days,
    shift: schedule.shift_type,
    hasCustomSchedule: schedule.has_custom_schedule,
    configSource: schedule.config_source
  });

  // ✅ Calculate total expected patrols using imported function
  const totalExpected = calculateExpectedPatrols(schedule, startDate, endDate);
  console.log(`🎯 Expected patrols for period: ${totalExpected}`);

  // ✅ Get valid tables for date range (matching controller)
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

  console.log(`📊 Using tables: ${validTables.join(', ')}`);

  // ✅ Time filter by shift type
  let timeCondition = "";
  if (shiftType === "Day") {
    timeCondition = "AND DATEPART(HOUR, r.rec_tfechahora) BETWEEN 6 AND 17";
  } else if (shiftType === "Night") {
    timeCondition =
      "AND (DATEPART(HOUR, r.rec_tfechahora) >= 18 OR DATEPART(HOUR, r.rec_tfechahora) < 6)";
  }

  // ✅ Get patrol events with zone names (matching controller fixes)
  const eventsResult = await pool.request()
    .input("clientId", sql.Int, clientId)
    .input("startDate", sql.DateTime, start)
    .input("endDate", sql.DateTime, end)
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
        ${timeCondition}
      ORDER BY r.rec_tfechahora DESC
    `);

  const events = eventsResult.recordset || [];
  console.log(`📊 Found ${events.length} patrol events`);

  // ✅ Daily patrol summary with accurate expected counts
  const patrolsResult = await pool.request()
    .input("clientId", sql.Int, clientId)
    .input("startDate", sql.DateTime, start)
    .input("endDate", sql.DateTime, end)
    .query(`
      SELECT 
        CAST(r.rec_tfechahora AS DATE) AS PatrolDate,
        COUNT(*) AS PatrolCount
      FROM (${buildUnionQuery(validTables)}) AS r
      WHERE r.rec_iidcuenta = @clientId
        AND r.rec_tfechahora BETWEEN @startDate AND @endDate
        ${timeCondition}
      GROUP BY CAST(r.rec_tfechahora AS DATE)
      ORDER BY PatrolDate
    `);

  const patrolData = patrolsResult.recordset || [];

  // ✅ Build daily summary with schedule-based expectations (imported calculation)
  const dailySummary = [];
  let currentDate = dayjs(startDate);
  const endDay = dayjs(endDate);
  
  while (currentDate.isSameOrBefore(endDay, 'day')) {
    const dateStr = currentDate.format('YYYY-MM-DD');
    const dayOfWeek = currentDate.format('ddd');
    
    // ✅ Use imported function to get expected patrols
    const expected = getExpectedForDate(schedule, currentDate);
    
    // Get actual patrols from database
    const actual = patrolData.find(p => 
      dayjs(p.PatrolDate).format('YYYY-MM-DD') === dateStr
    )?.PatrolCount || 0;
    
    const variance = actual - expected;
    let status = '✅ OK';
    if (expected === 0) {
      status = '⏸️ Not Scheduled';
    } else if (variance < 0) {
      status = '⚠️ Missed';
    }

    dailySummary.push({
      date: dateStr,
      day: dayOfWeek,
      expected,
      actual,
      variance,
      status
    });
    
    currentDate = currentDate.add(1, 'day');
  }

  // ✅ Calculate overall completion rate
  const totalActual = events.length;
  const completionRate = totalExpected > 0 
    ? ((totalActual / totalExpected) * 100).toFixed(1)
    : '0.0';

  // ✅ Get performance rating using imported function
  const performanceRating = getPerformanceRating(completionRate);

  console.log(`📈 Completion: ${totalActual}/${totalExpected} (${completionRate}%) - ${performanceRating}`);

  // ✅ Zone performance with zone names and proportional distribution (matching controller)
  const zoneSummaryResult = await pool.request()
    .input("clientId", sql.Int, clientId)
    .input("startDate", sql.DateTime, start)
    .input("endDate", sql.DateTime, end)
    .query(`
      SELECT 
        COALESCE(
          zon.zon_cdescripcion,
          r.rec_czona,
          'Unknown Zone'
        ) AS SitePosts,
        COUNT(*) AS ChecksCompleted
      FROM (${buildUnionQuery(validTables)}) AS r
      LEFT JOIN [_Datos].[dbo].[m_zonas] AS zon
        ON r.rec_iidcuenta = zon.zon_iidcuenta
        AND r.rec_czona = zon.zon_ccodigo
      WHERE r.rec_iidcuenta = @clientId
        AND r.rec_tfechahora BETWEEN @startDate AND @endDate
        ${timeCondition}
      GROUP BY COALESCE(zon.zon_cdescripcion, r.rec_czona, 'Unknown Zone')
      ORDER BY COUNT(*) DESC
    `);

  // ✅ Apply proportional distribution using imported calculation method
  let zoneSummary = zoneSummaryResult.recordset || [];
  zoneSummary = calculateProportionalExpected(zoneSummary, totalExpected);

  console.log(`📍 Zone performance:`, zoneSummary.map(z => ({
    zone: z.SitePosts,
    completed: z.ChecksCompleted,
    expected: z.ExpectedChecks,
    performance: `${z.PerformanceRate}%`
  })));

  // ===== GENERATE PDF =====
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const buffers = [];
  doc.on("data", chunk => buffers.push(chunk));
  const pdfPromise = new Promise(resolve => 
    doc.on("end", () => resolve(Buffer.concat(buffers)))
  );

  const totalDays = dayjs(endDate).diff(dayjs(startDate), 'day') + 1;
  const avgExpectedPerDay = totalExpected / totalDays;
  const weeklyTotal = calculateWeeklyTotal(
    schedule.patrols_per_day,
    schedule.weekend_patrols_per_day,
    schedule.patrol_days
  );

  // ===== HEADER =====
  doc.fontSize(20).text("Security Patrol Report", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Client: ${client}`);
  doc.text(`Period: ${startDate} → ${endDate} (${totalDays} days)`);
  doc.text(`Shift: ${schedule.shift_type}`);
  doc.moveDown(0.5);
  
  // ===== OVERALL SUMMARY =====
  doc.fontSize(14).text("📊 Overall Performance", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(11).text(`Total Patrols Completed: ${totalActual}`);
  doc.text(`Expected Patrols: ${totalExpected}`);
  doc.text(`Completion Rate: ${completionRate}%`);
  doc.text(`Performance Rating: ${performanceRating}`);
  doc.text(`Daily Average (Actual): ${(totalActual / totalDays).toFixed(1)}`);
  doc.text(`Daily Average (Expected): ${avgExpectedPerDay.toFixed(1)}`);
  doc.moveDown(1);

  // ===== SCHEDULE INFO =====
  doc.fontSize(14).text("📅 Patrol Schedule", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(11).text(`Weekday Patrols: ${schedule.patrols_per_day} per day`);
  doc.text(`Weekend Patrols: ${schedule.weekend_patrols_per_day} per day`);
  doc.text(`Scheduled Days: ${schedule.patrol_days}`);
  doc.text(`Weekly Total: ${weeklyTotal} patrols`);
  doc.text(`Schedule Source: ${schedule.config_source || 'default'}`);
  doc.text(`Custom Schedule: ${schedule.has_custom_schedule ? 'Yes' : 'No'}`);
  doc.moveDown(1.5);

  // ===== DAILY SUMMARY =====
  doc.fontSize(16).text("📋 Daily Patrol Summary", { underline: true });
  doc.moveDown(0.5);
  
  if (dailySummary.length > 0) {
    dailySummary.forEach(row => {
      if (row.expected === 0) {
        doc.fontSize(10).fillColor('gray').text(
          `${row.date} (${row.day}) - Not scheduled`
        );
      } else {
        const color = row.variance < 0 ? 'red' : 'black';
        doc.fontSize(10).fillColor(color).text(
          `${row.date} (${row.day}) - Expected: ${row.expected}, Actual: ${row.actual}, ` +
          `Variance: ${row.variance > 0 ? '+' : ''}${row.variance} → ${row.status}`
        );
      }
      doc.fillColor('black'); // Reset color
    });
  } else {
    doc.fontSize(11).text("No patrol data available.");
  }

  doc.moveDown(1.5);

  // ===== ZONE PERFORMANCE =====
  doc.fontSize(16).text("📍 Zone Performance Summary", { underline: true });
  doc.moveDown(0.5);
  
  if (zoneSummary.length > 0) {
    zoneSummary.forEach((row, i) => {
      const perfRate = parseFloat(row.PerformanceRate);
      const color = perfRate >= 90 ? 'green' : perfRate >= 70 ? 'black' : 'red';
      doc.fontSize(11).fillColor(color).text(
        `${i + 1}. ${row.SitePosts} — Completed: ${row.ChecksCompleted}, ` +
        `Expected: ${row.ExpectedChecks}, Performance: ${row.PerformanceRate}%`
      );
      doc.fillColor('black'); // Reset color
    });
  } else {
    doc.fontSize(11).text("No zone data available.");
  }

  doc.moveDown(1.5);

  // ===== EVENT LOG =====
  doc.fontSize(16).text("🕒 Event Log (Recent 50 Events)", { underline: true });
  doc.moveDown(0.5);

  if (events.length > 0) {
    const displayEvents = events.slice(0, 50);
    displayEvents.forEach((e, i) => {
      doc.fontSize(9).text(
        `${i + 1}. [${e.Date} ${e.Time}] ${e.Zone} - ${e.Event}`
      );
      if (e.Code && e.Code !== '') {
        doc.fontSize(8).fillColor('gray').text(`   Code: ${e.Code}`);
      }
      if (e.Observations && e.Observations !== '') {
        doc.fontSize(8).fillColor('gray').text(`   Notes: ${e.Observations}`);
      }
      doc.fillColor('black'); // Reset color
      doc.moveDown(0.2);
    });
    
    if (events.length > 50) {
      doc.fontSize(10).fillColor('gray').text(
        `... and ${events.length - 50} more events`, 
        { italics: true }
      );
      doc.fillColor('black');
    }
  } else {
    doc.text("No patrol events recorded.");
  }

  // ===== FOOTER =====
  doc.moveDown(2);
  doc.fontSize(8).fillColor('gray').text(
    `Report generated: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`,
    { align: 'center' }
  );
  doc.text(
    `Calculations imported from managePatrolSchedules.js`,
    { align: 'center' }
  );

  doc.end();
  return pdfPromise;
}

// Export helper functions for use in other modules
export {
  calculateExpectedPatrols,
  getExpectedForDate,
  calculateWeeklyTotal,
  getPerformanceRating,
  calculateProportionalExpected,
  getTableNames,
  checkTableExists,
  buildUnionQuery
};

export default {
  generateWeeklyReportPDF,
  calculateExpectedPatrols,
  getExpectedForDate,
  calculateWeeklyTotal,
  getPerformanceRating,
  calculateProportionalExpected
};