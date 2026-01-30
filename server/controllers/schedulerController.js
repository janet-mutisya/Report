// server/controllers/schedulerController.js - COMPLETELY REWRITTEN AND FIXED
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');
const weekOfYear = require('dayjs/plugin/weekOfYear.js');
const isoWeek = require('dayjs/plugin/isoWeek.js');
const { sql, poolPromise } = require('../config/database.js');

// ✅ Import the optimized report model
const { fetchWeeklyReport } = require('../models/reportModel.js');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

// =====================================================
// 🛡️ DUPLICATE REPORT PREVENTION
// =====================================================
const inProgressReports = new Set();
const REPORT_COOLDOWN_MS = 120000; // 2 minutes

// =====================================================
// 📅 DATE RANGE FUNCTIONS
// =====================================================

/**
 * Calculate nights in range for night shift reporting
 */
const calculateNightsInRange = (startDate, endDate) => {
  try {
    const start = dayjs(startDate, 'YYYY-MM-DD').startOf('day');
    const end = dayjs(endDate, 'YYYY-MM-DD').startOf('day');
    return end.diff(start, 'day') + 1;
  } catch (error) {
    console.error(`❌ Error calculating nights in range:`, error.message);
    return dayjs(endDate, 'YYYY-MM-DD').diff(dayjs(startDate, 'YYYY-MM-DD'), 'day') + 1;
  }
};

/**
 * Get database query dates for night shifts (18:00-06:00)
 */
const getDatabaseQueryDates = (startDate, endDate) => {
  try {
    const start = dayjs.tz(startDate, 'YYYY-MM-DD', TZ);
    const end = dayjs.tz(endDate, 'YYYY-MM-DD', TZ);
    
    const nairobiStartTime = start.set('hour', 18).set('minute', 0).set('second', 0);
    const nairobiEndTime = end.add(1, 'day').set('hour', 6).set('minute', 0).set('second', 0);
    
    // Nairobi (UTC+3) → CST (UTC-6) = subtract 9 hours
    const cstStartTime = nairobiStartTime.subtract(9, 'hour');
    const cstEndTime = nairobiEndTime.subtract(9, 'hour');
    
    const nightsCount = calculateNightsInRange(startDate, endDate);
    
    return {
      dbStartDate: cstStartTime.format('YYYY-MM-DD HH:mm:ss'),
      dbEndDate: cstEndTime.format('YYYY-MM-DD HH:mm:ss'),
      displayStartDate: start.format('YYYY-MM-DD'),
      displayEndDate: end.format('YYYY-MM-DD'),
      nightsCount: nightsCount,
      totalHours: cstEndTime.diff(cstStartTime, 'hour')
    };
  } catch (error) {
    console.error(`❌ Error calculating database query dates:`, error.message);
    
    const fallbackStart = dayjs(startDate + ' 18:00:00').subtract(9, 'hour');
    const fallbackEnd = dayjs(endDate).add(1, 'day').format('YYYY-MM-DD') + ' 06:00:00';
    
    return {
      dbStartDate: fallbackStart.format('YYYY-MM-DD HH:mm:ss'),
      dbEndDate: dayjs(fallbackEnd).subtract(9, 'hour').format('YYYY-MM-DD HH:mm:ss'),
      displayStartDate: startDate,
      displayEndDate: endDate,
      nightsCount: calculateNightsInRange(startDate, endDate)
    };
  }
};

// ✅ FIXED: Create local date range functions
const getLast7DaysRange = () => {
  const end = dayjs().tz(TZ);
  const start = end.subtract(6, 'day');
  const nightsInRange = calculateNightsInRange(
    start.format('YYYY-MM-DD'),
    end.format('YYYY-MM-DD')
  );
  
  const dbDates = getDatabaseQueryDates(
    start.format('YYYY-MM-DD'),
    end.format('YYYY-MM-DD')
  );
  
  return {
    startDate: start.format('YYYY-MM-DD'),
    endDate: end.format('YYYY-MM-DD'),
    sqlStartDate: dbDates.dbStartDate,
    sqlEndDate: dbDates.dbEndDate,
    rangeLabel: `Last 7 Days: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`,
    nightsInRange: nightsInRange,
    daysInRange: nightsInRange,
    periodType: 'last7days'
  };
};

const getPreviousWeekRange = () => {
  const today = dayjs().tz(TZ);
  const end = today.subtract(7, 'day');
  const start = today.subtract(13, 'day');
  const nightsInRange = calculateNightsInRange(
    start.format('YYYY-MM-DD'),
    end.format('YYYY-MM-DD')
  );
  
  const dbDates = getDatabaseQueryDates(
    start.format('YYYY-MM-DD'),
    end.format('YYYY-MM-DD')
  );
  
  return {
    startDate: start.format('YYYY-MM-DD'),
    endDate: end.format('YYYY-MM-DD'),
    sqlStartDate: dbDates.dbStartDate,
    sqlEndDate: dbDates.dbEndDate,
    rangeLabel: `Previous Week: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`,
    nightsInRange: nightsInRange,
    daysInRange: nightsInRange,
    periodType: 'previousWeek'
  };
};

