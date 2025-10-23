import cron from 'node-cron';
import sql from 'mssql';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import pool from '../config/database.js'; // your DB connection
import { generateWeeklyReportPDF } from './reportService.js'; // fixed import

dotenv.config();

// ✅ Create the SMTP transporter ONCE
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function runWeeklyReportJob() {
  console.log('⏰ Weekly patrol report job started...');

  try {
    // ✅ Verify SMTP ONCE
    await transporter.verify();
    console.log(`📧 SMTP connection verified for ${process.env.EMAIL_USER}`);

    // ✅ Connect to the SQL Server
    await pool.connect();
    console.log('✅ Connected to SQL Server');

    // ✅ Get all clients (make sure these columns exist in your DB)
    const result = await pool
      .request()
      .query('SELECT ClientName, Email FROM Clients');

    const clients = result.recordset;
    if (clients.length === 0) {
      console.log('⚠️ No clients found.');
      return;
    }

    // ✅ Loop through clients
    for (const client of clients) {
      const { ClientName, Email } = client;
      console.log(`💼 Generating report for ${ClientName}...`);

      try {
        // Use generateWeeklyReportPDF as imported
        const report = await generateWeeklyReportPDF(ClientName);
        if (!report || report.length === 0) {
          console.log(`⚠️ No patrol data found for ${ClientName}`);
          continue;
        }

        // Send email
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: Email,
          subject: `Weekly Patrol Report - ${ClientName}`,
          text: 'Attached is your weekly patrol report.',
          attachments: [
            {
              filename: `${ClientName}-Weekly-Report.pdf`,
              content: report,
            },
          ],
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Report sent to ${Email}: ${info.messageId}`);
      } catch (err) {
        console.error(`❌ Error generating/sending report for ${ClientName}:`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ Job failed:', err.message);
  } finally {
    // ✅ Close DB connection cleanly
    await sql.close();
    console.log('🔒 SQL connection closed.');
    console.log('✅ Weekly patrol report job completed.');
  }
}

// ✅ Schedule for every Wednesday at 6:00 AM
cron.schedule('0 6 * * WED', runWeeklyReportJob);
