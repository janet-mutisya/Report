// server/scripts/managePatrolSchedules.js
// Helper script to bulk-configure patrol schedules for all clients

import { sql, poolPromise } from "../config/database.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * 🧱 Ensure m_patrol_schedule table exists
 */
export async function ensurePatrolScheduleTable() {
  try {
    const pool = await poolPromise;

    // ✅ Ensure table exists
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='m_patrol_schedule' AND xtype='U')
      CREATE TABLE [_Datos].[dbo].[m_patrol_schedule] (
        client_id INT PRIMARY KEY,
        patrols_per_day INT NOT NULL,
        patrol_days VARCHAR(50) NOT NULL,
        schedule_type VARCHAR(20) NOT NULL DEFAULT 'daily',
        weekend_patrols_per_day INT NULL,
        custom_interval_days INT NULL,
        shift_type VARCHAR(20) NOT NULL DEFAULT 'Day/Night',
        created_at DATETIME DEFAULT GETDATE(),
        updated_at DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_patrol_schedule_client 
          FOREIGN KEY (client_id) REFERENCES [_Datos].[dbo].[m_cuentas](cue_iid)
      );
      ELSE
      BEGIN
        -- ✅ Add column if missing
        IF NOT EXISTS (
          SELECT * FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'm_patrol_schedule' AND COLUMN_NAME = 'shift_type'
        )
        ALTER TABLE [_Datos].[dbo].[m_patrol_schedule]
        ADD shift_type VARCHAR(20) NOT NULL DEFAULT 'Day/Night';
      END
    `);

    console.log("✅ Table check complete: m_patrol_schedule exists and includes shift_type.");
  } catch (err) {
    console.error("❌ Error ensuring m_patrol_schedule table:", err.message);
    throw err;
  }
}

/**
 * ✔️ Validate schedule configuration
 */
function validateScheduleConfig(config) {
  const validDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = config.patrolDays.split(",").map(d => d.trim());

  for (const d of days) {
    if (!validDays.includes(d)) {
      throw new Error(`Invalid day "${d}" in patrolDays. Must be one of: ${validDays.join(", ")}`);
    }
  }

  if (config.patrolsPerDay <= 0) {
    throw new Error("patrolsPerDay must be greater than zero.");
  }

  if (config.weekendPatrols !== null && config.weekendPatrols !== undefined && config.weekendPatrols < 0) {
    throw new Error("weekendPatrols must be zero or greater.");
  }

  const validScheduleTypes = ["daily", "weekly", "custom"];
  if (!validScheduleTypes.includes(config.scheduleType)) {
    throw new Error(`Invalid scheduleType "${config.scheduleType}". Must be one of: ${validScheduleTypes.join(", ")}`);
  }

  if (config.scheduleType === "custom" && (!config.customIntervalDays || config.customIntervalDays <= 0)) {
    throw new Error("customIntervalDays must be greater than zero when scheduleType is 'custom'.");
  }

  const validShiftTypes = ["Day", "Night", "Day/Night"];
  if (!validShiftTypes.includes(config.shiftType)) {
    throw new Error(`Invalid shiftType "${config.shiftType}". Must be one of: ${validShiftTypes.join(", ")}`);
  }

  return true;
}

/**
 * 📋 List all clients and their current patrol schedules
 */
export async function listAllSchedules() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        C.cue_iid AS ClientID,
        C.cue_cnombre AS ClientName,
        PS.patrols_per_day AS PatrolsPerDay,
        PS.patrol_days AS PatrolDays,
        PS.schedule_type AS ScheduleType,
        PS.weekend_patrols_per_day AS WeekendPatrols,
        PS.custom_interval_days AS CustomInterval,
        PS.shift_type AS ShiftType
      FROM [_Datos].[dbo].[m_cuentas] C
      LEFT JOIN [_Datos].[dbo].[m_patrol_schedule] PS
        ON C.cue_iid = PS.client_id
      ORDER BY C.cue_cnombre
    `);

    console.log("\n📋 Current Patrol Schedules for All Clients:\n");
    console.log("ID\tClient Name\t\t\tPatrols/Day\tDays\t\t\t\tType\t\tShift");
    console.log("=".repeat(140));

    for (const row of result.recordset) {
      const patrols = row.PatrolsPerDay || "Not Set";
      const days = (row.PatrolDays || "Not Set").padEnd(30);
      const type = row.ScheduleType || "Not Set";
      const shift = row.ShiftType || "Not Set";
      const weekend = row.WeekendPatrols ? ` (Weekend: ${row.WeekendPatrols})` : "";
      
      console.log(`${row.ClientID}\t${row.ClientName.padEnd(30)}\t${patrols}\t\t${days}\t${type}\t\t${shift}${weekend}`);
    }

    console.log("\n✅ Total clients:", result.recordset.length);
    return result.recordset;

  } catch (err) {
    console.error("❌ Error listing schedules:", err.message);
    throw err;
  }
}

/**
 * 🔍 Get schedule for a single client
 */
export async function getClientSchedule(clientId) {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("ClientID", sql.Int, clientId)
      .query(`
        SELECT 
          client_id,
          patrols_per_day,
          patrol_days,
          schedule_type,
          weekend_patrols_per_day,
          custom_interval_days,
          shift_type,
          created_at,
          updated_at
        FROM [_Datos].[dbo].[m_patrol_schedule]
        WHERE client_id = @ClientID
      `);
    
    if (result.recordset.length === 0) {
      console.log(`⚠️ No schedule found for client ID ${clientId}`);
      return null;
    }

    return result.recordset[0];
  } catch (err) {
    console.error(`❌ Error fetching schedule for client ${clientId}:`, err.message);
    throw err;
  }
}

/**
 * 🔧 Update patrol schedule for a specific client
 */