const getCurrentWeekRange = () => {
  const today = dayjs().tz(TZ);
  const end = today;
  const start = today.subtract(6, 'day');
  const nightsInRange = calculateNightsInRange(
    start.format('YYYY-MM-DD'),
    end.format('YYYY-MM-DD')
  );
  
  const dbDates = getDatabaseQueryDates(
    start.format('YYYY-MM-DD'),
    end.format('YYYY-MM-DD')
  );
  
  return {
    startDate: start.format('YYYY-MM-DD'),
    endDate: end.format('YYYY-MM-DD'),
    sqlStartDate: dbDates.dbStartDate,
    sqlEndDate: dbDates.dbEndDate,
    rangeLabel: `Current Week: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`,
    nightsInRange: nightsInRange,
    daysInRange: nightsInRange,
    periodType: 'currentWeek'
  };
};

// Fallback functions
const getTodayRange = () => getPreviousWeekRange();
const getYesterdayRange = () => getPreviousWeekRange();
const getLast30DaysRange = () => getPreviousWeekRange();
const getPreviousMonthRange = () => getPreviousWeekRange();
const getCurrentMonthRange = () => getPreviousWeekRange();

const getCustomDateRange = (startDate, endDate) => {
  try {
    if (!startDate || !endDate) {
      throw new Error('Start date and end date are required for custom range');
    }
    
    const start = dayjs(startDate).tz(TZ);
    const end = dayjs(endDate).tz(TZ);
    
    if (!start.isValid() || !end.isValid()) {
      throw new Error('Invalid date format');
    }
    
    if (end.isBefore(start)) {
      throw new Error('End date must be after start date');
    }
    
    const nightsInRange = calculateNightsInRange(
      start.format('YYYY-MM-DD'), 
      end.format('YYYY-MM-DD')
    );
    
    const dbDates = getDatabaseQueryDates(
      start.format('YYYY-MM-DD'),
      end.format('YYYY-MM-DD')
    );
    
    return {
      startDate: start.format('YYYY-MM-DD'),
      endDate: end.format('YYYY-MM-DD'),
      sqlStartDate: dbDates.dbStartDate,
      sqlEndDate: dbDates.dbEndDate,
      rangeLabel: `Custom: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`,
      nightsInRange: nightsInRange,
      daysInRange: nightsInRange,
      periodType: 'custom'
    };
  } catch (error) {
    console.error('❌ Error calculating custom range:', error);
    throw error;
  }
};

const getHistoricalDateRange = (options = {}) => {
  try {
    const today = dayjs().tz(TZ);
    const { monthsBack = null, specificMonth = null, startDate = null, endDate = null } = options;
    
    let finalStartDate, finalEndDate;

    if (startDate && endDate) {
      return getCustomDateRange(startDate, endDate);
    }
    
    if (specificMonth) {
      finalStartDate = dayjs(specificMonth).startOf('month');
      finalEndDate = dayjs(specificMonth).endOf('month');
    } else if (monthsBack) {
      finalStartDate = today.subtract(monthsBack, 'month').startOf('month');
      finalEndDate = today;
    } else {
      finalStartDate = today.startOf('month');
      finalEndDate = today;
    }

    const nightsInRange = calculateNightsInRange(
      finalStartDate.format('YYYY-MM-DD'), 
      finalEndDate.format('YYYY-MM-DD')
    );
    
    const dbDates = getDatabaseQueryDates(
      finalStartDate.format('YYYY-MM-DD'),
      finalEndDate.format('YYYY-MM-DD')
    );
    
    return {
      sqlStartDate: dbDates.dbStartDate,
      sqlEndDate: dbDates.dbEndDate,
      displayStartDate: finalStartDate.format('YYYY-MM-DD'),
      displayEndDate: finalEndDate.format('YYYY-MM-DD'),
      startDate: finalStartDate.format('YYYY-MM-DD'),
      endDate: finalEndDate.format('YYYY-MM-DD'),
      rangeLabel: specificMonth 
        ? `Month: ${finalStartDate.format('MMMM YYYY')}`
        : monthsBack
        ? `Last ${monthsBack} months`
        : `Current Month: ${finalStartDate.format('MMMM YYYY')}`,
      nightsInRange: nightsInRange,
      daysInRange: nightsInRange,
      periodType: 'historical'
    };
  } catch (error) {
    console.error('❌ Error calculating historical range:', error);
    const today = dayjs().tz(TZ);
    return {
      startDate: today.subtract(1, 'month').format('YYYY-MM-DD'),
      endDate: today.format('YYYY-MM-DD'),
      sqlStartDate: today.subtract(1, 'month').format('YYYY-MM-DD') + ' 18:00:00',
      sqlEndDate: today.add(1, 'day').format('YYYY-MM-DD') + ' 06:00:00',
      rangeLabel: 'Last Month (Fallback)',
      nightsInRange: 30,
      daysInRange: 30,
      periodType: 'historical'
    };
  }
};

const getDateRangeForPeriod = (reportPeriod, customStart = null, customEnd = null) => {
  console.log(`🎯 Getting date range for period: ${reportPeriod}`);
  
  switch (reportPeriod) {
    case 'today':
      return getTodayRange();
    case 'yesterday':
      return getYesterdayRange();
    case 'last7days':
      return getLast7DaysRange();
    case 'previousWeek':
      return getPreviousWeekRange();
    case 'currentWeek':
      return getCurrentWeekRange();
    case 'last30days':
      return getLast30DaysRange();
    case 'previousMonth':
      return getPreviousMonthRange();
    case 'currentMonth':
      return getCurrentMonthRange();
    case 'custom':
      if (!customStart || !customEnd) {
        console.warn('⚠️  Custom period requested without dates, falling back to last 7 days');
        return getLast7DaysRange();
      }
      return getCustomDateRange(customStart, customEnd);
    case 'historical':
      return getHistoricalDateRange({ monthsBack: 1 });
    default:
      console.warn(`⚠️  Unknown period '${reportPeriod}', using previous week as default`);
      return getPreviousWeekRange();
  }
};

