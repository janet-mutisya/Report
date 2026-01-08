import nodemailer from "nodemailer";
import dotenv from "dotenv";
//import { runDynamicReportScheduler } from "../service/scheduler.js";

dotenv.config();

// ✅ Define transporter (same as in scheduler.js)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ✅ Trigger the main scheduler manually
export const triggerSchedulerNow = async (req, res) => {
  try {
    await runDynamicReportScheduler();
    res.status(200).json({ success: true, message: "Scheduler executed manually." });
  } catch (err) {
    console.error("❌ Manual scheduler test failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ Manual test email route (no client data)
export const sendTestEmail = async (req, res) => {
  const { TEST_EMAIL, EMAIL_USER } = process.env;
  if (!TEST_EMAIL) {
    console.error("⚠️ TEST_EMAIL not set in .env");
    return res.status(400).json({ error: "TEST_EMAIL not set in .env" });
  }

  const samplePDF = Buffer.from("This is a test PDF file for verification.", "utf-8");

  try {
    await transporter.sendMail({
      from: EMAIL_USER,
      to: TEST_EMAIL,
      subject: "🧪 Scheduler Test Email (No Client Data)",
      text: "This is a test email sent from the scheduler to confirm email sending works.",
      attachments: [
        { filename: "Test_Report.pdf", content: samplePDF },
      ],
    });
    console.log(`📧 Test email sent successfully to ${TEST_EMAIL}`);
    res.json({ success: true, message: `Test email sent to ${TEST_EMAIL}` });
  } catch (err) {
    console.error("❌ Failed to send test email:", err.message);
    res.status(500).json({ error: err.message });
  }
};
