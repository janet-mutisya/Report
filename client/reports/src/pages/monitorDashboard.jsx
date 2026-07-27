// monitorDashboard.jsx
// Fully synced with dashboardRoutes.js — field names, response shapes, and
// shift-window metadata all match the backend exactly.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, AlertTriangle, CheckCircle, Clock, Users, MapPin,
  Activity, RefreshCw, Bell,
  UserCheck, Target,
  Send, PhoneCall, Navigation, FileText, Power,
  Check, X, AlertCircle, Info, Award, BarChart3, AlertOctagon,
} from 'lucide-react';

// ── API plumbing ──────────────────────────────────────────────────────────────

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function authHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json',
  };
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, { ...options, headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  primary:      '#0F2557',
  primaryMid:   '#1E3A8A',
  primaryLight: '#DBEAFE',
  primaryBg:    '#EFF6FF',
  success:      '#059669',
  successBg:    '#D1FAE5',
  successText:  '#065F46',
  warning:      '#D97706',
  warningBg:    '#FEF3C7',
  warningText:  '#92400E',
  danger:       '#DC2626',
  dangerBg:     '#FEE2E2',
  dangerText:   '#991B1B',
  info:         '#3B82F6',
  neutral:      '#6B7280',
  border:       '#E2E8F0',
  text:         '#0F172A',
  textMuted:    '#64748B',
  surface:      '#FFFFFF',
  bg:           '#F1F5F9',
};

// ── Sub-components ────────────────────────────────────────────────────────────

const BADGE_CONFIG = {
  completed:  { bg: C.successBg, text: C.successText, Icon: CheckCircle },
  'on-time':  { bg: C.successBg, text: C.successText, Icon: CheckCircle },
  missed:     { bg: C.dangerBg,  text: C.dangerText,  Icon: X            },
  late:       { bg: C.warningBg, text: C.warningText, Icon: AlertCircle  },
  active:     { bg: C.dangerBg,  text: C.dangerText,  Icon: AlertTriangle },
  resolved:   { bg: C.successBg, text: C.successText, Icon: CheckCircle },
  pending:    { bg: C.warningBg, text: C.warningText, Icon: Clock        },
  normal:     { bg: C.primaryLight, text: C.primaryMid, Icon: CheckCircle },
  alert:      { bg: C.dangerBg,  text: C.dangerText,  Icon: AlertOctagon },
  warning:    { bg: C.warningBg, text: C.warningText, Icon: AlertTriangle },
  critical:   { bg: C.dangerBg,  text: C.dangerText,  Icon: AlertOctagon },
  info:       { bg: C.primaryLight, text: C.primaryMid, Icon: Info       },
};

function Badge({ status, children }) {
  const cfg = BADGE_CONFIG[status?.toLowerCase()] ?? BADGE_CONFIG.normal;
  const { Icon } = cfg;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20,
      fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.3px',
      background: cfg.bg, color: cfg.text,
    }}>
      <Icon size={11} />
      {children ?? status}
    </span>
  );
}

function KpiCard({ title, value, Icon, color, sub }) {
  return (
    <div style={{
      background: C.surface, borderRadius: 14, padding: '18px 20px',
      border: `1px solid ${C.border}`,
      boxShadow: '0 1px 4px rgba(15,37,87,.06)',
      transition: 'transform .15s, box-shadow .15s',
      cursor: 'default',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(15,37,87,.12)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(15,37,87,.06)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: C.textMuted }}>{title}</span>
        {Icon && <Icon size={18} color={color} strokeWidth={2} />}
      </div>
      <div style={{ fontSize: '2.1rem', fontWeight: 800, color, lineHeight: 1, marginBottom: 6 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '0.68rem', color: C.textMuted }}>{sub}</div>}
    </div>
  );
}

