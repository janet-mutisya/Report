import { sql, poolPromise } from "../config/database.js";

export const fetchWeeklyReport = async (client, startDateTime, endDateTime) => {
  try {
    const pool = await poolPromise;

    const query = `
      DECLARE @StartDateTime DATETIME = @startDateParam;
      DECLARE @EndDateTime DATETIME = @endDateParam;
      DECLARE @ClientName NVARCHAR(255) = @clientParam;

      -- ✅ PERFORMANCE SUMMARY
      SELECT 
          zon.zon_cdescripcion AS [SitePosts],
          COUNT(rec.rec_iid) AS [ChecksCompleted],
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

      -- ✅ EVENTS LOG (use rec_cContenido or rec_calarma)
      SELECT 
          CONVERT(VARCHAR(10), rec.rec_tfechahora, 120) AS [Date],
          CONVERT(VARCHAR(8), rec.rec_tfechahora, 108) AS [Time],
          COALESCE(NULLIF(rec.rec_cContenido, ''), rec.rec_calarma, 'Unknown') AS [Event],
          zon.zon_cdescripcion AS [Zone],
          rec.rec_cTerminal AS [Device]
      FROM [_Datos].[dbo].[p_recepcion] AS rec
      INNER JOIN [_Datos].[dbo].[m_zonas] AS zon
          ON rec.rec_iidcuenta = zon.zon_iidcuenta
          AND rec.rec_czona = zon.zon_ccodigo
      INNER JOIN [_Datos].[dbo].[m_cuentas] AS cue
          ON rec.rec_iidcuenta = cue.cue_iid
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
      summary: result.recordsets[0] || [],
      events: result.recordsets[1] || [],
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
