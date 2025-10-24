// server/controllers/reportController.js
import { fetchWeeklyReport } from "../models/reportModel.js";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";

export const getWeeklyReport = async (req, res) => {
  try {
    const client = req.query.client || req.body.client;
    const startDateTime = req.query.startDateTime || req.body.startDateTime;
    const endDateTime = req.query.endDateTime || req.body.endDateTime;

    if (!client || !startDateTime || !endDateTime) {
      return res.status(400).json({
        success: false,
        message:
          "Missing parameters. Please provide client, startDateTime, and endDateTime.",
      });
    }

    console.log(`\n📊 [Weekly Report Request]
Client: ${client}
Period: ${startDateTime} → ${endDateTime}`);

    const { success, summary, events, message, sqlMessage } =
      await fetchWeeklyReport(client, startDateTime, endDateTime);

    if (
      !success ||
      ((!summary || summary.length === 0) &&
        (!events || events.length === 0))
    ) {
      console.warn(
        `⚠️ No patrol data found for ${client} between ${startDateTime} and ${endDateTime}`
      );
      return res.status(404).json({
        success: false,
        message:
          message ||
          `No patrol data found for ${client} between ${startDateTime} and ${endDateTime}.`,
        sqlMessage: sqlMessage || null,
      });
    }

    console.log(
      `✅ Report data retrieved successfully for ${client} (${summary.length} summary rows, ${events.length} events)`
    );

    return res.status(200).json({
      success: true,
      client,
      period: { startDateTime, endDateTime },
      summary,
      events,
    });
  } catch (error) {
    console.error("❌ Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching report data",
      sqlMessage: error.message,
    });
  }
};

// 🧾 Generate and download PDF report
export const getWeeklyReportPDF = async (req, res) => {
  try {
    const client = req.query.client;
    const startDateTime = req.query.startDateTime;
    const endDateTime = req.query.endDateTime;

    if (!client || !startDateTime || !endDateTime) {
      return res.status(400).json({
        success: false,
        message:
          "Missing parameters. Please provide client, startDateTime, and endDateTime.",
      });
    }

    const { success, summary, events } = await fetchWeeklyReport(
      client,
      startDateTime,
      endDateTime
    );

    if (!success) {
      return res.status(404).json({
        success: false,
        message: "No data found for PDF generation",
      });
    }

    // 🧩 Create PDF document
    const doc = new PDFDocument({ margin: 40, size: "A4" });

    // Temp output file
    const filename = `Weekly_Report_${client.replace(/\s+/g, "_")}.pdf`;
    const filepath = path.join("reports", filename);

    // Ensure directory exists
    fs.mkdirSync("reports", { recursive: true });

    const writeStream = fs.createWriteStream(filepath);
    doc.pipe(writeStream);

    // Header
    doc.fontSize(20).text("Weekly Patrol Report", { align: "center" });
    doc.moveDown();
    doc.fontSize(14).text(`Client: ${client}`);
    doc.text(`Period: ${startDateTime} → ${endDateTime}`);
    doc.moveDown();

    // Summary Section
    doc.fontSize(16).text("Summary", { underline: true });
    doc.moveDown(0.5);
    if (summary.length > 0) {
      summary.forEach((row, i) => {
        doc.fontSize(12).text(`${i + 1}. ${JSON.stringify(row)}`);
      });
    } else {
      doc.fontSize(12).text("No summary data available.");
    }

    doc.moveDown();

    // Events Section
    doc.fontSize(16).text("Events", { underline: true });
    doc.moveDown(0.5);
    if (events.length > 0) {
      events.forEach((event, i) => {
        doc.fontSize(12).text(`${i + 1}. ${JSON.stringify(event)}`);
      });
    } else {
      doc.fontSize(12).text("No events recorded.");
    }

    doc.end();

    writeStream.on("finish", () => {
      res.download(filepath, filename, (err) => {
        if (err) {
          console.error("Error sending PDF:", err);
          res.status(500).send("Error downloading PDF");
        } else {
          console.log(`📄 PDF sent: ${filename}`);
        }
      });
    });
  } catch (error) {
    console.error("❌ PDF generation error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating PDF",
      sqlMessage: error.message,
    });
  }
};
