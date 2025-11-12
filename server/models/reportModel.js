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
 * 📊 Fetch weekly report - FIXED VERSION for PDF generation
 */
export const fetchWeeklyReport = async (clientId, startDate, endDate) => {
  try {
    console.log("🔍 Starting fetchWeeklyReport with:", {
      clientId,
      startDate,
      endDate
    });

    const pool = await poolPromise;

    // 1️⃣ Validate required parameters
    if (!clientId) {
      throw new Error("Client ID is required");
    }

    if (!startDate || !endDate) {
      throw new Error("Start date and end date are required");
    }

    // Convert to Date objects if they're strings
    const startDateTime = new Date(startDate);
    const endDateTime = new Date(endDate);

    // 2️⃣ Get client name from ID for querying
    let clientName = null;
    try {
      const clientResult = await pool.request()
        .input("clientId", sql.Int, parseInt(clientId))
        .query(`
          SELECT cue_cnombre AS name 
          FROM [_Datos].[dbo].[m_cuentas] 
          WHERE cue_iid = @clientId
        `);
      
      if (clientResult.recordset.length > 0) {
        clientName = clientResult.recordset[0].name;
        console.log(`✅ Found client: ${clientName} (ID: ${clientId})`);
      } else {
        throw new Error(`Client not found with ID: ${clientId}`);
      }
    } catch (clientError) {
      console.error("❌ Client lookup error:", clientError);
      throw new Error(`Failed to find client: ${clientError.message}`);
    }

    // 3️⃣ Get client schedule for expected patrols calculation
    let clientSchedule = null;
    try {
      clientSchedule = await getClientSchedule(parseInt(clientId));
      console.log(`📅 Client schedule: ${clientSchedule ? 'Found' : 'Using defaults'}`);
    } catch (scheduleError) {
      console.warn("⚠️ Could not fetch client schedule:", scheduleError.message);
    }

    // 4️⃣ Calculate expected patrols
    const totalExpectedPatrols = calculateExpectedPatrols(startDateTime, endDateTime, clientSchedule);
    console.log(`📊 Expected patrols: ${totalExpectedPatrols}`);

    // 5️⃣ Get table names for query
    const tableNames = getTableNames(startDateTime, endDateTime, true);
    console.log(`🗃️ Querying tables: ${tableNames.join(', ')}`);

    // 6️⃣ Build UNION query for multi-table support
    const buildUnionQuery = (tables) => {
      return tables.map(table => `SELECT * FROM ${table}`).join('\n      UNION ALL\n      ');
    };

    // 7️⃣ EXECUTE MAIN QUERY - Simplified and focused on PDF needs
    const query = `
      -- Performance Summary by Post
      SELECT 
          zon.zon_cdescripcion AS SecurityPost,
          COUNT(rec.rec_iid) AS Completed,
          @TotalExpectedPatrols AS Expected,
          CASE 
            WHEN @TotalExpectedPatrols > 0 
            THEN ROUND((COUNT(rec.rec_iid) * 100.0 / @TotalExpectedPatrols), 2)
            ELSE 0 
          END AS Performance
      FROM (${buildUnionQuery(tableNames)}) AS rec
      INNER JOIN [_Datos].[dbo].[m_zonas] AS zon
          ON rec.rec_iidcuenta = zon.zon_iidcuenta
          AND rec.rec_czona = zon.zon_ccodigo
      INNER JOIN [_Datos].[dbo].[m_cuentas] AS cue
          ON rec.rec_iidcuenta = cue.cue_iid
      WHERE 
          cue.cue_iid = @ClientId
          AND rec.rec_tfechahora BETWEEN @StartDate AND @EndDate
      GROUP BY zon.zon_cdescripcion
      ORDER BY zon.zon_cdescripcion;

      -- Security Events Log
      SELECT 
          CONVERT(VARCHAR(10), rec.rec_tfechahora, 120) AS Date,
          CONVERT(VARCHAR(8), rec.rec_tfechahora, 108) AS Time,
          COALESCE(
              NULLIF(f.for_cdescripcion, ''), 
              NULLIF(rec.rec_cContenido, ''), 
              rec.rec_calarma, 
              'No description'
          ) AS Event,
          COALESCE(zon.zon_cdescripcion, 'No Zone') AS Zone
      FROM (${buildUnionQuery(tableNames)}) AS rec
      INNER JOIN [_Datos].[dbo].[m_cuentas] AS cue
          ON rec.rec_iidcuenta = cue.cue_iid
      LEFT JOIN [_Datos].[dbo].[m_zonas] AS zon
          ON rec.rec_iidcuenta = zon.zon_iidcuenta
          AND rec.rec_czona = zon.zon_ccodigo
      LEFT JOIN [_Datos].[dbo].[m_formatos] AS f
          ON rec.rec_calarma = f.for_calarma
      WHERE 
          cue.cue_iid = @ClientId
          AND rec.rec_tfechahora BETWEEN @StartDate AND @EndDate
      ORDER BY rec.rec_tfechahora DESC;
    `;

    console.log("🚀 Executing database query...");
    
    const request = pool.request()
      .input("ClientId", sql.Int, parseInt(clientId))
      .input("StartDate", sql.DateTime, startDateTime)
      .input("EndDate", sql.DateTime, endDateTime)
      .input("TotalExpectedPatrols", sql.Int, totalExpectedPatrols);

    const result = await request.query(query);

    // 8️⃣ Process results for PDF consumption
    const posts = result.recordsets[0] || [];
    const events = result.recordsets[1] || [];

    console.log("✅ Query results:", {
      postsCount: posts.length,
      eventsCount: events.length,
      postsSample: posts.slice(0, 2),
      eventsSample: events.slice(0, 2)
    });

    // 9️⃣ Return data in the EXACT format expected by PDF generator
    return {
      posts: posts.map(post => ({
        SecurityPost: post.SecurityPost || 'Unknown Post',
        Completed: post.Completed || 0,
        Expected: post.Expected || 0,
        Performance: post.Performance || 0
      })),
      events: events.map(event => ({
        Date: event.Date || 'N/A',
        Time: event.Time || 'N/A', 
        Event: event.Event || 'No description',
        Zone: event.Zone || 'No Zone'
      })),
      metadata: {
        clientId: parseInt(clientId),
        clientName: clientName,
        startDate: startDateTime,
        endDate: endDateTime,
        totalExpectedPatrols: totalExpectedPatrols,
        generatedAt: new Date()
      }
    };

  } catch (error) {
    console.error("❌ fetchWeeklyReport Error:", error);
    
    // Return empty but valid structure for PDF generator
    return {
      posts: [],
      events: [],
      metadata: {
        clientId: parseInt(clientId) || 0,
        clientName: 'Unknown',
        startDate: startDate,
        endDate: endDate,
        totalExpectedPatrols: 0,
        generatedAt: new Date(),
        error: error.message
      }
    };
  }
};

/**
 * 🧪 TEST FUNCTION: Direct data verification
 */
export const testWeeklyReportData = async (clientId, startDate, endDate) => {
  try {
    console.log("🧪 TESTING Weekly Report Data...");
    
    const data = await fetchWeeklyReport(clientId, startDate, endDate);
    
    return {
      success: true,
      data: {
        postsCount: data.posts.length,
        eventsCount: data.events.length,
        posts: data.posts,
        events: data.events,
        metadata: data.metadata
      },
      diagnostics: {
        clientIdType: typeof clientId,
        startDateType: typeof startDate, 
        endDateType: typeof endDate,
        hasPosts: Array.isArray(data.posts),
        hasEvents: Array.isArray(data.events)
      }
    };
  } catch (error) {
    console.error("❌ Test failed:", error);
    return {
      success: false,
      error: error.message
    };
  }
};