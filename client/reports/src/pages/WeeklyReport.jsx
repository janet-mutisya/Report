// SecurityDashboard.jsx - Uses shared auth from App.jsx (no local login screen)
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App"; // adjust path if this file isn't one level under src root
import {
  AlertCircle, Download, Calendar, Building2, TrendingUp, Activity,
  AlertTriangle, CheckCircle, XCircle, Shield, Clock, RefreshCw,
  Sun, Moon, Users, Info, Target, BarChart3, Search, Printer, User,
} from "lucide-react";
import {
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line,
} from "recharts";

// ============================================================
// CONSTANTS
// ============================================================
// Relative paths — same fix already applied to ReportArchive.jsx.
// The Vite dev proxy / production build both resolve "/api/..." correctly
// without needing VITE_API_URL.
const API_BASE = "";

const NO_DATA_ERRORS = {
  NO_CLIENT:        "Please select a client before generating a report.",
  NO_DATE_RANGE:    "Please set both a start date and an end date.",
  END_BEFORE_START: "End date/time must be after start date/time.",
  INVALID_DATES:    "One or more dates are invalid. Please check your inputs.",
  NO_EVENTS:        "No patrol events were recorded for this client in the selected period.",
  NO_SUMMARY:       "No zone performance data was found for this client and date range.",
  EMPTY_RESPONSE:   "The server returned an empty report for the selected period.",
  CLIENT_NOT_FOUND: "The selected client was not found on the server. Please refresh the client list.",
  SERVER_ERROR:     "The server returned an error. Please try again or contact support.",
  NETWORK_ERROR:    "Could not reach the server. Check your connection and try again.",
  NO_ZONE_BREAKDOWN:"Overall totals were returned but no zone-level breakdown is available.",
  UNAUTHORIZED:     "Your session has expired. Please log in again.",
};

function resolveNoDataError(data, httpStatus, fetchError) {
  if (fetchError) return NO_DATA_ERRORS.NETWORK_ERROR;
  if (httpStatus === 401 || httpStatus === 403) return NO_DATA_ERRORS.UNAUTHORIZED;
  if (httpStatus === 404) return NO_DATA_ERRORS.CLIENT_NOT_FOUND;
  if (httpStatus >= 500) return NO_DATA_ERRORS.SERVER_ERROR;
  if (!data) return NO_DATA_ERRORS.EMPTY_RESPONSE;
  if (data.success === false) return data.message || NO_DATA_ERRORS.EMPTY_RESPONSE;

  const payload = (data.data && (Array.isArray(data.data.summary) || Array.isArray(data.data.events)))
    ? data.data : data;

  const hasEvents  = Array.isArray(payload.events)       && payload.events.length  > 0;
  const hasSummary = Array.isArray(payload.summary)      && payload.summary.length > 0;
  const hasPosts   = Array.isArray(payload.posts)        && payload.posts.length   > 0;
  const hasZones   = Array.isArray(payload.zones)        && payload.zones.length   > 0;
  const hasGuard   = Array.isArray(payload.guardReports) && payload.guardReports.length > 0;
  const hasAnyZoneData = hasSummary || hasPosts || hasZones;

  if (!hasEvents && !hasAnyZoneData && !hasGuard) return NO_DATA_ERRORS.NO_EVENTS;
  if (hasEvents && !hasAnyZoneData) return NO_DATA_ERRORS.NO_SUMMARY;
  return null;
}

// ============================================================
// AUTHENTICATED FETCH HELPER
// ============================================================
async function apiFetch(url, token, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  return res;
}

