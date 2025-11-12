// server/controllers/schedulerController.js - COMPLETELY FIXED VERSION
import sql from 'mssql';
import { poolPromise } from '../config/database.js';
import { 
  triggerPatrolReportsNow,
  triggerDynamicReportsNow
} from '../service/scheduler.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';

// Enable timezone and week support
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';
const TEST_MODE = process.env.TEST_MODE === 'true';
const DATA_REFERENCE_DATE = '2025-10-17';

/**
 * 📅 DATE RANGE HELPERS
 */
export const getPreviousWeekRange = () => {
  const dataDate = dayjs(DATA_REFERENCE_DATE).tz(TZ);
  const startOfLastWeek = dataDate.subtract(1, 'week').startOf('isoWeek');
  const endOfLastWeek = dataDate.subtract(1, 'week').endOf('isoWeek');
  
  return {
    startDate: startOfLastWeek.format('YYYY-MM-DD'),
    endDate: endOfLastWeek.format('YYYY-MM-DD'),
    sqlStartDate: startOfLastWeek.format('YYYY-MM-DD 00:00:00'),
    sqlEndDate: endOfLastWeek.format('YYYY-MM-DD 23:59:59'),
    weekRange: `Week of ${startOfLastWeek.format('MMM D')} - ${endOfLastWeek.format('MMM D, YYYY')}`,
    rangeLabel: `Week of ${startOfLastWeek.format('MMM D')} - ${endOfLastWeek.format('MMM D, YYYY')}`
  };
};

export const getHistoricalDateRange = (options = {}) => {
  const dataDate = dayjs(DATA_REFERENCE_DATE).tz(TZ);
  const { monthsBack = null, specificMonth = null } = options;
  
  let finalStartDate, finalEndDate;

  if (specificMonth) {
    finalStartDate = dayjs(specificMonth).startOf('month');
    finalEndDate = dayjs(specificMonth).endOf('month');
  } else if (monthsBack) {
    finalStartDate = dataDate.subtract(monthsBack, 'month').startOf('month');
    finalEndDate = dataDate;
  } else {
    finalStartDate = dataDate.startOf('month');
    finalEndDate = dataDate;
  }

  return {
    sqlStartDate: finalStartDate.format('YYYY-MM-DD 00:00:00'),
    sqlEndDate: finalEndDate.format('YYYY-MM-DD 23:59:59'),
    displayStartDate: finalStartDate.format('YYYY-MM-DD'),
    displayEndDate: finalEndDate.format('YYYY-MM-DD'),
    startDate: finalStartDate.format('YYYY-MM-DD'),
    endDate: finalEndDate.format('YYYY-MM-DD'),
    rangeLabel: specificMonth 
      ? `Month: ${finalStartDate.format('MMMM YYYY')}`
      : monthsBack
      ? `Last ${monthsBack} months`
      : `Month: ${finalStartDate.format('MMMM YYYY')}`
  };
};

/**
 * 🗃️ PATROL DATA FETCHING
 */
export const getClientPatrols = async (clientId, daysRange = 30) => {
  try {
    const pool = await poolPromise;
    const dataDate = dayjs(DATA_REFERENCE_DATE).tz(TZ);
    const startDate = dataDate.subtract(daysRange, 'day').format('YYYY-MM-DD 00:00:00');
    const endDate = dataDate.format('YYYY-MM-DD 23:59:59');
    
    console.log(`📊 Fetching patrols for client ${clientId} around ${DATA_REFERENCE_DATE}`);

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
          rec_cContenido AS Content
        FROM [_Datos].[dbo].[p_recepcion]
        WHERE rec_iidcuenta = @clientId
          AND rec_tfechahora BETWEEN @startDate AND @endDate
        ORDER BY rec_tfechahora DESC
      `);

    const patrols = result.recordset;
    console.log(`✅ Found ${patrols.length} patrols for client ${clientId}`);
    
    return {
      pastPatrols: patrols,
      upcomingPatrols: [],
      summary: {
        totalPatrols: patrols.length,
        completedPatrols: patrols.filter(p => p.AlarmType?.includes('V04')).length,
        expectedPatrols: daysRange * 11,
        complianceRate: patrols.length > 0 ? `${Math.round((patrols.length / (daysRange * 11)) * 100)}%` : '0%'
      }
    };

  } catch (error) {
    console.error(`❌ Error fetching patrols for client ${clientId}:`, error.message);
    return {
      pastPatrols: [],
      upcomingPatrols: [],
      summary: { totalPatrols: 0, completedPatrols: 0, expectedPatrols: 0, complianceRate: '0%' }
    };
  }
};

export const getClientHistoricalPatrols = async (clientId, startDate, endDate) => {
  try {
    const pool = await poolPromise;
    
    console.log(`📋 Fetching historical patrols for client ${clientId} from ${startDate} to ${endDate}`);

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
          zon.zon_cdescripcion AS ZoneName,
          cue.cue_cnombre AS ClientName
        FROM [_Datos].[dbo].[p_recepcion] rec
        INNER JOIN [_Datos].[dbo].[m_cuentas] cue ON rec.rec_iidcuenta = cue.cue_iid
        LEFT JOIN [_Datos].[dbo].[m_zonas] zon ON rec.rec_iidcuenta = zon.zon_iidcuenta AND rec.rec_czona = zon.zon_ccodigo
        WHERE rec.rec_iidcuenta = @clientId
          AND rec.rec_tfechahora BETWEEN @startDate AND @endDate
        ORDER BY rec.rec_tfechahora DESC
      `);

    const patrols = result.recordset;
    console.log(`✅ Found ${patrols.length} historical patrols for client ${clientId}`);

    return {
      patrols,
      summary: {
        totalPatrols: patrols.length,
        completedPatrols: patrols.filter(p => p.AlarmType?.includes('V04')).length,
        complianceRate: 'N/A'
      }
    };

  } catch (error) {
    console.error('❌ Error fetching historical patrols:', error);
    return { patrols: [], summary: { totalPatrols: 0, completedPatrols: 0, complianceRate: '0%' } };
  }
};

