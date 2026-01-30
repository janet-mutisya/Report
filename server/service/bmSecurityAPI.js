// server/service/bmSecurityAPI.js - PRODUCTION READY WITH FLEXIBLE VALIDATION
const dotenv = require('dotenv');
const path = require('path');
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');
const minMax = require('dayjs/plugin/minMax.js');
const axios = require('axios');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(minMax);

const axiosInstance = axios.create({
  withCredentials: true,
  validateStatus: (status) => status < 500,
  timeout: 600000,
  maxRedirects: 5,
  maxContentLength: 100 * 1024 * 1024,
  maxBodyLength: 100 * 1024 * 1024
});

// Cache for API results with TTL
const rawCache = new Map();
const accountResolutionCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Concurrency limiter for parallel chunk fetching
class ConcurrencyLimiter {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.queue = [];
    this.active = 0;
  }

  async run(fn) {
    return new Promise((resolve, reject) => {
      const task = async () => {
        this.active++;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.active--;
          this.processQueue();
        }
      };

      if (this.active < this.maxConcurrent) {
        task();
      } else {
        this.queue.push(task);
      }
    });
  }

  processQueue() {
    while (this.queue.length > 0 && this.active < this.maxConcurrent) {
      const task = this.queue.shift();
      task();
    }
  }
}

class BMSecurityAPI {
  constructor() {
    this.baseURL = process.env.BMSECURITY_API_URL || 'https://bmsecurity.ultrasecuritysolution.com';
    this.token = null;
    this.tokenExpiry = null;
    this.loginPromise = null;
    this.cookies = null;
    
    this.requestTimeout = parseInt(process.env.API_REQUEST_TIMEOUT) || 600000;
    this.loginTimeout = parseInt(process.env.API_LOGIN_TIMEOUT) || 60000;
    this.maxRetries = parseInt(process.env.API_MAX_RETRIES) || 3;
    
    this.credentials = {
      username: process.env.BM_API_USER,
      password: process.env.BM_API_PASSWORD,
      clientid: process.env.BM_API_CLIENT_ID
    };

    this.limiter = new ConcurrencyLimiter(
      parseInt(process.env.API_PARALLEL_CHUNKS) || 3
    );

    console.log('⚡ BMSecurity API Service initialized (FLEXIBLE VALIDATION)');
    console.log(`  Base URL: ${this.baseURL}`);
    console.log(`  Request timeout: ${this.requestTimeout}ms`);
    console.log(`  Max retries: ${this.maxRetries}`);
    console.log(`  Parallel chunks: ${this.limiter.maxConcurrent}`);
    
    this.accountMapping = {
      'A011': '011',
      'A012': '012',
      'A028': '028',
      'A039': '039',
      'A041': '041',
      'A048': '048'
    };

    // Stats tracking
    this.stats = {
      totalRawEvents: 0,
      totalValidEvents: 0,
      totalDedupedEvents: 0,
      malformedRemoved: 0,
      duplicatesRemoved: 0,
      byMalformedReason: {
        missingTimestamp: 0,
        invalidTimestamp: 0,
        missingZone: 0,
        missingClientId: 0,
        missingAlarmCode: 0
      },
      byDuplicateReason: {
        exact: 0,
        sameSecond: 0,
        sameMinute: 0
      }
    };

    // Clean old cache entries periodically
    setInterval(() => this.cleanExpiredCache(), 5 * 60 * 1000);
  }

  /**
   * 🔐 Login to BMSecurity API
   */
  async login() {
    try {
      console.log('🔐 BMSecurity API: Attempting login...');
      
      if (!this.credentials.username || !this.credentials.password || !this.credentials.clientid) {
        throw new Error('BMSecurity API credentials not configured in .env file');
      }

      const loginEndpoint = `${this.baseURL}:443/handler/RemoteLoginHandler`;
      
      const axiosConfig = {
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: this.loginTimeout,
        withCredentials: true
      };

      if (this.cookies) {
        axiosConfig.headers['Cookie'] = this.cookies.join('; ');
      }

      const response = await axiosInstance.post(
        `${loginEndpoint}?oauth_token`,
        {
          username: this.credentials.username,
          password: this.credentials.password,
          clientid: this.credentials.clientid
        },
        axiosConfig
      );

      let token = response.data.oauth_token || 
                  response.data.token || 
                  response.data.access_token ||
                  response.data.data?.oauth_token;

      if (!token && response.data) {
        const keys = Object.keys(response.data);
        const tokenKey = keys.find(k => k.toLowerCase().includes('oauth') || k.toLowerCase() === 'token');
        if (tokenKey) {
          token = response.data[tokenKey];
        }
      }
      
      if (!token) {
        throw new Error('No token received from API response');
      }
      
      this.token = token;
      this.tokenExpiry = Date.now() + (55 * 60 * 1000);
      
      console.log('✅ BMSecurity API: Logged in successfully');
      
      return this.token;
      
    } catch (error) {
      console.error('❌ BMSecurity API: Login failed:', error.message);
      throw new Error(`API Login failed: ${error.message}`);
    }
  }

  /**
   * 🔄 Ensure we have a valid token
   */
  async ensureAuthenticated() {
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    if (!this.loginPromise) {
      console.log('🔐 Creating shared login promise...');
      this.loginPromise = this.login()
        .finally(() => {
          this.loginPromise = null;
        });
    }

    await this.loginPromise;
    return this.token;
  }

