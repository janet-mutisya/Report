import sql from 'mssql';
import poolPromise from '../config/database.js';

/**
 * ✅ GET all client schedules
 */
export const getAllSchedules = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        rep_idKey,
        rep_iidcuenta,
        rep_ntipo,
        rep_tproximoenvio,
        rep_nfrecuencia,
        rep_cmail,
        rep_nCadaUnidadTiempo,
        rep_cMailRuteoSMS,
        rep_cSMSParaInforme
      FROM _Datos.dbo.m_reportes_automaticos
      ORDER BY rep_tproximoenvio ASC
    `);

    res.status(200).json({
      success: true,
      total: result.recordset.length,
      schedules: result.recordset,
    });
  } catch (error) {
    console.error('❌ Error fetching schedules:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while fetching schedules',
      error: error.message,
    });
  }
};

/**
 * ✅ GET schedule by ID
 */
export const getScheduleById = async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;

    const result = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT 
          rep_idKey,
          rep_iidcuenta,
          rep_ntipo,
          rep_tproximoenvio,
          rep_nfrecuencia,
          rep_cmail,
          rep_nCadaUnidadTiempo,
          rep_cMailRuteoSMS,
          rep_cSMSParaInforme
        FROM _Datos.dbo.m_reportes_automaticos
        WHERE rep_idKey = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found',
      });
    }

    res.status(200).json({
      success: true,
      schedule: result.recordset[0],
    });
  } catch (error) {
    console.error('❌ Error fetching schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while fetching schedule',
      error: error.message,
    });
  }
};

/**
 * 🟡 UPDATE an existing schedule
 */
export const updateSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { rep_tproximoenvio, rep_nfrecuencia, rep_cmail } = req.body;

    if (!rep_tproximoenvio || !rep_nfrecuencia || !rep_cmail) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields (rep_tproximoenvio, rep_nfrecuencia, rep_cmail)',
      });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('rep_tproximoenvio', sql.DateTime, rep_tproximoenvio)
      .input('rep_nfrecuencia', sql.Int, rep_nfrecuencia)
      .input('rep_cmail', sql.VarChar(4000), rep_cmail)
      .query(`
        UPDATE _Datos.dbo.m_reportes_automaticos
        SET 
          rep_tproximoenvio = @rep_tproximoenvio,
          rep_nfrecuencia = @rep_nfrecuencia,
          rep_cmail = @rep_cmail
        WHERE rep_idKey = @id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found or not updated',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Schedule updated successfully',
    });
  } catch (error) {
    console.error('❌ Error updating schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while updating schedule',
      error: error.message,
    });
  }
};

/**
 * 🟢 CREATE a new schedule
 */
export const createSchedule = async (req, res) => {
  try {
    const {
      rep_iidcuenta,
      rep_ntipo,
      rep_tproximoenvio,
      rep_nfrecuencia,
      rep_cmail,
      rep_nCadaUnidadTiempo,
      rep_cMailRuteoSMS,
      rep_cSMSParaInforme,
    } = req.body;

    if (!rep_iidcuenta || !rep_ntipo || !rep_tproximoenvio || !rep_nfrecuencia || !rep_cmail) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields (rep_iidcuenta, rep_ntipo, rep_tproximoenvio, rep_nfrecuencia, rep_cmail)',
      });
    }

    const pool = await poolPromise;
    await pool.request()
      .input('rep_iidcuenta', sql.Int, rep_iidcuenta)
      .input('rep_ntipo', sql.Int, rep_ntipo)
      .input('rep_tproximoenvio', sql.DateTime, rep_tproximoenvio)
      .input('rep_nfrecuencia', sql.Int, rep_nfrecuencia)
      .input('rep_cmail', sql.VarChar(4000), rep_cmail)
      .input('rep_nCadaUnidadTiempo', sql.Int, rep_nCadaUnidadTiempo || 0)
      .input('rep_cMailRuteoSMS', sql.VarChar(150), rep_cMailRuteoSMS || '')
      .input('rep_cSMSParaInforme', sql.VarChar(150), rep_cSMSParaInforme || '')
      .query(`
        INSERT INTO _Datos.dbo.m_reportes_automaticos 
        (rep_iidcuenta, rep_ntipo, rep_tproximoenvio, rep_nfrecuencia, rep_cmail, 
         rep_nCadaUnidadTiempo, rep_cMailRuteoSMS, rep_cSMSParaInforme)
        VALUES 
        (@rep_iidcuenta, @rep_ntipo, @rep_tproximoenvio, @rep_nfrecuencia, 
         @rep_cmail, @rep_nCadaUnidadTiempo, @rep_cMailRuteoSMS, @rep_cSMSParaInforme)
      `);

    res.status(201).json({
      success: true,
      message: 'New schedule created successfully',
    });
  } catch (error) {
    console.error('❌ Error creating schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while creating schedule',
      error: error.message,
    });
  }
};

