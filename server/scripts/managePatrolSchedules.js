// server/scripts/managePatrolSchedules.js
//
// STORAGE STRATEGY: dedicated `schedule_config` column (nvarchar MAX)
// ─────────────────────────────────────────────────────────────────────────────
// The table has a `schedule_config` column (nvarchar(max)) that is used
// exclusively for patrol schedule JSON. rep_cmail is now purely an email
// address and is never touched by any schedule read/write in this file.
// ─────────────────────────────────────────────────────────────────────────────
//
// SHIFT TYPE POLICY
// ─────────────────────────────────────────────────────────────────────────────
// shiftType MUST be explicitly set to one of: 'day' | 'night' | 'both'
// There is NO silent default. Clients without a configured shiftType will
// surface as "Not configured" in the admin panel and will fail report
// generation with a clear error message.
//
// SHIFT TYPE HOURS:
//   'day'   → 06:00 – 18:00 (same calendar day)
//   'night' → 18:00 – 06:00 (next day - rolls over midnight)
//   'both'  → 06:00 – 06:00 (next day - full 24hr window)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const sql = require('mssql');
const { poolPromise } = require('../config/database.js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');
const apiService = require('../service/bmSecurityAPI.js');

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_SCHEDULE_PREFIX = 'SCHEDULE::';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const scheduleCache = new Map();

// Valid shift types — single source of truth used by all validation
const VALID_SHIFT_TYPES = ['day', 'night', 'both'];

