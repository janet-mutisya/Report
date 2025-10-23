// server/controllers/reportController.js
import { fetchWeeklyReport } from "../models/reportModel.js";

export const getWeeklyReport = async (req, res) => {
  try {
    const client = req.query.client || req.body.client;
    const startDate = req.query.startDate || req.body.startDate;
    const endDate = req.query.endDate || req.body.endDate;

    if (!client || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Missing parameters. Please provide client, startDate, and endDate.",
      });
    }

    console.log(`\n📊 [Weekly Report Request]
Client: ${client}
Period: ${startDate} → ${endDate}`);

    const { success, summary, events, message, sqlMessage } = await fetchWeeklyReport(client, startDate, endDate);

    if (!success || ((!summary || summary.length === 0) && (!events || events.length === 0))) {
      console.warn(`⚠️ No patrol data found for ${client} between ${startDate} and ${endDate}`);
      return res.status(404).json({
        success: false,
        message: message || `No patrol data found for ${client} between ${startDate} and ${endDate}.`,
        sqlMessage: sqlMessage || null,
      });
    }

    console.log(`✅ Report data retrieved successfully for ${client} (${summary.length} summary rows, ${events.length} events)`);

    return res.status(200).json({
      success: true,
      client,
      period: { startDate, endDate },
      summary,
      events,
    });
  } catch (error) {
    console.error("❌ Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching report data",
      sqlMessage: error.message, // 👈 This line is key
    });
  }
};
