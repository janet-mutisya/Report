// server/scripts/managePatrolSchedules.js - FIXED NO DUPLICATE EXPORTS
import sql from 'mssql';
import { poolPromise } from '../config/database.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// Enable timezone support
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

/**
 * 🔧 Get client patrols from database with enhanced analytics
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

    // Get client schedule to calculate expected patrols
    const schedule = await getClientSchedule(clientId);
    const expectedPatrols = calculateExpectedPatrols(schedule, daysRange);
    const scheduleCompliance = expectedPatrols > 0 ? 
      `${Math.round((totalPatrols / expectedPatrols) * 100)}%` : '0%';

    console.log(`📈 Client ${clientId}: ${totalPatrols}/${expectedPatrols} patrols (${scheduleCompliance} compliance)`);

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
        timeDistribution: getTimeDistribution(patrols)
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
 */
async function getClientSchedule(clientId) {
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
      return getDefaultSchedule(clientId);
    }

    const client = clientResult.recordset[0];

    // Try to get stored schedule configuration from rep_cmail
    const scheduleResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT rep_cmail AS ScheduleConfig
        FROM [_Datos].[dbo].[m_reportes_automaticos]
        WHERE rep_iidcuenta = @clientId
      `);

    let scheduleConfig = null;
    let usedColumn = 'none';
    
    if (scheduleResult.recordset.length > 0 && scheduleResult.recordset[0].ScheduleConfig) {
      try {
        scheduleConfig = JSON.parse(scheduleResult.recordset[0].ScheduleConfig);
        usedColumn = 'rep_cmail';
      } catch (parseError) {
        // If it's not JSON, it's probably a regular email address
        console.log(`📧 rep_cmail contains email address, not schedule config for client ${clientId}`);
      }
    }

    // Use stored config or defaults
    const patrolsPerDay = scheduleConfig?.patrolsPerDay || 11;
    const patrolDays = scheduleConfig?.patrolDays || "Mon,Tue,Wed,Thu,Fri,Sat,Sun";
    const weekendPatrols = scheduleConfig?.weekendPatrols || 11;
    const shiftType = scheduleConfig?.shiftType || "Day/Night";
    
    const weeklyTotal = calculateWeeklyTotal(patrolsPerDay, weekendPatrols, patrolDays);
    
    console.log(`📅 Client ${client.ClientName} (ID: ${clientId}): ${patrolsPerDay} patrols/day, ${patrolDays} [Config from: ${usedColumn}]`);
    
    return {
      client_id: clientId,
      client_name: client.ClientName,
      client_email: client.ClientEmail,
      patrols_per_day: patrolsPerDay,
      patrol_days: patrolDays,
      weekend_patrols_per_day: weekendPatrols,
      shift_type: shiftType,
      weekly_total: weeklyTotal,
      schedule_info: `${patrolsPerDay} patrols/day (${weeklyTotal}/week) - ${patrolDays}`,
      is_active: client.Status === 1,
      has_custom_schedule: !!scheduleConfig,
      config_source: usedColumn
    };
  } catch (error) {
    console.error(`❌ Error fetching schedule for client ${clientId}:`, error.message);
    return getDefaultSchedule(clientId);
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
    weekly_total: 77,
    schedule_info: "11 patrols/day (77/week) - Mon,Tue,Wed,Thu,Fri,Sat,Sun",
    is_active: true,
    has_custom_schedule: false,
    config_source: 'default'
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
 */
async function listAllSchedules() {
  try {
    const pool = await poolPromise;
    
    // Get all clients with their schedule configurations from rep_cmail
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

    const enhancedClients = result.recordset.map(client => {
      let scheduleConfig = null;
      let configSource = 'none';
      
      // Try to parse from rep_cmail
      if (client.ScheduleConfig) {
        try {
          scheduleConfig = JSON.parse(client.ScheduleConfig);
          configSource = 'rep_cmail';
        } catch (parseError) {
          // If it's not JSON, it's probably a regular email address
          console.log(`📧 Client ${client.ClientID}: rep_cmail contains email, not schedule config`);
        }
      }

      // Use stored config or defaults
      const patrolsPerDay = scheduleConfig?.patrolsPerDay || 11;
      const weekendPatrols = scheduleConfig?.weekendPatrols || 11;
      const patrolDays = scheduleConfig?.patrolDays || "Mon,Tue,Wed,Thu,Fri,Sat,Sun";
      const shiftType = scheduleConfig?.shiftType || "Day/Night";
      const scheduleType = scheduleConfig?.scheduleType || "daily";
      const customIntervalDays = scheduleConfig?.customIntervalDays || null;
      
      const weeklyTotal = calculateWeeklyTotal(patrolsPerDay, weekendPatrols, patrolDays);
      
      return {
        ClientID: client.ClientID,
        ClientName: client.ClientName,
        ClientEmail: client.ClientEmail,
        PatrolsPerDay: patrolsPerDay,
        WeekendPatrols: weekendPatrols,
        PatrolDays: patrolDays,
        ShiftType: shiftType,
        ScheduleType: scheduleType,
        CustomIntervalDays: customIntervalDays,
        Status: client.Status,
        WeeklyTotal: weeklyTotal,
        ScheduleInfo: `${patrolsPerDay} patrols/day (${weeklyTotal}/week) - ${patrolDays}`,
        IsActive: client.Status === 1,
        HasCustomSchedule: !!scheduleConfig,
        ConfigSource: configSource
      };
    });

    console.log(`📋 Found ${enhancedClients.length} clients`);
    return enhancedClients;
  } catch (error) {
    console.error('❌ Error listing clients:', error);
    return [];
  }
}

/**
 * 🔧 Get client analytics with patrol calculations
 */
async function getClientAnalytics(clientId, daysRange = 30) {
  try {
    const schedule = await getClientSchedule(clientId);
    const patrolData = await getClientPatrols(clientId, daysRange);
    
    const totalDays = daysRange;
    const weekdays = Math.floor(totalDays * 5/7);
    const weekends = totalDays - weekdays;
    
    const expectedPatrols = (schedule.patrols_per_day * weekdays) + (schedule.weekend_patrols_per_day * weekends);
    const actualPatrols = patrolData.pastPatrols.length;
    const complianceRate = expectedPatrols > 0 ? ((actualPatrols / expectedPatrols) * 100).toFixed(1) : 0;

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
        timeDistribution: patrolData.analytics.timeDistribution
      }
    };
  } catch (error) {
    console.error(`❌ Error getting analytics for client ${clientId}:`, error);
    return null;
  }
}

/**
 * 🔧 Get all clients with their current performance metrics
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
 * FIXED: Using rep_cmail column to store JSON config
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
 * FIXED: Using rep_cmail column
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
 * FIXED: Using rep_cmail column to retrieve config
 */
async function getPatrolScheduleConfig(clientId) {
  try {
    const pool = await poolPromise;
    
    console.log(`📋 Fetching patrol schedule config for client ${clientId}`);
    
    const result = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          R.rep_cmail AS ScheduleConfig,
          C.cue_iid AS ClientID,
          C.cue_cnombre AS ClientName,
          C.cue_cemail AS ClientEmail
        FROM [_Datos].[dbo].[m_cuentas] C
        LEFT JOIN [_Datos].[dbo].[m_reportes_automaticos] R
          ON C.cue_iid = R.rep_iidcuenta
        WHERE C.cue_iid = @clientId
      `);

    if (result.recordset.length === 0) {
      return { 
        success: false, 
        error: 'Client not found' 
      };
    }

    const record = result.recordset[0];
    let scheduleConfig = null;
    let configSource = 'none';

    // Try to parse from rep_cmail
    if (record.ScheduleConfig) {
      try {
        scheduleConfig = JSON.parse(record.ScheduleConfig);
        configSource = 'rep_cmail';
        console.log(`✅ Found custom schedule for client ${clientId} in rep_cmail`);
      } catch (parseError) {
        // If it's not JSON, it might be a regular email address
        console.log(`📧 rep_cmail contains email, not schedule config: ${record.ScheduleConfig}`);
      }
    }

    if (!scheduleConfig) {
      console.log(`📋 No custom schedule found for client ${clientId}, using defaults`);
    }

    // Use stored config or defaults
    const schedule = {
      ClientID: record.ClientID,
      ClientName: record.ClientName,
      ClientEmail: record.ClientEmail,
      PatrolsPerDay: scheduleConfig?.patrolsPerDay || 11,
      PatrolDays: scheduleConfig?.patrolDays || 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
      ScheduleType: scheduleConfig?.scheduleType || 'daily',
      WeekendPatrols: scheduleConfig?.weekendPatrols || 11,
      CustomIntervalDays: scheduleConfig?.customIntervalDays || null,
      ShiftType: scheduleConfig?.shiftType || 'Day/Night',
      HasCustomSchedule: !!scheduleConfig,
      UpdatedAt: scheduleConfig?.updatedAt || null,
      ConfigSource: configSource
    };

    return { 
      success: true, 
      data: schedule 
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
  getPatrolScheduleConfig
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
  getPatrolScheduleConfig
};