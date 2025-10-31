import PDFDocument from "pdfkit";
import { sql, poolPromise } from "../config/database.js";
import dayjs from "dayjs";
import { getClientSchedule } from "../scripts/managePatrolSchedules.js";

/**
 * 🧾 Generate a weekly report PDF
 * Called by getWeeklyReportPDF() in reportController.js
 * @param {number} clientId
 * @param {string} client
 * @param {string} startDate
 * @param {string} endDate
 * @param {string} shiftType - "Day", "Night", or "Day/Night" (default)
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generateWeeklyReportPDF(clientId, client, startDate, endDate, shiftType = "Day/Night") {
  console.log(`🧾 Generating PDF for client: ${client} (Shift: ${shiftType})`);

  const pool = await poolPromise;
  const start = dayjs(startDate).startOf("day").toDate();
  const end = dayjs(endDate).endOf("day").toDate();
  const tableName = `_Datos.dbo.p_recepcion${dayjs(start).format("YYYYMM")}`;

  const tableExists = await pool.request()
    .input("tableName", sql.NVarChar, tableName.split(".").pop())
    .query(`
      SELECT 1 AS existsFlag
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = PARSENAME(@tableName, 1)
    `);

  if (tableExists.recordset.length === 0) {
    console.warn(`⚠️ Table ${tableName} not found`);
    return null;
  }

  const schedule = await getClientSchedule(clientId);
  const expectedPatrolsPerDay = schedule?.patrols_per_day || 0;
  const weekendPatrols = schedule?.weekend_patrols_per_day || expectedPatrolsPerDay;
  const scheduleShift = schedule?.shift_type || shiftType;

  let timeCondition = "";
  if (shiftType === "Day") {
    timeCondition = "AND DATEPART(HOUR, r.rec_tfechahora) BETWEEN 6 AND 17";
  } else if (shiftType === "Night") {
    timeCondition = "AND (DATEPART(HOUR, r.rec_tfechahora) >= 18 OR DATEPART(HOUR, r.rec_tfechahora) < 6)";
  }

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
      FROM ${tableName} r
      WHERE r.rec_iidcuenta = @clientId
        AND r.rec_tfechahora BETWEEN @startDate AND @endDate
        ${timeCondition}
      ORDER BY r.rec_tfechahora DESC
    `);

  const events = eventsResult.recordset || [];
  if (events.length === 0) {
    console.warn(`⚠️ No events found for ${client} (Shift: ${shiftType})`);
    return null;
  }

  const patrolsResult = await pool.request()
    .input("clientId", sql.Int, clientId)
    .input("startDate", sql.DateTime, start)
    .input("endDate", sql.DateTime, end)
    .query(`
      SELECT 
        CAST(r.rec_tfechahora AS DATE) AS PatrolDate,
        COUNT(*) AS PatrolCount
      FROM ${tableName} r
      WHERE r.rec_iidcuenta = @clientId
        AND r.rec_tfechahora BETWEEN @startDate AND @endDate
        ${timeCondition}
      GROUP BY CAST(r.rec_tfechahora AS DATE)
      ORDER BY PatrolDate
    `);

  const patrolData = patrolsResult.recordset || [];

  const dailySummary = patrolData.map(row => {
    const dayOfWeek = dayjs(row.PatrolDate).format("ddd");
    const expected = ["Sat", "Sun"].includes(dayOfWeek) ? weekendPatrols : expectedPatrolsPerDay;
    const variance = row.PatrolCount - expected;
    const status = variance >= 0 ? "✅ OK" : "⚠️ Missed";

    return {
      date: dayjs(row.PatrolDate).format("YYYY-MM-DD"),
      day: dayOfWeek,
      expected,
      actual: row.PatrolCount,
      variance,
      status
    };
  });

  const summaryResult = await pool.request()
    .input("clientId", sql.Int, clientId)
    .input("startDate", sql.DateTime, start)
    .input("endDate", sql.DateTime, end)
    .query(`
      SELECT 
        ISNULL(r.rec_czona, 'Unknown') AS SitePosts,
        COUNT(*) AS ChecksCompleted,
        DATEDIFF(day, @startDate, @endDate) * ${expectedPatrolsPerDay} AS ExpectedChecks,
        CAST(
          (CAST(COUNT(*) AS FLOAT) /
          NULLIF(DATEDIFF(day, @startDate, @endDate) * ${expectedPatrolsPerDay}, 0)) * 100
          AS DECIMAL(5,1)
        ) AS PerformanceRate
      FROM ${tableName} r
      WHERE r.rec_iidcuenta = @clientId
        AND r.rec_tfechahora BETWEEN @startDate AND @endDate
        ${timeCondition}
      GROUP BY r.rec_czona
      ORDER BY PerformanceRate DESC
    `);

  const zoneSummary = summaryResult.recordset || [];

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const buffers = [];
  doc.on("data", (chunk) => buffers.push(chunk));
  const pdfPromise = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(buffers))));

  doc.fontSize(20).text("Weekly Patrol Report", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Client: ${client}`);
  doc.text(`Period: ${startDate} → ${endDate}`);
  doc.text(`Shift: ${scheduleShift}`);
  doc.moveDown(0.5);
  doc.text(`Expected Patrols per Day: ${expectedPatrolsPerDay}`);
  if (weekendPatrols !== expectedPatrolsPerDay) {
    doc.text(`Weekend Patrols per Day: ${weekendPatrols}`);
  }
  doc.moveDown(1.5);

  doc.fontSize(16).text("📊 Daily Patrol Summary", { underline: true });
  doc.moveDown(0.5);
  if (dailySummary.length > 0) {
    dailySummary.forEach((row) => {
      doc.fontSize(11).text(
        `${row.date} (${row.day}) - Expected: ${row.expected}, Actual: ${row.actual}, Variance: ${row.variance > 0 ? '+' : ''}${row.variance} → ${row.status}`
      );
    });
  } else {
    doc.fontSize(11).text("No daily patrol data available.");
  }

  doc.moveDown(1.5);

  doc.fontSize(16).text("📋 Zone Performance Summary", { underline: true });
  doc.moveDown(0.5);
  if (zoneSummary.length > 0) {
    zoneSummary.forEach((row, i) => {
      doc.fontSize(12).text(
        `${i + 1}. ${row.SitePosts} — ${row.ChecksCompleted}/${row.ExpectedChecks} checks (${row.PerformanceRate}%)`
      );
    });
  } else {
    doc.fontSize(12).text("No zone summary data available.");
  }

  doc.moveDown(1);

  doc.fontSize(16).text("🕒 Event Log", { underline: true });
  doc.moveDown(0.5);

  events.forEach((e, i) => {
    doc.fontSize(11).text(
      `${i + 1}. [${e.Date} ${e.Time}] ${e.Zone || "N/A"} - ${e.Event || ""}`
    );
    if (e.Code) doc.text(`   Code: ${e.Code}`);
    if (e.Observations) doc.text(`   Notes: ${e.Observations}`);
    doc.moveDown(0.3);
  });

  doc.end();
  return pdfPromise;
}