import PDFDocument from "pdfkit";
import { sql, poolPromise } from "../config/database.js";
import dayjs from "dayjs";

/**
 * 🧾 Generate a weekly report PDF
 * Called by getWeeklyReportPDF() in reportController.js
 * @param {number} clientId
 * @param {string} client
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<Buffer>} - PDF buffer
 */
export async function generateWeeklyReportPDF(clientId, client, startDate, endDate) {
  console.log(`🧾 Generating PDF for client: ${client}`);

  const pool = await poolPromise;
  const start = dayjs(startDate).startOf("day").toDate();
  const end = dayjs(endDate).endOf("day").toDate();
  const tableName = `_Datos.dbo.p_recepcion${dayjs(start).format("YYYYMM")}`;

  // Check table existence
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

  // Get events data
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
      ORDER BY r.rec_tfechahora DESC
    `);

  const events = eventsResult.recordset || [];
  if (events.length === 0) {
    console.warn(`⚠️ No events found for ${client}`);
    return null;
  }

  // Get summary
  const summaryResult = await pool.request()
    .input("clientId", sql.Int, clientId)
    .input("startDate", sql.DateTime, start)
    .input("endDate", sql.DateTime, end)
    .query(`
      SELECT 
        ISNULL(r.rec_czona, 'Unknown') AS SitePosts,
        COUNT(*) AS ChecksCompleted,
        DATEDIFF(day, @startDate, @endDate) * 4 AS ExpectedChecks,
        CAST(
          (CAST(COUNT(*) AS FLOAT) /
          NULLIF(DATEDIFF(day, @startDate, @endDate) * 4, 0)) * 100
          AS DECIMAL(5,1)
        ) AS PerformanceRate
      FROM ${tableName} r
      WHERE r.rec_iidcuenta = @clientId
        AND r.rec_tfechahora BETWEEN @startDate AND @endDate
      GROUP BY r.rec_czona
      ORDER BY PerformanceRate DESC
    `);

  const summary = summaryResult.recordset || [];

  // ✅ Generate PDF
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const buffers = [];
  doc.on("data", (chunk) => buffers.push(chunk));
  const pdfPromise = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(buffers))));

  // Title
  doc.fontSize(20).text("Weekly Patrol Report", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Client: ${client}`);
  doc.text(`Period: ${startDate} → ${endDate}`);
  doc.moveDown(1.5);

  // Summary Section
  doc.fontSize(16).text("📋 Summary", { underline: true });
  doc.moveDown(0.5);
  if (summary.length > 0) {
    summary.forEach((row, i) => {
      doc.fontSize(12).text(
        `${i + 1}. ${row.SitePosts} — ${row.ChecksCompleted}/${row.ExpectedChecks} checks (${row.PerformanceRate}%)`
      );
    });
  } else {
    doc.fontSize(12).text("No summary data available.");
  }

  doc.moveDown(1);

  // Events Section
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