  /**
   * ✅ Inclusive end-of-day boundary
   */
  formatDate(date, isEnd = false) {
    if (isEnd) {
      return dayjs(date)
        .tz('Africa/Nairobi')
        .add(1, 'day')
        .startOf('day')
        .format('MM-DD-YYYY HH:mm:ss');
    } else {
      return dayjs(date)
        .tz('Africa/Nairobi')
        .startOf('day')
        .format('MM-DD-YYYY HH:mm:ss');
    }
  }

  /**
   * 🔍 DEBUG: Analyze timestamp formats
   */
  debugTimestampFormats(events, sampleSize = 5) {
    if (!Array.isArray(events) || events.length === 0) return;
    
    const samples = [];
    const formats = new Set();
    
    for (let i = 0; i < Math.min(events.length, sampleSize); i++) {
      const timestamp = events[i]?.rec_tfechahora;
      if (timestamp) {
        samples.push(timestamp);
        formats.add(this.detectTimestampFormat(timestamp));
      }
    }
    
    if (samples.length > 0) {
      console.log(`🔍 Timestamp format analysis:`);
      console.log(`   Sample timestamps (${samples.length}):`);
      samples.forEach((ts, i) => {
        const format = this.detectTimestampFormat(ts);
        console.log(`     ${i + 1}. "${ts}" → Format: ${format}`);
      });
      console.log(`   Detected formats: ${Array.from(formats).join(', ')}`);
    }
  }

