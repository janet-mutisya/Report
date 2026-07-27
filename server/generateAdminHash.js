/**
 * server/generateAdminHash.js
 *
 * Generates and optionally executes SQL INSERT statements for m_usuarios.
 * Passwords are stored as bcrypt hashes (cost factor 12).
 *
 * Usage:
 *   node generateAdminHash.js                          <- print SQL only
 *   node generateAdminHash.js --run                    <- print + execute against DB
 *   node generateAdminHash.js --username=john --email=john@bmsecurity.com --password=Pass123 --type=1 --run
 *
 * usu_ntipo:  1 = admin,  2 = staff  (default: 1)
 *
 * Requires:  npm install bcrypt
 */

'use strict';

const path   = require('path');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

// ── Parse CLI args ───────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, ...val] = a.slice(2).split('=');
      return [key, val.join('=')];
    })
);

const RUN_NOW = 'run' in args;

// ── Default admin users ──────────────────────────────────────────────────────
const DEFAULT_USERS = [
  { username: 'rirungu',  email: 'rirungu@bmsecurity.com',  password: 'Admin1234', type: 1 },
  { username: 'jmutisya', email: 'jmutisya@bmsecurity.com', password: 'Admin1234', type: 1 },
];

// ── Build user list ──────────────────────────────────────────────────────────
const rawUsers = args.username
  ? [{
      username: args.username,
      email:    args.email    || '',
      password: args.password || 'Admin1234',
      type:     Number(args.type ?? 1),
    }]
  : DEFAULT_USERS;

