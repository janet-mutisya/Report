"use strict";

// server/service/pdfService.js
// Security Patrol Report PDF Generator
// v18 — FIX 22: shiftType argument-shape bug fixed (see below)
//
// CHANGES vs v17:
//   ✅ FIX 22 (shift mixup, still present after v17): generateDashboardPDF()
//      was calling fetchPatrolReport(..., { shiftType, sqlStartDate,
//      sqlEndDate }) — passing an OBJECT as the 6th argument. But
//      reportModel.js's fetchPatrolReport expects the 6th argument to be a
//      plain STRING ('day' | 'night' | 'both' | null), and immediately runs
//      normaliseShiftType(requestedShiftType) on it, which does
//      String(raw).toLowerCase().trim(). String({shiftType:'day', ...})
//      produces the literal text "[object object]", which matches none of
//      the day/night/both patterns — so normaliseShiftType always returned
//      null, and ANY explicit shift request made through pdfService was
//      silently discarded before reportModel ever saw it. Whatever shift a
//      report ended up scoped to was therefore always whatever
//      reportModel's own fallback resolved to (the client's configured
//      shift, or full day if the client has no shift configured) —
//      never the shift that was actually explicitly requested by this
//      call. This is exactly the risk flagged in v17's own FIX 20 comment
//      ("this fix is only half-complete... if it currently only accepts
//      (clientId, startDate, endDate, useCache, reportType) it will
//      ignore the extra arguments") — the object shape was never caught
//      because it happened to coincidentally still produce correct output
//      whenever the caller's explicit request matched the client's
//      already-configured shift.
//
//      FIX: pass normalizedShift directly as the 6th positional argument
//      (a plain string), matching reportModel.js's actual signature. The
//      sqlStartDate/sqlEndDate precomputed bounds are dropped from this
//      call entirely — reportModel.js's fetchPatrolReport builds its own
//      shift-scoped query window internally from requestedShiftType (see
//      validateAndFormatDates in reportModel.js), so those precomputed
//      values were never consumed downstream anyway; keeping them in the
//      call signature was dead weight that obscured the real bug.
//
//   All v17 fixes preserved (date-range shift-awareness intent, blank-page
//   layout fixes) — this release only corrects how the shift is *handed
//   off* to reportModel, not the shift-hour boundaries themselves.

const PDFDocument = require("pdfkit");
const dayjs       = require("dayjs");
const fs          = require("fs");
const path        = require("path");

const { fetchPatrolReport } = require("../models/reportModel");

dayjs.extend(require("dayjs/plugin/utc"));
dayjs.extend(require("dayjs/plugin/timezone"));

const TZ = process.env.TIMEZONE || "Africa/Nairobi";

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  primary:     "#1e40af",
  primaryDark: "#1e3a8a",
  accent:      "#3b82f6",
  success:     "#16a34a",
  warning:     "#d97706",
  danger:      "#dc2626",
  white:       "#ffffff",
  black:       "#000000",
  gray100:     "#f3f4f6",
  gray200:     "#e5e7eb",
  gray300:     "#d1d5db",
  gray400:     "#9ca3af",
  gray600:     "#4b5563",
  gray800:     "#1f2937",
};

// ─────────────────────────────────────────────────────────────────────────────
// SHIFT TYPE SUPPORT
//
// Mirrors schedulerController.js's normaliseShiftType() so pdfService can
// be called directly (e.g. from a test script) without depending on the
// controller. 'day' | 'night' | 'both' — 'both' is the legacy default.
// ─────────────────────────────────────────────────────────────────────────────
const VALID_SHIFT_TYPES = ["day", "night", "both"];

function normaliseShiftType(input) {
  if (!input || typeof input !== "string") return "both";
  const v = input.trim().toLowerCase();
  if (v === "day" || v === "daytime" || v === "day shift") return "day";
  if (v === "night" || v === "nighttime" || v === "night shift") return "night";
  if (v === "both" || v === "day/night" || v === "all" || v === "24hr" || v === "") return "both";
  return VALID_SHIFT_TYPES.includes(v) ? v : "both";
}

const SHIFT_LABELS = { day: "Day Shift", night: "Night Shift", both: "" };

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────
const log = {
  info:  (...a) => console.log("[PDF]",         ...a),
  warn:  (...a) => console.warn("[PDF WARN]",   ...a),
  error: (...a) => console.error("[PDF ERROR]", ...a),
  debug: (...a) => process.env.NODE_ENV === "development" && console.log("[PDF DBG]", ...a),
};

// ─────────────────────────────────────────────────────────────────────────────
// CHART LAYOUT CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const CHART = {
  TITLE_H:   28,
  PAD_L:     32,
  PAD_R:     12,
  PAD_TOP:   14,
  PAD_BOT:   56,
  BAR_GAP:    4,
  MIN_BAR_W:  6,
  MAX_BAR_W: 30,
  BAR_H:    160,
};

function zonesPerRow(drawWidth) {
  const usable = drawWidth - CHART.PAD_L - CHART.PAD_R;
  const colW   = CHART.MIN_BAR_W + CHART.BAR_GAP;
  return Math.max(1, Math.floor(usable / colW));
}

