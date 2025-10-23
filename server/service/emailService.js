import nodemailer from 'nodemailer';

export async function sendClientReport(clientName, toEmail, reportHtml) {
  try {
    // Create transporter
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Test connection before sending
    await transporter.verify();
    console.log(`📬 SMTP connection verified for ${process.env.EMAIL_USER}`);

    // Compose email
    const mailOptions = {
      from: `"BM Security Reports" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: `🛡️ ${clientName} – Guard Patrol Report`,
      html: reportHtml,
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Report sent to ${toEmail}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`❌ Failed to send report to ${toEmail}:`, error.message);
    throw new Error(`Email sending failed for ${clientName}: ${error.message}`);
  }
}
