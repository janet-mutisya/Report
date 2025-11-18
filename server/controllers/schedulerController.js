// server/controllers/schedulerController.js - COMPLETE OFFICE365 SMTP VERSION
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

// Service imports - FIXED: Use dynamic imports when needed
let pdfService = null;
let emailService = null;

/**
 * 🔧 SERVICE LOADER - Fixed to avoid top-level await
 */
const loadServices = async () => {
  try {
    const pdfModule = await import('../service/pdfService.js');
    pdfService = pdfModule.default || pdfModule;
    console.log('✅ PDF Service loaded successfully');
  } catch (error) {
    console.error('❌ PDF Service failed to load:', error.message);
    pdfService = null;
  }

  try {
    const emailModule = await import('../service/emailService.js');
    emailService = emailModule.default || emailModule;
    console.log('✅ Email Service loaded successfully');
  } catch (error) {
    console.error('❌ Email Service failed to load:', error.message);
    emailService = null;
  }
};

// Load services on first controller call
let servicesLoaded = false;

/**
 * 📅 DATE RANGE HELPERS
 */
export const getPreviousWeekRange = () => {
  try {
    const dataDate = dayjs(DATA_REFERENCE_DATE).tz(TZ);
    const startOfLastWeek = dataDate.subtract(1, 'week').startOf('isoWeek');
    const endOfLastWeek = dataDate.subtract(1, 'week').endOf('isoWeek');
    
    const range = {
      startDate: startOfLastWeek.format('YYYY-MM-DD'),
      endDate: endOfLastWeek.format('YYYY-MM-DD'),
      sqlStartDate: startOfLastWeek.format('YYYY-MM-DD 00:00:00'),
      sqlEndDate: endOfLastWeek.format('YYYY-MM-DD 23:59:59'),
      weekRange: `Week of ${startOfLastWeek.format('MMM D')} - ${endOfLastWeek.format('MMM D, YYYY')}`,
      rangeLabel: `Week of ${startOfLastWeek.format('MMM D')} - ${endOfLastWeek.format('MMM D, YYYY')}`,
      daysInRange: 7
    };
    
    console.log(`📅 Previous week range: ${range.startDate} to ${range.endDate}`);
    return range;
  } catch (error) {
    console.error('❌ Error calculating previous week range:', error);
    return {
      startDate: '2025-10-06',
      endDate: '2025-10-12',
      sqlStartDate: '2025-10-06 00:00:00',
      sqlEndDate: '2025-10-12 23:59:59',
      rangeLabel: 'Week of Oct 6 - Oct 12, 2025',
      daysInRange: 7
    };
  }
};

