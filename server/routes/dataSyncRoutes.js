import express from "express";
import { sql, poolPromise } from "../config/database.js";

const router = express.Router();

/**
 * POST /api/sync
 * Syncs records to SQL Server and logs the sync attempt in `sync_log`.
 */
router.post("/", async (req, res) => {
  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);

  try {
    const { source = "ExternalSystem", records } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Expected an array of records",
      });
    }

    await transaction.begin();

    const request = new sql.Request(transaction);

    let insertedCount = 0;
    let updatedCount = 0;

    for (const record of records) {
      const result = await request
        .input("rec_iidcuenta", sql.Int, record.rec_iidcuenta)
        .input("rec_calarma", sql.NVarChar(255), record.rec_calarma)
        .input("rec_czona", sql.NVarChar(50), record.rec_czona)
        .input("rec_iusuario", sql.Int, record.rec_iusuario)
        .input("rec_tfechahora", sql.DateTime, record.rec_tfechahora)
        .input("rec_nestado", sql.Int, record.rec_nestado)
        .input("rec_cContenido", sql.NVarChar(sql.MAX), record.rec_cContenido)
        .input("rec_tFechaProceso", sql.DateTime, record.rec_tFechaProceso)
        .input("rec_ioperador", sql.Int, record.rec_ioperador)
        .input("rec_cObservaciones", sql.NVarChar(sql.MAX), record.rec_cObservaciones)
        .input("rec_cTerminal", sql.NVarChar(100), record.rec_cTerminal)
        .query(`
          IF EXISTS (
            SELECT 1 FROM [_Datos].[dbo].[p_recepcion]
            WHERE rec_tfechahora = @rec_tfechahora
              AND rec_cTerminal = @rec_cTerminal
          )
          BEGIN
            UPDATE [_Datos].[dbo].[p_recepcion]
            SET
              rec_iidcuenta = @rec_iidcuenta,
              rec_calarma = @rec_calarma,
              rec_czona = @rec_czona,
              rec_iusuario = @rec_iusuario,
              rec_nestado = @rec_nestado,
              rec_cContenido = @rec_cContenido,
              rec_tFechaProceso = @rec_tFechaProceso,
              rec_ioperador = @rec_ioperador,
              rec_cObservaciones = @rec_cObservaciones
            WHERE rec_tfechahora = @rec_tfechahora
              AND rec_cTerminal = @rec_cTerminal;
          END
          ELSE
          BEGIN
            INSERT INTO [_Datos].[dbo].[p_recepcion] (
              rec_iidcuenta,
              rec_calarma,
              rec_czona,
              rec_iusuario,
              rec_tfechahora,
              rec_nestado,
              rec_cContenido,
              rec_tFechaProceso,
              rec_ioperador,
              rec_cObservaciones,
              rec_cTerminal
            )
            VALUES (
              @rec_iidcuenta,
              @rec_calarma,
              @rec_czona,
              @rec_iusuario,
              @rec_tfechahora,
              @rec_nestado,
              @rec_cContenido,
              @rec_tFechaProceso,
              @rec_ioperador,
              @rec_cObservaciones,
              @rec_cTerminal
            );
          END
        `);

      // determine whether insert or update happened
      if (result.rowsAffected[0] > 0 && result.rowsAffected.length === 1) {
        insertedCount++;
      } else {
        updatedCount++;
      }
    }

    //  Log the sync attempt
    await new sql.Request(transaction)
      .input("source", sql.NVarChar(100), source)
      .input("total_records", sql.Int, records.length)
      .input("inserted_count", sql.Int, insertedCount)
      .input("updated_count", sql.Int, updatedCount)
      .input("sync_time", sql.DateTime, new Date())
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM [_Datos].[dbo].sysobjects WHERE name='sync_log' AND xtype='U'
        )
        BEGIN
          CREATE TABLE [_Datos].[dbo].[sync_log] (
            id INT IDENTITY(1,1) PRIMARY KEY,
            source NVARCHAR(100),
            total_records INT,
            inserted_count INT,
            updated_count INT,
            sync_time DATETIME,
            status NVARCHAR(50),
            message NVARCHAR(MAX)
          );
        END

        INSERT INTO [_Datos].[dbo].[sync_log] (
          source, total_records, inserted_count, updated_count, sync_time, status, message
        )
        VALUES (
          @source, @total_records, @inserted_count, @updated_count, @sync_time, 'SUCCESS', 'Sync completed successfully.'
        );
      `);

    await transaction.commit();

    res.json({
      success: true,
      message: `${records.length} records synced successfully.`,
      details: {
        inserted: insertedCount,
        updated: updatedCount,
      },
    });
  } catch (err) {
    console.error(" Data sync error:", err);

    try {
      await new sql.Request(pool)
        .input("source", sql.NVarChar(100), req.body.source || "ExternalSystem")
        .input("sync_time", sql.DateTime, new Date())
        .input("status", sql.NVarChar(50), "FAILED")
        .input("message", sql.NVarChar(sql.MAX), err.message)
        .query(`
          INSERT INTO [_Datos].[dbo].[sync_log] (source, total_records, inserted_count, updated_count, sync_time, status, message)
          VALUES (@source, 0, 0, 0, @sync_time, @status, @message)
        `);
    } catch (logErr) {
      console.error(" Failed to log sync error:", logErr.message);
    }

    res.status(500).json({
      success: false,
      message: "Data sync failed.",
      error: err.message,
    });
  }
});

export default router;
