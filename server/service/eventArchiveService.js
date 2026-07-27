// server/service/eventArchiveService.js
// Raw event archive — stores EVERYTHING from BM Security, no pre-filtering.
// Filtering happens at report-generation time, not here.
'use strict';

const { getPool, sql } = require('../config/database');

// ═══════════════════════════════════════════════════════════════════════
// ZONE CODE EXTRACTION  (FIX: was silently accepting "0" as a valid zone)
// ═══════════════════════════════════════════════════════════════════════
// Previously: String(event.rec_czona || event.zon_ccodigo || event.zone_code || '').trim() || 'UNKNOWN'
// Bug: if the source field held numeric/string 0, `'0'` is truthy in JS,
// so it never fell through to 'UNKNOWN'. Zone '0' was archived as-is, and
// reportModel.js's isUnknownZone() treats '0' as unknown — meaning those
// events get silently skipped at report time with zero explanation.
//
// This also broadens the field candidates checked, since different BM API
// response shapes (live feed vs. historical backfill endpoints) have been
// observed to use different key names for the same data.
//
// Returns the zone code string, or null if nothing usable was found.
// Callers decide what to store for null (archiveEvents stores 'UNKNOWN').
function extractZoneCode(event) {
  if (!event || typeof event !== 'object') return null;

  const candidates = [
    event.rec_czona,
    event.zon_ccodigo,
    event.zone_code,
    event.zoneCode,
    event.ZoneCode,
    event.rec_zona,
    event.zona,
    event.codzona,
    event.cod_zona,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const trimmed = String(candidate).trim();
    if (trimmed === '' || trimmed === '0') continue;   // '0' is NOT a valid zone — treat as missing
    if (trimmed.toUpperCase() === 'UNKNOWN_ZONE') continue;
    if (trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') continue;
    return trimmed;
  }

  return null; // nothing usable found among any candidate field
}

// ─── Store raw events ─────────────────────────────────────────────────────────
// Every alarm code, every client, every event type.
// RawPayload preserves the original event object exactly as received.
// Returns { inserted, skipped, duplicates }
//
// ✅ FIX: the MERGE...TRUNCATE...SELECT @@ROWCOUNT batch previously always
// reported "0 inserted" regardless of how many rows the MERGE actually
// inserted. TRUNCATE TABLE resets @@ROWCOUNT to 0 in SQL Server (it doesn't
// log row-by-row like DELETE does), and the TRUNCATE ran AFTER the MERGE
// but BEFORE the final SELECT @@ROWCOUNT — so the reported count was always
// the truncate's rowcount (0), never the merge's. This has been silently
// wrong on every single archive call: the poller, daily reconciliation,
// and every backfill run, going back to when this file was first written.
// The MERGE itself was very likely inserting correctly the whole time —
// only the "X new" reporting was broken. Fixed by capturing @@ROWCOUNT
// into a variable immediately after the MERGE, before the truncate touches it.
async function archiveEvents(events) {
  if (!events || events.length === 0) return { inserted: 0, skipped: 0, duplicates: 0 };

  const pool = await getPool();

  // ── JS-level dedup (same key = same event, skip intra-batch collisions) ──
  const seen    = new Map();
  let   skipped = 0;

  for (const event of events) {
    try {
      const clientId  = parseInt(event.rec_iidcuenta || event.cue_iid || event.clientId || 0, 10);
      const zoneCode  = extractZoneCode(event) || 'UNKNOWN';   // FIX: '0' no longer slips through as valid
      const alarmCode = String(event.rec_calarma || event.alarm_code || '').trim().toUpperCase();
      const rawDate   = event.rec_tfechahora || event.fecha;
      const eventDate = rawDate ? new Date(rawDate) : null;

      // Only skip events that can't be keyed — every valid event goes in
      if (!clientId || !alarmCode || !eventDate || isNaN(eventDate.getTime())) {
        skipped++;
        continue;
      }

      // Round to second for dedup key
      const secondMs = Math.floor(eventDate.getTime() / 1000) * 1000;
      const key      = `${clientId}|${zoneCode}|${alarmCode}|${secondMs}`;
      if (seen.has(key)) continue;

      seen.set(key, {
        sourceEventId: String(event.rec_iid || event.Id || '').trim() || null,
        clientId,
        zoneCode,
        alarmCode,
        eventDate:    new Date(secondMs), // normalised to second
        content:      event.rec_cContenido      || event.content       || null,
        observations: event.rec_cObservaciones  || event.observaciones || null,
        userId:       String(event.rec_iusuario || event.usuario || '').trim() || null,
        rawPayload:   JSON.stringify(event), // original event — untouched
      });
    } catch (err) {
      console.error('⚠️  eventArchiveService: skipping malformed event:', err.message);
      skipped++;
    }
  }

  const unique = Array.from(seen.values());
  if (unique.length === 0) return { inserted: 0, skipped, duplicates: 0 };

  // ── Bulk load into staging ────────────────────────────────────────────────
  const table = new sql.Table('dbo.PatrolEventsStaging');
  table.create = false;
  table.columns.add('SourceEventId', sql.VarChar(50),       { nullable: true  });
  table.columns.add('ClientId',      sql.Int,               { nullable: false });
  table.columns.add('ZoneCode',      sql.VarChar(20),       { nullable: false });
  table.columns.add('AlarmCode',     sql.VarChar(20),       { nullable: false });
  table.columns.add('EventDateTime', sql.DateTime2,         { nullable: false });
  table.columns.add('Content',       sql.NVarChar(sql.MAX), { nullable: true  });
  table.columns.add('Observations',  sql.NVarChar(sql.MAX), { nullable: true  });
  table.columns.add('UserId',        sql.VarChar(50),       { nullable: true  });
  table.columns.add('RawPayload',    sql.NVarChar(sql.MAX), { nullable: true  });

  for (const e of unique) {
    table.rows.add(
      e.sourceEventId, e.clientId, e.zoneCode, e.alarmCode,
      e.eventDate, e.content, e.observations, e.userId, e.rawPayload,
    );
  }

  await pool.request().bulk(table);

  // ── MERGE: staging → archive (SQL-level dedup) ────────────────────────────
  // EventDateTime is used directly — no DATEADD/DATEDIFF normalization needed.
  // JS already rounds every event to the nearest second before insert, so
  // second-level precision is guaranteed without any SQL truncation.
  // Previous DATEDIFF(SECOND, '19000101', ...) caused INT overflow for 2025+
  // dates; DATEDIFF(MINUTE, ...) collapsed same-minute events into one row,
  // losing legitimate patrols. Direct EventDateTime comparison is correct.
  //
  // FIX: @InsertedCount captures @@ROWCOUNT immediately after the MERGE,
  // before TRUNCATE TABLE (which always zeroes @@ROWCOUNT) runs. The final
  // SELECT returns the captured variable instead of a post-truncate @@ROWCOUNT.
  const mergeResult = await pool.request().query(`
    MERGE dbo.PatrolEventsArchive WITH (HOLDLOCK) AS target
    USING (
      SELECT
        MIN(SourceEventId) AS SourceEventId,
        ClientId,
        ZoneCode,
        AlarmCode,
        EventDateTime,
        MIN(Content)      AS Content,
        MIN(Observations) AS Observations,
        MIN(UserId)       AS UserId,
        MIN(RawPayload)   AS RawPayload
      FROM dbo.PatrolEventsStaging
      GROUP BY ClientId, ZoneCode, AlarmCode, EventDateTime
    ) AS source
    ON  target.ClientId      = source.ClientId
    AND target.ZoneCode      = source.ZoneCode
    AND target.AlarmCode     = source.AlarmCode
    AND target.EventDateTime = source.EventDateTime
    WHEN NOT MATCHED BY TARGET THEN
      INSERT (SourceEventId, ClientId, ZoneCode, AlarmCode, EventDateTime,
              Content, Observations, UserId, RawPayload)
      VALUES (source.SourceEventId, source.ClientId, source.ZoneCode, source.AlarmCode,
              source.EventDateTime, source.Content, source.Observations,
              source.UserId, source.RawPayload);

    DECLARE @InsertedCount INT = @@ROWCOUNT;

    TRUNCATE TABLE dbo.PatrolEventsStaging;

    SELECT @InsertedCount AS Inserted;
  `);

  const inserted   = mergeResult.recordset?.[0]?.Inserted ?? 0;
  const duplicates = unique.length - inserted;
  return { inserted, skipped, duplicates };
}

// ─── For reportModel.js — returns original raw event objects ─────────────────
// RawPayload is parsed back to the original event so all rec_* fields are
// present and filterPatrolsByShiftWindow / countV04Patrols work identically
// to when the live API answered.
//
// FIX: previously trusted the stored ZoneCode column blindly. Now, if the
// stored ZoneCode is missing/'0'/'UNKNOWN' (i.e. it was archived before this
// fix, or the column got corrupted some other way), we re-run extraction
// against the preserved RawPayload — which may recover a real zone using the
// broader field list in extractZoneCode(), even for old rows.
async function fetchEventsFromArchive(clientId, startDate, endDate) {
  const pool   = await getPool();
  const result = await pool.request()
    .input('clientId',  sql.Int,       parseInt(clientId))
    .input('startDate', sql.DateTime2, new Date(startDate))
    .input('endDate',   sql.DateTime2, new Date(endDate))
    .query(`
      SELECT
        SourceEventId, ClientId, ZoneCode, AlarmCode,
        EventDateTime, Content, Observations, UserId, RawPayload
      FROM dbo.PatrolEventsArchive
      WHERE ClientId      = @clientId
        AND EventDateTime >= @startDate
        AND EventDateTime <= @endDate
      ORDER BY EventDateTime
    `);

  return result.recordset.map(row => {
    const storedZoneLooksBad =
      !row.ZoneCode || row.ZoneCode === '0' || row.ZoneCode.toUpperCase() === 'UNKNOWN';

    let raw = null;
    if (row.RawPayload) {
      try { raw = JSON.parse(row.RawPayload); } catch { /* corrupt payload, ignore */ }
    }

    // Best-effort recovery: if the stored column is unusable, try to re-derive
    // the zone from the original payload using the broader extraction logic.
    const recoveredZone = storedZoneLooksBad && raw ? extractZoneCode(raw) : null;
    const finalZoneCode = recoveredZone || row.ZoneCode || 'UNKNOWN';

    if (raw) {
      // Return the original event object — reportModel.js reads rec_* fields
      return {
        ...raw,
        // Guarantee rec_* fields exist regardless of original event shape
        rec_iid:            raw.rec_iid            ?? row.SourceEventId,
        rec_iidcuenta:      raw.rec_iidcuenta       ?? row.ClientId,
        rec_czona:          finalZoneCode,
        rec_calarma:        raw.rec_calarma          ?? row.AlarmCode,
        rec_tfechahora:     raw.rec_tfechahora       ?? row.EventDateTime,
        rec_cContenido:     raw.rec_cContenido       ?? row.Content,
        rec_cObservaciones: raw.rec_cObservaciones   ?? row.Observations,
        rec_iusuario:       raw.rec_iusuario         ?? row.UserId,
      };
    }

    // Fallback if RawPayload is missing or corrupt
    return {
      rec_iid:            row.SourceEventId,
      rec_iidcuenta:      row.ClientId,
      rec_czona:          finalZoneCode,
      rec_calarma:        row.AlarmCode,
      rec_tfechahora:     row.EventDateTime,
      rec_cContenido:     row.Content,
      rec_cObservaciones: row.Observations,
      rec_iusuario:       row.UserId,
    };
  });
}

// ─── For archiveController — raw events with metadata for frontend ────────────
async function getRawEvents(clientId, { startDate, endDate, alarmCode, limit = 500 } = {}) {
  const pool    = await getPool();
  const request = pool.request()
    .input('clientId', sql.Int, parseInt(clientId))
    .input('limit',    sql.Int, Math.min(parseInt(limit) || 500, 5000));

  const filters = ['ClientId = @clientId'];
  if (startDate) { request.input('startDate', sql.DateTime2, new Date(startDate)); filters.push('EventDateTime >= @startDate'); }
  if (endDate)   { request.input('endDate',   sql.DateTime2, new Date(endDate));   filters.push('EventDateTime <= @endDate'); }
  if (alarmCode) {
    request.input('alarmCode', sql.VarChar(20), String(alarmCode).trim().toUpperCase());
    filters.push('AlarmCode = @alarmCode');
  }

  const result = await request.query(`
    SELECT TOP (@limit)
      Id, SourceEventId, ClientId, ZoneCode, AlarmCode,
      EventDateTime, Content, Observations, UserId, FetchedAt, RawPayload
    FROM dbo.PatrolEventsArchive
    WHERE ${filters.join(' AND ')}
    ORDER BY EventDateTime DESC
  `);

  return result.recordset.map(row => {
    let originalEvent = null;
    if (row.RawPayload) {
      try { originalEvent = JSON.parse(row.RawPayload); } catch {}
    }
    return {
      _archiveId:    row.Id,
      _fetchedAt:    row.FetchedAt,
      clientId:      row.ClientId,
      zoneCode:      row.ZoneCode,
      alarmCode:     row.AlarmCode,
      eventDateTime: row.EventDateTime,
      content:       row.Content,
      observations:  row.Observations,
      userId:        row.UserId,
      rawEvent:      originalEvent ?? {
        rec_iid:            row.SourceEventId,
        rec_iidcuenta:      row.ClientId,
        rec_czona:          row.ZoneCode,
        rec_calarma:        row.AlarmCode,
        rec_tfechahora:     row.EventDateTime,
        rec_cContenido:     row.Content,
        rec_cObservaciones: row.Observations,
        rec_iusuario:       row.UserId,
      },
    };
  });
}

// ─── For archiveController ────────────────────────────────────────────────────
async function getArchivedEventClients() {
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT
      a.ClientId,
      c.cue_cnombre AS ClientName,
      c.cue_ncuenta AS AccountNumber,
      COUNT(*)      AS EventCount,
      MIN(a.EventDateTime) AS EarliestEvent,
      MAX(a.EventDateTime) AS LatestEvent
    FROM dbo.PatrolEventsArchive a
    LEFT JOIN [_Datos].[dbo].[m_cuentas] c ON c.cue_iid = a.ClientId
    GROUP BY a.ClientId, c.cue_cnombre, c.cue_ncuenta
    ORDER BY c.cue_cnombre
  `);
  return result.recordset;
}

async function getArchivedEventMonths(clientId) {
  const pool   = await getPool();
  const result = await pool.request()
    .input('clientId', sql.Int, parseInt(clientId))
    .query(`
      SELECT
        FORMAT(EventDateTime, 'yyyy-MM') AS Month,
        COUNT(*) AS EventCount,
        SUM(CASE WHEN AlarmCode = 'V04' THEN 1 ELSE 0 END) AS PatrolArrivals,
        SUM(CASE WHEN AlarmCode = 'V03' THEN 1 ELSE 0 END) AS Incidents,
        SUM(CASE WHEN AlarmCode LIKE '_P%' THEN 1 ELSE 0 END) AS CheckIns,
        COUNT(DISTINCT AlarmCode) AS UniqueAlarmCodes
      FROM dbo.PatrolEventsArchive
      WHERE ClientId = @clientId
      GROUP BY FORMAT(EventDateTime, 'yyyy-MM')
      ORDER BY Month DESC
    `);
  return result.recordset;
}

async function getAlarmCodeSummary(clientId, { startDate, endDate } = {}) {
  const pool    = await getPool();
  const request = pool.request().input('clientId', sql.Int, parseInt(clientId));
  const filters = ['ClientId = @clientId'];
  if (startDate) { request.input('startDate', sql.DateTime2, new Date(startDate)); filters.push('EventDateTime >= @startDate'); }
  if (endDate)   { request.input('endDate',   sql.DateTime2, new Date(endDate));   filters.push('EventDateTime <= @endDate'); }

  const result = await request.query(`
    SELECT
      AlarmCode,
      COUNT(*) AS EventCount,
      MIN(EventDateTime) AS FirstSeen,
      MAX(EventDateTime) AS LastSeen
    FROM dbo.PatrolEventsArchive
    WHERE ${filters.join(' AND ')}
    GROUP BY AlarmCode
    ORDER BY EventCount DESC
  `);
  return result.recordset;
}

async function getEventsForDateRange(clientId, startDate, endDate) {
  return fetchEventsFromArchive(clientId, startDate, endDate);
}

// ─── Archive health check ─────────────────────────────────────────────────────
async function getArchiveStatus() {
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT
      COUNT(*)             AS TotalEvents,
      MIN(EventDateTime)   AS EarliestEvent,
      MAX(EventDateTime)   AS LatestEvent,
      MAX(FetchedAt)       AS LastFetchedAt,
      COUNT(DISTINCT ClientId)  AS UniqueClients,
      COUNT(DISTINCT AlarmCode) AS UniqueAlarmCodes,
      DATEDIFF(MINUTE, MAX(EventDateTime), GETUTCDATE()) AS MinutesSinceLastEvent
    FROM dbo.PatrolEventsArchive
  `);
  return result.recordset[0];
}