/**
 * 🔄 DATA TRANSFORMATION HELPERS
 */
export function transformPatrolsToPosts(patrolData, schedule, dateRange) {
  try {
    const patrols = patrolData.patrols || patrolData.pastPatrols || [];
    if (patrols.length === 0) {
      console.log('⚠️ No patrols found for post transformation');
      return [];
    }

    console.log(`🔄 Transforming ${patrols.length} patrols to posts...`);

    const postsMap = new Map();
    
    patrols.forEach(patrol => {
      const zoneKey = patrol.rec_czona || patrol.ZoneCode || 'Unknown';
      const zoneName = patrol.ZoneName || `Zone ${zoneKey}`;
      
      if (!postsMap.has(zoneKey)) {
        postsMap.set(zoneKey, {
          SitePost: zoneName,
          ChecksCompleted: 0,
          ExpectedChecks: 0,
          PerformanceRate: '0%'
        });
      }
      postsMap.get(zoneKey).ChecksCompleted++;
    });

    const daysInPeriod = Math.max(1, dayjs(dateRange.endDate).diff(dayjs(dateRange.startDate), 'day') + 1);
    const patrolsPerDay = schedule?.patrols_per_day || 11;
    const totalExpected = daysInPeriod * patrolsPerDay;
    const expectedPerPost = postsMap.size > 0 ? Math.ceil(totalExpected / postsMap.size) : totalExpected;

    postsMap.forEach(post => {
      post.ExpectedChecks = expectedPerPost;
      const performance = expectedPerPost > 0 ? ((post.ChecksCompleted / expectedPerPost) * 100).toFixed(1) : 0;
      post.PerformanceRate = `${performance}%`;
    });

    const posts = Array.from(postsMap.values());
    console.log(`✅ Transformed ${posts.length} posts`);
    return posts;
  } catch (error) {
    console.error('❌ Error transforming patrols to posts:', error);
    return [];
  }
}

export function transformPatrolsToEvents(patrolData) {
  try {
    const patrols = patrolData.patrols || patrolData.pastPatrols || [];
    
    console.log(`🔄 Transforming ${patrols.length} patrols to events...`);
    
    const events = patrols.map((patrol) => {
      return {
        rec_tfechahora: patrol.rec_tfechahora || patrol.PatrolDate,
        rec_czona: patrol.rec_czona || patrol.ZoneCode || 'Unknown',
        rec_calarma: patrol.rec_calarma || patrol.AlarmType,
        rec_cContenido: patrol.rec_cContenido || patrol.Content || 'Patrol Check'
      };
    });

    console.log(`✅ Transformed ${events.length} events`);
    
    return events;
  } catch (error) {
    console.error('❌ Error transforming patrols to events:', error);
    return [];
  }
}

