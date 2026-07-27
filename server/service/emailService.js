'use strict';

const nodemailer = require('nodemailer');
const fs         = require('fs').promises;
const fsSync     = require('fs');
const path       = require('path');
const dayjs      = require('dayjs');
const utc        = require('dayjs/plugin/utc.js');
const timezone   = require('dayjs/plugin/timezone.js');

// Drive helpers
const { saveReportToDrive } = require('./driveService.js');

const { getTempPdfPath, cleanupOldTempFiles } = require('../utils/paths');

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

// ── Loggers ───────────────────────────────────────────────────────────────────
const logger = {
  info:    (...a) => console.log('[EMAIL]',         ...a),
  warn:    (...a) => console.warn('[EMAIL WARNING]', ...a),
  error:   (...a) => console.error('[EMAIL ERROR]',  ...a),
  debug:   (...a) => console.log('[EMAIL DEBUG]',    ...a),
  success: (...a) => console.log('[EMAIL SUCCESS]',  ...a),
};

// ════════════════════════════════════════════════════════════════
// SINGLETON TRANSPORTER (FIX 5: Reuse transporter, don't recreate)
// ════════════════════════════════════════════════════════════════
let singletonTransporter = null;
let transporterCreatedAt = null;

function getTransporter() {
  // Reuse existing transporter if it exists and is still valid (within 1 hour)
  const now = Date.now();
  if (singletonTransporter && transporterCreatedAt && (now - transporterCreatedAt) < 3600000) {
    logger.debug('Reusing existing transporter (created ' + Math.round((now - transporterCreatedAt) / 1000) + 's ago)');
    return singletonTransporter;
  }
  
  // Create new transporter
  logger.info('Creating new email transporter instance');
  const config = validateEmailConfig();
  const port   = parseInt(config.EMAIL_PORT, 10);

  logger.debug('Email transporter config:', {
    host: config.EMAIL_HOST, 
    port, 
    secure: port === 465, 
    user: config.EMAIL_USER,
    pool: true,
    maxConnections: 5,
  });

  const transporter = nodemailer.createTransport({
    host:   config.EMAIL_HOST,
    port,
    secure: port === 465,
    auth:   { user: config.EMAIL_USER, pass: config.EMAIL_PASS },
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    },
    // Connection pooling for better performance
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,
    // Timeouts (increased for large attachments)
    connectionTimeout: 120000,  // 2 minutes
    greetingTimeout:   60000,   // 1 minute
    socketTimeout:     180000,  // 3 minutes
  });

  singletonTransporter = transporter;
  transporterCreatedAt = now;
  
  // FIX 5: Only verify in development mode, skip in production
  if (process.env.NODE_ENV === 'development') {
    // Don't await - do it async to not block startup
    transporter.verify().then(() => {
      logger.info('SMTP connection verified (development mode)');
    }).catch(err => {
      logger.warn('SMTP verification failed (will retry on first send):', err.message);
    });
  } else {
    logger.info('Transporter created (skipping verify in production)');
  }
  
  return transporter;
}

// Close transporter gracefully (call on app shutdown)
async function closeTransporter() {
  if (singletonTransporter) {
    logger.info('Closing email transporter...');
    await singletonTransporter.close();
    singletonTransporter = null;
    transporterCreatedAt = null;
    logger.info('Email transporter closed');
  }
}

// ════════════════════════════════════════════════════════════════
// EMAIL — config & validation
// ════════════════════════════════════════════════════════════════

function validateEmailConfig() {
  const required = {
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASS: process.env.EMAIL_PASS,
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_PORT: process.env.EMAIL_PORT,
  };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    const msg = `Missing required environment variables: ${missing.join(', ')}`;
    logger.error(msg);
    throw new Error(msg);
  }
  logger.debug('Email configuration validated');
  return required;
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function normalizeEmailList(emails) {
  if (!emails) return [];
  if (Array.isArray(emails)) {
    return emails.map(e => e.trim()).filter(isValidEmail);
  }
  if (typeof emails === 'string') {
    return emails.split(/[,;]/).map(e => e.trim()).filter(isValidEmail);
  }
  return [];
}