function computeRowCardHeight() {
  return CHART.TITLE_H + CHART.PAD_TOP + CHART.BAR_H + CHART.PAD_BOT;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTINUATION HEADER  (drawn by pageAdded event — never on page 1)
// ─────────────────────────────────────────────────────────────────────────────
const CONTINUATION_HEADER_H = 36;

function drawContinuationHeader(doc, logo, clientName, startFmt, endFmt, left, contentW, shiftLabel) {
  const y = 12;
  doc.fillColor(C.primary).rect(left, y, contentW, CONTINUATION_HEADER_H).fill();

  const LOGO_W = 28, LOGO_H = 28;
  if (logo) {
    try {
      doc.image(logo, left + 4, y + 4, { width: LOGO_W, height: LOGO_H, fit: [LOGO_W, LOGO_H] });
    } catch (_) { /* skip */ }
  }

  const textX = left + (logo ? LOGO_W + 10 : 6);
  doc.fillColor(C.white).fontSize(9).font("Helvetica-Bold")
     .text("BM SECURITY  -  SECURITY PATROL REPORT", textX, y + 6, { lineBreak: false });
  const shiftSuffix = shiftLabel ? "   |   " + shiftLabel : "";
  doc.fillColor(C.gray200).fontSize(7.5).font("Helvetica")
     .text(
       clientName.toUpperCase() + "   |   Period: " + startFmt + " – " + endFmt + shiftSuffix + "   (continued)",
       textX, y + 20, { lineBreak: false },
     );
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT ENGINE
// ─────────────────────────────────────────────────────────────────────────────
class Layout {
  constructor(doc, { left = 40, firstPageTop = 40, contPageTop = 40, bottom = 50 } = {}) {
    this.doc         = doc;
    this.left        = left;
    this.bottom      = bottom;
    this.pageH       = 841.89;
    this.pageW       = 595.28;
    this.contentW    = this.pageW - left * 2;
    this.maxY        = this.pageH - 60;
    this.y           = firstPageTop;
    this.contPageTop = contPageTop;
  }

  ensure(needed) {
    if (needed <= 0.5) return false;
    if (this.y > this.maxY || this.y + needed > this.maxY) {
      this.doc.addPage();
      this.y = Math.ceil(this.contPageTop);
      return true;
    }
    return false;
  }

  gap(n = 8) { this.y = Math.ceil(this.y + n); }

  sectionTitle(text) {
    this.ensure(48);
    this.doc
      .fillColor(C.primary).fontSize(13).font("Helvetica-Bold")
      .text(text, this.left, this.y, { lineBreak: false });
    this.doc
      .strokeColor(C.gray300).lineWidth(0.5)
      .moveTo(this.left,                 this.y + 17)
      .lineTo(this.left + this.contentW, this.y + 17)
      .stroke();
    this.y = Math.ceil(this.y + 26);
  }

  tableHeader(cols, rowH = 22) {
    this.ensure(rowH + 4);
    this.doc.fillColor(C.primary).rect(this.left, this.y, this.contentW, rowH).fill();
    this.doc.fillColor(C.white).fontSize(8).font("Helvetica-Bold");
    cols.forEach(({ label, cx, w }) =>
      this.doc.text(label, cx, this.y + (rowH - 8) / 2, { width: w, lineBreak: false })
    );
    this.y = Math.ceil(this.y + rowH);
  }

  tableRow(cols, rowH = 18, even = false) {
    this.ensure(rowH + 2);
    if (even) this.doc.fillColor(C.gray100).rect(this.left, this.y, this.contentW, rowH).fill();
    this.doc.fillColor(C.black).fontSize(8).font("Helvetica");
    cols.forEach(({ text, cx, w, bold, color }) => {
      if (bold)  this.doc.font("Helvetica-Bold");
      if (color) this.doc.fillColor(color);
      this.doc.text(String(text ?? ""), cx, this.y + 5, { width: w, lineBreak: false });
      if (color) this.doc.fillColor(C.black);
      if (bold)  this.doc.font("Helvetica");
    });
    this.y = Math.ceil(this.y + rowH);
  }

  totalRow(cols, rowH = 24) {
    this.ensure(rowH + 4);
    this.doc.fillColor(C.primaryDark).rect(this.left, this.y, this.contentW, rowH).fill();
    this.doc.fillColor(C.white).fontSize(9).font("Helvetica-Bold");
    cols.forEach(({ text, cx, w }) =>
      this.doc.text(String(text ?? ""), cx, this.y + (rowH - 9) / 2, { width: w, lineBreak: false })
    );
    this.y = Math.ceil(this.y + rowH);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function cleanPost(name) {
  return name ? String(name).replace(/^\d+\.\s*/, "").trim() : "";
}

function fmtDate(str) {
  const d = dayjs.tz(str, TZ);
  return d.isValid() ? d.format("DD/MM/YYYY") : String(str || "");
}

function dayCount(start, end) {
  const s = dayjs(start), e = dayjs(end);
  return s.isValid() && e.isValid() ? e.diff(s, "day") + 1 : 0;
}

function loadLogo() {
  const candidates = [
    path.join(process.cwd(), "assets",           "BM SECURITY LOGO.jpg"),
    path.join(process.cwd(), "server", "assets", "BM SECURITY LOGO.jpg"),
    path.join(__dirname, "..",         "assets", "BM SECURITY LOGO.jpg"),
    path.join(__dirname, "..", "..",   "assets", "BM SECURITY LOGO.jpg"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) { log.info("Logo loaded:", p); return fs.readFileSync(p); }
  }
  log.warn("Logo not found — text fallback");
  return null;
}

function zoneName(obj) {
  const pick = (...keys) => { for (const k of keys) if (obj[k]) return cleanPost(obj[k]); return null; };
  return (
    pick("zone", "zoneName", "zone_name", "Zone", "post", "postName", "post_name", "SecurityPost", "location") ||
    (obj.rec_czonanombre ? cleanPost(obj.rec_czonanombre) : null) ||
    (obj.rec_czona       ? ("Zone " + obj.rec_czona)      : null) ||
    "Unknown Location"
  );
}

function cleanDescription(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/\[\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(:\d{2})?\]/g, "")
    .replace(/\[vigicontrol\]/gi, "")
    .replace(/\[irservices\]/gi,  "")
    .replace(/^\s*\[.*?\]\s*/g,   "")
    .replace(/\s+/g, " ")
    .trim();
}

function perfColor(pct) {
  if (pct >= 90) return C.success;
  if (pct >= 70) return C.accent;
  return C.warning;
}

function truncateLabel(doc, label, maxWidth, fontSize = 5.5) {
  doc.fontSize(fontSize).font("Helvetica");
  if (doc.widthOfString(label) <= maxWidth) return label;
  let truncated = label;
  while (truncated.length > 1 && doc.widthOfString(truncated + "…") > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "…";
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTIVE Y-AXIS
// ─────────────────────────────────────────────────────────────────────────────
function niceAxis(rawMax) {
  if (!rawMax || rawMax <= 0) return { niceMax: 10, gridStep: 2, gridLines: 5 };
  const tryGridLines = [5, 4, 2];
  for (const g of tryGridLines) {
    const rawStep = rawMax / g;
    const mag     = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const nice    = [1, 2, 2.5, 5, 10].map(f => f * mag).find(v => v >= rawStep) || rawStep;
    const niceMax = nice * g;
    if (niceMax >= rawMax) return { niceMax, gridStep: nice, gridLines: g };
  }
  return { niceMax: rawMax, gridStep: Math.ceil(rawMax / 4), gridLines: 4 };
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA PROCESSING
// ─────────────────────────────────────────────────────────────────────────────
function processIncidents(reportData) {
  const result = [];

  function push(raw, dateStr, zone, reportedBy) {
    const desc = cleanDescription(raw);
    let date = "N/A", time = "N/A";
    if (dateStr) {
      const d = dayjs(dateStr);
      if (d.isValid()) { date = d.format("DD/MM/YYYY"); time = d.format("HH:mm:ss"); }
    }
    result.push({ date, time, zone, description: desc, reportedBy: reportedBy || "Guard" });
  }

  if (Array.isArray(reportData.guardReports)) {
    for (const r of reportData.guardReports) {
      if (r.type === "INCIDENT_REPORT" || r.__type === "INCIDENT_REPORT") {
        push(r.report || r.description || "", r.date, zoneName(r), r.guardName || r.officer);
      }
    }
  }

  if (result.length === 0 && Array.isArray(reportData.events)) {
    for (const e of reportData.events) {
      const code = (e.rec_calarma || e.AlarmCode || "").toString().trim().toUpperCase();
      if (code === "V03") {
        push(
          e.rec_cObservaciones || e.Observaciones || e.observaciones || "",
          e.rec_tfechahora,
          zoneName(e),
          e.rec_coperador || e.Operator,
        );
      }
    }
  }

  if (result.length === 0 && Array.isArray(reportData.incidents)) {
    for (const i of reportData.incidents) {
      push(i.description || i.notes || i.details || "", i.date || i.incidentDate, zoneName(i), i.reportedBy || i.reporter);
    }
  }

  log.info("Processed " + result.length + " incidents");
  return result;
}

function processPatrolEvents(reportData) {
  const result = [];
  if (Array.isArray(reportData.events)) {
    for (const e of reportData.events) {
      const code = (e.rec_calarma || e.AlarmCode || "").toString().trim().toUpperCase();
      if (code === "V04") {
        result.push({
          Date:  e.Date || fmtDate(e.rec_tfechahora) || "N/A",
          Time:  e.Time || (e.rec_tfechahora ? dayjs(e.rec_tfechahora).format("HH:mm:ss") : "N/A"),
          Event: "VigiControl Arrival",
          Zone:  zoneName(e),
        });
      }
    }
  }
  log.info("Processed " + result.length + " patrol events (no cap — all will render)");
  return result;
}

function resolveClient(clientData) {
  const id   = clientData.clientId   || clientData.ClientID   || null;
  const name = clientData.clientName || clientData.client     || clientData.ClientName || "";
  const resolvedId   = id   ? id   : name;
  const resolvedName = name ? name : (id ? String(id) : "Unknown Client");
  log.info("Resolved client -> id=\"" + resolvedId + "\" name=\"" + resolvedName + "\"");
  return { resolvedId, resolvedName };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART ROW RENDERER
// ─────────────────────────────────────────────────────────────────────────────
function drawChartRow(doc, x, y, width, rows, rowIndex, totalRows, globalMax) {
  if (!rows.length) return 0;

  const { TITLE_H, PAD_L, PAD_R, PAD_TOP, PAD_BOT, BAR_GAP, MIN_BAR_W, MAX_BAR_W, BAR_H } = CHART;
  const cardH    = TITLE_H + PAD_TOP + BAR_H + PAD_BOT;
  const drawW    = width - PAD_L - PAD_R;
  const colW     = Math.floor(drawW / rows.length);
  const barW     = Math.min(MAX_BAR_W, Math.max(MIN_BAR_W, colW - BAR_GAP));
  const barBaseY = y + TITLE_H + PAD_TOP + BAR_H;

  const { niceMax, gridStep, gridLines } = niceAxis(globalMax);

  doc.fillColor(C.gray100).roundedRect(x, y, width, cardH, 4).fill();

  const titleSuffix = totalRows > 1 ? " (Row " + (rowIndex + 1) + " of " + totalRows + ")" : "";
  doc.fillColor(C.primary).fontSize(10).font("Helvetica-Bold")
     .text("Patrols Completed Per Zone" + titleSuffix, x + PAD_L, y + 8, {
       width: width - PAD_L - PAD_R, lineBreak: false,
     });

  for (let g = 0; g <= gridLines; g++) {
    const gy  = barBaseY - Math.round((BAR_H / gridLines) * g);
    const val = Math.round(gridStep * g);
    doc.strokeColor(C.gray300).lineWidth(0.4)
       .moveTo(x + PAD_L, gy)
       .lineTo(x + width - PAD_R, gy)
       .stroke();
    doc.fillColor(C.gray400).fontSize(5.5).font("Helvetica")
       .text(String(val), x + 2, gy - 4, { width: PAD_L - 4, align: "right", lineBreak: false });
  }

  doc.strokeColor(C.gray400).lineWidth(0.6)
     .moveTo(x + PAD_L, barBaseY)
     .lineTo(x + width - PAD_R, barBaseY)
     .stroke();

  rows.forEach((post, i) => {
    const completed = post.Completed || 0;
    const expected  = post.Expected  || 0;
    const pct       = expected > 0 ? (completed / expected) * 100 : 100;
    const colX      = x + PAD_L + i * colW;
    const centerX   = colX + colW / 2;

    const clampedExpected = Math.min(expected, niceMax);
    if (clampedExpected > 0) {
      const expH = Math.max(2, Math.round((clampedExpected / niceMax) * BAR_H));
      doc.fillColor(C.gray200).rect(centerX - barW / 2, barBaseY - expH, barW, expH).fill();
    }

    const clampedCompleted = Math.min(completed, niceMax);
    if (clampedCompleted > 0) {
      const fillH = Math.max(2, Math.round((clampedCompleted / niceMax) * BAR_H));
      doc.fillColor(perfColor(pct))
         .roundedRect(centerX - barW / 2, barBaseY - fillH, barW, fillH, 2)
         .fill();
    }

    const countH = niceMax > 0 ? Math.round((clampedCompleted / niceMax) * BAR_H) : 2;
    doc.fillColor(C.gray800).fontSize(6).font("Helvetica-Bold")
       .text(String(completed), centerX - 12, barBaseY - countH - 11, {
         width: 24, align: "center", lineBreak: false,
       });

    const rawLabel = cleanPost(post.SecurityPost || post.Zone || "Unknown");
    const labelStr = truncateLabel(doc, rawLabel, colW - 1);
    doc.fillColor(C.gray600).fontSize(5.5).font("Helvetica")
       .text(labelStr, centerX - colW / 2, barBaseY + 4, {
         width: colW, align: "center", lineBreak: true, height: 28, ellipsis: true,
       });
  });

  if (rowIndex === totalRows - 1) {
    const legendY = y + cardH - 14;
    const items   = [
      { color: C.success, label: ">=90%"    },
      { color: C.accent,  label: "70-89%"   },
      { color: C.warning, label: "<70%"     },
      { color: C.gray200, label: "Expected" },
    ];
    let lx = x + PAD_L;
    items.forEach(({ color, label }) => {
      doc.fillColor(color).rect(lx, legendY, 7, 7).fill();
      doc.fillColor(C.gray600).fontSize(5.5).font("Helvetica")
         .text(label, lx + 9, legendY + 0.5, { width: 44, lineBreak: false });
      lx += 58;
    });
  }

  return cardH;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CHART DRAW
// ─────────────────────────────────────────────────────────────────────────────
function drawPatrolsChart(layout, posts) {
  if (!posts || posts.length === 0) return;

  const doc   = layout.doc;
  const x     = layout.left;
  const width = layout.contentW;

  const sorted = [...posts].sort((a, b) => (b.Completed || 0) - (a.Completed || 0));
  const globalMax = Math.max(
    ...sorted.map(p => Math.max(p.Completed || 0, p.Expected || 0)),
    1,
  );

  const zpp  = zonesPerRow(width);
  const rows = [];
  for (let i = 0; i < sorted.length; i += zpp) rows.push(sorted.slice(i, i + zpp));

  log.info("Chart: " + sorted.length + " zone(s) -> " + rows.length + " row(s), ~" + zpp + " zones/row");

  const cardH = computeRowCardHeight();
  if (cardH <= 0) return;

  rows.forEach((rowData, rowIdx) => {
    layout.ensure(cardH);
    drawChartRow(doc, x, layout.y, width, rowData, rowIdx, rows.length, globalMax);
    layout.y = Math.ceil(layout.y + cardH);
    if (rowIdx < rows.length - 1) layout.gap(8);
  });

  layout.gap(20);
}

// ─────────────────────────────────────────────────────────────────────────────
// ALL CLEAR BOX
// ─────────────────────────────────────────────────────────────────────────────
function drawAllClearBox(doc, L, W, y) {
  const BOX_H = 52;
  doc.fillColor("#eff6ff").rect(L, y, W, BOX_H).fill();
  doc.strokeColor("#3b82f6").lineWidth(0.5).rect(L, y, W, BOX_H).stroke();

  const cx = L + 22, cy = y + 26, r = 8;
  doc.fillColor(C.success).circle(cx, cy, r).fill();
  doc.strokeColor(C.white).lineWidth(1.8).lineJoin("round")
     .moveTo(cx - 3.5, cy + 0.5)
     .lineTo(cx - 0.5, cy + 3.5)
     .lineTo(cx + 4,   cy - 3)
     .stroke();

  doc.fillColor(C.success).fontSize(10).font("Helvetica-Bold")
     .text("ALL CLEAR", cx + r + 8, y + 12, { lineBreak: false });
  doc.fillColor(C.gray600).fontSize(8.5).font("Helvetica")
     .text(
       "No security incidents were reported during this period.",
       cx + r + 8, y + 28,
       { width: W - (cx + r + 8 - L) - 12 },
     );
  return BOX_H;
}

// ─────────────────────────────────────────────────────────────────────────────
// FOOTER — written during post-generation page sweep
// ─────────────────────────────────────────────────────────────────────────────
function drawPageFooter(doc, pageIndex, pageCount, left, contentW, pageH) {
  const savedX  = doc.x;
  const savedY  = doc.y;
  const footerY = pageH - 36;

  doc.strokeColor(C.gray300).lineWidth(0.5)
     .moveTo(left, footerY - 4)
     .lineTo(left + contentW, footerY - 4)
     .stroke();

  doc.fillColor(C.gray600).fontSize(7).font("Helvetica")
     .text(
       "Confidential Security Report - For Authorized Personnel Only",
       left, footerY,
       { width: 300, lineBreak: false },
     );

  const pageStr  = "Page " + (pageIndex + 1) + " of " + pageCount;
  const strWidth = doc.widthOfString(pageStr);
  doc.fillColor(C.gray600).fontSize(7).font("Helvetica")
     .text(
       pageStr,
       left + contentW - strWidth, footerY,
       { width: strWidth + 2, lineBreak: false },
     );

  doc.x = savedX;
  doc.y = savedY;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE OVERVIEW — 2×2 metric grid
// ─────────────────────────────────────────────────────────────────────────────
function drawPerformanceOverview(layout, metrics) {
  const doc   = layout.doc;
  const L     = layout.left;
  const ROW_H = 58;
  const COL_W = Math.floor(layout.contentW / 2);
  const ROWS  = Math.ceil(metrics.length / 2);
  const totalH = ROWS * ROW_H;

  layout.ensure(totalH + 8);

  metrics.forEach((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const mx  = L + col * COL_W;
    const my  = layout.y + row * ROW_H;

    doc.fillColor(C.primary).fontSize(22).font("Helvetica-Bold")
       .text(String(m.value), mx, my, { lineBreak: false });
    doc.fillColor(C.black).fontSize(9).font("Helvetica-Bold")
       .text(m.label, mx, my + 25, { lineBreak: false });
    doc.fillColor(C.gray600).fontSize(7.5).font("Helvetica")
       .text(m.sub, mx, my + 37, { width: COL_W - 10, lineBreak: true });
  });

  layout.y = Math.ceil(layout.y + totalH);
  layout.gap(8);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PDF GENERATOR
// ─────────────────────────────────────────────────────────────────────────────
async function generateDashboardPDF(clientData) {
  const t0 = Date.now();
  log.info("=".repeat(60));
  log.info("PDF GENERATION START");

  const {
    startDate,
    endDate,
    // shiftType drives which window (day/night/both) the report covers.
    // sqlStartDate/sqlEndDate may be supplied by the caller (e.g.
    // schedulerController.js's getDatabaseQueryDates()) but are NOT used
    // below — reportModel.js's fetchPatrolReport builds its own
    // shift-scoped window internally from the shiftType string alone.
    shiftType,
  } = clientData;

  if (!startDate || !endDate) throw new Error("Start and end dates are required");

  const normalizedShift = normaliseShiftType(shiftType);
  const shiftLabel       = clientData.shiftLabel || SHIFT_LABELS[normalizedShift] || "";

  const { resolvedId, resolvedName } = resolveClient(clientData);
  if (!resolvedId) throw new Error("Client ID or name is required");

  log.info(
    "Requesting report data: client=" + resolvedId +
    " range=" + startDate + "→" + endDate +
    " shift=" + normalizedShift
  );

  // ✅ FIX 22: pass normalizedShift as a plain STRING — the 6th positional
  // argument of fetchPatrolReport(clientIdOrName, startDate, endDate,
  // usePartitions, reportType, requestedShiftType). Previously this was an
  // object ({ shiftType, sqlStartDate, sqlEndDate }), which
  // reportModel.js's normaliseShiftType() stringifies to "[object object]"
  // and silently treats as "no shift requested" — discarding whatever
  // shift was explicitly asked for. Passing the string directly means an
  // explicit request always reaches reportModel and is honored; only a
  // genuinely absent/null shiftType falls through to reportModel's own
  // fallback (the client's configured shift).
  //
  // "both" is passed through as-is (not converted to null) so a caller
  // that explicitly wants the full day, regardless of the client's
  // configured shift, still gets that — only a fully absent/undefined
  // shiftType should trigger reportModel's client-config fallback.
  const requestedShiftType = shiftType ? normalizedShift : null;

  const reportData = await fetchPatrolReport(
    resolvedId,
    startDate,
    endDate,
    true,
    "custom",
    requestedShiftType,
  );

  if (!reportData?.metadata?.success) {
    throw new Error(reportData?.metadata?.error?.message || "Report generation failed");
  }

  const posts        = Array.isArray(reportData.posts) ? reportData.posts : [];
  const incidents    = processIncidents(reportData);
  const patrolEvents = processPatrolEvents(reportData);

  const {
    clientName: repName          = resolvedName,
    overallPatrolPerformance     = 0,
    totalCompletedPatrols        = 0,
    totalExpectedPatrols         = 0,
    dataQuality                  = {},
  } = reportData.metadata || {};

  const displayName    = resolvedName || repName || "Unknown Client";
  const calcCompleted  = posts.reduce((s, p) => s + (p.Completed || 0), 0);
  const calcExpected   = posts.reduce((s, p) => s + (p.Expected  || 0), 0);
  const calcPerf       = calcExpected > 0 ? Math.round((calcCompleted / calcExpected) * 100) : 0;

  const totalCompleted = totalCompletedPatrols || calcCompleted;
  const totalExpected  = totalExpectedPatrols  || calcExpected;
  const overallPerf    = overallPatrolPerformance || calcPerf;

  const perfLabel = overallPerf >= 90 ? "EXCELLENT"
                  : overallPerf >= 80 ? "GOOD"
                  : overallPerf >= 70 ? "SATISFACTORY"
                  :                     "NEEDS IMPROVEMENT";

  const actualDays     = dayCount(startDate, endDate);
  const startFmt        = fmtDate(startDate);
  const endFmt           = fmtDate(endDate);
  const totalIncidents = incidents.length;
  const highPriority   = incidents.filter(i => i.priority === "HIGH").length;

  const logo     = loadLogo();
  const CONT_TOP = 12 + CONTINUATION_HEADER_H + 10;

  const doc = new PDFDocument({
    margin: 40, size: "A4", bufferPages: true,
    info: {
      Title:   "Security Report - " + displayName + (shiftLabel ? " (" + shiftLabel + ")" : ""),
      Author:  "BM Security",
      Subject: "Patrol Report " + startFmt + " to " + endFmt,
      Creator: "BM Security PDF Service v18",
    },
  });

  // ── Continuation header handler ──────────────────────────────────────────
  const onPageAdded = () => {
    const { count } = doc.bufferedPageRange();
    if (count <= 1) return;
    drawContinuationHeader(doc, logo, displayName, startFmt, endFmt, 40, 595.28 - 80, shiftLabel);
  };
  doc.on("pageAdded", onPageAdded);

  const buffers = [];
  doc.on("data",  c => buffers.push(c));
  const pdfDone = new Promise((res, rej) => {
    doc.on("end",   () => res(Buffer.concat(buffers)));
    doc.on("error", rej);
  });

  const layout = new Layout(doc, {
    left:         40,
    firstPageTop: 40,
    contPageTop:  CONT_TOP,
    bottom:       50,
  });
  const { left: L, contentW: W } = layout;

  // =========================================================================
  // 1. HEADER
  // =========================================================================
  const LOGO_W = 155, LOGO_H = 75;

  if (logo) {
    try { doc.image(logo, L, layout.y, { width: LOGO_W, height: LOGO_H, fit: [LOGO_W, LOGO_H] }); }
    catch { doc.fillColor(C.primary).fontSize(16).font("Helvetica-Bold").text("BM SECURITY", L, layout.y + 10); }
  } else {
    doc.fillColor(C.primary).fontSize(16).font("Helvetica-Bold").text("BM SECURITY", L, layout.y + 10);
  }

  const hx = L + LOGO_W + 18;
  const hy = layout.y + 10;

  doc.fillColor(C.primary).fontSize(18).font("Helvetica-Bold")
     .text("SECURITY PATROL REPORT", hx, hy, { lineBreak: false });
  doc.fillColor(C.black).fontSize(13).font("Helvetica-Bold")
     .text(displayName.toUpperCase(), hx, hy + 26, { lineBreak: false });
  doc.fillColor(C.gray600).fontSize(9).font("Helvetica")
     .text(
       "Period: " + startFmt + " to " + endFmt +
       "  (" + dayjs(startDate).format("dddd") + " – " + dayjs(endDate).format("dddd") + ")" +
       (shiftLabel ? "   ·   " + shiftLabel : ""),
       hx, hy + 48, { lineBreak: false },
     );
  doc.fillColor(C.gray400).fontSize(8).font("Helvetica")
     .text("Generated: " + dayjs().tz(TZ).format("DD/MM/YYYY HH:mm"), hx, hy + 62, { lineBreak: false });

  layout.y = Math.ceil(layout.y + Math.max(LOGO_H, 85) + 18);

  // =========================================================================
  // 2. PERFORMANCE OVERVIEW
  // =========================================================================
  layout.sectionTitle("PERFORMANCE OVERVIEW");
  layout.gap(4);

  drawPerformanceOverview(layout, [
    {
      label: "Overall Performance",
      value: overallPerf + "%",
      sub:   totalCompleted + "/" + totalExpected + " patrols (" + perfLabel + ")",
    },
    {
      label: "Security Posts",
      value: dataQuality.postsCount != null ? dataQuality.postsCount : posts.length,
      sub:   (dataQuality.excellentZones || 0) + " excellent, " + (dataQuality.underperformingZones || 0) + " need attention",
    },
    {
      label: "Incidents Reported",
      value: totalIncidents,
      sub:   totalIncidents === 0 ? "All clear — no incidents" : (highPriority + " high-priority"),
    },
    {
      label: "Patrol Logs",
      value: patrolEvents.length,
      sub:   patrolEvents.length + " arrival records",
    },
  ]);

  // =========================================================================
  // 3. SECURITY INCIDENTS
  // =========================================================================
  layout.sectionTitle("SECURITY INCIDENTS REPORTED");
  layout.gap(6);

  if (totalIncidents === 0) {
    layout.ensure(70);
    drawAllClearBox(doc, L, W, layout.y);
    layout.y = Math.ceil(layout.y + 52);
    layout.gap(18);
  } else {
    layout.ensure(28);
    doc.fillColor(C.black).fontSize(9).font("Helvetica-Bold")
       .text("Total Incidents Reported: " + totalIncidents, L, layout.y, { lineBreak: false });
    layout.y = Math.ceil(layout.y + 22);

    const iCols = [
      { label: "#",                    cx: L + 5,   w: 20  },
      { label: "DATE",                 cx: L + 28,  w: 68  },
      { label: "TIME",                 cx: L + 100, w: 56  },
      { label: "LOCATION / ZONE",      cx: L + 160, w: 118 },
      { label: "INCIDENT DESCRIPTION", cx: L + 282, w: 228 },
    ];
    layout.tableHeader(iCols, 22);

    const DESC_W  = 228;
    const ZONE_W  = 118;
    const LINE_PAD = 14;
    const MIN_ROW  = 28;

    incidents.forEach((inc, i) => {
      doc.font("Helvetica").fontSize(8);
      const descH = doc.heightOfString(String(inc.description || ""), { width: DESC_W });
      const zoneH = doc.heightOfString(String(inc.zone        || ""), { width: ZONE_W });
      const rowH  = Math.ceil(Math.max(MIN_ROW, descH, zoneH) + LINE_PAD);

      const wentToNewPage = layout.ensure(rowH + 2);
      if (wentToNewPage) layout.tableHeader(iCols, 22);

      if (i % 2 === 0) doc.fillColor(C.gray100).rect(L, layout.y, W, rowH).fill();

      const textY = layout.y + 6;
      doc.fillColor(C.black).fontSize(8).font("Helvetica-Bold")
         .text(String(i + 1), L + 5, textY, { width: 20, lineBreak: false });
      doc.font("Helvetica")
         .text(inc.date || "N/A", L + 28,  textY, { width: 68,  lineBreak: false })
         .text(inc.time || "N/A", L + 100, textY, { width: 56,  lineBreak: false });
      doc.text(String(inc.zone        || ""), L + 160, textY, { width: ZONE_W, height: rowH - LINE_PAD, lineBreak: true, ellipsis: true });
      doc.text(String(inc.description || ""), L + 282, textY, { width: DESC_W, height: rowH - LINE_PAD, lineBreak: true, ellipsis: true });

      layout.y = Math.ceil(layout.y + rowH + 2);
    });

    layout.gap(10);
    layout.ensure(34);
    doc.fillColor(C.gray200).rect(L, layout.y, W, 30).fill();
    doc.fillColor(C.gray800).fontSize(9).font("Helvetica-Bold")
       .text("Total Incidents", L + 10, layout.y + 10, { lineBreak: false });
    doc.fillColor(C.primary).fontSize(13).font("Helvetica-Bold")
       .text(String(totalIncidents), L + W - 38, layout.y + 8, { width: 30, align: "right", lineBreak: false });
    layout.y = Math.ceil(layout.y + 44);
  }

  // =========================================================================
  // 4. PATROLS PER ZONE — BAR CHART
  // =========================================================================
  const CHART_MAX_POSTS = 25;

  if (posts.length > 0 && posts.length <= CHART_MAX_POSTS) {
    layout.sectionTitle("PATROLS PER ZONE - VISUAL OVERVIEW");
    layout.gap(6);
    drawPatrolsChart(layout, posts);
  } else if (posts.length > CHART_MAX_POSTS) {
    layout.sectionTitle("PATROLS PER ZONE - VISUAL OVERVIEW");
    layout.gap(6);

    const noticeH = 48;
    layout.ensure(noticeH + 6);
    doc.fillColor(C.gray100).rect(L, layout.y, W, noticeH).fill();
    doc.strokeColor(C.gray300).lineWidth(0.5).rect(L, layout.y, W, noticeH).stroke();

    const icx = L + 22, icy = layout.y + 24, ir = 8;
    doc.fillColor(C.accent).circle(icx, icy, ir).fill();
    doc.fillColor(C.white).fontSize(9).font("Helvetica-Bold")
       .text("i", icx - 2, icy - 6, { width: 10, align: "center", lineBreak: false });
    doc.fillColor(C.primary).fontSize(10).font("Helvetica-Bold")
       .text("Chart Not Shown — Too Many Locations", icx + ir + 8, layout.y + 10, { lineBreak: false });
    doc.fillColor(C.gray600).fontSize(8.5).font("Helvetica")
       .text(
         "This report covers " + posts.length + " security posts (" + CHART_MAX_POSTS +
         " max for chart). See the performance table below for full data.",
         icx + ir + 8, layout.y + 26,
         { width: W - (icx + ir + 8 - L) - 12, lineBreak: false },
       );

    layout.y = Math.ceil(layout.y + noticeH);
    layout.gap(16);
  }

  // =========================================================================
  // 5. PATROL PERFORMANCE TABLE — ALL zones
  // =========================================================================
  if (posts.length > 0) {
    layout.sectionTitle("PATROL PERFORMANCE BY LOCATION");
    layout.gap(6);

    const pCols = [
      { label: "SECURITY POST / ZONE", cx: L + 5,   w: 205 },
      { label: "COMPLETED",            cx: L + 218, w: 72  },
      { label: "EXPECTED",             cx: L + 298, w: 72  },
      { label: "PERFORMANCE %",        cx: L + 378, w: 88  },
    ];
    layout.tableHeader(pCols);

    const sortedPosts = [...posts].sort((a, b) => (b.Performance || 0) - (a.Performance || 0));

    sortedPosts.forEach((post, i) => {
      doc.font("Helvetica").fontSize(8);
      const postName = cleanPost(post.SecurityPost || post.Zone || "Unknown");
      const nameH    = doc.heightOfString(postName, { width: 205 });
      const rowH     = Math.ceil(Math.max(18, nameH) + 10);

      const wentToNewPage = layout.ensure(rowH + 2);
      if (wentToNewPage) layout.tableHeader(pCols);

      if (i % 2 === 0) doc.fillColor(C.gray100).rect(L, layout.y, W, rowH).fill();

      const textY = layout.y + 5;
      doc.fillColor(C.black).fontSize(8).font("Helvetica")
         .text(postName,                          L + 5,   textY, { width: 205, height: rowH - 8, lineBreak: true, ellipsis: true })
         .text(String(post.Completed || 0),       L + 218, textY, { width: 72,  lineBreak: false })
         .text(String(post.Expected  || 0),       L + 298, textY, { width: 72,  lineBreak: false })
         .text(String(post.Percentage || "0%"),   L + 378, textY, { width: 88,  lineBreak: false });

      layout.y = Math.ceil(layout.y + rowH + 2);
    });

    const gtCompleted = posts.reduce((s, p) => s + (p.Completed || 0), 0);
    const gtExpected  = posts.reduce((s, p) => s + (p.Expected  || 0), 0);
    const gtPerf      = gtExpected > 0 ? Math.round((gtCompleted / gtExpected) * 100) : 0;

    layout.totalRow([
      { text: "TOTAL PATROLS",     cx: L + 5,   w: 205 },
      { text: String(gtCompleted), cx: L + 218, w: 72  },
      { text: String(gtExpected),  cx: L + 298, w: 72  },
      { text: gtPerf + "%",        cx: L + 378, w: 88  },
    ]);

    layout.gap(22);
  }

  // =========================================================================
  // 6. SECURITY ACTIVITY LOG
  // =========================================================================
  if (patrolEvents.length > 0) {
    layout.sectionTitle("SECURITY ACTIVITY LOG");
    layout.gap(4);

    layout.ensure(20);
    doc.fillColor(C.gray600).fontSize(8).font("Helvetica")
       .text(patrolEvents.length + " patrol arrival records for this period", L, layout.y, { lineBreak: false });
    layout.y = Math.ceil(layout.y + 18);

    const aCols = [
      { label: "DATE",     cx: L + 5,   w: 74  },
      { label: "TIME",     cx: L + 84,  w: 60  },
      { label: "EVENT",    cx: L + 149, w: 148 },
      { label: "LOCATION", cx: L + 302, w: 208 },
    ];
    layout.tableHeader(aCols, 24);

    const EVENT_W = 148;
    const LOC_W   = 208;
    const ACT_PAD = 10;
    const ACT_MIN = 20;

    patrolEvents.forEach((ev, i) => {
      doc.font("Helvetica").fontSize(8.5);
      const evH  = doc.heightOfString(String(ev.Event || "Patrol Arrival"), { width: EVENT_W });
      const locH = doc.heightOfString(String(ev.Zone  || "Unknown"),        { width: LOC_W   });
      const rowH = Math.ceil(Math.max(ACT_MIN, evH, locH) + ACT_PAD);

      const wentToNewPage = layout.ensure(rowH + 5);
      if (wentToNewPage) layout.tableHeader(aCols, 24);

      if (i % 2 === 0) doc.fillColor(C.gray100).rect(L, layout.y, W, rowH).fill();

      const textY = layout.y + 5;
      doc.fillColor(C.black).fontSize(8.5).font("Helvetica")
         .text(ev.Date || "N/A", L + 5,   textY, { width: 74,      lineBreak: false })
         .text(ev.Time || "N/A", L + 84,  textY, { width: 60,      lineBreak: false })
         .text(String(ev.Event || "Patrol Arrival"), L + 149, textY, { width: EVENT_W, height: rowH - ACT_PAD, lineBreak: true, ellipsis: true })
         .text(String(ev.Zone  || "Unknown"),        L + 302, textY, { width: LOC_W,   height: rowH - ACT_PAD, lineBreak: true, ellipsis: true });

      layout.y = Math.ceil(layout.y + rowH + 3);
    });

    layout.gap(18);
  }

  // =========================================================================
  // Remove pageAdded listener BEFORE section 7 — prevents ghost pages
  // from being stamped with a continuation header during text-wrap reflow.
  // =========================================================================
  doc.removeListener("pageAdded", onPageAdded);

  // =========================================================================
  // 7. REPORT SUMMARY
  // =========================================================================
  doc.font("Helvetica").fontSize(8);
  const summaryLines = [
    "- Patrol Activities: " + patrolEvents.length + " arrival log" + (patrolEvents.length !== 1 ? "s" : ""),
    "- Incident Reports:  " + totalIncidents + " incident" + (totalIncidents !== 1 ? "s" : ""),
    "- Reporting Period:  " + actualDays + " day" + (actualDays !== 1 ? "s" : "") +
      " (" + startFmt + " – " + endFmt + ")" + (shiftLabel ? "  ·  " + shiftLabel : ""),
  ];
  const BOX_INNER_PAD = 12;
  const lineH  = doc.heightOfString(summaryLines[0], { width: W - 32 });
  const sumH   = Math.ceil(BOX_INNER_PAD + 16 + summaryLines.length * (lineH + 4) + BOX_INNER_PAD);
  const SECTION_TITLE_H  = 26;
  const GAP_AFTER_TITLE  = 8;
  const GAP_AFTER_BOX    = 10;
  const END_MARKER_H     = 20 + 8 + 18;
  const totalSummaryH    = SECTION_TITLE_H + GAP_AFTER_TITLE + sumH + GAP_AFTER_BOX + END_MARKER_H;

  layout.ensure(totalSummaryH);

  doc.fillColor(C.primary).fontSize(13).font("Helvetica-Bold")
     .text("REPORT SUMMARY", L, layout.y, { lineBreak: false });
  doc.strokeColor(C.gray300).lineWidth(0.5)
     .moveTo(L, layout.y + 17).lineTo(L + W, layout.y + 17).stroke();
  layout.y = Math.ceil(layout.y + SECTION_TITLE_H);
  layout.gap(GAP_AFTER_TITLE);

  doc.fillColor(C.gray100).rect(L, layout.y, W, sumH).fill();
  doc.strokeColor(C.gray300).lineWidth(0.5).rect(L, layout.y, W, sumH).stroke();
  doc.fillColor(C.gray800).fontSize(8.5).font("Helvetica-Bold")
     .text("Activity Breakdown:", L + BOX_INNER_PAD, layout.y + BOX_INNER_PAD, { lineBreak: false });

  let lineY = layout.y + BOX_INNER_PAD + 16;
  doc.fillColor(C.gray600).fontSize(8).font("Helvetica");
  for (const line of summaryLines) {
    doc.text(line, L + 20, lineY, { width: W - 32, lineBreak: false });
    lineY += lineH + 4;
  }
  layout.y = Math.ceil(layout.y + sumH + GAP_AFTER_BOX);

  layout.y = Math.ceil(layout.y + 20);
  doc.strokeColor(C.gray300).lineWidth(0.8)
     .moveTo(L, layout.y).lineTo(L + W, layout.y).stroke();
  layout.y = Math.ceil(layout.y + 8);
  doc.fillColor(C.gray400).fontSize(7.5).font("Helvetica")
     .text("— End of Report —", L, layout.y, { width: W, align: "center", lineBreak: false });
  layout.y = Math.ceil(layout.y + 18);

  // =========================================================================
  // Record the last content page after ALL drawing is complete.
  // =========================================================================
  const finalRange      = doc.bufferedPageRange();
  const pageCount       = finalRange.count;
  const lastContentPage = finalRange.start + pageCount - 1;

  log.info("Content complete — " + pageCount + " page(s), last page index: " + lastContentPage);

  // =========================================================================
  // 8. FOOTER SWEEP + END
  // =========================================================================
  for (let p = 0; p < pageCount; p++) {
    doc.switchToPage(finalRange.start + p);
    doc.x = L;
    doc.y = 400;
    drawPageFooter(doc, p, pageCount, L, W, layout.pageH);
  }

  doc.switchToPage(lastContentPage);
  doc.x = L;
  doc.y = layout.pageH - 1;

  doc.end();

  const buf = await pdfDone;
  log.info(
    "PDF ready — " + pageCount + " page(s), " + posts.length +
    " zone(s), " + patrolEvents.length + " activity rows, shift=" + normalizedShift +
    " — " + (Date.now() - t0) + "ms",
  );
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// ALIASES
// ─────────────────────────────────────────────────────────────────────────────
async function generateHistoricalReportPDF(data, clientName, dateRange) {
  return generateDashboardPDF({
    clientId: data.clientId || data.client?.ClientID,
    clientName,
    ...dateRange,
  });
}

async function generatePatrolReportPDF(data, clientName, dateRange) {
  return generateDashboardPDF({
    clientId: data.clientId || data.client?.ClientID,
    clientName,
    ...dateRange,
  });
}

async function generatePDFReport(clientData) {
  try {
    const pdfBuffer = await generateDashboardPDF(clientData);
    return { success: true, pdfBuffer, timestamp: new Date(), metadata: clientData };
  } catch (error) {
    log.error("generatePDFReport failed:", error.message);
    const doc  = new PDFDocument();
    const bufs = [];
    doc.on("data", c => bufs.push(c));
    doc.fontSize(18).text("Report Generation Error", 50, 50)
       .fontSize(11).text("Error: "  + error.message,                                              50, 90)
                    .text("Time:  "  + new Date().toISOString(),                                   50, 110)
                    .text("Client: " + (clientData.clientId || clientData.clientName || "Unknown"), 50, 130);
    doc.end();
    await new Promise(r => doc.on("end", r));
    return { success: false, pdfBuffer: Buffer.concat(bufs), error: error.message, timestamp: new Date() };
  }
}

module.exports = {
  generateDashboardPDF,
  generateHistoricalReportPDF,
  generatePatrolReportPDF,
  generatePDFReport,
  normaliseShiftType,
  VALID_SHIFT_TYPES,
};
module.exports.default = module.exports;