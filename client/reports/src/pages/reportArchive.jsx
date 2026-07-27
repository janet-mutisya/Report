import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, Download, Eye, AlertTriangle, Shield, FileText, X,
  Loader, CheckCircle, Radio, Info,
} from "lucide-react";

// ─── API base ─────────────────────────────────────────────────────────────────
const API         = "/api/archive";
const CLIENTS_API = "/api/clients";

// ─── Auth ─────────────────────────────────────────────────────────────────────
function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "2-digit", month: "short", year: "numeric",
  });
}

function perfBadgeClass(pct) {
  const p = Number(pct) || 0;
  if (p >= 90) return "bg-green-100 text-green-800";
  if (p >= 70) return "bg-blue-100 text-blue-800";
  return "bg-amber-100 text-amber-800";
}

function alarmBadgeClass(code) {
  const c = String(code || "").toUpperCase();
  if (c === "V04") return "bg-green-100 text-green-800";
  if (c === "V03") return "bg-red-100 text-red-800";
  if (c === "_PI") return "bg-amber-100 text-amber-800";
  if (c === "V10" || c === "V11") return "bg-gray-100 text-gray-600";
  return "bg-blue-100 text-blue-800";
}

// ─── Client normalizer ────────────────────────────────────────────────────────
function normalizeClients(data) {
  let list = [];
  if (Array.isArray(data))                list = data;
  else if (Array.isArray(data?.clients))  list = data.clients;
  else if (Array.isArray(data?.data))     list = data.data;
  return list
    .map(c => ({
      id:   c.id   ?? c.cue_iid   ?? c.clientId   ?? null,
      name: c.name ?? c.cue_cnombre ?? c.clientName ?? "",
    }))
    .filter(c => c.id != null && c.name);
}

// ─── Shared components ────────────────────────────────────────────────────────
function Toast({ toasts }) {
  const styles = {
    s: { border: "border-green-200", icon: <CheckCircle className="w-4 h-4 text-green-600 shrink-0" /> },
    e: { border: "border-red-200",   icon: <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" /> },
    i: { border: "border-blue-200",  icon: <Info className="w-4 h-4 text-blue-600 shrink-0" /> },
  };
  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50 pointer-events-none">
      {toasts.map(t => {
        const s = styles[t.type] || styles.i;
        return (
          <div
            key={t.id}
            className={`flex items-center gap-2 bg-white border ${s.border} rounded-xl shadow-lg px-4 py-2.5 text-sm text-gray-700 pointer-events-auto animate-[slideIn_.2s_ease]`}
          >
            {s.icon}
            {t.msg}
          </div>
        );
      })}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <Loader className="w-7 h-7 text-blue-500 animate-spin" />
    </div>
  );
}

