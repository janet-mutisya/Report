// server/service/bmSecurityAPICache.js - PRODUCTION READY
import bmSecurityAPI from './bmSecurityAPI.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// Setup dayjs with timezone
dayjs.extend(utc);
dayjs.extend(timezone);

// ✅ FIX #1: Timezone normalization helper
function normalizeDate(date) {
  return dayjs(date).tz('Africa/Nairobi').format('YYYY-MM-DD');
}

// ✅ THREE-TIER CACHE SYSTEM WITH METRICS
const rawAPICache = new Map();
const processedCache = new Map();
const backgroundJobs = new Map();

const RAW_API_CACHE_TTL = 5 * 60 * 1000;       // 5 minutes for raw API data
const PROCESSED_CACHE_TTL = 2 * 60 * 1000;    // 2 minutes for processed client data
const BACKGROUND_REFRESH_INTERVAL = 4 * 60 * 1000; // 4 minutes for background refresh

// Cache hit metrics
const cacheMetrics = {
  tier1: 0,
  tier2: 0,
  misses: 0,
  total: 0,
  getHitRate: () => {
    if (cacheMetrics.total === 0) return 0;
    return ((cacheMetrics.tier1 + cacheMetrics.tier2) / cacheMetrics.total * 100).toFixed(1);
  }
};

// ✅ FIX #1: Use normalized dates in cache keys
function generateRawCacheKey(accountNumber, startDate, endDate) {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  const account = accountNumber || 'all';
  return `raw_${account}_${start}_${end}`;
}

function generateProcessedCacheKey(clientId, startDate, endDate) {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  return `processed_${clientId}_${start}_${end}`;
}

// ✅ FIX #3: Safer client filtering with string comparison
function filterEventsForClient(events, clientId) {
  if (!events || !Array.isArray(events)) return [];
  
  // Convert clientId to canonical string format
  const clientIdStr = String(clientId).trim();
  
  return events.filter(event => {
    // Try multiple possible client ID fields
    const eventClientId = 
      event.rec_iidcuenta || 
      event.cue_iid || 
      event.clientId || 
      event.accountId;
    
    if (!eventClientId) return false;
    
    // Use string comparison to avoid "011" vs "11" issues
    return String(eventClientId).trim() === clientIdStr;
  });
}

export async function getCachedPatrolEvents(clientId, startDate, endDate, accountNumber = null) {
  cacheMetrics.total++;
  
  // ✅ FIX #1: Use normalized dates
  const normalizedStart = normalizeDate(startDate);
  const normalizedEnd = normalizeDate(endDate);
  
  const rawKey = generateRawCacheKey(accountNumber, normalizedStart, normalizedEnd);
  const processedKey = generateProcessedCacheKey(clientId, normalizedStart, normalizedEnd);
  
  // TIER 1: Check processed cache
  const processedCache_entry = processedCache.get(processedKey);
  if (processedCache_entry && Date.now() - processedCache_entry.timestamp < PROCESSED_CACHE_TTL) {
    const age = Math.round((Date.now() - processedCache_entry.timestamp) / 1000);
    console.log(`[API Cache] 🎯 Tier 1 hit: ${clientId} (${age}s old)`);
    cacheMetrics.tier1++;
    
    // Schedule background refresh
    scheduleBackgroundRefresh(clientId, startDate, endDate, accountNumber);
    
    return {
      success: true,
      data: processedCache_entry.data,
      fromCache: true,
      cacheAge: Date.now() - processedCache_entry.timestamp,
      cacheTier: 'processed',
      cacheHitRate: cacheMetrics.getHitRate()
    };
  }
  
  // TIER 2: Check raw API cache
  const rawCache_entry = rawAPICache.get(rawKey);
  if (rawCache_entry && Date.now() - rawCache_entry.timestamp < RAW_API_CACHE_TTL) {
    const age = Math.round((Date.now() - rawCache_entry.timestamp) / 1000);
    console.log(`[API Cache] 🎯 Tier 2 hit: ${rawKey} (${age}s old)`);
    cacheMetrics.tier2++;
    
    // Filter for specific client
    const filteredEvents = filterEventsForClient(rawCache_entry.data, clientId);
    console.log(`[API Cache] 📊 Filtered ${rawCache_entry.data.length} → ${filteredEvents.length} events`);
    
    // Update processed cache
    processedCache.set(processedKey, {
      data: filteredEvents,
      timestamp: Date.now(),
      source: 'tier2'
    });
    
    scheduleBackgroundRefresh(clientId, startDate, endDate, accountNumber);
    
    return {
      success: true,
      data: filteredEvents,
      fromCache: true,
      cacheAge: Date.now() - rawCache_entry.timestamp,
      cacheTier: 'raw',
      cacheHitRate: cacheMetrics.getHitRate()
    };
  }
  
  // TIER 3: Cache miss - fetch from API
  console.log(`[API Cache] 🔄 Cache miss: ${clientId} (${normalizedStart} → ${normalizedEnd})`);
  cacheMetrics.misses++;
  
  const startTime = Date.now();
  
  try {
    if (typeof bmSecurityAPI?.getPatrolEvents !== 'function') {
      throw new Error('BM Security API not available');
    }
    
    const result = await bmSecurityAPI.getPatrolEvents(
      accountNumber, 
      startDate, 
      endDate
    );
    
    if (!result.success || !result.data) {
      throw new Error('API returned no data');
    }
    
    const duration = Date.now() - startTime;
    console.log(`[API Cache] 📥 Fresh fetch: ${result.data.length} events in ${duration}ms`);
    
    // Cache the raw API response
    rawAPICache.set(rawKey, {
      data: result.data,
      timestamp: Date.now(),
      metadata: {
        total: result.total,
        daysCovered: result.daysCovered,
        accountUsed: result.accountUsed,
        fetchDuration: duration
      }
    });
    
    // Filter for specific client
    const filteredEvents = filterEventsForClient(result.data, clientId);
    console.log(`[API Cache] 📊 Filtered to ${filteredEvents.length} events for client ${clientId}`);
    
    // Cache the processed data
    processedCache.set(processedKey, {
      data: filteredEvents,
      timestamp: Date.now(),
      source: 'fresh'
    });
    
    scheduleBackgroundRefresh(clientId, startDate, endDate, accountNumber);
    
    return {
      success: true,
      data: filteredEvents,
      fromCache: false,
      fetchDuration: duration,
      cacheTier: 'none',
      cacheHitRate: cacheMetrics.getHitRate()
    };
    
  } catch (error) {
    console.error(`[API Cache] ❌ Fetch error:`, error.message);
    throw error;
  }
}