// ── Escape SQL single quotes ─────────────────────────────────────────────────
const esc = (s) => String(s).replace(/'/g, "''");

// ── Build per-user SQL block ─────────────────────────────────────────────────
function userSQL({ username, email, passwordHash, type }, cuentaId = 1) {
  const role = type === 1 ? 'admin' : 'staff';
  return [
    `-- ${role.toUpperCase()}: ${username} (${email})`,
    `IF NOT EXISTS (SELECT 1 FROM [dbo].[m_usuarios] WHERE usu_cnombre = '${esc(username)}')`,
    `BEGIN`,
    `  INSERT INTO [dbo].[m_usuarios] (usu_iidcuenta, usu_icodigo, usu_cnombre, usu_cclave, usu_ntipo, usu_email, usu_cimagen, usu_mobservacion, usu_idKey, usu_cIdExtendido, usu_cmetadata)`,
    `  VALUES (${cuentaId}, 0, '${esc(username)}', '${esc(passwordHash)}', ${type}, '${esc(email)}', '', '', 0, '', '{"mustChangePassword":false}');`,
    `  PRINT 'Created ${role}: ${username}';`,
    `END`,
    `ELSE`,
    `BEGIN`,
    `  UPDATE [dbo].[m_usuarios]`,
    `  SET    usu_cclave = '${esc(passwordHash)}', usu_ntipo = ${type}, usu_email = '${esc(email)}'`,
    `  WHERE  usu_cnombre = '${esc(username)}';`,
    `  PRINT 'Updated existing user: ${username}';`,
    `END`,
  ].join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const divider  = '='.repeat(60);
  const hairline = '-'.repeat(60);

  console.log(`\n${divider}`);
  console.log('  BM Security -- Admin User SQL Generator');
  console.log(`${divider}\n`);

  // Hash all passwords up front
  console.log(`[i] Hashing passwords with bcrypt (rounds=${BCRYPT_ROUNDS})...`);
  const users = await Promise.all(
    rawUsers.map(async (u) => ({
      ...u,
      passwordHash: await bcrypt.hash(u.password, BCRYPT_ROUNDS),
    }))
  );
  console.log('[i] Hashing complete.\n');

  // Print SQL
  console.log('>> Copy and run this SQL in MSSQL:\n');
  console.log(hairline);
  users.forEach(u => console.log(userSQL(u) + '\n'));
  console.log(hairline);

  // Print credentials
  console.log('\n>> Login credentials:');
  users.forEach(({ username, email, password, passwordHash, type }) => {
    const role = type === 1 ? 'admin' : 'staff';
    console.log(`
  [${role.toUpperCase()}]
  Username      : ${username}   <- use this to log in (NOT email)
  Email         : ${email}
  Plain password: ${password}   <- for your records only
  Bcrypt hash   : ${passwordHash}
  Type          : usu_ntipo = ${type} (${role})`);
  });

  console.log('\n[!] To manually reset a password, run:');
  console.log(`  node generateAdminHash.js --username=someone --password=NewPass --run\n`);

  // ── Optional: execute directly against the DB ──────────────────────────────
  if (!RUN_NOW) {
    console.log('[i] Tip: run with --run to execute the SQL against your database automatically.\n');
    process.exit(0);
  }

  // Load DB config
  let db, sql;
  try {
    db  = require(path.join(__dirname, 'config', 'database'));
    sql = db.sql ?? require('mssql');
  } catch (e) {
    console.error('[!] Could not load database config:', e.message);
    console.error('    Make sure you run this from inside the /server directory.');
    process.exit(1);
  }

  try {
    console.log('[i] Connecting to database...');
    const pool = await db.getPool();

    // Resolve usu_iidcuenta
    const accountRes = await pool.request()
      .query(`SELECT TOP 1 cue_iid, cue_cnombre FROM m_cuentas ORDER BY cue_iid ASC`);

    if (!accountRes.recordset.length) {
      console.error('[!] No rows found in m_cuentas — cannot determine usu_iidcuenta.');
      process.exit(1);
    }

    const cuentaId     = accountRes.recordset[0].cue_iid;
    const cuentaNombre = accountRes.recordset[0].cue_cnombre;
    console.log(`[i] Using account: cue_iid=${cuentaId} (${cuentaNombre})\n`);

    // Discover identity columns
    const identityRes = await pool.request().query(`
      SELECT c.name
      FROM   sys.columns c
      JOIN   sys.tables  t ON t.object_id = c.object_id
      WHERE  t.name        = 'm_usuarios'
        AND  c.is_identity = 1
    `);
    const identityCols  = new Set(identityRes.recordset.map(r => r.name.toLowerCase()));
    const iidIsIdentity = identityCols.has('usu_iid');
    let   nextIid       = null;

    if (!iidIsIdentity) {
      const maxRes = await pool.request()
        .query(`SELECT ISNULL(MAX(usu_iid), 0) + 1 AS next_iid FROM [dbo].[m_usuarios]`);
      nextIid = maxRes.recordset[0].next_iid;
      console.log(`[i] usu_iid is NOT identity — assigning manually starting at ${nextIid}`);
    } else {
      console.log(`[i] usu_iid is identity — SQL Server assigns automatically`);
    }
    console.log('');

    const ALL_CANDIDATES = [
      ...(!iidIsIdentity ? [{ col: 'usu_iid', param: 'iid', type: sql.Int, value: (_, i) => nextIid + i }] : []),
      { col: 'usu_iidcuenta',    param: 'cuentaId',     type: sql.Int,           value: () => cuentaId          },
      { col: 'usu_icodigo',      param: 'icodigo',      type: sql.Int,           value: () => 0                 },
      { col: 'usu_cnombre',      param: 'username',     type: sql.VarChar(255),  value: (u) => u.username       },
      { col: 'usu_cclave',       param: 'password',     type: sql.VarChar(255),  value: (u) => u.passwordHash   }, // <-- hash
      { col: 'usu_ntipo',        param: 'ntipo',        type: sql.Numeric(18,0), value: (u) => u.type           },
      { col: 'usu_email',        param: 'email',        type: sql.VarChar(255),  value: (u) => u.email          },
      { col: 'usu_cimagen',      param: 'cimagen',      type: sql.VarChar(255),  value: () => ''                },
      { col: 'usu_mobservacion', param: 'mobservacion', type: sql.VarChar(500),  value: () => ''                },
      { col: 'usu_cIdExtendido', param: 'cIdExtendido', type: sql.VarChar(255),  value: () => ''                },
      { col: 'usu_cmetadata',    param: 'metadata',     type: sql.VarChar(500),  value: () => JSON.stringify({ mustChangePassword: false }) },
    ].filter(c => !identityCols.has(c.col.toLowerCase()));

    for (const [userIndex, u] of users.entries()) {
      const role = u.type === 1 ? 'admin' : 'staff';

      const check = await pool.request()
        .input('username', sql.VarChar(255), u.username)
        .query(`SELECT usu_iid FROM [dbo].[m_usuarios] WHERE usu_cnombre = @username`);

      if (check.recordset.length === 0) {
        const req = pool.request();
        for (const c of ALL_CANDIDATES) req.input(c.param, c.type, c.value(u, userIndex));

        const cols   = ALL_CANDIDATES.map(c => c.col).join(', ');
        const params = ALL_CANDIDATES.map(c => `@${c.param}`).join(', ');

        await req.query(`INSERT INTO [dbo].[m_usuarios] (${cols}) VALUES (${params})`);
        console.log(`  [+] Created ${role}: ${u.username} (bcrypt hash stored)`);
      } else {
        await pool.request()
          .input('username', sql.VarChar(255), u.username)
          .input('password', sql.VarChar(255), u.passwordHash)  // <-- hash
          .input('type',     sql.Int,          u.type)
          .input('email',    sql.VarChar(255), u.email)
          .query(`
            UPDATE [dbo].[m_usuarios]
            SET    usu_cclave = @password,
                   usu_ntipo  = @type,
                   usu_email  = @email
            WHERE  usu_cnombre = @username
          `);
        console.log(`  [~] Updated existing: ${u.username} (bcrypt hash stored)`);
      }
    }

    console.log('\n[OK] Done. Test login with:\n');
    users.forEach(u => {
      console.log(`  curl -X POST http://localhost:5000/api/auth/login ^`);
      console.log(`    -H "Content-Type: application/json" ^`);
      console.log(`    -d "{\\"username\\":\\"${u.username}\\",\\"password\\":\\"${u.password}\\"}"\n`);
    });

    process.exit(0);
  } catch (err) {
    console.error('[!] Database error:', err.message);
    process.exit(1);
  }
})();