/**
 * 🟣 UPSERT schedule (update if exists, insert if not)
 */
export const upsertSchedule = async (req, res) => {
  try {
    const {
      rep_iidcuenta,
      rep_ntipo,
      rep_tproximoenvio,
      rep_nfrecuencia,
      rep_cmail,
      rep_nCadaUnidadTiempo,
      rep_cMailRuteoSMS,
      rep_cSMSParaInforme,
    } = req.body;

    if (!rep_iidcuenta || !rep_tproximoenvio || !rep_nfrecuencia || !rep_cmail) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (rep_iidcuenta, rep_tproximoenvio, rep_nfrecuencia, rep_cmail)",
      });
    }

    const pool = await poolPromise;

    await pool.request()
      .input("rep_iidcuenta", sql.Int, rep_iidcuenta)
      .input("rep_ntipo", sql.Int, rep_ntipo || 1)
      .input("rep_tproximoenvio", sql.DateTime, rep_tproximoenvio)
      .input("rep_nfrecuencia", sql.Int, rep_nfrecuencia)
      .input("rep_cmail", sql.VarChar(4000), rep_cmail)
      .input("rep_nCadaUnidadTiempo", sql.Int, rep_nCadaUnidadTiempo || 0)
      .input("rep_cMailRuteoSMS", sql.VarChar(150), rep_cMailRuteoSMS || "")
      .input("rep_cSMSParaInforme", sql.VarChar(150), rep_cSMSParaInforme || "")
      .query(`
        MERGE _Datos.dbo.m_reportes_automaticos AS target
        USING (SELECT @rep_iidcuenta AS rep_iidcuenta) AS source
        ON target.rep_iidcuenta = source.rep_iidcuenta
        WHEN MATCHED THEN
          UPDATE SET 
            rep_tproximoenvio = @rep_tproximoenvio,
            rep_nfrecuencia = @rep_nfrecuencia,
            rep_cmail = @rep_cmail,
            rep_nCadaUnidadTiempo = @rep_nCadaUnidadTiempo,
            rep_cMailRuteoSMS = @rep_cMailRuteoSMS,
            rep_cSMSParaInforme = @rep_cSMSParaInforme
        WHEN NOT MATCHED THEN
          INSERT (rep_iidcuenta, rep_ntipo, rep_tproximoenvio, rep_nfrecuencia, rep_cmail, rep_nCadaUnidadTiempo, rep_cMailRuteoSMS, rep_cSMSParaInforme)
          VALUES (@rep_iidcuenta, @rep_ntipo, @rep_tproximoenvio, @rep_nfrecuencia, @rep_cmail, @rep_nCadaUnidadTiempo, @rep_cMailRuteoSMS, @rep_cSMSParaInforme);
      `);

    res.status(200).json({
      success: true,
      message: "Schedule upserted successfully",
    });
  } catch (error) {
    console.error("❌ Error upserting schedule:", error);
    res.status(500).json({
      success: false,
      message: "Database error while upserting schedule",
      error: error.message,
    });
  }
};