// ─── One-time repair: fix rows archived before the '0'/zone-field fix ────────
// Scans every archive row whose ZoneCode is missing/'0'/'UNKNOWN', re-parses
// its RawPayload with the broader extractZoneCode() logic, and updates the
// ZoneCode column in place if a better value is found.
//
// Safe to run multiple times — only touches rows that still look bad.
// Pass a clientId to limit the repair to one client (recommended for a
// first run), or omit it to repair the whole archive table.
//
// Returns { scanned, repaired, stillBad }
async function repairZoneCodes(clientId = null) {
  const pool    = await getPool();
  const request = pool.request();

  const filters = [`(ZoneCode IS NULL OR ZoneCode = '' OR ZoneCode = '0' OR UPPER(ZoneCode) = 'UNKNOWN')`];
  if (clientId) {
    request.input('clientId', sql.Int, parseInt(clientId));
    filters.push('ClientId = @clientId');
  }

  const result = await request.query(`
    SELECT Id, ClientId, ZoneCode, RawPayload
    FROM dbo.PatrolEventsArchive
    WHERE ${filters.join(' AND ')}
  `);

  const rows = result.recordset;
  let repaired = 0, stillBad = 0;

  for (const row of rows) {
    if (!row.RawPayload) { stillBad++; continue; }

    let raw;
    try { raw = JSON.parse(row.RawPayload); } catch { stillBad++; continue; }

    const recovered = extractZoneCode(raw);
    if (!recovered) { stillBad++; continue; }

    await pool.request()
      .input('id',       sql.Int,         row.Id)
      .input('zoneCode', sql.VarChar(20), recovered)
      .query(`UPDATE dbo.PatrolEventsArchive SET ZoneCode = @zoneCode WHERE Id = @id`);

    repaired++;
  }

  console.log(`🔧 repairZoneCodes: scanned=${rows.length} repaired=${repaired} stillBad=${stillBad}` +
              (clientId ? ` (client ${clientId})` : ' (all clients)'));

  return { scanned: rows.length, repaired, stillBad };
}

module.exports = {
  archiveEvents,
  fetchEventsFromArchive,
  getEventsForDateRange,
  getArchivedEventClients,
  getArchivedEventMonths,
  getRawEvents,
  getAlarmCodeSummary,
  getArchiveStatus,
  extractZoneCode,
  repairZoneCodes,
};