  /**
   * 🔍 Detect timestamp format
   */
  detectTimestampFormat(timestamp) {
    if (!timestamp || typeof timestamp !== 'string') return 'INVALID';
    
    const trimmed = timestamp.trim();
    
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      return 'YYYY-MM-DD HH:MM:SS';
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmed)) {
      return 'ISO8601';
    } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+$/.test(trimmed)) {
      return 'YYYY-MM-DD HH:MM:SS.millis';
    } else if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      return 'MM/DD/YYYY HH:MM:SS';
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return 'YYYY-MM-DD';
    } else if (/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      return 'DD-MM-YYYY HH:MM:SS';
    } else {
      return 'UNKNOWN';
    }
  }

  /**
   * 🛡️ FLEXIBLE VALIDATE AND FILTER MALFORMED EVENTS
   * Key fix: Accepts various timestamp formats and is more permissive
   */
  validateAndFilterEvents(events) {
    if (!Array.isArray(events) || events.length === 0) {
      return { validEvents: [], stats: { total: 0, valid: 0, removed: 0 } };
    }

    const validEvents = [];
    const stats = {
      total: events.length,
      valid: 0,
      removed: 0,
      reasons: {
        missingTimestamp: 0,
        invalidTimestamp: 0,
        missingZone: 0,
        missingClientId: 0,
        missingAlarmCode: 0
      }
    };

    // 🔍 First, debug the incoming data
    if (stats.total > 0) {
      this.debugTimestampFormats(events, 3);
    }

    for (const event of events) {
      let isValid = true;
      let missingFields = [];

      // ✅ FLEXIBLE TIMESTAMP CHECK
      const timestamp = event.rec_tfechahora;
      if (!timestamp || timestamp.trim() === '' || timestamp.toLowerCase() === 'null') {
        isValid = false;
        missingFields.push('timestamp');
        stats.reasons.missingTimestamp++;
      } else {
        // Accept various timestamp formats
        const trimmedTimestamp = timestamp.trim();
        
        // Check if it has at least date part (minimum YYYY-MM-DD)
        const hasDatePattern = 
          /^\d{4}-\d{2}-\d{2}/.test(trimmedTimestamp) ||  // YYYY-MM-DD
          /^\d{2}\/\d{2}\/\d{4}/.test(trimmedTimestamp) || // MM/DD/YYYY
          /^\d{2}-\d{2}-\d{4}/.test(trimmedTimestamp);     // DD-MM-YYYY
        
        if (!hasDatePattern) {
          isValid = false;
          missingFields.push('validTimestamp');
          stats.reasons.invalidTimestamp++;
        }
      }

      // ✅ FLEXIBLE ZONE CHECK
      const zone = String(event.rec_czona || '').trim();
      if (!zone || zone === '' || zone.toLowerCase() === 'null' || zone === '0') {
        // Mark as invalid but don't necessarily reject if we have other valid data
        missingFields.push('zone');
        stats.reasons.missingZone++;
        // We'll allow it but mark it
        event.rec_czona = 'UNKNOWN_ZONE';
      }

      // ✅ FLEXIBLE CLIENT ID CHECK
      const clientId = String(event.rec_iidcuenta || event.cue_iid || '').trim();
      if (!clientId || clientId === '' || clientId === '0') {
        missingFields.push('clientId');
        stats.reasons.missingClientId++;
        event.rec_iidcuenta = 'UNKNOWN_CLIENT';
      }

      // ✅ FLEXIBLE ALARM CODE CHECK
      const alarmCode = String(event.rec_calarma || '').trim().toUpperCase();
      if (!alarmCode || alarmCode === '' || alarmCode.toLowerCase() === 'null') {
        missingFields.push('alarmCode');
        stats.reasons.missingAlarmCode++;
        event.rec_calarma = 'UNKNOWN_ALARM';
      }

      // ✅ ACCEPT EVENTS WITH TIMESTAMP AND AT LEAST ONE OTHER FIELD
      // This is more permissive than before
      const hasTimestamp = timestamp && timestamp.trim() !== '' && timestamp.toLowerCase() !== 'null';
      const hasEssentialData = zone !== 'UNKNOWN_ZONE' || clientId !== 'UNKNOWN_CLIENT' || alarmCode !== 'UNKNOWN_ALARM';
      
      if (hasTimestamp && hasEssentialData) {
        validEvents.push(event);
        stats.valid++;
      } else {
        stats.removed++;
      }
    }

    // Update global stats
    this.stats.totalRawEvents += events.length;
    this.stats.totalValidEvents += stats.valid;
    this.stats.malformedRemoved += stats.removed;
    
    Object.keys(stats.reasons).forEach(reason => {
      this.stats.byMalformedReason[reason] += stats.reasons[reason];
    });

    return { validEvents, stats };
  }

  /**
   * 🧼 IMPROVED DEDUPLICATION - Handles flexible timestamps
   */
  dedupeValidEvents(validEvents) {
    if (!Array.isArray(validEvents) || validEvents.length === 0) {
      return { dedupedEvents: [], stats: { total: 0, deduped: 0, removed: 0 } };
    }

    const seen = new Map();
    const dedupedEvents = [];
    const stats = {
      total: validEvents.length,
      deduped: 0,
      removed: 0,
      reasons: {
        exact: 0,
        sameSecond: 0,
        sameMinute: 0
      }
    };

    for (const event of validEvents) {
      try {
        // Extract fields
        const timestamp = event.rec_tfechahora;
        const zone = String(event.rec_czona || '').trim();
        const clientId = String(event.rec_iidcuenta || event.cue_iid || '').trim();
        const alarmCode = String(event.rec_calarma || '').trim().toUpperCase();
        const eventId = String(event.rec_iid || event.rec_id || '').trim();

        // ✅ Extract timestamp parts safely
        let timestampToSecond = '';
        let timestampToMinute = '';
        
        try {
          // Try to parse the timestamp
          const dateStr = timestamp.trim();
          
          // Handle different timestamp formats
          let parsedDate;
          if (dateStr.includes('T')) {
            // ISO format
            parsedDate = new Date(dateStr);
          } else if (dateStr.includes('/')) {
            // MM/DD/YYYY format
            const parts = dateStr.split(' ');
            const dateParts = parts[0].split('/');
            if (dateParts.length === 3) {
              const timePart = parts[1] || '00:00:00';
              parsedDate = new Date(`${dateParts[2]}-${dateParts[0]}-${dateParts[1]} ${timePart}`);
            }
          } else {
            // Try standard parsing
            parsedDate = new Date(dateStr);
          }
          
          if (parsedDate && !isNaN(parsedDate.getTime())) {
            const year = parsedDate.getFullYear();
            const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
            const day = String(parsedDate.getDate()).padStart(2, '0');
            const hours = String(parsedDate.getHours()).padStart(2, '0');
            const minutes = String(parsedDate.getMinutes()).padStart(2, '0');
            const seconds = String(parsedDate.getSeconds()).padStart(2, '0');
            
            timestampToSecond = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
            timestampToMinute = `${year}-${month}-${day} ${hours}:${minutes}`;
          }
        } catch (parseError) {
          // If we can't parse, use raw string (truncated)
          timestampToSecond = timestamp.substring(0, 19);
          timestampToMinute = timestamp.substring(0, 16);
        }

        // ✅ LEVEL 1: Exact duplicate check (same event ID)
        if (eventId && eventId !== '' && eventId !== '0' && eventId !== 'UNKNOWN_CLIENT') {
          const exactKey = `ID:${eventId}`;
          if (seen.has(exactKey)) {
            stats.reasons.exact++;
            stats.removed++;
            continue;
          }
          seen.set(exactKey, true);
        }

        // ✅ LEVEL 2: Same-second duplicate check
        if (timestampToSecond) {
          const secondKey = [
            timestampToSecond,
            zone,
            clientId,
            alarmCode
          ].join('|');
          
          if (seen.has(secondKey)) {
            stats.reasons.sameSecond++;
            stats.removed++;
            continue;
          }
          seen.set(secondKey, true);
        }

        // ✅ LEVEL 3: Same-minute duplicate check
        if (timestampToMinute) {
          const minuteKey = [
            timestampToMinute,
            zone,
            clientId,
            alarmCode
          ].join('|');
          
          if (seen.has(minuteKey)) {
            stats.reasons.sameMinute++;
            stats.removed++;
            continue;
          }
          seen.set(minuteKey, true);
        }

        // ✅ This event is unique
        dedupedEvents.push(event);
        stats.deduped++;

      } catch (error) {
        // Skip problematic events
        stats.removed++;
        continue;
      }
    }

    // Update global stats
    this.stats.totalDedupedEvents += stats.deduped;
    this.stats.duplicatesRemoved += stats.removed;
    
    Object.keys(stats.reasons).forEach(reason => {
      this.stats.byDuplicateReason[reason] += stats.reasons[reason];
    });

    return { dedupedEvents, stats };
  }

  /**
   * 🔄 Process events with validation AND deduplication
   */
  processEvents(events) {
    if (events.length === 0) {
      console.log(`🔄 No events to process`);
      return [];
    }
    
    console.log(`\n🔄 Processing ${events.length} raw events...`);
    
    // Step 1: Filter out malformed data
    const validationResult = this.validateAndFilterEvents(events);
    
    if (validationResult.stats.removed > 0) {
      const removedPercent = (validationResult.stats.removed / validationResult.stats.total * 100).toFixed(1);
      console.log(`🛡️ Data Validation: ${validationResult.stats.total} raw → ${validationResult.stats.valid} valid (-${validationResult.stats.removed}, ${removedPercent}% filtered)`);
      
      // Log specific issues if significant
      if (removedPercent > 50) {
        console.log(`   Malformed breakdown:`);
        Object.entries(validationResult.stats.reasons).forEach(([reason, count]) => {
          if (count > 0) {
            console.log(`     ${reason}: ${count}`);
          }
        });
      }
    } else {
      console.log(`🛡️ Data Validation: All ${validationResult.stats.total} events accepted`);
    }

    // Step 2: Deduplicate valid events
    const dedupeResult = this.dedupeValidEvents(validationResult.validEvents);
    
    if (dedupeResult.stats.removed > 0) {
      const dupPercent = (dedupeResult.stats.removed / dedupeResult.stats.total * 100).toFixed(1);
      console.log(`🧼 Deduplication: ${dedupeResult.stats.total} valid → ${dedupeResult.stats.deduped} unique (-${dedupeResult.stats.removed}, ${dupPercent}% duplicates)`);
      
      if (dupPercent > 10) {
        console.log(`   Duplicate breakdown: Exact=${dedupeResult.stats.reasons.exact}, SameSecond=${dedupeResult.stats.reasons.sameSecond}, SameMinute=${dedupeResult.stats.reasons.sameMinute}`);
      }
    } else {
      console.log(`🧼 Deduplication: ${dedupeResult.stats.total} valid → ${dedupeResult.stats.deduped} unique (0% duplicates)`);
    }

    console.log(`✅ Final result: ${events.length} raw → ${dedupeResult.dedupedEvents.length} clean events`);
    
    return dedupeResult.dedupedEvents;
  }

  /**
   * 🔢 Account number variants
   */
  generateAccountVariants(accountNumber) {
    if (!accountNumber) return [''];
    
    const original = String(accountNumber).trim();
    const variants = new Set([original, '']);

    if (this.accountMapping[original]) {
      variants.add(this.accountMapping[original]);
    }

    const numericMatch = original.match(/^[A-Za-z]+(\d+)$/);
    if (numericMatch) {
      variants.add(numericMatch[1]);
    }

    return Array.from(variants);
  }

  /**
   * 🔄 Fetch with retry on abort/timeout
   */
  async fetchWithRetry(fn, maxRetries = 3, retryDelay = 2000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`  🔄 Attempt ${attempt}/${maxRetries}...`);
        return await fn();
      } catch (error) {
        lastError = error;
        
        const isRetryable = 
          error.message?.includes('aborted') ||
          error.message?.includes('timeout') ||
          error.message?.includes('ECONNRESET') ||
          error.code === 'ECONNABORTED';
        
        if (isRetryable && attempt < maxRetries) {
          const delay = retryDelay * attempt;
          console.warn(`  ⚠️ ${error.message}, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * 🚀 FETCH BY RANGE - WITH IMPROVED DEBUGGING
   */
  async fetchPatrolEventsRange(accountVariant, start, end, chunkIndex = 0) {
    await this.ensureAuthenticated();

    const dateRange = `${dayjs(start).format('MMM D')} → ${dayjs(end).format('MMM D')}`;
    console.log(`  📦 Chunk ${chunkIndex + 1}: ${dateRange} (${accountVariant || 'all'})`);

    return await this.fetchWithRetry(async () => {
      let page = 1;
      const limit = 5000;
      const allEvents = [];
      let hasMoreData = true;
      let consecutiveEmptyPages = 0;

      while (hasMoreData) {
        const params = {
          Cuentas: accountVariant,
          CodigosAlarmaExcluir: '',
          FechaDesde: this.formatDate(start, false),
          FechaHasta: this.formatDate(end, true),
          Mostrar: limit,
          OrdenarFecha: 'ASC',
          page: page,
          start: (page - 1) * limit,
          limit: limit,
          sort: JSON.stringify([{ property: 'rec_tfechahora', direction: 'ASC' }]),
          oauth_token: this.token
        };

        try {
          const response = await axiosInstance.get(
            `${this.baseURL}/Rest/Search/ReporteHistorico`,
            { 
              params,
              headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              timeout: this.requestTimeout
            }
          );

          const events = response.data?.data || response.data?.rows || [];
          
          // 🔍 Diagnostic: Analyze first page
          if (page === 1 && events.length > 0) {
            console.log(`    📊 First page raw: ${events.length} events`);
            
            // Debug sample events
            if (events.length > 0) {
              console.log(`    Sample event structure:`);
              console.log(`      Timestamp: "${events[0].rec_tfechahora}"`);
              console.log(`      Zone: "${events[0].rec_czona}"`);
              console.log(`      Alarm: "${events[0].rec_calarma}"`);
              console.log(`      Client: "${events[0].rec_iidcuenta}"`);
            }
            
            // Quick analysis of alarm codes
            const alarmCodes = events.map(e => String(e.rec_calarma || '').trim().toUpperCase()).filter(c => c);
            const alarmCodeCounts = {};
            alarmCodes.forEach(code => {
              alarmCodeCounts[code] = (alarmCodeCounts[code] || 0) + 1;
            });
            
            const topCodes = Object.entries(alarmCodeCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5);
            
            console.log(`    Top alarm codes:`);
            topCodes.forEach(([code, count]) => {
              console.log(`      ${code}: ${count} events`);
            });
          }
          
          if (events.length === 0) {
            consecutiveEmptyPages++;
            if (consecutiveEmptyPages >= 2) {
              hasMoreData = false;
              break;
            }
          } else {
            consecutiveEmptyPages = 0;
            
            // 🛡️ Process each page (validate + dedupe)
            const pageEvents = this.processEvents(events);
            allEvents.push(...pageEvents);
            
            if (page === 1) {
              console.log(`    📥 Page ${page}: ${events.length} raw → ${pageEvents.length} clean`);
            }
          }

          if (events.length < limit) {
            hasMoreData = false;
          } else {
            page++;
            await new Promise(r => setTimeout(r, 200));
          }
        } catch (pageError) {
          if (pageError.message?.includes('aborted') || 
              pageError.message?.includes('timeout') ||
              pageError.code === 'ECONNABORTED') {
            throw pageError;
          }
          
          console.error(`    ⚠️ Page ${page} failed: ${pageError.message}`);
          hasMoreData = false;
        }
      }

      console.log(`    ✅ Chunk ${chunkIndex + 1}: ${allEvents.length} clean events`);
      return allEvents;
    }, this.maxRetries);
  }

  /**
   * 🚀 MAIN FETCHING METHOD - OPTIMIZED
   */
  async getPatrolEvents(accountNumber, startDate, endDate) {
    // Reset stats for this request
    this.resetStatsForRequest();
    
    const cacheKey = [
      accountNumber || 'ALL',
      dayjs(startDate).tz('Africa/Nairobi').format('YYYY-MM-DD'),
      dayjs(endDate).tz('Africa/Nairobi').format('YYYY-MM-DD')
    ].join('_');
    
    const cached = rawCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('📦 Serving from cache:', cacheKey);
      return { ...cached.data, cached: true };
    }

    await this.ensureAuthenticated();

    console.log(`\n🚀 FETCHING: ${startDate} → ${endDate}`);
    console.log(`  Account: ${accountNumber || 'All accounts'}`);

    const accountVariants = this.generateAccountVariants(accountNumber);
    const allEvents = [];
    let resolvedAccount = null;

    let cursor = dayjs(startDate).tz('Africa/Nairobi').startOf('day');
    const endDateObj = dayjs(endDate).tz('Africa/Nairobi').endOf('day');
    const daysInRange = endDateObj.diff(cursor, 'day');

    const chunks = [];
    const CHUNK_SIZE_DAYS = 3;
    
    while (cursor.isBefore(endDateObj) || cursor.isSame(endDateObj, 'day')) {
      const chunkStart = cursor.toDate();
      const potentialEnd = cursor.add(CHUNK_SIZE_DAYS - 1, 'day');
      const chunkEnd = dayjs.min(potentialEnd, endDateObj).toDate();
      chunks.push([chunkStart, chunkEnd]);
      cursor = dayjs(chunkEnd).add(1, 'day');
    }

    console.log(`📊 Processing ${daysInRange} days in ${chunks.length} chunks`);

    if (accountNumber) {
      const cacheKey = `account_resolution_${accountNumber}`;
      const cachedResolution = accountResolutionCache.get(cacheKey);
      
      if (cachedResolution && Date.now() - cachedResolution.timestamp < 5 * 60 * 1000) {
        resolvedAccount = cachedResolution.variant;
        console.log(`✅ Using cached account variant: ${resolvedAccount}`);
      } else {
        for (const variant of accountVariants) {
          try {
            const testEvents = await this.fetchPatrolEventsRange(variant, chunks[0][0], chunks[0][1], 0);
            if (testEvents.length > 0) {
              resolvedAccount = variant;
              allEvents.push(...testEvents);
              console.log(`✅ Resolved account variant: ${variant} (${testEvents.length} events)`);
              
              accountResolutionCache.set(cacheKey, {
                variant: resolvedAccount,
                timestamp: Date.now()
              });
              break;
            }
          } catch (error) {
            console.log(`  ⚠️ Variant ${variant} failed: ${error.message}`);
          }
        }
        
        if (!resolvedAccount) {
          console.log('⚠️ No variant worked, using first variant');
          resolvedAccount = accountVariants[0];
          
          accountResolutionCache.set(cacheKey, {
            variant: resolvedAccount,
            timestamp: Date.now()
          });
        }
      }
    } else {
      resolvedAccount = '';
      console.log('✅ No account filter - fetching all accounts');
    }

    const chunksToFetch = accountNumber && resolvedAccount && chunks.length > 1
      ? chunks.slice(1)
      : accountNumber && resolvedAccount && chunks.length === 1
      ? []
      : chunks;

    console.log(`📋 Chunks to fetch: ${chunksToFetch.length}/${chunks.length}`);

    if (chunksToFetch.length > 0) {
      const chunkPromises = chunksToFetch.map(([chunkStart, chunkEnd], index) => {
        const actualChunkIndex = accountNumber && resolvedAccount && chunks.length > 1 ? index + 1 : index;
        return this.limiter.run(() => 
          this.fetchPatrolEventsRange(resolvedAccount, chunkStart, chunkEnd, actualChunkIndex)
        );
      });

      const chunkResults = await Promise.allSettled(chunkPromises);
      
      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          allEvents.push(...result.value);
        } else {
          console.error('❌ Chunk failed:', result.reason.message);
        }
      }
    }

    // 🔥 FINAL PROCESSING
    console.log(`\n🎯 FINAL PROCESSING`);
    console.log(`📈 Raw events collected: ${allEvents.length}`);
    
    const finalEvents = this.processEvents(allEvents);
    
    const daysCovered = new Set(
      finalEvents.map(e => {
        const dateStr = e.rec_tfechahora;
        if (!dateStr) return 'unknown';
        try {
          // Try to parse the date
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            return dayjs(date).tz('Africa/Nairobi').format('YYYY-MM-DD');
          }
        } catch (e) {
          // Try to extract just the date part
          const dateMatch = dateStr.match(/\d{4}-\d{2}-\d{2}/);
          if (dateMatch) return dateMatch[0];
        }
        return 'unknown';
      }).filter(d => d !== 'unknown')
    );
    
    console.log(`\n📊 REQUEST SUMMARY`);
    console.log(`📅 Days requested: ${daysInRange}`);
    console.log(`📅 Days with events: ${daysCovered.size}`);
    console.log(`📈 Total clean events: ${finalEvents.length}`);
    
    // Log overall stats
    console.log(`\n📊 DATA QUALITY STATS`);
    const totalProcessed = this.stats.totalRawEvents;
    const malformedPercent = totalProcessed > 0 ? (this.stats.malformedRemoved / totalProcessed * 100).toFixed(1) : 0;
    const duplicatePercent = this.stats.totalValidEvents > 0 ? (this.stats.duplicatesRemoved / this.stats.totalValidEvents * 100).toFixed(1) : 0;
    
    console.log(`🛡️ Malformed data removed: ${this.stats.malformedRemoved}/${totalProcessed} (${malformedPercent}%)`);
    console.log(`🧼 Duplicates removed: ${this.stats.duplicatesRemoved}/${this.stats.totalValidEvents} (${duplicatePercent}%)`);
    
    if (daysCovered.size < daysInRange / 2) {
      console.warn(`⚠️  Only ${daysCovered.size}/${daysInRange} days have events`);
    }

    const result = {
      success: true,
      data: finalEvents,
      total: finalEvents.length,
      daysCovered: daysCovered.size,
      daysRequested: daysInRange,
      accountUsed: resolvedAccount,
      hasCompleteCoverage: daysCovered.size === daysInRange,
      chunks: chunks.length,
      stats: {
        rawEvents: this.stats.totalRawEvents,
        validEvents: this.stats.totalValidEvents,
        cleanEvents: this.stats.totalDedupedEvents,
        malformedRemoved: this.stats.malformedRemoved,
        duplicatesRemoved: this.stats.duplicatesRemoved,
        malformedRate: malformedPercent,
        duplicateRate: duplicatePercent
      },
      cached: false
    };

    rawCache.set(cacheKey, {
      data: { ...result, cached: true },
      timestamp: Date.now()
    });
    
    return result;
  }

  /**
   * Reset stats for new request
   */
  resetStatsForRequest() {
    this.stats = {
      totalRawEvents: 0,
      totalValidEvents: 0,
      totalDedupedEvents: 0,
      malformedRemoved: 0,
      duplicatesRemoved: 0,
      byMalformedReason: {
        missingTimestamp: 0,
        invalidTimestamp: 0,
        missingZone: 0,
        missingClientId: 0,
        missingAlarmCode: 0
      },
      byDuplicateReason: {
        exact: 0,
        sameSecond: 0,
        sameMinute: 0
      }
    };
  }

  /**
   * 👤 Fetch account information by specific account number
   */
  async getAccountByNumber(accountNumber) {
    await this.ensureAuthenticated();
    
    const variants = this.generateAccountVariants(accountNumber);
    
    for (const variant of variants) {
      try {
        const params = {
          page: 1,
          start: 0,
          limit: 50,
          sort: JSON.stringify([{ property: 'cue_ncuenta', direction: 'ASC' }]),
          filter: JSON.stringify([]), // REMOVED RESTRICTIVE FILTERS
          oauth_token: this.token
        };

        const response = await axiosInstance.get(
          `${this.baseURL}/Rest/Search/CuentaByDealer`,
          { params, timeout: 15000 }
        );

        const accounts = response.data?.data || response.data?.rows || [];
        if (accounts.length > 0) {
          return { success: true, data: accounts, account: accounts[0], accountUsed: variant };
        }
      } catch (error) {
        continue;
      }
    }

    return { success: false, data: [], error: 'Account not found' };
  }

  /**
   * 🔍 Fetch all accounts - NO LIMIT VERSION (fetches ALL accounts without restrictive filters)
   */
  async getAllAccounts() {
    await this.ensureAuthenticated();
    
    console.log('🔍 Fetching ALL accounts from BMSecurity API (NO RESTRICTIVE FILTERS)...');
    
    try {
      const allAccounts = [];
      let page = 1;
      const limit = 1000;
      let hasMore = true;
      let totalFetched = 0;
      let totalExpected = null;
      
      while (hasMore) {
        const params = {
          page: page,
          start: (page - 1) * limit,
          limit: limit,
          sort: JSON.stringify([{ property: 'cue_iid', direction: 'ASC' }]), // ✅ CORRECT: Sort by ID
          // ✅ FIX #1: REMOVED RESTRICTIVE FILTERS - fetching ALL clients
          filter: JSON.stringify([]), // Empty filter = fetch everything
          oauth_token: this.token
        };

        console.log(`  📄 Fetching page ${page} (records ${(page - 1) * limit + 1} to ${page * limit})...`);

        const response = await axiosInstance.get(
          `${this.baseURL}/Rest/Search/CuentaByDealer`,
          { 
            params, 
            timeout: 45000,
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            }
          }
        );

        const accounts = response.data?.data || response.data?.rows || [];
        
        // ✅ FIX #2: Log totals properly
        console.log({
          page,
          returned: accounts.length,
          totalFromAPI: response.data?.total
        });
        
        // Get total count on first page if available
        if (totalExpected === null && response.data?.total !== undefined) {
          totalExpected = parseInt(response.data.total);
          console.log(`  📊 Total accounts expected: ${totalExpected}`);
        }
        
        if (accounts.length === 0) {
          console.log(`  ⚠️ Page ${page} returned 0 accounts`);
          hasMore = false;
          break;
        }
        
        allAccounts.push(...accounts);
        totalFetched += accounts.length;
        
        console.log(`  ✅ Page ${page}: ${accounts.length} accounts (Total fetched: ${totalFetched}${totalExpected ? `/${totalExpected}` : ''})`);
        
        // Continue until we get all accounts
        // If we know total expected, stop when we have them all
        if (totalExpected !== null) {
          hasMore = totalFetched < totalExpected;
        } else {
          // If we don't know total, stop when we get less than limit
          hasMore = accounts.length >= limit;
        }
        
        if (hasMore) {
          page++;
          // Add longer delay between pages for large fetches
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      console.log(`✅ Successfully fetched ALL ${totalFetched} accounts from API`);
      
      // Cache the result
      rawCache.set('all_accounts_full', {
        data: allAccounts,
        timestamp: Date.now()
      });
      
      return { 
        success: true, 
        data: allAccounts, 
        total: allAccounts.length,
        pagesFetched: page - 1,
        totalExpected: totalExpected
      };
      
    } catch (error) {
      console.error('❌ Failed to fetch all accounts:', error.message);
      console.error('   Error stack:', error.stack);
      return { 
        success: false, 
        data: [], 
        error: error.message 
      };
    }
  }

  /**
   * 🧪 Test connection with duplicate diagnostics
   */
  async testConnection() {
    try {
      await this.ensureAuthenticated();
      const today = dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
      const yesterday = dayjs().tz('Africa/Nairobi').subtract(1, 'day').format('YYYY-MM-DD');
      
      console.log('\n🧪 Running connection test with data validation...');
      const result = await this.getPatrolEvents('', yesterday, today);
      
      return {
        success: true,
        token: this.token ? `Valid (55min buffer)` : 'Invalid',
        eventsCount: result.total,
        daysCovered: result.daysCovered,
        stats: result.stats,
        message: 'Flexible validation API: Accepts various timestamp formats'
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        stats: this.stats 
      };
    }
  }

  /**
   * 🧹 Clean expired cache entries
   */
  cleanExpiredCache() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of rawCache.entries()) {
      if (now - value.timestamp > CACHE_TTL) {
        rawCache.delete(key);
        cleaned++;
      }
    }
    
    for (const [key, value] of accountResolutionCache.entries()) {
      if (now - value.timestamp > 5 * 60 * 1000) {
        accountResolutionCache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} expired cache entries`);
    }
  }

  /**
   * 🗑️ Clear cache and reset stats
   */
  clearCache() {
    const rawSize = rawCache.size;
    const resolutionSize = accountResolutionCache.size;
    
    rawCache.clear();
    accountResolutionCache.clear();
    this.resetStatsForRequest();
    
    console.log(`🗑️ Cleared cache (${rawSize + resolutionSize} entries) and reset stats`);
    return { 
      cleared: rawSize + resolutionSize,
      rawCache: rawSize,
      accountResolutionCache: resolutionSize
    };
  }

  /**
   * 📊 Get cache stats
   */
  getCacheStats() {
    return {
      rawCache: {
        size: rawCache.size,
        keys: Array.from(rawCache.keys()).slice(0, 10)
      },
      accountResolutionCache: {
        size: accountResolutionCache.size
      },
      processingStats: this.stats
    };
  }

  /**
   * 📈 Get detailed stats report
   */
  getStatsReport() {
    const totalProcessed = this.stats.totalRawEvents;
    const malformedPercent = totalProcessed > 0 ? (this.stats.malformedRemoved / totalProcessed * 100).toFixed(1) : 0;
    const duplicatePercent = this.stats.totalValidEvents > 0 ? (this.stats.duplicatesRemoved / this.stats.totalValidEvents * 100).toFixed(1) : 0;
    
    return {
      summary: {
        totalRawEvents: this.stats.totalRawEvents,
        totalValidEvents: this.stats.totalValidEvents,
        totalCleanEvents: this.stats.totalDedupedEvents,
        efficiency: totalProcessed > 0 ? ((this.stats.totalDedupedEvents / totalProcessed) * 100).toFixed(1) + '%' : '0%'
      },
      malformedData: {
        totalRemoved: this.stats.malformedRemoved,
        percentage: malformedPercent + '%',
        breakdown: this.stats.byMalformedReason
      },
      duplicates: {
        totalRemoved: this.stats.duplicatesRemoved,
        percentage: duplicatePercent + '%',
        breakdown: this.stats.byDuplicateReason
      },
      dataQuality: {
        malformedRate: malformedPercent,
        duplicateRate: duplicatePercent,
        overallQuality: malformedPercent < 20 && duplicatePercent < 20 ? 'GOOD' : 
                       malformedPercent < 50 && duplicatePercent < 30 ? 'MODERATE' : 'POOR'
      }
    };
  }

  addAccountMapping(alphanumeric, numeric) {
    this.accountMapping[alphanumeric] = numeric;
    console.log(`➕ Added account mapping: ${alphanumeric} → ${numeric}`);
  }

  logout() {
    this.token = null;
    this.tokenExpiry = null;
    this.loginPromise = null;
    console.log('👋 BMSecurity API: Logged out');
  }

  /**
   * 👥 Get clients (with caching) - Fetches ALL clients without limits
   */
  async getClients() {
    try {
      const cacheKey = 'all_clients';
      const cached = rawCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        console.log('📦 Serving clients from cache');
        return cached.data;
      }
      
      console.log('👥 Fetching ALL clients from BMSecurity API (no limits)...');
      
      const accountsResult = await this.getAllAccounts();
      
      if (!accountsResult.success || !accountsResult.data) {
        throw new Error('Failed to fetch accounts from API');
      }
      
      console.log(`🔄 Transforming ${accountsResult.data.length} accounts to client format...`);
      
      // ✅ FIX #3: Temporarily REMOVE filter to debug missing names
      const clients = accountsResult.data.map(account => ({
        id: account.cue_iid || account.id,
        name: account.cue_cnombre || account.name || 'Unknown Client',
        email: account.cue_cemail || account.email || '',
        accountNumber: (account.cue_ncuenta || account.accountNumber || '').trim(),
        active: account.cue_bactivo !== undefined ? account.cue_bactivo : true,
        phone: account.cue_ctelefono || '',
        address: account.cue_cdireccion || '',
        city: account.cue_cciudad || '',
        // Additional fields for better identification
        dealerId: account.cue_iiddealer,
        partition: account.cue_nparticion,
        accountType: account.tip_nTipo,
        // Debug fields to understand data
        rawAccount: account // Keep raw data for debugging
      }));
      // ✅ Temporarily REMOVE filter to see ALL accounts
      // .filter(client => client.name !== 'Unknown Client'); // ⚠️ COMMENTED OUT FOR DEBUGGING
      
      console.log(`✅ Successfully transformed ${clients.length} clients`);
      
      // Log statistics about data quality
      const unknownCount = clients.filter(c => c.name === 'Unknown Client').length;
      const activeCount = clients.filter(c => c.active).length;
      const inactiveCount = clients.filter(c => !c.active).length;
      
      console.log(`📊 Client Statistics:`);
      console.log(`   Total: ${clients.length}`);
      console.log(`   Active: ${activeCount}`);
      console.log(`   Inactive: ${inactiveCount}`);
      console.log(`   Unknown Name: ${unknownCount} (${((unknownCount / clients.length) * 100).toFixed(1)}%)`);
      
      // Log sample of clients for debugging
      if (clients.length > 0) {
        console.log(`📋 Sample clients (first 10):`);
        clients.slice(0, 10).forEach((client, i) => {
          console.log(`  ${i + 1}. "${client.name}" (${client.accountNumber}) - Active: ${client.active}, Type: ${client.accountType}, Partition: ${client.partition}`);
        });
        
        // Log some unknown clients to understand what's missing
        const unknownClients = clients.filter(c => c.name === 'Unknown Client').slice(0, 5);
        if (unknownClients.length > 0) {
          console.log(`❓ Sample Unknown Clients (why they're missing names):`);
          unknownClients.forEach((client, i) => {
            console.log(`  ${i + 1}. Account#: ${client.accountNumber}, ID: ${client.id}, Has cue_cnombre: ${!!client.rawAccount?.cue_cnombre}`);
          });
        }
      }
      
      rawCache.set(cacheKey, {
        data: clients,
        timestamp: Date.now()
      });
      
      return clients;
      
    } catch (error) {
      console.error('❌ Error in getClients:', error.message);
      throw error;
    }
  }
} // <-- Class closes HERE

const apiInstance = new BMSecurityAPI();
module.exports = apiInstance;