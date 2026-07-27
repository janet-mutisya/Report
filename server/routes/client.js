/**
 * /api/clients
 *
 * Admin-only (except GET /:id which clients can reach for their own record).
 *
 * When an admin creates a client (POST /):
 *   1. A temp password is generated
 *   2. Bcrypt hash stored in Clients.Password
 *   3. MustChangePassword = 1 (forces password change on first login)
 *   4. Welcome email sent with the plain-text password
 *
 * The Password and MustChangePassword columns must exist:
 *   ALTER TABLE Clients ADD Password NVARCHAR(255) NULL;
 *   ALTER TABLE Clients ADD MustChangePassword BIT NOT NULL DEFAULT 1;
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../config/db');
const { auth, requireAdmin } = require('../middleware/auth');
const { sendSimpleEmail }    = require('../service/emailService');
const { generateClientWelcomeEmail } = require('../utils/accountEmailTemplates');
const bmSecurityAPI = require('../service/bmSecurityAPI');

const router = express.Router();

// ─── helpers ──────────────────────────────────────────────────
function genPassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/**
 * Fire-and-forget credentials email.
 * Returns true/false without throwing.
 */
async function sendClientCredentialsEmail({ to, contactName, accountName, accountNumber, email, password }) {
  try {
    let html;
    try {
      html = generateClientWelcomeEmail({ contactName, accountName, clientId: null, accountNumber, email, password });
    } catch {
      // Fallback if template doesn't support password param
      html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
          <h2>🛡️ Your BM Security Portal Account</h2>
          <p>Hi ${contactName},</p>
          <p>Your portal account has been created by an administrator. Use the credentials below to log in.</p>
          <table style="border-collapse:collapse;width:100%;margin:20px 0">
            <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold;width:40%">Email</td>
                <td style="padding:8px;background:#fff">${email}</td></tr>
            <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Temporary Password</td>
                <td style="padding:8px;background:#fff;font-family:monospace;font-size:16px">${password}</td></tr>
            <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Account Name</td>
                <td style="padding:8px;background:#fff">${accountName}</td></tr>
            ${accountNumber ? `<tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Account Number</td>
                <td style="padding:8px;background:#fff">${accountNumber}</td></tr>` : ''}
          </table>
          <p style="background:#fff3cd;border:1px solid #ffc107;padding:12px;border-radius:6px">
            ⚠️ <strong>You will be asked to change this password on first login.</strong>
          </p>
          <p>Login at: <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}">${process.env.FRONTEND_URL || 'http://localhost:5173'}</a></p>
          <p style="color:#666;font-size:12px;margin-top:32px">BM Security Guard Reporting Portal</p>
        </div>
      `;
    }
    await sendSimpleEmail({ to, subject: '🛡️ Your BM Security Portal — Account Created', html });
    return true;
  } catch (err) {
    console.error('[clientRoutes] credentials email failed:', err.message);
    return false;
  }
}

// ─── GET /api/clients ─────────────────────────────────────────
router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT ClientID, Account_Name, Account_Number,
             Email_Address AS Email, First_Name AS ContactName,
             Telephone_Number AS Telephone, IsActive, CreatedAt, BmClientId,
             MustChangePassword
      FROM Clients
    `;
    const params = [];
    if (search) {
      query += ` WHERE Account_Name LIKE ? OR Account_Number LIKE ? OR Email_Address LIKE ?`;
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    query += ` ORDER BY Account_Name OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`;
    params.push(offset, parseInt(limit));

    const [clients] = await db.query(query, params);

    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM Clients${search ? ' WHERE Account_Name LIKE ? OR Account_Number LIKE ? OR Email_Address LIKE ?' : ''}`,
      search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []
    );

    res.json({
      clients,
      pagination: { total: countResult[0]?.total || 0, page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (e) {
    console.error('[clientRoutes] List clients error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/clients/bm-search ───────────────────────────────
router.get('/bm-search', auth, requireAdmin, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2)
      return res.status(400).json({ message: 'Search query must be at least 2 characters' });

    const allClients = await bmSecurityAPI.getClients();
    const term       = q.trim().toLowerCase();
    const matches    = allClients
      .filter(c =>
        (c.name || '').toLowerCase().includes(term) ||
        (c.accountNumber || '').toLowerCase().includes(term)
      )
      .slice(0, 20)
      .map(c => ({
        bmClientId:    c.id,
        accountName:   c.name,
        accountNumber: c.accountNumber,
        email:         c.email  || null,
        phone:         c.phone  || null,
        active:        c.active,
      }));

    res.json({ results: matches, total: matches.length });
  } catch (e) {
    console.error('[clientRoutes] BM search error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/clients/bm-all ──────────────────────────────────
router.get('/bm-all', auth, requireAdmin, async (req, res) => {
  try {
    const allClients = await bmSecurityAPI.getClients();
    res.json({ clients: allClients, total: allClients.length });
  } catch (e) {
    console.error('[clientRoutes] BM all clients error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/clients/:id ─────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    // Clients can only view their own record
    if (req.user.role === 'client' && String(req.user.clientId) !== String(req.params.id))
      return res.status(403).json({ message: 'Access denied' });

    const [clients] = await db.query(
      `SELECT ClientID, Account_Name, Account_Number,
              Email_Address AS Email, First_Name AS ContactName,
              Telephone_Number AS Telephone, IsActive, CreatedAt, BmClientId,
              MustChangePassword
       FROM Clients WHERE ClientID = ?`,
      [req.params.id]
    );

    if (!clients.length) return res.status(404).json({ message: 'Client not found' });
    res.json({ client: clients[0] });
  } catch (e) {
    console.error('[clientRoutes] Get client error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /api/clients ────────────────────────────────────────
// Admin registers a client in the portal.
// Generates a temp password, stores the hash, and emails credentials.
router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const {
      bmClientId,
      accountName,
      accountNumber,
      email,
      contactName,
      telephone,
      sendWelcomeEmail = true,
    } = req.body;

    if (!accountName || !accountNumber)
      return res.status(400).json({ message: 'Account name and account number are required' });
    if (!email)
      return res.status(400).json({ message: 'Email address is required to send credentials' });

    const emailClean = email.trim().toLowerCase();

    // Duplicate account number check
    const [existing] = await db.query(
      `SELECT ClientID FROM Clients WHERE LTRIM(RTRIM(Account_Number)) = ?`,
      [accountNumber.trim()]
    );
    if (existing.length)
      return res.status(409).json({ message: 'A portal account with this account number already exists' });

    // Duplicate email check
    const [emailCheck] = await db.query(
      `SELECT ClientID FROM Clients WHERE LOWER(LTRIM(RTRIM(Email_Address))) = ?`,
      [emailClean]
    );
    if (emailCheck.length)
      return res.status(409).json({ message: 'A portal account with this email already exists' });

    // Generate + hash temp password
    const tempPassword = genPassword();
    const hashedPw     = await bcrypt.hash(tempPassword, 12);

    await db.query(
      `INSERT INTO Clients
         (Account_Name, Account_Number, Email_Address, First_Name, Telephone_Number,
          IsActive, BmClientId, Password, MustChangePassword, CreatedAt)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1, GETDATE())`,
      [
        accountName.trim(),
        accountNumber.trim(),
        emailClean,
        contactName ? contactName.trim() : null,
        telephone   ? telephone.trim()   : null,
        bmClientId  ? String(bmClientId) : null,
        hashedPw,
      ]
    );

    const [created] = await db.query(
      `SELECT TOP 1 ClientID FROM Clients WHERE LOWER(LTRIM(RTRIM(Email_Address))) = ? ORDER BY CreatedAt DESC`,
      [emailClean]
    );
    const clientId = created[0]?.ClientID;

    let emailSent = false;
    if (sendWelcomeEmail) {
      emailSent = await sendClientCredentialsEmail({
        to:            emailClean,
        contactName:   contactName || accountName,
        accountName:   accountName.trim(),
        accountNumber: accountNumber.trim(),
        email:         emailClean,
        password:      tempPassword,
      });
    }

    res.status(201).json({
      message:   'Client registered successfully',
      client:    { id: clientId, accountName: accountName.trim(), accountNumber: accountNumber.trim(), email: emailClean, bmClientId: bmClientId || null },
      emailSent,
      // Only expose temp password in response if email failed and sending was requested
      ...(sendWelcomeEmail && !emailSent ? { tempPassword } : {}),
    });
  } catch (e) {
    console.error('[clientRoutes] Create client error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── PUT /api/clients/:id ─────────────────────────────────────
router.put('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const [existing] = await db.query('SELECT ClientID FROM Clients WHERE ClientID = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ message: 'Client not found' });

    const { accountName, accountNumber, email, contactName, telephone, isActive } = req.body;
    const fields = [], values = [];

    if (accountName   !== undefined) { fields.push('Account_Name = ?');      values.push(accountName.trim()); }
    if (accountNumber !== undefined) { fields.push('Account_Number = ?');     values.push(accountNumber.trim()); }
    if (email         !== undefined) { fields.push('Email_Address = ?');      values.push(email ? email.trim().toLowerCase() : null); }
    if (contactName   !== undefined) { fields.push('First_Name = ?');         values.push(contactName); }
    if (telephone     !== undefined) { fields.push('Telephone_Number = ?');   values.push(telephone); }
    if (isActive      !== undefined) { fields.push('IsActive = ?');           values.push(isActive ? 1 : 0); }

    if (!fields.length) return res.status(400).json({ message: 'No fields to update' });

    values.push(req.params.id);
    await db.query(`UPDATE Clients SET ${fields.join(', ')} WHERE ClientID = ?`, values);
    res.json({ message: 'Client updated successfully' });
  } catch (e) {
    console.error('[clientRoutes] Update client error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── DELETE /api/clients/:id (soft-delete) ────────────────────
router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const [existing] = await db.query('SELECT ClientID FROM Clients WHERE ClientID = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ message: 'Client not found' });

    await db.query('UPDATE Clients SET IsActive = 0 WHERE ClientID = ?', [req.params.id]);
    res.json({ message: 'Client portal access revoked' });
  } catch (e) {
    console.error('[clientRoutes] Delete client error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /api/clients/:id/reset-password ─────────────────────
// Admin resets a client's password and optionally emails the new one.
router.post('/:id/reset-password', auth, requireAdmin, async (req, res) => {
  try {
    const [clients] = await db.query(
      `SELECT ClientID, Account_Name, Account_Number, Email_Address AS Email, First_Name AS ContactName
       FROM Clients WHERE ClientID = ?`,
      [req.params.id]
    );
    if (!clients.length) return res.status(404).json({ message: 'Client not found' });

    const c            = clients[0];
    const { sendEmail = true } = req.body;
    const tempPassword = genPassword();
    const hashed       = await bcrypt.hash(tempPassword, 12);

    await db.query(
      'UPDATE Clients SET Password = ?, MustChangePassword = 1 WHERE ClientID = ?',
      [hashed, req.params.id]
    );

    let emailSent = false;
    if (sendEmail && c.Email) {
      emailSent = await sendClientCredentialsEmail({
        to:            c.Email,
        contactName:   c.ContactName || c.Account_Name,
        accountName:   c.Account_Name,
        accountNumber: c.Account_Number,
        email:         c.Email,
        password:      tempPassword,
      });
    }

    res.json({
      message: 'Password reset successfully',
      emailSent,
      ...(sendEmail && !emailSent ? { tempPassword } : {}),
    });
  } catch (e) {
    console.error('[clientRoutes] Reset password error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /api/clients/:id/resend-credentials ─────────────────
// Re-sends a brand-new temp password (does not expose the old one).
router.post('/:id/resend-credentials', auth, requireAdmin, async (req, res) => {
  try {
    const [clients] = await db.query(
      `SELECT ClientID, Account_Name, Account_Number,
              Email_Address AS Email, First_Name AS ContactName
       FROM Clients WHERE ClientID = ?`,
      [req.params.id]
    );
    if (!clients.length) return res.status(404).json({ message: 'Client not found' });

    const c = clients[0];
    if (!c.Email) return res.status(400).json({ message: 'No email on record for this client' });

    // Issue a fresh temp password
    const tempPassword = genPassword();
    await db.query(
      'UPDATE Clients SET Password = ?, MustChangePassword = 1 WHERE ClientID = ?',
      [await bcrypt.hash(tempPassword, 12), req.params.id]
    );

    const emailSent = await sendClientCredentialsEmail({
      to:            c.Email,
      contactName:   c.ContactName || c.Account_Name,
      accountName:   c.Account_Name,
      accountNumber: c.Account_Number,
      email:         c.Email,
      password:      tempPassword,
    });

    if (!emailSent)
      return res.status(500).json({ message: 'Failed to send credentials email', tempPassword });

    res.json({ message: 'Credentials resent successfully' });
  } catch (e) {
    console.error('[clientRoutes] Resend credentials error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;