// =====================================================
// 📧 EMAIL PARSING FUNCTIONS
// =====================================================

const parseEmails = (emailString) => {
  if (!emailString || typeof emailString !== 'string') {
    return [];
  }
  
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = emailString.match(emailRegex) || [];
  
  const uniqueEmails = [...new Set(emails.map(email => email.toLowerCase().trim()))];
  
  const validEmails = uniqueEmails.filter(email => {
    const parts = email.split('@');
    if (parts.length !== 2) return false;
    if (parts[0].length === 0 || parts[1].length === 0) return false;
    if (parts[1].indexOf('.') === -1) return false;
    return true;
  });
  
  return validEmails;
};

const formatEmailsForDisplay = (emailString) => {
  const emails = parseEmails(emailString);
  return emails.map(email => {
    const parts = email.split('@');
    return `${parts[0]}@${parts[1]}`;
  }).join(', ');
};

// =====================================================
// 📊 DATA FETCHING USING OPTIMIZED REPORT MODEL
// =====================================================

/**
 * Fetch patrol data using optimized report model
 */
const getClientPatrols = async (clientId, nightsRange = 7) => {
  try {
    const endDate = dayjs().tz(TZ).format('YYYY-MM-DD');
    const startDate = dayjs().tz(TZ).subtract(nightsRange - 1, 'day').format('YYYY-MM-DD');
    
    console.log(`📊 Fetching patrol data for client ${clientId}`);
    console.log(`   Period: ${startDate} to ${endDate} (${nightsRange} nights)`);
    
    const reportData = await fetchWeeklyReport(
      clientId, 
      startDate, 
      endDate,
      true
    );
    
    if (!reportData.metadata.success) {
      console.warn(`⚠️ Report data fetch failed: ${reportData.metadata.error?.message || 'Unknown error'}`);
      return {
        pastPatrols: [],
        guardReports: [],
        posts: [],
        metadata: reportData.metadata
      };
    }
    
    console.log(`✅ Report data loaded successfully:`, {
      posts: reportData.posts.length,
      events: reportData.events.length,
      guardReports: reportData.guardReports.length,
      performance: `${reportData.metadata.overallPerformance}%`,
      dataSource: reportData.metadata.dataSource,
      processingTime: `${reportData.metadata.processingTime}ms`
    });
    
    return reportData;
  } catch (error) {
    console.error(`❌ Error fetching patrol data for client ${clientId}:`, error.message);
    
    return {
      pastPatrols: [],
      guardReports: [],
      posts: [],
      metadata: {
        success: false,
        error: error.message,
        dataSource: 'Error',
        processingTime: 0
      }
    };
  }
};

/**
 * Fetch historical patrol data using optimized report model
 */
const getClientHistoricalPatrols = async (clientId, startDate, endDate) => {
  try {
    console.log(`📋 Fetching historical patrol data for client ${clientId}`);
    console.log(`   Period: ${startDate} to ${endDate}`);
    
    const reportData = await fetchWeeklyReport(
      clientId, 
      startDate, 
      endDate,
      true
    );
    
    if (!reportData.metadata.success) {
      console.warn(`⚠️ Historical report data fetch failed: ${reportData.metadata.error?.message || 'Unknown error'}`);
      return {
        pastPatrols: [],
        guardReports: [],
        posts: [],
        metadata: reportData.metadata
      };
    }
    
    console.log(`✅ Historical report data loaded:`, {
      posts: reportData.posts.length,
      events: reportData.events.length,
      guardReports: reportData.guardReports.length,
      dataSource: reportData.metadata.dataSource
    });
    
    return reportData;
  } catch (error) {
    console.error(`❌ Error fetching historical patrol data:`, error.message);
    
    return {
      pastPatrols: [],
      guardReports: [],
      posts: [],
      metadata: {
        success: false,
        error: error.message,
        dataSource: 'Error',
        processingTime: 0
      }
    };
  }
};

// =====================================================
// 🎯 SCHEDULE MANAGEMENT CONTROLLERS
// =====================================================

