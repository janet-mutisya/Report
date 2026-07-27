// Dashboard.jsx — Blue & white theme (zone pie → horizontal bar chart)
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Shield, Calendar, Activity, CheckCircle, Clock, MapPin,
  FileText, Download, Loader, AlertCircle, TrendingUp, Eye,
  CheckSquare, BarChart3, ChevronLeft, ChevronRight, RefreshCw,
  XCircle, AlertTriangle, Target,
} from 'lucide-react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line,
} from 'recharts';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const COLORS = ['#1d4ed8','#3b82f6','#60a5fa','#93c5fd','#1e40af','#2563eb','#0ea5e9','#0284c7'];

function authHeaders() { return { Authorization: `Bearer ${localStorage.getItem('token')}` }; }
function getStoredUser() { try { return JSON.parse(localStorage.getItem('user')||'null'); } catch { return null; } }
function defaultDates() {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now()-7*24*60*60*1000).toISOString().split('T')[0];
  return { startDate: weekAgo, endDate: today };
}
function normaliseEvent(e) {
  return {
    date: e.Date||e.date||e.fecha||'-',
    time: e.Time||e.time||e.hora||'-',
    event: e.Event||e.event||e.evento||'VigiControl Arrival',
    zone: e.Zone||e.zone||e.zona||'Unknown Zone',
  };
}
function extractSummaryRows(payload) {
  return Array.isArray(payload.summary) ? payload.summary
    : Array.isArray(payload.posts) ? payload.posts
    : Array.isArray(payload.zones) ? payload.zones
    : Array.isArray(payload.performance) ? payload.performance : [];
}
function normaliseSummaryRow(row) {
  const siteName = row.SecurityPost||row.SitePosts||row.zoneName||row.name||'Unknown Post';
  const completed = parseInt(row.ChecksCompleted??row.Completed??row.completed??0)||0;
  const expected  = parseInt(row.ExpectedChecks??row.Expected??row.expected??0)||0;
  let rate = 0;
  const raw = row.PerformanceRate??row.Performance??row.rate;
  if (raw != null) rate = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
  if (isNaN(rate) && expected > 0) rate = (completed / expected) * 100;
  return {
    SitePosts: String(siteName).trim(),
    ChecksCompleted: completed,
    ExpectedChecks: expected,
    PerformanceRate: `${Math.round(isNaN(rate) ? 0 : rate)}%`,
    actualPerformance: isNaN(rate) ? 0 : rate,
    exceeded: completed > expected,
  };
}
function perfLabel(r) { if(r>=90)return'Excellent'; if(r>=80)return'Good'; if(r>=70)return'Fair'; return'Poor'; }
function perfBadgeClass(r, exceeded) {
  if (exceeded)  return 'bg-blue-100 text-blue-700 border border-blue-200';
  if (r >= 90)   return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
  if (r >= 70)   return 'bg-amber-100 text-amber-700 border border-amber-200';
  return 'bg-red-100 text-red-700 border border-red-200';
}

