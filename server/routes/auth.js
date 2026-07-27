'use strict';

/**
 * /api/auth
 *
 * Roles (usu_ntipo):
 *   1  = admin     — full system access
 *   2  = monitor   — control room / situational awareness
 *   3  = client    — portal access via username (clientId from usu_iidcuenta)
 *   other → blocked
 *
 * m_cuentas email login → role: 'client'
 *
 * Passwords are stored as bcrypt hashes (cost factor 12).
 *
 * Routes:
 *   POST   /api/auth/login
 *   POST   /api/auth/admin/create
 *   GET    /api/auth/admin/users
 *   PUT    /api/auth/admin/users/:id
 *   DELETE /api/auth/admin/users/:id
 *   POST   /api/auth/admin/users/:id/resend-credentials
 *   PUT    /api/auth/change-password
 *   GET    /api/auth/verify
 *   POST   /api/auth/logout
 *   GET    /api/auth/search                 [ADMIN ONLY]
 */

const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;
const router        = express.Router();

let db, sql, authMiddleware, emailService;

try { db = require('../config/database'); sql = db.sql ?? require('mssql'); } catch (e) { console.error('[auth] db:', e.message); }
try { authMiddleware = require('../middleware/auth');     } catch (e) { console.error('[auth] middleware:', e.message); }
try { emailService  = require('../service/emailService'); } catch (e) { console.error('[auth] emailService:', e.message); }

// ── Guards ────────────────────────────────────────────────────────────────────
function requireDb(req, res, next) {
  if (!db) return res.status(503).json({ success: false, message: 'Database unavailable' });
  next();
}

function useAuth(req, res, next) {
  if (typeof authMiddleware?.auth !== 'function')
    return res.status(503).json({ success: false, message: 'Auth middleware unavailable' });
  authMiddleware.auth(req, res, next);
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ success: false, message: 'Admin access required' });
  next();
}

function requireAdminOrMonitor(req, res, next) {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'monitor')
    return res.status(403).json({ success: false, message: 'Admin or Monitor access required' });
  next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
}

async function getPool() { return db.getPool(); }

/**
 * Map usu_ntipo → role string
 *   1 = admin | 2 = monitor | 3 = client | other → null (blocked)
 */
function resolveRole(ntipo) {
  const n = Number(ntipo);
  if (n === 1) return 'admin';
  if (n === 2) return 'monitor';
  if (n === 3) return 'client';
  return null;
}

/**
 * Compare a plain-text password against a stored value that may be either
 * a bcrypt hash OR legacy plain text (for accounts not yet migrated).
 * Always returns a boolean.
 */
async function verifyPassword(plainText, stored) {
  if (!plainText || !stored) return false;
  const s = stored.trim();
  // bcrypt hashes start with $2b$ or $2a$
  if (s.startsWith('$2b$') || s.startsWith('$2a$') || s.startsWith('$2y$')) {
    return bcrypt.compare(plainText, s);
  }
  // Legacy plain-text fallback
  return plainText.trim() === s;
}

// ── Schema cache for safe INSERT ──────────────────────────────────────────────
let _schemaCache = null;
async function getUsuariosSchema(pool) {
  if (_schemaCache) return _schemaCache;
  const res = await pool.request().query(`
    SELECT c.name, c.is_identity
    FROM   sys.columns c
    JOIN   sys.tables  t ON t.object_id = c.object_id
    WHERE  t.name = 'm_usuarios'
  `);
  const identityCols = new Set(res.recordset.filter(r => r.is_identity).map(r => r.name.toLowerCase()));
  _schemaCache = { identityCols, iidIsIdentity: identityCols.has('usu_iid') };
  return _schemaCache;
}