// Shift type hour definitions
const SHIFT_HOURS = {
  day: {
    label: 'Day Shift',
    startHour: 6,
    endHour: 18,
    startPeriod: 'AM',
    endPeriod: 'PM',
    description: '06:00 – 18:00 (same day)'
  },
  night: {
    label: 'Night Shift',
    startHour: 18,
    endHour: 6,
    startPeriod: 'PM',
    endPeriod: 'AM',
    description: '18:00 – 06:00 (next day)'
  },
  both: {
    label: '24hr Shift',
    startHour: 6,
    endHour: 6,
    startPeriod: 'AM',
    endPeriod: 'AM',
    description: '06:00 – 06:00 (next day - full 24hr)'
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL API CLIENT CACHE
// ─────────────────────────────────────────────────────────────────────────────

let _apiClientsCache = null;
let _apiClientsCacheTime = 0;
let _apiClientsFetchingP = null;
const API_CLIENTS_TTL = 10 * 60 * 1000;

async function getAllClients() {
  const age = Date.now() - _apiClientsCacheTime;

  if (_apiClientsCache && age < API_CLIENTS_TTL) {
    return _apiClientsCache;
  }

  if (_apiClientsFetchingP) {
    return _apiClientsFetchingP;
  }

  _apiClientsFetchingP = (async () => {
    try {
      console.log('🔄 [APIClientCache] Refreshing client list from BM Security API…');
      const clients = await apiService.getClients();
      _apiClientsCache = clients;
      _apiClientsCacheTime = Date.now();
      console.log(`✅ [APIClientCache] ${clients.length} clients cached`);
      return _apiClientsCache;
    } catch (err) {
      console.error(`❌ [APIClientCache] Fetch failed: ${err.message}`);
      if (_apiClientsCache) {
        console.warn(`⚠️ [APIClientCache] Returning stale cache (${Math.round(age / 60000)}m old)`);
        return _apiClientsCache;
      }
      return [];
    } finally {
      _apiClientsFetchingP = null;
    }
  })();

  return _apiClientsFetchingP;
}

function invalidateAPIClientsCache() {
  _apiClientsCache = null;
  _apiClientsCacheTime = 0;
  console.log('🧹 [APIClientCache] Invalidated');
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isLegacyScheduleValue(value) {
  return typeof value === 'string' && value.startsWith(LEGACY_SCHEDULE_PREFIX);
}

function decodeLegacySchedule(value) {
  if (!isLegacyScheduleValue(value)) return null;
  try { return JSON.parse(value.slice(LEGACY_SCHEDULE_PREFIX.length)); }
  catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function clearScheduleCache(clientId = null) {
  if (clientId) {
    scheduleCache.delete(clientId);
    console.log(`🧹 Cleared schedule cache for client ${clientId}`);
  } else {
    scheduleCache.clear();
    console.log('🧹 Cleared all schedule cache');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API CLIENT LOOKUP
// ─────────────────────────────────────────────────────────────────────────────

async function getClientFromAPI(clientId) {
  try {
    const clients = await getAllClients();
    const client = clients.find(c => String(c.id) === String(clientId));

    if (!client) {
      console.log(`⚠️ Client ${clientId} not found in API`);
      return null;
    }

    return {
      ClientID: client.id,
      ClientName: client.name || `Client ${clientId}`,
      ClientEmail: client.email || '',
      Status: client.active ? 1 : 0,
    };
  } catch (error) {
    console.error(`❌ API lookup failed for client ${clientId}: ${error.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHIFT TYPE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getShiftHours(shiftType) {
  const normalized = shiftType?.toLowerCase() || 'both';
  return SHIFT_HOURS[normalized] || SHIFT_HOURS.both;
}

function getShiftDescription(shiftType) {
  const hours = getShiftHours(shiftType);
  return hours.description;
}

function getShiftLabel(shiftType) {
  const hours = getShiftHours(shiftType);
  return hours.label;
}

function isValidShiftType(shiftType) {
  return shiftType && VALID_SHIFT_TYPES.includes(shiftType.toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME MIGRATION
// ─────────────────────────────────────────────────────────────────────────────

async function migrateLegacyScheduleIfNeeded(clientId, pool) {
  try {
    const result = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT rep_cmail, schedule_config
        FROM   [_Datos].[dbo].[m_reportes_automaticos]
        WHERE  rep_iidcuenta = @clientId
      `);

    if (result.recordset.length === 0) return false;
    const row = result.recordset[0];
    if (!isLegacyScheduleValue(row.rep_cmail)) return false;

    if (row.schedule_config && row.schedule_config.trim().length > 2) {
      await pool.request()
        .input('clientId', sql.Int, clientId)
        .query(`
          UPDATE [_Datos].[dbo].[m_reportes_automaticos]
          SET    rep_cmail = NULL
          WHERE  rep_iidcuenta = @clientId
            AND  rep_cmail LIKE '${LEGACY_SCHEDULE_PREFIX}%'
        `);
      console.log(`🔄 Migration: cleared legacy rep_cmail for client ${clientId}`);
      return true;
    }

    const parsed = decodeLegacySchedule(row.rep_cmail);
    if (!parsed) {
      await pool.request()
        .input('clientId', sql.Int, clientId)
        .query(`
          UPDATE [_Datos].[dbo].[m_reportes_automaticos]
          SET rep_cmail = NULL WHERE rep_iidcuenta = @clientId
        `);
      return false;
    }

    const configJson = JSON.stringify(parsed);
    await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('configJson', sql.NVarChar(sql.MAX), configJson)
      .query(`
        UPDATE [_Datos].[dbo].[m_reportes_automaticos]
        SET    schedule_config = @configJson, rep_cmail = NULL
        WHERE  rep_iidcuenta   = @clientId
      `);

    console.log(`✅ Migration: moved SCHEDULE:: config to schedule_config for client ${clientId}`);
    clearScheduleCache(clientId);
    return true;
  } catch (error) {
    console.error(`❌ Migration error for client ${clientId}: ${error.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE SCHEDULE CONFIG
// ─────────────────────────────────────────────────────────────────────────────

async function getScheduleConfigFromDatabase(clientId) {
  try {
    const pool = await poolPromise;
    await migrateLegacyScheduleIfNeeded(clientId, pool);

    const result = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT schedule_config AS ScheduleConfig, rep_shift_type AS ShiftType
        FROM   [_Datos].[dbo].[m_reportes_automaticos]
        WHERE  rep_iidcuenta   = @clientId
          AND  schedule_config IS NOT NULL
          AND  LEN(schedule_config) > 2
      `);

    if (result.recordset.length === 0) {
      console.log(`📭 No schedule config found for client ${clientId}`);
      return null;
    }

    let parsed;
    try { parsed = JSON.parse(result.recordset[0].ScheduleConfig); }
    catch {
      console.error(`❌ Invalid JSON in schedule_config for client ${clientId}`);
      return null;
    }

    // Ensure shiftType from DB takes precedence if present
    if (result.recordset[0].ShiftType && !parsed.shiftType) {
      parsed.shiftType = result.recordset[0].ShiftType;
    }

    if (parsed.patrolsPerDay === undefined || parsed.patrolsPerDay === null) {
      console.warn(`⚠️ Missing patrolsPerDay for client ${clientId}`);
      return null;
    }

    console.log(`✅ Schedule config for client ${clientId}: ${parsed.patrolsPerDay} patrols/day, shiftType: ${parsed.shiftType ?? 'NOT SET'}`);
    return parsed;
  } catch (error) {
    console.error(`❌ Error reading schedule config for client ${clientId}: ${error.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE SCHEDULE RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

function getDefaultSchedule(clientId) {
  console.warn(
    `🚨 NO CONFIG for client ${clientId}. ` +
    `No API entry and no saved schedule config. Use admin panel to configure.`
  );
  return {
    client_id: clientId,
    client_name: `Client ${clientId}`,
    client_email: '',
    patrols_per_day: null,
    patrol_days: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
    weekend_patrols_per_day: null,
    shift_type: null,
    shift_hours: null,
    shift_description: 'NOT CONFIGURED',
    schedule_type: 'daily',
    custom_interval_days: null,
    weekly_total: null,
    schedule_info: 'NOT CONFIGURED — set patrolsPerDay and shiftType via admin panel',
    is_active: true,
    has_custom_schedule: false,
    config_source: 'not_configured',
    updated_at: null,
  };
}

async function getClientSchedule(clientId, forceRefresh = false) {
  // 1. Per-client in-memory cache
  if (!forceRefresh && scheduleCache.has(clientId)) {
    const cached = scheduleCache.get(clientId);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`📅 [CACHE] Client ${clientId} → ${cached.schedule.patrols_per_day} patrols/day, shiftType: ${cached.schedule.shift_type ?? 'NOT SET'}`);
      return cached.schedule;
    }
  }

  // 2. DB config
  const scheduleConfig = await getScheduleConfigFromDatabase(clientId);

  // 3. API identity
  let client = null;
  try {
    client = await getClientFromAPI(clientId);
  } catch (err) {
    console.warn(`⚠️ API lookup failed for client ${clientId}: ${err.message}`);
  }

  // 4. Neither source
  if (!client && !scheduleConfig) {
    const defaultSchedule = getDefaultSchedule(clientId);
    scheduleCache.set(clientId, { schedule: defaultSchedule, timestamp: Date.now() });
    return defaultSchedule;
  }

  const patrolsPerDay = scheduleConfig?.patrolsPerDay ?? null;
  const patrolDays = scheduleConfig?.patrolDays ?? 'Mon,Tue,Wed,Thu,Fri,Sat,Sun';
  const weekendPatrols = scheduleConfig?.weekendPatrols ?? patrolsPerDay;
  const shiftType = scheduleConfig?.shiftType ?? null;
  const scheduleType = scheduleConfig?.scheduleType ?? 'daily';
  const customIntervalDays = scheduleConfig?.customIntervalDays ?? null;
  const weeklyTotal = calculateWeeklyTotal(patrolsPerDay, weekendPatrols, patrolDays);

  // Get shift hours and description
  const shiftHours = shiftType ? getShiftHours(shiftType) : null;
  const shiftDescription = shiftType ? getShiftDescription(shiftType) : 'NOT CONFIGURED';

  if (!shiftType) {
    console.warn(`⚠️ Client ${clientId} has no shiftType configured — reports will fail until set via admin panel`);
  }

  const schedule = {
    client_id: clientId,
    client_name: client?.ClientName ?? `Client ${clientId}`,
    client_email: client?.ClientEmail ?? '',
    patrols_per_day: patrolsPerDay,
    patrol_days: patrolDays,
    weekend_patrols_per_day: weekendPatrols,
    shift_type: shiftType,
    shift_hours: shiftHours,
    shift_description: shiftDescription,
    schedule_type: scheduleType,
    custom_interval_days: customIntervalDays,
    weekly_total: weeklyTotal,
    schedule_info: patrolsPerDay
      ? `${patrolsPerDay} patrols/day (${weeklyTotal}/week) - ${patrolDays} - ${shiftDescription}`
      : 'NOT CONFIGURED',
    is_active: client ? client.Status === 1 : true,
    has_custom_schedule: !!scheduleConfig,
    config_source: scheduleConfig ? 'schedule_config_column' : 'hardcoded_default',
    updated_at: scheduleConfig?.updatedAt ?? null,
  };

  console.log(
    `📅 Schedule for "${schedule.client_name}" (${clientId}): ` +
    `${patrolsPerDay ?? 'NOT SET'} patrols/day · shiftType: ${shiftType ?? 'NOT SET'} · ${shiftDescription} · source: ${schedule.config_source}`
  );

  scheduleCache.set(clientId, { schedule, timestamp: Date.now() });
  return schedule;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE CONFIG API
// ─────────────────────────────────────────────────────────────────────────────

async function getPatrolScheduleConfig(clientId) {
  try {
    clearScheduleCache(clientId);
    const schedule = await getClientSchedule(clientId, true);
    return {
      success: true,
      data: {
        ClientID: schedule.client_id,
        ClientName: schedule.client_name,
        ClientEmail: schedule.client_email,
        PatrolsPerDay: schedule.patrols_per_day,
        PatrolDays: schedule.patrol_days,
        ScheduleType: schedule.schedule_type,
        WeekendPatrols: schedule.weekend_patrols_per_day,
        CustomIntervalDays: schedule.custom_interval_days,
        ShiftType: schedule.shift_type,
        ShiftHours: schedule.shift_hours,
        ShiftDescription: schedule.shift_description,
        HasCustomSchedule: schedule.has_custom_schedule,
        UpdatedAt: schedule.updated_at,
        ConfigSource: schedule.config_source,
      },
    };
  } catch (error) {
    console.error(`❌ Error fetching patrol schedule config for client ${clientId}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UPSERT - FULLY FIXED with IDENTITY_INSERT OFF
// ─────────────────────────────────────────────────────────────────────────────
async function upsertPatrolSchedule(clientId, scheduleData) {
  try {
    const pool = await poolPromise;

    const {
      patrolsPerDay,
      patrolDays,
      scheduleType = 'daily',
      weekendPatrols,
      customIntervalDays = null,
      shiftType,
    } = scheduleData;

    // Validate patrolsPerDay
    if (patrolsPerDay === undefined || patrolsPerDay === null) {
      return { success: false, error: 'patrolsPerDay is required' };
    }

    const numericPatrolsPerDay = Number(patrolsPerDay);
    if (!Number.isFinite(numericPatrolsPerDay) || numericPatrolsPerDay < 0) {
      return { success: false, error: `patrolsPerDay must be a non-negative number, received: ${patrolsPerDay}` };
    }

    // ✅ Validate shiftType - REQUIRED
    if (!shiftType || !VALID_SHIFT_TYPES.includes(shiftType.toLowerCase())) {
      return {
        success: false,
        error: `shiftType is required and must be one of: ${VALID_SHIFT_TYPES.join(', ')}. Received: ${shiftType ?? 'nothing'}`
      };
    }

    const normalizedShiftType = shiftType.toLowerCase();
    const shiftHours = getShiftHours(normalizedShiftType);
    const shiftDescription = getShiftDescription(normalizedShiftType);

    // Validate client exists
    const apiClient = await getClientFromAPI(clientId);
    if (!apiClient) {
      return { success: false, error: `Client ${clientId} not found in BM Security API` };
    }

    const clientName = apiClient.ClientName;
    const resolvedWeekendPatrols = weekendPatrols ?? numericPatrolsPerDay;

    // Build config JSON with shift details
    const configJson = JSON.stringify({
      patrolsPerDay: numericPatrolsPerDay,
      patrolDays: patrolDays ?? 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
      scheduleType,
      weekendPatrols: resolvedWeekendPatrols,
      customIntervalDays: customIntervalDays ?? null,
      shiftType: normalizedShiftType,
      shiftHours: shiftHours,
      shiftDescription: shiftDescription,
      updatedAt: new Date().toISOString(),
    });

    console.log(`📝 Saving schedule for ${clientName} (ID: ${clientId}): ${numericPatrolsPerDay} patrols/day, shiftType: ${normalizedShiftType} (${shiftDescription})`);

    // 🔥 CRITICAL FIX: Use a single connection for both commands
    const connection = await pool.connect();

    try {
      // Execute SET IDENTITY_INSERT OFF on the same connection
      await connection.request().query(`
        SET IDENTITY_INSERT _Datos.dbo.m_reportes_automaticos OFF
      `);

      // Check if a schedule exists for this client + shiftType
      const existing = await connection.request()
        .input('clientId', sql.Int, clientId)
        .input('shiftType', sql.VarChar(10), normalizedShiftType)
        .query(`
          SELECT rep_iidcuenta, rep_cmail, rep_idKey
          FROM   [_Datos].[dbo].[m_reportes_automaticos]
          WHERE  rep_iidcuenta = @clientId AND rep_shift_type = @shiftType
        `);

      if (existing.recordset.length > 0) {
        // ✅ UPDATE existing schedule for this shift type
        const currentMail = existing.recordset[0].rep_cmail;
        const clearLegacy = isLegacyScheduleValue(currentMail);

        await connection.request()
          .input('clientId', sql.Int, clientId)
          .input('configJson', sql.NVarChar(sql.MAX), configJson)
          .input('shiftType', sql.VarChar(10), normalizedShiftType)
          .query(`
            UPDATE [_Datos].[dbo].[m_reportes_automaticos]
            SET    schedule_config = @configJson,
                   rep_shift_type  = @shiftType
                 ${clearLegacy ? ', rep_cmail = NULL' : ''}
            WHERE  rep_iidcuenta = @clientId AND rep_shift_type = @shiftType
          `);

        if (clearLegacy) console.log(`🔄 Cleared legacy SCHEDULE:: from rep_cmail for client ${clientId}`);
        console.log(`✅ Updated ${normalizedShiftType} schedule for ${clientName} (ID: ${clientId})`);
      } else {
        // ✅ CREATE new schedule with ALL required fields
        // NOTE: rep_idKey is NOT included - SQL Server auto-generates it
        await connection.request()
          .input('clientId', sql.Int, clientId)
          .input('configJson', sql.NVarChar(sql.MAX), configJson)
          .input('frequency', sql.Int, 1)
          .input('intervalDays', sql.Int, 1)
          .input('nextRun', sql.DateTime, new Date())
          .input('shiftType', sql.VarChar(10), normalizedShiftType)
          .input('email', sql.VarChar(4000), null)
          .query(`
            INSERT INTO [_Datos].[dbo].[m_reportes_automaticos]
              (rep_iidcuenta, schedule_config, rep_nfrecuencia, rep_nCadaUnidadTiempo, 
               rep_tproximoenvio, rep_shift_type, rep_cmail)
            VALUES
              (@clientId, @configJson, @frequency, @intervalDays, 
               @nextRun, @shiftType, @email)
          `);
        console.log(`✅ Created ${normalizedShiftType} schedule for ${clientName} (ID: ${clientId})`);
      }

      // Verify the save
      const verify = await connection.request()
        .input('clientId', sql.Int, clientId)
        .input('shiftType', sql.VarChar(10), normalizedShiftType)
        .query(`
          SELECT schedule_config, rep_cmail, rep_shift_type, rep_idKey 
          FROM [_Datos].[dbo].[m_reportes_automaticos] 
          WHERE rep_iidcuenta = @clientId AND rep_shift_type = @shiftType
        `);

      const savedConfig = verify.recordset[0]?.schedule_config ?? null;
      const savedEmail = verify.recordset[0]?.rep_cmail ?? null;
      const savedShift = verify.recordset[0]?.rep_shift_type ?? null;
      const savedId = verify.recordset[0]?.rep_idKey ?? null;

      if (!savedConfig) {
        console.error(`❌ VERIFY FAILED — schedule_config NULL after save for client ${clientId}`);
      } else {
        console.log(`✅ VERIFY OK for client ${clientId} (ID: ${savedId}, shiftType: ${savedShift})`);
      }

      if (savedEmail && isLegacyScheduleValue(savedEmail)) {
        console.error(`❌ VERIFY MISMATCH — rep_cmail still has SCHEDULE:: for client ${clientId}`);
      }

      clearScheduleCache(clientId);

      return {
        success: true,
        message: `Schedule saved for ${clientName}: ${numericPatrolsPerDay} patrols/day, shiftType: ${normalizedShiftType} (${shiftDescription})`,
        data: JSON.parse(configJson),
        scheduleId: savedId,
        columnUsed: 'schedule_config (dedicated column)',
        shiftHours: shiftHours,
      };
    } finally {
      // Always release the connection back to the pool
      connection.release();
    }
  } catch (error) {
    console.error(`❌ Error saving schedule for client ${clientId}:`, error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────────

async function deletePatrolSchedule(clientId) {
  try {
    const pool = await poolPromise;

    const existing = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT rep_iidcuenta, schedule_config, rep_shift_type
        FROM   [_Datos].[dbo].[m_reportes_automaticos]
        WHERE  rep_iidcuenta   = @clientId
          AND  schedule_config IS NOT NULL
          AND  LEN(schedule_config) > 2
      `);

    if (existing.recordset.length === 0)
      return { success: false, error: 'No patrol schedule found for this client' };

    const apiClient = await getClientFromAPI(clientId);
    const clientName = apiClient?.ClientName ?? `Client ${clientId}`;
    const shiftType = existing.recordset[0].rep_shift_type || 'unknown';

    await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        UPDATE [_Datos].[dbo].[m_reportes_automaticos]
        SET    schedule_config = NULL
        WHERE  rep_iidcuenta   = @clientId
      `);

    clearScheduleCache(clientId);
    console.log(`✅ Deleted schedule for ${clientName} (ID: ${clientId}, shiftType: ${shiftType})`);
    return { success: true, message: `Schedule deleted for ${clientName}` };
  } catch (error) {
    console.error(`❌ Error deleting schedule for client ${clientId}:`, error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL / NOTIFICATION PREFERENCES
// ─────────────────────────────────────────────────────────────────────────────

async function getClientEmailPreferences(clientId) {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT
          rep_cmail             AS ReportEmail,
          rep_nfrecuencia       AS Frequency,
          rep_nCadaUnidadTiempo AS IntervalDays,
          rep_tproximoenvio     AS NextRun,
          rep_shift_type        AS ShiftType
        FROM [_Datos].[dbo].[m_reportes_automaticos]
        WHERE rep_iidcuenta = @clientId
          AND (
            rep_cmail IS NULL
            OR rep_cmail NOT LIKE '${LEGACY_SCHEDULE_PREFIX}%'
          )
      `);
    return result.recordset.length > 0 ? result.recordset[0] : null;
  } catch (error) {
    console.error(`❌ Error fetching email preferences for client ${clientId}:`, error);
    return null;
  }
}

async function updateClientEmailPreferences(clientId, preferences) {
  try {
    const pool = await poolPromise;
    const { email, frequency, intervalDays, nextRun, shiftType } = preferences;

    // 🔥 CRITICAL FIX: Ensure identity insert is OFF
    await pool.request().query(`
      SET IDENTITY_INSERT _Datos.dbo.m_reportes_automaticos OFF
    `);

    if (typeof email === 'string' && email.startsWith(LEGACY_SCHEDULE_PREFIX))
      return { success: false, error: 'Invalid email address' };

    // Check if schedule exists for this client + shiftType
    const existing = await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('shiftType', sql.VarChar(10), shiftType || null)
      .query(`
        SELECT rep_cmail, schedule_config, rep_shift_type 
        FROM [_Datos].[dbo].[m_reportes_automaticos] 
        WHERE rep_iidcuenta = @clientId 
        ${shiftType ? 'AND rep_shift_type = @shiftType' : ''}
      `);

    if (existing.recordset[0]) {
      await pool.request()
        .input('clientId', sql.Int, clientId)
        .input('email', sql.VarChar(4000), email)
        .input('frequency', sql.Int, frequency)
        .input('intervalDays', sql.Int, intervalDays)
        .input('nextRun', sql.DateTime, nextRun)
        .input('shiftType', sql.VarChar(10), shiftType || null)
        .query(`
          UPDATE [_Datos].[dbo].[m_reportes_automaticos]
          SET rep_cmail = @email, 
              rep_nfrecuencia = @frequency,
              rep_nCadaUnidadTiempo = @intervalDays, 
              rep_tproximoenvio = @nextRun
          WHERE rep_iidcuenta = @clientId
          ${shiftType ? 'AND rep_shift_type = @shiftType' : ''}
        `);
      console.log(`✅ Updated email preferences for client ${clientId} (shiftType: ${shiftType || 'any'})`);
    } else {
      // Create new schedule with email preferences
      await pool.request()
        .input('clientId', sql.Int, clientId)
        .input('email', sql.VarChar(4000), email)
        .input('frequency', sql.Int, frequency)
        .input('intervalDays', sql.Int, intervalDays)
        .input('nextRun', sql.DateTime, nextRun)
        .input('shiftType', sql.VarChar(10), shiftType || 'both')
        .query(`
          INSERT INTO [_Datos].[dbo].[m_reportes_automaticos]
            (rep_iidcuenta, rep_cmail, rep_nfrecuencia, rep_nCadaUnidadTiempo, rep_tproximoenvio, rep_shift_type)
          VALUES (@clientId, @email, @frequency, @intervalDays, @nextRun, @shiftType)
        `);
      console.log(`✅ Inserted email preferences for client ${clientId} (shiftType: ${shiftType || 'both'})`);
    }

    clearScheduleCache(clientId);
    return { success: true };
  } catch (error) {
    console.error(`❌ Error updating email preferences for client ${clientId}:`, error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATROL DATA
// ─────────────────────────────────────────────────────────────────────────────

async function getClientPatrols(clientId, daysRange = 30) {
  try {
    const pool = await poolPromise;
    const startDate = dayjs().subtract(daysRange, 'day').format('YYYY-MM-DD 00:00:00');
    const endDate = dayjs().format('YYYY-MM-DD 23:59:59');

    console.log(`📊 Fetching patrols for client ${clientId}, last ${daysRange} days`);

    const result = await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('startDate', sql.DateTime, startDate)
      .input('endDate', sql.DateTime, endDate)
      .query(`
        SELECT
          rec_iid            AS PatrolID,
          rec_tfechahora     AS PatrolDate,
          rec_czona          AS ZoneCode,
          rec_calarma        AS AlarmType,
          rec_cContenido     AS Content,
          rec_cObservaciones AS Observations,
          zon.zon_cdescripcion AS ZoneName
        FROM [_Datos].[dbo].[p_recepcion] rec
        LEFT JOIN [_Datos].[dbo].[m_zonas] zon
          ON rec.rec_iidcuenta = zon.zon_iidcuenta
         AND rec.rec_czona     = zon.zon_ccodigo
        WHERE rec.rec_iidcuenta = @clientId
          AND rec.rec_tfechahora BETWEEN @startDate AND @endDate
        ORDER BY rec.rec_tfechahora DESC
      `);

    const patrols = result.recordset;
    const totalPatrols = patrols.length;
    const completedPatrols = patrols.filter(p =>
      p.AlarmType?.includes('Login') ||
      p.AlarmType?.includes('Arrival') ||
      p.Content?.includes('Completed')
    ).length;

    const complianceRate = totalPatrols > 0
      ? `${Math.round((completedPatrols / totalPatrols) * 100)}%` : '0%';
    const schedule = await getClientSchedule(clientId);
    const expectedPatrols = calculateExpectedPatrols(schedule, daysRange);
    const scheduleCompliance = expectedPatrols > 0
      ? `${Math.round((totalPatrols / expectedPatrols) * 100)}%` : '0%';

    console.log(`📈 Client ${clientId}: ${totalPatrols}/${expectedPatrols} patrols (${scheduleCompliance})`);

    return {
      pastPatrols: patrols,
      upcomingPatrols: [],
      summary: {
        totalCompleted: totalPatrols,
        completedPatrols,
        expectedPatrols,
        complianceRate,
        scheduleCompliance,
        performance: getPerformanceRating(scheduleCompliance),
        dailyAverage: (totalPatrols / daysRange).toFixed(1),
        zonesCovered: [...new Set(patrols.map(p => p.ZoneCode))].length,
      },
      analytics: {
        periodDays: daysRange,
        startDate,
        endDate,
        zones: getZoneAnalytics(patrols),
        timeDistribution: getTimeDistribution(patrols),
        scheduleUsed: {
          patrolsPerDay: schedule.patrols_per_day,
          patrolDays: schedule.patrol_days,
          weekendPatrols: schedule.weekend_patrols_per_day,
          shiftType: schedule.shift_type,
          shiftDescription: schedule.shift_description,
          configSource: schedule.config_source,
        },
      },
    };
  } catch (error) {
    console.error(`❌ Error fetching patrols for client ${clientId}:`, error);
    return {
      pastPatrols: [],
      upcomingPatrols: [],
      summary: {
        totalCompleted: 0,
        completedPatrols: 0,
        expectedPatrols: 0,
        complianceRate: '0%',
        scheduleCompliance: '0%',
        performance: 'Poor',
        dailyAverage: '0',
        zonesCovered: 0,
      },
      analytics: {
        periodDays: daysRange,
        startDate: dayjs().subtract(daysRange, 'day').format('YYYY-MM-DD'),
        endDate: dayjs().format('YYYY-MM-DD'),
        zones: [],
        timeDistribution: {},
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK / ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

async function listAllSchedules() {
  try {
    const apiClients = await getAllClients();

    const filtered = apiClients.filter(c => {
      const name = (c.name || '').toUpperCase();
      return (
        c.active && c.name &&
        c.name !== 'Unknown Client' &&
        !name.includes('CONFIGURACION') &&
        !name.includes('RESERVADA') &&
        !name.includes('PRUEBA') &&
        !name.includes('TEST')
      );
    });

    console.log(`📋 ${filtered.length} active clients (${apiClients.length} total from cache)`);

    const BATCH_SIZE = 25;
    const enhanced = [];

    for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
      const batch = filtered.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (apiClient) => {
          try {
            const schedule = await getClientSchedule(apiClient.id, false);
            return {
              ClientID: apiClient.id,
              ClientName: schedule.client_name,
              ClientEmail: schedule.client_email,
              PatrolsPerDay: schedule.patrols_per_day,
              WeekendPatrols: schedule.weekend_patrols_per_day,
              PatrolDays: schedule.patrol_days,
              ShiftType: schedule.shift_type,
              ShiftDescription: schedule.shift_description,
              ScheduleType: schedule.schedule_type,
              CustomIntervalDays: schedule.custom_interval_days,
              Status: apiClient.active ? 1 : 0,
              WeeklyTotal: schedule.weekly_total,
              ScheduleInfo: schedule.schedule_info,
              IsActive: schedule.is_active,
              HasCustomSchedule: schedule.has_custom_schedule,
              ConfigSource: schedule.config_source,
              UpdatedAt: schedule.updated_at,
              AccountNumber: apiClient.accountNumber,
              Phone: apiClient.phone,
              Address: apiClient.address,
              City: apiClient.city,
            };
          } catch (err) {
            console.error(`❌ Error processing client ${apiClient.id}: ${err.message}`);
            return null;
          }
        })
      );

      enhanced.push(...batchResults.filter(Boolean));

      if (i + BATCH_SIZE < filtered.length) {
        console.log(`  📋 Processed ${Math.min(i + BATCH_SIZE, filtered.length)}/${filtered.length} clients`);
      }
    }

    console.log(`📋 Schedule list built for ${enhanced.length} clients`);
    return enhanced;
  } catch (error) {
    console.error('❌ Error listing clients:', error);
    return [];
  }
}

async function getClientAnalytics(clientId, daysRange = 30) {
  try {
    clearScheduleCache(clientId);
    const schedule = await getClientSchedule(clientId, true);
    const patrolData = await getClientPatrols(clientId, daysRange);

    const weekdays = Math.floor(daysRange * 5 / 7);
    const weekends = daysRange - weekdays;
    const expectedPatrols =
      (schedule.patrols_per_day * weekdays) +
      (schedule.weekend_patrols_per_day * weekends);
    const actualPatrols = patrolData.pastPatrols.length;
    const complianceRate = expectedPatrols > 0
      ? ((actualPatrols / expectedPatrols) * 100).toFixed(1) : 0;

    return {
      clientId,
      clientName: schedule.client_name,
      schedule,
      patrolData,
      analytics: {
        periodDays: daysRange,
        expectedPatrols: Math.round(expectedPatrols),
        actualPatrols,
        complianceRate: `${complianceRate}%`,
        dailyAverage: (actualPatrols / daysRange).toFixed(1),
        weeklyAverage: (actualPatrols / (daysRange / 7)).toFixed(1),
        performance:
          complianceRate >= 90 ? 'Excellent' :
          complianceRate >= 80 ? 'Good' :
          complianceRate >= 70 ? 'Fair' : 'Poor',
        zonesCovered: patrolData.analytics.zones.length,
        timeDistribution: patrolData.analytics.timeDistribution,
        scheduleUsed: {
          patrolsPerDay: schedule.patrols_per_day,
          patrolDays: schedule.patrol_days,
          weekendPatrols: schedule.weekend_patrols_per_day,
          shiftType: schedule.shift_type,
          shiftDescription: schedule.shift_description,
          configSource: schedule.config_source,
        },
      },
    };
  } catch (error) {
    console.error(`❌ Error getting analytics for client ${clientId}:`, error);
    return null;
  }
}

async function getAllClientsWithPerformance(daysRange = 7) {
  try {
    const clients = await listAllSchedules();
    const results = [];
    for (const client of clients) {
      try {
        const analytics = await getClientAnalytics(client.ClientID, daysRange);
        if (analytics) {
          results.push({
            ...client,
            performance: analytics.analytics,
            lastUpdated: dayjs().format('YYYY-MM-DD HH:mm:ss'),
          });
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Error processing client ${client.ClientID}:`, error.message);
      }
    }
    console.log(`✅ Processed ${results.length} clients`);
    return results;
  } catch (error) {
    console.error('❌ Error getting clients with performance:', error);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function getDueClients() {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .query(`
        SELECT
          R.rep_iidcuenta         AS ClientID,
          R.rep_cmail             AS Email,
          R.rep_tproximoenvio     AS NextRun,
          R.rep_nfrecuencia       AS Frequency,
          R.rep_nCadaUnidadTiempo AS IntervalDays,
          R.rep_shift_type        AS ShiftType
        FROM [_Datos].[dbo].[m_reportes_automaticos] R
        WHERE
          R.rep_cmail IS NOT NULL
          AND R.rep_cmail NOT LIKE '${LEGACY_SCHEDULE_PREFIX}%'
          AND R.rep_tproximoenvio IS NOT NULL
          AND R.rep_tproximoenvio <= GETDATE()
      `);

    const rows = result.recordset || [];
    if (rows.length === 0) { console.log('📅 No clients due for reporting'); return []; }

    const apiClients = await getAllClients();
    const clientMap = new Map(apiClients.map(c => [String(c.id), c]));

    return rows
      .map(row => {
        const apiClient = clientMap.get(String(row.ClientID));
        if (!apiClient) {
          console.warn(`⚠️ Due client ${row.ClientID} not in API — skipping`);
          return null;
        }
        const shiftDesc = row.ShiftType ? getShiftDescription(row.ShiftType) : 'NOT SET';
        return {
          ...row,
          ClientName: apiClient.name || `Client ${row.ClientID}`,
          ShiftDescription: shiftDesc,
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.error('❌ Error fetching due clients:', error);
    return [];
  }
}

async function updateNextRun(clientId, frequency, intervalDays, currentNextRun) {
  try {
    const pool = await poolPromise;
    let newNextRun = dayjs(currentNextRun).tz(TZ);

    switch (frequency) {
      case 1: newNextRun = newNextRun.add(intervalDays ?? 1, 'day'); break;
      case 2: newNextRun = newNextRun.add(7 * (intervalDays ?? 1), 'day'); break;
      case 3: newNextRun = newNextRun.add(intervalDays ?? 1, 'month'); break;
      default: return { success: false, error: 'Invalid frequency value' };
    }

    await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('nextRun', sql.DateTime, newNextRun.toDate())
      .query(`
        UPDATE [_Datos].[dbo].[m_reportes_automaticos]
        SET    rep_tproximoenvio = @nextRun
        WHERE  rep_iidcuenta = @clientId
      `);

    console.log(`📅 Next run for client ${clientId}: ${newNextRun.format('YYYY-MM-DD HH:mm')}`);
    return { success: true, nextRun: newNextRun.toDate() };
  } catch (error) {
    console.error(`❌ Error updating next run for client ${clientId}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE CALCULATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function calculateWeeklyTotal(weekdayPatrols, weekendPatrols, patrolDays) {
  const days = patrolDays.split(',').map(d => d.trim().toLowerCase());
  return days.reduce((total, day) =>
    total + (day === 'sat' || day === 'sun' ? weekendPatrols : weekdayPatrols), 0);
}

function calculateExpectedPatrols(schedule, daysRange) {
  const patrolDays = schedule.patrol_days.split(',').map(d => d.trim().toLowerCase());
  const weekdayPatrols = schedule.patrols_per_day;
  const weekendPatrols = schedule.weekend_patrols_per_day;
  let expected = 0;
  let currentDate = dayjs().subtract(daysRange, 'day');
  const endDate = dayjs();

  while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, 'day')) {
    const dow = currentDate.format('ddd').toLowerCase();
    if (patrolDays.includes(dow)) {
      expected += (dow === 'sat' || dow === 'sun') ? weekendPatrols : weekdayPatrols;
    }
    currentDate = currentDate.add(1, 'day');
  }
  return expected;
}

function getPerformanceRating(complianceRate) {
  const rate = parseInt(complianceRate) || 0;
  if (rate >= 90) return 'Excellent';
  if (rate >= 80) return 'Good';
  if (rate >= 70) return 'Fair';
  return 'Poor';
}

function getZoneAnalytics(patrols) {
  const zoneMap = new Map();
  patrols.forEach(patrol => {
    const key = patrol.ZoneCode || 'Unknown';
    if (!zoneMap.has(key)) {
      zoneMap.set(key, { zoneCode: key, zoneName: patrol.ZoneName || key, patrolCount: 0, lastPatrol: null });
    }
    const zone = zoneMap.get(key);
    zone.patrolCount++;
    const d = dayjs(patrol.PatrolDate);
    if (!zone.lastPatrol || d.isAfter(zone.lastPatrol)) zone.lastPatrol = d;
  });
  return Array.from(zoneMap.values()).sort((a, b) => b.patrolCount - a.patrolCount);
}

function getTimeDistribution(patrols) {
  const dist = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  patrols.forEach(patrol => {
    const hour = dayjs(patrol.PatrolDate).hour();
    if (hour >= 6 && hour < 12) dist.morning++;
    else if (hour >= 12 && hour < 18) dist.afternoon++;
    else if (hour >= 18 && hour < 24) dist.evening++;
    else dist.night++;
  });
  return dist;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  getClientPatrols,
  getClientSchedule,
  listAllSchedules,
  getClientAnalytics,
  getAllClientsWithPerformance,
  getClientEmailPreferences,
  updateClientEmailPreferences,
  getDueClients,
  updateNextRun,
  upsertPatrolSchedule,
  deletePatrolSchedule,
  getPatrolScheduleConfig,
  clearScheduleCache,
  migrateLegacyScheduleIfNeeded,
  invalidateAPIClientsCache,
  VALID_SHIFT_TYPES,
  getShiftHours,
  getShiftDescription,
  getShiftLabel,
  isValidShiftType,
};

module.exports.default = module.exports;