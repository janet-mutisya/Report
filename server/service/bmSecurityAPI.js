// server/service/bmSecurityAPI.js - PRODUCTION OPTIMIZED VERSION - FIXED
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import minMax from 'dayjs/plugin/minMax.js';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(minMax);

const axiosInstance = axios.create({
  withCredentials: true,
  validateStatus: (status) => status < 500
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
    this.credentials = {
      username: process.env.BM_API_USER,
      password: process.env.BM_API_PASSWORD,
      clientid: process.env.BM_API_CLIENT_ID
    };

    // Concurrency limiter - 2 parallel chunks max
    this.limiter = new ConcurrencyLimiter(2);

    console.log('⚡ BMSecurity API Service initialized (PRODUCTION OPTIMIZED - FIXED)');
    console.log(`  Base URL: ${this.baseURL}`);
    console.log(`  Parallel chunks: ${this.limiter.maxConcurrent}`);
    
    this.accountMapping = {
      'A011': '011',
      'A012': '012',
      'A028': '028',
      'A039': '039',
      'A041': '041',
      'A048': '048'
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
        timeout: 15000,
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
      this.tokenExpiry = Date.now() + (55 * 60 * 1000); // 55 minutes buffer
      
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
    // If we have a valid token, use it
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    // If login is in progress, wait for it
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
   * 🧼 Proper deduplication
   */
  dedupeBMEvents(events) {
    const seen = new Map();
    const deduped = [];

    for (const event of events) {
      const key = [
        event.rec_tfechahora?.substring(0, 19),
        String(event.rec_czona || '').trim(),
        String(event.rec_iidcuenta || event.cue_iid || '').trim(),
        String(event.rec_ievento || event.rec_icodigo || event.rec_id || event.rec_iid || '').trim()
      ].join('|');

      if (!seen.has(key)) {
        seen.set(key, true);
        deduped.push(event);
      }
    }

    const removalCount = events.length - deduped.length;
    const removalPercent = events.length > 0 ? ((removalCount / events.length) * 100).toFixed(1) : 0;
    
    if (removalCount > 0) {
      console.log(`🧼 Deduplicated: ${events.length} → ${deduped.length} events (-${removalCount}, ${removalPercent}%)`);
    }
    
    if (removalPercent > 10) {
      console.warn(`⚠️  High duplicate rate: ${removalPercent}%`);
    }

    return deduped;
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
   * 🚀 FETCH BY RANGE
   * Fetches events in chunks with pagination
   */
  async fetchPatrolEventsRange(accountVariant, start, end, chunkIndex = 0) {
    await this.ensureAuthenticated();

    const dateRange = `${dayjs(start).format('MMM D')} → ${dayjs(end).format('MMM D')}`;
    console.log(`  📦 Chunk ${chunkIndex + 1}: ${dateRange} (${accountVariant || 'all'})`);

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

      const response = await axiosInstance.get(
        `${this.baseURL}/Rest/Search/ReporteHistorico`,
        { 
          params,
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 45000
        }
      );

      const events = response.data?.data || response.data?.rows || [];
      
      if (events.length === 0) {
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= 2) {
          hasMoreData = false;
          break;
        }
      } else {
        consecutiveEmptyPages = 0;
        
        // Dedupe per page
        const dedupedPageEvents = this.dedupeBMEvents(events);
        allEvents.push(...dedupedPageEvents);
        
        if (page === 1) {
          console.log(`    📥 Page ${page}: ${events.length} events → ${dedupedPageEvents.length} deduped`);
        }
      }

      // Check if we have more data
      if (events.length < limit) {
        hasMoreData = false;
      } else {
        page++;
        await new Promise(r => setTimeout(r, 200));
      }
    }

    console.log(`    ✅ Chunk ${chunkIndex + 1}: ${allEvents.length} total events`);
    return allEvents;
  }

  /**
   * 🚀 OPTIMIZED FETCHING (PUBLIC API) - FIXED FOR SINGLE-DAY QUERIES
   */
  async getPatrolEvents(accountNumber, startDate, endDate) {
    // Timezone-safe cache key
    const cacheKey = [
      accountNumber || 'ALL',
      dayjs(startDate).tz('Africa/Nairobi').format('YYYY-MM-DD'),
      dayjs(endDate).tz('Africa/Nairobi').format('YYYY-MM-DD')
    ].join('_');
    
    // Check cache first
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

    // Create date objects
    let cursor = dayjs(startDate).tz('Africa/Nairobi').startOf('day');
    const endDateObj = dayjs(endDate).tz('Africa/Nairobi').endOf('day');
    const daysInRange = endDateObj.diff(cursor, 'day') + 1;

    // Create 3-day chunks
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

    // 🔥 FIX: Account resolution (only if accountNumber provided)
    if (accountNumber) {
      const cacheKey = `account_resolution_${accountNumber}`;
      const cachedResolution = accountResolutionCache.get(cacheKey);
      
      if (cachedResolution && Date.now() - cachedResolution.timestamp < 5 * 60 * 1000) {
        resolvedAccount = cachedResolution.variant;
        console.log(`✅ Using cached account variant: ${resolvedAccount}`);
      } else {
        // Try each variant with first chunk
        for (const variant of accountVariants) {
          try {
            const testEvents = await this.fetchPatrolEventsRange(variant, chunks[0][0], chunks[0][1], 0);
            if (testEvents.length > 0) {
              resolvedAccount = variant;
              allEvents.push(...testEvents);
              console.log(`✅ Resolved account variant: ${variant} (${testEvents.length} events)`);
              
              // Cache positive resolution for 1 hour
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
          
          // Cache negative resolution for 5 minutes
          accountResolutionCache.set(cacheKey, {
            variant: resolvedAccount,
            timestamp: Date.now()
          });
        }
      }
    } else {
      // 🔥 FIX: For null accountNumber, use empty string
      resolvedAccount = '';
      console.log('✅ No account filter - fetching all accounts');
    }

    // 🔥 CRITICAL FIX: Determine which chunks still need to be fetched
    // If account was resolved, we already fetched chunk 0, so skip it
    // If no account (null), we need to fetch ALL chunks including chunk 0
    const chunksToFetch = accountNumber && resolvedAccount && chunks.length > 1
      ? chunks.slice(1)  // Skip first chunk (already fetched during account resolution)
      : accountNumber && resolvedAccount && chunks.length === 1
      ? []               // Single chunk already fetched during resolution
      : chunks;          // No account number: fetch all chunks

    console.log(`📋 Chunks to fetch: ${chunksToFetch.length}/${chunks.length} (${accountNumber ? 'account-filtered' : 'all-accounts'})`);

    // 🔥 FIX: Fetch remaining chunks (works for single-day AND multi-day AND null account)
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

    console.log(`\n🧮 RAW EVENTS AFTER CHUNK FETCHES: ${allEvents.length}`);

    // Final deduplication (cross-page/cross-chunk safety)
    const dedupedEvents = this.dedupeBMEvents(allEvents);
    console.log(`🧮 FINAL EVENTS AFTER DEDUPE: ${dedupedEvents.length}`);

    const daysCovered = new Set(
      dedupedEvents.map(e => {
        const dateStr = e.rec_tfechahora;
        if (!dateStr) return 'unknown';
        return dayjs(dateStr).tz('Africa/Nairobi').format('YYYY-MM-DD');
      }).filter(d => d !== 'unknown')
    );
    
    console.log(`📅 DAYS WITH EVENTS: ${daysCovered.size}/${daysInRange}`);
    console.log(`📊 TOTAL: ${dedupedEvents.length} events`);
    
    if (daysCovered.size < daysInRange / 2) {
      console.warn(`⚠️  Only ${daysCovered.size}/${daysInRange} days have events`);
    }

    const result = {
      success: true,
      data: dedupedEvents,
      total: dedupedEvents.length,
      daysCovered: daysCovered.size,
      daysRequested: daysInRange,
      accountUsed: resolvedAccount,
      hasCompleteCoverage: daysCovered.size === daysInRange,
      chunks: chunks.length,
      parallel: this.limiter.maxConcurrent,
      cached: false
    };

    // Cache the result
    rawCache.set(cacheKey, {
      data: { ...result, cached: true },
      timestamp: Date.now()
    });
    
    return result;
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
          filter: JSON.stringify([
            { property: 'cue_nparticion', value: '0' },
            { property: 'tip_nTipo', value: 5 },
            { property: 'cue_ncuenta', value: variant }
          ]),
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
   * 🔍 Fetch all accounts
   */
  async getAllAccounts() {
    await this.ensureAuthenticated();
    
    console.log('🔍 Fetching all accounts from BMSecurity API...');
    
    try {
      const params = {
        page: 1,
        start: 0,
        limit: 1000,
        sort: JSON.stringify([{ property: 'cue_ncuenta', direction: 'ASC' }]),
        filter: JSON.stringify([
          { property: 'cue_nparticion', value: '0' },
          { property: 'tip_nTipo', value: 5 }
        ]),
        oauth_token: this.token
      };

      const response = await axiosInstance.get(
        `${this.baseURL}/Rest/Search/CuentaByDealer`,
        { params, timeout: 15000 }
      );

      const accounts = response.data?.data || response.data?.rows || [];
      
      console.log(`✅ Retrieved ${accounts.length} accounts from API`);
      
      return { 
        success: true, 
        data: accounts, 
        total: accounts.length 
      };
      
    } catch (error) {
      console.error('❌ Failed to fetch all accounts:', error.message);
      return { 
        success: false, 
        data: [], 
        error: error.message 
      };
    }
  }

  /**
   * 🧪 Test connection
   */
  async testConnection() {
    try {
      await this.ensureAuthenticated();
      const today = dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
      const result = await this.getPatrolEvents('', today, today);
      
      return {
        success: true,
        token: this.token ? `Valid (55min buffer)` : 'Invalid',
        eventsCount: result.total,
        daysCovered: result.daysCovered,
        cacheSize: rawCache.size,
        message: 'Production optimized API: chunking + parallel + caching (FIXED)'
      };
    } catch (error) {
      return { success: false, error: error.message };
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
   * 🗑️ Clear cache
   */
  clearCache() {
    const rawSize = rawCache.size;
    const resolutionSize = accountResolutionCache.size;
    
    rawCache.clear();
    accountResolutionCache.clear();
    
    console.log(`🗑️ Cleared cache (${rawSize + resolutionSize} entries)`);
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
      }
    };
  }

  addAccountMapping(alphanumeric, numeric) {
    this.accountMapping[alphanumeric] = numeric;
  }

  logout() {
    this.token = null;
    this.tokenExpiry = null;
    this.loginPromise = null;
  }
}

const apiInstance = new BMSecurityAPI();
export default apiInstance;