const getAllSchedules = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        R.rep_idKey,
        R.rep_iidcuenta AS ClientID,
        C.cue_cnombre AS ClientName,
        C.cue_cemail AS ClientEmail,
        C.cue_ncuenta AS AccountNumber,
        R.rep_ntipo,
        R.rep_tproximoenvio AS NextRun,
        R.rep_nfrecuencia AS Frequency,
        R.rep_cmail AS Email,
        R.rep_nCadaUnidadTiempo AS IntervalDays
      FROM _Datos.dbo.m_reportes_automaticos R
      INNER JOIN _Datos.dbo.m_cuentas C ON R.rep_iidcuenta = C.cue_iid
      ORDER BY R.rep_tproximoenvio ASC
    `);

    const schedules = result.recordset.map(schedule => {
      const emails = schedule.Email || '';
      const emailCount = parseEmails(emails).length;
      
      return {
        id: schedule.rep_idKey,
        clientId: schedule.ClientID,
        clientName: schedule.ClientName,
        clientEmail: schedule.ClientEmail,
        accountNumber: schedule.AccountNumber,
        type: schedule.rep_ntipo,
        nextRun: schedule.NextRun,
        frequency: schedule.Frequency,
        email: emails,
        emails: emails,
        intervalDays: schedule.IntervalDays,
        status: 1,
        timezone: TZ,
        emailCount: emailCount,
        formattedEmails: formatEmailsForDisplay(emails),
        apiIntegration: 'Optimized Report Model'
      };
    });

    res.status(200).json({ 
      success: true, 
      total: schedules.length, 
      schedules,
      serverTime: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
      usingOptimizedModel: true
    });
  } catch (error) {
    console.error('❌ Error fetching schedules:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Database error', 
      error: error.message 
    });
  }
};

const getScheduleById = async (req, res) => {
  try {
    const { id } = req.params;
    const scheduleId = parseInt(id);
    
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid schedule ID' 
      });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, scheduleId)
      .query(`
        SELECT 
          R.rep_idKey,
          R.rep_iidcuenta AS ClientID,
          C.cue_cnombre AS ClientName,
          C.cue_cemail AS ClientEmail,
          C.cue_ncuenta AS AccountNumber,
          R.rep_ntipo,
          R.rep_tproximoenvio AS NextRun,
          R.rep_nfrecuencia AS Frequency,
          R.rep_cmail AS Email,
          R.rep_nCadaUnidadTiempo AS IntervalDays
        FROM _Datos.dbo.m_reportes_automaticos R
        INNER JOIN _Datos.dbo.m_cuentas C ON R.rep_iidcuenta = C.cue_iid
        WHERE R.rep_idKey = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Schedule not found' 
      });
    }

    const schedule = result.recordset[0];
    const emails = schedule.Email || '';
    const emailCount = parseEmails(emails).length;
    
    res.status(200).json({ 
      success: true, 
      schedule: {
        id: schedule.rep_idKey,
        clientId: schedule.ClientID,
        clientName: schedule.ClientName,
        clientEmail: schedule.ClientEmail,
        accountNumber: schedule.AccountNumber,
        type: schedule.rep_ntipo,
        nextRun: schedule.NextRun,
        frequency: schedule.Frequency,
        email: emails,
        emails: emails,
        intervalDays: schedule.IntervalDays,
        status: 1,
        timezone: TZ,
        emailCount: emailCount,
        formattedEmails: formatEmailsForDisplay(emails),
        apiIntegration: 'Optimized Report Model'
      },
      usingOptimizedModel: true
    });
  } catch (error) {
    console.error('❌ Error fetching schedule:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Database error', 
      error: error.message 
    });
  }
};

const updateSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const scheduleId = parseInt(id);
    
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid schedule ID' 
      });
    }

    const { nextRun, frequency, email, emails, intervalDays } = req.body;
    const finalEmails = emails || email;

    if (!nextRun || !frequency || !finalEmails) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: nextRun, frequency, emails' 
      });
    }

    const parsedEmails = parseEmails(finalEmails);
    if (parsedEmails.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide at least one valid email address' 
      });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, scheduleId)
      .input('nextRun', sql.DateTime, nextRun)
      .input('frequency', sql.Int, frequency)
      .input('email', sql.VarChar(4000), finalEmails)
      .input('intervalDays', sql.Int, intervalDays || 1)
      .query(`
        UPDATE _Datos.dbo.m_reportes_automaticos
        SET 
          rep_tproximoenvio = @nextRun,
          rep_nfrecuencia = @frequency,
          rep_cmail = @email,
          rep_nCadaUnidadTiempo = @intervalDays
        WHERE rep_idKey = @id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Schedule not found' 
      });
    }

    res.status(200).json({
      success: true,
      message: `Schedule updated successfully for ${parsedEmails.length} email(s)`,
      updatedFields: { 
        nextRun, 
        frequency, 
        emails: finalEmails,
        emailCount: parsedEmails.length,
        intervalDays 
      },
      usingOptimizedModel: true
    });
  } catch (error) {
    console.error('❌ Error updating schedule:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Database error', 
      error: error.message 
    });
  }
};

const createSchedule = async (req, res) => {
  try {
    const { clientId, type, nextRun, frequency, email, emails, intervalDays } = req.body;
    const finalEmails = emails || email;

    if (!clientId || !nextRun || !frequency || !finalEmails) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: clientId, nextRun, frequency, emails' 
      });
    }

    const parsedEmails = parseEmails(finalEmails);
    if (parsedEmails.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide at least one valid email address' 
      });
    }

    const pool = await poolPromise;

    const existingResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query('SELECT rep_idKey FROM _Datos.dbo.m_reportes_automaticos WHERE rep_iidcuenta = @clientId');

    if (existingResult.recordset.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Schedule already exists for this client',
        existingScheduleId: existingResult.recordset[0].rep_idKey
      });
    }

    const insertResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .input('type', sql.Int, type || 1)
      .input('nextRun', sql.DateTime, nextRun)
      .input('frequency', sql.Int, frequency)
      .input('email', sql.VarChar(4000), finalEmails)
      .input('intervalDays', sql.Int, intervalDays || 1)
      .query(`
        INSERT INTO _Datos.dbo.m_reportes_automaticos 
        (rep_iidcuenta, rep_ntipo, rep_tproximoenvio, rep_nfrecuencia, rep_cmail, rep_nCadaUnidadTiempo)
        OUTPUT INSERTED.rep_idKey
        VALUES (@clientId, @type, @nextRun, @frequency, @email, @intervalDays)
      `);

    const clientResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query('SELECT cue_cnombre AS ClientName, cue_ncuenta AS AccountNumber FROM _Datos.dbo.m_cuentas WHERE cue_iid = @clientId');

    const newScheduleId = insertResult.recordset[0].rep_idKey;

    res.status(201).json({
      success: true,
      message: `Schedule created successfully for ${parsedEmails.length} email(s)`,
      schedule: {
        id: newScheduleId,
        clientId: clientId,
        clientName: clientResult.recordset[0]?.ClientName || `Client ${clientId}`,
        accountNumber: clientResult.recordset[0]?.AccountNumber,
        type: type || 1,
        nextRun: nextRun,
        frequency: frequency,
        email: finalEmails,
        emails: finalEmails,
        intervalDays: intervalDays || 1,
        status: 1,
        timezone: TZ,
        emailCount: parsedEmails.length,
        formattedEmails: formatEmailsForDisplay(finalEmails),
        apiIntegration: 'Optimized Report Model'
      },
      usingOptimizedModel: true
    });
  } catch (error) {
    console.error('❌ Error creating schedule:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Database error', 
      error: error.message 
    });
  }
};

const deleteSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const scheduleId = parseInt(id);
    
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid schedule ID' 
      });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, scheduleId)
      .query('DELETE FROM _Datos.dbo.m_reportes_automaticos WHERE rep_idKey = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Schedule not found' 
      });
    }

    res.status(200).json({ 
      success: true, 
      message: 'Schedule deleted successfully',
      deletedId: scheduleId
    });
  } catch (error) {
    console.error('❌ Error deleting schedule:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Database error', 
      error: error.message 
    });
  }
};

// =====================================================
// 🚀 MANUAL TRIGGERS - FIXED
// =====================================================

const triggerDynamicReports = async (req, res) => {
  try {
    console.log('🔧 Manual trigger for dynamic reports...');
    
    const schedulerService = require('../service/scheduler.js');
    
    // ✅ FIXED: Use correct function name
    const result = await schedulerService.runDynamicReportScheduler();
    
    res.status(200).json({
      success: true,
      message: 'Dynamic reports triggered successfully',
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
      result: result
    });
  } catch (error) {
    console.error('❌ Error triggering dynamic reports:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to trigger reports', 
      error: error.message
    });
  }
};

// ✅ FIXED: Manual trigger for patrol reports with all fixes
const triggerPatrolReports = async (req, res) => {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 MANUAL PATROL REPORT TRIGGER RECEIVED');
  console.log('='.repeat(70));

  try {
    const { 
      clientId, 
      recipientEmail, 
      startDate, 
      endDate, 
      reportPeriod = 'custom' 
    } = req.body;

    const isIndividualReport = clientId && recipientEmail;

    if (isIndividualReport) {
      console.log('📋 Individual client report requested');
      console.log(`   Client ID: ${clientId}`);
      console.log(`   Recipient: ${recipientEmail}`);
      console.log(`   Period: ${startDate || 'default'} to ${endDate || 'default'}`);

      // ✅ CHECK 1: Duplicate prevention
      const reportKey = `${clientId}_${startDate || 'default'}_${endDate || 'default'}`;
      if (inProgressReports.has(reportKey)) {
        console.log(`⏸️  Report ${reportKey} is already in progress`);
        return res.status(409).json({
          success: false,
          error: 'This report is already being generated. Please wait 2 minutes.',
          reportKey
        });
      }

      // Add to in-progress set
      inProgressReports.add(reportKey);

      try {
        // Validate required fields
        if (!clientId) {
          throw new Error('Client ID is required for individual reports');
        }

        if (!recipientEmail) {
          throw new Error('Recipient email is required for individual reports');
        }

        // ✅ CHECK 2: Check if email sending is enabled globally
        const EMAIL_ENABLED = global.EMAIL_SENDING_ENABLED !== undefined 
          ? global.EMAIL_SENDING_ENABLED 
          : process.env.ENABLE_EMAIL_SENDING === 'true';
        
        if (!EMAIL_ENABLED) {
          console.log('⚠️ Email sending is disabled globally');
          // Still continue to generate PDF but skip email
        }

        // Determine date range
        let dateRange;
        if (startDate && endDate) {
          const start = dayjs(startDate).tz(TZ);
          const end = dayjs(endDate).tz(TZ);
          const nights = end.diff(start, 'day') + 1;
          
          dateRange = {
            startDate: start.format('YYYY-MM-DD'),
            endDate: end.format('YYYY-MM-DD'),
            sqlStartDate: start.format('YYYY-MM-DD 00:00:00'),
            sqlEndDate: end.format('YYYY-MM-DD 23:59:59'),
            rangeLabel: `${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`,
            nightsCount: nights,
            daysInRange: nights
          };
        } else {
          dateRange = getPreviousWeekRange();
        }

        // ✅ CHECK 3: Validate date range
        const finalStartDate = dateRange.startDate || dateRange.displayStartDate;
        const finalEndDate = dateRange.endDate || dateRange.displayEndDate;
        
        if (!finalStartDate || !finalEndDate) {
          throw new Error('Invalid date range: missing start or end date');
        }

        // Get client data
        console.log(`📊 Fetching client data for ID ${clientId}...`);
        
        const pool = await poolPromise;
        const clientResult = await pool.request()
          .input('clientId', sql.Int, clientId)
          .query(`
            SELECT 
              cue_iid AS ClientID,
              cue_cnombre AS ClientName,
              cue_cemail AS ClientEmail
            FROM [_Datos].[dbo].[m_cuentas]
            WHERE cue_iid = @clientId
          `);

        if (!clientResult.recordset || clientResult.recordset.length === 0) {
          throw new Error(`Client ${clientId} not found`);
        }

        const client = clientResult.recordset[0];
        console.log(`✅ Client found: ${client.ClientName}`);

        // Generate PDF
        console.log(`🎨 Generating PDF for ${client.ClientName}...`);
        
        const pdfData = {
          clientId: client.ClientID,
          clientName: client.ClientName,
          startDate: finalStartDate,
          endDate: finalEndDate
        };

        const pdfService = require('../service/pdfService.js');
        
        let pdfBuffer;
        try {
          pdfBuffer = await pdfService.generateDashboardPDF(pdfData);
          console.log(`✅ PDF generated: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
        } catch (pdfError) {
          throw new Error(`PDF generation failed: ${pdfError.message}`);
        }

        // ✅ CHECK 4: Email sending with proper method name and timeout
        let emailResult = {
          skipped: !EMAIL_ENABLED,
          reason: EMAIL_ENABLED ? null : 'Email sending disabled globally'
        };

        if (EMAIL_ENABLED) {
          console.log(`📧 Sending email to ${recipientEmail}...`);
          
          const emailService = require('../service/emailService.js');
          
          // ✅ FIXED: Use correct email method name (check both possibilities)
          const sendEmailFunc = emailService.sendPatrolReport || 
                              emailService.sendGuardReport || 
                              emailService?.default?.sendPatrolReport ||
                              emailService?.default?.sendGuardReport;
          
          if (!sendEmailFunc || typeof sendEmailFunc !== 'function') {
            throw new Error('Email service method not available');
          }

          const emailData = {
            to: recipientEmail,
            recipientName: recipientEmail.split('@')[0],
            clientName: client.ClientName,
            startDate: finalStartDate,
            endDate: finalEndDate,
            pdfBuffer: pdfBuffer,
            pdfFilename: `Security_Report_${client.ClientName.replace(/\s+/g, '_')}_${finalStartDate}_to_${finalEndDate}.pdf`
          };

          // ✅ ADDED: Email timeout wrapper (60 seconds)
          try {
            emailResult = await Promise.race([
              sendEmailFunc(emailData),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Email sending timed out after 60 seconds')), 60000)
              )
            ]);
            console.log(`✅ Email sent successfully`);
          } catch (emailError) {
            console.error(`❌ Email send failed:`, emailError.message);
            // Don't throw, just note the error but still return PDF success
            emailResult = {
              success: false,
              error: emailError.message,
              skipped: false
            };
          }
        }

        // Success response
        console.log('\n' + '='.repeat(70));
        console.log('✅ INDIVIDUAL REPORT COMPLETED SUCCESSFULLY');
        console.log('='.repeat(70));

        return res.json({
          success: true,
          message: EMAIL_ENABLED && !emailResult.error 
            ? 'Report generated and email sent successfully'
            : 'Report generated successfully' + (emailResult.error ? ' (email failed)' : ' (email disabled)'),
          data: {
            client: {
              id: client.ClientID,
              name: client.ClientName
            },
            dateRange: {
              start: finalStartDate,
              end: finalEndDate,
              nights: dateRange.nightsCount,
              label: dateRange.rangeLabel
            },
            pdf: {
              generated: true,
              sizeKB: Math.round(pdfBuffer.length / 1024)
            },
            email: {
              enabled: EMAIL_ENABLED,
              sent: EMAIL_ENABLED && !emailResult.error,
              recipient: recipientEmail,
              error: emailResult.error || null,
              skipped: emailResult.skipped || false,
              skipReason: emailResult.reason || null
            }
          },
          timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
          usingOptimizedModel: true
        });

      } finally {
        // Remove from in-progress set after delay
        setTimeout(() => {
          inProgressReports.delete(reportKey);
          console.log(`🧹 Cleared report lock for ${reportKey}`);
        }, REPORT_COOLDOWN_MS);
      }

    } else {
      // ✅ FIXED: Bulk scheduler run with correct function name
      console.log('🔧 Bulk scheduler run (all due schedules)...');
      
      const schedulerService = require('../service/scheduler.js');
      
      // ✅ FIXED: Use correct function name
      const result = await schedulerService.runDynamicReportScheduler();
      
      console.log('✅ Bulk scheduler completed');
      
      return res.status(200).json({
        success: true,
        message: 'Patrol reports triggered successfully (bulk)',
        timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        result: result,
        usingOptimizedModel: true,
        mode: 'bulk'
      });
    }

  } catch (error) {
    console.error('❌ Error in triggerPatrolReports:', error);
    console.error('Stack:', error.stack);

    return res.status(500).json({
      success: false,
      message: 'Failed to trigger patrol reports',
      error: error.message,
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
    });
  }
};