export function calculateSummary(patrolData, schedule, dateRange) {
  try {
    const patrols = patrolData.patrols || patrolData.pastPatrols || [];
    const posts = transformPatrolsToPosts(patrolData, schedule, dateRange);
    
    const totalCompleted = patrols.length;
    const totalExpected = posts.reduce((sum, post) => sum + post.ExpectedChecks, 0);
    const complianceRate = totalExpected > 0 ? `${((totalCompleted / totalExpected) * 100).toFixed(1)}%` : '0%';
    
    return {
      totalPatrols: totalCompleted,
      completedPatrols: totalCompleted,
      totalExpected: totalExpected,
      complianceRate: complianceRate,
      postsCount: posts.length,
      eventsCount: patrols.length
    };
  } catch (error) {
    console.error('❌ Error calculating summary:', error);
    return {
      totalPatrols: 0,
      completedPatrols: 0,
      totalExpected: 0,
      complianceRate: '0%',
      postsCount: 0,
      eventsCount: 0
    };
  }
}

/**
 * 🔧 PDF GENERATION HELPER - SIMPLIFIED AND FIXED
 */
async function generatePDF(data, clientName, dateRange) {
  try {
    console.log('🔍 Importing PDF service...');
    
    // Import PDF service directly
    const pdfService = await import('../service/pdfService.js');
    
    console.log('✅ PDF Service loaded successfully');
    console.log('📋 Available exports:', Object.keys(pdfService));
    
    let pdfBuffer;
    
    // DIRECT FUNCTION CALL - Use the functions we know exist
    if (pdfService.generateHistoricalReportEmail) {
      console.log('✅ Using generateHistoricalReportEmail for PDF generation');
      pdfBuffer = await pdfService.generateHistoricalReportEmail(data, clientName, dateRange);
    } 
    else if (pdfService.generatePatrolReportEmail) {
      console.log('✅ Using generatePatrolReportEmail for PDF generation');
      pdfBuffer = await pdfService.generatePatrolReportEmail(data, clientName, dateRange);
    }
    else if (pdfService.generateDashboardPDF) {
      console.log('✅ Using generateDashboardPDF for PDF generation');
      pdfBuffer = await pdfService.generateDashboardPDF(data);
    }
    else if (pdfService.default) {
      // Try default export
      if (pdfService.default.generateHistoricalReportEmail) {
        console.log('✅ Using default.generateHistoricalReportEmail');
        pdfBuffer = await pdfService.default.generateHistoricalReportEmail(data, clientName, dateRange);
      }
      else if (pdfService.default.generatePatrolReportEmail) {
        console.log('✅ Using default.generatePatrolReportEmail');
        pdfBuffer = await pdfService.default.generatePatrolReportEmail(data, clientName, dateRange);
      }
      else if (pdfService.default.generateDashboardPDF) {
        console.log('✅ Using default.generateDashboardPDF');
        pdfBuffer = await pdfService.default.generateDashboardPDF(data);
      }
    }
    else {
      throw new Error(`No PDF generation function found. Available: ${Object.keys(pdfService).join(', ')}`);
    }
    
    if (!pdfBuffer) {
      throw new Error('PDF generation returned null buffer');
    }
    
    console.log(`✅ PDF generated successfully: ${Math.round(pdfBuffer.length / 1024)} KB`);
    return pdfBuffer;
    
  } catch (error) {
    console.error('❌ PDF generation error:', error);
    throw new Error(`PDF generation failed: ${error.message}`);
  }
}

/**
 * 🔧 EMAIL SENDING HELPER - SIMPLIFIED AND FIXED
 */
async function sendPatrolEmail(emailData) {
  try {
    console.log('🔍 Importing email service...');
    
    // Import email service directly
    const emailService = await import('../service/emailService.js');
    
    console.log('✅ Email Service loaded successfully');
    
    // Use the function directly
    if (emailService.sendPatrolReport) {
      console.log('✅ Using sendPatrolReport');
      return await emailService.sendPatrolReport(emailData);
    }
    else if (emailService.default && emailService.default.sendPatrolReport) {
      console.log('✅ Using default.sendPatrolReport');
      return await emailService.default.sendPatrolReport(emailData);
    }
    else {
      throw new Error('sendPatrolReport function not found in emailService');
    }
  } catch (error) {
    console.error('❌ Email sending error:', error);
    throw error;
  }
}

/**
 * 🎯 SCHEDULE MANAGEMENT CONTROLLERS
 */
