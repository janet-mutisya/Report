// server/scripts/managePatrolSchedules.js - FIXED WITH CONSISTENT CONFIGURATION USAGE
import sql from 'mssql';
import { poolPromise } from '../config/database.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// Enable timezone support
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

// Configuration cache to reduce database queries
const scheduleCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * 🔧 Clear schedule cache for a specific client
 */
function clearScheduleCache(clientId = null) {
  if (clientId) {
    scheduleCache.delete(clientId);
    console.log(`🧹 Cleared schedule cache for client ${clientId}`);
  } else {
    scheduleCache.clear();
    console.log('🧹 Cleared all schedule cache');
  }
}

/**
 * 🔧 Get client patrols from database with enhanced analytics
 * FIXED: Now uses stored schedule configuration for calculations
 */
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
          rec_iid AS PatrolID,
          rec_tfechahora AS PatrolDate,
          rec_czona AS ZoneCode,
          rec_calarma AS AlarmType,
          rec_cContenido AS Content,
          rec_cObservaciones AS Observations,
          zon.zon_cdescripcion AS ZoneName
        FROM [_Datos].[dbo].[p_recepcion] rec
        LEFT JOIN [_Datos].[dbo].[m_zonas] zon
          ON rec.rec_iidcuenta = zon.zon_iidcuenta
          AND rec.rec_czona = zon.zon_ccodigo
        WHERE rec.rec_iidcuenta = @clientId
          AND rec.rec_tfechahora BETWEEN @startDate AND @endDate
        ORDER BY rec.rec_tfechahora DESC
      `);

    const patrols = result.recordset;
    
    // Calculate enhanced analytics
    const totalPatrols = patrols.length;
    const completedPatrols = patrols.filter(p => 
      p.AlarmType?.includes('Login') || 
      p.AlarmType?.includes('Arrival') ||
      p.Content?.includes('Completed')
    ).length;
    
    const complianceRate = totalPatrols > 0 ? 
      `${Math.round((completedPatrols / totalPatrols) * 100)}%` : '0%';

    // Get client schedule to calculate expected patrols - FIXED: Uses stored config
    const schedule = await getClientSchedule(clientId);
    const expectedPatrols = calculateExpectedPatrols(schedule, daysRange);
    const scheduleCompliance = expectedPatrols > 0 ? 
      `${Math.round((totalPatrols / expectedPatrols) * 100)}%` : '0%';

    console.log(`📈 Client ${clientId}: ${totalPatrols}/${expectedPatrols} patrols (${scheduleCompliance} compliance)`);
    console.log(`   Using schedule: ${schedule.patrols_per_day} patrols/day on ${schedule.patrol_days}`);

    return {
      pastPatrols: patrols,
      upcomingPatrols: [],
      summary: {
        totalCompleted: totalPatrols,
        completedPatrols: completedPatrols,
        expectedPatrols: expectedPatrols,
        complianceRate: complianceRate,
        scheduleCompliance: scheduleCompliance,
        performance: getPerformanceRating(scheduleCompliance),
        dailyAverage: (totalPatrols / daysRange).toFixed(1),
        zonesCovered: [...new Set(patrols.map(p => p.ZoneCode))].length
      },
      analytics: {
        periodDays: daysRange,
        startDate: startDate,
        endDate: endDate,
        zones: getZoneAnalytics(patrols),
        timeDistribution: getTimeDistribution(patrols),
        scheduleUsed: {
          patrolsPerDay: schedule.patrols_per_day,
          patrolDays: schedule.patrol_days,
          weekendPatrols: schedule.weekend_patrols_per_day,
          configSource: schedule.config_source
        }
      }
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
        zonesCovered: 0
      },
      analytics: {
        periodDays: daysRange,
        startDate: dayjs().subtract(daysRange, 'day').format('YYYY-MM-DD'),
        endDate: dayjs().format('YYYY-MM-DD'),
        zones: [],
        timeDistribution: {}
      }
    };
  }
}

/**
 * 🔧 Get client schedule from database with proper fallbacks
 * FIXED: Added caching and consistent configuration fetching
 */
async function getClientSchedule(clientId, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh && scheduleCache.has(clientId)) {
    const cached = scheduleCache.get(clientId);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`📅 Using cached schedule for client ${clientId}`);
      return cached.schedule;
    }
  }

  try {
    const pool = await poolPromise;
    
    // First get client info
    const clientResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          cue_iid AS ClientID,
          cue_cnombre AS ClientName,
          cue_cemail AS ClientEmail,
          cue_nmostrar AS Status
        FROM [_Datos].[dbo].[m_cuentas]
        WHERE cue_iid = @clientId
      `);

    if (clientResult.recordset.length === 0) {
      console.log(`📅 Client ${clientId} not found`);
      const defaultSchedule = getDefaultSchedule(clientId);
      scheduleCache.set(clientId, { schedule: defaultSchedule, timestamp: Date.now() });
      return defaultSchedule;
    }

    const client = clientResult.recordset[0];

    // FIXED: Get schedule configuration from rep_cmail
    const scheduleConfig = await getScheduleConfigFromDatabase(clientId);
    
    // Use stored config or defaults
    const patrolsPerDay = scheduleConfig?.patrolsPerDay || 11;
    const patrolDays = scheduleConfig?.patrolDays || "Mon,Tue,Wed,Thu,Fri,Sat,Sun";
    const weekendPatrols = scheduleConfig?.weekendPatrols || 11;
    const shiftType = scheduleConfig?.shiftType || "Day/Night";
    const scheduleType = scheduleConfig?.scheduleType || "daily";
    const customIntervalDays = scheduleConfig?.customIntervalDays || null;
    
    const weeklyTotal = calculateWeeklyTotal(patrolsPerDay, weekendPatrols, patrolDays);
    
    const schedule = {
      client_id: clientId,
      client_name: client.ClientName,
      client_email: client.ClientEmail,
      patrols_per_day: patrolsPerDay,
      patrol_days: patrolDays,
      weekend_patrols_per_day: weekendPatrols,
      shift_type: shiftType,
      schedule_type: scheduleType,
      custom_interval_days: customIntervalDays,
      weekly_total: weeklyTotal,
      schedule_info: `${patrolsPerDay} patrols/day (${weeklyTotal}/week) - ${patrolDays}`,
      is_active: client.Status === 1,
      has_custom_schedule: !!scheduleConfig,
      config_source: scheduleConfig ? 'rep_cmail' : 'default',
      updated_at: scheduleConfig?.updatedAt || null
    };

    console.log(`📅 Client ${client.ClientName} (ID: ${clientId}):`);
    console.log(`   - Patrols/day: ${patrolsPerDay}`);
    console.log(`   - Days: ${patrolDays}`);
    console.log(`   - Weekend patrols: ${weekendPatrols}`);
    console.log(`   - Has custom schedule: ${!!scheduleConfig}`);
    console.log(`   - Config source: ${scheduleConfig ? 'rep_cmail' : 'default'}`);

    // Cache the schedule
    scheduleCache.set(clientId, { schedule, timestamp: Date.now() });
    
    return schedule;
  } catch (error) {
    console.error(`❌ Error fetching schedule for client ${clientId}:`, error.message);
    const defaultSchedule = getDefaultSchedule(clientId);
    scheduleCache.set(clientId, { schedule: defaultSchedule, timestamp: Date.now() });
    return defaultSchedule;
  }
}

