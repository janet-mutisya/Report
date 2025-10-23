const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Import your report generation function and clients list
const { generateWeeklyReportPDF } = require('./service/reportService.js'); // <-- Your report function here
const { clients } = require('./service/clients.js'); // <-- Import clients list

async function sendEmailWithAttachment(buffer, fileName, toEmail) {
  const transporter = nodemailer.createTransport({
    service: 'gmail', // Or configure SMTP if needed
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: `"Guard Reports" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Weekly Guard Report',
    text: 'Attached is the weekly guard patrol report.',
    attachments: [
      {
        filename: fileName,
        content: buffer,
      },
    ],
  };

  await transporter.sendMail(mailOptions);
  console.log(`📧 Email sent successfully to ${toEmail}!`);
}

async function main() {
  try {
    // Option 1: Send report for all clients in the list
    for (const client of clients) {
      console.log(`🔄 Generating PDF report for client: ${client.name}...`);
      const pdfBuffer = await generateWeeklyReportPDF(client.name);

      if (!pdfBuffer) {
        console.log(`⚠️ No data found for ${client.name}. Skipping email.`);
        continue;
      }

      // Save the PDF locally (optional)
      const reportsDir = path.join(__dirname, 'reports');
      fs.mkdirSync(reportsDir, { recursive: true });
      const outputPath = path.join(reportsDir, `${client.name}_WeeklyReport.pdf`);
      fs.writeFileSync(outputPath, pdfBuffer);
      console.log(`📝 PDF report saved locally at: ${outputPath}`);

      // Send email with attachment
      await sendEmailWithAttachment(pdfBuffer, `${client.name}_WeeklyReport.pdf`, client.email);
    }

    console.log('✅ All done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main();