export const getAllSchedules = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        R.rep_idKey,
        R.rep_iidcuenta AS ClientID,
        C.cue_cnombre AS ClientName,
        C.cue_cemail AS ClientEmail,
        R.rep_ntipo,
        R.rep_tproximoenvio AS NextRun,
        R.rep_nfrecuencia AS Frequency,
        R.rep_cmail AS Email,
        R.rep_nCadaUnidadTiempo AS IntervalDays
      FROM _Datos.dbo.m_reportes_automaticos R
      INNER JOIN _Datos.dbo.m_cuentas C ON R.rep_iidcuenta = C.cue_iid
      ORDER BY R.rep_tproximoenvio ASC
    `);

    const schedules = result.recordset.map(schedule => ({
      id: schedule.rep_idKey,
      clientId: schedule.ClientID,
      clientName: schedule.ClientName,
      clientEmail: schedule.ClientEmail,
      type: schedule.rep_ntipo,
      nextRun: schedule.NextRun,
      frequency: schedule.Frequency,
      email: schedule.Email,
      intervalDays: schedule.IntervalDays,
      status: 1,
      timezone: TZ
    }));

    res.status(200).json({ success: true, total: schedules.length, schedules });
  } catch (error) {
    console.error('❌ Error fetching schedules:', error);
    res.status(500).json({ success: false, message: 'Database error', error: error.message });
  }
};

export const getScheduleById = async (req, res) => {
  try {
    const { id } = req.params;
    const scheduleId = parseInt(id);
    
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid schedule ID' });
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
      return res.status(404).json({ success: false, message: 'Schedule not found' });
    }

    const schedule = result.recordset[0];
    res.status(200).json({ 
      success: true, 
      schedule: {
        id: schedule.rep_idKey,
        clientId: schedule.ClientID,
        clientName: schedule.ClientName,
        clientEmail: schedule.ClientEmail,
        type: schedule.rep_ntipo,
        nextRun: schedule.NextRun,
        frequency: schedule.Frequency,
        email: schedule.Email,
        intervalDays: schedule.IntervalDays,
        status: 1,
        timezone: TZ
      }
    });
  } catch (error) {
    console.error('❌ Error fetching schedule:', error);
    res.status(500).json({ success: false, message: 'Database error', error: error.message });
  }
};

export const updateSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const scheduleId = parseInt(id);
    
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid schedule ID' });
    }

    const { nextRun, frequency, email, intervalDays } = req.body;

    if (!nextRun || !frequency || !email) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, scheduleId)
      .input('nextRun', sql.DateTime, nextRun)
      .input('frequency', sql.Int, frequency)
      .input('email', sql.VarChar(4000), email)
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
      return res.status(404).json({ success: false, message: 'Schedule not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Schedule updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating schedule:', error);
    res.status(500).json({ success: false, message: 'Database error', error: error.message });
  }
};

export const createSchedule = async (req, res) => {
  try {
    const { clientId, type, nextRun, frequency, email, intervalDays } = req.body;

    if (!clientId || !nextRun || !frequency || !email) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
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
      .input('email', sql.VarChar(4000), email)
      .input('intervalDays', sql.Int, intervalDays || 1)
      .query(`
        INSERT INTO _Datos.dbo.m_reportes_automaticos 
        (rep_iidcuenta, rep_ntipo, rep_tproximoenvio, rep_nfrecuencia, rep_cmail, rep_nCadaUnidadTiempo)
        OUTPUT INSERTED.rep_idKey
        VALUES (@clientId, @type, @nextRun, @frequency, @email, @intervalDays)
      `);

    const clientResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query('SELECT cue_cnombre AS ClientName FROM _Datos.dbo.m_cuentas WHERE cue_iid = @clientId');

    res.status(201).json({
      success: true,
      message: 'Schedule created successfully',
      schedule: {
        id: insertResult.recordset[0].rep_idKey,
        clientId: clientId,
        clientName: clientResult.recordset[0]?.ClientName || `Client ${clientId}`,
        type: type || 1,
        nextRun: nextRun,
        frequency: frequency,
        email: email,
        intervalDays: intervalDays || 1,
        status: 1,
        timezone: TZ
      }
    });

  } catch (error) {
    console.error('❌ Error creating schedule:', error);
    res.status(500).json({ success: false, message: 'Database error', error: error.message });
  }
};

export const deleteSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const scheduleId = parseInt(id);
    
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid schedule ID' });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, scheduleId)
      .query('DELETE FROM _Datos.dbo.m_reportes_automaticos WHERE rep_idKey = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: 'Schedule not found' });
    }

    res.status(200).json({ success: true, message: 'Schedule deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting schedule:', error);
    res.status(500).json({ success: false, message: 'Database error', error: error.message });
  }
};

/**
 * 🚀 MANUAL TRIGGERS
 */
export const triggerDynamicReports = async (req, res) => {
  try {
    console.log('🔧 Manual trigger for dynamic reports...');
    await triggerDynamicReportsNow();
    
    res.status(200).json({
      success: true,
      message: 'Dynamic reports triggered successfully'
    });
  } catch (error) {
    console.error('❌ Error triggering dynamic reports:', error);
    res.status(500).json({ success: false, message: 'Failed to trigger reports', error: error.message });
  }
};

export const triggerPatrolReports = async (req, res) => {
  try {
    console.log('🔧 Manual trigger for patrol reports...');
    await triggerPatrolReportsNow();
    
    res.status(200).json({
      success: true,
      message: 'Patrol reports triggered successfully'
    });
  } catch (error) {
    console.error('❌ Error triggering patrol reports:', error);
    res.status(500).json({ success: false, message: 'Failed to trigger reports', error: error.message });
  }
};

/**
 * 📊 ENHANCED CLIENT REPORT - Main Report Generation Endpoint
 */
export const sendEnhancedClientReport = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { startDate, endDate, recipientEmail, reportPeriod = 'previousWeek' } = req.body;

    console.log(`\n📤 Generating ${reportPeriod} report for client: ${clientId}`);

    // Determine date range
    let dateRange;
    if (reportPeriod === 'previousWeek') {
      dateRange = getPreviousWeekRange();
    } else if (reportPeriod === 'historical') {
      dateRange = getHistoricalDateRange({ monthsBack: 1 });
    } else {
      dateRange = {
        startDate: startDate || dayjs(DATA_REFERENCE_DATE).subtract(7, 'day').format('YYYY-MM-DD'),
        endDate: endDate || DATA_REFERENCE_DATE,
        sqlStartDate: (startDate ? dayjs(startDate) : dayjs(DATA_REFERENCE_DATE).subtract(7, 'day')).format('YYYY-MM-DD 00:00:00'),
        sqlEndDate: (endDate ? dayjs(endDate) : dayjs(DATA_REFERENCE_DATE)).format('YYYY-MM-DD 23:59:59'),
        rangeLabel: `Custom: ${startDate || dayjs(DATA_REFERENCE_DATE).subtract(7, 'day').format('YYYY-MM-DD')} to ${endDate || DATA_REFERENCE_DATE}`
      };
    }

    console.log(`📅 Using date range: ${dateRange.startDate} to ${dateRange.endDate}`);

    // Get client info
    const pool = await poolPromise;
    const clientResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query('SELECT cue_iid AS ClientID, cue_cnombre AS ClientName, cue_cemail AS ClientEmail FROM _Datos.dbo.m_cuentas WHERE cue_iid = @clientId');

    if (clientResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const client = clientResult.recordset[0];
    console.log(`👤 Client: ${client.ClientName}`);

    // Get recipient email
    let finalRecipientEmail = recipientEmail;
    if (!finalRecipientEmail) {
      const emailResult = await pool.request()
        .input('clientId', sql.Int, clientId)
        .query('SELECT rep_cmail AS ReportEmail FROM _Datos.dbo.m_reportes_automaticos WHERE rep_iidcuenta = @clientId');
      finalRecipientEmail = emailResult.recordset[0]?.ReportEmail || client.ClientEmail || 'jmutisya@bmsecurity.com';
    }

    if (!finalRecipientEmail) {
      return res.status(400).json({ success: false, message: 'No email address found for client' });
    }

    console.log(`📧 Recipient: ${finalRecipientEmail}`);

    // Get patrol data
    let patrolData;
    if (reportPeriod === 'historical') {
      patrolData = await getClientHistoricalPatrols(parseInt(clientId), dateRange.sqlStartDate, dateRange.sqlEndDate);
    } else {
      patrolData = await getClientPatrols(parseInt(clientId), 30);
    }

    // Check for data
    const hasData = (patrolData.pastPatrols && patrolData.pastPatrols.length > 0) || 
                   (patrolData.patrols && patrolData.patrols.length > 0);
    
    if (!hasData) {
      console.log('❌ No patrol data found for the specified period');
      return res.status(404).json({
        success: false,
        message: `No patrol data found for period: ${dateRange.startDate} to ${dateRange.endDate}`
      });
    }

    console.log(`📊 Data loaded: ${patrolData.pastPatrols?.length || patrolData.patrols?.length} patrols`);

    // Prepare data for PDF
    const defaultSchedule = { patrols_per_day: 11, patrol_days: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun' };
    
    const posts = transformPatrolsToPosts(patrolData, defaultSchedule, dateRange);
    const events = transformPatrolsToEvents(patrolData);
    const summary = calculateSummary(patrolData, defaultSchedule, dateRange);

    console.log(`📋 PDF Data Summary:`);
    console.log(`   - Posts: ${posts.length}`);
    console.log(`   - Events: ${events.length}`);

    // Generate PDF using helper function
    console.log('🎨 Generating PDF...');
    const pdfBuffer = await generatePDF(
      {
        clientId: client.ClientID,
        clientName: client.ClientName,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        shiftType: 'Day/Night',
        events: events,
        posts: posts,
        patrols: patrolData.pastPatrols || patrolData.patrols,
        summary: summary
      }, 
      client.ClientName, 
      dateRange
    );

    if (!pdfBuffer) {
      console.error('❌ PDF generation returned null buffer');
      return res.status(500).json({ success: false, message: 'Failed to generate PDF' });
    }

    console.log(`✅ PDF generated successfully: ${Math.round(pdfBuffer.length / 1024)} KB`);

    if (TEST_MODE) {
      console.log(`🚫 [TEST MODE] Would send report to ${finalRecipientEmail}`);
      return res.status(200).json({
        success: true,
        message: 'TEST MODE - Report would have been sent',
        testMode: true,
        details: { 
          client: client.ClientName, 
          email: finalRecipientEmail, 
          period: `${dateRange.startDate} to ${dateRange.endDate}`,
          patrols: summary.totalPatrols,
          posts: posts.length,
          events: events.length
        }
      });
    }

    // Send email using helper function
    console.log(`📤 Sending branded email with logo...`);
    
    await sendPatrolEmail({
      to: finalRecipientEmail,
      client: {
        ClientID: client.ClientID,
        ClientName: client.ClientName
      },
      patrolData: {
        summary: {
          complianceRate: summary.complianceRate,
          completedPatrols: summary.completedPatrols,
          totalExpected: summary.totalExpected,
          scheduleCompliance: summary.complianceRate
        },
        patrols: events
      },
      pdfData: {
        posts: posts,
        events: events,
        summary: summary,
        incidents: events.filter(e => e.rec_calarma?.includes('ALARM')).length
      },
      dateRange: dateRange,
      pdfBuffer: pdfBuffer,
      pdfFilename: `BM_Security_Report_${client.ClientName.replace(/\s+/g, '_')}_${dateRange.startDate}.pdf`
    });

    console.log(`✅ Report successfully sent to ${finalRecipientEmail}`);

    return res.status(200).json({
      success: true,
      message: `Report sent successfully to ${finalRecipientEmail}`,
      details: {
        clientName: client.ClientName,
        email: finalRecipientEmail,
        reportPeriod: `${dateRange.startDate} to ${dateRange.endDate}`,
        patrols: summary.totalPatrols,
        posts: posts.length,
        events: events.length,
        pdfSize: `${Math.round(pdfBuffer.length / 1024)} KB`
      }
    });

  } catch (error) {
    console.error('❌ Error sending client report:', error);
    
    if (error.code === 'ESOCKET' || error.code === 'ETIMEDOUT') {
      console.error(`   Network error - check your internet connection`);
    } else if (error.code === 'EAUTH') {
      console.error(`   Authentication error - check EMAIL_USER and EMAIL_PASS in .env`);
    }
    
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to send report', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * 📈 ANALYTICS & STATUS ENDPOINTS
 */
export const getPatrolReportPreview = async (req, res) => {
  try {
    const { clientId } = req.params;
    const daysRange = parseInt(req.query.days) || 30;

    const pool = await poolPromise;
    const clientResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query('SELECT cue_cnombre AS ClientName FROM _Datos.dbo.m_cuentas WHERE cue_iid = @clientId');

    if (clientResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const client = clientResult.recordset[0];
    const patrolData = await getClientPatrols(parseInt(clientId), daysRange);

    return res.status(200).json({
      success: true,
      data: {
        clientId: parseInt(clientId),
        clientName: client.ClientName,
        summary: patrolData.summary,
        patrols: {
          past: { count: patrolData.pastPatrols?.length || 0, sample: patrolData.pastPatrols?.slice(0, 5) || [] }
        }
      }
    });

  } catch (error) {
    console.error('❌ Error getting patrol preview:', error);
    return res.status(500).json({ success: false, message: 'Failed to get preview', error: error.message });
  }
};

export const getSchedulerStatus = async (req, res) => {
  try {
    const pool = await poolPromise;
    
    const [dueResult, totalResult] = await Promise.all([
      pool.request().query('SELECT COUNT(*) AS DueCount FROM _Datos.dbo.m_reportes_automaticos WHERE rep_tproximoenvio <= GETDATE() AND rep_cmail IS NOT NULL'),
      pool.request().query('SELECT COUNT(*) AS TotalCount FROM _Datos.dbo.m_reportes_automaticos WHERE rep_cmail IS NOT NULL')
    ]);

    const status = {
      schedules: {
        total: totalResult.recordset[0].TotalCount,
        due: dueResult.recordset[0].DueCount
      },
      dataTimeframe: `Using ${DATA_REFERENCE_DATE} as reference`,
      serverTime: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
      timezone: TZ,
      testMode: TEST_MODE,
      emailService: 'Enhanced with BM Security Logo & IPv4 support'
    };

    res.status(200).json({ success: true, status });
  } catch (error) {
    console.error('❌ Error getting scheduler status:', error);
    res.status(500).json({ success: false, message: 'Failed to get status', error: error.message });
  }
};

export const getAllClientsPerformance = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        cue_iid AS ClientID,
        cue_cnombre AS ClientName,
        cue_cemail AS ClientEmail
      FROM _Datos.dbo.m_cuentas
      WHERE cue_iid IN (28, 39, 41, 48)
      ORDER BY cue_cnombre
    `);

    const clients = await Promise.all(
      result.recordset.map(async (client) => {
        const patrolData = await getClientPatrols(client.ClientID, 7);
        return {
          ...client,
          performance: patrolData.summary
        };
      })
    );

    res.status(200).json({
      success: true,
      data: { clients, total: clients.length }
    });
  } catch (error) {
    console.error('❌ Error getting clients performance:', error);
    res.status(500).json({ success: false, message: 'Failed to get performance data', error: error.message });
  }
};

