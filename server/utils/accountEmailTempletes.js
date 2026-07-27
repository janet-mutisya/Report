const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

function timeGreeting() {
  const h = dayjs().tz(TZ).hour();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
function ts() {
  return dayjs().tz(TZ).format('dddd, MMMM D, YYYY [at] h:mm A z');
}

function shell({ accentColor, iconEmoji, title, subtitle, bodyHtml }) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; background:#f0f2f5; padding:15px 10px; line-height:1.6; }
.wrap { max-width:640px; margin:0 auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,.12); }
.hdr { background:linear-gradient(135deg,#000 0%,#1a1a1a 50%,#333 100%); padding:38px 30px; text-align:center; border-bottom:5px solid ${accentColor}; }
.hdr .ico { font-size:50px; display:block; margin-bottom:12px; }
.hdr h1 { font-size:26px; font-weight:900; color:#fff; letter-spacing:2px; text-transform:uppercase; }
.hdr p { font-size:13px; color:#e0e7ff; margin-top:6px; }
.body { padding:28px 34px; }
.greeting { font-size:17px; font-weight:700; color:#111; margin-bottom:14px; padding-bottom:12px; border-bottom:3px solid #e5e7eb; }
.intro { font-size:14px; color:#374151; margin-bottom:18px; line-height:1.75; }
.creds { background:#f9fafb; border:2px solid ${accentColor}33; border-left:5px solid ${accentColor}; border-radius:10px; padding:20px; margin:16px 0; }
.creds h3 { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#6b7280; font-weight:800; margin-bottom:14px; }
.row { display:flex; margin-bottom:10px; align-items:flex-start; }
.lbl { font-size:12px; font-weight:700; color:#9ca3af; width:130px; flex-shrink:0; text-transform:uppercase; letter-spacing:.5px; padding-top:5px; }
.val { font-size:14px; font-weight:700; color:#111; background:#fff; padding:5px 11px; border-radius:6px; border:1.5px solid #e5e7eb; flex:1; word-break:break-all; }
.val.secret { color:${accentColor}; font-family:'Courier New',monospace; letter-spacing:1px; }
.val.badge-green { background:#ecfdf5; color:#065f46; border-color:#10b981; }
.val.badge-yellow { background:#fffbeb; color:#92400e; border-color:#f59e0b; }
.btn-wrap { text-align:center; margin:24px 0; }
.btn { display:inline-block; background:${accentColor}; color:#fff !important; text-decoration:none; font-size:15px; font-weight:800; padding:14px 36px; border-radius:8px; letter-spacing:.5px; }
.btn-sub { font-size:12px; color:#6b7280; margin-top:10px; text-align:center; }
.link-box { background:#f3f4f6; border:1.5px solid #d1d5db; border-radius:8px; padding:12px 14px; margin:12px 0; font-size:12px; color:#374151; word-break:break-all; font-family:'Courier New',monospace; }
.warn { border:2px solid #ef4444; border-left:5px solid #dc2626; background:#fef2f2; border-radius:8px; padding:16px; margin:16px 0; }
.warn p { font-size:13px; color:#111; font-weight:600; line-height:1.6; }
.info { border:2px solid ${accentColor}33; border-left:5px solid ${accentColor}; background:${accentColor}0d; border-radius:8px; padding:16px; margin:16px 0; }
.info p { font-size:13px; color:#111; font-weight:600; line-height:1.6; }
.success-box { border:2px solid #10b981; border-left:5px solid #059669; background:#ecfdf5; border-radius:8px; padding:18px; margin:16px 0; text-align:center; }
.success-box .check { font-size:36px; display:block; margin-bottom:8px; }
.success-box p { font-size:14px; color:#065f46; font-weight:700; }
.ftr { background:linear-gradient(to bottom,#1f2937,#111827); padding:18px 34px; text-align:center; }
.ftr .ts { font-size:12px; color:#d1d5db; }
.ftr .nr { font-size:11px; color:#9ca3af; margin-top:6px; font-style:italic; }
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <span class="ico">${iconEmoji}</span>
    <h1>${title}</h1>
    <p>${subtitle}</p>
  </div>
  <div class="body">${bodyHtml}</div>
  <div class="ftr">
    <div class="ts">${ts()}</div>
    <div class="nr">Automated message — please do not reply to this email.</div>
  </div>
</div>
</body>
</html>`;
}

// ─── Admin welcome ────────────────────────────────────────────────────────────
function generateAdminWelcomeEmail({ name, email, password, position }) {
  return shell({
    accentColor: '#3b82f6', iconEmoji: '🔐', title: 'Staff Account Created', subtitle: 'Security Operations Dashboard',
    bodyHtml: `
      <div class="greeting">${timeGreeting()}, ${name}</div>
      <p class="intro">Your staff account has been created. Use the credentials below to sign in, then change your password immediately.</p>
      <div class="creds">
        <h3>🔑 Login Credentials</h3>
        <div class="row"><span class="lbl">Full Name</span><span class="val">${name}</span></div>
        <div class="row"><span class="lbl">Email</span><span class="val">${email}</span></div>
        <div class="row"><span class="lbl">Password</span><span class="val secret">${password}</span></div>
        <div class="row"><span class="lbl">Position</span><span class="val">${position || 'Staff'}</span></div>
      </div>
      <div class="warn"><p>⚠️ Change your password immediately after your first login. Never share your credentials.</p></div>
    `
  });
}

// ─── Client portal welcome ────────────────────────────────────────────────────
function generateClientWelcomeEmail({ contactName, accountName, clientId, accountNumber, email }) {
  return shell({
    accentColor: '#10b981', iconEmoji: '🛡️', title: 'Client Portal Access', subtitle: 'Security Operations Portal',
    bodyHtml: `
      <div class="greeting">${timeGreeting()}, ${contactName || accountName}</div>
      <p class="intro">Welcome to the Security Operations Client Portal. Your account has been set up.</p>
      <div class="creds">
        <h3>🔑 Login Credentials</h3>
        <div class="row"><span class="lbl">Account Name</span><span class="val">${accountName}</span></div>
        <div class="row"><span class="lbl">Client ID</span><span class="val secret">${clientId}</span></div>
        <div class="row"><span class="lbl">Account Number</span><span class="val secret">${accountNumber}</span></div>
        ${email ? `<div class="row"><span class="lbl">Email</span><span class="val">${email}</span></div>` : ''}
      </div>
      <div class="info"><p>ℹ️ Sign in using your <strong>Client ID</strong> and <strong>Account Number</strong> on the client login page.</p></div>
    `
  });
}

// ─── Password reset (admin-initiated) ────────────────────────────────────────
function generatePasswordResetEmail({ name, email, newPassword }) {
  return shell({
    accentColor: '#7c3aed', iconEmoji: '🔑', title: 'Password Reset', subtitle: 'Security Operations Dashboard',
    bodyHtml: `
      <div class="greeting">${timeGreeting()}, ${name}</div>
      <p class="intro">Your password has been reset by a system administrator. Use the credentials below to sign back in.</p>
      <div class="creds">
        <h3>🔑 New Credentials</h3>
        <div class="row"><span class="lbl">Email</span><span class="val">${email}</span></div>
        <div class="row"><span class="lbl">New Password</span><span class="val secret">${newPassword}</span></div>
      </div>
      <div class="warn"><p>⚠️ If you did not request this reset, contact your system administrator immediately.</p></div>
    `
  });
}

// ─── Portal signup — welcome to registrant ───────────────────────────────────
function generateSignupWelcomeEmail({ companyName, email, autoLinked, accountNumber }) {
  const statusBadge = autoLinked
    ? `<div class="row"><span class="lbl">Status</span><span class="val badge-green">✅ Linked — Dashboard Ready</span></div>`
    : `<div class="row"><span class="lbl">Status</span><span class="val badge-yellow">⏳ Pending Link — Under Review</span></div>`;
  const statusNote = autoLinked
    ? `<div class="info"><p>✅ We automatically matched your company to an existing BM Security account. Your dashboard is ready.</p></div>`
    : `<div class="info"><p>⏳ Our team will verify and link your security account within <strong>1 business day</strong>. You will receive a follow-up email once your dashboard is ready.</p></div>`;
  return shell({
    accentColor: '#3b82f6', iconEmoji: '🛡️', title: 'Welcome to the Portal', subtitle: 'BM Security — Client Dashboard',
    bodyHtml: `
      <div class="greeting">${timeGreeting()},</div>
      <p class="intro">Thank you for registering on the <strong>BM Security Client Portal</strong>.</p>
      <div class="creds">
        <h3>📋 Account Details</h3>
        <div class="row"><span class="lbl">Company</span><span class="val">${companyName}</span></div>
        <div class="row"><span class="lbl">Email</span><span class="val">${email}</span></div>
        ${accountNumber ? `<div class="row"><span class="lbl">Account No.</span><span class="val secret">${accountNumber}</span></div>` : ''}
        ${statusBadge}
      </div>
      ${statusNote}
      <div class="warn"><p>🔒 If you did not create this account, contact us immediately at <strong>${process.env.EMAIL_USER || 'alerts@bmsecurity.com'}</strong>.</p></div>
    `
  });
}

// ─── Portal signup — admin notification ──────────────────────────────────────
function generateSignupAdminNotificationEmail({ companyName, email, autoLinked, confidence, discoveryMethod, accountNumber, linkedClientId }) {
  const statusBadge = autoLinked
    ? `<span class="val badge-green">✅ Auto-Linked (${confidence})</span>`
    : `<span class="val badge-yellow">⏳ Pending Manual Link</span>`;
  const actionNote = autoLinked
    ? `<div class="info"><p>✅ Linked to BM Security client ID <strong>${linkedClientId}</strong> via <strong>${discoveryMethod}</strong> with <strong>${confidence}</strong> confidence. No action required.</p></div>`
    : `<div class="warn"><p>⚠️ Could not be automatically linked. Please log in to the admin dashboard and manually link this company to their BM Security account.</p></div>`;
  return shell({
    accentColor: '#f59e0b', iconEmoji: '🔔', title: 'New Portal Signup', subtitle: 'Action Required — BM Security Admin',
    bodyHtml: `
      <div class="greeting">${timeGreeting()}, Admin</div>
      <p class="intro">A new client has registered on the BM Security Client Portal.</p>
      <div class="creds">
        <h3>📋 Registration Details</h3>
        <div class="row"><span class="lbl">Company</span><span class="val">${companyName}</span></div>
        <div class="row"><span class="lbl">Email</span><span class="val">${email}</span></div>
        <div class="row"><span class="lbl">Registered At</span><span class="val">${ts()}</span></div>
        <div class="row"><span class="lbl">Link Status</span>${statusBadge}</div>
        ${autoLinked ? `<div class="row"><span class="lbl">Confidence</span><span class="val">${confidence}</span></div>` : ''}
        ${autoLinked ? `<div class="row"><span class="lbl">Method</span><span class="val">${discoveryMethod}</span></div>` : ''}
        ${accountNumber ? `<div class="row"><span class="lbl">Account No.</span><span class="val secret">${accountNumber}</span></div>` : ''}
        ${linkedClientId ? `<div class="row"><span class="lbl">Client ID</span><span class="val secret">${linkedClientId}</span></div>` : ''}
      </div>
      ${actionNote}
    `
  });
}

// ─── Forgot password — reset link email ──────────────────────────────────────
function generatePasswordResetRequestEmail({ name, email, resetUrl, userType }) {
  const roleLabel = userType === 'admin' ? 'Staff / Admin' : 'Client Portal';
  return shell({
    accentColor: '#f59e0b', iconEmoji: '🔑', title: 'Password Reset Request', subtitle: `BM Security — ${roleLabel}`,
    bodyHtml: `
      <div class="greeting">${timeGreeting()}, ${name}</div>
      <p class="intro">We received a request to reset the password for <strong>${email}</strong>.
      Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.</p>
      <div class="btn-wrap">
        <a class="btn" href="${resetUrl}">Reset My Password</a>
        <p class="btn-sub">Button not working? Copy and paste the link below into your browser:</p>
        <div class="link-box">${resetUrl}</div>
      </div>
      <div class="warn">
        <p>⚠️ If you did not request a password reset, you can safely ignore this email — your password will not change.
        This link will expire automatically in 1 hour.</p>
      </div>
      <div class="info">
        <p>🔒 For your security, never share this link with anyone. BM Security staff will never ask for your password.</p>
      </div>
    `
  });
}

// ─── Forgot password — success confirmation ───────────────────────────────────
function generatePasswordResetConfirmEmail({ email }) {
  return shell({
    accentColor: '#10b981', iconEmoji: '✅', title: 'Password Changed', subtitle: 'BM Security Portal',
    bodyHtml: `
      <div class="greeting">${timeGreeting()},</div>
      <p class="intro">The password for <strong>${email}</strong> has been successfully changed.</p>
      <div class="success-box">
        <span class="check">🎉</span>
        <p>Your password has been updated. You can now log in with your new password.</p>
      </div>
      <div class="warn">
        <p>⚠️ If you did not make this change, your account may be compromised.
        Contact us immediately at <strong>${process.env.EMAIL_USER || 'alerts@bmsecurity.com'}</strong>.</p>
      </div>
    `
  });
}

module.exports = {
  generateAdminWelcomeEmail,
  generateClientWelcomeEmail,
  generatePasswordResetEmail,
  generateSignupWelcomeEmail,
  generateSignupAdminNotificationEmail,
  generatePasswordResetRequestEmail,
  generatePasswordResetConfirmEmail,
};