// =====================================================
// 📊 ANALYTICS & STATUS ENDPOINTS
// =====================================================

const getSchedulerStatus = async (req, res) => {
  try {
    const pool = await poolPromise;
    
    const [dueResult, totalResult, clientsResult, emailStatsResult] = await Promise.all([
      pool.request().query('SELECT COUNT(*) AS DueCount FROM _Datos.dbo.m_reportes_automaticos WHERE rep_tproximoenvio <= GETDATE() AND rep_cmail IS NOT NULL'),
      pool.request().query('SELECT COUNT(*) AS TotalCount FROM _Datos.dbo.m_reportes_automaticos WHERE rep_cmail IS NOT NULL'),
      pool.request().query('SELECT COUNT(*) AS ClientsCount FROM _Datos.dbo.m_cuentas WHERE cue_iid IN (28, 39, 41, 48)'),
      pool.request().query(`
        SELECT 
          COUNT(*) AS TotalSchedules,
          SUM(LEN(rep_cmail) - LEN(REPLACE(rep_cmail, ',', '')) + 1) AS TotalEmailRecipients
        FROM _Datos.dbo.m_reportes_automaticos 
        WHERE rep_cmail IS NOT NULL AND rep_cmail != ''
      `)
    ]);

    const emailStats = emailStatsResult.recordset[0];
    const avgEmailsPerSchedule = emailStats.TotalSchedules > 0 
      ? Math.round(emailStats.TotalEmailRecipients / emailStats.TotalSchedules) 
      : 0;

    const status = {
      schedules: {
        total: totalResult.recordset[0].TotalCount,
        due: dueResult.recordset[0].DueCount,
        active: totalResult.recordset[0].TotalCount - dueResult.recordset[0].DueCount
      },
      emailRecipients: {
        total: emailStats.TotalEmailRecipients || 0,
        averagePerSchedule: avgEmailsPerSchedule,
        configuration: 'Multiple emails supported (comma, semicolon, or newline separated)',
        emailSendingEnabled: global.EMAIL_SENDING_ENABLED || false
      },
      clients: {
        total: clientsResult.recordset[0].ClientsCount,
        monitored: [28, 39, 41, 48]
      },
      system: {
        serverTime: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        timezone: TZ,
        nightShiftConfiguration: '18:00-06:00 timing for all reports',
        dataSource: 'Optimized Report Model',
        duplicateProtection: {
          enabled: true,
          cooldown: '2 minutes',
          inProgressReports: inProgressReports.size
        }
      }
    };

    res.status(200).json({ 
      success: true, 
      status,
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
    });
  } catch (error) {
    console.error('❌ Error getting scheduler status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get status', 
      error: error.message 
    });
  }
};

