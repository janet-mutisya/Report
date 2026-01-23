// server/controllers/schedulerController.js - FIXED VERSION
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import { sql, poolPromise } from '../config/database.js';

// ✅ Import the optimized report model
import { fetchWeeklyReport } from '../models/reportModel.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

// =====================================================
// 📅 DATE RANGE FUNCTIONS
// =====================================================

/**
 * Calculate nights in range for night shift reporting
 */
export const calculateNightsInRange = (startDate, endDate) => {
  try {
    const start = dayjs(startDate, 'YYYY-MM-DD').startOf('day');
    const end = dayjs(endDate, 'YYYY-MM-DD').startOf('day');
    const nightsInRange = end.diff(start, 'day') + 1;
    return nightsInRange;
  } catch (error) {
    console.error(`❌ Error calculating nights in range:`, error.message);
    return dayjs(endDate, 'YYYY-MM-DD').diff(dayjs(startDate, 'YYYY-MM-DD'), 'day') + 1;
  }
};

/**
 * Get database query dates for night shifts (18:00-06:00)
 */
export const getDatabaseQueryDates = (startDate, endDate) => {
  try {
    // Parse dates in Nairobi timezone
    const start = dayjs.tz(startDate, 'YYYY-MM-DD', TZ);
    const end = dayjs.tz(endDate, 'YYYY-MM-DD', TZ);
    
    // Night shift timing in Nairobi: 18:00 current day to 06:00 next day
    const nairobiStartTime = start.set('hour', 18).set('minute', 0).set('second', 0);
    const nairobiEndTime = end.add(1, 'day').set('hour', 6).set('minute', 0).set('second', 0);
    
    // Convert Nairobi times to CST for database
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
      totalHours: cstEndTime.diff(cstStartTime, 'hour'),
      nairobiStartTime: nairobiStartTime.format('YYYY-MM-DD HH:mm:ss'),
      nairobiEndTime: nairobiEndTime.format('YYYY-MM-DD HH:mm:ss')
    };
  } catch (error) {
    console.error(`❌ Error calculating database query dates:`, error.message);
    
    // Fallback with basic conversion
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
export const getLast7DaysRange = () => {
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

export const getPreviousWeekRange = () => {
  const today = dayjs().tz(TZ);
  // Previous week: 14 days ago to 7 days ago
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

export const getCurrentWeekRange = () => {
  const today = dayjs().tz(TZ);
  // Current week: 7 days ago to today
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
export const getTodayRange = () => getPreviousWeekRange();
export const getYesterdayRange = () => getPreviousWeekRange();
export const getLast30DaysRange = () => getPreviousWeekRange();
export const getPreviousMonthRange = () => getPreviousWeekRange();
export const getCurrentMonthRange = () => getPreviousWeekRange();

export const getCustomDateRange = (startDate, endDate) => {
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
    
    const range = {
      startDate: start.format('YYYY-MM-DD'),
      endDate: end.format('YYYY-MM-DD'),
      sqlStartDate: dbDates.dbStartDate,
      sqlEndDate: dbDates.dbEndDate,
      rangeLabel: `Custom: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`,
      nightsInRange: nightsInRange,
      daysInRange: nightsInRange,
      periodType: 'custom'
    };
    
    console.log(`📅 Custom range: ${range.startDate} to ${range.endDate} (${nightsInRange} nights)`);
    return range;
  } catch (error) {
    console.error('❌ Error calculating custom range:', error);
    throw error;
  }
};

export const getHistoricalDateRange = (options = {}) => {
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
    
    const range = {
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
    
    console.log(`📅 Historical range: ${range.startDate} to ${range.endDate} (${nightsInRange} nights)`);
  return range;
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

export const getDateRangeForPeriod = (reportPeriod, customStart = null, customEnd = null) => {
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

export const parseEmails = (emailString) => {
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

export const formatEmailsForDisplay = (emailString) => {
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
export const getClientPatrols = async (clientId, nightsRange = 7) => {
  try {
    const endDate = dayjs().tz(TZ).format('YYYY-MM-DD');
    const startDate = dayjs().tz(TZ).subtract(nightsRange - 1, 'day').format('YYYY-MM-DD');
    
    console.log(`📊 Fetching patrol data for client ${clientId} using optimized report model`);
    console.log(`   Period: ${startDate} to ${endDate} (${nightsRange} nights)`);
    
    const reportData = await fetchWeeklyReport(
      clientId, 
      startDate, 
      endDate,
      true  // usePartitions
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
export const getClientHistoricalPatrols = async (clientId, startDate, endDate) => {
  try {
    console.log(`📋 Fetching historical patrol data for client ${clientId}`);
    console.log(`   Period: ${startDate} to ${endDate}`);
    
    const reportData = await fetchWeeklyReport(
      clientId, 
      startDate, 
      endDate,
      true  // usePartitions
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

export const getAllSchedules = async (req, res) => {
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

export const getScheduleById = async (req, res) => {
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

export const updateSchedule = async (req, res) => {
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

export const createSchedule = async (req, res) => {
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

export const deleteSchedule = async (req, res) => {
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
// 🚀 MANUAL TRIGGERS
// =====================================================

export const triggerDynamicReports = async (req, res) => {
  try {
    console.log('🔧 Manual trigger for dynamic reports...');
    
    // ✅ FIXED: Dynamic import for scheduler service
    const schedulerService = await import('../service/scheduler.js');
    
    // Use the scheduler's main function
    await schedulerService.runDynamicReportScheduler();
    
    res.status(200).json({
      success: true,
      message: 'Dynamic reports triggered successfully',
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
      usingOptimizedModel: true
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

// ✅ FIXED: Manual trigger for patrol reports
export const triggerPatrolReports = async (req, res) => {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     MANUAL PATROL REPORT TRIGGER RECEIVED                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    const { 
      clientId, 
      recipientEmail, 
      startDate, 
      endDate, 
      reportPeriod = 'custom' 
    } = req.body;

    // ========== CHECK IF THIS IS AN INDIVIDUAL REPORT REQUEST ==========
    const isIndividualReport = clientId && recipientEmail;

    if (isIndividualReport) {
      console.log('📋 Individual client report requested');
      console.log(`   Client ID: ${clientId}`);
      console.log(`   Recipient: ${recipientEmail}`);
      console.log(`   Period: ${startDate || 'default'} to ${endDate || 'default'}`);

      // Validate required fields
      if (!clientId) {
        return res.status(400).json({
          success: false,
          error: 'Client ID is required for individual reports'
        });
      }

      if (!recipientEmail) {
        return res.status(400).json({
          success: false,
          error: 'Recipient email is required for individual reports'
        });
      }

      // ========== DETERMINE DATE RANGE ==========
      let dateRange;
      if (startDate && endDate) {
        // Custom date range
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

        console.log(`✅ Custom date range: ${dateRange.startDate} to ${dateRange.endDate} (${nights} nights)`);
      } else {
        // Use previous week by default
        dateRange = getPreviousWeekRange();
        console.log(`✅ Using default: Previous week (${dateRange.nightsCount} nights)`);
      }

      // ========== GET CLIENT DATA ==========
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
        console.log(`❌ Client ${clientId} not found`);
        return res.status(404).json({
          success: false,
          error: 'Client not found'
        });
      }

      const client = clientResult.recordset[0];
      console.log(`✅ Client found: ${client.ClientName}`);

      // ========== GENERATE PDF ==========
      console.log(`🎨 Generating PDF for ${client.ClientName}...`);
      
      const pdfData = {
        clientId: client.ClientID,
        clientName: client.ClientName,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      };

      // Import PDF service
      const pdfService = await import('../service/pdfService.js');
      
      let pdfBuffer;
      try {
        pdfBuffer = await pdfService.generateDashboardPDF(pdfData);
        console.log(`✅ PDF generated: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
      } catch (pdfError) {
        console.error(`❌ PDF generation failed:`, pdfError.message);
        return res.status(500).json({
          success: false,
          error: 'PDF generation failed',
          details: pdfError.message
        });
      }

      // ========== SEND EMAIL ==========
      console.log(`📧 Sending email to ${recipientEmail}...`);

      // ✅ DEBUG: Check dateRange before sending
      console.log('📧 DEBUG: dateRange object:', {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        hasStartDate: !!dateRange.startDate,
        hasEndDate: !!dateRange.endDate
      });

      // Import email service
      const emailService = await import('../service/emailService.js');

      // ✅ FIXED: Ensure dates are explicitly passed as strings
      const emailData = {
        to: recipientEmail,
        recipientName: recipientEmail.split('@')[0],
        clientName: client.ClientName,
        startDate: String(dateRange.startDate || dateRange.displayStartDate || ''),
        endDate: String(dateRange.endDate || dateRange.displayEndDate || ''),
        pdfBuffer: pdfBuffer,
        pdfFilename: `Security_Report_${client.ClientName.replace(/\s+/g, '_')}_${dateRange.startDate}_to_${dateRange.endDate}.pdf`
      };

      // ✅ DEBUG: Verify what we're sending
      console.log('📧 DEBUG: emailData being sent:', {
        to: emailData.to,
        startDate: emailData.startDate,
        endDate: emailData.endDate,
        clientName: emailData.clientName
      });

      let emailResult;
      try {
        emailResult = await emailService.sendPatrolReport(emailData);
        
        if (emailResult.skipped) {
          console.log(`⚠️ Email skipped: ${emailResult.reason}`);
        } else {
          console.log(`✅ Email sent successfully: ${emailResult.messageId}`);
        }
      } catch (emailError) {
        console.error(`❌ Email send failed:`, emailError.message);
        return res.status(500).json({
          success: false,
          error: 'Email sending failed',
          details: emailError.message,
          pdfGenerated: true
        });
      }

      // ========== SUCCESS RESPONSE ==========
      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║     INDIVIDUAL REPORT COMPLETED SUCCESSFULLY ✅           ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');

      return res.json({
        success: true,
        message: emailResult.skipped 
          ? 'Report generated successfully (email sending disabled)'
          : 'Report generated and email sent successfully',
        data: {
          client: {
            id: client.ClientID,
            name: client.ClientName
          },
          dateRange: {
            start: dateRange.startDate,
            end: dateRange.endDate,
            nights: dateRange.nightsCount,
            label: dateRange.rangeLabel
          },
          pdf: {
            generated: true,
            sizeKB: Math.round(pdfBuffer.length / 1024)
          },
          email: {
            sent: !emailResult.skipped,
            recipient: recipientEmail,
            messageId: emailResult.messageId || null,
            skipped: emailResult.skipped || false,
            skipReason: emailResult.reason || null
          }
        },
        timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        usingOptimizedModel: true
      });

    } else {
      // ========== BULK SCHEDULER RUN ==========
      console.log('🔧 Bulk scheduler run (all due schedules)...');
      
      // ✅ FIXED: Dynamic import for bulk scheduler run
      const schedulerService = await import('../service/scheduler.js');
      await schedulerService.triggerPatrolReportsNow();
      
      console.log('✅ Bulk scheduler completed');
      
      return res.status(200).json({
        success: true,
        message: 'Patrol reports triggered successfully (bulk)',
        timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        usingOptimizedModel: true,
        mode: 'bulk'
      });
    }

  } catch (error) {
    console.error('❌ Error in triggerPatrolReports:', error);
    console.error('Stack:', error.stack);

    console.log('\n');
    console.log('  PATROL REPORT TRIGGER FAILED');
    console.log('\n');

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

export const getSchedulerStatus = async (req, res) => {
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
        features: {
          apiFirst: true,
          cachingEnabled: true,
          automaticFallback: true,
          multiTableSupport: true,
          performanceOptimized: true
        },
        emailConfiguration: {
          enabled: global.EMAIL_SENDING_ENABLED || false,
          smtpProvider: 'Office365',
          host: process.env.EMAIL_HOST,
          port: process.env.EMAIL_PORT,
          user: process.env.EMAIL_USER,
          fromEmail: process.env.FROM_EMAIL || process.env.EMAIL_USER,
          fromName: process.env.FROM_NAME || 'BM Security',
          multiRecipient: 'Supported'
        },
        schedulerConfiguration: {
          interval: process.env.DYNAMIC_REPORT_INTERVAL || '*/2 * * * *',
          delayBetweenClients: process.env.DELAY_BETWEEN_CLIENTS || '3000ms'
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

export const getAllClientsPerformance = async (req, res) => {
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

export const toggleEmailSending = async (req, res) => {
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

export const testReportModel = async (req, res) => {
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
    
    const clientResult = await poolPromise.then(pool => 
      pool.request()
        .input('clientId', sql.Int, testClientId)
        .query('SELECT cue_cnombre AS ClientName FROM _Datos.dbo.m_cuentas WHERE cue_iid = @clientId')
    );
    
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

export const diagnosticServices = async (req, res) => {
  try {
    console.log('🔍 Running service diagnostics...');
    
    // ✅ FIXED: Dynamic import for scheduler service
    let schedulerService;
    try {
      schedulerService = await import('../service/scheduler.js');
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
        features: {
          multiRecipient: true,
          dateRangeTesting: true,
          emailKillSwitch: true,
          pdfSaving: process.env.SAVE_PDF_TO_DISK === 'true',
          errorLogging: process.env.LOG_ERRORS_TO_FILE === 'true'
        }
      },
      emailFeatures: {
        multiRecipient: true,
        parsing: {
          delimiters: ['comma', 'semicolon', 'newline'],
          validation: 'basic format validation'
        },
        globalEnabled: global.EMAIL_SENDING_ENABLED || false
      },
      system: {
        nodeVersion: process.version,
        timezone: TZ,
        serverTime: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        usingOptimizedModel: true
      },
      configuration: {
        TIMEZONE: TZ,
        EMAIL_SENDING_ENABLED: global.EMAIL_SENDING_ENABLED || false,
        SAVE_PDF_TO_DISK: process.env.SAVE_PDF_TO_DISK === 'true',
        LOG_ERRORS_TO_FILE: process.env.LOG_ERRORS_TO_FILE === 'true',
        DYNAMIC_REPORT_INTERVAL: process.env.DYNAMIC_REPORT_INTERVAL || '*/2 * * * *'
      }
    };
    
    console.log('📊 Diagnostics completed');
    console.log(`✅ Using Optimized Report Model`);
    console.log(`📧 Email sending globally: ${global.EMAIL_SENDING_ENABLED ? '✅ ENABLED' : '🛑 DISABLED'}`);
    console.log(`🔄 Scheduler Service: ${schedulerService ? '✅ AVAILABLE' : '❌ UNAVAILABLE'}`);
    
    res.status(200).json({
      success: true,
      diagnostics,
      recommendations: {
        reportModel: diagnostics.reportModel.available 
          ? '✅ Optimized Report Model available'
          : '❌ Report model unavailable - check reportModelOptimized.js',
        schedulerService: diagnostics.schedulerService.available
          ? `✅ ${diagnostics.schedulerService.functions.length} scheduler functions available`
          : '❌ Scheduler service unavailable - check scheduler.js',
        multiRecipient: diagnostics.emailFeatures.multiRecipient
          ? '✅ Multiple recipient support enabled'
          : '❌ Multiple recipient support disabled',
        emailSending: diagnostics.emailFeatures.globalEnabled
          ? '✅ Email sending enabled globally'
          : '🛑 Email sending disabled globally - use /api/scheduler/toggle-email endpoint to enable',
        schedulerFeatures: diagnostics.schedulerService.available
          ? `✅ Scheduler features: Email kill switch, PDF saving, Error logging`
          : '❌ Scheduler service not loaded'
      }
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

export default {
  // Schedule management
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  createSchedule,
  deleteSchedule,
  
  // Manual triggers
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