// ✅ FIX #2: Normalized background refresh with proper guards
async function scheduleBackgroundRefresh(clientId, startDate, endDate, accountNumber) {
  // ✅ Use normalized dates for job key
  const jobKey = `refresh_${clientId}_${normalizeDate(startDate)}_${normalizeDate(endDate)}`;
  
  // Early return if refresh already scheduled
  if (backgroundJobs.has(jobKey)) {
    return;
  }
  
  console.log(`[API Cache] ⏰ Scheduling background refresh: ${jobKey}`);
  
  const refreshTimeout = setTimeout(async () => {
    console.log(`[API Cache] 🔄 Background refresh starting: ${jobKey}`);
    
    try {
      // ✅ FIX #2: Clear both caches before refresh
      const rawKey = generateRawCacheKey(accountNumber, startDate, endDate);
      const processedKey = generateProcessedCacheKey(clientId, startDate, endDate);
      
      rawAPICache.delete(rawKey);
      processedCache.delete(processedKey);
      
      // Force fresh fetch WITHOUT triggering another background refresh
      await performSilentRefresh(clientId, startDate, endDate, accountNumber);
      
      console.log(`[API Cache] ✅ Background refresh complete: ${jobKey}`);
    } catch (error) {
      console.error(`[API Cache] ❌ Background refresh failed: ${jobKey}`, error.message);
    } finally {
      backgroundJobs.delete(jobKey);
    }
  }, BACKGROUND_REFRESH_INTERVAL);
  
  backgroundJobs.set(jobKey, refreshTimeout);
}

// ✅ Separate function for silent refresh (no background job creation)
async function performSilentRefresh(clientId, startDate, endDate, accountNumber) {
  const rawKey = generateRawCacheKey(accountNumber, startDate, endDate);
  const processedKey = generateProcessedCacheKey(clientId, startDate, endDate);
  
  try {
    const result = await bmSecurityAPI.getPatrolEvents(
      accountNumber, 
      startDate, 
      endDate
    );
    
    if (result.success && result.data) {
      rawAPICache.set(rawKey, {
        data: result.data,
        timestamp: Date.now(),
        metadata: {
          total: result.total,
          daysCovered: result.daysCovered,
          accountUsed: result.accountUsed,
          source: 'background'
        }
      });
      
      const filteredEvents = filterEventsForClient(result.data, clientId);
      processedCache.set(processedKey, {
        data: filteredEvents,
        timestamp: Date.now(),
        source: 'background'
      });
      
      console.log(`[API Cache] 🆕 Background updated: ${filteredEvents.length} events`);
    }
  } catch (error) {
    console.error(`[API Cache] ❌ Silent refresh failed:`, error.message);
    // Don't throw - background refresh failures shouldn't affect users
  }
}

export async function smartWarmup(clientId, accountNumber = null) {
  console.log(`[API Cache] 🔥 Smart warmup for client ${clientId}...`);
  
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  
  const promises = [
    getCachedPatrolEvents(
      clientId,
      weekAgo.toISOString().split('T')[0],
      today.toISOString().split('T')[0],
      accountNumber
    ).catch(err => ({ success: false, error: err.message })),
    
    getCachedPatrolEvents(
      clientId,
      monthStart.toISOString().split('T')[0],
      today.toISOString().split('T')[0],
      accountNumber
    ).catch(err => ({ success: false, error: err.message }))
  ];
  
  const results = await Promise.allSettled(promises);
  const successful = results.filter(r => 
    r.status === 'fulfilled' && r.value?.success
  ).length;
  
  console.log(`[API Cache] ✅ Smart warmup: ${successful}/${results.length} succeeded`);
  
  return { 
    success: successful > 0, 
    warmed: successful, 
    total: results.length,
    hitRate: cacheMetrics.getHitRate()
  };
}

