import { sql, poolPromise } from "../config/database.js";
import { getClientSchedule } from "../scripts/managePatrolSchedules.js";
import dayjs from "dayjs";

/**
 * 🔧 Map shift type from database to standardized format
 */
function normalizeShiftType(shiftType) {
  if (!shiftType) return "day_night";
  
  const normalized = shiftType.toLowerCase().replace(/\s+/g, "_");
  
  if (normalized.includes("day") && normalized.includes("night")) {
    return "day_night";
  } else if (normalized.includes("night")) {
    return "night";
  } else if (normalized.includes("day")) {
    return "day";
  }
  
  return "day_night";
}

/**
 * 🕐 Build time condition SQL based on shift type
 */
function buildTimeCondition(shiftType) {
  const normalized = normalizeShiftType(shiftType);
  
  switch (normalized) {
    case "day":
      return {
        sql: "AND DATEPART(HOUR, rec.rec_tfechahora) BETWEEN 6 AND 17",
        description: "Day Shift (6:00-17:59)"
      };
    case "night":
      return {
        sql: "AND (DATEPART(HOUR, rec.rec_tfechahora) >= 18 OR DATEPART(HOUR, rec.rec_tfechahora) < 6)",
        description: "Night Shift (18:00-5:59)"
      };
    case "day_night":
    default:
      return {
        sql: "",
        description: "All Shifts"
      };
  }
}

/**
 * 🧮 Calculate expected patrols for a date range based on schedule
 */
function calculateExpectedPatrols(startDate, endDate, schedule) {
  if (!schedule) {
    // Fallback: use default 11 patrols per day
    const days = dayjs(endDate).diff(dayjs(startDate), 'day') + 1;
    return days * 11;
  }
  
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  const days = end.diff(start, 'day') + 1;
  
  // Parse patrol days from schedule
  const patrolDays = (schedule.patrol_days || "Mon,Tue,Wed,Thu,Fri,Sat,Sun")
    .split(",")
    .map(d => d.trim());
  
  // 🔒 Safe access to weekend patrols (handles missing column)
  const weekendCount = schedule.weekend_patrols_per_day ?? null;
  
  let totalExpected = 0;
  
  // Iterate through each day in the range
  for (let i = 0; i < days; i++) {
    const currentDate = start.add(i, 'day');
    const dayName = currentDate.format("ddd");
    
    // Check if patrols are scheduled for this day
    if (patrolDays.includes(dayName)) {
      // Check if it's a weekend and has different patrol count
      const isWeekend = ["Sat", "Sun"].includes(dayName);
      const dailyPatrols = isWeekend && weekendCount !== null
        ? weekendCount
        : schedule.patrols_per_day;
      
      totalExpected += dailyPatrols;
    }
  }
  
  return totalExpected;
}

/**
 * 🗓️ Build table name for monthly partition (if used)
 * Returns array of table names if range spans multiple months
 */
function getTableNames(startDate, endDate, usePartitions = true) {
  if (!usePartitions) {
    return ["[_Datos].[dbo].[p_recepcion]"];
  }
  
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  const tables = new Set();
  
  let current = start;
  while (current.isBefore(end) || current.isSame(end, 'month')) {
    const monthSuffix = current.format("YYYYMM");
    tables.add(`[_Datos].[dbo].[p_recepcion${monthSuffix}]`);
    current = current.add(1, 'month').startOf('month');
  }
  
  return Array.from(tables);
}

/**
 * 📊 Fetch weekly report with dynamic patrol schedule integration
 */
