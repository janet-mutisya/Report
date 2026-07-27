cat > /tmp/patch.js << 'ENDOFSCRIPT'
const fs = require('fs');
const path = 'controllers/schedulerController.js';
let content = fs.readFileSync(path, 'utf8');

const old = "console.log('🔍 DEBUG INSERT — clientId:', clientId, 'typeof:', typeof clientId, 'shiftType:', finalShiftType, 'body:', JSON.stringify(req.body));";

const check = "const identityCheck = await connection.request().query(`SELECT IDENT_CURRENT('_Datos.dbo.m_reportes_automaticos') AS CurrentIdentity, (SELECT MAX(rep_idKey) FROM _Datos.dbo.m_reportes_automaticos) AS MaxActualId, DB_NAME() AS ConnectedDatabase, @@SERVERNAME AS ConnectedServer`);\n      console.log('IDENTITY CHECK:', identityCheck.recordset[0]);\n      " + old;

if (content.indexOf(old) === -1) {
  console.log('ERROR: target line not found');
} else {
  content = content.split(old).join(check);
  fs.writeFileSync(path, content);
  console.log('SUCCESS: inserted identity check');
}
ENDOFSCRIPT