/**
 * 🔧 Helper function to get schedule configuration from database
 */
async function getScheduleConfigFromDatabase(clientId) {
  try {
    const pool = await poolPromise;
    
    const result = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT rep_cmail AS ScheduleConfig
        FROM [_Datos].[dbo].[m_reportes_automaticos]
        WHERE rep_iidcuenta = @clientId
          AND rep_cmail IS NOT NULL
      `);

    if (result.recordset.length === 0 || !result.recordset[0].ScheduleConfig) {
      return null;
    }

    const scheduleConfig = result.recordset[0].ScheduleConfig;
    
    try {
      const parsed = JSON.parse(scheduleConfig);
      // Validate that this is our schedule config, not a regular email
      if (parsed.patrolsPerDay !== undefined) {
        return parsed;
      } else {
        console.log(`⚠️ Found JSON in rep_cmail but not a schedule config for client ${clientId}`);
        return null;
      }
    } catch (parseError) {
      // If it's not JSON, it's probably a regular email address
      console.log(`📧 rep_cmail contains email address, not schedule config for client ${clientId}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error fetching schedule config for client ${clientId}:`, error.message);
    return null;
  }
}

/**
 * 🔧 Default schedule fallback
 */
function getDefaultSchedule(clientId) {
  const defaultSchedule = {
    client_id: clientId,
    client_name: `Client ${clientId}`,
    client_email: '',
    patrols_per_day: 11,
    patrol_days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
    weekend_patrols_per_day: 11,
    shift_type: "Day/Night",
    schedule_type: "daily",
    custom_interval_days: null,
    weekly_total: 77,
    schedule_info: "11 patrols/day (77/week) - Mon,Tue,Wed,Thu,Fri,Sat,Sun",
    is_active: true,
    has_custom_schedule: false,
    config_source: 'default',
    updated_at: null
  };
  
  console.log(`⚙️ Using default schedule for client ${clientId}`);
  return defaultSchedule;
}

/**
 * 🔧 Calculate weekly total patrols based on client requirements
 */
function calculateWeeklyTotal(weekdayPatrols, weekendPatrols, patrolDays) {
  const days = patrolDays.split(',').map(day => day.trim().toLowerCase());
  let weeklyTotal = 0;
  
  days.forEach(day => {
    if (day === 'sat' || day === 'sun' || day.includes('weekend')) {
      weeklyTotal += weekendPatrols;
    } else {
      weeklyTotal += weekdayPatrols;
    }
  });
  
  return weeklyTotal;
}

/**
 * 🔧 Calculate expected patrols based on schedule and period
 * FIXED: Uses actual schedule configuration
 */
function calculateExpectedPatrols(schedule, daysRange) {
  const patrolDays = schedule.patrol_days.split(',').map(day => day.trim().toLowerCase());
  const weekdayPatrols = schedule.patrols_per_day;
  const weekendPatrols = schedule.weekend_patrols_per_day;
  
  let expected = 0;
  let currentDate = dayjs().subtract(daysRange, 'day');
  const endDate = dayjs();
  
  while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, 'day')) {
    const dayOfWeek = currentDate.format('ddd').toLowerCase();
    if (patrolDays.includes(dayOfWeek)) {
      if (dayOfWeek === 'sat' || dayOfWeek === 'sun') {
        expected += weekendPatrols;
      } else {
        expected += weekdayPatrols;
      }
    }
    currentDate = currentDate.add(1, 'day');
  }
  
  return expected;
}

/**
 * 🔧 Get performance rating based on compliance
 */
function getPerformanceRating(complianceRate) {
  const rate = parseInt(complianceRate) || 0;
  if (rate >= 90) return 'Excellent';
  if (rate >= 80) return 'Good';
  if (rate >= 70) return 'Fair';
  return 'Poor';
}

/**
 * 🔧 Get zone analytics from patrol data
 */
function getZoneAnalytics(patrols) {
  const zoneMap = new Map();
  
  patrols.forEach(patrol => {
    const zoneKey = patrol.ZoneCode || 'Unknown';
    if (!zoneMap.has(zoneKey)) {
      zoneMap.set(zoneKey, {
        zoneCode: zoneKey,
        zoneName: patrol.ZoneName || zoneKey,
        patrolCount: 0,
        lastPatrol: null
      });
    }
    
    const zone = zoneMap.get(zoneKey);
    zone.patrolCount++;
    
    const patrolDate = dayjs(patrol.PatrolDate);
    if (!zone.lastPatrol || patrolDate.isAfter(zone.lastPatrol)) {
      zone.lastPatrol = patrolDate;
    }
  });
  
  return Array.from(zoneMap.values())
    .sort((a, b) => b.patrolCount - a.patrolCount);
}

/**
 * 🔧 Get time distribution analytics
 */
function getTimeDistribution(patrols) {
  const distribution = {
    morning: 0,    // 06:00 - 12:00
    afternoon: 0,  // 12:00 - 18:00
    evening: 0,    // 18:00 - 24:00
    night: 0       // 00:00 - 06:00
  };
  
  patrols.forEach(patrol => {
    const hour = dayjs(patrol.PatrolDate).hour();
    
    if (hour >= 6 && hour < 12) distribution.morning++;
    else if (hour >= 12 && hour < 18) distribution.afternoon++;
    else if (hour >= 18 && hour < 24) distribution.evening++;
    else distribution.night++;
  });
  
  return distribution;
}

/**
 * 🔧 List all clients with their schedules
 * FIXED: Now properly uses stored configuration
 */
async function listAllSchedules() {
  try {
    const pool = await poolPromise;
    
    console.log('📋 Fetching all clients with schedule configurations...');
    
    const result = await pool.request().query(`
      SELECT 
        C.cue_iid AS ClientID,
        C.cue_cnombre AS ClientName,
        C.cue_cemail AS ClientEmail,
        C.cue_nmostrar AS Status,
        R.rep_cmail AS ScheduleConfig
      FROM [_Datos].[dbo].[m_cuentas] C
      LEFT JOIN [_Datos].[dbo].[m_reportes_automaticos] R
        ON C.cue_iid = R.rep_iidcuenta
      WHERE C.cue_nmostrar IN (1, 2)
        AND C.cue_cnombre IS NOT NULL
        AND C.cue_cnombre != ''
        AND C.cue_cnombre NOT LIKE '%CONFIGURACION%'
        AND C.cue_cnombre NOT LIKE '%RESERVADA%'
        AND C.cue_cnombre NOT LIKE '%PRUEBA%'
        AND C.cue_cnombre NOT LIKE '%TEST%'
      ORDER BY C.cue_cnombre
    `);

    const enhancedClients = await Promise.all(result.recordset.map(async (client) => {
      // Clear cache for this client to ensure fresh data
      clearScheduleCache(client.ClientID);
      
      // Get full schedule with proper configuration
      const schedule = await getClientSchedule(client.ClientID, true); // Force refresh
      
      return {
        ClientID: client.ClientID,
        ClientName: schedule.client_name,
        ClientEmail: schedule.client_email,
        PatrolsPerDay: schedule.patrols_per_day,
        WeekendPatrols: schedule.weekend_patrols_per_day,
        PatrolDays: schedule.patrol_days,
        ShiftType: schedule.shift_type,
        ScheduleType: schedule.schedule_type,
        CustomIntervalDays: schedule.custom_interval_days,
        Status: client.Status,
        WeeklyTotal: schedule.weekly_total,
        ScheduleInfo: schedule.schedule_info,
        IsActive: schedule.is_active,
        HasCustomSchedule: schedule.has_custom_schedule,
        ConfigSource: schedule.config_source,
        UpdatedAt: schedule.updated_at
      };
    }));

    console.log(`📋 Found ${enhancedClients.length} clients with schedules`);
    return enhancedClients;
  } catch (error) {
    console.error('❌ Error listing clients:', error);
    return [];
  }
}

/**
 * 🔧 Get client analytics with patrol calculations
 * FIXED: Uses stored schedule configuration consistently
 */
async function getClientAnalytics(clientId, daysRange = 30) {
  try {
    // Clear cache to ensure fresh data
    clearScheduleCache(clientId);
    
    const schedule = await getClientSchedule(clientId, true);
    const patrolData = await getClientPatrols(clientId, daysRange);
    
    const totalDays = daysRange;
    const weekdays = Math.floor(totalDays * 5/7);
    const weekends = totalDays - weekdays;
    
    const expectedPatrols = (schedule.patrols_per_day * weekdays) + (schedule.weekend_patrols_per_day * weekends);
    const actualPatrols = patrolData.pastPatrols.length;
    const complianceRate = expectedPatrols > 0 ? ((actualPatrols / expectedPatrols) * 100).toFixed(1) : 0;

    console.log(`📊 Analytics for ${schedule.client_name}:`);
    console.log(`   - Expected: ${expectedPatrols} patrols`);
    console.log(`   - Actual: ${actualPatrols} patrols`);
    console.log(`   - Compliance: ${complianceRate}%`);
    console.log(`   - Schedule used: ${schedule.patrols_per_day} patrols/day on ${schedule.patrol_days}`);

    return {
      clientId: clientId,
      clientName: schedule.client_name,
      schedule: schedule,
      patrolData: patrolData,
      analytics: {
        periodDays: daysRange,
        expectedPatrols: Math.round(expectedPatrols),
        actualPatrols: actualPatrols,
        complianceRate: `${complianceRate}%`,
        dailyAverage: (actualPatrols / totalDays).toFixed(1),
        weeklyAverage: (actualPatrols / (totalDays / 7)).toFixed(1),
        performance: complianceRate >= 90 ? 'Excellent' : 
                    complianceRate >= 80 ? 'Good' : 
                    complianceRate >= 70 ? 'Fair' : 'Poor',
        zonesCovered: patrolData.analytics.zones.length,
        timeDistribution: patrolData.analytics.timeDistribution,
        scheduleUsed: {
          patrolsPerDay: schedule.patrols_per_day,
          patrolDays: schedule.patrol_days,
          weekendPatrols: schedule.weekend_patrols_per_day,
          configSource: schedule.config_source
        }
      }
    };
  } catch (error) {
    console.error(`❌ Error getting analytics for client ${clientId}:`, error);
    return null;
  }
}

/**
 * 🔧 Get all clients with their current performance metrics
 * FIXED: Uses stored schedule configuration
 */
async function getAllClientsWithPerformance(daysRange = 7) {
  try {
    const clients = await listAllSchedules();
    const clientsWithPerformance = [];
    
    console.log(`📊 Getting performance metrics for ${clients.length} clients...`);
    
    for (const client of clients) {
      try {
        const analytics = await getClientAnalytics(client.ClientID, daysRange);
        if (analytics) {
          clientsWithPerformance.push({
            ...client,
            performance: analytics.analytics,
            lastUpdated: dayjs().format('YYYY-MM-DD HH:mm:ss')
          });
        }
        
        // Small delay to prevent overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Error processing client ${client.ClientID}:`, error.message);
      }
    }
    
    console.log(`✅ Successfully processed ${clientsWithPerformance.length} clients`);
    return clientsWithPerformance;
  } catch (error) {
    console.error('❌ Error getting clients with performance:', error);
    return [];
  }
}

