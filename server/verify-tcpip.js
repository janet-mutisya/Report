// server/scripts/diagnoseData.js
import { sql, poolPromise } from '../config/database.js';

/**
 * 🔍 DIAGNOSTIC QUERIES TO FIND REAL DATA
 */
async function diagnoseClientData(clientId) {
  try {
    const pool = await poolPromise;
    console.log(`\n🔍 DIAGNOSING DATA FOR CLIENT ${clientId}\n`);

    // 1. Check what tables exist
    console.log('1. 📊 CHECKING AVAILABLE TABLES:');
    const tablesResult = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
      AND TABLE_NAME LIKE '%patrol%' 
         OR TABLE_NAME LIKE '%recepcion%'
         OR TABLE_NAME LIKE '%event%'
         OR TABLE_NAME LIKE '%punto%'
         OR TABLE_NAME LIKE '%zona%'
      ORDER BY TABLE_NAME
    `);
    console.log('Available tables:', tablesResult.recordset.map(t => t.TABLE_NAME));

    // 2. Check p_recepcion structure (where events likely are)
    console.log('\n2. 📋 CHECKING p_recepcion STRUCTURE:');
    try {
      const recepcionColumns = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'p_recepcion'
        ORDER BY ORDINAL_POSITION
      `);
      console.log('p_recepcion columns:', recepcionColumns.recordset);
    } catch (e) {
      console.log('p_recepcion table not accessible');
    }

    // 3. Check m_puntos structure (posts/checkpoints)
    console.log('\n3. 🏢 CHECKING m_puntos STRUCTURE:');
    try {
      const puntosColumns = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'm_puntos'
        ORDER BY ORDINAL_POSITION
      `);
      console.log('m_puntos columns:', puntosColumns.recordset);
    } catch (e) {
      console.log('m_puntos table not accessible');
    }

    // 4. Get sample patrol events from last 7 days
    console.log('\n4. 📅 SAMPLE PATROL EVENTS (LAST 7 DAYS):');
    const eventsSample = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT TOP 10 
          rec_iid AS EventID,
          rec_tfechahora AS EventDate,
          rec_calarma AS AlarmCode,
          rec_czona AS ZoneCode,
          rec_iusuario AS UserID,
          rec_cContenido AS Content,
          rec_cObservaciones AS Observations
        FROM p_recepcion 
        WHERE rec_iidcuenta = @clientId
          AND rec_tfechahora >= DATEADD(day, -7, GETDATE())
        ORDER BY rec_tfechahora DESC
      `);
    console.log('Recent events sample:', eventsSample.recordset);

    // 5. Count patrol events by type
    console.log('\n5. 🔢 COUNT PATROL EVENTS BY TYPE:');
    const eventCounts = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          rec_calarma AS AlarmCode,
          COUNT(*) AS Count
        FROM p_recepcion 
        WHERE rec_iidcuenta = @clientId
          AND rec_tfechahora >= DATEADD(day, -30, GETDATE())
        GROUP BY rec_calarma
        ORDER BY Count DESC
      `);
    console.log('Event counts by type:', eventCounts.recordset);

    // 6. Get actual posts/checkpoints
    console.log('\n6. 📍 ACTUAL POSTS/CHECKPOINTS:');
    try {
      const postsData = await pool.request()
        .input('clientId', sql.Int, clientId)
        .query(`
          SELECT TOP 20
            pun_iid AS PostID,
            pun_cnombre AS PostName,
            pun_cdescripcion AS Description,
            pun_ccodigo AS PostCode
          FROM m_puntos
          WHERE pun_iidcuenta = @clientId
            AND pun_cnombre IS NOT NULL
          ORDER BY pun_iid
        `);
      console.log('Posts data:', postsData.recordset);
    } catch (e) {
      console.log('Could not fetch posts:', e.message);
    }

    // 7. Get zones
    console.log('\n7. 🗺️ ZONES DATA:');
    const zonesData = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT TOP 10
          zon_ccodigo AS ZoneCode,
          zon_cdescripcion AS ZoneName
        FROM m_zonas
        WHERE zon_iidcuenta = @clientId
          AND zon_cdescripcion IS NOT NULL
        ORDER BY zon_ccodigo
      `);
    console.log('Zones data:', zonesData.recordset);

    // 8. Calculate actual patrol statistics
    console.log('\n8. 📊 ACTUAL PATROL STATISTICS:');
    const patrolStats = await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('startDate', sql.DateTime, '2025-10-01')
      .input('endDate', sql.DateTime, '2025-10-08')
      .query(`
        SELECT 
          -- Total events in period
          COUNT(*) AS TotalEvents,
          -- Patrol check events (V04 typically means patrol completion)
          SUM(CASE WHEN rec_calarma = 'V04' THEN 1 ELSE 0 END) AS PatrolCompletions,
          -- Unique users doing patrols
          COUNT(DISTINCT rec_iusuario) AS ActiveGuards,
          -- Unique zones covered
          COUNT(DISTINCT rec_czona) AS ZonesCovered,
          -- Events per day
          CONVERT(VARCHAR, rec_tfechahora, 23) AS PatrolDate,
          COUNT(*) AS DailyEvents
        FROM p_recepcion 
        WHERE rec_iidcuenta = @clientId
          AND rec_tfechahora BETWEEN @startDate AND @endDate
        GROUP BY CONVERT(VARCHAR, rec_tfechahora, 23)
        ORDER BY PatrolDate
      `);
    console.log('Patrol statistics:', patrolStats.recordset);

    return {
      tables: tablesResult.recordset,
      eventsSample: eventsSample.recordset,
      eventCounts: eventCounts.recordset,
      postsData: postsData.recordset || [],
      zonesData: zonesData.recordset,
      patrolStats: patrolStats.recordset
    };

  } catch (error) {
    console.error('❌ Diagnostic failed:', error);
    throw error;
  }
}

export { diagnoseClientData };