export const getHistoricalDateRange = (options = {}) => {
  try {
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

    const daysInRange = finalEndDate.diff(finalStartDate, 'day') + 1;
    
    const range = {
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
        : `Month: ${finalStartDate.format('MMMM YYYY')}`,
      daysInRange: daysInRange
    };
    
    console.log(`📅 Historical range: ${range.startDate} to ${range.endDate} (${daysInRange} days)`);
    return range;
  } catch (error) {
    console.error('❌ Error calculating historical range:', error);
    return {
      startDate: '2025-09-01',
      endDate: '2025-10-17',
      sqlStartDate: '2025-09-01 00:00:00',
      sqlEndDate: '2025-10-17 23:59:59',
      rangeLabel: 'Fallback Range: Sep 1 - Oct 17, 2025',
      daysInRange: 47
    };
  }
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
    
    console.log(`📊 Fetching patrols for client ${clientId} from ${startDate} to ${endDate}`);

    const tableQueries = [
      'p_recepcion202511',
      'p_recepcion202510', 
      'p_recepcion202509',
      'p_recepcion'
    ];

    let patrols = [];
    let lastError = null;

    for (const tableName of tableQueries) {
      try {
        const result = await pool.request()
          .input('clientId', sql.Int, clientId)
          .input('startDate', sql.DateTime, startDate)
          .input('endDate', sql.DateTime, endDate)
          .query(`
            SELECT TOP 1000
              rec_iid AS PatrolID,
              rec_tfechahora AS PatrolDate,
              rec_czona AS ZoneCode,
              rec_calarma AS AlarmType,
              rec_cContenido AS Content
            FROM [_Datos].[dbo].[${tableName}]
            WHERE rec_iidcuenta = @clientId
              AND rec_tfechahora BETWEEN @startDate AND @endDate
              AND (
                rec_calarma LIKE '%VIGICONTROL%'
                OR rec_calarma IN ('V04', 'V08', 'V20', 'V21', 'V26')
              )
            ORDER BY rec_tfechahora DESC
          `);

        if (result.recordset.length > 0) {
          console.log(`✅ Found ${result.recordset.length} patrols in table ${tableName}`);
          patrols = result.recordset;
          break;
        }
      } catch (error) {
        lastError = error;
        console.log(`⚠️ Table ${tableName} not accessible: ${error.message}`);
        continue;
      }
    }

    if (patrols.length === 0 && lastError) {
      throw lastError;
    }

    console.log(`✅ Total patrols found for client ${clientId}: ${patrols.length}`);
    
    return {
      pastPatrols: patrols,
      upcomingPatrols: [],
      summary: {
        totalPatrols: patrols.length,
        completedPatrols: patrols.filter(p => 
          p.AlarmType?.includes('V04') || 
          p.AlarmType?.includes('VIGICONTROL')
        ).length,
        expectedPatrols: daysRange * 11,
        complianceRate: patrols.length > 0 ? `${Math.round((patrols.length / (daysRange * 11)) * 100)}%` : '0%',
        daysAnalyzed: daysRange
      }
    };

  } catch (error) {
    console.error(`❌ Error fetching patrols for client ${clientId}:`, error.message);
    return {
      pastPatrols: [],
      upcomingPatrols: [],
      summary: { 
        totalPatrols: 0, 
        completedPatrols: 0, 
        expectedPatrols: daysRange * 11, 
        complianceRate: '0%',
        daysAnalyzed: daysRange,
        error: error.message
      }
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
          AND (
            rec_calarma LIKE '%VIGICONTROL%'
            OR rec_calarma IN ('V04', 'V08', 'V20', 'V21', 'V26')
          )
        ORDER BY rec.rec_tfechahora DESC
      `);

    const patrols = result.recordset;
    console.log(`✅ Found ${patrols.length} historical patrols for client ${clientId}`);

    const daysInPeriod = Math.max(1, dayjs(endDate).diff(dayjs(startDate), 'day') + 1);
    const expectedPatrols = daysInPeriod * 11;

    return {
      patrols,
      summary: {
        totalPatrols: patrols.length,
        completedPatrols: patrols.filter(p => 
          p.AlarmType?.includes('V04') || 
          p.AlarmType?.includes('VIGICONTROL')
        ).length,
        expectedPatrols: expectedPatrols,
        complianceRate: expectedPatrols > 0 ? `${Math.round((patrols.length / expectedPatrols) * 100)}%` : '0%',
        daysAnalyzed: daysInPeriod
      }
    };

  } catch (error) {
    console.error('❌ Error fetching historical patrols:', error);
    return { 
      patrols: [], 
      summary: { 
        totalPatrols: 0, 
        completedPatrols: 0, 
        expectedPatrols: 0, 
        complianceRate: '0%',
        daysAnalyzed: 0,
        error: error.message
      } 
    };
  }
};

/**
 * 🔄 DATA TRANSFORMATION HELPERS
 */
export const transformPatrolsToPosts = (patrolData, schedule, dateRange) => {
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
          PerformanceRate: '0%',
          ZoneCode: zoneKey
        });
      }
      postsMap.get(zoneKey).ChecksCompleted++;
    });

    const daysInPeriod = dateRange.daysInRange || Math.max(1, dayjs(dateRange.endDate).diff(dayjs(dateRange.startDate), 'day') + 1);
    const patrolsPerDay = schedule?.patrols_per_day || 11;
    const totalExpected = daysInPeriod * patrolsPerDay;
    const expectedPerPost = postsMap.size > 0 ? Math.ceil(totalExpected / postsMap.size) : totalExpected;

    postsMap.forEach(post => {
      post.ExpectedChecks = expectedPerPost;
      const performance = expectedPerPost > 0 ? Math.round((post.ChecksCompleted / expectedPerPost) * 100) : 0;
      post.PerformanceRate = `${performance}%`;
    });

    const posts = Array.from(postsMap.values());
    console.log(`✅ Transformed ${posts.length} posts with ${patrols.length} total patrols`);
    return posts;
  } catch (error) {
    console.error('❌ Error transforming patrols to posts:', error);
    return [];
  }
};

export const transformPatrolsToEvents = (patrolData) => {
  try {
    const patrols = patrolData.patrols || patrolData.pastPatrols || [];
    
    console.log(`🔄 Transforming ${patrols.length} patrols to events...`);
    
    const events = patrols.map((patrol) => {
      const eventDate = patrol.rec_tfechahora || patrol.PatrolDate;
      let formattedDate = 'N/A';
      let formattedTime = 'N/A';
      
      if (eventDate) {
        try {
          const dateObj = dayjs(eventDate).tz(TZ);
          if (dateObj.isValid()) {
            formattedDate = dateObj.format('DD/MM/YYYY');
            formattedTime = dateObj.format('HH:mm:ss');
          }
        } catch (e) {
          console.warn(`Date parse error for: ${eventDate}`, e.message);
        }
      }
      
      return {
        rec_tfechahora: eventDate,
        rec_czona: patrol.rec_czona || patrol.ZoneCode || 'Unknown',
        rec_calarma: patrol.rec_calarma || patrol.AlarmType,
        rec_cContenido: patrol.rec_cContenido || patrol.Content || 'Patrol Check',
        formattedDate: formattedDate,
        formattedTime: formattedTime,
        ZoneName: patrol.ZoneName || `Zone ${patrol.rec_czona || patrol.ZoneCode || 'Unknown'}`
      };
    });

    console.log(`✅ Transformed ${events.length} events with valid dates`);
    
    return events;
  } catch (error) {
    console.error('❌ Error transforming patrols to events:', error);
    return [];
  }
};

export const calculateSummary = (patrolData, schedule, dateRange) => {
  try {
    const patrols = patrolData.patrols || patrolData.pastPatrols || [];
    const posts = transformPatrolsToPosts(patrolData, schedule, dateRange);
    
    const totalCompleted = patrols.length;
    const totalExpected = posts.reduce((sum, post) => sum + post.ExpectedChecks, 0);
    const complianceRate = totalExpected > 0 ? Math.round((totalCompleted / totalExpected) * 100) : 0;
    
    return {
      totalPatrols: totalCompleted,
      completedPatrols: totalCompleted,
      totalExpected: totalExpected,
      complianceRate: `${complianceRate}%`,
      numericCompliance: complianceRate,
      postsCount: posts.length,
      eventsCount: patrols.length,
      performanceLevel: complianceRate >= 90 ? 'EXCELLENT' : 
                      complianceRate >= 80 ? 'GOOD' : 
                      complianceRate >= 70 ? 'SATISFACTORY' : 'NEEDS IMPROVEMENT'
    };
  } catch (error) {
    console.error('❌ Error calculating summary:', error);
    return {
      totalPatrols: 0,
      completedPatrols: 0,
      totalExpected: 0,
      complianceRate: '0%',
      numericCompliance: 0,
      postsCount: 0,
      eventsCount: 0,
      performanceLevel: 'NEEDS IMPROVEMENT'
    };
  }
};

/**
 * 🔧 PDF GENERATION HELPER - IMPROVED
 */
const generatePDF = async (data, clientName, dateRange, reportType = 'patrol') => {
  try {
    console.log(`🔍 Generating PDF for ${reportType} report...`);
    
    if (!pdfService) {
      throw new Error('PDF service is not available. Check pdfService.js file.');
    }
    
    console.log('✅ PDF Service available');
    
    let pdfBuffer;
    const pdfData = {
      clientId: data.clientId,
      clientName: data.clientName || clientName,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      shiftType: data.shiftType || 'Day/Night',
      events: data.events || [],
      posts: data.posts || [],
      patrols: data.patrols || [],
      summary: data.summary || {}
    };
    
    // Try different PDF generation functions with better error handling
    const pdfFunctions = [
      { name: 'generateDashboardPDF', func: pdfService.generateDashboardPDF },
      { name: 'generatePatrolReportPDF', func: pdfService.generatePatrolReportPDF },
      { name: 'generateHistoricalReportPDF', func: pdfService.generateHistoricalReportPDF },
      { name: 'generatePDFReport', func: pdfService.generatePDFReport },
      { name: 'generateReportPDF', func: pdfService.generateReportPDF }
    ];
    
    for (const { name, func } of pdfFunctions) {
      if (func && typeof func === 'function') {
        try {
          console.log(`🔄 Trying PDF function: ${name}`);
          
          if (name === 'generateDashboardPDF') {
            pdfBuffer = await func(pdfData);
          } else if (name === 'generatePDFReport' || name === 'generateReportPDF') {
            // These might have different signatures
            pdfBuffer = await func(pdfData, dateRange);
          } else {
            pdfBuffer = await func(pdfData, clientName, dateRange);
          }
          
          if (pdfBuffer && pdfBuffer.length > 0) {
            console.log(`✅ PDF generated successfully using ${name}: ${Math.round(pdfBuffer.length / 1024)} KB`);
            return pdfBuffer;
          }
        } catch (funcError) {
          console.warn(`⚠️ PDF function ${name} failed:`, funcError.message);
          continue;
        }
      }
    }
    
    throw new Error('All PDF generation functions failed');
    
  } catch (error) {
    console.error('❌ PDF generation error:', error);
    throw new Error(`PDF generation failed: ${error.message}`);
  }
};

/**
 * 🔧 EMAIL SENDING HELPER - OFFICE365 SMTP - IMPROVED
 */
const sendPatrolEmail = async (emailData) => {
  try {
    console.log('🔍 Sending patrol email via Office365 SMTP...');
    
    if (!emailService) {
      throw new Error('Email service is not available. Check emailService.js file and Office365 SMTP configuration.');
    }
    
    console.log('✅ Email Service available - Office365 SMTP configured');
    console.log(`📧 Using Office365 SMTP: ${process.env.EMAIL_HOST}:${process.env.EMAIL_PORT}`);
    console.log(`📧 From: ${process.env.EMAIL_USER}`);
    
    // Ensure services are loaded
    if (!servicesLoaded) {
      await loadServices();
    }
    
    // Try different email sending functions
    const emailFunctions = [
      { name: 'sendPatrolReport', func: emailService.sendPatrolReport },
      { name: 'sendHistoricalReport', func: emailService.sendHistoricalReport },
      { name: 'sendSimpleEmail', func: emailService.sendSimpleEmail }
    ];
    
    for (const { name, func } of emailFunctions) {
      if (func && typeof func === 'function') {
        try {
          console.log(`🔄 Trying email function: ${name}`);
          
          let result;
          if (name === 'sendSimpleEmail') {
            // Fallback to simple email with Office365 configuration
            result = await func({
              to: emailData.to,
              subject: emailData.subject || `Security Report - ${emailData.client.ClientName}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #2c5aa0;">BM Security Patrol Report</h2>
                  <p><strong>Client:</strong> ${emailData.client.ClientName}</p>
                  <p><strong>Period:</strong> ${emailData.dateRange.startDate} to ${emailData.dateRange.endDate}</p>
                  <p><strong>Sent via:</strong> Office365 SMTP Service</p>
                  <p><strong>From:</strong> ${process.env.EMAIL_USER}</p>
                  <p>Please find your security patrol report attached.</p>
                  <hr style="border: 1px solid #e0e0e0; margin: 20px 0;">
                  <p style="color: #666; font-size: 12px;">
                    This email was sent automatically from the BM Security Reporting System.
                  </p>
                </div>
              `,
              attachments: emailData.attachments
            });
          } else {
            result = await func(emailData);
          }
          
          if (result) {
            console.log(`✅ Email sent successfully using ${name} via Office365 SMTP`);
            console.log(`📧 From: ${process.env.EMAIL_USER}`);
            console.log(`📧 To: ${emailData.to}`);
            return result;
          }
        } catch (funcError) {
          console.warn(`⚠️ Email function ${name} failed:`, funcError.message);
          
          // Check for Office365 specific authentication issues
          if (funcError.code === 'EAUTH' || funcError.message.includes('Authentication failed')) {
            console.error('❌ Office365 Authentication Failed - Please check:');
            console.error(`   - EMAIL_USER: ${process.env.EMAIL_USER}`);
            console.error('   - EMAIL_PASS: Correct Office365 password');
            console.error('   - SMTP Settings: smtp.office365.com:587');
            console.error('   - Office365 Security: App passwords may be required');
          }
          continue;
        }
      }
    }
    
    throw new Error('All email sending functions failed - Check Office365 SMTP configuration');
    
  } catch (error) {
    console.error('❌ Email sending error via Office365:', error);
    
    // Provide specific guidance for Office365 issues
    if (error.code === 'EAUTH') {
      error.message += ' - Check Office365 credentials and app password settings';
    } else if (error.message.includes('connection timeout')) {
      error.message += ' - Check firewall settings for Office365 SMTP';
    }
    
    throw error;
  }
};

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

    res.status(200).json({ 
      success: true, 
      total: schedules.length, 
      schedules,
      serverTime: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
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

    const { nextRun, frequency, email, intervalDays } = req.body;

    if (!nextRun || !frequency || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: nextRun, frequency, email' 
      });
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
      return res.status(404).json({ 
        success: false, 
        message: 'Schedule not found' 
      });
    }

    res.status(200).json({
      success: true,
      message: 'Schedule updated successfully',
      updatedFields: { nextRun, frequency, email, intervalDays }
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
    const { clientId, type, nextRun, frequency, email, intervalDays } = req.body;

    if (!clientId || !nextRun || !frequency || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: clientId, nextRun, frequency, email' 
      });
    }

    const pool = await poolPromise;

    // Check if schedule already exists
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

    // Create new schedule
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

    // Get client name
    const clientResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query('SELECT cue_cnombre AS ClientName FROM _Datos.dbo.m_cuentas WHERE cue_iid = @clientId');

    const newScheduleId = insertResult.recordset[0].rep_idKey;

    res.status(201).json({
      success: true,
      message: 'Schedule created successfully',
      schedule: {
        id: newScheduleId,
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

/**
 * 🚀 MANUAL TRIGGERS
 */
export const triggerDynamicReports = async (req, res) => {
  try {
    console.log('🔧 Manual trigger for dynamic reports...');
    
    if (TEST_MODE) {
      console.log('🚫 [TEST MODE] Dynamic reports would be triggered');
      return res.status(200).json({
        success: true,
        message: 'TEST MODE - Dynamic reports would have been triggered',
        testMode: true
      });
    }
    
    await triggerDynamicReportsNow();
    
    res.status(200).json({
      success: true,
      message: 'Dynamic reports triggered successfully',
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
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

export const triggerPatrolReports = async (req, res) => {
  try {
    console.log('🔧 Manual trigger for patrol reports...');
    
    if (TEST_MODE) {
      console.log('🚫 [TEST MODE] Patrol reports would be triggered');
      return res.status(200).json({
        success: true,
        message: 'TEST MODE - Patrol reports would have been triggered',
        testMode: true
      });
    }
    
    await triggerPatrolReportsNow();
    
    res.status(200).json({
      success: true,
      message: 'Patrol reports triggered successfully',
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
    });
  } catch (error) {
    console.error('❌ Error triggering patrol reports:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to trigger reports', 
      error: error.message 
    });
  }
};

/**
 * 📊 ENHANCED CLIENT REPORT - MAIN FIXED ENDPOINT
 */
export const sendEnhancedClientReport = async (req, res) => {
  let pdfBuffer = null;
  
  try {
    const { clientId } = req.params;
    const { startDate, endDate, recipientEmail, reportPeriod = 'previousWeek' } = req.body;

    console.log(`\n📤 Generating ${reportPeriod} report for client: ${clientId}`);

    // Load services if not already loaded
    if (!servicesLoaded) {
      await loadServices();
    }

    // Service availability check
    if (!pdfService) {
      return res.status(500).json({ 
        success: false, 
        message: 'PDF service unavailable',
        error: 'PDF service failed to load. Check pdfService.js file.'
      });
    }

    if (!emailService) {
      return res.status(500).json({ 
        success: false, 
        message: 'Email service unavailable',
        error: 'Email service failed to load. Check emailService.js file and Office365 SMTP configuration.'
      });
    }

    // Determine date range
    let dateRange;
    if (reportPeriod === 'previousWeek') {
      dateRange = getPreviousWeekRange();
    } else if (reportPeriod === 'historical') {
      dateRange = getHistoricalDateRange({ monthsBack: 1 });
    } else if (startDate && endDate) {
      dateRange = {
        startDate: startDate,
        endDate: endDate,
        sqlStartDate: dayjs(startDate).format('YYYY-MM-DD 00:00:00'),
        sqlEndDate: dayjs(endDate).format('YYYY-MM-DD 23:59:59'),
        rangeLabel: `Custom: ${startDate} to ${endDate}`,
        daysInRange: dayjs(endDate).diff(dayjs(startDate), 'day') + 1
      };
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Either reportPeriod or both startDate and endDate are required' 
      });
    }

    console.log(`📅 Using date range: ${dateRange.startDate} to ${dateRange.endDate}`);

    // Get client info
    const pool = await poolPromise;
    const clientResult = await pool.request()
      .input('clientId', sql.Int, clientId)
      .query('SELECT cue_iid AS ClientID, cue_cnombre AS ClientName, cue_cemail AS ClientEmail FROM _Datos.dbo.m_cuentas WHERE cue_iid = @clientId');

    if (clientResult.recordset.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      });
    }

    const client = clientResult.recordset[0];
    console.log(`👤 Client: ${client.ClientName}`);

    // Get recipient email
    let finalRecipientEmail = recipientEmail;
    if (!finalRecipientEmail) {
      const emailResult = await pool.request()
        .input('clientId', sql.Int, clientId)
        .query('SELECT rep_cmail AS ReportEmail FROM _Datos.dbo.m_reportes_automaticos WHERE rep_iidcuenta = @clientId');
      finalRecipientEmail = emailResult.recordset[0]?.ReportEmail || client.ClientEmail || process.env.TEST_EMAIL || 'leavemanagement@bmsecurity.com';
    }

    if (!finalRecipientEmail) {
      return res.status(400).json({ 
        success: false, 
        message: 'No email address found for client' 
      });
    }

    console.log(`📧 Recipient: ${finalRecipientEmail}`);
    console.log(`📧 From: ${process.env.EMAIL_USER}`);

    // Get patrol data
    let patrolData;
    if (reportPeriod === 'historical') {
      patrolData = await getClientHistoricalPatrols(parseInt(clientId), dateRange.sqlStartDate, dateRange.sqlEndDate);
    } else {
      patrolData = await getClientPatrols(parseInt(clientId), dateRange.daysInRange || 30);
    }

    // Check for data
    const hasData = (patrolData.pastPatrols && patrolData.pastPatrols.length > 0) || 
                   (patrolData.patrols && patrolData.patrols.length > 0);
    
    if (!hasData) {
      console.log('❌ No patrol data found for the specified period');
      return res.status(404).json({
        success: false,
        message: `No patrol data found for period: ${dateRange.startDate} to ${dateRange.endDate}`,
        dataReference: DATA_REFERENCE_DATE
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
    console.log(`   - Compliance: ${summary.complianceRate}`);

    // Generate PDF
    console.log('🎨 Generating PDF...');
    pdfBuffer = await generatePDF(
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
      dateRange,
      reportPeriod
    );

    if (!pdfBuffer) {
      console.error('❌ PDF generation returned null buffer');
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to generate PDF' 
      });
    }

    console.log(`✅ PDF generated successfully: ${Math.round(pdfBuffer.length / 1024)} KB`);

    if (TEST_MODE) {
      console.log(`🚫 [TEST MODE] Would send report to ${finalRecipientEmail}`);
      console.log(`📧 From: ${process.env.EMAIL_USER}`);
      return res.status(200).json({
        success: true,
        message: 'TEST MODE - Report would have been sent',
        testMode: true,
        details: { 
          client: client.ClientName, 
          email: finalRecipientEmail, 
          from: process.env.EMAIL_USER,
          period: `${dateRange.startDate} to ${dateRange.endDate}`,
          patrols: summary.totalPatrols,
          posts: posts.length,
          events: events.length,
          compliance: summary.complianceRate,
          pdfSize: `${Math.round(pdfBuffer.length / 1024)} KB`,
          smtp: 'Office365'
        }
      });
    }

    // Send email via Office365 SMTP
    console.log(`📤 Sending email via Office365 SMTP...`);
    console.log(`📧 From: ${process.env.EMAIL_USER}`);
    console.log(`📧 To: ${finalRecipientEmail}`);
    
    await sendPatrolEmail({
      to: finalRecipientEmail,
      client: {
        ClientID: client.ClientID,
        ClientName: client.ClientName
      },
      dateRange: dateRange,
      pdfBuffer: pdfBuffer,
      pdfFilename: `BM_Security_Report_${client.ClientName.replace(/\s+/g, '_')}_${dateRange.startDate}_to_${dateRange.endDate}.pdf`,
      subject: `BM Security Patrol Report - ${client.ClientName} - ${dateRange.startDate} to ${dateRange.endDate}`
    });

    console.log(`✅ Report successfully sent to ${finalRecipientEmail} via Office365 SMTP`);
    console.log(`📧 From: ${process.env.EMAIL_USER}`);

    return res.status(200).json({
      success: true,
      message: `Report sent successfully to ${finalRecipientEmail}`,
      details: {
        clientName: client.ClientName,
        email: finalRecipientEmail,
        fromEmail: process.env.EMAIL_USER,
        reportPeriod: `${dateRange.startDate} to ${dateRange.endDate}`,
        patrols: summary.totalPatrols,
        posts: posts.length,
        events: events.length,
        compliance: summary.complianceRate,
        performance: summary.performanceLevel,
        pdfSize: `${Math.round(pdfBuffer.length / 1024)} KB`,
        smtpProvider: 'Office365',
        timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
      }
    });

  } catch (error) {
    console.error('❌ Error sending client report:', error);
    
    let userMessage = 'Failed to send report';
    let errorDetails = {};
    
    if (error.message.includes('PDF service')) {
      userMessage = 'PDF generation service unavailable';
      errorDetails.suggestion = 'Check pdfService.js file exists and exports functions correctly';
    } else if (error.message.includes('Email service')) {
      userMessage = 'Email service unavailable';
      errorDetails.suggestion = 'Check emailService.js file and Office365 SMTP configuration';
    } else if (error.code === 'EAUTH' || error.message.includes('Authentication failed')) {
      userMessage = 'Office365 email authentication failed';
      errorDetails.suggestion = 'Check EMAIL_USER and EMAIL_PASS in .env file. For Office365, you may need an app password.';
      errorDetails.office365Config = {
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        user: process.env.EMAIL_USER
      };
    } else if (error.message.includes('connection timeout')) {
      userMessage = 'Office365 SMTP connection timeout';
      errorDetails.suggestion = 'Check firewall settings and network connectivity to Office365 SMTP';
    }
    
    return res.status(500).json({ 
      success: false, 
      message: userMessage, 
      error: error.message,
      details: errorDetails,
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
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      });
    }

    const client = clientResult.recordset[0];
    const patrolData = await getClientPatrols(parseInt(clientId), daysRange);

    return res.status(200).json({
      success: true,
      data: {
        clientId: parseInt(clientId),
        clientName: client.ClientName,
        dateRange: {
          days: daysRange,
          startDate: dayjs(DATA_REFERENCE_DATE).subtract(daysRange, 'day').format('YYYY-MM-DD'),
          endDate: DATA_REFERENCE_DATE
        },
        summary: patrolData.summary,
        patrols: {
          past: { 
            count: patrolData.pastPatrols?.length || 0, 
            sample: patrolData.pastPatrols?.slice(0, 5) || [] 
          }
        },
        dataReference: DATA_REFERENCE_DATE
      }
    });

  } catch (error) {
    console.error('❌ Error getting patrol preview:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to get preview', 
      error: error.message 
    });
  }
};

export const getSchedulerStatus = async (req, res) => {
  try {
    // Load services if not already loaded
    if (!servicesLoaded) {
      await loadServices();
    }

    const pool = await poolPromise;
    
    const [dueResult, totalResult, clientsResult] = await Promise.all([
      pool.request().query('SELECT COUNT(*) AS DueCount FROM _Datos.dbo.m_reportes_automaticos WHERE rep_tproximoenvio <= GETDATE() AND rep_cmail IS NOT NULL'),
      pool.request().query('SELECT COUNT(*) AS TotalCount FROM _Datos.dbo.m_reportes_automaticos WHERE rep_cmail IS NOT NULL'),
      pool.request().query('SELECT COUNT(*) AS ClientsCount FROM _Datos.dbo.m_cuentas WHERE cue_iid IN (28, 39, 41, 48)')
    ]);

    const status = {
      schedules: {
        total: totalResult.recordset[0].TotalCount,
        due: dueResult.recordset[0].DueCount,
        active: totalResult.recordset[0].TotalCount - dueResult.recordset[0].DueCount
      },
      clients: {
        total: clientsResult.recordset[0].ClientsCount,
        monitored: [28, 39, 41, 48]
      },
      system: {
        dataTimeframe: `Using ${DATA_REFERENCE_DATE} as reference`,
        serverTime: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        timezone: TZ,
        testMode: TEST_MODE,
        services: {
          pdf: pdfService ? 'Available' : 'Unavailable',
          email: emailService ? 'Available' : 'Unavailable',
          database: 'Connected',
          smtp: {
            provider: 'Office365',
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            user: process.env.EMAIL_USER,
            fromEmail: process.env.FROM_EMAIL || process.env.EMAIL_USER,
            fromName: process.env.FROM_NAME || 'BM Security'
          }
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
        cue_cemail AS ClientEmail
      FROM _Datos.dbo.m_cuentas
      WHERE cue_iid IN (28, 39, 41, 48)
      ORDER BY cue_cnombre
    `);

    const clients = await Promise.all(
      result.recordset.map(async (client) => {
        const patrolData = await getClientPatrols(client.ClientID, 7);
        const summary = calculateSummary(patrolData, { patrols_per_day: 11 }, { daysInRange: 7 });
        
        return {
          ...client,
          performance: summary,
          lastUpdated: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
        };
      })
    );

    res.status(200).json({
      success: true,
      data: { 
        clients, 
        total: clients.length,
        timeframe: 'Last 7 days',
        dataReference: DATA_REFERENCE_DATE
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

export const getClientAnalyticsData = async (req, res) => {
  try {
    const { clientId } = req.params;
    const daysRange = parseInt(req.query.days) || 30;
    
    const patrolData = await getClientPatrols(clientId, daysRange);
    const summary = calculateSummary(patrolData, { patrols_per_day: 11 }, { daysInRange: daysRange });
    
    if (!patrolData) {
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      });
    }
    
    res.status(200).json({ 
      success: true, 
      data: {
        clientId: parseInt(clientId),
        daysAnalyzed: daysRange,
        dateRange: {
          start: dayjs(DATA_REFERENCE_DATE).subtract(daysRange, 'day').format('YYYY-MM-DD'),
          end: DATA_REFERENCE_DATE
        },
        summary: summary,
        recentPatrols: patrolData.pastPatrols?.slice(0, 10) || [],
        dataReference: DATA_REFERENCE_DATE
      }
    });
  } catch (error) {
    console.error('❌ Error getting client analytics:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get analytics', 
      error: error.message 
    });
  }
};

export const testEmailConfiguration = async (req, res) => {
  try {
    const testEmail = process.env.TEST_EMAIL || process.env.EMAIL_USER;
    
    if (!testEmail) {
      return res.status(400).json({ 
        success: false, 
        message: 'No test email configured in environment variables' 
      });
    }

    if (!emailService) {
      return res.status(500).json({ 
        success: false, 
        message: 'Email service unavailable',
        error: 'Email service failed to load'
      });
    }

    console.log('🧪 Testing Office365 email configuration...');
    console.log(`📧 From: ${process.env.EMAIL_USER}`);
    console.log(`📧 To: ${testEmail}`);
    
    if (TEST_MODE) {
      console.log('🚫 [TEST MODE] Email would be sent via Office365 SMTP');
      return res.status(200).json({
        success: true,
        message: 'TEST MODE - Email would have been sent via Office365 SMTP',
        testMode: true,
        details: {
          testEmail: testEmail,
          fromEmail: process.env.EMAIL_USER,
          smtpConfig: {
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            user: process.env.EMAIL_USER
          },
          timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
        }
      });
    }
    
    await emailService.sendSimpleEmail({
      to: testEmail,
      subject: '📧 Office365 Email Configuration Test - BM SECURITY',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c5aa0;">✅ Office365 Email Configuration Test Successful</h2>
          <p>Your Office365 email configuration is working correctly.</p>
          <p><strong>Test Time:</strong> ${dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')}</p>
          <p><strong>SMTP Provider:</strong> Office365</p>
          <p><strong>SMTP Server:</strong> ${process.env.EMAIL_HOST}:${process.env.EMAIL_PORT}</p>
          <p><strong>From Address:</strong> ${process.env.EMAIL_USER}</p>
          <p><strong>To Address:</strong> ${testEmail}</p>
          <p><strong>Service Status:</strong> Enhanced BM Security Email Service</p>
          <p><strong>BobMorgan alerts@bmsecurity.com:</strong> ${process.env.EMAIL_USER}</p>
        </div>
      `
    });

    res.status(200).json({
      success: true,
      message: 'Office365 email test completed successfully',
      details: {
        testEmail: testEmail,
        fromEmail: process.env.EMAIL_USER,
        smtpConfig: {
          host: process.env.EMAIL_HOST,
          port: process.env.EMAIL_PORT,
          user: process.env.EMAIL_USER,
          secure: process.env.EMAIL_SECURE
        },
        bobMorganEmail: process.env.EMAIL_USER,
        timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
      }
    });

  } catch (error) {
    console.error('❌ Office365 email test failed:', error);
    
    let errorDetails = {
      suggestion: 'Check your Office365 credentials and SMTP configuration',
      bobMorganEmail: process.env.EMAIL_USER
    };
    
    if (error.code === 'EAUTH') {
      errorDetails.office365Help = 'For Office365, you may need to use an app password instead of your regular password';
      errorDetails.configCheck = {
        EMAIL_USER: process.env.EMAIL_USER,
        EMAIL_HOST: process.env.EMAIL_HOST,
        EMAIL_PORT: process.env.EMAIL_PORT
      };
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Office365 email test failed', 
      error: error.message,
      details: errorDetails
    });
  }
};

export const diagnosticServices = async (req, res) => {
  try {
    console.log('🔍 Running service diagnostics...');
    
    // Load services if not already loaded
    if (!servicesLoaded) {
      await loadServices();
    }
    
    const diagnostics = {
      pdfService: {
        available: !!pdfService,
        functions: pdfService ? Object.keys(pdfService).filter(key => typeof pdfService[key] === 'function') : []
      },
      emailService: {
        available: !!emailService,
        functions: emailService ? Object.keys(emailService).filter(key => typeof emailService[key] === 'function') : []
      },
      system: {
        nodeVersion: process.version,
        timezone: TZ,
        testMode: TEST_MODE,
        dataReference: DATA_REFERENCE_DATE,
        serverTime: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
      },
      office365Config: {
        EMAIL_HOST: process.env.EMAIL_HOST,
        EMAIL_PORT: process.env.EMAIL_PORT,
        EMAIL_USER: process.env.EMAIL_USER ? '*** configured ***' : '❌ missing',
        EMAIL_PASS: process.env.EMAIL_PASS ? '*** configured ***' : '❌ missing',
        FROM_EMAIL: process.env.FROM_EMAIL,
        FROM_NAME: process.env.FROM_NAME,
        BOB_MORGAN_EMAIL: process.env.EMAIL_USER || 'alerts@bmsecurity.com'
      }
    };
    
    console.log('📊 Diagnostics completed');
    console.log(`📧 BobMorgan alerts@bmsecurity.com Email: ${process.env.EMAIL_USER}`);
    
    res.status(200).json({
      success: true,
      diagnostics,
      recommendations: {
        pdfService: diagnostics.pdfService.available 
          ? `✅ ${diagnostics.pdfService.functions.length} PDF functions available`
          : '❌ PDF service unavailable - check pdfService.js',
        emailService: diagnostics.emailService.available 
          ? `✅ ${diagnostics.emailService.functions.length} email functions available`
          : '❌ Email service unavailable - check emailService.js and Office365 configuration',
        office365: diagnostics.office365Config.EMAIL_USER && diagnostics.office365Config.EMAIL_PASS
          ? '✅ Office365 credentials configured'
          : '❌ Office365 credentials incomplete',
        bobMorganEmail: diagnostics.office365Config.EMAIL_USER 
          ? `✅ BobMorgan alerts@bmsecurity.com: ${process.env.EMAIL_USER}`
          : '❌ BobMorgan email not configured'
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

export const testCompleteFlow = async (req, res) => {
  try {
    const { clientId = 28, email, testEmail = true } = req.body;
    
    console.log('🧪 Testing complete flow with Office365 SMTP...');
    console.log(`📧 BobMorgan alerts@bmsecurity.com: ${process.env.EMAIL_USER}`);
    
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
    console.log(`   - Valid events: ${events.filter(e => e.formattedDate !== 'N/A').length}`);
    console.log(`   - Compliance rate: ${summary.complianceRate}`);
    console.log(`📧 From Email: ${process.env.EMAIL_USER}`);
    
    let emailResult = null;
    let pdfBuffer = null;
    
    // Test PDF generation
    try {
      pdfBuffer = await generatePDF(
        {
          clientId: clientId,
          clientName: `Test Client ${clientId}`,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          events: events,
          posts: posts,
          patrols: patrolData.pastPatrols,
          summary: summary
        },
        `Test Client ${clientId}`,
        dateRange
      );
    } catch (pdfError) {
      console.error('❌ PDF generation test failed:', pdfError.message);
    }
    
    // Test email sending if requested
    if (testEmail && email) {
      try {
        if (emailService && !TEST_MODE) {
          emailResult = await emailService.sendSimpleEmail({
            to: email,
            subject: '🧪 Complete Flow Test - BM SECURITY (Office365)',
            html: `
              <div style="font-family: Arial, sans-serif;">
                <h2 style="color: #2c5aa0;">🧪 Complete Flow Test - Office365 SMTP</h2>
                <p><strong>Data Transformation:</strong> ✅ Successful</p>
                <p><strong>Patrols Processed:</strong> ${patrolData.pastPatrols?.length || 0}</p>
                <p><strong>Events Created:</strong> ${events.length}</p>
                <p><strong>Posts Created:</strong> ${posts.length}</p>
                <p><strong>Compliance Rate:</strong> ${summary.complianceRate}</p>
                <p><strong>Performance Level:</strong> ${summary.performanceLevel}</p>
                <p><strong>PDF Generated:</strong> ${pdfBuffer ? `✅ ${Math.round(pdfBuffer.length / 1024)} KB` : '❌ Failed'}</p>
                <p><strong>SMTP Provider:</strong> Office365</p>
                <p><strong>From Email:</strong> ${process.env.EMAIL_USER}</p>
                <p><strong>BobMorgan alerts@bmsecurity.com :</strong> ${process.env.EMAIL_USER}</p>
                <p><strong>Time:</strong> ${dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')}</p>
                <p><strong>Test Mode:</strong> ${TEST_MODE ? 'Enabled' : 'Disabled'}</p>
              </div>
            `
          });
        } else if (TEST_MODE) {
          emailResult = { testMode: true, message: 'Email would have been sent via Office365 SMTP' };
        }
      } catch (emailError) {
        console.error('❌ Email test failed:', emailError.message);
        emailResult = { error: emailError.message };
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Complete flow test completed',
      data: {
        patrols: patrolData.pastPatrols?.length || 0,
        events: events.length,
        posts: posts.length,
        summary: summary,
        pdfTest: pdfBuffer ? `✅ ${Math.round(pdfBuffer.length / 1024)} KB` : '❌ Failed',
        emailTest: email ? (TEST_MODE ? 'test_mode' : (emailResult && !emailResult.error ? 'sent' : 'failed')) : 'skipped',
        testMode: TEST_MODE,
        smtpProvider: 'Office365',
        fromEmail: process.env.EMAIL_USER,
        bobMorganEmail: process.env.EMAIL_USER,
        timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
      },
      emailResult: emailResult
    });
    
  } catch (error) {
    console.error('❌ Complete flow test failed:', error);
    res.status(500).json({
      success: false,
      message: 'Test failed',
      error: error.message,
      testMode: TEST_MODE,
      smtpProvider: 'Office365',
      fromEmail: process.env.EMAIL_USER,
      bobMorganEmail: process.env.EMAIL_USER,
      timestamp: dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss')
    });
  }
};

// Export ALL functions that your routes need
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
  diagnosticServices,
  testCompleteFlow,
  getHistoricalDateRange,
  getClientHistoricalPatrols,
  getClientPatrols,
  getPreviousWeekRange,
  transformPatrolsToPosts,
  transformPatrolsToEvents,
  calculateSummary
};