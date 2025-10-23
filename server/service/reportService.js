import dayjs from "dayjs";
import PDFDocument from "pdfkit";
import streamBuffers from "stream-buffers";
import { sql, poolPromise } from "../config/database.js";

/**
 * 🧾 Generate Weekly Patrol Report as a PDF buffer
 * Fetches data for the previous Monday → Sunday from the correct monthly table
 */
export async function generateWeeklyReportPDF(clientName) {
  const today = dayjs();

  // Calculate last week's Monday → Sunday
  const startDate = today.subtract(1, "week").startOf("week").add(1, "day").startOf("day").toDate();
  const endDate = today.subtract(1, "week").endOf("week").add(1, "day").endOf("day").toDate();

  // Determine the correct table name based on month (e.g., p_recepcion202410)
  const tableName = `_Datos.dbo.p_recepcion${dayjs(startDate).format("YYYYMM")}`;

  console.log(`📅 Generating PDF report for ${clientName}`);
  console.log(`🗓️ Period: ${dayjs(startDate).format("YYYY-MM-DD")} → ${dayjs(endDate).format("YYYY-MM-DD")}`);
  console.log(`📦 Using table: ${tableName}`);

  try {
    const pool = await poolPromise;
    console.log("✅ Connected to SQL Server");

    // Fetch records from the correct monthly table
    const result = await pool.request()
      .input("startDate", sql.DateTime, startDate)
      .input("endDate", sql.DateTime, endDate)
      .query(`
        SELECT 
          r.rec_iid AS Id,
          r.rec_iidcuenta AS Cuenta,
          r.rec_calarma AS Codigo,
          r.rec_tfechahora AS FechaHora,
          r.rec_cContenido AS Descripcion,
          r.rec_czona AS Zona,
          r.rec_ioperador AS Operador,
          r.usuario_cNombre AS Usuario,
          r.zonas_cDescripcion AS ZonaDescripcion
        FROM ${tableName} r
        WHERE r.rec_tfechahora BETWEEN @startDate AND @endDate
        ORDER BY r.rec_tfechahora ASC
      `);

    const records = result.recordset;

    if (!records || records.length === 0) {
      console.warn(`⚠️ No data found for ${clientName} in the selected period.`);
      return null;
    }

    console.log(`📊 Retrieved ${records.length} records for ${clientName}`);

    // Generate PDF
    const pdfBuffer = await createPDFReport(clientName, startDate, endDate, records);
    return pdfBuffer;

  } catch (error) {
    console.error(`❌ Error generating report for ${clientName}:`, error);
    throw error;
  }
}

/**
 * 🖨️ Create a formatted PDF report
 */
async function createPDFReport(clientName, startDate, endDate, records) {
  const doc = new PDFDocument({ margin: 50 });
  const buffer = new streamBuffers.WritableStreamBuffer({
    initialSize: 100 * 1024,
    incrementAmount: 10 * 1024,
  });

  doc.pipe(buffer);

  // Title
  doc.fontSize(18).text(`Weekly Patrol Report`, { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(14).text(`Client: ${clientName}`, { align: "center" });
  doc.fontSize(12).text(`Period: ${dayjs(startDate).format("YYYY-MM-DD")} → ${dayjs(endDate).format("YYYY-MM-DD")}`, { align: "center" });
  doc.moveDown(1.5);

  // Table headers
  doc.fontSize(10).text(`ID`, 50, doc.y, { width: 40 });
  doc.text(`FechaHora`, 90, doc.y, { width: 110 });
  doc.text(`Codigo`, 200, doc.y, { width: 60 });
  doc.text(`Descripcion`, 260, doc.y, { width: 140 });
  doc.text(`Zona`, 400, doc.y, { width: 60 });
  doc.text(`Usuario`, 460, doc.y, { width: 100 });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(560, doc.y).stroke();
  doc.moveDown(0.5);

  // Records
  records.forEach((r) => {
    doc.fontSize(9);
    doc.text(r.Id || "", 50, doc.y, { width: 40 });
    doc.text(dayjs(r.FechaHora).format("YYYY-MM-DD HH:mm"), 90, doc.y, { width: 110 });
    doc.text(r.Codigo || "", 200, doc.y, { width: 60 });
    doc.text(r.Descripcion || "", 260, doc.y, { width: 140 });
    doc.text(r.ZonaDescripcion || r.Zona || "", 400, doc.y, { width: 60 });
    doc.text(r.Usuario || "", 460, doc.y, { width: 100 });
    doc.moveDown(0.3);

    if (doc.y > 750) {
      doc.addPage();
      doc.moveDown(1);
    }
  });

  doc.end();

  await new Promise((resolve) => buffer.on("finish", resolve));
  return buffer.getContents();
}
