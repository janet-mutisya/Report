import { sql, poolPromise } from "../config/database.js";

export const fetchWeeklyReport = async (client, startDateTime, endDateTime) => {
  try {
    const pool = await poolPromise;

    const query = `
      DECLARE @StartDateTime DATETIME = @startDateParam;
      DECLARE @EndDateTime DATETIME = @endDateParam;
      DECLARE @ClientName NVARCHAR(255) = @clientParam;

      /* 🟥 INCIDENT SUMMARY - For specific client */
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

      /* 🟩 PATROL PERFORMANCE SUMMARY - For specific client */
      SELECT 
          zon.zon_cdescripcion AS [SitePosts],
          CAST(COUNT(rec.rec_iid) AS NVARCHAR(20)) AS [ChecksCompleted],
          (DATEDIFF(DAY, @StartDateTime, @EndDateTime) + 1) * 11 AS [ExpectedChecks],
          CONCAT(
              CAST(ROUND(
                  (CAST(COUNT(rec.rec_iid) AS FLOAT) /
                  ((DATEDIFF(DAY, @StartDateTime, @EndDateTime) + 1) * 11)) * 100, 0
              ) AS INT), '%'
          ) AS [PerformanceRate]
      FROM [_Datos].[dbo].[p_recepcion] AS rec
      INNER JOIN [_Datos].[dbo].[m_zonas] AS zon
          ON rec.rec_iidcuenta = zon.zon_iidcuenta
          AND rec.rec_czona = zon.zon_ccodigo
      INNER JOIN [_Datos].[dbo].[m_cuentas] AS cue
          ON rec.rec_iidcuenta = cue.cue_iid
      WHERE 
          cue.cue_cnombre = @ClientName
          AND rec.rec_tfechahora BETWEEN @StartDateTime AND @EndDateTime
      GROUP BY 
          zon.zon_cdescripcion
      ORDER BY 
          [SitePosts];

      /* 🟦 CLEAN EVENT LOG - Four columns: Date, Time, Event, Zone */
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
      FROM [_Datos].[dbo].[p_recepcion] AS rec
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
      ORDER BY rec.rec_tfechahora DESC;
    `;

    const result = await pool.request()
      .input("startDateParam", sql.DateTime, startDateTime)
      .input("endDateParam", sql.DateTime, endDateTime)
      .input("clientParam", sql.NVarChar, client)
      .query(query);

    return {
      success: true,
      incident: result.recordsets[0] || [],      // "TOTAL INCIDENTS REPORTED = X" for selected client
      summary: result.recordsets[1] || [],       // Performance stats for selected client
      events: result.recordsets[2] || [],        // Event logs for selected client
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