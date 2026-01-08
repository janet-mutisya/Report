// server/routes/eventsRoutes.js - FULLY FIXED VERSION
import express from 'express';
import { sql, poolPromise } from '../config/database.js';
import dayjs from 'dayjs';
import bmSecurityAPI from '../service/bmSecurityAPI.js';

const router = express.Router();

// =============================================
// CONFIGURATION
// =============================================
const CONFIG = {
  API_ENABLED: process.env.USE_BMSECURITY_API === 'true' || false,
  TZ_OFFSET: 6, // CST timezone offset (UTC-6)
  DEFAULT_HOURS: 24,
  MAX_EVENTS: 500
};

// =============================================
// HELPER: Get dynamic table name based on date
// =============================================
function getTableName(date) {
  return `p_recepcion${dayjs(date).format('YYYYMM')}`;
}

// =============================================
// HELPER: Convert date to CST for database
// =============================================
function toCST(date) {
  return dayjs(date).subtract(CONFIG.TZ_OFFSET, 'hour');
}

// =============================================
// HELPER: Parse API event into standard format
// =============================================
function parseAPIEvent(apiEvent) {
  return {
    rec_iid: apiEvent.Id || apiEvent.cue_iid,
    rec_iidcuenta: apiEvent.cue_iid,
    rec_tfechahora: apiEvent.sta_dfechautimaalarma,
    rec_czona: apiEvent.cue_ncuenta,
    rec_calarma: apiEvent.sta_cultimaalarma || 'V04',
    rec_cContenido: apiEvent.cod_cdescripcion || 'VIGICONTROL Event',
    clientName: apiEvent.cue_cnombre,
    accountNumber: apiEvent.cue_ncuenta,
    location: apiEvent.cue_cLatLng,
    dataSource: 'BMSecurity API',
    rawData: apiEvent
  };
}

/**
 * GET /api/events/live
 * Fetch live VIGICONTROL events with automatic failover
 */