function ErrorAlert({ message, onRetry }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-6 shadow-sm">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-red-700 text-sm">Something went wrong</p>
          <p className="text-red-600 text-sm mt-1">{message}</p>
          {onRetry && (
            <button onClick={onRetry}
              className="mt-3 px-4 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition font-medium">
              Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Zone bar chart tooltip ──────────────────────────────────────────── */
function ZoneTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 14px', boxShadow:'0 4px 12px rgba(0,0,0,.08)' }}>
      <p style={{ color:'#1e293b', fontWeight:600, fontSize:12, marginBottom:2 }}>{d.fullName}</p>
      <p style={{ color:'#3b82f6', fontSize:13, fontWeight:700 }}>{d.value} arrivals</p>
    </div>
  );
}

export default function Dashboard() {
  const user       = getStoredUser();
  const clientId   = user?.clientId ?? null;
  const clientName = user?.companyName||user?.clientName||user?.name||'';
  const defs       = defaultDates();

  const [startDate, setStartDate] = useState(defs.startDate);
  const [endDate,   setEndDate]   = useState(defs.endDate);
  const [startTime, setStartTime] = useState('');
  const [endTime,   setEndTime]   = useState('');
  const [shiftType, setShiftType] = useState('Day/Night');
  const [report,    setReport]    = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [exportingPDF, setExportingPDF] = useState(false);
  const [currentPage,  setCurrentPage]  = useState(1);
  const rowsPerPage = 50;

  const fetchReport = useCallback(async (sd, ed, st, et, shift) => {
    if (!sd || !ed || (!clientId && !clientName)) { setError('Missing required parameters.'); return; }
    setLoading(true); setError(''); setReport(null); setCurrentPage(1);
    try {
      const params = new URLSearchParams({ startDate:sd, endDate:ed, shiftType:shift||'Day/Night', client:clientName||String(clientId) });
      if (clientId != null) params.set('clientId', String(clientId));
      if (st) params.set('startTime', st);
      if (et) params.set('endTime', et);
      const res  = await fetch(`${API}/reports/patrol?${params}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok)        throw new Error(data.message || `HTTP ${res.status}`);
      if (!data.success)  throw new Error(data.message || 'No data returned');

      const payload = data.data ?? data;
      const calc    = payload.calculations || {};
      const summary = extractSummaryRows(payload).map(normaliseSummaryRow)
        .filter(r => { const n = r.SitePosts.toLowerCase(); return n.length > 1 && !['unknown','n/a','none','undefined','null'].includes(n); })
        .sort((a, b) => b.ChecksCompleted - a.ChecksCompleted);

      const totalCompleted = Number(calc.totalCompletedPatrols??calc.totalCompleted??summary.reduce((s,r)=>s+r.ChecksCompleted,0)) || 0;
      const totalExpected  = Number(calc.totalExpectedPatrols??calc.totalExpected??summary.reduce((s,r)=>s+r.ExpectedChecks,0)) || 0;
      let rate = 0;
      if (calc.completionRateNumeric != null)     rate = Number(calc.completionRateNumeric);
      else if (calc.completionRate != null)        rate = parseFloat(String(calc.completionRate));
      else if (totalExpected > 0)                  rate = (totalCompleted / totalExpected) * 100;
      if (isNaN(rate)) rate = 0;

      setReport({
        summary,
        resolvedClientName: payload.metadata?.clientName||payload.clientName||clientName||'',
        events:       (Array.isArray(payload.events) ? payload.events : []).map(normaliseEvent),
        guardReports: Array.isArray(payload.guardReports) ? payload.guardReports : [],
        calculations: {
          totalCompleted, totalExpected,
          completionRate: Math.round(rate),
          shiftDays: Number(payload.period?.shiftDays??calc.shiftDays??7) || 7,
        },
      });
    } catch (err) { setError(err.message || 'Failed to load patrol data.'); }
    finally { setLoading(false); }
  }, [clientId, clientName]);

  useEffect(() => { fetchReport(startDate, endDate, startTime, endTime, shiftType); }, []); // eslint-disable-line

  /* ─── derived chart data ──────────────────────────────────────────── */
  const { dailyData, zoneData } = useMemo(() => {
    if (!report) return { dailyData: [], zoneData: [] };
    const dm = {}, zm = {};
    report.events.forEach(({ date, zone }) => {
      if (date !== '-') dm[date] = (dm[date] || 0) + 1;
      if (zone && zone !== '-' && zone !== 'Unknown Zone') zm[zone] = (zm[zone] || 0) + 1;
    });
    return {
      dailyData: Object.entries(dm)
        .sort(([a],[b]) => new Date(a) - new Date(b))
        .map(([date, arrivals]) => ({ date, arrivals })),
      // sorted descending, top 20 to keep readable
      zoneData: Object.entries(zm)
        .sort(([,a],[,b]) => b - a)
        .slice(0, 20)
        .map(([zone, value]) => ({
          name: zone.length > 22 ? zone.slice(0, 20) + '…' : zone,
          fullName: zone,
          value,
        })),
    };
  }, [report]);

  const weeklyTrend = useMemo(() => {
    if (!report) return [];
    const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], buckets = {};
    report.events.forEach(({ date }) => {
      if (date === '-') return;
      const p = String(date).split('/');
      const d = p.length === 3
        ? new Date(`${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`)
        : new Date(date);
      if (!isNaN(d)) { const l = DAY[d.getDay()]; buckets[l] = (buckets[l] || 0) + 1; }
    });
    const { totalExpected, shiftDays } = report.calculations;
    const epd = shiftDays > 0 ? totalExpected / shiftDays : 0;
    return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => ({
      day,
      performance: epd > 0 ? Math.min(150, Math.round(((buckets[day]||0) / epd) * 100)) : 0,
      target: 90,
    }));
  }, [report]);

  const allEvents  = report?.events || [];
  const totalPages = Math.ceil(allEvents.length / rowsPerPage);
  const pageEvents = allEvents.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  useEffect(() => setCurrentPage(1), [report]);

  const timeOptions = useMemo(() => {
    const o = [];
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 30)
      o.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    return o;
  }, []);

  const calc   = report?.calculations;
  const hasData = !!(report && (report.summary?.length || report.events?.length));
  const handleApply = () => fetchReport(startDate, endDate, startTime, endTime, shiftType);

  const exportCSV = () => {
    if (!report?.summary?.length) return;
    const rows = [['Security Post','Completed','Expected','Performance'],
      ...report.summary.map(r => [r.SitePosts, r.ChecksCompleted, r.ExpectedChecks, r.PerformanceRate])];
    const csv  = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const link = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: `patrol-${startDate}-to-${endDate}.csv`,
    });
    document.body.appendChild(link); link.click(); link.remove();
  };

  const exportPDF = async () => {
    if (exportingPDF) return;
    const resolvedName = report?.resolvedClientName || clientName || '';
    if (!resolvedName) { setError('Cannot export PDF: company name not available.'); return; }
    setExportingPDF(true);
    try {
      const params = new URLSearchParams({ startDate, endDate, shiftType, client: resolvedName, clientName: resolvedName });
      if (clientId != null) params.set('clientId', String(clientId));
      const res = await fetch(`${API}/reports/dashboard-pdf?${params}`, { headers: authHeaders() });
      if (!res.ok) {
        let msg = `PDF generation failed (HTTP ${res.status})`;
        try { const b = await res.json(); if (b.message) msg = b.message; } catch(_) {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const link = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `patrol-${startDate}-to-${endDate}.pdf`,
      });
      document.body.appendChild(link); link.click(); link.remove();
    } catch (err) { setError('PDF export failed: ' + err.message); }
    finally { setExportingPDF(false); }
  };

  if (!clientId && !clientName) {
    return (
      <div className="min-h-screen bg-blue-50 flex items-center justify-center">
        <div className="bg-white border border-blue-100 rounded-2xl p-10 text-center max-w-md shadow-lg">
          <AlertCircle className="w-12 h-12 text-blue-400 mx-auto mb-4"/>
          <h2 className="text-blue-900 font-bold text-xl mb-2">Session Error</h2>
          <p className="text-blue-400 text-sm">Your session is missing account information. Please log out and sign in again.</p>
        </div>
      </div>
    );
  }

  const kpis = calc ? [
    { label:'Patrols Completed', value:calc.totalCompleted,   sub:`of ${calc.totalExpected} expected`,           icon:<CheckSquare className="w-5 h-5"/>, bg:'bg-blue-600' },
    { label:'Performance Rate',  value:`${calc.completionRate}%`, sub:perfLabel(calc.completionRate),            icon:<TrendingUp className="w-5 h-5"/>,  bg:'bg-blue-700' },
    { label:'Security Posts',    value:report.summary.length, sub:'active zones',                                icon:<MapPin className="w-5 h-5"/>,      bg:'bg-blue-800' },
    { label:'Missed Patrols',    value:Math.max(0,calc.totalExpected-calc.totalCompleted), sub:`over ${calc.shiftDays} days`, icon:<XCircle className="w-5 h-5"/>,     bg:'bg-blue-500' },
  ] : [];

  const ttStyle = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, boxShadow:'0 4px 12px rgba(0,0,0,.06)' };
  const ttLbl   = { color:'#1e293b', fontWeight:600 };

  /* dynamic height for zone bar chart so bars don't squash */
  const zoneChartH = Math.max(260, zoneData.length * 28);

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ── */}
      <div className="bg-blue-700">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center">
              <Shield className="w-6 h-6 text-white"/>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Patrol Dashboard</h1>
              <p className="text-blue-200 text-xs">VigiControl Security Monitoring</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {clientName && (
              <div className="text-right">
                <p className="text-white font-semibold">{clientName}</p>
                <p className="text-blue-200 text-xs">Signed in as <span className="font-medium text-white">{user?.email||user?.username}</span></p>
              </div>
            )}
            {calc && (
              <div className="bg-white/15 border border-white/25 rounded-xl px-4 py-2 text-center min-w-[86px]">
                <p className="text-white font-bold text-lg leading-none">{calc.completionRate}%</p>
                <p className="text-blue-200 text-xs mt-0.5">{perfLabel(calc.completionRate)}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Start</label>
              <div className="flex gap-2">
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className="flex-1 bg-white border border-slate-300 text-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"/>
                <select value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="w-24 bg-white border border-slate-300 text-slate-700 rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="">Time</option>
                  {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">End</label>
              <div className="flex gap-2">
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className="flex-1 bg-white border border-slate-300 text-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"/>
                <select value={endTime} onChange={e => setEndTime(e.target.value)}
                  className="w-24 bg-white border border-slate-300 text-slate-700 rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="">Time</option>
                  {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="min-w-[150px]">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Shift</label>
              <select value={shiftType} onChange={e => setShiftType(e.target.value)}
                className="w-full bg-white border border-slate-300 text-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="Day/Night">Day &amp; Night</option>
                <option value="Day">Day Only</option>
                <option value="Night">Night Only</option>
              </select>
            </div>
            <button onClick={handleApply} disabled={loading}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold px-6 py-2 rounded-lg transition text-sm shadow-sm disabled:cursor-not-allowed">
              {loading
                ? <><RefreshCw className="w-4 h-4 animate-spin"/>Loading…</>
                : <><RefreshCw className="w-4 h-4"/>Refresh</>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Main ── */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {error && <ErrorAlert message={error} onRetry={handleApply}/>}

        {loading && (
          <div className="flex flex-col items-center justify-center py-28">
            <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg mb-5">
              <Loader className="w-8 h-8 animate-spin text-white"/>
            </div>
            <p className="text-slate-600 font-medium">Loading patrols for {clientName||`client #${clientId}`}…</p>
          </div>
        )}

        {!loading && hasData && (<>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {kpis.map(({ label, value, sub, icon, bg }) => (
              <div key={label} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center text-white mb-4 shadow-sm`}>{icon}</div>
                <p className="text-2xl font-bold text-slate-900 mb-1">{value}</p>
                <p className="text-sm font-semibold text-slate-700">{label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>

          {/* Export */}
          <div className="flex gap-3 mb-8 justify-end">
            <button onClick={exportCSV} disabled={!report?.summary?.length}
              className="flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-xl transition disabled:opacity-40 border border-slate-300 shadow-sm">
              <Download className="w-4 h-4 text-slate-500"/>CSV
            </button>
            <button onClick={exportPDF} disabled={exportingPDF}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition disabled:opacity-40 shadow-sm">
              {exportingPDF
                ? <><Loader className="w-4 h-4 animate-spin"/>Generating…</>
                : <><FileText className="w-4 h-4"/>PDF Report</>}
            </button>
          </div>

          {/* Charts row 1 — Daily Arrivals + Weekly Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Daily Arrivals */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-5 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-500"/>Daily Arrivals
              </h3>
              {dailyData.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                    <XAxis dataKey="date" fontSize={10} angle={-35} textAnchor="end" height={55} tick={{ fill:'#94a3b8' }}/>
                    <YAxis fontSize={10} tick={{ fill:'#94a3b8' }}/>
                    <Tooltip contentStyle={ttStyle} labelStyle={ttLbl} itemStyle={{ color:'#1d4ed8' }}/>
                    <Bar dataKey="arrivals" fill="#3b82f6" radius={[5,5,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-60 flex items-center justify-center text-slate-400">
                  <div className="text-center"><BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-30"/><p className="text-sm">No event data</p></div>
                </div>
              )}
            </div>

            {/* Weekly Performance */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-5 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-500"/>Weekly Performance
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={weeklyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                  <XAxis dataKey="day" fontSize={11} tick={{ fill:'#94a3b8' }}/>
                  <YAxis domain={[0,110]} fontSize={11} tick={{ fill:'#94a3b8' }}/>
                  <Tooltip contentStyle={ttStyle} labelStyle={ttLbl}/>
                  <Line type="monotone" dataKey="performance" stroke="#2563eb" strokeWidth={2.5}
                    dot={{ fill:'#2563eb', r:3, strokeWidth:0 }} name="Performance %"/>
                  <Line type="monotone" dataKey="target" stroke="#93c5fd" strokeWidth={2}
                    strokeDasharray="6 4" dot={false} name="Target"/>
                  <Legend wrapperStyle={{ color:'#64748b', fontSize:12 }}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Charts row 2 — Zone Distribution (horizontal bar) + Post Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

            {/* ── Zone Distribution — horizontal bar chart ── */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-500"/>Zone Distribution
              </h3>
              <p className="text-[11px] text-slate-400 mb-4">
                {zoneData.length > 0 ? `Top ${zoneData.length} zones by arrivals` : ''}
              </p>

              {zoneData.length ? (
                <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
                  <ResponsiveContainer width="100%" height={zoneChartH}>
                    <BarChart
                      data={zoneData}
                      layout="vertical"
                      margin={{ top: 0, right: 48, bottom: 0, left: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false}/>
                      <XAxis type="number" fontSize={10} tick={{ fill:'#94a3b8' }} allowDecimals={false}/>
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={130}
                        fontSize={11}
                        tick={{ fill:'#475569' }}
                        tickLine={false}
                      />
                      <Tooltip content={<ZoneTooltip/>}/>
                      <Bar dataKey="value" name="Arrivals" radius={[0, 5, 5, 0]} minPointSize={4}>
                        {zoneData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]}/>
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-slate-400">
                  <div className="text-center">
                    <Eye className="w-10 h-10 mx-auto mb-2 opacity-30"/>
                    <p className="text-sm">No zone data</p>
                  </div>
                </div>
              )}
            </div>

            {/* Post Performance table */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-5 flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-500"/>Post Performance
              </h3>
              {report.summary.length ? (
                <div className="overflow-y-auto max-h-[320px] rounded-xl border border-slate-100">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-blue-600">
                      <tr>
                        {['Post','Done','Exp','Rate'].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.summary.map((row, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                          <td className="px-3 py-2.5 text-slate-800 font-medium truncate max-w-[120px]" title={row.SitePosts}>{row.SitePosts}</td>
                          <td className="px-3 py-2.5 text-slate-700">{row.ChecksCompleted}</td>
                          <td className="px-3 py-2.5 text-slate-500">{row.ExpectedChecks}</td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${perfBadgeClass(row.actualPerformance, row.exceeded)}`}>
                              {row.PerformanceRate}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-slate-400">
                  <p className="text-sm">No zone breakdown available</p>
                </div>
              )}
            </div>
          </div>

          {/* Security Incidents */}
          {report.guardReports.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6 shadow-sm">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500"/>Security Incidents ({report.guardReports.length})
              </h3>
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-red-50 border-b border-red-100">
                      {['#','Date','Zone','Details'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-red-600 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.guardReports.map((inc, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                        <td className="px-4 py-3 text-slate-400 text-xs">{i+1}</td>
                        <td className="px-4 py-3 text-slate-600">{inc.date||'-'}</td>
                        <td className="px-4 py-3 text-slate-600">{inc.zone||'-'}</td>
                        <td className="px-4 py-3 text-slate-800">{inc.details||inc.report||'-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Arrivals table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-blue-600 px-6 py-4">
              <h3 className="font-bold text-white flex items-center gap-2 text-sm">
                <CheckSquare className="w-4 h-4"/>VigiControl Arrivals
              </h3>
              <p className="text-blue-200 text-xs mt-0.5">
                {startDate}{startTime ? ` ${startTime}` : ''} → {endDate}{endTime ? ` ${endTime}` : ''} · {allEvents.length} records
              </p>
            </div>

            {allEvents.length ? (<>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['Date','Time','Event','Zone'].map(h => (
                        <th key={h} className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pageEvents.map((ev, i) => (
                      <tr key={i} className={`transition-colors ${i%2===0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/50 hover:bg-blue-50/40'}`}>
                        <td className="px-5 py-3 text-slate-700 whitespace-nowrap">
                          <div className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-blue-300"/>{ev.date}</div>
                        </td>
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                          <div className="flex items-center gap-2"><Clock className="w-3.5 h-3.5 text-blue-300"/>{ev.time}</div>
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full border border-blue-100">
                            <CheckCircle className="w-3 h-3"/>{ev.event}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-700">
                          <div className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-blue-400"/>{ev.zone}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="border-t border-slate-200 px-5 py-4 flex items-center justify-between bg-slate-50">
                  <p className="text-xs text-slate-400">
                    {(currentPage-1)*rowsPerPage+1}–{Math.min(currentPage*rowsPerPage, allEvents.length)} of {allEvents.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage === 1}
                      className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-600 hover:bg-blue-50 disabled:opacity-40 transition font-medium">
                      <ChevronLeft className="w-3.5 h-3.5"/>Prev
                    </button>
                    <span className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold">{currentPage}/{totalPages}</span>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage === totalPages}
                      className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-600 hover:bg-blue-50 disabled:opacity-40 transition font-medium">
                      Next<ChevronRight className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                </div>
              )}
            </>) : (
              <div className="p-16 text-center">
                <Eye className="w-12 h-12 text-blue-200 mx-auto mb-3"/>
                <p className="text-slate-500 font-medium">No arrivals found for this period</p>
                <p className="text-slate-400 text-sm mt-1">Try adjusting the date range above</p>
              </div>
            )}
          </div>

        </>)}

        {!loading && !hasData && !error && (
          <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-blue-300"/>
            </div>
            <p className="text-slate-700 font-semibold text-lg">No patrol data found</p>
            <p className="text-slate-400 text-sm mt-2">Adjust the date range and click Refresh</p>
          </div>
        )}
      </div>
    </div>
  );
}