function EmptyState({ icon, title, sub }) {
  return (
    <div className="py-16 text-center">
      <div className="flex justify-center mb-3 text-gray-300">{icon}</div>
      <p className="font-semibold text-gray-400 text-sm">{title}</p>
      {sub && <p className="text-gray-300 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function Badge({ className, children }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}

// ─── Client search dropdown ───────────────────────────────────────────────────
function ClientSearch({ clients, value, onChange, onClear }) {
  const [open, setOpen] = useState(false);
  const [q, setQ]       = useState("");
  const ref              = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = q.trim()
    ? clients.filter(c => c.name.toLowerCase().includes(q.toLowerCase()))
    : clients;

  function pick(c) { onChange(c); setQ(c.name); setOpen(false); }
  function clear() { onClear(); setQ(""); setOpen(false); }

  return (
    <div ref={ref} className="relative flex-1 min-w-56">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Search clients…"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); if (value) onClear(); }}
          onFocus={() => setOpen(true)}
        />
        {q && (
          <button
            onClick={clear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-40 bg-white border border-gray-200 rounded-lg max-h-60 overflow-y-auto shadow-lg">
          {filtered.length === 0
            ? <div className="px-3 py-2 text-sm text-gray-400">No matches</div>
            : filtered.slice(0, 60).map(c => (
              <div
                key={c.id}
                onMouseDown={() => pick(c)}
                className="px-3 py-2 text-sm text-gray-700 cursor-pointer hover:bg-blue-50"
              >
                {c.name}
              </div>
            ))
          }
          {filtered.length > 60 && (
            <div className="px-3 py-1.5 text-xs text-gray-400">
              +{filtered.length - 60} more — keep typing
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Shared UI bits ───────────────────────────────────────────────────────────
function FieldLabel({ children }) {
  return (
    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
      {children}
    </label>
  );
}

const inputClass  = "px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent";
const selectClass = inputClass + " bg-white";

function PrimaryButton({ onClick, children, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function GhostButton({ onClick, children, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 text-sm font-medium transition disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SmallButton({ onClick, children, primary }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
        primary ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-blue-50 text-blue-700 hover:bg-blue-100"
      }`}
    >
      {children}
    </button>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border transition whitespace-nowrap ${
        active
          ? "bg-blue-600 border-blue-600 text-white"
          : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

const th = "px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 bg-gray-50";
const td = "px-6 py-4 text-sm text-gray-700 align-top";

// ─── Tab: Raw Events ──────────────────────────────────────────────────────────
function EventsTab({ clientId, clientName, toast }) {
  const [startDate, setStartDate] = useState("");
  const [endDate,   setEndDate]   = useState("");
  const [alarmCode, setAlarmCode] = useState("");
  const [limit,     setLimit]     = useState("500");
  const [events,    setEvents]    = useState([]);
  const [status,    setStatus]    = useState("idle");
  const [errorMsg,  setErrorMsg]  = useState("");

  async function load() {
    if (!clientId) { toast("Select a client first", "i"); return; }
    setStatus("loading"); setEvents([]);
    try {
      const p = new URLSearchParams({ clientId, limit });
      if (startDate) p.set("startDate", startDate);
      if (endDate)   p.set("endDate",   endDate);
      if (alarmCode) p.set("alarmCode", alarmCode);
      const res  = await fetch(`${API}/events?${p}`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Unknown error");
      setEvents(data.events || []);
      setStatus("done");
    } catch (e) { setErrorMsg(e.message); setStatus("error"); toast(e.message, "e"); }
  }

  async function downloadPdf() {
    if (!clientId || !startDate || !endDate) {
      toast("Select client, start date and end date for PDF", "i"); return;
    }
    toast("Generating PDF…", "i");
    try {
      const p   = new URLSearchParams({ clientId, startDate, endDate });
      const res = await fetch(`${API}/events/pdf?${p}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `events-${clientName}-${startDate}-${endDate}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast("PDF downloaded", "s");
    } catch (e) { toast("PDF failed: " + e.message, "e"); }
  }

  return (
    <div>
      {/* Filters */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 mb-6 flex flex-wrap gap-4 items-end">
        <div>
          <FieldLabel>From</FieldLabel>
          <input type="date" className={inputClass} value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <FieldLabel>To</FieldLabel>
          <input type="date" className={inputClass} value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div>
          <FieldLabel>Alarm Code</FieldLabel>
          <select className={selectClass} value={alarmCode} onChange={e => setAlarmCode(e.target.value)}>
            <option value="">All codes</option>
            <option value="V04">V04 — Patrol Arrival</option>
            <option value="V03">V03 — Incident</option>
            <option value="_PI">_PI — Invalid Position</option>
            <option value="V10">V10 — GPS</option>
            <option value="V11">V11 — Battery</option>
            <option value="V05">V05 — Check-in</option>
          </select>
        </div>
        <div>
          <FieldLabel>Limit</FieldLabel>
          <select className={selectClass} value={limit} onChange={e => setLimit(e.target.value)}>
            {["100","250","500","1000","2000","5000"].map(l => <option key={l} value={l}>{Number(l).toLocaleString()}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <PrimaryButton onClick={load}><Search className="w-4 h-4" /> Load</PrimaryButton>
          <GhostButton onClick={downloadPdf}><Download className="w-4 h-4" /> PDF</GhostButton>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Raw Events</h2>
          <Badge className="bg-blue-100 text-blue-800">
            {status === "done" ? `${events.length.toLocaleString()} events` : "—"}
          </Badge>
        </div>
        {status === "idle"    && <EmptyState icon={<Radio className="w-8 h-8" />} title="Select filters and click Load" sub="All alarm codes, all events — unfiltered" />}
        {status === "loading" && <Spinner />}
        {status === "error"   && <EmptyState icon={<AlertTriangle className="w-8 h-8" />} title="Failed to load" sub={errorMsg} />}
        {status === "done" && events.length === 0 && <EmptyState icon={<Search className="w-8 h-8" />} title="No events found" sub="Try a different date range or alarm code" />}
        {status === "done" && events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["Date & Time", "Alarm", "Zone Code", "Zone Name", "Content", "User"].map(h => (
                    <th key={h} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {events.map((ev, i) => (
                  <tr key={ev._archiveId ?? i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                    <td className={`${td} font-mono text-xs whitespace-nowrap`}>{fmtDateTime(ev.eventDateTime)}</td>
                    <td className={td}><Badge className={alarmBadgeClass(ev.alarmCode)}>{ev.alarmCode}</Badge></td>
                    <td className={`${td} font-mono text-xs`}>{ev.zoneCode || "—"}</td>
                    <td className={td}>{ev.zoneName || "—"}</td>
                    <td className={`${td} text-gray-500 max-w-xs truncate`}>{ev.content || ev.observations || "—"}</td>
                    <td className={`${td} font-mono text-xs`}>{ev.userId || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Incidents ───────────────────────────────────────────────────────────
function IncidentsTab({ clientId, toast }) {
  const [startDate, setStartDate] = useState("");
  const [endDate,   setEndDate]   = useState("");
  const [incidents, setIncidents] = useState([]);
  const [status,    setStatus]    = useState("idle");
  const [errorMsg,  setErrorMsg]  = useState("");

  async function load() {
    if (!clientId) { toast("Select a client first", "i"); return; }
    if (!startDate || !endDate) { toast("Select start and end dates", "i"); return; }
    setStatus("loading"); setIncidents([]);
    try {
      const p   = new URLSearchParams({ clientId, startDate, endDate });
      const res = await fetch(`${API}/incidents?${p}`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Unknown error");
      setIncidents(data.incidents || []);
      setStatus("done");
    } catch (e) { setErrorMsg(e.message); setStatus("error"); toast(e.message, "e"); }
  }

  return (
    <div>
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 mb-6 flex flex-wrap gap-4 items-end">
        <div>
          <FieldLabel>From</FieldLabel>
          <input type="date" className={inputClass} value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <FieldLabel>To</FieldLabel>
          <input type="date" className={inputClass} value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <PrimaryButton onClick={load}><Search className="w-4 h-4" /> Load Incidents</PrimaryButton>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Incidents</h2>
          {status === "done" && (
            <Badge className={incidents.length > 0 ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}>
              {incidents.length} incident{incidents.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        {status === "idle"    && <EmptyState icon={<Shield className="w-8 h-8" />} title="Select a date range and load" sub="Incidents are fetched via the same pipeline as PDF reports" />}
        {status === "loading" && <Spinner />}
        {status === "error"   && <EmptyState icon={<AlertTriangle className="w-8 h-8" />} title="Failed to load" sub={errorMsg} />}
        {status === "done" && incidents.length === 0 && <EmptyState icon={<CheckCircle className="w-8 h-8" />} title="No incidents" sub="No V03 events found for this period" />}
        {status === "done" && incidents.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["#", "Date", "Zone", "Zone Name", "Observations"].map(h => <th key={h} className={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {incidents.map((inc, i) => (
                  <tr key={inc.id ?? i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                    <td className={`${td} text-gray-400 w-10`}>{i + 1}</td>
                    <td className={`${td} font-mono text-xs whitespace-nowrap`}>{fmtDateTime(inc.date)}</td>
                    <td className={`${td} font-mono text-xs`}>{inc.zone || "—"}</td>
                    <td className={td}>{inc.zoneName || "—"}</td>
                    <td className={`${td} text-gray-500`}>{inc.observations || inc.content || "No details"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Generated Reports ───────────────────────────────────────────────────
const RANGE_OPTS = [
  { value: "all",    label: "All"     },
  { value: "month",  label: "Month"   },
  { value: "day",    label: "Day"     },
  { value: "custom", label: "Custom"  },
];

function ReportsTab({ clientId, clientName, toast }) {
  const [range,       setRange]       = useState("all");
  const [month,       setMonth]       = useState("");
  const [day,         setDay]         = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd,   setCustomEnd]   = useState("");
  const [months,      setMonths]      = useState([]);
  const [reports,     setReports]     = useState([]);
  const [status,      setStatus]      = useState("idle");
  const [errorMsg,    setErrorMsg]    = useState("");

  // Load available months when client changes
  useEffect(() => {
    if (!clientId) { setMonths([]); return; }
    (async () => {
      try {
        const res  = await fetch(`${API}/reports/months?clientId=${clientId}`, { headers: authHeaders() });
        const data = await res.json();
        setMonths(data.success ? data.months : []);
      } catch {}
    })();
  }, [clientId]);

  async function load() {
    if (!clientId) { toast("Select a client first", "i"); return; }
    if (range === "month"  && !month)                    { toast("Select a month", "i");                return; }
    if (range === "day"    && !day)                      { toast("Select a day", "i");                  return; }
    if (range === "custom" && (!customStart || !customEnd)) { toast("Select start and end dates", "i"); return; }

    setStatus("loading"); setReports([]);
    try {
      const p = new URLSearchParams({ clientId, range });
      if (range === "month")  p.set("month",     month);
      if (range === "day")    p.set("day",        day);
      if (range === "custom") { p.set("startDate", customStart); p.set("endDate", customEnd); }
      const res  = await fetch(`${API}/reports?${p}`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Unknown error");
      setReports(data.reports || []);
      setStatus("done");
    } catch (e) { setErrorMsg(e.message); setStatus("error"); toast(e.message, "e"); }
  }

  async function viewReport(id) {
    try {
      const res  = await fetch(`${API}/reports/${id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed");
      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json" });
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) { toast("Failed to open: " + e.message, "e"); }
  }

  async function downloadPdf(id, r) {
    toast("Generating PDF…", "i");
    try {
      const res = await fetch(`${API}/reports/${id}/pdf`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `report-${clientName}-${r.StartDate}-${r.EndDate}.pdf`.replace(/[^a-zA-Z0-9\-_.]/g, "");
      a.click();
      URL.revokeObjectURL(url);
      toast("PDF downloaded", "s");
    } catch (e) { toast("PDF failed: " + e.message, "e"); }
  }

  return (
    <div>
      {/* Filters */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 mb-6 flex flex-wrap gap-4 items-end">
        <div>
          <FieldLabel>Range</FieldLabel>
          <div className="flex gap-2">
            {RANGE_OPTS.map(o => (
              <Tab key={o.value} active={range === o.value} onClick={() => setRange(o.value)}>{o.label}</Tab>
            ))}
          </div>
        </div>

        {range === "month" && (
          <div>
            <FieldLabel>Month</FieldLabel>
            <select className={selectClass} value={month} onChange={e => setMonth(e.target.value)}>
              <option value="">Select month</option>
              {months.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}

        {range === "day" && (
          <div>
            <FieldLabel>Day</FieldLabel>
            <input type="date" className={inputClass} value={day} onChange={e => setDay(e.target.value)} />
          </div>
        )}

        {range === "custom" && (
          <>
            <div>
              <FieldLabel>From</FieldLabel>
              <input type="date" className={inputClass} value={customStart} onChange={e => setCustomStart(e.target.value)} />
            </div>
            <div>
              <FieldLabel>To</FieldLabel>
              <input type="date" className={inputClass} value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
            </div>
          </>
        )}

        <PrimaryButton onClick={load}><Search className="w-4 h-4" /> Load Reports</PrimaryButton>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Generated Reports</h2>
          <Badge className="bg-blue-100 text-blue-800">
            {status === "done" ? `${reports.length} report${reports.length !== 1 ? "s" : ""}` : "—"}
          </Badge>
        </div>
        {status === "idle"    && <EmptyState icon={<FileText className="w-8 h-8" />} title="Select a client and load" sub="Browse every patrol report saved to your local archive" />}
        {status === "loading" && <Spinner />}
        {status === "error"   && <EmptyState icon={<AlertTriangle className="w-8 h-8" />} title="Failed to load" sub={errorMsg} />}
        {status === "done" && reports.length === 0 && <EmptyState icon={<Search className="w-8 h-8" />} title="No reports found" sub="No generated reports match this filter" />}
        {status === "done" && reports.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["Period", "Type", "Performance", "Patrols", "Incidents", "Generated", ""].map(h => (
                    <th key={h} className={`${th} ${h === "" ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reports.map((r, i) => (
                  <tr key={r.Id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                    <td className={`${td} font-mono text-xs whitespace-nowrap`}>{r.StartDate} – {r.EndDate}</td>
                    <td className={td}><Badge className="bg-blue-100 text-blue-800">{r.ReportType || "—"}</Badge></td>
                    <td className={td}>
                      <Badge className={perfBadgeClass(r.OverallPerformance)}>
                        {r.OverallPerformance != null ? `${r.OverallPerformance}%` : "—"}
                      </Badge>
                    </td>
                    <td className={`${td} font-mono text-xs`}>{r.TotalCompletedPatrols ?? "—"} / {r.TotalExpectedPatrols ?? "—"}</td>
                    <td className={`${td} font-mono text-xs`}>{r.TotalIncidents ?? "—"}</td>
                    <td className={`${td} text-xs text-gray-500 whitespace-nowrap`}>{fmtDate(r.GeneratedAt)}</td>
                    <td className={`${td} text-right`}>
                      <div className="flex gap-2 justify-end">
                        <SmallButton onClick={() => viewReport(r.Id)}><Eye className="w-3.5 h-3.5" /> View</SmallButton>
                        <SmallButton primary onClick={() => downloadPdf(r.Id, r)}><Download className="w-3.5 h-3.5" /> PDF</SmallButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────
export default function ReportArchive() {
  const [clients,    setClients]    = useState([]);
  const [client,     setClient]     = useState(null);   // { id, name }
  const [activeTab,  setActiveTab]  = useState("events");
  const [toasts,     setToasts]     = useState([]);

  const toast = useCallback((msg, type = "i", ms = 3500) => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), ms);
  }, []);

  // Load clients once
  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(CLIENTS_API, { headers: authHeaders() });
        const data = await res.json();
        setClients(normalizeClients(data));
      } catch (e) { toast("Failed to load clients: " + e.message, "e"); }
    })();
  }, [toast]);

  const tabs = [
    { id: "events",    label: "Raw Events",  icon: <Radio className="w-4 h-4" /> },
    { id: "incidents", label: "Incidents",   icon: <AlertTriangle className="w-4 h-4" /> },
    { id: "reports",   label: "Reports",     icon: <FileText className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <style>{`@keyframes slideIn { from { transform: translateX(12px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>

        {/* Page header */}
        <div className="mb-8 flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-xl">
            <Radio className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Event Archive</h1>
            <p className="text-sm text-gray-500">
              Browse raw patrol events, incidents, and generated reports — independent of BM Security data retention
            </p>
          </div>
        </div>

        {/* Client picker */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 mb-6 flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-56">
            <FieldLabel>Client</FieldLabel>
            <ClientSearch
              clients={clients}
              value={client}
              onChange={c => setClient(c)}
              onClear={() => setClient(null)}
            />
          </div>
          {client && (
            <div className="text-sm text-gray-500 pb-2.5">
              ID: <span className="font-mono text-blue-600">{client.id}</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {tabs.map(t => (
            <Tab key={t.id} active={activeTab === t.id} onClick={() => setActiveTab(t.id)}>
              {t.icon} {t.label}
            </Tab>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "events" && (
          <EventsTab clientId={client?.id} clientName={client?.name || ""} toast={toast} />
        )}
        {activeTab === "incidents" && (
          <IncidentsTab clientId={client?.id} toast={toast} />
        )}
        {activeTab === "reports" && (
          <ReportsTab clientId={client?.id} clientName={client?.name || ""} toast={toast} />
        )}

        <Toast toasts={toasts} />
      </div>
    </div>
  );
}