function SectionCard({ title, TitleIcon, iconColor, badge, action, children, maxH }) {
  return (
    <div style={{
      background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`,
      boxShadow: '0 1px 4px rgba(15,37,87,.05)', overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 18px', background: '#F8FAFF',
        borderBottom: `2px solid ${C.primaryMid}`,
      }}>
        <h3 style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.6px', color: C.primaryMid, margin: 0,
        }}>
          {TitleIcon && <TitleIcon size={16} color={iconColor ?? C.primaryMid} />}
          {title}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {badge}
          {action}
        </div>
      </div>
      <div style={{ padding: '16px 18px', overflowY: 'auto', maxHeight: maxH ?? 'none', flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

function ProgressRow({ label, completed, total, pct, color }) {
  const barColor = pct >= 80 ? C.success : pct >= 50 ? C.warning : C.danger;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: C.text }}>{label}</span>
        <span style={{ fontSize: '0.72rem', color: C.textMuted }}>{completed ?? 0}/{total ?? 0}</span>
      </div>
      <div style={{ background: C.border, borderRadius: 8, height: 7, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 8,
          width: `${Math.min(100, pct ?? 0)}%`,
          background: color ?? barColor,
          transition: 'width .4s ease',
        }} />
      </div>
      <div style={{ textAlign: 'right', fontSize: '0.65rem', color: C.textMuted, marginTop: 3 }}>{pct ?? 0}%</div>
    </div>
  );
}

// Event feed item — matches backend events shape:
//   { id, time, alarmCode, type, text, description, site, zone, eventType, message }
function EventItem({ event }) {
  const status = event.type === 'incident' ? 'alert'
               : event.type === 'check-in' ? 'normal'
               : 'info';
  const t = new Date(event.time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 0', borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: C.textMuted, minWidth: 48, paddingTop: 2 }}>{t}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.82rem', color: C.text, fontWeight: 500 }}>
          {event.text || event.description || event.message || event.eventType || event.alarmCode}
        </div>
        <div style={{ fontSize: '0.68rem', color: C.textMuted, marginTop: 2 }}>
          {[event.site, event.zone].filter(Boolean).join(' · ')}
        </div>
      </div>
      <Badge status={status} />
    </div>
  );
}

// Missed patrol row — matches /missed-patrols shape:
//   { id, site, zone, guard, scheduled, status, acknowledged }
function MissedRow({ patrol, onAcknowledge }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
      padding: '10px 0', borderBottom: `1px solid ${C.border}`, fontSize: '0.78rem',
    }}>
      <span style={{ flex: '1 1 110px', fontWeight: 600, color: C.text }}>{patrol.site}</span>
      <span style={{ flex: '0 1 90px', color: C.textMuted }}>{patrol.zone}</span>
      <span style={{ flex: '0 1 110px', color: C.textMuted }}>{patrol.guard || 'Unassigned'}</span>
      <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: C.textMuted }}>{patrol.scheduled}</span>
      <Badge status={patrol.status === 'missed' ? 'missed' : 'late'} />
      {patrol.acknowledged
        ? <Badge status="resolved">Acknowledged</Badge>
        : (
          <button onClick={() => onAcknowledge(patrol.id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 6, fontSize: '0.68rem', fontWeight: 600,
            background: C.primaryBg, border: `1px solid ${C.primaryLight}`,
            color: C.primaryMid, cursor: 'pointer',
          }}>
            <Check size={12} /> Ack
          </button>
        )
      }
    </div>
  );
}

// Incident row — matches /active-incidents shape:
//   { id, time, site, zone, type, description, status }
function IncidentRow({ incident, onClose }) {
  const t = new Date(incident.time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
      padding: '10px 0', borderBottom: `1px solid ${C.border}`, fontSize: '0.78rem',
    }}>
      <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: C.textMuted, minWidth: 48 }}>{t}</span>
      <span style={{ flex: '1 1 100px', fontWeight: 600, color: C.text }}>{incident.site}</span>
      {incident.zone && <span style={{ flex: '0 1 80px', color: C.textMuted, fontSize: '0.7rem' }}>{incident.zone}</span>}
      <span style={{ flex: '1 1 120px', color: C.textMuted }}>{incident.type}</span>
      <Badge status={incident.status === 'active' ? 'active' : 'pending'} />
      {incident.status === 'active' && (
        <button onClick={() => onClose(incident)} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 6, fontSize: '0.68rem', fontWeight: 600,
          background: C.dangerBg, border: `1px solid ${C.dangerBg}`,
          color: C.dangerText, cursor: 'pointer',
        }}>
          <X size={11} /> Close
        </button>
      )}
    </div>
  );
}

// Alert item — matches /alerts shape:
//   { id, time, message, severity, site, code }
function AlertItem({ alert }) {
  const color = alert.severity === 'critical' ? C.danger
              : alert.severity === 'warning'  ? C.warning
              : C.info;
  const IconMap = { critical: AlertOctagon, warning: AlertTriangle, info: Info };
  const Icon = IconMap[alert.severity] ?? Info;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px', marginBottom: 8, borderRadius: 8,
      background: alert.severity === 'critical' ? '#FFF1F1' : alert.severity === 'warning' ? '#FFFBEB' : C.primaryBg,
      borderLeft: `3px solid ${color}`,
    }}>
      <Icon size={15} color={color} style={{ marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.8rem', color: C.text, fontWeight: 500 }}>{alert.message}</div>
        {alert.site && <div style={{ fontSize: '0.68rem', color: C.textMuted, marginTop: 2 }}>{alert.site}</div>}
      </div>
      {alert.time && (
        <span style={{ fontSize: '0.65rem', color: C.textMuted, whiteSpace: 'nowrap' }}>
          {new Date(alert.time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}

// Guard performance row — matches /guard-performance shape:
//   { id, name, patrols, score }
function GuardRow({ rank, guard }) {
  const scoreColor = guard.score >= 80 ? C.success : guard.score >= 60 ? C.warning : C.danger;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 0', borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ width: 22, fontSize: '0.72rem', fontWeight: 700, color: C.textMuted, textAlign: 'center' }}>
        {rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank}
      </span>
      <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600, color: C.text }}>{guard.name}</span>
      <span style={{ fontSize: '0.7rem', color: C.textMuted, minWidth: 52 }}>{guard.patrols} patrols</span>
      <div style={{ width: 90, background: C.border, borderRadius: 4, height: 6, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 4, width: `${Math.min(100, guard.score)}%`, background: scoreColor, transition: 'width .4s' }} />
      </div>
      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: scoreColor, minWidth: 38, textAlign: 'right' }}>{guard.score}%</span>
    </div>
  );
}

function Toast({ toasts }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: '11px 18px', borderRadius: 10,
          background: t.type === 'error' ? C.danger : C.success,
          color: '#fff', fontSize: '0.8rem', fontWeight: 600,
          boxShadow: '0 4px 14px rgba(0,0,0,.18)',
          animation: 'slideIn .25s ease',
        }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function MonitorDashboard() {
  const navigate = useNavigate();

  const [data, setData] = useState({
    stats:       null,   // /stats → { stats: { activeGuards, openIncidents, completedPatrols, missedPatrols, latePatrols, sitesMonitored, totalPatrols, shiftWindow } }
    events:      [],     // /events → { events: [...] }
    attendance:  null,   // /attendance → { attendance: { onDuty, offDuty, onLeave, absent, total, shiftWindow } }
    missed:      [],     // /missed-patrols → { missed: [...] }
    progress:    [],     // /patrol-progress → { sites: [...] }
    incidents:   [],     // /active-incidents → { incidents: [...] }
    alerts:      [],     // /alerts → { alerts: [...] }
    performance: [],     // /guard-performance → { guards: [...] }
  });

  const [loading, setLoading]         = useState(true);
  const [toasts, setToasts]           = useState([]);
  const [clock, setClock]             = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [shiftWindow, setShiftWindow] = useState(null); // from stats.shiftWindow
  const isFetching = useRef(false);

  // ── Toast helper ─────────────────────────────────────────────────────────
  const toast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  // ── Fetch all dashboard endpoints in parallel ─────────────────────────────
  // Each endpoint is fetched independently — a single failure won't
  // block the rest, matching the backend's per-route error isolation.
  const fetchAll = useCallback(async () => {
    if (isFetching.current) return;
    isFetching.current = true;
    setLoading(true);
    try {
      const [statsR, eventsR, attendanceR, missedR, progressR, incidentsR, alertsR, perfR] =
        await Promise.allSettled([
          apiFetch('/dashboard/stats'),
          apiFetch('/dashboard/events'),
          apiFetch('/dashboard/attendance'),
          apiFetch('/dashboard/missed-patrols'),
          apiFetch('/dashboard/patrol-progress'),
          apiFetch('/dashboard/active-incidents'),
          apiFetch('/dashboard/alerts'),
          apiFetch('/dashboard/guard-performance'),
        ]);

      // Extract only the nested payload key that each endpoint returns
      const statsData      = statsR.status      === 'fulfilled' ? statsR.value.stats            : null;
      const eventsData     = eventsR.status     === 'fulfilled' ? (eventsR.value.events    ?? []) : [];
      const attendanceData = attendanceR.status === 'fulfilled' ? attendanceR.value.attendance   : null;
      const missedData     = missedR.status     === 'fulfilled' ? (missedR.value.missed     ?? []) : [];
      const progressData   = progressR.status   === 'fulfilled' ? (progressR.value.sites    ?? []) : [];
      const incidentsData  = incidentsR.status  === 'fulfilled' ? (incidentsR.value.incidents ?? []) : [];
      const alertsData     = alertsR.status     === 'fulfilled' ? (alertsR.value.alerts     ?? []) : [];
      // Backend returns guards[], not a performance[] array
      const perfData       = perfR.status       === 'fulfilled' ? (perfR.value.guards       ?? []) : [];

      setData({ stats: statsData, events: eventsData, attendance: attendanceData,
                missed: missedData, progress: progressData, incidents: incidentsData,
                alerts: alertsData, performance: perfData });

      // Expose the shift window from stats for display in the header
      if (statsData?.shiftWindow) setShiftWindow(statsData.shiftWindow);

      setLastRefresh(new Date());
    } catch (err) {
      console.error('[dashboard] fetchAll:', err);
      toast('Failed to load dashboard data', 'error');
    } finally {
      setLoading(false);
      isFetching.current = false;
    }
  }, [toast]);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 30_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  // Live clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleAcknowledge = async (id) => {
    try {
      // POST /dashboard/missed/:id/acknowledge
      const r = await apiFetch(`/dashboard/missed/${id}/acknowledge`, { method: 'POST' });
      setData(prev => ({
        ...prev,
        missed: prev.missed.map(m => m.id === id ? { ...m, acknowledged: true } : m),
      }));
      toast(r.message || 'Patrol acknowledged');
    } catch {
      toast('Failed to acknowledge patrol', 'error');
    }
  };

  const handleCloseIncident = async (incident) => {
    try {
      // POST /dashboard/incidents/:id/close
      const r = await apiFetch(`/dashboard/incidents/${incident.id}/close`, { method: 'POST' });
      setData(prev => ({
        ...prev,
        incidents: prev.incidents.filter(i => i.id !== incident.id),
        // Decrement openIncidents in stats
        stats: prev.stats ? { ...prev.stats, openIncidents: Math.max(0, (prev.stats.openIncidents ?? 1) - 1) } : prev.stats,
      }));
      toast(r.message || `Incident at ${incident.site} closed`);
    } catch {
      toast('Failed to close incident', 'error');
    }
  };

  const handleAlertSupervisor = () => toast('Supervisor alerted via system');
  const handleDispatchGuard   = () => toast('Dispatch request sent');
  const handleReportIncident  = () => toast('Opening incident report form…');
  const handleDailyReport     = () => toast('Generating daily report…');

  // ── Derived values ────────────────────────────────────────────────────────

  const { stats, events, attendance, missed, progress, incidents, alerts, performance } = data;

  // compliance uses backend's completedPatrols / totalPatrols
  const compliance = stats?.totalPatrols
    ? Math.round((stats.completedPatrols / stats.totalPatrols) * 100)
    : 0;

  const missedCount = missed.filter(m => m.status === 'missed').length;

  const shiftLabel = shiftWindow
    ? `Shift ${new Date(shiftWindow.start).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'})} – ${new Date(shiftWindow.end).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'})}`
    : '';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{CSS}</style>
      <div className="db-root">

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <header className="db-header">
          <div className="db-header-left">
            <div className="db-live-pill">
              <span className="db-pulse" />
              LIVE
            </div>
            <div>
              <div className="db-title">
                <Shield size={22} color={C.primaryMid} />
                BOB MORGAN Security Operations Center
              </div>
              {shiftLabel && (
                <div style={{ fontSize: '0.68rem', color: C.textMuted, marginTop: 2, paddingLeft: 30 }}>
                  {shiftLabel}
                  {shiftWindow?.graceMinutes ? ` · ${shiftWindow.graceMinutes}min grace` : ''}
                </div>
              )}
            </div>
          </div>
          <div className="db-header-right">
            <div className="db-clock">
              <Clock size={14} />
              {clock}
            </div>
            {lastRefresh && (
              <span style={{ fontSize: '0.65rem', color: C.textMuted }}>
                Updated {lastRefresh.toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
              </span>
            )}
            <button className="db-btn-ghost" onClick={fetchAll} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              Refresh
            </button>
            <button className="db-btn-exit" onClick={() => navigate('/')}>
              <Power size={14} />
              Exit
            </button>
          </div>
        </header>

        {/* ── CONTENT ────────────────────────────────────────────────────── */}
        <div className="db-content">

          {/* KPI strip */}
          <div className="db-kpi-grid">
            <KpiCard title="Active Guards"    value={stats?.activeGuards}     Icon={Users}       color={C.primaryMid} sub="On duty this shift" />
            <KpiCard title="Open Incidents"   value={stats?.openIncidents}    Icon={AlertOctagon} color={C.danger}    sub={stats?.openIncidents > 0 ? 'Requires attention' : 'All clear'} />
            <KpiCard title="Missed Patrols"   value={stats?.missedPatrols}    Icon={X}           color={C.danger}    sub="This shift" />
            <KpiCard title="Late Patrols"     value={stats?.latePatrols ?? 0} Icon={Clock}       color={C.warning}   sub="Overdue" />
            <KpiCard title="Sites Monitored"  value={stats?.sitesMonitored}   Icon={MapPin}      color={C.info}      sub="Active accounts" />
          </div>

          {/* Row 2: compliance · attendance · top performers */}
          <div className="db-3col">

            {/* Patrol compliance — uses completedPatrols / totalPatrols from /stats */}
            <SectionCard title="Patrol Compliance" TitleIcon={Target}
              badge={<Badge status={compliance >= 80 ? 'completed' : compliance >= 60 ? 'warning' : 'missed'}>{compliance}%</Badge>}>
              <div style={{ textAlign: 'center', padding: '12px 0 18px' }}>
                <div style={{ fontSize: '3.2rem', fontWeight: 800, color: compliance >= 80 ? C.success : compliance >= 60 ? C.warning : C.danger, lineHeight: 1 }}>{compliance}%</div>
                <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: 6 }}>
                  {stats?.completedPatrols ?? 0} of {stats?.totalPatrols ?? 0} patrols completed
                </div>
              </div>
              <ProgressRow label="Completion Rate" completed={stats?.completedPatrols} total={stats?.totalPatrols} pct={compliance} />
              <div style={{ display: 'flex', justifyContent: 'space-around', paddingTop: 14, borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
                {[
                  { label: 'Completed', value: stats?.completedPatrols ?? 0, color: C.success },
                  { label: 'Missed',    value: stats?.missedPatrols    ?? 0, color: C.danger  },
                  { label: 'Late',      value: stats?.latePatrols      ?? 0, color: C.warning },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.65rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color, marginTop: 3 }}>{value}</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Guard attendance — uses /attendance shape: { onDuty, offDuty, onLeave, absent, total } */}
            <SectionCard title="Guard Attendance" TitleIcon={UserCheck}>
              {[
                { label: 'On Duty',   value: attendance?.onDuty,  status: 'completed' },
                { label: 'Off Duty',  value: attendance?.offDuty, status: 'normal'    },
                { label: 'On Leave',  value: attendance?.onLeave, status: 'pending'   },
                { label: 'Absent',    value: attendance?.absent,  status: 'missed'    },
              ].map(({ label, value, status }) => (
                <div key={label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 0', borderBottom: `1px solid ${C.border}`,
                  fontSize: '0.82rem', color: C.text, fontWeight: 500,
                }}>
                  {label}
                  <Badge status={status}>{value ?? 0}</Badge>
                </div>
              ))}
              <div style={{ marginTop: 14, fontSize: '0.75rem', color: C.textMuted, textAlign: 'center' }}>
                Total roster: <strong style={{ color: C.text }}>{attendance?.total ?? 0}</strong> guards
              </div>
            </SectionCard>

            {/* Top performers — uses /guard-performance shape: { id, name, patrols, score } */}
            <SectionCard title="Top Performers" TitleIcon={Award}>
              {performance.slice(0, 5).map((g, i) => (
                <GuardRow key={g.id ?? g.name} rank={i + 1} guard={g} />
              ))}
              {performance.length === 0 && <Empty>No guard data this shift</Empty>}
            </SectionCard>
          </div>

          {/* Row 3: live events · missed patrols */}
          <div className="db-2col">

            {/* Live event feed — uses /events shape: { id, time, type, text, site, zone, … } */}
            <SectionCard title="Live Event Feed" TitleIcon={Activity} maxH={400}
              action={
                <button className="db-btn-ghost db-btn-xs" onClick={fetchAll}>
                  <RefreshCw size={11} /> Refresh
                </button>
              }>
              {loading && <Loading />}
              {!loading && events.map((ev, i) => <EventItem key={ev.id ?? i} event={ev} />)}
              {!loading && events.length === 0 && <Empty>No events in the last 8 hours</Empty>}
            </SectionCard>

            {/* Missed patrol monitor — uses /missed-patrols shape: { id, site, zone, guard, scheduled, status, acknowledged } */}
            <SectionCard title="Missed Patrol Monitor" TitleIcon={AlertTriangle} iconColor={C.danger} maxH={400}
              badge={<Badge status="missed">{missedCount} missed</Badge>}>
              {missed.map(p => <MissedRow key={p.id} patrol={p} onAcknowledge={handleAcknowledge} />)}
              {missed.length === 0 && <Empty>No missed patrols — all clear ✓</Empty>}
              <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="db-btn-outline" onClick={handleAlertSupervisor}>
                  <Bell size={13} /> Alert Supervisor
                </button>
                <button className="db-btn-primary" onClick={handleDispatchGuard}>
                  <Send size={13} /> Dispatch Guard
                </button>
              </div>
            </SectionCard>
          </div>

          {/* Row 4: patrol progress by site · active incidents */}
          <div className="db-2col">

            {/* Patrol progress — uses /patrol-progress shape: { name, completed, total, pct } */}
            <SectionCard title="Patrol Progress by Site" TitleIcon={BarChart3}>
              {progress.map(s => (
                <ProgressRow key={s.name} label={s.name} completed={s.completed} total={s.total} pct={s.pct} />
              ))}
              {progress.length === 0 && <Empty>No site data available</Empty>}
            </SectionCard>

            {/* Active incidents — uses /active-incidents shape: { id, time, site, zone, type, description, status } */}
            <SectionCard title="Active Incidents" TitleIcon={AlertOctagon} iconColor={C.danger} maxH={400}
              badge={<Badge status={incidents.length > 0 ? 'active' : 'completed'}>{incidents.length} active</Badge>}>
              {incidents.map(inc => (
                <IncidentRow key={inc.id} incident={inc} onClose={handleCloseIncident} />
              ))}
              {incidents.length === 0 && <Empty>No active incidents — all clear ✓</Empty>}
              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="db-btn-danger" onClick={handleReportIncident}>
                  <AlertOctagon size={13} /> Report Incident
                </button>
              </div>
            </SectionCard>
          </div>

          {/* Row 5: alerts · emergency actions */}
          <div className="db-2col">

            {/* Alert center — uses /alerts shape: { id, time, message, severity, site, code } */}
            <SectionCard title="Alert Center" TitleIcon={Bell}
              badge={<Badge status={alerts.length > 0 ? 'alert' : 'completed'}>{alerts.length} alerts</Badge>}>
              {alerts.map(a => <AlertItem key={a.id} alert={a} />)}
              {alerts.length === 0 && <Empty>No active alerts — all systems nominal</Empty>}
            </SectionCard>

            {/* Emergency actions */}
            <SectionCard title="Emergency Actions" TitleIcon={AlertTriangle} iconColor={C.danger}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Report Incident',  Icon: AlertOctagon, color: C.danger,      fn: handleReportIncident },
                  { label: 'Call Supervisor',  Icon: PhoneCall,    color: C.warning,     fn: handleAlertSupervisor },
                  { label: 'Dispatch Guard',   Icon: Navigation,   color: C.primaryMid,  fn: handleDispatchGuard },
                  { label: 'Daily Report',     Icon: FileText,     color: C.info,        fn: handleDailyReport },
                ].map(({ label, Icon, color, fn }) => (
                  <button key={label} onClick={fn} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    padding: '18px 12px', background: C.bg, border: `1px solid ${C.border}`,
                    borderRadius: 12, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700,
                    color: C.text, transition: 'all .15s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.primaryBg; e.currentTarget.style.borderColor = C.primaryMid; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = C.bg; e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = ''; }}
                  >
                    <Icon size={24} color={color} strokeWidth={1.75} />
                    {label}
                  </button>
                ))}
              </div>
            </SectionCard>
          </div>

        </div>{/* /db-content */}

        <Toast toasts={toasts} />
      </div>
    </>
  );
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────
const Empty   = ({ children }) => <div style={{ textAlign: 'center', padding: '36px 16px', color: C.textMuted, fontSize: '0.82rem' }}>{children}</div>;
const Loading = ()              => <div style={{ textAlign: 'center', padding: 36, color: C.textMuted, fontSize: '0.82rem' }}>Loading…</div>;

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .db-root {
    min-height: 100vh;
    background: ${C.bg};
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: ${C.text};
  }

  /* Header */
  .db-header {
    position: sticky; top: 0; z-index: 200;
    background: ${C.surface};
    border-bottom: 2px solid ${C.primaryMid};
    padding: 13px 28px;
    display: flex; justify-content: space-between; align-items: center;
    box-shadow: 0 2px 10px rgba(15,37,87,.08);
  }
  .db-header-left  { display: flex; align-items: center; gap: 18px; }
  .db-header-right { display: flex; align-items: center; gap: 14px; }

  .db-live-pill {
    display: flex; align-items: center; gap: 7px;
    background: ${C.danger}; color: #fff;
    padding: 5px 12px; border-radius: 20px;
    font-size: 0.68rem; font-weight: 800; letter-spacing: 1px;
  }
  .db-pulse {
    width: 7px; height: 7px; background: #fff; border-radius: 50%;
    animation: dbPulse 1.4s ease-in-out infinite;
  }
  @keyframes dbPulse {
    0%,100% { opacity:1; transform:scale(1); }
    50%      { opacity:.4; transform:scale(1.3); }
  }

  .db-title {
    display: flex; align-items: center; gap: 9px;
    font-size: 1.05rem; font-weight: 700; color: ${C.primary};
  }

  .db-clock {
    display: flex; align-items: center; gap: 7px;
    font-family: 'Courier New', monospace; font-size: 0.95rem; font-weight: 700;
    color: ${C.text}; background: ${C.bg}; padding: 6px 14px; border-radius: 8px;
  }

  .db-btn-ghost {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 600;
    cursor: pointer; border: 1px solid ${C.border}; background: ${C.surface};
    color: ${C.text}; transition: all .15s;
  }
  .db-btn-ghost:hover  { background: ${C.primaryBg}; border-color: ${C.primaryMid}; }
  .db-btn-ghost:disabled { opacity: .5; cursor: not-allowed; }

  .db-btn-xs { padding: 4px 9px; font-size: 0.65rem; }

  .db-btn-exit {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 600;
    cursor: pointer; border: 1px solid ${C.dangerBg}; background: ${C.surface};
    color: ${C.danger}; transition: all .15s;
  }
  .db-btn-exit:hover { background: ${C.dangerBg}; }

  .db-btn-primary {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 600;
    cursor: pointer; border: none; background: ${C.primaryMid}; color: #fff;
    transition: background .15s;
  }
  .db-btn-primary:hover { background: ${C.primary}; }

  .db-btn-outline {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 600;
    cursor: pointer; border: 1px solid ${C.primaryMid}; background: transparent;
    color: ${C.primaryMid}; transition: all .15s;
  }
  .db-btn-outline:hover { background: ${C.primaryBg}; }

  .db-btn-danger {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 600;
    cursor: pointer; border: none; background: ${C.danger}; color: #fff;
    transition: background .15s;
  }
  .db-btn-danger:hover { background: #b91c1c; }

  /* Layout */
  .db-content {
    padding: 22px 28px;
    display: flex; flex-direction: column; gap: 20px;
    max-width: 1800px; margin: 0 auto;
  }

  .db-kpi-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 16px;
  }

  .db-3col {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  .db-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  @media (max-width: 1300px) {
    .db-kpi-grid { grid-template-columns: repeat(3, 1fr); }
    .db-3col     { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 900px) {
    .db-kpi-grid { grid-template-columns: 1fr 1fr; }
    .db-3col, .db-2col { grid-template-columns: 1fr; }
    .db-content  { padding: 14px 14px; }
    .db-header   { padding: 10px 14px; }
  }

  /* Spin animation for refresh icon */
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin .7s linear infinite; }

  /* Toast slide */
  @keyframes slideIn {
    from { opacity:0; transform:translateX(80px); }
    to   { opacity:1; transform:translateX(0); }
  }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: ${C.bg}; }
  ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #94A3B8; }
`;