export async function updateClientSchedule(clientId, scheduleConfig) {
  try {
    const {
      patrolsPerDay = 11,
      patrolDays = "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
      scheduleType = "daily",
      weekendPatrols = null,
      customIntervalDays = null,
      shiftType = "Day/Night"
    } = scheduleConfig;

    // Normalize the config
    const normalizedConfig = {
      patrolsPerDay,
      patrolDays,
      scheduleType,
      weekendPatrols,
      customIntervalDays,
      shiftType
    };

    // Validate before updating
    validateScheduleConfig(normalizedConfig);

    const pool = await poolPromise;

    await pool.request()
      .input("ClientID", sql.Int, clientId)
      .input("PatrolsPerDay", sql.Int, patrolsPerDay)
      .input("PatrolDays", sql.VarChar(50), patrolDays)
      .input("ScheduleType", sql.VarChar(20), scheduleType)
      .input("WeekendPatrols", sql.Int, weekendPatrols)
      .input("CustomInterval", sql.Int, customIntervalDays)
      .input("ShiftType", sql.VarChar(20), shiftType)
      .query(`
        MERGE [_Datos].[dbo].[m_patrol_schedule] AS target
        USING (SELECT @ClientID AS client_id) AS source
        ON target.client_id = source.client_id
        WHEN MATCHED THEN
          UPDATE SET 
            patrols_per_day = @PatrolsPerDay,
            patrol_days = @PatrolDays,
            schedule_type = @ScheduleType,
            weekend_patrols_per_day = @WeekendPatrols,
            custom_interval_days = @CustomInterval,
            shift_type = @ShiftType,
            updated_at = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (client_id, patrols_per_day, patrol_days, schedule_type, weekend_patrols_per_day, custom_interval_days, shift_type)
          VALUES (@ClientID, @PatrolsPerDay, @PatrolDays, @ScheduleType, @WeekendPatrols, @CustomInterval, @ShiftType);
      `);

    console.log(`✅ Schedule updated for client ID ${clientId}`);

  } catch (err) {
    console.error(`❌ Error updating schedule for client ${clientId}:`, err.message);
    throw err;
  }
}

/**
 * 📦 Bulk update schedules from configuration array
 */
export async function bulkUpdateSchedules(schedules) {
  console.log(`\n🔧 Starting bulk update for ${schedules.length} clients...\n`);
  
  let successCount = 0;
  let errorCount = 0;

  for (const schedule of schedules) {
    try {
      await updateClientSchedule(schedule.clientId, schedule.config);
      successCount++;
      console.log(`  ✅ Client ${schedule.clientId} updated`);
    } catch (err) {
      console.error(`  ❌ Failed to update client ${schedule.clientId}: ${err.message}`);
      errorCount++;
    }
  }

  console.log(`\n✅ Bulk update complete: ${successCount} successful, ${errorCount} errors`);
}

/**
 * 🎯 Example usage configurations
 */
const exampleSchedules = [
  {
    clientId: 1, // Replace with actual client ID
    config: {
      patrolsPerDay: 11,
      patrolDays: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
      scheduleType: "daily",
      shiftType: "Day/Night"
    }
  },
  {
    clientId: 2, // Client B - 8 patrols per day, Day shift only
    config: {
      patrolsPerDay: 8,
      patrolDays: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
      scheduleType: "weekly",
      shiftType: "Day"
    }
  },
  {
    clientId: 3, // Client C - Different weekend pattern, Night shift
    config: {
      patrolsPerDay: 8,
      weekendPatrols: 5, // Different count on weekends
      patrolDays: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
      scheduleType: "daily",
      shiftType: "Night"
    }
  },
  {
    clientId: 4, // Weekdays only
    config: {
      patrolsPerDay: 12,
      patrolDays: "Mon,Tue,Wed,Thu,Fri",
      scheduleType: "daily",
      shiftType: "Day/Night"
    }
  },
  {
    clientId: 5, // Custom interval - every 10 days
    config: {
      patrolsPerDay: 15,
      patrolDays: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
      scheduleType: "custom",
      customIntervalDays: 10,
      shiftType: "Day"
    }
  }
];

// 🚀 Run the script
async function main() {
  try {
    console.log("🚀 Patrol Schedule Manager\n");

    // Handle CLI arguments
    if (process.argv.includes("--create-table")) {
      await ensurePatrolScheduleTable();
      console.log("\n✅ Table creation complete. Exiting.");
      process.exit(0);
    }

    if (process.argv.includes("--list")) {
      await ensurePatrolScheduleTable();
      await listAllSchedules();
      process.exit(0);
    }

    if (process.argv.includes("--help")) {
      console.log(`
📖 Usage:
  node server/scripts/managePatrolSchedules.js [options]

Options:
  --list              List all client schedules
  --create-table      Create m_patrol_schedule table if it doesn't exist
  --help              Show this help message

Examples:
  node server/scripts/managePatrolSchedules.js --list
  node server/scripts/managePatrolSchedules.js --create-table
      `);
      process.exit(0);
    }

    // Default behavior: ensure table exists and list schedules
    await ensurePatrolScheduleTable();
    await listAllSchedules();

    // Uncomment to bulk update (modify exampleSchedules first!)
    // await bulkUpdateSchedules(exampleSchedules);

    // Or update a single client:
    // await updateClientSchedule(1, {
    //   patrolsPerDay: 11,
    //   patrolDays: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
    //   scheduleType: "daily",
    //   shiftType: "Day/Night"
    // });

    // Or get a single client schedule:
    // const schedule = await getClientSchedule(1);
    // console.log("\n📄 Client Schedule:", schedule);

  } catch (err) {
    console.error("❌ Error running Patrol Schedule Manager:", err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Only run main if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}