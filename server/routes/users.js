const express  = require('express');
const bcrypt   = require('bcryptjs');
const { auth, requireAdmin } = require('../middleware/auth');
const { sendSimpleEmail } = require('../service/emailService');
const { generateAdminWelcomeEmail, generatePasswordResetEmail } = require('../utils/accountEmailTempletes');

let db, sql;
try { db = require('../config/database'); sql = db.sql ?? require('mssql'); } catch (e) { console.error('[users] db load failed:', e.message); }

/** Resolves the mssql pool. Await ONCE per handler, then call pool.request() per query. */
async function getPool() { return db.getPool(); }

const router = express.Router();
router.use(auth, requireAdmin);

function genPassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ─── GET /api/users ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(`
      SELECT UserID, FirstName, Surname, Email, Position, StaffCode, IsActive, LastAuthDate, CreatedAt
      FROM   [dbo].[Users]
      ORDER BY FirstName, Surname
    `);
    res.json({ users: result.recordset });
  } catch (e) { console.error('List users error:', e); res.status(500).json({ message: 'Server error' }); }
});

// ─── GET /api/users/:id ───────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request()
      .input('userId', sql.Int, req.params.id)
      .query('SELECT UserID, FirstName, Surname, Email, Position, StaffCode, IsActive, LastAuthDate, CreatedAt FROM [dbo].[Users] WHERE UserID = @userId');
    if (!result.recordset.length) return res.status(404).json({ message: 'User not found' });
    res.json({ user: result.recordset[0] });
  } catch (e) { console.error('Get user error:', e); res.status(500).json({ message: 'Server error' }); }
});

// ─── POST /api/users ──────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { firstName, surname, email, position, staffCode, sendWelcomeEmail = true } = req.body;
    if (!firstName || !surname || !email)
      return res.status(400).json({ message: 'First name, surname and email are required' });

    const emailNorm = email.trim().toLowerCase();
    const pool      = await getPool();

    const existing = await pool.request()
      .input('email', sql.VarChar(255), emailNorm)
      .query('SELECT UserID FROM [dbo].[Users] WHERE Email = @email');
    if (existing.recordset.length) return res.status(409).json({ message: 'Email already in use' });

    const tempPassword = genPassword();
    const hashed       = await bcrypt.hash(tempPassword, 12);

    await pool.request()
      .input('firstName', sql.VarChar(100), firstName.trim())
      .input('surname',   sql.VarChar(100), surname.trim())
      .input('email',     sql.VarChar(255), emailNorm)
      .input('password',  sql.VarChar(255), hashed)
      .input('position',  sql.VarChar(100), position  || null)
      .input('staffCode', sql.VarChar(50),  staffCode || null)
      .query(`
        INSERT INTO [dbo].[Users] (FirstName, Surname, Email, Password, Position, StaffCode, IsActive, CreatedAt)
        VALUES (@firstName, @surname, @email, @password, @position, @staffCode, 1, GETDATE())
      `);

    const created  = await pool.request()
      .input('email', sql.VarChar(255), emailNorm)
      .query('SELECT TOP 1 UserID FROM [dbo].[Users] WHERE Email = @email ORDER BY CreatedAt DESC');
    const fullName = `${firstName.trim()} ${surname.trim()}`;
    let emailSent  = false;

    if (sendWelcomeEmail) {
      try {
        await sendSimpleEmail({
          to:      emailNorm,
          subject: '🔐 Your Staff Account Has Been Created',
          html:    generateAdminWelcomeEmail({ name: fullName, email: emailNorm, password: tempPassword, position })
        });
        emailSent = true;
      } catch (err) { console.error('Welcome email failed (non-fatal):', err.message); }
    }

    res.status(201).json({
      message: 'User created successfully',
      user: { id: created.recordset[0]?.UserID, name: fullName, email: emailNorm, position, staffCode },
      emailSent,
      ...(sendWelcomeEmail && !emailSent ? { tempPassword } : {})
    });
  } catch (e) { console.error('Create user error:', e); res.status(500).json({ message: 'Server error' }); }
});