router.get('/live', async (req, res) => {
  try {
    const { 
      clientId, 
      hours = CONFIG.DEFAULT_HOURS, 
      startDate, 
      endDate,
      source = 'auto' // 'database', 'api', or 'auto'
    } = req.query;
    
    console.log('\n📡 Fetching live events...', { 
      clientId, 
      hours, 
      startDate, 
      endDate, 
      source,
      apiEnabled: CONFIG.API_ENABLED 
    });
    
    let events = [];
    let dataSource = 'unknown';
    let errorMessages = [];

    // =============================================
    // CALCULATE TIME RANGE
    // =============================================
    let actualStartDate, actualEndDate;
    
    if (startDate && endDate) {
      actualStartDate = new Date(startDate);
      actualEndDate = new Date(endDate);
    } else {
      actualEndDate = new Date();
      actualStartDate = new Date(actualEndDate.getTime() - (parseInt(hours) * 60 * 60 * 1000));
    }
    
    console.log('⏰ Time range:', {
      start: actualStartDate.toISOString(),
      end: actualEndDate.toISOString(),
      hoursCovered: (actualEndDate - actualStartDate) / (1000 * 60 * 60)
    });

    // =============================================
    // OPTION 1: BMSecurity API (if enabled and requested)
    // =============================================
    if ((source === 'api' || source === 'auto') && CONFIG.API_ENABLED) {
      console.log('🔌 Attempting BMSecurity API fetch...');
      
      try {
        // Use the service we built with proper authentication
        const apiResult = await bmSecurityAPI.getPatrolEvents(
          clientId ? parseInt(clientId) : null,
          actualStartDate,
          actualEndDate
        );

        if (apiResult.success && apiResult.data && apiResult.data.length > 0) {
          events = apiResult.data.map(event => ({
            rec_iid: event.rec_iid || event.Id || Math.random().toString(36).substr(2, 9),
            rec_iidcuenta: event.rec_iidcuenta || event.cue_iid,
            rec_tfechahora: event.rec_tfechahora || event.sta_dfechautimaalarma,
            rec_czona: event.rec_czona || event.cue_ncuenta,
            rec_calarma: event.rec_calarma || event.sta_cultimaalarma || 'V04',
            rec_cContenido: event.rec_cContenido || event.cod_cdescripcion || 'VIGICONTROL Event',
            clientName: event.clientName || event.cue_cnombre,
            accountNumber: event.accountNumber || event.cue_ncuenta,
            location: event.location || event.cue_cLatLng,
            dataSource: 'BMSecurity API',
            rawData: event
          }));

          dataSource = 'api';
          console.log(`✅ API returned ${events.length} events`);
        } else {
          console.log('⚠️ API returned no data or failed');
          errorMessages.push('API returned no data');
          
          if (source === 'api') {
            // User explicitly requested API, don't fallback
            throw new Error('BMSecurity API returned no data');
          }
        }
      } catch (apiError) {
        console.error('❌ API error:', apiError.message);
        errorMessages.push(`API Error: ${apiError.message}`);
        
        if (source === 'api') {
          throw apiError; // Don't fallback if API was explicitly requested
        }
      }
    }

    // =============================================
    // OPTION 2: Database (fallback or direct)
    // =============================================
    if (events.length === 0 || source === 'database') {
      console.log('💾 Fetching from database...');
      
      try {
        const pool = await poolPromise;
        
        // Convert dates to CST for database query
        const dbStartDate = toCST(actualStartDate).format('YYYY-MM-DD HH:mm:ss');
        const dbEndDate = toCST(actualEndDate).format('YYYY-MM-DD HH:mm:ss');
        
        // Get correct table name for the date range
        const tableName = getTableName(actualStartDate);
        const tableName2 = getTableName(actualEndDate);
        
        console.log(`   Database range (CST): ${dbStartDate} to ${dbEndDate}`);
        console.log(`   Table(s): ${tableName} ${tableName !== tableName2 ? `and ${tableName2}` : ''}`);

        // Build query for primary table
        let query = `
          SELECT TOP ${CONFIG.MAX_EVENTS}
            rec.rec_iid,
            rec.rec_iidcuenta,
            DATEADD(HOUR, 6, rec.rec_tfechahora) as rec_tfechahora, -- Convert CST to UTC
            rec.rec_czona,
            rec.rec_calarma,
            rec.rec_cContenido,
            cue.cue_cnombre AS clientName,
            cue.cue_ncuenta AS accountNumber
          FROM [_Datos].[dbo].[${tableName}] rec
          LEFT JOIN [_Datos].[dbo].[m_cuentas] cue ON rec.rec_iidcuenta = cue.cue_iid
          WHERE DATEADD(HOUR, 6, rec.rec_tfechahora) BETWEEN @startDate AND @endDate
            AND (
              rec.rec_calarma IN ('V03','V04','V05','V08','V20','V21','V26')
              OR rec.rec_cContenido LIKE '%VIGICONTROL%'
            )
        `;
        
        // If range spans two months, UNION with second table
        if (tableName !== tableName2) {
          query = `
            ${query}
            UNION ALL
            SELECT TOP ${CONFIG.MAX_EVENTS}
              rec.rec_iid,
              rec.rec_iidcuenta,
              DATEADD(HOUR, 6, rec.rec_tfechahora) as rec_tfechahora,
              rec.rec_czona,
              rec.rec_calarma,
              rec.rec_cContenido,
              cue.cue_cnombre AS clientName,
              cue.cue_ncuenta AS accountNumber
            FROM [_Datos].[dbo].[${tableName2}] rec
            LEFT JOIN [_Datos].[dbo].[m_cuentas] cue ON rec.rec_iidcuenta = cue.cue_iid
            WHERE DATEADD(HOUR, 6, rec.rec_tfechahora) BETWEEN @startDate AND @endDate
              AND (
                rec.rec_calarma IN ('V03','V04','V05','V08','V20','V21','V26')
                OR rec.rec_cContenido LIKE '%VIGICONTROL%'
              )
          `;
        }
        
        // Add client filter if specified
        if (clientId) {
          query = query.replace(/WHERE DATEADD/g, 'AND rec.rec_iidcuenta = @clientId\n            WHERE DATEADD');
        }
        
        query += ` ORDER BY rec_tfechahora DESC`;
        
        const request = pool.request()
          .input('startDate', sql.DateTime, actualStartDate)
          .input('endDate', sql.DateTime, actualEndDate);
        
        if (clientId) {
          request.input('clientId', sql.Int, parseInt(clientId));
        }
        
        const result = await request.query(query);
        
        events = result.recordset.map(event => ({
          ...event,
          dataSource: 'Database',
          rec_tfechahora: event.rec_tfechahora ? new Date(event.rec_tfechahora).toISOString() : null
        }));
        
        dataSource = 'database';
        console.log(`✅ Database returned ${events.length} events`);
        
      } catch (dbError) {
        console.error('❌ Database error:', dbError.message);
        errorMessages.push(`Database Error: ${dbError.message}`);
        
        if (source === 'database') {
          throw dbError;
        }
      }
    }

    // =============================================
    // POST-PROCESSING
    // =============================================
    // Filter by clientId if not already filtered in query
    if (clientId && dataSource === 'api') {
      events = events.filter(event => 
        event.rec_iidcuenta && event.rec_iidcuenta.toString() === clientId.toString()
      );
    }
    
    // Sort by date (most recent first)
    events.sort((a, b) => {
      const dateA = new Date(a.rec_tfechahora);
      const dateB = new Date(b.rec_tfechahora);
      return dateB - dateA;
    });

    // =============================================
    // RESPONSE
    // =============================================
    res.status(200).json({
      success: true,
      events: events.slice(0, CONFIG.MAX_EVENTS),
      total: events.length,
      metadata: {
        dataSource: dataSource,
        apiEnabled: CONFIG.API_ENABLED,
        clientId: clientId || 'all',
        timeRange: {
          start: actualStartDate.toISOString(),
          end: actualEndDate.toISOString(),
          hours: parseInt(hours)
        },
        requestedSource: source,
        timestamp: new Date().toISOString(),
        errors: errorMessages.length > 0 ? errorMessages : undefined
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching live events:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch live events',
      error: error.message,
      hint: 'Try source=database or check API configuration'
    });
  }
});

/**
 * GET /api/events/accounts
 * Get all active VigiControl accounts from API
 */
router.get('/accounts', async (req, res) => {
  try {
    console.log('\n📋 Fetching active accounts...');

    if (!CONFIG.API_ENABLED) {
      return res.status(200).json({
        success: false,
        message: 'BMSecurity API is not enabled',
        hint: 'Set USE_BMSECURITY_API=true in .env file'
      });
    }

    // Try to get accounts through our service
    const apiResult = await bmSecurityAPI.getAccounts();
    
    if (!apiResult.success) {
      throw new Error(apiResult.error || 'Failed to fetch accounts');
    }

    res.status(200).json({
      success: true,
      total: apiResult.data?.length || 0,
      accounts: apiResult.data || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error fetching accounts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch accounts',
      error: error.message
    });
  }
});

/**
 * GET /api/events/stats
 * Get event statistics with automatic failover
 */
router.get('/stats', async (req, res) => {
  try {
    const { hours = CONFIG.DEFAULT_HOURS } = req.query;
    console.log(`\n📊 Fetching statistics (last ${hours} hours)...`);

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - (parseInt(hours) * 60 * 60 * 1000));
    
    let stats = {
      total: 0,
      activeClients: 0,
      guardReports: 0,
      arrivals: 0,
      departures: 0,
      dataSource: 'unknown',
      timestamp: new Date().toISOString()
    };

    // Try API first if enabled
    if (CONFIG.API_ENABLED) {
      try {
        const apiResult = await bmSecurityAPI.getPatrolEvents(null, startDate, endDate);
        
        if (apiResult.success && apiResult.data) {
          const events = apiResult.data;
          const uniqueClients = new Set(events.map(e => e.rec_iidcuenta || e.cue_iid));
          
          stats.total = events.length;
          stats.activeClients = uniqueClients.size;
          stats.guardReports = events.filter(e => 
            (e.rec_calarma || e.sta_cultimaalarma) === 'V03'
          ).length;
          stats.arrivals = events.filter(e => 
            (e.rec_calarma || e.sta_cultimaalarma) === 'V04'
          ).length;
          stats.departures = events.filter(e => 
            (e.rec_calarma || e.sta_cultimaalarma) === 'V05'
          ).length;
          stats.dataSource = 'api';
          
          console.log(`✅ Stats from API: ${stats.total} events, ${stats.activeClients} clients`);
        }
      } catch (apiError) {
        console.error('❌ API stats error:', apiError.message);
      }
    }

    // Fallback to database if API failed or not enabled
    if (stats.dataSource === 'unknown' || stats.total === 0) {
      try {
        const pool = await poolPromise;
        const tableName = getTableName(startDate);
        
        const dbStartDate = toCST(startDate).format('YYYY-MM-DD HH:mm:ss');
        const dbEndDate = toCST(endDate).format('YYYY-MM-DD HH:mm:ss');
        
        const result = await pool.request()
          .input('startDate', sql.DateTime, dbStartDate)
          .input('endDate', sql.DateTime, dbEndDate)
          .query(`
            SELECT 
              COUNT(*) as total,
              COUNT(DISTINCT rec_iidcuenta) as activeClients,
              SUM(CASE WHEN rec_calarma = 'V03' THEN 1 ELSE 0 END) as guardReports,
              SUM(CASE WHEN rec_calarma = 'V04' THEN 1 ELSE 0 END) as arrivals,
              SUM(CASE WHEN rec_calarma = 'V05' THEN 1 ELSE 0 END) as departures
            FROM [_Datos].[dbo].[${tableName}]
            WHERE DATEADD(HOUR, 6, rec_tfechahora) BETWEEN @startDate AND @endDate
              AND (
                rec_calarma IN ('V03','V04','V05','V08','V20','V21','V26')
                OR rec_cContenido LIKE '%VIGICONTROL%'
              )
          `);

        if (result.recordset.length > 0) {
          const dbStats = result.recordset[0];
          stats.total = dbStats.total || 0;
          stats.activeClients = dbStats.activeClients || 0;
          stats.guardReports = dbStats.guardReports || 0;
          stats.arrivals = dbStats.arrivals || 0;
          stats.departures = dbStats.departures || 0;
          stats.dataSource = 'database';
          
          console.log(`✅ Stats from DB: ${stats.total} events, ${stats.activeClients} clients`);
        }
      } catch (dbError) {
        console.error('❌ Database stats error:', dbError.message);
      }
    }

    res.status(200).json({
      success: true,
      stats: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
});

/**
 * GET /api/events/test
 * Test endpoint to verify configuration
 */
router.get('/test', async (req, res) => {
  try {
    // Test database connection
    let dbStatus = 'unknown';
    try {
      const pool = await poolPromise;
      const result = await pool.request().query('SELECT 1 as test');
      dbStatus = result.recordset.length > 0 ? 'connected' : 'no data';
    } catch (dbError) {
      dbStatus = `error: ${dbError.message}`;
    }
    
    // Test API connection if enabled
    let apiStatus = 'disabled';
    if (CONFIG.API_ENABLED) {
      try {
        await bmSecurityAPI.testConnection();
        apiStatus = 'connected';
      } catch (apiError) {
        apiStatus = `error: ${apiError.message}`;
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Events API is working!',
      config: {
        apiEnabled: CONFIG.API_ENABLED,
        timezoneOffset: CONFIG.TZ_OFFSET,
        defaultHours: CONFIG.DEFAULT_HOURS,
        databaseStatus: dbStatus,
        apiStatus: apiStatus
      },
      endpoints: {
        live: '/api/events/live',
        accounts: '/api/events/accounts',
        stats: '/api/events/stats',
        test: '/api/events/test'
      },
      examples: {
        database: '/api/events/live?source=database&hours=6',
        api: '/api/events/live?source=api&hours=6',
        auto: '/api/events/live?source=auto&hours=6',
        client: '/api/events/live?clientId=28&hours=24',
        dateRange: '/api/events/live?startDate=2024-01-15&endDate=2024-01-16'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Test endpoint failed',
      error: error.message
    });
  }
});

export default router;