async function insertUsuario(pool, fields) {
  const { identityCols, iidIsIdentity } = await getUsuariosSchema(pool);
  let iidValue = null;
  if (!iidIsIdentity) {
    const r = await pool.request().query(`SELECT ISNULL(MAX(usu_iid),0)+1 AS next_iid FROM [dbo].[m_usuarios]`);
    iidValue = r.recordset[0].next_iid;
  }
  const candidates = [
    ...(!iidIsIdentity ? [{ col: 'usu_iid',        param: 'iid',          type: sql.Int,           value: iidValue          }] : []),
    { col: 'usu_iidcuenta',    param: 'iidcuenta',    type: sql.Int,           value: fields.cuentaId   },
    { col: 'usu_icodigo',      param: 'icodigo',      type: sql.Int,           value: 0                 },
    { col: 'usu_cnombre',      param: 'username',     type: sql.VarChar(255),  value: fields.username   },
    { col: 'usu_cclave',       param: 'password',     type: sql.VarChar(255),  value: fields.password   }, // already hashed
    { col: 'usu_ntipo',        param: 'ntipo',        type: sql.Numeric(18,0), value: fields.tipo       },
    { col: 'usu_email',        param: 'email',        type: sql.VarChar(255),  value: fields.email      },
    { col: 'usu_cimagen',      param: 'cimagen',      type: sql.VarChar(255),  value: ''                },
    { col: 'usu_mobservacion', param: 'mobservacion', type: sql.VarChar(500),  value: ''                },
    { col: 'usu_cIdExtendido', param: 'cIdExtendido', type: sql.VarChar(255),  value: ''                },
    { col: 'usu_cmetadata',    param: 'metadata',     type: sql.VarChar(500),  value: fields.metadata   },
  ].filter(c => !identityCols.has(c.col.toLowerCase()));

  const req = pool.request();
  for (const c of candidates) req.input(c.param, c.type, c.value);
  await req.query(`
    INSERT INTO [dbo].[m_usuarios] (${candidates.map(c => c.col).join(', ')})
    VALUES (${candidates.map(c => `@${c.param}`).join(', ')})
  `);
  return iidValue;
}

