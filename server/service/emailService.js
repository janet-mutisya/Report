// server/service/emailService.js - CLEAN COMPACT VERSION
import nodemailer from 'nodemailer';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

// ----------------- LOGGER -----------------
const logger = {
  info: (...args) => console.log('[EMAIL]', ...args),
  warn: (...args) => console.warn('[EMAIL WARNING]', ...args),
  error: (...args) => console.error('[EMAIL ERROR]', ...args),
};

// ----------------- CONFIG VALIDATION -----------------
function validateEmailConfig() {
  const requiredVars = {
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASS: process.env.EMAIL_PASS,
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_PORT: process.env.EMAIL_PORT,
  };

  const missing = Object.entries(requiredVars)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    const error = `Missing required environment variables: ${missing.join(', ')}`;
    logger.error(error);
    throw new Error(error);
  }

  logger.info('Email configuration validated');
  return requiredVars;
}

// ----------------- TRANSPORTER -----------------
function createEmailTransporter() {
  const config = validateEmailConfig();

  return nodemailer.createTransport({
    host: config.EMAIL_HOST,
    port: parseInt(config.EMAIL_PORT),
    secure: parseInt(config.EMAIL_PORT) === 465,
    auth: {
      user: config.EMAIL_USER,
      pass: config.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 30000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

// ----------------- COMPACT TEMPLATE GENERATOR -----------------
function generateGuardReportEmail(recipientName, clientName, startDate, endDate) {
  const safeRecipient = recipientName || 'Valued Partner';
  const start = dayjs(startDate).tz(TZ);
  const end = dayjs(endDate).tz(TZ);

  const hour = dayjs().tz(TZ).hour();
  let greeting = 'Good day';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';
  else greeting = 'Good evening';

  const dateRange = `${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')}`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { 
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background: #f0f2f5;
  padding: 15px 10px;
  line-height: 1.5;
}
.email-container { 
  max-width: 680px; 
  margin: 0 auto; 
  background: #ffffff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0,0,0,0.1);
}
.header-banner { 
  background: linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%);
  padding: 30px 25px;
  text-align: center;
}
.shield-icon {
  font-size: 40px;
  margin-bottom: 8px;
  display: block;
}
.header-banner h1 { 
  font-size: 24px;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 5px;
}
.header-banner p { 
  font-size: 13px;
  color: rgba(255,255,255,0.9);
}
.content-wrapper { 
  padding: 25px 30px;
}
.greeting-text { 
  font-size: 17px;
  color: #1a202c;
  font-weight: 600;
  margin-bottom: 15px;
  padding-bottom: 10px;
  border-bottom: 2px solid #e2e8f0;
}
.main-message { 
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #ffffff;
  padding: 20px;
  margin: 15px 0;
  border-radius: 10px;
}
.main-message p { 
  font-size: 15px;
  line-height: 1.5;
  margin: 0;
}
.main-message .date-highlight {
  font-size: 17px;
  font-weight: 700;
  margin-top: 10px;
  display: block;
}
.info-card {
  background: #f7fafc;
  border: 2px solid #e2e8f0;
  border-radius: 10px;
  padding: 15px;
  margin: 15px 0;
}
.info-label {
  font-size: 11px;
  text-transform: uppercase;
  color: #718096;
  font-weight: 700;
  margin-bottom: 5px;
}
.info-value {
  font-size: 15px;
  color: #2d3748;
  font-weight: 600;
}
.attachment-box {
  background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
  color: #ffffff;
  padding: 18px;
  border-radius: 10px;
  text-align: center;
  margin: 15px 0;
}
.attachment-icon-large {
  font-size: 36px;
  margin-bottom: 8px;
  display: block;
}
.attachment-box strong {
  font-size: 16px;
  display: block;
  margin-bottom: 4px;
}
.attachment-box small {
  font-size: 13px;
}
.support-box {
  background: #fff5f5;
  border-left: 4px solid #fc8181;
  padding: 18px;
  border-radius: 8px;
  margin-top: 20px;
}
.support-box h3 {
  font-size: 15px;
  color: #c53030;
  margin-bottom: 8px;
  font-weight: 700;
}
.support-box p {
  font-size: 14px;
  color: #4a5568;
  line-height: 1.5;
  margin-bottom: 8px;
}
.support-box p:last-child {
  margin-bottom: 0;
  font-weight: 600;
  color: #2d3748;
}
.footer-section {
  background: linear-gradient(to bottom, #2d3748, #1a202c);
  color: #cbd5e0;
  padding: 20px 30px;
  text-align: center;
}
.footer-branding {
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 6px;
}
.footer-timestamp {
  color: #a0aec0;
  font-size: 12px;
  margin-top: 4px;
}
.no-reply-text {
  font-size: 11px;
  color: #718096;
  margin-top: 10px;
  font-style: italic;
}
@media only screen and (max-width: 600px) {
  .content-wrapper { padding: 20px; }
  .header-banner { padding: 25px 20px; }
  .header-banner h1 { font-size: 22px; }
}
</style>
</head>
<body>
<div class="email-container">
<div class="header-banner">
<span class="shield-icon">🛡️</span>
<h1>Security Operations Report</h1>
<p>Professional Security Intelligence & Documentation</p>
</div>
<div class="content-wrapper">
<div class="greeting-text">${greeting}, ${safeRecipient}</div>
<div class="main-message">
<p>Kindly review the security report covering the period:</p>
<span class="date-highlight">${dateRange}</span>
</div>
<div class="info-card">
<div class="info-label">📅 REPORT PERIOD</div>
<div class="info-value">${dateRange}</div>
</div>
<div class="attachment-box">
<span class="attachment-icon-large">📎</span>
<strong>Secure PDF Report Attached</strong>
<small>Professional documentation ready for immediate download and review</small>
</div>
<div class="support-box">
<h3>💬 Questions or Assistance Needed?</h3>
<p>Should you require clarification on any incidents, need additional documentation, or have questions regarding the information contained in this report, please don't hesitate to reach out to your designated branch manager.</p>
<p>We greatly value your continued partnership and trust in our security services.</p>
</div>
</div>
<div class="footer-section">
<div class="footer-branding">🛡️ Security Operations Team</div>
<div class="footer-timestamp">Report Generated: ${dayjs().tz(TZ).format('dddd, MMMM D, YYYY [at] h:mm A z')}</div>
<div class="no-reply-text">This is an automated notification from our security reporting system. Please do not reply directly to this email address.</div>
</div>
</div>
</body>
</html>`;
}

// ----------------- SEND EMAIL WITH RETRY -----------------
async function sendEmailWithRetry(mailOptions, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Email attempt ${attempt}/${maxRetries}`);
      const transporter = createEmailTransporter();
      if (attempt === 1) await transporter.verify();
      const info = await transporter.sendMail(mailOptions);
      logger.info(`Email sent successfully: ${info.messageId}`);
      return info;
    } catch (error) {
      lastError = error;
      logger.error(`Attempt ${attempt} failed:`, error.message);
      if (attempt < maxRetries) {
        const waitTime = 2 ** attempt * 1000;
        logger.info(`Retrying in ${waitTime}ms...`);
        await new Promise(res => setTimeout(res, waitTime));
      }
    }
  }

  throw new Error(`Failed to send email after ${maxRetries} attempts: ${lastError.message}`);
}

// ----------------- EXPORTABLE FUNCTIONS -----------------
export async function sendGuardReport({ to, recipientName = '', clientName = '', startDate, endDate, pdfBuffer, pdfFilename }) {
  validateEmailConfig();

  const safeRecipient = recipientName || to.split('@')[0] || 'Valued Partner';
  const safeClient = clientName || 'Client';

  const emailHtml = generateGuardReportEmail(safeRecipient, safeClient, startDate, endDate);

  const start = dayjs(startDate).tz(TZ);
  const end = dayjs(endDate).tz(TZ);
  const isSingleDay = start.isSame(end, 'day');
  const daysDiff = end.diff(start, 'day');

  const subject = isSingleDay
    ? `🛡️ Security Report: ${safeClient} | ${start.format('YYYY-MM-DD')}`
    : `🛡️ Security Report: ${safeClient} | ${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')}`;

  const fromName = process.env.FROM_NAME || 'Security Operations';
  const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_USER;

  const filename = pdfFilename || `Security_Report_${safeClient.replace(/\s+/g, '_')}_${start.format('YYYY-MM-DD')}_to_${end.format('YYYY-MM-DD')}.pdf`;

  logger.info(`📧 Sending email: ${daysDiff} days from ${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')}`);

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    html: emailHtml,
    attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
    priority: 'normal',
    headers: {
      'X-Report-Type': 'Security-Operations',
      'X-Report-Period': `${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')}`,
      'X-Client-Name': safeClient,
      'X-Report-Days': daysDiff.toString()
    }
  };

  return await sendEmailWithRetry(mailOptions);
}

export async function sendPatrolReport(options) { return sendGuardReport(options); }
export async function sendHistoricalReport(options) { return sendGuardReport(options); }

export async function sendSimpleEmail({ to, subject, text, html, attachments }) {
  const fromName = process.env.FROM_NAME || 'Security Operations';
  const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_USER;

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text,
    html: html || text,
    attachments,
  };

  return await sendEmailWithRetry(mailOptions);
}

export async function testSMTPConnection() {
  try {
    const transporter = createEmailTransporter();
    await transporter.verify();
    logger.info('SMTP connection successful');
    return true;
  } catch (error) {
    logger.error('SMTP connection failed:', error.message);
    return false;
  }
}

export default {
  sendGuardReport,
  sendPatrolReport,
  sendHistoricalReport,
  sendSimpleEmail,
  validateEmailConfig,
  testSMTPConnection
};