// ─── PUT /api/users/:id ───────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const pool    = await getPool();
    const existing = await pool.request()
      .input('userId', sql.Int, req.params.id)
      .query('SELECT UserID FROM [dbo].[Users] WHERE UserID = @userId');
    if (!existing.recordset.length) return res.status(404).json({ message: 'User not found' });

    const { firstName, surname, email, position, staffCode, isActive } = req.body;

    // Build SET clause dynamically using named params
    const setParts = [];
    const request  = pool.request().input('userId', sql.Int, req.params.id);

    if (firstName !== undefined) { setParts.push('FirstName = @firstName'); request.input('firstName', sql.VarChar(100), firstName.trim()); }
    if (surname   !== undefined) { setParts.push('Surname = @surname');     request.input('surname',   sql.VarChar(100), surname.trim()); }
    if (email     !== undefined) { setParts.push('Email = @email');         request.input('email',     sql.VarChar(255), email.trim().toLowerCase()); }
    if (position  !== undefined) { setParts.push('Position = @position');   request.input('position',  sql.VarChar(100), position); }
    if (staffCode !== undefined) { setParts.push('StaffCode = @staffCode'); request.input('staffCode', sql.VarChar(50),  staffCode); }
    if (isActive  !== undefined) { setParts.push('IsActive = @isActive');   request.input('isActive',  sql.Bit,          isActive ? 1 : 0); }

    if (!setParts.length) return res.status(400).json({ message: 'No fields to update' });

    await request.query(`UPDATE [dbo].[Users] SET ${setParts.join(', ')} WHERE UserID = @userId`);
    res.json({ message: 'User updated successfully' });
  } catch (e) { console.error('Update user error:', e); res.status(500).json({ message: 'Server error' }); }
});

// ─── POST /api/users/:id/reset-password ──────────────────────────────────────
router.post('/:id/reset-password', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request()
      .input('userId', sql.Int, req.params.id)
      .query('SELECT UserID, FirstName, Surname, Email FROM [dbo].[Users] WHERE UserID = @userId');
    if (!result.recordset.length) return res.status(404).json({ message: 'User not found' });

    const user          = result.recordset[0];
    const { newPassword, sendEmail = true } = req.body;
    const passwordToSet = newPassword?.trim() || genPassword();
    const hashed        = await bcrypt.hash(passwordToSet, 12);

    await pool.request()
      .input('password', sql.VarChar(255), hashed)
      .input('userId',   sql.Int,          req.params.id)
      .query('UPDATE [dbo].[Users] SET Password = @password WHERE UserID = @userId');

    const fullName = `${user.FirstName || ''} ${user.Surname || ''}`.trim();
    let emailSent  = false;

    if (sendEmail && user.Email) {
      try {
        await sendSimpleEmail({
          to:      user.Email,
          subject: '🔑 Your Password Has Been Reset',
          html:    generatePasswordResetEmail({ name: fullName, email: user.Email, newPassword: passwordToSet })
        });
        emailSent = true;
      } catch (err) { console.error('Reset email failed (non-fatal):', err.message); }
    }

    res.json({ message: 'Password reset successfully', emailSent, ...(sendEmail && !emailSent ? { tempPassword: passwordToSet } : {}) });
  } catch (e) { console.error('Reset password error:', e); res.status(500).json({ message: 'Server error' }); }
});

// ─── PUT /api/users/:id/change-password ──────────────────────────────────────
router.put('/:id/change-password', async (req, res) => {
  try {
    if (String(req.user.userId) !== String(req.params.id))
      return res.status(403).json({ message: 'You can only change your own password' });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Both current and new password are required' });
    if (newPassword.length < 8)
      return res.status(400).json({ message: 'New password must be at least 8 characters' });

    const pool   = await getPool();
    const result = await pool.request()
      .input('userId', sql.Int, req.params.id)
      .query('SELECT Password FROM [dbo].[Users] WHERE UserID = @userId');
    if (!result.recordset.length) return res.status(404).json({ message: 'User not found' });

    const match = await bcrypt.compare(currentPassword, result.recordset[0].Password || '');
    if (!match) return res.status(401).json({ message: 'Current password is incorrect' });

    await pool.request()
      .input('password', sql.VarChar(255), await bcrypt.hash(newPassword, 12))
      .input('userId',   sql.Int,          req.params.id)
      .query('UPDATE [dbo].[Users] SET Password = @password WHERE UserID = @userId');
    res.json({ message: 'Password changed successfully' });
  } catch (e) { console.error('Change password error:', e); res.status(500).json({ message: 'Server error' }); }
});

// ─── DELETE /api/users/:id (soft-delete) ─────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (String(req.user.userId) === String(req.params.id))
      return res.status(400).json({ message: 'You cannot deactivate your own account' });

    const pool    = await getPool();
    const existing = await pool.request()
      .input('userId', sql.Int, req.params.id)
      .query('SELECT UserID FROM [dbo].[Users] WHERE UserID = @userId');
    if (!existing.recordset.length) return res.status(404).json({ message: 'User not found' });

    await pool.request()
      .input('userId', sql.Int, req.params.id)
      .query('UPDATE [dbo].[Users] SET IsActive = 0 WHERE UserID = @userId');
    res.json({ message: 'User deactivated successfully' });
  } catch (e) { console.error('Delete user error:', e); res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;