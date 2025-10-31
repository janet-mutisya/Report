// server/service/scheduler.js
import cron from "node-cron";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { sql, poolPromise } from "../config/database.js";
import { generateWeeklyReportPDF } from "./reportService.js";

dotenv.config();
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || "Africa/Nairobi";
const TEST_MODE = process.env.TEST_MODE === "true"; // ✅ Controlled by .env

// ✅ Email transporter (Gmail)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * 🕒 Main Scheduler Runner — depends entirely on frontend-set due dates
 */
export async function runDynamicReportScheduler() {
  console.log("⏰ Checking for due client reports (frontend-controlled scheduling)...");

  try {
    const pool = await poolPromise;
    const now = dayjs().tz(TZ);

    // ✅ Fetch schedules whose due time is now or past
    const result = await pool.request().query(`
      SELECT 
        R.rep_iidcuenta AS ClientID,
        C.cue_cnombre AS ClientName,
        R.rep_cmail AS Email,
        R.rep_tproximoenvio AS NextRun,
        R.rep_nfrecuencia AS Frequency,
        R.rep_nCadaUnidadTiempo AS IntervalDays
      FROM [_Datos].[dbo].[m_reportes_automaticos] R
      INNER JOIN [_Datos].[dbo].[m_cuentas] C
        ON R.rep_iidcuenta = C.cue_iid
      WHERE 
        R.rep_cmail IS NOT NULL
        AND R.rep_tproximoenvio IS NOT NULL
        AND R.rep_tproximoenvio <= GETDATE()
    `);

    const dueClients = result.recordset || [];

    if (!dueClients.length) {
      console.log("✅ No client reports are currently due.");
      return;
    }

    for (const client of dueClients) {
      const { ClientID, ClientName, Email, Frequency, IntervalDays, NextRun } = client;
      console.log(`📤 Generating report for ${ClientName} (Due: ${dayjs(NextRun).format("YYYY-MM-DD HH:mm")})`);

      try {
        // ✅ Generate the report
        const pdfBuffer = await generateWeeklyReportPDF(ClientID, ClientName);

        if (!pdfBuffer) {
          console.warn(`⚠️ No patrol data found for ${ClientName}. Skipping actual email.`);
          if (TEST_MODE) {
            console.log(`🚫 [TEST MODE] Would have sent report to ${Email}, but no data was found.`);
          }
          continue;
        }

        if (TEST_MODE) {
          // 🚫 Log what would have been sent
          console.log(`🚫 [TEST MODE] Would have sent report to ${Email} — skipping actual email.`);
        } else {
          // ✅ Send report via email
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: Email,
            subject: `Patrol Report - ${ClientName}`,
            text: `Attached: Scheduled Patrol Report for ${ClientName}`,
            attachments: [
              {
                filename: `${ClientName.replace(/\s+/g, "_")}_Report.pdf`,
                content: pdfBuffer,
              },
            ],
          });

          console.log(`✅ Report successfully sent to ${Email}`);
        }

        // ✅ Update next run if applicable
        if (Frequency && IntervalDays) {
          let newNextRun = dayjs(NextRun).tz(TZ);

          switch (Frequency) {
            case 1:
              newNextRun = newNextRun.add(IntervalDays || 1, "day");
              break;
            case 2:
              newNextRun = newNextRun.add(7 * (IntervalDays || 1), "day");
              break;
            case 3:
              newNextRun = newNextRun.add(IntervalDays || 1, "month");
              break;
            default:
              newNextRun = null;
          }

          if (newNextRun) {
            await pool.request()
              .input("ClientID", sql.Int, ClientID)
              .input("NextRun", sql.DateTime, newNextRun.toDate())
              .query(`
                UPDATE [_Datos].[dbo].[m_reportes_automaticos]
                SET rep_tproximoenvio = @NextRun
                WHERE rep_iidcuenta = @ClientID
              `);
            console.log(`📅 Next run for ${ClientName} set to ${newNextRun.format("YYYY-MM-DD HH:mm")}`);
          } else {
            console.log(`⏹ ${ClientName} is one-time only — no next run set.`);
          }
        } else {
          console.log(`⏹ ${ClientName} schedule does not repeat — awaiting frontend update.`);
        }

      } catch (err) {
        console.error(`❌ Error processing ${ClientName}:`, err.message);
      }
    }

    console.log("✅ Scheduler run complete (frontend-controlled mode).");

  } catch (err) {
    console.error("❌ Scheduler runtime error:", err.message);
  }
}

// 🕐 Run every 5 minutes to catch new due tasks
cron.schedule("*/5 * * * *", runDynamicReportScheduler);
console.log(`🚀 Dynamic Scheduler started — frontend-controlled (runs every 5 mins). TEST_MODE=${TEST_MODE}`);