export const getClientAnalyticsData = async (req, res) => {
  try {
    const { clientId } = req.params;
    const daysRange = parseInt(req.query.days) || 30;
    
    const patrolData = await getClientPatrols(clientId, daysRange);
    
    if (!patrolData) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    res.status(200).json({ 
      success: true, 
      data: {
        summary: patrolData.summary,
        recentPatrols: patrolData.pastPatrols?.slice(0, 10) || []
      }
    });
  } catch (error) {
    console.error('❌ Error getting client analytics:', error);
    res.status(500).json({ success: false, message: 'Failed to get analytics', error: error.message });
  }
};

export const testEmailConfiguration = async (req, res) => {
  try {
    const testEmail = process.env.TEST_EMAIL || process.env.EMAIL_USER;
    
    if (!testEmail) {
      return res.status(400).json({ success: false, message: 'No test email configured in environment variables' });
    }

    console.log('🧪 Testing email configuration with enhanced service...');
    
    // Import email service directly
    const emailService = await import('../service/emailService.js');
    
    const sendSimpleEmail = emailService.sendSimpleEmail || emailService.default?.sendSimpleEmail;
    
    if (!sendSimpleEmail) {
      throw new Error('sendSimpleEmail function not found in emailService');
    }
    
    await sendSimpleEmail({
      to: testEmail,
      subject: '📧 Email Configuration Test - BM SECURITY',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c5aa0;">✅ Email Configuration Test Successful</h2>
          <p>Your email configuration is working correctly with the enhanced BM Security email service.</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #495057;">Test Details</h4>
            <p><strong>Test Time:</strong> ${dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')}</p>
            <p><strong>Timezone:</strong> ${TZ}</p>
            <p><strong>Server:</strong> smtp.gmail.com:587</p>
            <p><strong>Test Mode:</strong> ${TEST_MODE ? 'Enabled' : 'Disabled'}</p>
            <p><strong>Email Service:</strong> Enhanced with BM Security Logo & IPv4 support</p>
          </div>
          
          <p style="color: #7f8c8d; font-size: 12px;">
            This is an automated test from your security reporting system.
          </p>
        </div>
      `
    });

    res.status(200).json({
      success: true,
      message: 'Email test completed successfully',
      details: {
        testEmail: testEmail,
        timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        timezone: TZ,
        service: 'Enhanced email service with logo'
      }
    });

  } catch (error) {
    console.error('❌ Email test failed:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Email test failed', 
      error: error.message,
      details: {
        suggestion: 'Check your EMAIL_USER and EMAIL_PASS environment variables. For Gmail, ensure you are using an App Password.'
      }
    });
  }
};

/**
 * 🧪 DIAGNOSTIC ENDPOINT - Check service exports
 */
export const diagnosticServices = async (req, res) => {
  try {
    console.log('🔍 Running service diagnostics...');
    
    // Import services directly
    const pdfService = await import('../service/pdfService.js');
    const emailService = await import('../service/emailService.js');
    
    const diagnostics = {
      pdfService: {
        type: typeof pdfService,
        exports: Object.keys(pdfService),
        default: {
          type: typeof pdfService.default,
          isFunction: typeof pdfService.default === 'function',
          keys: pdfService.default ? Object.keys(pdfService.default) : []
        },
        functions: {}
      },
      emailService: {
        type: typeof emailService,
        exports: Object.keys(emailService),
        default: {
          type: typeof emailService.default,
          isFunction: typeof emailService.default === 'function',
          keys: emailService.default ? Object.keys(emailService.default) : []
        },
        functions: {}
      }
    };
    
    // Check each export in pdfService
    for (const key of Object.keys(pdfService)) {
      diagnostics.pdfService.functions[key] = typeof pdfService[key];
    }
    
    // Check each export in emailService
    for (const key of Object.keys(emailService)) {
      diagnostics.emailService.functions[key] = typeof emailService[key];
    }
    
    console.log('📊 Diagnostics completed');
    
    res.status(200).json({
      success: true,
      diagnostics,
      recommendations: {
        pdfService: diagnostics.pdfService.exports.length === 0 
          ? 'No exports found - check if pdfService.js exists and has exports'
          : 'Exports found - check function names above',
        suggestion: 'Look for functions ending in "PDF" or "Report" in the exports list'
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

/**
 * 🧪 COMPLETE FLOW TEST ENDPOINT
 */
export const testCompleteFlow = async (req, res) => {
  try {
    const { clientId = 28, email, testEmail = true } = req.body;
    
    console.log('🧪 Testing complete flow with enhanced services...');
    
    const patrolData = await getClientPatrols(clientId, 7);
    const dateRange = getPreviousWeekRange();
    const defaultSchedule = { patrols_per_day: 11, patrol_days: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun' };
    
    const events = transformPatrolsToEvents(patrolData);
    const posts = transformPatrolsToPosts(patrolData, defaultSchedule, dateRange);
    const summary = calculateSummary(patrolData, defaultSchedule, dateRange);
    
    console.log(`📊 Test Results:`);
    console.log(`   - Patrols found: ${patrolData.pastPatrols?.length || 0}`);
    console.log(`   - Events transformed: ${events.length}`);
    console.log(`   - Posts transformed: ${posts.length}`);
    console.log(`   - Valid events: ${events.filter(e => e.rec_tfechahora).length}`);
    
    let emailResult = null;
    if (testEmail && email) {
      const emailService = await import('../service/emailService.js');
      const sendSimpleEmail = emailService.sendSimpleEmail || emailService.default?.sendSimpleEmail;
      
      if (sendSimpleEmail) {
        emailResult = await sendSimpleEmail({
          to: email,
          subject: '🧪 Complete Flow Test - BM SECURITY',
          html: `
            <div style="font-family: Arial, sans-serif;">
              <h2 style="color: #2c5aa0;">🧪 Complete Flow Test</h2>
              <p><strong>Data Transformation:</strong> ✅ Successful</p>
              <p><strong>Patrols Processed:</strong> ${patrolData.pastPatrols?.length || 0}</p>
              <p><strong>Events Created:</strong> ${events.length}</p>
              <p><strong>Posts Created:</strong> ${posts.length}</p>
              <p><strong>Summary:</strong> ${summary.complianceRate} compliance</p>
              <p><strong>Time:</strong> ${dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')}</p>
              <p><strong>Test Mode:</strong> ${TEST_MODE ? 'Enabled' : 'Disabled'}</p>
              <p><strong>Email Service:</strong> Enhanced with BM Security Logo & IPv4 support</p>
            </div>
          `
        });
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Complete flow test successful',
      data: {
        patrols: patrolData.pastPatrols?.length || 0,
        events: events.length,
        posts: posts.length,
        summary: summary,
        emailTest: email ? (TEST_MODE ? 'test_mode' : 'sent') : 'skipped',
        testMode: TEST_MODE
      },
      emailResult: emailResult
    });
    
  } catch (error) {
    console.error('❌ Complete flow test failed:', error);
    res.status(500).json({
      success: false,
      message: 'Test failed',
      error: error.message,
      testMode: TEST_MODE
    });
  }
};

export default {
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  createSchedule,
  deleteSchedule,
  triggerDynamicReports,
  triggerPatrolReports,
  sendEnhancedClientReport,
  getPatrolReportPreview,
  getSchedulerStatus,
  getAllClientsPerformance,
  getClientAnalyticsData,
  testEmailConfiguration,
  testCompleteFlow,
  diagnosticServices,
  getHistoricalDateRange,
  getClientHistoricalPatrols,
  getClientPatrols,
  getPreviousWeekRange,
  transformPatrolsToPosts,
  transformPatrolsToEvents,
  calculateSummary
};