/**
 * 🔧 Get client email preferences
 */
async function getClientEmailPreferences(clientId) {
  try {
    const pool = await poolPromise;
    
    const result = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          rep_cmail AS ReportEmail,
          rep_nfrecuencia AS Frequency,
          rep_nCadaUnidadTiempo AS IntervalDays,
          rep_tproximoenvio AS NextRun
        FROM [_Datos].[dbo].[m_reportes_automaticos]
        WHERE rep_iidcuenta = @clientId
      `);

    if (result.recordset.length > 0) {
      return result.recordset[0];
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Error fetching email preferences for client ${clientId}:`, error);
    return null;
  }
}

/**
 * 🔧 Update client email preferences
 */
async function updateClientEmailPreferences(clientId, preferences) {
  try {
    const pool = await poolPromise;
    
    const { email, frequency, intervalDays, nextRun } = preferences;
    
    const result = await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('email', sql.VarChar(255), email)
      .input('frequency', sql.Int, frequency)
      .input('intervalDays', sql.Int, intervalDays)
      .input('nextRun', sql.DateTime, nextRun)
      .query(`
        IF EXISTS (SELECT 1 FROM [_Datos].[dbo].[m_reportes_automaticos] WHERE rep_iidcuenta = @clientId)
          UPDATE [_Datos].[dbo].[m_reportes_automaticos]
          SET 
            rep_cmail = @email,
            rep_nfrecuencia = @frequency,
            rep_nCadaUnidadTiempo = @intervalDays,
            rep_tproximoenvio = @nextRun
          WHERE rep_iidcuenta = @clientId
        ELSE
          INSERT INTO [_Datos].[dbo].[m_reportes_automaticos] 
          (rep_iidcuenta, rep_cmail, rep_nfrecuencia, rep_nCadaUnidadTiempo, rep_tproximoenvio)
          VALUES (@clientId, @email, @frequency, @intervalDays, @nextRun)
      `);

    console.log(`✅ Updated email preferences for client ${clientId}`);
    clearScheduleCache(clientId); // Clear cache after update
    
    return { success: true, rowsAffected: result.rowsAffected[0] };
  } catch (error) {
    console.error(`❌ Error updating email preferences for client ${clientId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 🔧 Get clients due for reporting
 */
async function getDueClients() {
  try {
    const pool = await poolPromise;
    
    const result = await pool.request().query(`
      SELECT 
        R.rep_iidcuenta AS ClientID,
        C.cue_cnombre AS ClientName,
        R.rep_cmail AS Email,
        R.rep_tproximoenvio AS NextRun,
        R.rep_nfrecuencia AS Frequency,
        R.rep_nCadaUnidadTiempo AS IntervalDays
      FROM [_Datos].[dbo].[m_reportes_automaticos] R
      INNER JOIN [_Datos].[dbo].[m_cuentas] C
        ON R.rep_iidcuenta = C.cue_iid
      WHERE 
        R.rep_cmail IS NOT NULL
        AND R.rep_tproximoenvio IS NOT NULL
        AND R.rep_tproximoenvio <= GETDATE()
        AND C.cue_nmostrar IN (1, 2)
    `);

    const dueClients = result.recordset || [];
    console.log(`📅 Found ${dueClients.length} clients due for reporting`);
    
    return dueClients;
  } catch (error) {
    console.error('❌ Error fetching due clients:', error);
    return [];
  }
}

/**
 * 🔧 Update next run for a client
 */
async function updateNextRun(clientId, frequency, intervalDays, currentNextRun) {
  try {
    const pool = await poolPromise;
    
    let newNextRun = dayjs(currentNextRun).tz(TZ);

    switch (frequency) {
      case 1: // Daily
        newNextRun = newNextRun.add(intervalDays || 1, "day");
        break;
      case 2: // Weekly
        newNextRun = newNextRun.add(7 * (intervalDays || 1), "day");
        break;
      case 3: // Monthly
        newNextRun = newNextRun.add(intervalDays || 1, "month");
        break;
      default:
        newNextRun = null;
    }

    if (newNextRun) {
      await pool.request()
        .input("clientId", sql.Int, clientId)
        .input("nextRun", sql.DateTime, newNextRun.toDate())
        .query(`
          UPDATE [_Datos].[dbo].[m_reportes_automaticos]
          SET rep_tproximoenvio = @nextRun
          WHERE rep_iidcuenta = @clientId
        `);
      
      console.log(`📅 Updated next run for client ${clientId}: ${newNextRun.format("YYYY-MM-DD HH:mm")}`);
      return { success: true, nextRun: newNextRun.toDate() };
    }
    
    return { success: false, error: 'Invalid frequency or interval' };
  } catch (error) {
    console.error(`❌ Error updating next run for client ${clientId}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 🔧 Create or Update patrol schedule for a client
 * FIXED: Now properly stores and clears cache
 */
async function upsertPatrolSchedule(clientId, scheduleData) {
  try {
    const pool = await poolPromise;
    
    const {
      patrolsPerDay,
      patrolDays,
      scheduleType = 'daily',
      weekendPatrols,
      customIntervalDays,
      shiftType = 'Day/Night'
    } = scheduleData;

    console.log(`📝 Upserting patrol schedule for client ${clientId}:`, scheduleData);

    // Validate client exists
    const clientCheck = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT cue_iid, cue_cnombre 
        FROM [_Datos].[dbo].[m_cuentas] 
        WHERE cue_iid = @clientId
      `);

    if (clientCheck.recordset.length === 0) {
      return { 
        success: false, 
        error: 'Client not found' 
      };
    }

    const clientName = clientCheck.recordset[0].cue_cnombre;

    // Create schedule configuration JSON
    const scheduleConfig = JSON.stringify({
      patrolsPerDay: patrolsPerDay || 11,
      patrolDays: patrolDays || 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
      scheduleType: scheduleType,
      weekendPatrols: weekendPatrols || patrolsPerDay || 11,
      customIntervalDays: customIntervalDays || null,
      shiftType: shiftType,
      updatedAt: new Date().toISOString()
    });

    console.log(`📋 Schedule config JSON: ${scheduleConfig}`);

    // Check if record already exists in m_reportes_automaticos
    const existingSchedule = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT rep_iidcuenta 
        FROM [_Datos].[dbo].[m_reportes_automaticos] 
        WHERE rep_iidcuenta = @clientId
      `);

    // Use rep_cmail column to store our JSON configuration
    const configColumn = 'rep_cmail';

    if (existingSchedule.recordset.length > 0) {
      // Update existing record - using rep_cmail column
      const result = await pool.request()
        .input('clientId', sql.Int, clientId)
        .input('scheduleConfig', sql.VarChar(sql.MAX), scheduleConfig)
        .query(`
          UPDATE [_Datos].[dbo].[m_reportes_automaticos]
          SET ${configColumn} = @scheduleConfig
          WHERE rep_iidcuenta = @clientId
        `);
      
      console.log(`✅ Updated patrol schedule for client ${clientId} (${clientName}) using column: ${configColumn}`);
      console.log(`   Rows affected: ${result.rowsAffected[0]}`);
    } else {
      // Insert new record - using rep_cmail column
      const result = await pool.request()
        .input('clientId', sql.Int, clientId)
        .input('scheduleConfig', sql.VarChar(sql.MAX), scheduleConfig)
        .input('frequency', sql.Int, 1)
        .input('intervalDays', sql.Int, 1)
        .input('nextRun', sql.DateTime, new Date())
        .query(`
          INSERT INTO [_Datos].[dbo].[m_reportes_automaticos] 
          (rep_iidcuenta, ${configColumn}, rep_nfrecuencia, rep_nCadaUnidadTiempo, rep_tproximoenvio)
          VALUES (@clientId, @scheduleConfig, @frequency, @intervalDays, @nextRun)
        `);
      
      console.log(`✅ Created patrol schedule for client ${clientId} (${clientName}) using column: ${configColumn}`);
      console.log(`   Rows affected: ${result.rowsAffected[0]}`);
    }

    // Clear cache to ensure fresh data on next fetch
    clearScheduleCache(clientId);

    return { 
      success: true, 
      message: `Patrol schedule saved successfully for ${clientName}`,
      data: JSON.parse(scheduleConfig),
      columnUsed: configColumn
    };
  } catch (error) {
    console.error(`❌ Error upserting patrol schedule for client ${clientId}:`, error);
    
    // Provide more specific error message
    let errorMessage = error.message;
    if (error.message.includes('Invalid column name')) {
      errorMessage = `Database column name issue: ${error.message}. Please check the table schema.`;
    }
    
    return { 
      success: false, 
      error: errorMessage 
    };
  }
}

/**
 * 🔧 Delete patrol schedule for a client
 * FIXED: Now properly clears cache
 */
async function deletePatrolSchedule(clientId) {
  try {
    const pool = await poolPromise;

    console.log(`🗑️ Deleting patrol schedule for client ${clientId}`);

    // Check if schedule exists in rep_cmail
    const existingSchedule = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT rep_iidcuenta, rep_cmail 
        FROM [_Datos].[dbo].[m_reportes_automaticos] 
        WHERE rep_iidcuenta = @clientId
          AND rep_cmail IS NOT NULL
      `);

    if (existingSchedule.recordset.length === 0) {
      return { 
        success: false, 
        error: 'Schedule not found for this client' 
      };
    }

    // Get client name for logging
    const clientResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT cue_cnombre AS ClientName
        FROM [_Datos].[dbo].[m_cuentas]
        WHERE cue_iid = @clientId
      `);

    const clientName = clientResult.recordset[0]?.ClientName || `Client ${clientId}`;

    // Check if the content is actually our JSON config (not a regular email)
    const record = existingSchedule.recordset[0];
    let isOurConfig = false;
    
    if (record.rep_cmail) {
      try {
        const parsed = JSON.parse(record.rep_cmail);
        isOurConfig = parsed.patrolsPerDay !== undefined;
      } catch (e) {
        // Not JSON, probably a regular email
        isOurConfig = false;
      }
    }

    if (!isOurConfig) {
      return { 
        success: false, 
        error: 'No patrol schedule configuration found (rep_cmail contains email address)' 
      };
    }

    // Clear the schedule configuration from rep_cmail
    await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        UPDATE [_Datos].[dbo].[m_reportes_automaticos]
        SET rep_cmail = NULL
        WHERE rep_iidcuenta = @clientId
      `);

    // Clear cache
    clearScheduleCache(clientId);
    
    console.log(`✅ Deleted patrol schedule for client ${clientId} (${clientName})`);
    
    return { 
      success: true, 
      message: `Patrol schedule deleted successfully for ${clientName}` 
    };
  } catch (error) {
    console.error(`❌ Error deleting patrol schedule for client ${clientId}:`, error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * 🔧 Get patrol schedule with stored configuration
 * FIXED: Now properly clears and uses cache
 */
async function getPatrolScheduleConfig(clientId) {
  try {
    // Clear cache to ensure fresh data
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
        HasCustomSchedule: schedule.has_custom_schedule,
        UpdatedAt: schedule.updated_at,
        ConfigSource: schedule.config_source
      }
    };
  } catch (error) {
    console.error(`❌ Error fetching patrol schedule config for client ${clientId}:`, error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Single export block - no duplicates
export {
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
  clearScheduleCache
};

// Default export
export default {
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
  clearScheduleCache
};