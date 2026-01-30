const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const database = require("../config/database.js");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `backup-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== ".bak") {
      return cb(new Error("Only .bak files are allowed"));
    }
    cb(null, true);
  },
});

// GET /api/backup/history - Get upload history
router.get("/history", async (req, res) => {
  try {
    const pool = await database.poolPromise;
    
    // Create backup_history table if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'backup_history')
      CREATE TABLE backup_history (
        id INT IDENTITY(1,1) PRIMARY KEY,
        filename NVARCHAR(255) NOT NULL,
        fileSize NVARCHAR(50),
        recordsFound INT,
        recordsMerged INT,
        duplicatesSkipped INT,
        uploadedAt DATETIME DEFAULT GETDATE(),
        status NVARCHAR(50) DEFAULT 'success'
      )
    `);

    // Get all backup history
    const result = await pool.request().query(`
      SELECT * FROM backup_history
      ORDER BY uploadedAt DESC
    `);

    res.json({
      success: true,
      history: result.recordset,
    });
  } catch (err) {
    console.error("Failed to fetch history:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch upload history",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

// DELETE /api/backup/history/:id - Delete a backup record
router.delete("/history/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await database.poolPromise;

    // Check if record exists
    const checkResult = await pool.request()
      .input('id', database.sql.Int, id)
      .query('SELECT * FROM backup_history WHERE id = @id');

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Backup record not found",
      });
    }

    const record = checkResult.recordset[0];

    // Delete the record
    await pool.request()
      .input('id', database.sql.Int, id)
      .query('DELETE FROM backup_history WHERE id = @id');

    console.log(`🗑️ Deleted backup record: ${record.filename} (ID: ${id})`);

    res.json({
      success: true,
      message: `Backup record "${record.filename}" deleted successfully`,
      deletedRecord: record,
    });
  } catch (err) {
    console.error("Failed to delete backup record:", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete backup record",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

// POST /api/backup/sync
router.post("/sync", upload.single("file"), async (req, res) => {
  let stagingDB = null;
  let backupPath = null;

  try {
    // Validate file upload
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No backup file uploaded. Please select a .bak file.",
      });
    }

    const pool = await database.poolPromise;

    // Check if there are existing backups
    const historyCount = await pool.request().query(`
      SELECT COUNT(*) as count FROM backup_history WHERE status = 'success'
    `);

    const existingBackups = historyCount.recordset[0].count;

    // Restrict upload if there's an existing backup
    if (existingBackups > 0) {
      // Clean up uploaded file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return res.status(403).json({
        success: false,
        message: "You must delete the existing backup before uploading a new one. Only one active backup is allowed at a time.",
        existingBackups: existingBackups,
      });
    }

    backupPath = req.file.path.replace(/\\/g, "/");
    stagingDB = "StagingDB_" + Date.now();

    console.log(`⚙️ Starting backup sync process...`);
    console.log(`📁 File: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`💾 Restoring backup: ${backupPath} → ${stagingDB}`);

    // 1️⃣ Restore the .bak into a temporary staging database
    const restoreQuery = `
      RESTORE DATABASE [${stagingDB}]
      FROM DISK = N'${backupPath}'
      WITH MOVE 'YourDataFileName' TO 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\DATA\\${stagingDB}.mdf',
           MOVE 'YourLogFileName' TO 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\DATA\\${stagingDB}_log.ldf',
           REPLACE;
    `;

    await pool.request().query(restoreQuery);
    console.log(`✅ Backup restored successfully into ${stagingDB}`);

    // 2️⃣ Get count of records to merge
    const countResult = await pool.request().query(`
      SELECT COUNT(*) as totalRecords
      FROM [${stagingDB}].[dbo].[p_recepcion] s
      WHERE NOT EXISTS (
        SELECT 1 FROM [_Datos].[dbo].[p_recepcion] d
        WHERE d.rec_tfechahora = s.rec_tfechahora
          AND d.rec_cTerminal = s.rec_cTerminal
      );
    `);

    const recordsToMerge = countResult.recordset[0].totalRecords;
    console.log(`📊 Records to merge: ${recordsToMerge}`);

    // 3️⃣ Copy / merge data into your main DB (_Datos)
    const mergeResult = await pool.request().query(`
      INSERT INTO [_Datos].[dbo].[p_recepcion] (
        rec_iidcuenta, rec_calarma, rec_czona, rec_iusuario, rec_tfechahora,
        rec_nestado, rec_cContenido, rec_tFechaProceso, rec_ioperador,
        rec_cObservaciones, rec_cTerminal
      )
      SELECT
        rec_iidcuenta, rec_calarma, rec_czona, rec_iusuario, rec_tfechahora,
        rec_nestado, rec_cContenido, rec_tFechaProceso, rec_ioperador,
        rec_cObservaciones, rec_cTerminal
      FROM [${stagingDB}].[dbo].[p_recepcion] s
      WHERE NOT EXISTS (
        SELECT 1 FROM [_Datos].[dbo].[p_recepcion] d
        WHERE d.rec_tfechahora = s.rec_tfechahora
          AND d.rec_cTerminal = s.rec_cTerminal
      );
    `);

    const recordsMerged = mergeResult.rowsAffected[0];
    console.log(`✅ Data merged: ${recordsMerged} records inserted into _Datos`);

    // 4️⃣ Drop the staging DB
    await pool.request().query(`DROP DATABASE [${stagingDB}]`);
    console.log(`🗑️ Staging database ${stagingDB} dropped successfully`);

    // 5️⃣ Clean up uploaded file
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
      console.log(`🗑️ Uploaded file cleaned up: ${backupPath}`);
    }

    // 6️⃣ Save to history
    await pool.request()
      .input('filename', database.sql.NVarChar, req.file.originalname)
      .input('fileSize', database.sql.NVarChar, `${(req.file.size / 1024 / 1024).toFixed(2)} MB`)
      .input('recordsFound', database.sql.Int, recordsToMerge)
      .input('recordsMerged', database.sql.Int, recordsMerged)
      .input('duplicatesSkipped', database.sql.Int, recordsToMerge - recordsMerged)
      .query(`
        INSERT INTO backup_history (filename, fileSize, recordsFound, recordsMerged, duplicatesSkipped)
        VALUES (@filename, @fileSize, @recordsFound, @recordsMerged, @duplicatesSkipped)
      `);

    // Success response
    res.json({
      success: true,
      message: `Backup synced successfully! ${recordsMerged} new records added to the database.`,
      details: {
        filename: req.file.originalname,
        fileSize: `${(req.file.size / 1024 / 1024).toFixed(2)} MB`,
        recordsFound: recordsToMerge,
        recordsMerged: recordsMerged,
        duplicatesSkipped: recordsToMerge - recordsMerged,
        timestamp: new Date().toISOString(),
      },
    });

  } catch (err) {
    console.error("❌ Backup sync failed:", err);

    // Clean up staging DB if it was created
    if (stagingDB) {
      try {
        const pool = await database.poolPromise;
        await pool.request().query(`
          IF EXISTS (SELECT name FROM sys.databases WHERE name = N'${stagingDB}')
          DROP DATABASE [${stagingDB}]
        `);
        console.log(`🗑️ Cleaned up staging database: ${stagingDB}`);
      } catch (cleanupErr) {
        console.error("Failed to clean up staging database:", cleanupErr);
      }
    }

    // Clean up uploaded file
    if (backupPath && fs.existsSync(backupPath)) {
      try {
        fs.unlinkSync(backupPath);
        console.log(`🗑️ Cleaned up uploaded file: ${backupPath}`);
      } catch (cleanupErr) {
        console.error("Failed to clean up uploaded file:", cleanupErr);
      }
    }

    // Determine error type for better user feedback
    let errorMessage = "Backup sync failed. Please check the file and try again.";
    
    if (err.message.includes("RESTORE DATABASE")) {
      errorMessage = "Failed to restore backup file. Please ensure it's a valid SQL Server backup.";
    } else if (err.message.includes("MOVE")) {
      errorMessage = "Database file path error. Please check server configuration.";
    } else if (err.message.includes("p_recepcion")) {
      errorMessage = "Database schema mismatch. Please ensure backup is compatible.";
    } else if (err.message.includes("Only .bak files")) {
      errorMessage = "Invalid file type. Only .bak files are allowed.";
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

// GET /api/backup/status - Check backup sync capability
router.get("/status", async (req, res) => {
  try {
    const pool = await database.poolPromise;
    
    // Check database connection
    await pool.request().query("SELECT 1");
    
    // Check if main database exists
    const dbCheck = await pool.request().query(`
      SELECT name FROM sys.databases WHERE name = N'_Datos'
    `);

    // Get backup count
    const backupCount = await pool.request().query(`
      SELECT COUNT(*) as count FROM backup_history WHERE status = 'success'
    `);

    res.json({
      success: true,
      status: "operational",
      message: "Backup sync service is ready",
      databaseConnected: true,
      mainDatabaseExists: dbCheck.recordset.length > 0,
      activeBackups: backupCount.recordset[0].count,
      canUpload: backupCount.recordset[0].count === 0,
    });
  } catch (err) {
    console.error("Status check failed:", err);
    res.status(503).json({
      success: false,
      status: "unavailable",
      message: "Backup sync service is currently unavailable",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

module.exports = router;