export const fetchWeeklyReport = async (
  client, 
  startDateTime, 
  endDateTime, 
  shiftType = "Day/Night",
  useMonthlyPartitions = true  // ⚙️ Toggle for partition support
) => {
  try {
    const pool = await poolPromise;

    // 1️⃣ Get client ID and schedule configuration
    let clientId = null;
    let clientSchedule = null;
    
    try {
      const clientResult = await pool.request()
        .input("clientName", sql.NVarChar, client)
        .query(`
          SELECT cue_iid AS id 
          FROM [_Datos].[dbo].[m_cuentas] 
          WHERE cue_cnombre = @clientName
        `);
      
      if (clientResult.recordset.length > 0) {
        clientId = clientResult.recordset[0].id;
        clientSchedule = await getClientSchedule(clientId);
      }
    } catch (scheduleError) {
      console.warn("⚠️ Could not fetch client schedule:", scheduleError.message);
    }

    // 2️⃣ Determine effective shift type
    const effectiveShiftType = clientSchedule?.shift_type 
      ? normalizeShiftType(clientSchedule.shift_type)
      : normalizeShiftType(shiftType);
    
    const timeFilter = buildTimeCondition(effectiveShiftType);
    
    console.log(`🔍 Fetching report for ${client}`);
    console.log(`   Period: ${startDateTime} → ${endDateTime}`);
    console.log(`   Shift: ${timeFilter.description} ${timeFilter.sql ? `(${timeFilter.sql.substring(0, 30)}...)` : '(no filter)'}`);
    console.log(`   Schedule: ${clientSchedule ? 'Found' : 'Using defaults'}`);

    // 3️⃣ Calculate expected patrols for performance metrics
    const totalExpectedPatrols = calculateExpectedPatrols(startDateTime, endDateTime, clientSchedule);
    const daysInRange = dayjs(endDateTime).diff(dayjs(startDateTime), 'day') + 1;

    console.log(`   Expected Patrols (calculated): ${totalExpectedPatrols}`);
    console.log(`   Days in Range: ${daysInRange}`);

    // 4️⃣ Get table names (handles multi-month ranges)
    const tableNames = getTableNames(startDateTime, endDateTime, useMonthlyPartitions);
    console.log(`   Using tables: ${tableNames.join(', ')}`);

    // 5️⃣ Build UNION query for multi-month support
    const buildUnionQuery = (tables, alias = 'rec') => {
      return tables.map(table => `SELECT * FROM ${table} AS ${alias}`).join('\n      UNION ALL\n      ');
    };

    // 6️⃣ Build and execute query with DYNAMIC expected patrols
    const query = `
      DECLARE @StartDateTime DATETIME = @startDateParam;
      DECLARE @EndDateTime DATETIME = @endDateParam;
      DECLARE @ClientName NVARCHAR(255) = @clientParam;
      DECLARE @TotalExpectedPatrols INT = @expectedPatrolsParam;

      /* 🟥 INCIDENT SUMMARY */
      SELECT 
          'TOTAL INCIDENTS REPORTED = ' + 
          CAST(
              ISNULL((
                  SELECT COUNT(*) 
                  FROM [_Datos].[dbo].[p_reporte_autoridades] AS rep
                  INNER JOIN [_Datos].[dbo].[m_cuentas] AS cue
                      ON rep.rep_iidcuenta = cue.cue_iid
                  WHERE 
                      cue.cue_cnombre = @ClientName
                      AND rep.rep_dfechahora BETWEEN @StartDateTime AND @EndDateTime
              ), 0)
          AS NVARCHAR(20)) AS [IncidentReport];

      /* 🟩 PATROL PERFORMANCE SUMMARY BY ZONE - USES DYNAMIC EXPECTED PATROLS */
      SELECT 
          zon.zon_cdescripcion AS [SitePosts],
          CAST(COUNT(rec.rec_iid) AS NVARCHAR(20)) AS [ChecksCompleted],
          @TotalExpectedPatrols AS [ExpectedChecks],
          CONCAT(
              CAST(ROUND(
                  (CAST(COUNT(rec.rec_iid) AS FLOAT) / NULLIF(@TotalExpectedPatrols, 0)) * 100, 
                  0
              ) AS INT), '%'
          ) AS [PerformanceRate]
      FROM (
          ${buildUnionQuery(tableNames)}
      ) AS rec
      INNER JOIN [_Datos].[dbo].[m_zonas] AS zon
          ON rec.rec_iidcuenta = zon.zon_iidcuenta
          AND rec.rec_czona = zon.zon_ccodigo
      INNER JOIN [_Datos].[dbo].[m_cuentas] AS cue
          ON rec.rec_iidcuenta = cue.cue_iid
      WHERE 
          cue.cue_cnombre = @ClientName
          AND rec.rec_tfechahora BETWEEN @StartDateTime AND @EndDateTime
          ${timeFilter.sql}
      GROUP BY 
          zon.zon_cdescripcion
      ORDER BY 
          [SitePosts];

      /* 🟦 CLEAN EVENT LOG */
      SELECT 
          CONVERT(VARCHAR(10), rec.rec_tfechahora, 120) AS [Date],
          CONVERT(VARCHAR(8), rec.rec_tfechahora, 108) AS [Time],
          CASE 
              WHEN f.for_cdescripcion = 'VIGICONTROL: Arribo' THEN 'VIGICONTROL: Arrival'
              WHEN f.for_cdescripcion = 'VIGICONTROL: Login' THEN 'VIGICONTROL: Login'
              WHEN f.for_cdescripcion = 'VIGICONTROL: Logout' THEN 'VIGICONTROL: Logout'
              ELSE COALESCE(
                  NULLIF(f.for_cdescripcion, ''), 
                  NULLIF(rec.rec_cContenido, ''), 
                  rec.rec_calarma, 
                  'Unknown Event'
              )
          END AS [Event],
          COALESCE(zon.zon_cdescripcion, 'No Zone') AS [Zone]
      FROM (
          ${buildUnionQuery(tableNames)}
      ) AS rec
      INNER JOIN [_Datos].[dbo].[m_cuentas] AS cue
          ON rec.rec_iidcuenta = cue.cue_iid
      LEFT JOIN [_Datos].[dbo].[m_zonas] AS zon
          ON rec.rec_iidcuenta = zon.zon_iidcuenta
          AND rec.rec_czona = zon.zon_ccodigo
      LEFT JOIN [_Datos].[dbo].[m_formatos] AS f
          ON rec.rec_calarma = f.for_calarma
      WHERE 
          cue.cue_cnombre = @ClientName
          AND rec.rec_tfechahora BETWEEN @StartDateTime AND @EndDateTime
          ${timeFilter.sql}
      ORDER BY rec.rec_tfechahora DESC;
    `;

    const result = await pool.request()
      .input("startDateParam", sql.DateTime, startDateTime)
      .input("endDateParam", sql.DateTime, endDateTime)
      .input("clientParam", sql.NVarChar, client)
      .input("expectedPatrolsParam", sql.Int, totalExpectedPatrols)
      .query(query);

    console.log(`✅ Query executed successfully`);
    console.log(`   Incidents: ${result.recordsets[0]?.length || 0}`);
    console.log(`   Zones: ${result.recordsets[1]?.length || 0}`);
    console.log(`   Events: ${result.recordsets[2]?.length || 0}`);

    return {
      success: true,
      incident: result.recordsets[0] || [],
      summary: result.recordsets[1] || [],
      events: result.recordsets[2] || [],
      metadata: {
        clientId,
        shift: {
          requested: shiftType,
          effective: effectiveShiftType,
          description: timeFilter.description
        },
        schedule: clientSchedule,
        calculations: {
          daysInRange,
          totalExpectedPatrols,
          hasSchedule: !!clientSchedule,
          patrolsPerDay: clientSchedule?.patrols_per_day || 11,
          weekendPatrols: clientSchedule?.weekend_patrols_per_day ?? null
        },
        tables: tableNames
      }
    };
  } catch (error) {
    console.error("❌ Database Query Error:", error);
    return {
      success: false,
      message: "Database query failed.",
      sqlMessage: error.message,
    };
  }
};