function validateRecipients(to, cc = null, bcc = null) {
  const toEmails  = normalizeEmailList(to);
  const ccEmails  = normalizeEmailList(cc);
  const bccEmails = normalizeEmailList(bcc);
  const total     = toEmails.length + ccEmails.length + bccEmails.length;
  if (total === 0) throw new Error('At least one valid recipient email is required');
  return { to: toEmails, cc: ccEmails, bcc: bccEmails, totalRecipients: total };
}

// ── Email HTML template ───────────────────────────────────────────────────────
function generateGuardReportEmail(recipientName, clientName, startDate, endDate) {
  logger.debug('Generating email template:', { startDate, endDate });

  const start = dayjs(startDate).tz(TZ);
  const end   = dayjs(endDate).tz(TZ);

  if (!start.isValid() || !end.isValid())
    throw new Error('Invalid date format provided for email template');

  const hour      = dayjs().tz(TZ).hour();
  const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateRange = `${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')}`;
  const safe      = recipientName || 'Valued Partner';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f2f5; padding: 15px 10px; line-height: 1.6; }
.email-container { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.12); }
.header-banner { background: linear-gradient(135deg, #000000 0%, #1a1a1a 50%, #333333 100%); padding: 40px 30px; text-align: center; border-bottom: 5px solid #fbbf24; }
.shield-icon { font-size: 56px; margin-bottom: 15px; display: block; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.5)); }
.header-banner h1 { font-size: 34px; font-weight: 900; color: #ffffff; margin-bottom: 10px; text-shadow: 0 3px 10px rgba(0,0,0,0.6); letter-spacing: 2px; text-transform: uppercase; }
.content-wrapper { padding: 30px 35px; background: #ffffff; }
.greeting-text { font-size: 18px; color: #111827; font-weight: 700; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 3px solid #e5e7eb; }
.main-message { background: #eff6ff; color: #111827; padding: 24px; margin: 18px 0; border-radius: 12px; border: 3px solid #3b82f6; box-shadow: 0 4px 12px rgba(59,130,246,0.2); }
.main-message p { font-size: 16px; line-height: 1.7; margin: 0; color: #1f2937; font-weight: 500; }
.main-message .date-highlight { font-size: 20px; font-weight: 800; margin-top: 12px; display: block; color: #1e3a8a; background: #dbeafe; padding: 12px 16px; border-radius: 8px; text-align: center; border: 2px solid #3b82f6; }
.info-card { background: #f9fafb; border: 3px solid #d1d5db; border-radius: 12px; padding: 20px; margin: 18px 0; }
.info-label { font-size: 13px; text-transform: uppercase; color: #111827; font-weight: 800; margin-bottom: 8px; letter-spacing: 1px; }
.info-value { font-size: 17px; color: #111827; font-weight: 700; }
.attachment-box { background: #ecfdf5; color: #111827; padding: 24px; border-radius: 12px; text-align: center; margin: 18px 0; border: 3px solid #10b981; box-shadow: 0 4px 12px rgba(16,185,129,0.2); }
.attachment-icon-large { font-size: 42px; margin-bottom: 10px; display: block; }
.attachment-box strong { font-size: 18px; display: block; margin-bottom: 6px; color: #064e3b; font-weight: 800; }
.attachment-box small { font-size: 14px; color: #1f2937; font-weight: 500; }
.support-box { background: #fef2f2; border: 3px solid #ef4444; border-left: 6px solid #dc2626; padding: 22px; border-radius: 10px; margin-top: 24px; }
.support-box h3 { font-size: 17px; color: #7f1d1d; margin-bottom: 10px; font-weight: 800; }
.support-box p { font-size: 15px; color: #111827; line-height: 1.7; margin-bottom: 10px; font-weight: 500; }
.support-box p:last-child { margin-bottom: 0; font-weight: 700; color: #000000; }
.footer-section { background: linear-gradient(to bottom, #1f2937, #111827); color: #e5e7eb; padding: 24px 35px; text-align: center; }
.footer-timestamp { color: #d1d5db; font-size: 13px; margin-top: 6px; font-weight: 500; }
.no-reply-text { font-size: 12px; color: #9ca3af; margin-top: 12px; font-style: italic; }
@media only screen and (max-width:600px) {
  .content-wrapper { padding: 24px; }
  .header-banner { padding: 28px 24px; }
  .header-banner h1 { font-size: 24px; }
  .shield-icon { font-size: 42px; }
  .main-message .date-highlight { font-size: 18px; }
}
</style>
</head>
<body>
<div class="email-container">
  <div class="header-banner">
    <span class="shield-icon">🛡️</span>
    <h1>GUARD PATROL REPORT</h1>
  </div>
  <div class="content-wrapper">
    <div class="greeting-text">${greeting}, ${safe}</div>
    <div class="main-message">
      <p>Kindly review the Patrol Report covering the period:</p>
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
    <div class="footer-timestamp">Report Generated: ${dayjs().tz(TZ).format('dddd, MMMM D, YYYY [at] h:mm A z')}</div>
    <div class="no-reply-text">This is an automated notification. Please do not reply directly to this email.</div>
  </div>
</div>
</body>
</html>`;
}

// ── Send with retry (FIX 5: Use singleton transporter) ────────────────────────
async function sendEmailWithRetry(mailOptions, maxRetries = 3) {
  let lastError;
  const transporter = getTransporter(); // Get singleton transporter (FIX 5)
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Attempt ${attempt}/${maxRetries} → to: ${mailOptions.to}`);
      if (mailOptions.cc)  logger.debug(`   cc:  ${mailOptions.cc}`);
      if (mailOptions.bcc) logger.debug(`   bcc: ${mailOptions.bcc}`);

      // FIX 5: NO transporter.verify() here - too expensive, removed completely
      // Just send directly

      const info = await transporter.sendMail(mailOptions);

      logger.success(`Email sent ✓ messageId=${info.messageId}`);
      return info;
    } catch (err) {
      lastError = err;
      logger.error(`Attempt ${attempt} failed: ${err.message}`);
      if (err.code)         logger.error(`  code: ${err.code}`);
      if (err.command)      logger.error(`  command: ${err.command}`);
      if (err.responseCode) logger.error(`  responseCode: ${err.responseCode}`);
      
      if (attempt < maxRetries) {
        const wait = 2 ** attempt * 1000;
        logger.info(`Retrying in ${wait}ms…`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw new Error(`Failed to send email after ${maxRetries} attempts: ${lastError.message}`);
}

// ── Temp file helpers ─────────────────────────────────────────────────────────
async function saveToTempFile(pdfBuffer, prefix = 'email-report') {
  try {
    const tempPath = getTempPdfPath(prefix);
    const tempDir  = path.dirname(tempPath);
    logger.debug(`Saving PDF to temp: ${tempPath} (${pdfBuffer.length} bytes)`);
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(tempPath, pdfBuffer);
    logger.debug(`PDF saved ✓ ${tempPath}`);
    return tempPath;
  } catch (err) {
    logger.error(`Failed to save PDF temp file: ${err.message}`);
    throw err;
  }
}

async function cleanupTempFile(filePath) {
  try {
    if (filePath && await fs.access(filePath).then(() => true).catch(() => false)) {
      await fs.unlink(filePath);
      logger.debug(`Cleaned up temp file: ${filePath}`);
    }
  } catch (err) {
    logger.warn(`Failed to clean up temp file ${filePath}: ${err.message}`);
  }
}

// ════════════════════════════════════════════════════════════════
// sendGuardReport — main send function (TO / CC / BCC + Drive)
// ════════════════════════════════════════════════════════════════
async function sendGuardReport({
  to,
  cc            = null,
  bcc           = null,
  recipientName = '',
  clientName    = '',
  startDate,
  endDate,
  pdfBuffer,
  pdfFilename,
}) {
  let tempFilePath = null;
  let driveResult  = null;

  try {
    validateEmailConfig();

    logger.info('========== EMAIL SEND START ==========');
    const recipients = validateRecipients(to, cc, bcc);
    logger.info(`Recipients: ${recipients.totalRecipients} total`);
    logger.info(`  TO:  ${recipients.to.join(', ')}`);
    if (recipients.cc.length)  logger.info(`  CC:  ${recipients.cc.join(', ')}`);
    if (recipients.bcc.length) logger.info(`  BCC: ${recipients.bcc.join(', ')}`);

    const start = dayjs(startDate).tz(TZ);
    const end   = dayjs(endDate).tz(TZ);
    if (!start.isValid()) throw new Error(`Invalid startDate: "${startDate}"`);
    if (!end.isValid())   throw new Error(`Invalid endDate: "${endDate}"`);
    logger.info(`Dates: ${start.format('YYYY-MM-DD')} → ${end.format('YYYY-MM-DD')}`);

    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer))
      throw new Error('Invalid PDF buffer provided');
    logger.info(`PDF: ${Math.round(pdfBuffer.length / 1024)}KB`);

    const safeClient    = clientName || 'Client';
    const safeRecipient = recipientName || (recipients.to.length === 1
      ? recipients.to[0].split('@')[0]
      : 'Team');

    // Save to temp file (shared by email attachment + Drive upload)
    tempFilePath = await saveToTempFile(
      pdfBuffer,
      `guard-report-${safeClient.replace(/\s+/g, '_')}`
    );

    const emailHtml   = generateGuardReportEmail(safeRecipient, safeClient, startDate, endDate);
    const isSingleDay = start.isSame(end, 'day');
    const subject     = isSingleDay
      ? `🛡️ Patrol Report: ${safeClient} | ${start.format('YYYY-MM-DD')}`
      : `🛡️ Patrol Report: ${safeClient} | ${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')}`;

    const fromName  = process.env.FROM_NAME  || 'Security Operations';
    const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_USER;
    const filename  = pdfFilename
      || `Patrol_Report_${safeClient.replace(/\s+/g, '_')}_${start.format('YYYY-MM-DD')}_to_${end.format('YYYY-MM-DD')}.pdf`;

    logger.info(`Subject: ${subject}`);
    logger.info(`From:    "${fromName}" <${fromEmail}>`);

    const mailOptions = {
      from:        `"${fromName}" <${fromEmail}>`,
      to:          recipients.to.join(', '),
      subject,
      html:        emailHtml,
      attachments: [{ filename, path: tempFilePath, contentType: 'application/pdf' }],
      priority:    'normal',
      headers: {
        'X-Report-Type':      'Security-Operations',
        'X-Report-Period':    `${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')}`,
        'X-Client-Name':      safeClient,
        'X-Total-Recipients': recipients.totalRecipients.toString(),
      },
    };
    if (recipients.cc.length)  mailOptions.cc  = recipients.cc.join(', ');
    if (recipients.bcc.length) mailOptions.bcc = recipients.bcc.join(', ');

    const result = await sendEmailWithRetry(mailOptions);

    logger.success('========== EMAIL SENT ==========');
    logger.info(`messageId=${result.messageId} recipients=${recipients.totalRecipients}`);

    // ── Upload to Google Drive (FIX 6: Optional, controlled by env) ────────────
    const enableDriveUpload = process.env.ENABLE_DRIVE_UPLOAD === 'true';
    const useSharedDrive = process.env.USE_SHARED_DRIVE === 'true';
    
    if (enableDriveUpload && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      if (useSharedDrive) {
        try {
          logger.info('Uploading to Google Drive (Shared Drive mode)...');
          driveResult = await saveReportToDrive({
            filePath:   tempFilePath,
            clientName: safeClient,
            startDate:  start.format('YYYY-MM-DD'),
            endDate:    end.format('YYYY-MM-DD'),
          });
          if (driveResult && driveResult.id) {
            logger.success(`Drive upload successful ✓ ID: ${driveResult.id}`);
          }
        } catch (driveErr) {
          logger.warn(`Drive upload failed (non-fatal): ${driveErr.message}`);
          driveResult = { saved: false, error: driveErr.message };
        }
      } else {
        logger.warn('Drive upload skipped: Shared Drive mode not enabled (USE_SHARED_DRIVE=true required for service accounts)');
      }
    } else if (!enableDriveUpload) {
      logger.debug('Drive upload disabled (ENABLE_DRIVE_UPLOAD=false)');
    } else if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      logger.debug('Drive upload skipped: No service account key configured');
    }

    // ── Cleanup temp file ─────────────────────────────────────────────────────
    await cleanupTempFile(tempFilePath);
    tempFilePath = null;
    
    // Periodic cleanup (every 10 emails)
    if (Math.random() < 0.1) {
      await cleanupOldTempFiles();
    }

    return {
      success:    true,
      messageId:  result.messageId,
      recipients: recipients.totalRecipients,
      to:         recipients.to,
      cc:         recipients.cc,
      bcc:        recipients.bcc,
      drive: driveResult
        ? { saved: true,  id: driveResult.id, link: driveResult.link }
        : { saved: false, reason: driveResult?.error || 'Upload disabled or not configured' },
    };
  } catch (err) {
    logger.error('========== EMAIL FAILED ==========');
    logger.error(err.message);
    if (tempFilePath) await cleanupTempFile(tempFilePath);
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════
// sendWithTransporter — For scheduler reuse (FIX 5)
// ════════════════════════════════════════════════════════════════
async function sendWithTransporter(transporter, emailData) {
  const {
    to,
    cc = null,
    bcc = null,
    clientName = '',
    startDate,
    endDate,
    pdfBuffer,
    pdfFilename,
    frequency = 'weekly',
    reportDate = null,
    subjectPrefix = "Security Report",
    isCatchup = false,
    enableDriveUpload = false,
  } = emailData;

  let tempFilePath = null;
  let driveResult = null;

  try {
    logger.info('========== SCHEDULER EMAIL SEND START ==========');
    
    const recipients = validateRecipients(to, cc, bcc);
    logger.info(`Recipients: ${recipients.totalRecipients} total`);
    logger.info(`  TO:  ${recipients.to.join(', ')}`);
    if (recipients.cc.length) logger.info(`  CC:  ${recipients.cc.join(', ')}`);
    if (recipients.bcc.length) logger.info(`  BCC: ${recipients.bcc.join(', ')}`);

    const start = dayjs(startDate).tz(TZ);
    const end = dayjs(endDate).tz(TZ);
    const safeClient = clientName || 'Client';
    const safeRecipient = recipients.to.length === 1 ? recipients.to[0].split('@')[0] : 'Team';

    // Save to temp file
    tempFilePath = await saveToTempFile(
      pdfBuffer,
      `scheduler-${safeClient.replace(/\s+/g, '_')}`
    );

    const emailHtml = generateGuardReportEmail(safeRecipient, safeClient, startDate, endDate);
    const subject = isCatchup
      ? `${subjectPrefix}: ${safeClient} - ${startDate} to ${endDate} (Catchup)`
      : `${subjectPrefix}: ${safeClient} - ${startDate} to ${endDate}`;

    const fromName = process.env.FROM_NAME || 'Security Operations';
    const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_USER;
    const filename = pdfFilename || `Security_Report_${safeClient.replace(/\s+/g, '_')}_${startDate}_${endDate}.pdf`;

    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: recipients.to.join(', '),
      subject,
      html: emailHtml,
      attachments: [{ filename, path: tempFilePath, contentType: 'application/pdf' }],
      priority: 'normal',
    };
    
    if (recipients.cc.length) mailOptions.cc = recipients.cc.join(', ');
    if (recipients.bcc.length) mailOptions.bcc = recipients.bcc.join(', ');

    const result = await transporter.sendMail(mailOptions);
    logger.success(`Email sent via scheduler ✓ messageId=${result.messageId}`);

    // Optional Drive upload
    if (enableDriveUpload && process.env.ENABLE_DRIVE_UPLOAD === 'true' && process.env.USE_SHARED_DRIVE === 'true') {
      try {
        driveResult = await saveReportToDrive({
          filePath: tempFilePath,
          clientName: safeClient,
          startDate,
          endDate,
        });
      } catch (driveErr) {
        logger.warn(`Drive upload failed: ${driveErr.message}`);
      }
    }

    await cleanupTempFile(tempFilePath);
    
    return {
      success: true,
      messageId: result.messageId,
      recipients: recipients.totalRecipients,
      drive: driveResult,
    };
  } catch (err) {
    logger.error('Scheduler email failed:', err.message);
    if (tempFilePath) await cleanupTempFile(tempFilePath);
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════
// sendGuardReportToMultiple — individual email per recipient
// ════════════════════════════════════════════════════════════════
async function sendGuardReportToMultiple({
  recipients,
  clientName,
  startDate,
  endDate,
  pdfBuffer,
  pdfFilename,
}) {
  logger.info(`========== BULK SEND: ${recipients.length} recipients ==========`);
  const results = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    logger.info(`[${i + 1}/${recipients.length}] Sending to ${r.email}`);
    try {
      const result = await sendGuardReport({
        to:            r.email,
        recipientName: r.name || r.email.split('@')[0],
        clientName,
        startDate,
        endDate,
        pdfBuffer,
        pdfFilename,
      });
      results.push({
        email:     r.email,
        name:      r.name,
        success:   true,
        messageId: result.messageId,
        drive:     result.drive,
      });
      successCount++;
      logger.success(`✓ ${r.email}`);
    } catch (err) {
      results.push({ email: r.email, name: r.name, success: false, error: err.message });
      failureCount++;
      logger.error(`✗ ${r.email}: ${err.message}`);
    }
    if (i < recipients.length - 1) await new Promise(r => setTimeout(r, 1000));
  }

  logger.info(`========== BULK DONE: ${successCount} ok, ${failureCount} failed ==========`);
  return {
    success: successCount > 0,
    results,
    summary: { total: recipients.length, successful: successCount, failed: failureCount },
  };
}

// ════════════════════════════════════════════════════════════════
// sendSimpleEmail — general-purpose email
// ════════════════════════════════════════════════════════════════
async function sendSimpleEmail({
  to,
  cc          = null,
  bcc         = null,
  subject,
  text,
  html,
  attachments,
}) {
  try {
    const recipients = validateRecipients(to, cc, bcc);
    logger.info(`Sending simple email to ${recipients.totalRecipients} recipient(s)`);

    const fromName  = process.env.FROM_NAME  || 'Security Operations';
    const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_USER;

    const mailOptions = {
      from:        `"${fromName}" <${fromEmail}>`,
      to:          recipients.to.join(', '),
      subject,
      text,
      html:        html || text,
      attachments,
    };
    if (recipients.cc.length)  mailOptions.cc  = recipients.cc.join(', ');
    if (recipients.bcc.length) mailOptions.bcc = recipients.bcc.join(', ');

    return await sendEmailWithRetry(mailOptions);
  } catch (err) {
    logger.error('sendSimpleEmail failed:', err.message);
    throw err;
  }
}

// ── SMTP test ─────────────────────────────────────────────────────────────────
async function testSMTPConnection() {
  try {
    logger.info('Testing SMTP connection…');
    const transporter = getTransporter();
    await transporter.verify();
    logger.success('SMTP connection successful ✓');
    return { success: true, message: 'SMTP connection successful' };
  } catch (err) {
    logger.error('SMTP connection failed:', err.message);
    return { success: false, message: err.message };
  }
}

// ── Aliases ───────────────────────────────────────────────────────────────────
const sendPatrolReport     = (opts) => sendGuardReport(opts);
const sendHistoricalReport = (opts) => sendGuardReport(opts);

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  sendGuardReport,
  sendGuardReportToMultiple,
  sendPatrolReport,
  sendHistoricalReport,
  sendSimpleEmail,
  sendWithTransporter,     // NEW: For scheduler reuse
  validateEmailConfig,
  testSMTPConnection,
  normalizeEmailList,
  validateRecipients,
  saveToTempFile,
  cleanupTempFile,
  getTransporter,          // Export for advanced use
  closeTransporter,        // Export for graceful shutdown
  saveReportToDrive,
};