export async function warmupDateRange(clientId, startDate, endDate, accountNumber = null) {
  console.log(`[API Cache] 🔥 Warming range: ${startDate} → ${endDate} for client ${clientId}`);
  try {
    await getCachedPatrolEvents(clientId, startDate, endDate, accountNumber);
    return { success: true };
  } catch (error) {
    console.error(`[API Cache] ❌ Warmup failed:`, error.message);
    return { success: false, error: error.message };
  }
}

export function clearAPICache() {
  const rawSize = rawAPICache.size;
  const processedSize = processedCache.size;
  
  rawAPICache.clear();
  processedCache.clear();
  
  // Clear all background jobs
  for (const [key, timeout] of backgroundJobs.entries()) {
    clearTimeout(timeout);
  }
  backgroundJobs.clear();
  
  // Reset metrics
  cacheMetrics.tier1 = 0;
  cacheMetrics.tier2 = 0;
  cacheMetrics.misses = 0;
  cacheMetrics.total = 0;
  
  console.log(`[API Cache] 🗑️ Cleared ${rawSize} raw + ${processedSize} processed entries`);
  
  return { 
    rawCleared: rawSize, 
    processedCleared: processedSize, 
    total: rawSize + processedSize,
    metricsReset: true
  };
}

export function getAPICacheStats() {
  const now = Date.now();
  
  const rawEntries = Array.from(rawAPICache.entries()).map(([key, value]) => ({
    key: key.substring(0, 50), // Truncate for readability
    events: value.data?.length || 0,
    age: Math.round((now - value.timestamp) / 1000),
    fresh: (now - value.timestamp) < RAW_API_CACHE_TTL,
    source: value.metadata?.source || 'unknown'
  }));
  
  const processedEntries = Array.from(processedCache.entries()).map(([key, value]) => ({
    key: key.substring(0, 50),
    events: value.data?.length || 0,
    age: Math.round((now - value.timestamp) / 1000),
    fresh: (now - value.timestamp) < PROCESSED_CACHE_TTL,
    source: value.source || 'unknown'
  }));
  
  return {
    raw: { 
      size: rawAPICache.size, 
      entries: rawEntries.slice(0, 10), // Show first 10 only
      ttl: RAW_API_CACHE_TTL / 1000 
    },
    processed: { 
      size: processedCache.size, 
      entries: processedEntries.slice(0, 10),
      ttl: PROCESSED_CACHE_TTL / 1000 
    },
    backgroundJobs: { 
      active: backgroundJobs.size, 
      jobs: Array.from(backgroundJobs.keys()).slice(0, 5) 
    },
    metrics: {
      tier1: cacheMetrics.tier1,
      tier2: cacheMetrics.tier2,
      misses: cacheMetrics.misses,
      total: cacheMetrics.total,
      hitRate: cacheMetrics.getHitRate() + '%'
    }
  };
}

// ✅ FIX #1 & #2: Use normalized dates in forceRefresh
export async function forceRefresh(clientId, startDate, endDate, accountNumber = null) {
  console.log(`[API Cache] 🔄 Force refresh: ${clientId}`);
  
  const normalizedStart = normalizeDate(startDate);
  const normalizedEnd = normalizeDate(endDate);
  const rawKey = generateRawCacheKey(accountNumber, normalizedStart, normalizedEnd);
  const processedKey = generateProcessedCacheKey(clientId, normalizedStart, normalizedEnd);
  
  // Clear existing refresh job if any
  const jobKey = `refresh_${clientId}_${normalizedStart}_${normalizedEnd}`;
  if (backgroundJobs.has(jobKey)) {
    clearTimeout(backgroundJobs.get(jobKey));
    backgroundJobs.delete(jobKey);
  }
  
  rawAPICache.delete(rawKey);
  processedCache.delete(processedKey);
  
  return await getCachedPatrolEvents(clientId, startDate, endDate, accountNumber);
}

// ✅ Multi-tenant isolation helper
export function clearClientCache(clientId) {
  let cleared = 0;
  
  for (const [key] of processedCache.entries()) {
    if (key.startsWith(`processed_${clientId}_`)) {
      processedCache.delete(key);
      cleared++;
    }
  }
  
  console.log(`[API Cache] 🧹 Cleared ${cleared} entries for client ${clientId}`);
  return { cleared };
}

// ✅ Health check
export async function healthCheck() {
  return {
    status: 'healthy',
    cacheStats: getAPICacheStats(),
    timestamp: new Date().toISOString(),
    timezone: 'Africa/Nairobi'
  };
}

export default {
  getCachedPatrolEvents,
  smartWarmup,
  warmupDateRange,
  clearAPICache,
  getAPICacheStats,
  forceRefresh,
  clearClientCache,
  healthCheck,
  filterEventsForClient // Exposed for testing
};