const getAllClientsPerformance = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        cue_iid AS ClientID,
        cue_cnombre AS ClientName,
        cue_cemail AS ClientEmail,
        cue_ncuenta AS AccountNumber
      FROM _Datos.dbo.m_cuentas
      WHERE cue_iid IN (28, 39, 41, 48)
      ORDER BY cue_cnombre
    `);

    const clients = await Promise.all(
      result.recordset.map(async (client) => {
        const reportData = await getClientPatrols(client.ClientID, 7);
        
        const emailResult = await pool.request()
          .input('clientId', sql.Int, client.ClientID)
          .query('SELECT rep_cmail AS ReportEmail FROM _Datos.dbo.m_reportes_automaticos WHERE rep_iidcuenta = @clientId');
        
        const reportEmail = emailResult.recordset[0]?.ReportEmail || '';
        const emailCount = parseEmails(reportEmail).length;
        
        return {
          ...client,
          emailConfig: {
            emails: reportEmail,
            emailCount: emailCount,
            formattedEmails: formatEmailsForDisplay(reportEmail)
          },
          performance: {
            overallPerformance: reportData.metadata.overallPerformance || 0,
            totalCompleted: reportData.metadata.totalCompleted || 0,
            totalExpected: reportData.metadata.totalExpectedPatrols || 0,
            postsCount: reportData.posts.length || 0,
            eventsCount: reportData.events.length || 0,
            guardReportsCount: reportData.guardReports.length || 0,
            dataSource: reportData.metadata.dataSource || 'Unknown',
            success: reportData.metadata.success || false
          },
          lastUpdated: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
        };
      })
    );

    res.status(200).json({
      success: true,
      data: { 
        clients, 
        total: clients.length,
        timeframe: 'Last 7 nights',
        usingOptimizedModel: true
      }
    });
  } catch (error) {
    console.error('❌ Error getting clients performance:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get performance data', 
      error: error.message 
    });
  }
};

// =====================================================
// 🧪 TESTING & DIAGNOSTICS
// =====================================================

const toggleEmailSending = async (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide enabled: true/false' 
      });
    }
    
    global.EMAIL_SENDING_ENABLED = enabled;
    
    console.log(`🛑 Email sending ${enabled ? 'ENABLED' : 'DISABLED'} globally`);
    
    res.status(200).json({
      success: true,
      message: `Email sending ${enabled ? 'enabled' : 'disabled'} globally`,
      emailSendingEnabled: global.EMAIL_SENDING_ENABLED,
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
    });
  } catch (error) {
    console.error('❌ Error toggling email sending:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to toggle email sending', 
      error: error.message 
    });
  }
};

const testReportModel = async (req, res) => {
  try {
    const { clientId, startDate, endDate } = req.body;
    
    const testClientId = clientId || 28;
    const testStartDate = startDate || dayjs().tz(TZ).subtract(7, 'day').format('YYYY-MM-DD');
    const testEndDate = endDate || dayjs().tz(TZ).format('YYYY-MM-DD');
    
    console.log(`🧪 Testing optimized report model for client ${testClientId}`);
    console.log(`📅 Period: ${testStartDate} to ${testEndDate}`);
    
    const reportData = await fetchWeeklyReport(
      testClientId,
      testStartDate,
      testEndDate,
      true
    );
    
    const pool = await poolPromise;
    const clientResult = await pool.request()
      .input('clientId', sql.Int, testClientId)
      .query('SELECT cue_cnombre AS ClientName FROM _Datos.dbo.m_cuentas WHERE cue_iid = @clientId');
    
    const clientName = clientResult.recordset[0]?.ClientName || `Client ${testClientId}`;
    
    res.status(200).json({
      success: reportData.metadata.success || false,
      client: {
        id: testClientId,
        name: clientName
      },
      period: {
        startDate: testStartDate,
        endDate: testEndDate,
        days: reportData.metadata.daysInRange || 0
      },
      reportData: {
        postsCount: reportData.posts.length,
        eventsCount: reportData.events.length,
        guardReportsCount: reportData.guardReports.length,
        overallPerformance: reportData.metadata.overallPerformance || 0,
        dataSource: reportData.metadata.dataSource || 'Unknown',
        processingTime: reportData.metadata.processingTime || 0,
        usingAPI: reportData.metadata.usingAPI || false,
        success: reportData.metadata.success || false
      },
      metadata: reportData.metadata,
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
    });
  } catch (error) {
    console.error('❌ Report model test error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Report model test failed', 
      error: error.message
    });
  }
};

const diagnosticServices = async (req, res) => {
  try {
    console.log('🔍 Running service diagnostics...');
    
    let schedulerService;
    try {
      schedulerService = require('../service/scheduler.js');
    } catch (importError) {
      console.warn('⚠️ Could not import scheduler service:', importError.message);
    }
    
    const diagnostics = {
      reportModel: {
        available: !!fetchWeeklyReport,
        description: 'Optimized Report Model with API-first approach'
      },
      schedulerService: {
        available: !!schedulerService,
        functions: schedulerService ? Object.keys(schedulerService).filter(key => typeof schedulerService[key] === 'function') : [],
        hasTriggerDynamicReportsNow: schedulerService && typeof schedulerService.triggerDynamicReportsNow === 'function',
        hasRunDynamicReportScheduler: schedulerService && typeof schedulerService.runDynamicReportScheduler === 'function'
      },
      emailFeatures: {
        enabled: global.EMAIL_SENDING_ENABLED || false,
        multiRecipient: true,
        duplicateProtection: true
      },
      system: {
        nodeVersion: process.version,
        timezone: TZ,
        serverTime: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        duplicateProtection: {
          enabled: true,
          inProgressCount: inProgressReports.size
        }
      }
    };
    
    console.log('📊 Diagnostics completed');
    console.log(`✅ Email sending: ${global.EMAIL_SENDING_ENABLED ? 'ENABLED' : 'DISABLED'}`);
    console.log(`✅ Duplicate protection: ACTIVE (${inProgressReports.size} in progress)`);
    console.log(`✅ Scheduler Service: ${schedulerService ? 'AVAILABLE' : 'UNAVAILABLE'}`);
    
    res.status(200).json({
      success: true,
      diagnostics,
      recommendations: [
        diagnostics.schedulerService.hasRunDynamicReportScheduler 
          ? '✅ Scheduler main function available' 
          : '❌ Scheduler main function not found',
        diagnostics.emailFeatures.enabled 
          ? '✅ Email sending enabled' 
          : '⚠️ Email sending disabled - use /api/scheduler/toggle-email to enable',
        diagnostics.duplicateProtection.enabled 
          ? '✅ Duplicate report prevention enabled' 
          : '⚠️ Duplicate prevention not configured'
      ]
    });
  } catch (error) {
    console.error('❌ Diagnostic error:', error);
    res.status(500).json({
      success: false,
      message: 'Diagnostic failed',
      error: error.message
    });
  }
};

// =====================================================
// 📋 EXPORT ALL FUNCTIONS
// =====================================================

module.exports = {
  // Schedule management
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  createSchedule,
  deleteSchedule,
  
  // Manual triggers - ALL FIXED
  triggerDynamicReports,
  triggerPatrolReports,
  
  // Analytics & status
  getSchedulerStatus,
  getAllClientsPerformance,
  
  // Testing & diagnostics
  diagnosticServices,
  toggleEmailSending,
  testReportModel,
  
  // Date range functions
  getDateRangeForPeriod,
  getTodayRange,
  getYesterdayRange,
  getLast7DaysRange,
  getPreviousWeekRange,
  getCurrentWeekRange,
  getLast30DaysRange,
  getPreviousMonthRange,
  getCurrentMonthRange,
  getCustomDateRange,
  getHistoricalDateRange,
  
  // Data fetching functions (using optimized report model)
  getClientHistoricalPatrols,
  getClientPatrols,
  
  // Helper functions
  parseEmails,
  formatEmailsForDisplay,
  calculateNightsInRange,
  getDatabaseQueryDates
};

// Keep default export for compatibility
module.exports.default = module.exports;