// ============================================================
// MAIN DASHBOARD (Mobile Friendly)
// ============================================================
export default function SecurityDashboard() {
  // ── Auth comes from App.jsx's shared context now ─────────
  // App.jsx's ProtectedRoute already guarantees token/user exist and
  // redirects to /login otherwise, so this component can assume it's
  // only ever rendered when authenticated.
  const { user, token, refresh } = useAuth();
  const navigate = useNavigate();

  // Handle 401 globally — clear shared auth and bounce to /login
  const handle401 = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    refresh();
    setDataError(NO_DATA_ERRORS.UNAUTHORIZED);
    navigate("/login", { replace: true });
  }, [refresh, navigate]);

  // ── Report state ─────────────────────────────────────────
  const [clients, setClients]           = useState([]);
  const [allClients, setAllClients]     = useState([]);
  const [client, setClient]             = useState("");
  const [startDate, setStartDate]       = useState("");
  const [startTime, setStartTime]       = useState("");
  const [endDate, setEndDate]           = useState("");
  const [endTime, setEndTime]           = useState("");
  const [shiftType, setShiftType]       = useState("Day/Night");
  const [availableShifts, setAvailableShifts] = useState([]);
  const [report, setReport]             = useState(null);
  const [loading, setLoading]           = useState(false);
  const [formError, setFormError]       = useState("");
  const [dataError, setDataError]       = useState("");
  const [fetchError, setFetchError]     = useState("");
  const [pdfLoading, setPdfLoading]     = useState(false);
  const [pdfError, setPdfError]         = useState("");
  const [clientScheduleInfo, setClientScheduleInfo] = useState(null);
  const [searchQuery, setSearchQuery]   = useState("");

  const clearErrors = () => { setFormError(""); setDataError(""); setFetchError(""); };

  // ── Helpers ──────────────────────────────────────────────
  const getShiftLabel = useCallback((v) => availableShifts.find(s => s.value === v)?.label || v, [availableShifts]);

  const getShiftIcon = (v) => {
    if (!v) return <Shield className="w-4 h-4" />;
    const n = v.toLowerCase();
    if (n.includes("day") && !n.includes("night")) return <Sun className="w-4 h-4 text-yellow-500" />;
    if (n.includes("night")) return <Moon className="w-4 h-4 text-blue-500" />;
    return <Shield className="w-4 h-4 text-green-500" />;
  };

  const getPerformanceRating = (rate) => {
    const n = typeof rate === "string" ? parseFloat(rate) : rate;
    if (n >= 90) return "Excellent";
    if (n >= 80) return "Good";
    if (n >= 70) return "Fair";
    return "Poor";
  };

  const generateTimeOptions = (interval = 30) => {
    const t = [];
    for (let h = 0; h < 24; h++)
      for (let m = 0; m < 60; m += interval)
        t.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
    return t;
  };
  const timeOptions = generateTimeOptions(30);

  const combineDateTime = (d, t) => { if (!d) return ""; return `${d}T${(t || "00:00").length === 5 ? (t||"00:00")+":00" : t||"00:00:00"}`; };

  // ── Data processing (unchanged logic) ───────────────────
  const processReportData = useCallback((data) => {
    const payload = (data.data && (Array.isArray(data.data.summary) || Array.isArray(data.data.posts)))
      ? data.data : data;

    const rawRows = Array.isArray(payload.summary)       ? payload.summary
                  : Array.isArray(payload.posts)         ? payload.posts
                  : Array.isArray(payload.zones)         ? payload.zones
                  : Array.isArray(payload.zoneData)      ? payload.zoneData
                  : Array.isArray(payload.performance)   ? payload.performance
                  : Array.isArray(payload.securityPosts) ? payload.securityPosts
                  : [];

    if (rawRows.length === 0 && Array.isArray(payload.events) && Array.isArray(payload.zones)) {
      const zoneCounts = {};
      payload.events.forEach(ev => {
        const zoneId = String(ev.Zone || ev.zone || ev.ZoneCode || ev.zoneCode || "").trim();
        const code   = String(ev.alarmCode || ev.Alarm || ev.Event || ev.alarm || "").toUpperCase().trim();
        if (zoneId && (code === "V04" || code.includes("VIGICONTROL"))) {
          if (!zoneCounts[zoneId]) zoneCounts[zoneId] = { completed: 0, zoneName: null };
          zoneCounts[zoneId].completed++;
        }
      });
      payload.zones.forEach(zone => {
        const zoneId = String(zone.ZoneCode || zone.id || zone.code || zone.zoneCode || "").trim();
        const zoneName = zone.Name || zone.name || zone.zoneName || zone.description || `Zone ${zoneId}`;
        if (zoneCounts[zoneId]) zoneCounts[zoneId].zoneName = zoneName;
      });
      const calc = payload.calculations || {};
      const totalExpCalc = calc.totalExpectedPatrols || calc.totalExpected || 0;
      let expectedPerZone = calc.expectedPerZone || calc.expectedPatrolsPerPost || 0;
      const activeZoneCount = Object.keys(zoneCounts).length;
      if (!expectedPerZone && activeZoneCount > 0 && totalExpCalc > 0)
        expectedPerZone = Math.round(totalExpCalc / activeZoneCount);
      const constructed = Object.entries(zoneCounts).map(([zoneId, d]) => {
        const completed = d.completed;
        const expected  = expectedPerZone;
        const rate      = expected > 0 ? (completed / expected) * 100 : 0;
        return { SecurityPost: d.zoneName || `Zone ${zoneId}`, ChecksCompleted: completed, ExpectedChecks: expected, PerformanceRate: `${Math.round(rate)}%`, actualPerformance: rate, exceeded: completed > expected, ZoneCode: zoneId, _constructedFromEvents: true };
      });
      rawRows.push(...constructed);
    }

    const normalised = rawRows.map(row => {
      const siteName  = row.SecurityPost || row.SitePosts || row.zoneName || row.name || row.post || (row.ZoneCode ? `Zone ${row.ZoneCode}` : null) || "Unknown Post";
      const completed = parseInt(row.ChecksCompleted ?? row.Completed ?? row.completed ?? row.count ?? 0) || 0;
      const expected  = parseInt(row.ExpectedChecks  ?? row.Expected  ?? row.expected  ?? row.target ?? 0) || 0;
      let perfNum = 0;
      const perfRaw = row.PerformanceRate ?? row.Performance ?? row.Percentage ?? row.rate ?? row.percent;
      if (perfRaw != null) perfNum = typeof perfRaw === "string" ? parseFloat(perfRaw) : Number(perfRaw);
      if (isNaN(perfNum) && expected > 0) perfNum = (completed / expected) * 100;
      else if (isNaN(perfNum)) perfNum = 0;
      return { SitePosts: String(siteName).trim(), ChecksCompleted: completed, ExpectedChecks: expected, PerformanceRate: `${Math.round(perfNum)}%`, actualPerformance: perfNum, exceeded: completed > expected, zoneCode: row.ZoneCode || row.zoneCode || "", _constructedFromEvents: row._constructedFromEvents || false };
    }).filter(row => {
      const name = (row.SitePosts || "").trim().toLowerCase();
      const invalid = ["unknown","unknown zone","undefined","null","n/a","none"];
      return name.length >= 2 && !invalid.includes(name) && !/^[0-9]+$/.test(name);
    });
    normalised.sort((a, b) => b.ChecksCompleted - a.ChecksCompleted);

    const calc = payload.calculations || {};
    const totalCompleted = Number(calc.totalCompletedPatrols ?? calc.totalCompleted ?? normalised.reduce((s,r) => s + r.ChecksCompleted, 0)) || 0;
    const totalExpected  = Number(calc.totalExpectedPatrols  ?? calc.totalExpected  ?? normalised.reduce((s,r) => s + r.ExpectedChecks,  0)) || 0;
    let completionRate = 0;
    if      (calc.completionRateNumeric    != null) completionRate = Number(calc.completionRateNumeric);
    else if (calc.completionRate           != null) completionRate = parseFloat(String(calc.completionRate));
    else if (calc.overallPatrolPerformance != null) completionRate = Number(calc.overallPatrolPerformance);
    else if (totalExpected > 0)                     completionRate = (totalCompleted / totalExpected) * 100;
    if (isNaN(completionRate)) completionRate = 0;
    const expectedPerZone = Number(calc.expectedPerZone ?? calc.expectedPatrolsPerPost ?? (normalised.length > 0 ? Math.round(totalExpected / normalised.length) : 0)) || 0;
    const shiftDays = Number(payload.period?.shiftDays ?? calc.shiftDays ?? 7) || 7;
    const performanceRating = completionRate >= 90 ? "Excellent" : completionRate >= 80 ? "Good" : completionRate >= 70 ? "Fair" : "Poor";

    return { ...payload, summary: normalised, events: Array.isArray(payload.events) ? payload.events : [], guardReports: Array.isArray(payload.guardReports) ? payload.guardReports : [], calculations: { totalCompleted, totalExpectedPatrols: totalExpected, completionRate: Math.round(completionRate), completionRateNumeric: completionRate, performanceRating, validZonesCount: normalised.length, expectedPerZone, shiftDays }, metadata: payload.metadata || {} };
  }, []);

  const calculateDashboardMetrics = useCallback((report, getRatingFn) => {
    if (!report?.summary || !report?.calculations) return null;
    const { summary, calculations, events = [], guardReports = [] } = report;
    const totalExpected  = calculations.totalExpectedPatrols || 0;
    const totalCompleted = calculations.totalCompleted        || 0;
    const overallRate    = Math.round(parseFloat(calculations.completionRate) || 0);
    const performanceRating = calculations.performanceRating || getRatingFn(overallRate);
    const expectedPerZone   = calculations.expectedPerZone   || 0;

    const performanceData = summary.map(row => ({ name: row.SitePosts, completed: row.ChecksCompleted, expected: row.ExpectedChecks, rate: row.actualPerformance, missed: Math.max(0, row.ExpectedChecks - row.ChecksCompleted), exceeded: row.exceeded })).filter(p => (p.name || "").trim().length > 0);
    const totalMissedPatrols = performanceData.reduce((s, p) => s + p.missed, 0);

    const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const dayBuckets = {};
    for (const ev of events) {
      if (!ev.Date) continue;
      try {
        const parts = String(ev.Date).trim().split("/");
        const d = parts.length === 3 ? new Date(`${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`) : new Date(ev.Date);
        if (!isNaN(d.getTime())) { const label = DAY_LABELS[d.getDay()]; dayBuckets[label] = (dayBuckets[label] || 0) + 1; }
      } catch {}
    }
    const daysInRange = calculations.shiftDays || 7;
    const expectedPerDay = daysInRange > 0 ? totalExpected / daysInRange : 0;
    const WEEK_ORDER = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const weeklyTrendData = WEEK_ORDER.map(day => ({ day, performance: expectedPerDay > 0 ? Math.min(200, Math.round(((dayBuckets[day]||0) / expectedPerDay) * 100)) : overallRate, target: 90 }));

    return { totalIncidents: guardReports.length, guardReportsData: guardReports, totalMissedPatrols, performanceData, totalCompleted, totalExpected, overallRate, performanceRating, weeklyTrendData, validZonesCount: calculations.validZonesCount || performanceData.length, expectedPerZone };
  }, []);

  // ── Client fetching (with auth) ──────────────────────────
  const fetchClients = useCallback(async () => {
    if (!token) return;
    clearErrors();
    try {
      const res = await apiFetch(`${API_BASE}/api/clients`, token);
      if (res.status === 401) { handle401(); return; }
      if (!res.ok) { setFetchError(`Could not load clients: server returned ${res.status}.`); setClients([]); setAllClients([]); return; }
      const data = await res.json();
      if (data.success === true && Array.isArray(data.clients)) {
        setAllClients(data.clients); setClients(data.clients);
      } else { setFetchError("Server returned an unexpected format."); setClients([]); setAllClients([]); }
    } catch { setFetchError("Could not reach the server."); setClients([]); setAllClients([]); }
  }, [token, handle401]);

  const filterClients = useCallback((query) => {
    if (!query || query.trim().length < 2) { setClients(allClients); return; }
    const term = query.toLowerCase().trim();
    setClients(allClients.filter(c => (c.name || c.cue_cnombre || "").toLowerCase().includes(term) || (c.accountNumber || "").toLowerCase().includes(term)));
  }, [allClients]);

  useEffect(() => { const t = setTimeout(() => filterClients(searchQuery), 300); return () => clearTimeout(t); }, [searchQuery, filterClients]);

  const fetchClientScheduleInfo = useCallback(async (clientName) => {
    if (!clientName || !token) { setAvailableShifts([]); setShiftType("Day/Night"); setClientScheduleInfo(null); return; }
    try {
      const res = await apiFetch(`${API_BASE}/api/reports/shifts?client=${encodeURIComponent(clientName)}`, token);
      if (res.status === 401) { handle401(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setAvailableShifts(data.availableShifts || []);
        setClientScheduleInfo(data.schedule);
        const def = data.availableShifts?.find(s => s.default);
        setShiftType(def ? def.value : "Day/Night");
      } else throw new Error();
    } catch {
      setAvailableShifts([{ value: "Day/Night", label: "Day & Night Shifts", default: true }, { value: "Day", label: "Day Shift Only" }, { value: "Night", label: "Night Shift Only" }]);
      setShiftType("Day/Night");
      setClientScheduleInfo(null);
    }
  }, [token, handle401]);

  useEffect(() => { if (token) fetchClients(); }, [token, fetchClients]);

  useEffect(() => {
    if (client) fetchClientScheduleInfo(client);
    else { setAvailableShifts([]); setShiftType("Day/Night"); setClientScheduleInfo(null); }
  }, [client, fetchClientScheduleInfo]);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    const oneWeekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().split("T")[0];
    if (!startDate) setStartDate(oneWeekAgo);
    if (!endDate) setEndDate(today);
  }, [startDate, endDate]);

  // ── Generate report (with auth) ──────────────────────────
  const handleFetchReport = useCallback(async () => {
    clearErrors(); setReport(null);
    if (!client)             { setFormError(NO_DATA_ERRORS.NO_CLIENT); return; }
    if (!startDate || !endDate) { setFormError(NO_DATA_ERRORS.NO_DATE_RANGE); return; }
    const startDateTime = combineDateTime(startDate, startTime || "00:00");
    const endDateTime   = combineDateTime(endDate,   endTime   || "23:59");
    const startObj = new Date(startDateTime); const endObj = new Date(endDateTime);
    if (isNaN(startObj.getTime()) || isNaN(endObj.getTime())) { setFormError(NO_DATA_ERRORS.INVALID_DATES); return; }
    if (endObj < startObj) { setFormError(NO_DATA_ERRORS.END_BEFORE_START); return; }

    setLoading(true);
    let res, data, httpStatus;
    try {
      const url = `${API_BASE}/api/reports/patrol?client=${encodeURIComponent(client)}&startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}&shiftType=${encodeURIComponent(shiftType)}`;
      res = await apiFetch(url, token);
      httpStatus = res.status;
      data = await res.json();
    } catch { setFetchError(NO_DATA_ERRORS.NETWORK_ERROR); setLoading(false); return; }

    if (httpStatus === 401) { handle401(); setLoading(false); return; }
    if (!res.ok) { setDataError(resolveNoDataError(data, httpStatus, null)); setLoading(false); return; }
    if (!data || data.success === false) { setDataError(data?.message || NO_DATA_ERRORS.EMPTY_RESPONSE); setLoading(false); return; }

    const noDataMsg = resolveNoDataError(data, httpStatus, null);
    const processed = processReportData(data);
    const hasEvents  = processed.events.length  > 0;
    const hasSummary = processed.summary.length > 0;
    const hasGuard   = processed.guardReports.length > 0;

    if (!hasEvents && !hasSummary && !hasGuard) { setDataError(noDataMsg || NO_DATA_ERRORS.EMPTY_RESPONSE); setLoading(false); return; }
    if (!hasSummary && hasEvents) setDataError(NO_DATA_ERRORS.NO_ZONE_BREAKDOWN);

    setReport(processed);
    setLoading(false);
  }, [token, client, startDate, startTime, endDate, endTime, shiftType, processReportData, handle401]);

  // ── Export (with auth) ───────────────────────────────────
  const downloadPDF = async () => {
    if (!client || !startDate || !endDate) { setPdfError("Please select client, start date, and end date first."); return; }
    setPdfLoading(true); setPdfError("");
    try {
      const params = new URLSearchParams({ clientName: client, startDate, endDate, shiftType });
      const res = await apiFetch(`${API_BASE}/api/reports/dashboard-pdf?${params}`, token);
      if (res.status === 401) { handle401(); return; }
      if (!res.ok) throw new Error(`PDF generation failed: ${res.status} ${res.statusText}`);
      const ct = res.headers.get("content-type");
      if (!ct || !ct.includes("application/pdf")) { const err = await res.json(); throw new Error(err?.message || "Server returned non-PDF response"); }
      const blob = await res.blob();
      const dlUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = dlUrl; link.download = `Security_Report_${client.replace(/[^a-zA-Z0-9]/g,"_")}_${startDate}_to_${endDate}.pdf`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      window.URL.revokeObjectURL(dlUrl);
    } catch (err) { setPdfError(`Failed to download PDF: ${err.message}`); }
    finally { setPdfLoading(false); }
  };

  const exportToCSV = useCallback(() => {
    if (!report?.summary) return;
    const headers = ["Security Post","Checks Completed","Expected Checks","Performance Rate"];
    const rows = report.summary.map(r => [r.SitePosts, r.ChecksCompleted, r.ExpectedChecks, r.PerformanceRate]);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([headers.join(",") + "\n" + rows.map(r => r.join(",")).join("\n")], { type: "text/csv" }));
    link.download = `security-report-${client}-${startDate}-to-${endDate}.csv`;
    link.click(); URL.revokeObjectURL(link.href);
  }, [report, client, startDate, endDate]);

  const formatIncidentDescription = useCallback((incident) => {
    if (!incident) return "Unknown Incident";
    const s = String(incident).toLowerCase().trim();
    const map = { theft: "Theft/Burglary", burglary: "Theft/Burglary", vandalism: "Vandalism", trespassing: "Unauthorized Entry", unauthorized: "Unauthorized Entry", safety: "Safety Hazard", emergency: "Emergency Situation", alarm: "Alarm Activation", assault: "Assault", disturbance: "Disturbance", suspicious: "Suspicious Activity" };
    for (const [k, v] of Object.entries(map)) if (s.includes(k)) return v;
    return s.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").trim();
  }, []);

  const formatEventDescription = useCallback((event) => {
    if (!event) return "Unknown Event";
    if (typeof event === "string" && (event.includes("VIGICONTROL:") || event.includes("Arrival") || event.includes("Login") || event.includes("Logout") || event.includes("Patrol"))) return event;
    const s = String(event).toLowerCase().trim();
    const map = { v04: "VIGICONTROL: Arrival", v10: "VIGICONTROL: Login", v11: "VIGICONTROL: Logout", _pi: "Patrol Incident", _pd: "Patrol Departure", "vigicontrol: arribo": "VIGICONTROL: Arrival" };
    if (map[s]) return map[s];
    for (const [k, v] of Object.entries(map)) if (s.includes(k)) return v;
    return s.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").replace(/v(\d+)/, "Security Check $1").trim();
  }, []);

  const handleRefresh = () => { fetchClients(); setSearchQuery(""); };

  const metrics = report ? calculateDashboardMetrics(report, getPerformanceRating) : null;
  const hasData = report && (report.summary?.length > 0 || report.events?.length > 0 || report.guardReports?.length > 0);
  const isWarning = dataError === NO_DATA_ERRORS.NO_ZONE_BREAKDOWN;

  // ============================================================
  // DASHBOARD RENDER (Mobile Optimized)
  // ============================================================
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-blue-50 p-3 md:p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header - Mobile Friendly */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl md:rounded-2xl shadow-2xl p-4 md:p-8 mb-4 md:mb-8 text-white">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-4">
            <div className="shrink-0 w-full md:w-auto">
              <h1 className="text-2xl md:text-4xl font-bold mb-1 md:mb-2 flex items-center gap-2 md:gap-3">
                <Activity className="w-6 h-6 md:w-10 md:h-10 shrink-0" />
                <span className="text-lg md:text-2xl">Security Performance Dashboard</span>
              </h1>
              <p className="text-blue-100 text-sm md:text-lg">Real-time security operations analytics</p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 md:gap-4 shrink-0 w-full md:w-auto">
              {/* User badge - Mobile Optimized */}
              <div className="flex items-center justify-between gap-3 bg-blue-500 bg-opacity-50 rounded-lg px-3 py-2 md:px-4 md:py-2">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 shrink-0" />
                  <span className="text-xs md:text-sm font-medium truncate max-w-[120px] md:max-w-none">{user?.username || user?.name || "Logged in"}</span>
                </div>
                {user?.role && <span className="text-xs bg-blue-400/40 px-2 py-0.5 rounded-full capitalize">{user.role}</span>}
              </div>
              <button onClick={handleRefresh} className="flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-400 px-3 py-2 md:px-4 md:py-2 rounded-lg transition-all shrink-0 text-sm md:text-base">
                <RefreshCw className="w-4 h-4 shrink-0" /> <span className="hidden sm:inline">Refresh Clients</span><span className="sm:hidden">Refresh</span>
              </button>
              <div className="bg-blue-500 bg-opacity-50 rounded-lg px-3 py-2 md:px-6 md:py-3 shrink-0 text-center md:text-left">
                <div className="text-xs md:text-sm text-blue-100">Last Updated</div>
                <div className="text-sm md:text-xl font-semibold">{new Date().toLocaleTimeString()}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Report Configuration - Mobile Optimized */}
        <div className="bg-white rounded-xl md:rounded-2xl shadow-xl p-4 md:p-6 mb-4 md:mb-8 border border-gray-100">
          <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-3 md:mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600 shrink-0" /> Report Configuration
          </h2>

          {/* Client Search - Mobile Optimized */}
          <div className="mb-4 md:mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Search className="inline w-4 h-4 mr-1 shrink-0" />
              Search Clients ({clients.length} loaded)
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Type client name or account number..."
                className="flex-1 border border-gray-300 rounded-lg p-2.5 text-sm md:text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              <div className="flex gap-2">
                <button onClick={() => filterClients(searchQuery)} disabled={!searchQuery || searchQuery.trim().length < 2}
                  className="flex-1 sm:flex-none items-center gap-2 bg-blue-600 text-white rounded-lg px-3 py-2.5 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all shrink-0 text-sm">
                  <Search className="w-4 h-4 shrink-0" /> Search
                </button>
                <button onClick={() => { setSearchQuery(""); setClients(allClients); }} disabled={!searchQuery}
                  className="flex-1 sm:flex-none items-center gap-2 bg-gray-200 text-gray-700 rounded-lg px-3 py-2.5 hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 transition-all shrink-0 text-sm">
                  <XCircle className="w-4 h-4 shrink-0" /> Clear
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {searchQuery && searchQuery.trim().length >= 2
                ? `Showing ${clients.length} of ${allClients.length} clients matching "${searchQuery}"`
                : `Showing all ${allClients.length} clients`}
            </p>
          </div>

          {/* Form Grid - Mobile Optimized */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 md:gap-4">
            {/* Client selector */}
            <div className="sm:col-span-1 lg:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Building2 className="inline w-4 h-4 mr-1 shrink-0" /> Select Client *
              </label>
              <select value={client} onChange={e => setClient(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 text-sm md:text-base focus:ring-2 focus:ring-blue-500" disabled={loading}>
                <option value="">{clients.length === 0 ? "Loading..." : "-- Select Client --"}</option>
                {clients.map((c, i) => (
                  <option key={c.id || i} value={c.name || c.cue_cnombre}>
                    {c.name || c.cue_cnombre}{c.accountNumber ? ` (${c.accountNumber})` : ""}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-xs">
                {clients.length > 0 ? <span className="text-green-600">✓ {clients.length} clients loaded</span>
                  : fetchError ? <span className="text-red-500">✗ Failed to load</span>
                  : <span className="text-gray-500">Loading clients...</span>}
              </div>
            </div>

            {/* Start date/time */}
            <div className="sm:col-span-1 lg:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="inline w-4 h-4 mr-1 shrink-0" /> Start Date & Time
              </label>
              <div className="flex gap-2">
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg p-2.5 text-sm md:text-base focus:ring-2 focus:ring-blue-500" />
                <select value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg p-2.5 text-sm md:text-base focus:ring-2 focus:ring-blue-500">
                  <option value="">Time</option>
                  {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* End date/time */}
            <div className="sm:col-span-1 lg:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="inline w-4 h-4 mr-1 shrink-0" /> End Date & Time
              </label>
              <div className="flex gap-2">
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg p-2.5 text-sm md:text-base focus:ring-2 focus:ring-blue-500" />
                <select value={endTime} onChange={e => setEndTime(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg p-2.5 text-sm md:text-base focus:ring-2 focus:ring-blue-500">
                  <option value="">Time</option>
                  {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* Shift type */}
            <div className="sm:col-span-1 lg:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Clock className="inline w-4 h-4 mr-1 shrink-0" /> Shift Type
              </label>
              <select value={shiftType} onChange={e => setShiftType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 text-sm md:text-base focus:ring-2 focus:ring-blue-500"
                disabled={loading || !client}>
                {!client ? <option value="">Select client first</option>
                  : availableShifts.length === 0 ? <option value="">Loading shifts...</option>
                  : availableShifts.map(s => <option key={s.value} value={s.value}>{s.label}{s.default ? " ★" : ""}</option>)}
              </select>
            </div>

            {/* Generate button */}
            <div className="sm:col-span-2 lg:col-span-6">
              <button onClick={handleFetchReport} disabled={loading || !client}
                className="w-full bg-blue-600 text-white rounded-lg p-3 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-all shadow-lg hover:shadow-xl text-sm md:text-base">
                {loading
                  ? <span className="flex items-center justify-center gap-2"><RefreshCw className="w-5 h-5 animate-spin shrink-0" /> Loading...</span>
                  : <span className="flex items-center justify-center gap-2"><TrendingUp className="w-5 h-5 shrink-0" /> Generate Report</span>}
              </button>
            </div>
          </div>

          {/* Schedule info badge - Mobile Optimized */}
          {clientScheduleInfo && (
            <div className="mt-4 p-3 md:p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-semibold text-blue-800 mb-2 text-sm md:text-base flex items-center gap-2">
                <Shield className="w-4 h-4 shrink-0" /> Patrol Schedule Configuration
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 text-xs md:text-sm">
                <div><span className="text-blue-600">Shift:</span><p className="font-medium flex items-center gap-1">{getShiftIcon(clientScheduleInfo.shiftType)}{clientScheduleInfo.shiftType || "Day/Night"}</p></div>
                <div><span className="text-blue-600">Weekday Patrols:</span><p className="font-medium">{clientScheduleInfo.patrolsPerDay || "11"}/day</p></div>
                <div><span className="text-blue-600">Weekend Patrols:</span><p className="font-medium">{clientScheduleInfo.weekendPatrols || "11"}/day</p></div>
                <div><span className="text-blue-600">Weekly Total:</span><p className="font-medium">{clientScheduleInfo.weeklyTotal || "N/A"}</p></div>
                <div className="col-span-2 sm:col-span-1"><span className="text-blue-600">Active Days:</span><p className="font-medium text-xs">{clientScheduleInfo.patrolDays || "Mon-Sun"}</p></div>
              </div>
            </div>
          )}
        </div>

        {/* ── ERROR BANNERS (Mobile Optimized) ─────────────────────────── */}
        {fetchError && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-3 md:p-4 mb-4 md:mb-6 flex items-start gap-2 md:gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div><h3 className="font-semibold text-red-900 text-sm md:text-base">Connection Error</h3><p className="text-red-700 text-xs md:text-sm">{fetchError}</p></div>
          </div>
        )}
        {formError && (
          <div className="bg-orange-50 border-l-4 border-orange-500 rounded-lg p-3 md:p-4 mb-4 md:mb-6 flex items-start gap-2 md:gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
            <div><h3 className="font-semibold text-orange-900 text-sm md:text-base">Invalid Input</h3><p className="text-orange-700 text-xs md:text-sm">{formError}</p></div>
          </div>
        )}
        {dataError && !isWarning && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 md:p-5 mb-4 md:mb-6 flex items-start gap-2 md:gap-3">
            <XCircle className="w-5 h-5 md:w-6 md:h-6 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900 text-sm md:text-base">No Data Found</h3>
              <p className="text-red-700 text-xs md:text-sm mt-1">{dataError}</p>
              <p className="text-red-500 text-xs mt-1 md:mt-2">Try adjusting the date range or shift type, or confirm that patrol events were recorded for this client.</p>
            </div>
          </div>
        )}
        {dataError && isWarning && (
          <div className="bg-yellow-50 border-l-4 border-yellow-500 rounded-lg p-3 md:p-4 mb-4 md:mb-6 flex items-start gap-2 md:gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-yellow-900 text-sm md:text-base">Partial Data Warning</h3>
              <p className="text-yellow-700 text-xs md:text-sm">{dataError}</p>
              <p className="text-yellow-600 text-xs mt-1">Overall totals are shown below, but the zone breakdown chart and table are unavailable.</p>
            </div>
          </div>
        )}
        {pdfError && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-3 md:p-4 mb-4 md:mb-6 flex items-start gap-2 md:gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div><h3 className="font-semibold text-red-900 text-sm md:text-base">PDF Error</h3><p className="text-red-700 text-xs md:text-sm">{pdfError}</p></div>
          </div>
        )}

        {/* ── EXPORT OPTIONS (Mobile Optimized) ──────────────────────────── */}
        {hasData && (
          <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 mb-4 md:mb-6 border border-gray-200">
            <h3 className="text-base md:text-lg font-bold text-gray-900 mb-3 md:mb-4 flex items-center gap-2">
              <Printer className="w-5 h-5 text-blue-600 shrink-0" /> Export Options
            </h3>
            <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto sm:ml-auto">
                <button onClick={downloadPDF} disabled={pdfLoading || !client}
                  className="flex items-center justify-center gap-2 bg-blue-600 text-white rounded-lg px-4 py-2.5 md:px-6 md:py-3 hover:bg-blue-700 transition-all shadow-lg disabled:bg-gray-400 disabled:cursor-not-allowed font-medium text-sm md:text-base">
                  {pdfLoading ? <><RefreshCw className="w-4 h-4 animate-spin shrink-0" /> Generating...</> : <><Download className="w-4 h-4 shrink-0" /> PDF Report</>}
                </button>
                <button onClick={exportToCSV} disabled={!report}
                  className="flex items-center justify-center gap-2 bg-purple-600 text-white rounded-lg px-4 py-2.5 md:px-6 md:py-3 hover:bg-purple-700 transition-all shadow-lg disabled:bg-gray-400 disabled:cursor-not-allowed font-medium text-sm md:text-base">
                  <Download className="w-4 h-4 shrink-0" /> CSV Data
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── DASHBOARD CONTENT (Mobile Optimized) ──────────────────────── */}
        {hasData && metrics && (
          <>
            {report.summary?.some(r => r._constructedFromEvents) && (
              <div className="bg-blue-50 border-l-4 border-blue-500 rounded-lg p-3 md:p-4 mb-4 md:mb-6 flex items-start gap-2 md:gap-3">
                <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div><h3 className="font-semibold text-blue-900 text-sm md:text-base">Fallback Mode Active</h3><p className="text-blue-700 text-xs md:text-sm">Zone breakdown was constructed from raw events because the backend did not send a pre-calculated summary array. Values may differ slightly from backend expectations.</p></div>
              </div>
            )}

            <div className="flex flex-col md:flex-row justify-between items-start mb-4 md:mb-6 gap-3 md:gap-4">
              <div className="shrink-0">
                <h2 className="text-xl md:text-2xl font-bold text-gray-900">Dashboard Analytics</h2>
                <p className="text-xs md:text-sm text-gray-600 break-words">
                  {client} • {startDate}{startTime ? ` ${startTime}` : ""} to {endDate}{endTime ? ` ${endTime}` : ""}
                  <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs font-medium inline-block mt-1 md:mt-0">{report.shift?.effective || getShiftLabel(shiftType)}</span>
                  {report.calculations?.shiftDays > 0 && <span className="ml-2 px-2 py-1 bg-gray-100 text-gray-700 rounded-md text-xs font-medium inline-block mt-1 md:mt-0">{report.calculations.shiftDays} days</span>}
                </p>
              </div>
            </div>

            {/* Guard Reports - Mobile Optimized */}
            <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 mb-4 md:mb-8 border border-gray-200">
              <h3 className="text-base md:text-lg font-bold text-gray-900 mb-3 md:mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" /> Security Incidents & Guard Reports
              </h3>
              {metrics.totalIncidents > 0 ? (
                <div className="space-y-3 md:space-y-4">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 md:p-4">
                    <p className="text-base md:text-lg font-semibold text-red-800">Total Security Incidents Reported: {metrics.totalIncidents}</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border border-gray-200 rounded-lg overflow-hidden text-xs md:text-sm">
                      <thead className="bg-red-50">
                        <tr>
                          {["#","Date","Zone","Incident Description"].map(h => <th key={h} className="px-2 md:px-4 py-2 md:py-3 text-left text-xs font-bold text-gray-700 uppercase">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {metrics.guardReportsData.slice(0, 50).map((inc, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-2 md:px-4 py-2 md:py-3 font-semibold text-gray-900">{i+1}</td>
                            <td className="px-2 md:px-4 py-2 md:py-3 text-gray-700 break-words">{inc.date || "N/A"}</td>
                            <td className="px-2 md:px-4 py-2 md:py-3 text-gray-700 break-words">{inc.zone || "N/A"}</td>
                            <td className="px-2 md:px-4 py-2 md:py-3 text-gray-700 break-words">{formatIncidentDescription(inc.details || inc.report)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {metrics.guardReportsData.length > 50 && (
                      <p className="text-xs text-gray-500 mt-2 text-center">Showing first 50 of {metrics.guardReportsData.length} incidents</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 md:p-4">
                  <p className="text-sm md:text-lg font-semibold text-green-800 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 shrink-0" /> No security incidents reported during this period
                  </p>
                </div>
              )}
            </div>

            {/* Key Metrics - Mobile Optimized Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-4 md:mb-8">
              {[
                { label: "Total Incidents",  value: metrics.totalIncidents,      sub: "Security incidents",        icon: AlertTriangle, gradient: "from-blue-500 to-blue-600" },
                { label: "Checks Completed", value: metrics.totalCompleted,      sub: `Expected: ${metrics.totalExpected}`, icon: CheckCircle, gradient: "from-green-500 to-green-600" },
                { label: "Missed Patrols",   value: metrics.totalMissedPatrols,  sub: "Incomplete checks",         icon: XCircle,      gradient: "from-red-500 to-red-600" },
                { label: "Performance",      value: `${metrics.overallRate}%`,   sub: getPerformanceRating(metrics.overallRate), icon: TrendingUp, gradient: "from-purple-500 to-purple-600" },
              ].map(({ label, value, sub, icon: Icon, gradient }) => (
                <div key={label} className={`bg-gradient-to-br ${gradient} rounded-xl shadow-lg p-4 md:p-6 text-white`}>
                  <div className="flex items-center justify-between mb-2 md:mb-3">
                    <h3 className="text-xs md:text-sm font-semibold opacity-90 uppercase">{label}</h3>
                    <Icon className="w-5 h-5 md:w-6 md:h-6 opacity-90 shrink-0" />
                  </div>
                  <p className="text-2xl md:text-4xl font-bold mb-1 md:mb-2">{value}</p>
                  <p className="text-xs md:text-sm opacity-80">{sub}</p>
                </div>
              ))}
            </div>

            {/* Charts - Mobile Optimized */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-4 md:mb-8">
              <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 border border-gray-200">
                <h3 className="text-base md:text-lg font-bold text-gray-900 mb-3 md:mb-4 flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-600 shrink-0" /> Performance Distribution
                </h3>
                {metrics.performanceData.length > 0 ? (() => {
                  const segments = [
                    { name: "Exceeded Target",  color: "#3b82f6", items: metrics.performanceData.filter(p =>  p.exceeded) },
                    { name: "Excellent (≥90%)", color: "#10b981", items: metrics.performanceData.filter(p => !p.exceeded && p.rate >= 90) },
                    { name: "Good (80-89%)",    color: "#84cc16", items: metrics.performanceData.filter(p => !p.exceeded && p.rate >= 80 && p.rate < 90) },
                    { name: "Fair (70-79%)",    color: "#eab308", items: metrics.performanceData.filter(p => !p.exceeded && p.rate >= 70 && p.rate < 80) },
                    { name: "Poor (<70%)",      color: "#ef4444", items: metrics.performanceData.filter(p => !p.exceeded && p.rate < 70) },
                  ].filter(s => s.items.length > 0);
                  if (!segments.length) return <div className="h-64 md:h-80 flex items-center justify-center"><p className="text-gray-500 text-sm">All zones have 0% performance</p></div>;
                  return (
                    <ResponsiveContainer width="100%" height={280} minHeight={280}>
                      <PieChart>
                        <Pie data={segments.map(s => ({ name: s.name, value: s.items.length }))} cx="50%" cy="50%" labelLine={false} label={({ name, percent }) => percent > 0.05 ? `${name}: ${Math.round(percent*100)}%` : ''} outerRadius={80} dataKey="value">
                          {segments.map((s, i) => <Cell key={i} fill={s.color} />)}
                        </Pie>
                        <Tooltip formatter={(v, n) => [v, n]} contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "12px" }} />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: "11px" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  );
                })() : (
                  <div className="h-64 md:h-80 flex items-center justify-center text-center">
                    <div><p className="text-gray-500 text-sm mb-2">No zone performance data available</p><p className="text-xs text-red-500">The backend did not return a zone-level summary array.</p></div>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 border border-gray-200">
                <h3 className="text-base md:text-lg font-bold text-gray-900 mb-3 md:mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-600 shrink-0" /> Weekly Performance Trend
                </h3>
                <ResponsiveContainer width="100%" height={280} minHeight={280}>
                  <LineChart data={metrics.weeklyTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" tick={{ fill: "#6b7280", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip formatter={v => [`${Math.round(v)}%`, "Performance"]} contentStyle={{ fontSize: "12px" }} />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Line type="monotone" dataKey="performance" stroke="#10b981" strokeWidth={2} name="Performance" />
                    <Line type="monotone" dataKey="target" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 5" name="Target" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Performance Table - Mobile Optimized */}
            <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 mb-4 md:mb-8 border border-gray-200">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 md:mb-4 gap-2">
                <h3 className="text-base md:text-lg font-bold text-gray-900">Detailed Performance Summary</h3>
                <span className="text-xs md:text-sm text-gray-600">Showing {report.summary.length} post{report.summary.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs md:text-sm">
                  <thead className="bg-blue-50">
                    <tr>
                      {["Security Post","Completed","Expected","Performance"].map(h => <th key={h} className="px-2 md:px-4 py-2 md:py-3 text-left text-xs font-bold text-gray-700 uppercase">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {report.summary.map((row, i) => {
                      const rate = row.actualPerformance; const exceeded = row.exceeded;
                      return (
                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                          <td className="px-2 md:px-4 py-2 md:py-3 font-semibold text-gray-900 break-words max-w-[150px] md:max-w-none">{row.SitePosts}</td>
                          <td className="px-2 md:px-4 py-2 md:py-3 text-gray-700">{row.ChecksCompleted}</td>
                          <td className="px-2 md:px-4 py-2 md:py-3 text-gray-700">{row.ExpectedChecks}</td>
                          <td className="px-2 md:px-4 py-2 md:py-3">
                            <span className={`px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-bold whitespace-nowrap ${exceeded ? "bg-blue-100 text-blue-800" : rate >= 90 ? "bg-green-100 text-green-800" : rate >= 80 ? "bg-lime-100 text-lime-800" : rate >= 70 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}`}>
                              {row.PerformanceRate}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Events Log - Mobile Optimized */}
            {report.events?.length > 0 && (
              <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 border border-gray-200">
                <h3 className="text-base md:text-lg font-bold text-gray-900 mb-3 md:mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-600 shrink-0" /> Patrol Events Log ({report.events.length} events)
                </h3>
                <div className="overflow-x-auto max-h-[400px] md:max-h-[600px] overflow-y-auto">
                  <table className="w-full text-xs md:text-sm">
                    <thead className="bg-blue-50 sticky top-0">
                      <tr>
                        {["Date","Time","Event","Zone"].map(h => <th key={h} className="px-2 md:px-4 py-2 md:py-3 text-left text-xs font-bold text-gray-700 uppercase">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {report.events.slice(0, 100).map((ev, i) => (
                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                          <td className="px-2 md:px-4 py-2 md:py-3 whitespace-nowrap text-gray-900 font-medium text-xs">{ev.Date}</td>
                          <td className="px-2 md:px-4 py-2 md:py-3 whitespace-nowrap text-gray-700 text-xs">{ev.Time || "N/A"}</td>
                          <td className="px-2 md:px-4 py-2 md:py-3 text-gray-700 break-words max-w-[200px] md:max-w-none">{ev.formattedEvent || formatEventDescription(ev.Event)}</td>
                          <td className="px-2 md:px-4 py-2 md:py-3 text-gray-700 break-words">{ev.Zone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report.events.length > 100 && (
                    <p className="text-xs text-gray-500 mt-2 text-center">Showing first 100 of {report.events.length} events</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Empty state - Mobile Optimized */}
        {!loading && !hasData && !dataError && !formError && !fetchError && (
          <div className="bg-white rounded-xl md:rounded-2xl shadow-xl p-6 md:p-12 text-center border border-gray-200">
            <Users className="w-12 h-12 md:w-16 md:h-16 text-gray-400 mx-auto mb-3 md:mb-4 shrink-0" />
            <h3 className="text-lg md:text-xl font-bold text-gray-900 mb-2">
              {clients.length > 0 ? "Ready to Generate Report" : "Loading Dashboard"}
            </h3>
            <p className="text-sm md:text-base text-gray-600 mb-3 md:mb-4">
              {clients.length > 0 ? "Select a client and date range to generate your dashboard" : "Connecting to server..."}
            </p>
            {clients.length > 0 && (
              <div className="text-xs md:text-sm text-gray-500 space-y-1 text-left max-w-xs mx-auto">
                <p>✓ {clients.length} clients loaded</p>
                <p>✓ Set start and end dates</p>
                <p>✓ Select shift type</p>
                <p>✓ Click "Generate Report"</p>
              </div>
            )}
          </div>
        )}

        {/* Loading state - Mobile Optimized */}
        {loading && (
          <div className="bg-white rounded-xl md:rounded-2xl shadow-xl p-6 md:p-12 text-center border border-gray-200">
            <RefreshCw className="w-12 h-12 md:w-16 md:h-16 text-blue-500 mx-auto mb-3 md:mb-4 animate-spin shrink-0" />
            <h3 className="text-lg md:text-xl font-bold text-gray-900 mb-2">Loading Report...</h3>
            <p className="text-sm md:text-base text-gray-600">Please wait while we fetch your security data</p>
          </div>
        )}

      </div>
    </div>
  );
}