// ── Welcome email ─────────────────────────────────────────────────────────────
async function sendWelcomeEmail({ toEmail, username, tempPassword, role, appUrl }) {
  if (!emailService) {
    console.error('[auth] Cannot send welcome email: emailService unavailable');
    return;
  }
  const url       = appUrl || process.env.APP_URL || 'http://localhost:3000';
  const roleLabel = role === 'monitor' ? 'Security Monitor'
                  : role === 'admin'   ? 'Administrator'
                  :                      'Portal User';
  const loginPath = '/login';

  try {
    await emailService.sendSimpleEmail({
      to:      toEmail,
      subject: 'Your BM Security Portal Account',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#1a1a2e;">Welcome to BM Security Portal</h2>
          <p>Hello <strong>${username}</strong>,</p>
          <p>Your <strong>${roleLabel}</strong> account has been created. Use the credentials below to log in:</p>
          <div style="background:#f4f4f4;padding:16px;border-radius:8px;margin:16px 0;">
            <p style="margin:4px 0;"><strong>Username:</strong> ${username}</p>
            <p style="margin:4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
            <p style="margin:4px 0;"><strong>Role:</strong> ${roleLabel}</p>
          </div>
          ${role === 'monitor' ? `
          <p style="color:#854F0B;background:#FAEEDA;padding:10px;border-radius:6px;margin:12px 0;">
            🖥️ After login you will be directed to the <strong>Security Operations Control Room</strong>.
          </p>` : ''}
          <p>
            <a href="${url}${loginPath}"
               style="display:inline-block;padding:12px 24px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px;">
              Log In Now
            </a>
          </p>
          <p style="color:#888;font-size:13px;">You will be required to change your password on first login.</p>
        </div>
      `,
    });
    console.log(`[auth] Welcome email sent to ${toEmail}`);
  } catch (err) {
    console.error(`[auth] Welcome email failed for ${toEmail}:`, err.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/auth/login
// ════════════════════════════════════════════════════════════════════════════
router.post('/login', requireDb, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'Username and password are required' });

    const pool      = await getPool();
    const userInput = username.trim();

    // ── 1. m_usuarios (admin | monitor | client with username login) ──────────
    const uResult = await pool.request()
      .input('username', sql.VarChar(255), userInput)
      .query(`
        SELECT u.usu_iid, u.usu_cnombre, u.usu_cclave, u.usu_ntipo,
               u.usu_email, u.usu_iidcuenta, u.usu_cmetadata,
               c.cue_cnombre, c.cue_ncuenta, c.cue_clocalidad, c.cue_ctelefono
        FROM   [dbo].[m_usuarios] u
        LEFT JOIN [dbo].[m_cuentas] c ON c.cue_iid = u.usu_iidcuenta
        WHERE  u.usu_cnombre = @username
      `);

    if (uResult.recordset.length) {
      const u    = uResult.recordset[0];
      const role = resolveRole(u.usu_ntipo);

      if (!role)
        return res.status(403).json({ success: false, message: 'Your account does not have portal access.' });

      // ── bcrypt-aware password check ───────────────────────────────────────
      const passwordOk = await verifyPassword(password, u.usu_cclave);
      if (!passwordOk)
        return res.status(401).json({ success: false, message: 'Incorrect username or password' });

      let meta = {};
      try { meta = JSON.parse(u.usu_cmetadata || '{}'); } catch {}
      if (meta.isActive === false)
        return res.status(403).json({ success: false, message: 'Your account has been deactivated.' });

      const mustChangePassword = meta.mustChangePassword === true;
      const isClient           = role === 'client';
      const companyName        = (u.cue_cnombre || '').trim();

      const token = makeToken({
        userId:            u.usu_iid,
        username:          u.usu_cnombre,
        email:             u.usu_email || '',
        role,
        loginType:         'username',
        mustChangePassword,
        ...(isClient && { clientId: u.usu_iidcuenta, companyName }),
      });

      console.log(`[auth] Login: ${userInput} role=${role} usu_iid=${u.usu_iid}${isClient ? ` company="${companyName}"` : ''}`);

      const baseUser = {
        id:                u.usu_iid,
        username:          u.usu_cnombre,
        email:             u.usu_email || '',
        role,
        loginType:         'username',
        mustChangePassword,
      };

      if (isClient) {
        Object.assign(baseUser, {
          clientId:      u.usu_iidcuenta,
          companyName,
          accountNumber: (u.cue_ncuenta   || '').trim(),
          locality:       u.cue_clocalidad || '',
          telephone:      u.cue_ctelefono  || '',
        });
      }

      return res.json({ success: true, token, user: baseUser });
    }

    // ── 2. m_cuentas (email login → always role: 'client') ────────────────────
    const cResult = await pool.request()
      .input('email', sql.VarChar(255), userInput.toLowerCase())
      .query(`
        SELECT cue_iid, cue_cnombre, cue_ncuenta, cue_cemail,
               cue_ctelefono, cue_cclave, cue_clocalidad
        FROM   [dbo].[m_cuentas]
        WHERE  LOWER(LTRIM(RTRIM(cue_cemail))) = @email
      `);

    if (!cResult.recordset.length)
      return res.status(401).json({ success: false, message: 'Incorrect username or password' });

    const c = cResult.recordset[0];

    if (!c.cue_cclave || c.cue_cclave.trim() === '')
      return res.status(401).json({ success: false, message: 'No password set. Please contact your administrator.' });

    // ── bcrypt-aware password check ───────────────────────────────────────────
    const cuentaPasswordOk = await verifyPassword(password, c.cue_cclave);
    if (!cuentaPasswordOk)
      return res.status(401).json({ success: false, message: 'Incorrect username or password' });

    const token = makeToken({
      userId:        null,
      email:         c.cue_cemail,
      name:          c.cue_cnombre,
      role:          'client',
      clientId:      c.cue_iid,
      accountNumber: (c.cue_ncuenta || '').trim(),
      loginType:     'client',
    });

    console.log(`[auth] Client login (email): ${userInput} cue_iid=${c.cue_iid}`);
    return res.json({
      success: true,
      token,
      user: {
        id:                `client_${c.cue_iid}`,
        email:             c.cue_cemail,
        name:              c.cue_cnombre,
        companyName:       c.cue_cnombre,
        role:              'client',
        clientId:          c.cue_iid,
        accountNumber:     (c.cue_ncuenta || '').trim(),
        telephone:         c.cue_ctelefono,
        locality:          c.cue_clocalidad,
        loginType:         'client',
        mustChangePassword: false,
      },
    });

  } catch (err) {
    console.error('[auth] login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/auth/admin/create  [ADMIN ONLY]
// Supports tipo: 1 (admin), 2 (monitor), 3 (client)
// ════════════════════════════════════════════════════════════════════════════
router.post('/admin/create', useAuth, requireAdmin, requireDb, async (req, res) => {
  try {
    const { username, email, password, cuentaId, tipo = 3 } = req.body;

    if (!username || !email || !password)
      return res.status(400).json({ success: false, message: 'username, email, and password are required' });
    if (username.trim().length < 3)
      return res.status(400).json({ success: false, message: 'Username must be at least 3 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ success: false, message: 'Invalid email address' });
    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    if (![1, 2, 3].includes(Number(tipo)))
      return res.status(400).json({ success: false, message: 'tipo must be 1 (admin), 2 (monitor), or 3 (client)' });

    const tipoNum = Number(tipo);

    if (tipoNum === 3) {
      if (!cuentaId || !Number.isInteger(Number(cuentaId)) || Number(cuentaId) <= 0)
        return res.status(400).json({ success: false, message: 'cuentaId is required for client accounts' });
    }

    const pool = await getPool();

    const resolvedCuentaId = cuentaId ? Number(cuentaId) : 0;
    if (resolvedCuentaId > 0) {
      const accountCheck = await pool.request()
        .input('cuentaId', sql.Int, resolvedCuentaId)
        .query(`SELECT cue_iid FROM [dbo].[m_cuentas] WHERE cue_iid = @cuentaId`);
      if (!accountCheck.recordset.length)
        return res.status(404).json({ success: false, message: `No account found with cuentaId=${cuentaId}` });
    }

    const exists = await pool.request()
      .input('username', sql.VarChar(255), username.trim())
      .query(`SELECT usu_iid FROM [dbo].[m_usuarios] WHERE usu_cnombre = @username`);
    if (exists.recordset.length)
      return res.status(409).json({ success: false, message: `Username "${username.trim()}" is already taken` });

    // ── Hash password before storing ──────────────────────────────────────────
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await insertUsuario(pool, {
      cuentaId: resolvedCuentaId,
      username: username.trim(),
      password: passwordHash,                                   // bcrypt hash
      tipo:     tipoNum,
      email:    email.trim().toLowerCase(),
      metadata: JSON.stringify({ mustChangePassword: true }),
    });

    const role = resolveRole(tipoNum);
    console.log(`[auth] Created account: ${username.trim()} tipo=${tipo} role=${role} by admin ${req.user.userId}`);

    // Send plain-text password in welcome email (before hashing it was captured above)
    await sendWelcomeEmail({
      toEmail:      email.trim(),
      username:     username.trim(),
      tempPassword: password,                                   // plain text for email only
      role,
      appUrl:       process.env.APP_URL,
    });

    return res.status(201).json({
      success: true,
      message: `Account created for "${username.trim()}" (${role}). Welcome email sent to ${email.trim()}.`,
    });
  } catch (err) {
    console.error('[auth] admin/create error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/auth/admin/users  [ADMIN ONLY]
// ════════════════════════════════════════════════════════════════════════════
router.get('/admin/users', useAuth, requireAdmin, requireDb, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const search = (req.query.search || '').trim();
    const offset = (page - 1) * limit;

    const pool    = await getPool();
    const request = pool.request()
      .input('limit',  sql.Int, limit)
      .input('offset', sql.Int, offset);

    let whereClause = `WHERE u.usu_ntipo IN (1, 2, 3)`;
    if (search) {
      request.input('search', sql.VarChar(255), `%${search}%`);
      whereClause += ` AND (
        u.usu_cnombre LIKE @search OR
        u.usu_email   LIKE @search OR
        c.cue_cnombre LIKE @search
      )`;
    }

    const result = await request.query(`
      SELECT
        u.usu_iid       AS id,
        u.usu_cnombre   AS username,
        u.usu_email     AS email,
        u.usu_ntipo     AS tipo,
        u.usu_iidcuenta AS accountId,
        u.usu_cmetadata AS metadata,
        c.cue_cnombre   AS accountName,
        c.cue_ncuenta   AS accountNumber,
        c.cue_cemail    AS accountEmail
      FROM   [dbo].[m_usuarios] u
      LEFT JOIN [dbo].[m_cuentas] c ON c.cue_iid = u.usu_iidcuenta
      ${whereClause}
      ORDER BY u.usu_iid DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const users = result.recordset.map(u => {
      let mustChangePassword = false;
      let isActive           = true;
      try {
        const meta = JSON.parse(u.metadata || '{}');
        mustChangePassword = meta.mustChangePassword === true;
        if (typeof meta.isActive === 'boolean') isActive = meta.isActive;
      } catch {}
      return {
        id:                u.id,
        username:          u.username,
        email:             u.email         || null,
        tipo:              u.tipo,
        role:              resolveRole(u.tipo),
        accountId:         u.accountId     || null,
        accountName:       u.accountName   || null,
        accountNumber:     u.accountNumber || null,
        accountEmail:      u.accountEmail  || null,
        isActive,
        mustChangePassword,
      };
    });

    return res.json({ success: true, users, page, limit });
  } catch (err) {
    console.error('[auth] admin/users error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PUT /api/auth/admin/users/:id  [ADMIN ONLY]
// ════════════════════════════════════════════════════════════════════════════
router.put('/admin/users/:id', useAuth, requireAdmin, requireDb, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId) || userId <= 0)
      return res.status(400).json({ success: false, message: 'Invalid user ID' });

    const pool = await getPool();

    const existing = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`SELECT usu_iid, usu_cnombre, usu_cmetadata FROM [dbo].[m_usuarios] WHERE usu_iid = @userId`);

    if (!existing.recordset.length)
      return res.status(404).json({ success: false, message: 'User not found' });

    let meta = {};
    try { meta = JSON.parse(existing.recordset[0].usu_cmetadata || '{}'); } catch {}

    const setClauses = ['usu_cmetadata = @metadata'];
    const request    = pool.request().input('userId', sql.Int, userId);

    if (typeof req.body.isActive === 'boolean') {
      meta.isActive = req.body.isActive;
    }

    if (req.body.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email))
        return res.status(400).json({ success: false, message: 'Invalid email address' });
      request.input('email', sql.VarChar(255), req.body.email.trim().toLowerCase());
      setClauses.push('usu_email = @email');
    }

    // ── Optional admin password reset ─────────────────────────────────────────
    if (req.body.newPassword) {
      if (req.body.newPassword.length < 6)
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
      const resetHash = await bcrypt.hash(req.body.newPassword, BCRYPT_ROUNDS);
      request.input('newPassword', sql.VarChar(255), resetHash);
      setClauses.push('usu_cclave = @newPassword');
      meta.mustChangePassword = true;                          // force re-login password change
    }

    request.input('metadata', sql.VarChar(500), JSON.stringify(meta));

    await request.query(`
      UPDATE [dbo].[m_usuarios]
      SET    ${setClauses.join(', ')}
      WHERE  usu_iid = @userId
    `);

    const username = existing.recordset[0].usu_cnombre;
    const action   = typeof req.body.isActive === 'boolean'
      ? (req.body.isActive ? 'activated' : 'deactivated')
      : 'updated';

    console.log(`[auth] User ${userId} (${username}) ${action} by admin ${req.user.userId}`);
    return res.json({ success: true, message: `User "${username}" ${action} successfully.` });

  } catch (err) {
    console.error('[auth] admin/users/:id PUT error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/auth/admin/users/:id  [ADMIN ONLY]
// ════════════════════════════════════════════════════════════════════════════
router.delete('/admin/users/:id', useAuth, requireAdmin, requireDb, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId) || userId <= 0)
      return res.status(400).json({ success: false, message: 'Invalid user ID' });

    if (userId === req.user.userId)
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });

    const pool = await getPool();

    const existing = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`SELECT usu_iid, usu_cnombre, usu_ntipo FROM [dbo].[m_usuarios] WHERE usu_iid = @userId`);

    if (!existing.recordset.length)
      return res.status(404).json({ success: false, message: 'User not found' });

    const target = existing.recordset[0];
    if (Number(target.usu_ntipo) === 1)
      return res.status(403).json({
        success: false,
        message: 'Admin accounts cannot be deleted through this endpoint.',
      });

    await pool.request()
      .input('userId', sql.Int, userId)
      .query(`DELETE FROM [dbo].[m_usuarios] WHERE usu_iid = @userId`);

    console.log(`[auth] User ${userId} (${target.usu_cnombre}) permanently deleted by admin ${req.user.userId}`);
    return res.json({
      success: true,
      message: `User "${target.usu_cnombre}" has been permanently deleted.`,
    });

  } catch (err) {
    console.error('[auth] admin/users/:id DELETE error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/auth/admin/users/:id/resend-credentials  [ADMIN ONLY]
// NOTE: bcrypt hashes cannot be reversed — this endpoint now requires the
//       admin to supply a new temporary password to send.
//       Body: { newPassword: "TempPass123" }  (optional — generates one if omitted)
// ════════════════════════════════════════════════════════════════════════════
router.post('/admin/users/:id/resend-credentials', useAuth, requireAdmin, requireDb, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId) || userId <= 0)
      return res.status(400).json({ success: false, message: 'Invalid user ID' });

    const pool   = await getPool();
    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`SELECT usu_iid, usu_cnombre, usu_email, usu_ntipo FROM [dbo].[m_usuarios] WHERE usu_iid = @userId`);

    if (!result.recordset.length)
      return res.status(404).json({ success: false, message: 'User not found' });

    const u = result.recordset[0];
    if (!u.usu_email)
      return res.status(400).json({ success: false, message: 'This user has no email address on record.' });

    // Generate or use supplied temporary password
    const tempPassword = req.body.newPassword
      || Math.random().toString(36).slice(-8) + 'A1!';         // e.g. "xk7mq2w3A1!"

    if (tempPassword.length < 6)
      return res.status(400).json({ success: false, message: 'New temporary password must be at least 6 characters' });

    // Hash and save the new temp password, force mustChangePassword
    const tempHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    await pool.request()
      .input('userId',   sql.Int,          userId)
      .input('password', sql.VarChar(255), tempHash)
      .input('metadata', sql.VarChar(500), JSON.stringify({ mustChangePassword: true }))
      .query(`
        UPDATE [dbo].[m_usuarios]
        SET    usu_cclave     = @password,
               usu_cmetadata = @metadata
        WHERE  usu_iid = @userId
      `);

    await sendWelcomeEmail({
      toEmail:      u.usu_email,
      username:     u.usu_cnombre,
      tempPassword,                                             // plain text for email
      role:         resolveRole(u.usu_ntipo),
      appUrl:       process.env.APP_URL,
    });

    console.log(`[auth] Credentials reset & resent for user ${userId} (${u.usu_cnombre}) by admin ${req.user.userId}`);
    return res.json({ success: true, message: `New temporary password set and sent to ${u.usu_email}.` });

  } catch (err) {
    console.error('[auth] resend-credentials error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PUT /api/auth/change-password
// ════════════════════════════════════════════════════════════════════════════
router.put('/change-password', useAuth, requireDb, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword)
      return res.status(400).json({ success: false, message: 'Current and new passwords are required' });
    if (newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    if (currentPassword === newPassword)
      return res.status(400).json({ success: false, message: 'New password must differ from current password' });

    const { role, clientId, userId, loginType } = req.user;
    const pool = await getPool();

    // ── Case 1: m_cuentas client (email login) ────────────────────────────────
    if (loginType === 'client' && !userId) {
      if (!clientId)
        return res.status(400).json({ success: false, message: 'Client ID missing from session' });

      const r = await pool.request()
        .input('clientId', sql.Int, clientId)
        .query(`SELECT cue_cclave FROM [dbo].[m_cuentas] WHERE cue_iid = @clientId`);

      if (!r.recordset.length)
        return res.status(404).json({ success: false, message: 'Account not found' });

      const currentOk = await verifyPassword(currentPassword, r.recordset[0].cue_cclave);
      if (!currentOk)
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });

      // ── Hash new password ─────────────────────────────────────────────────
      const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

      await pool.request()
        .input('password', sql.VarChar(255), newHash)
        .input('clientId', sql.Int, clientId)
        .query(`UPDATE [dbo].[m_cuentas] SET cue_cclave = @password WHERE cue_iid = @clientId`);

      console.log(`[auth] m_cuentas client password changed: cue_iid=${clientId}`);
      return res.json({ success: true, message: 'Password changed successfully' });
    }

    // ── Case 2: m_usuarios (admin | monitor | client with username login) ──────
    if (!userId)
      return res.status(400).json({ success: false, message: 'User ID missing from session' });

    const r = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`SELECT usu_cclave, usu_cmetadata FROM [dbo].[m_usuarios] WHERE usu_iid = @userId`);

    if (!r.recordset.length)
      return res.status(404).json({ success: false, message: 'Account not found' });

    const currentOk = await verifyPassword(currentPassword, r.recordset[0].usu_cclave);
    if (!currentOk)
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });

    // ── Hash new password ─────────────────────────────────────────────────────
    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    let meta = {};
    try { meta = JSON.parse(r.recordset[0].usu_cmetadata || '{}'); } catch {}
    delete meta.mustChangePassword;

    await pool.request()
      .input('password', sql.VarChar(255), newHash)
      .input('metadata', sql.VarChar(500), JSON.stringify(meta))
      .input('userId',   sql.Int,          userId)
      .query(`
        UPDATE [dbo].[m_usuarios]
        SET    usu_cclave     = @password,
               usu_cmetadata = @metadata
        WHERE  usu_iid = @userId
      `);

    console.log(`[auth] m_usuarios password changed: usu_iid=${userId} role=${role}`);
    return res.json({ success: true, message: 'Password changed successfully', mustChangePassword: false });

  } catch (err) {
    console.error('[auth] change-password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/auth/verify
// ════════════════════════════════════════════════════════════════════════════
router.get('/verify', useAuth, requireDb, async (req, res) => {
  try {
    const { clientId, userId, loginType } = req.user;
    const pool = await getPool();

    // m_cuentas client (email login)
    if (loginType === 'client' && !userId) {
      const result = await pool.request()
        .input('clientId', sql.Int, clientId)
        .query(`
          SELECT cue_iid, cue_cnombre, cue_ncuenta, cue_cemail,
                 cue_ctelefono, cue_clocalidad
          FROM   [dbo].[m_cuentas]
          WHERE  cue_iid = @clientId
        `);
      if (!result.recordset.length)
        return res.status(404).json({ success: false, message: 'Account not found' });
      const c = result.recordset[0];
      return res.json({
        success: true,
        user: {
          id:                `client_${c.cue_iid}`,
          email:             c.cue_cemail,
          name:              c.cue_cnombre,
          companyName:       c.cue_cnombre,
          role:              'client',
          clientId:          c.cue_iid,
          accountNumber:     (c.cue_ncuenta || '').trim(),
          telephone:         c.cue_ctelefono,
          locality:          c.cue_clocalidad,
          loginType:         'client',
          mustChangePassword: false,
        },
      });
    }

    // m_usuarios (admin | monitor | client with username login)
    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`
        SELECT u.usu_iid, u.usu_cnombre, u.usu_ntipo, u.usu_email,
               u.usu_iidcuenta, u.usu_cmetadata,
               c.cue_cnombre, c.cue_ncuenta, c.cue_clocalidad, c.cue_ctelefono
        FROM   [dbo].[m_usuarios] u
        LEFT JOIN [dbo].[m_cuentas] c ON c.cue_iid = u.usu_iidcuenta
        WHERE  u.usu_iid = @userId
      `);
    if (!result.recordset.length)
      return res.status(404).json({ success: false, message: 'Account not found' });

    const u     = result.recordset[0];
    const role2 = resolveRole(u.usu_ntipo);

    if (!role2)
      return res.status(403).json({ success: false, message: 'Account does not have portal access' });

    let meta = {};
    try { meta = JSON.parse(u.usu_cmetadata || '{}'); } catch {}
    const mustChangePassword = meta.mustChangePassword === true;

    const isClientRole = role2 === 'client';
    const companyName  = (u.cue_cnombre || '').trim();

    const user = {
      id:                u.usu_iid,
      username:          u.usu_cnombre,
      email:             u.usu_email || '',
      role:              role2,
      loginType:         'username',
      mustChangePassword,
    };

    if (isClientRole) {
      Object.assign(user, {
        clientId:      u.usu_iidcuenta,
        companyName,
        accountNumber: (u.cue_ncuenta   || '').trim(),
        locality:       u.cue_clocalidad || '',
        telephone:      u.cue_ctelefono  || '',
      });
    }

    return res.json({ success: true, user });
  } catch (err) {
    console.error('[auth] verify error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/auth/search  [ADMIN ONLY]
// ════════════════════════════════════════════════════════════════════════════
router.get('/search', useAuth, requireAdmin, requireDb, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ success: false, message: 'q is required' });
    const pool   = await getPool();
    const result = await pool.request()
      .input('q', sql.VarChar(255), `%${q}%`)
      .query(`
        SELECT TOP 10 cue_iid, cue_cnombre, cue_cemail, cue_ncuenta
        FROM   [dbo].[m_cuentas]
        WHERE  cue_cnombre LIKE @q OR cue_cemail LIKE @q
        ORDER BY cue_cnombre
      `);
    res.json({ success: true, accounts: result.recordset });
  } catch (err) {
    console.error('[auth] search error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/auth/logout
// ════════════════════════════════════════════════════════════════════════════
router.post('/logout', (req, res) => {
  try {
    const t = req.headers.authorization?.split(' ')[1];
    if (t) console.log(`[auth] Logout: ${jwt.decode(t)?.username || jwt.decode(t)?.email || 'unknown'}`);
  } catch {}
  res.json({ success: true, message: 'Logged out successfully' });
});

// ── Export middleware helpers for other routers (e.g. monitor.js) ─────────────
router.useAuth               = useAuth;
router.requireAdmin          = requireAdmin;
router.requireAdminOrMonitor = requireAdminOrMonitor;

module.exports = router;