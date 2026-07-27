import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Calendar, Clock, Mail, RefreshCw, Send,
  CheckCircle, XCircle, Plus, Trash2, Edit,
  Eye, Search, ChevronDown, ChevronUp,
  Shield, AlertCircle, Zap, Play, Pause,
  Users, Settings, Bell, BellOff, Target, X,
  Sun, Moon,
} from 'lucide-react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// ============================================================================
// CONFIGURATION
// ============================================================================
const API_BASE_URL = '/api/scheduler';
const API_ROOT     = '/api';

const CONFIG = {
  API_BASE_URL,
  API_ROOT,
  CLIENTS_URL:              `${API_ROOT}/clients`,
  AUTO_REFRESH_INTERVAL:    30000,
  POLL_INTERVAL:            30000,
  NOTIFICATION_TIMEOUT:     5000,
  ERROR_TIMEOUT:            8000,
  HEALTH_CHECK_COOLDOWN:    100,
  RATE_LIMIT_RETRY_DELAY:   2000,
  MAX_RETRIES:              2,
  MAX_CONSECUTIVE_FAILURES: 3,
};

const FREQUENCY_LABELS = {
  1: 'Daily',
  2: 'Weekly',
  3: 'Twice a Week',
  4: 'Monthly',
};

const FREQUENCY_OPTIONS = [
  { value: 1, label: 'Daily'        },
  { value: 2, label: 'Weekly'       },
  { value: 3, label: 'Twice a Week' },
  { value: 4, label: 'Monthly'      },
];

const REPORT_PERIODS = {
  PREVIOUS_WEEK: 'previousWeek',
  LAST_7_DAYS:   'last7days',
  YESTERDAY:     'yesterday',
  LAST_3_DAYS:   'last3days',
  LAST_30_DAYS:  'last30days',
  CUSTOM:        'custom',
};

const FREQUENCY_PERIOD_MAP = {
  1: REPORT_PERIODS.YESTERDAY,
  2: REPORT_PERIODS.PREVIOUS_WEEK,
  3: REPORT_PERIODS.LAST_3_DAYS,
  4: REPORT_PERIODS.LAST_30_DAYS,
};

const PATROL_DAY_OPTIONS = [
  { value: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', label: 'Every Day (Mon–Sun)'        },
  { value: 'Mon,Tue,Wed,Thu,Fri',          label: 'Weekdays Only (Mon–Fri)'   },
  { value: 'Sat,Sun',                       label: 'Weekends Only (Sat–Sun)'   },
  { value: 'Mon,Tue,Wed,Thu,Fri,Sat',       label: 'Monday – Saturday'         },
  { value: 'Mon,Wed,Fri',                   label: 'Monday, Wednesday, Friday' },
  { value: 'Tue,Thu',                       label: 'Tuesday, Thursday'         },
];

// AFTER — matches backend's VALID_SHIFT_TYPES = ['Day/Night', 'Night Only', 'Day Only']
const SHIFT_TYPE_OPTIONS = [
  { value: 'Day/Night',  label: 'All Shifts (Day & Night)'      },
  { value: 'Day Only',   label: 'Day Shift Only (6:00–17:59)'   },
  { value: 'Night Only', label: 'Night Shift Only (18:00–5:59)' },
];

// ============================================================================
// ✅ FIX 19: REPORT SCHEDULE SHIFT TYPE
//
// This is distinct from SHIFT_TYPE_OPTIONS above (which configures the
// PATROL count expectation for a client). REPORT_SHIFT_OPTIONS configures
// which time window an automated REPORT SCHEDULE covers, so the same
// client can now have an independent Day schedule and Night schedule
// instead of being limited to a single 24hr schedule.
//
// Values match the canonical enum used server-side in
// schedulerController.js / scheduler.js: 'day' | 'night' | 'both'.
// ============================================================================
const REPORT_SHIFT_TYPES = {
  BOTH:  'both',
  DAY:   'day',
  NIGHT: 'night',
};

const REPORT_SHIFT_OPTIONS = [
  { value: REPORT_SHIFT_TYPES.BOTH,  label: 'All Shifts (24hr)' },
  { value: REPORT_SHIFT_TYPES.DAY,   label: 'Day Shift Only'    },
  { value: REPORT_SHIFT_TYPES.NIGHT, label: 'Night Shift Only'  },
];

function normaliseReportShiftType(input) {
  if (!input || typeof input !== 'string') return REPORT_SHIFT_TYPES.BOTH;
  const v = input.trim().toLowerCase();
  if (v === 'day') return REPORT_SHIFT_TYPES.DAY;
  if (v === 'night') return REPORT_SHIFT_TYPES.NIGHT;
  return REPORT_SHIFT_TYPES.BOTH;
}

function shiftBadge(shiftType) {
  const s = normaliseReportShiftType(shiftType);
  if (s === REPORT_SHIFT_TYPES.DAY)   return { label: 'Day',   icon: Sun,  className: 'bg-amber-100 text-amber-700'  };
  if (s === REPORT_SHIFT_TYPES.NIGHT) return { label: 'Night', icon: Moon, className: 'bg-indigo-100 text-indigo-700' };
  return { label: '24hr', icon: Clock, className: 'bg-gray-100 text-gray-600' };
}

// ============================================================================
// AUTH HELPER
// ============================================================================
const getAuthToken = () =>
  localStorage.getItem('authToken') ||
  localStorage.getItem('token')     ||
  sessionStorage.getItem('authToken') ||
  sessionStorage.getItem('token')   ||
  null;

async function authFetch(url, options = {}, retryCount = 0) {
  const token   = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch {
    const err  = new Error('Cannot connect to backend. Make sure the server is running.');
    err.status = 0;
    throw err;
  }

  if (response.status === 429 && retryCount < CONFIG.MAX_RETRIES) {
    const retryAfter = response.headers.get('Retry-After');
    const delay = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : Math.min(CONFIG.RATE_LIMIT_RETRY_DELAY * 2 ** retryCount, 10000);
    await new Promise((r) => setTimeout(r, delay));
    return authFetch(url, options, retryCount + 1);
  }

  const STATUS_ERRORS = {
    401: 'Unauthorized — please log in again',
    403: 'Forbidden — admin access required',
    404: 'Endpoint not found',
  };
  if (STATUS_ERRORS[response.status]) {
    const err  = new Error(STATUS_ERRORS[response.status]);
    err.status = response.status;
    throw err;
  }
  if (!response.ok) {
    const text = await response.text();
    let msg = `HTTP ${response.status}`;
    try { const p = JSON.parse(text); msg = p.message || p.error || text || msg; }
    catch { msg = text || msg; }
    const err  = new Error(msg);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

// ============================================================================
// DATE RANGE HELPERS
// ============================================================================
function getExplicitDateRange(frequency, reportPeriod, customStart, customEnd) {
  if (reportPeriod === REPORT_PERIODS.CUSTOM && customStart && customEnd) {
    return { startDate: customStart, endDate: customEnd };
  }

  const today = dayjs();

  switch (reportPeriod) {
    case REPORT_PERIODS.YESTERDAY:
      return {
        startDate: today.subtract(1, 'day').format('YYYY-MM-DD'),
        endDate:   today.format('YYYY-MM-DD'),
      };
    case REPORT_PERIODS.LAST_3_DAYS:
      return {
        startDate: today.subtract(3, 'day').format('YYYY-MM-DD'),
        endDate:   today.format('YYYY-MM-DD'),
      };
    case REPORT_PERIODS.LAST_7_DAYS:
      return {
        startDate: today.subtract(7, 'day').format('YYYY-MM-DD'),
        endDate:   today.format('YYYY-MM-DD'),
      };
    case REPORT_PERIODS.LAST_30_DAYS:
      return {
        startDate: today.subtract(30, 'day').format('YYYY-MM-DD'),
        endDate:   today.format('YYYY-MM-DD'),
      };
    case REPORT_PERIODS.PREVIOUS_WEEK:
      return null;
    default:
      switch (Number(frequency)) {
        case 1: return { startDate: today.subtract(1, 'day').format('YYYY-MM-DD'),  endDate: today.format('YYYY-MM-DD') };
        case 3: return { startDate: today.subtract(3, 'day').format('YYYY-MM-DD'),  endDate: today.format('YYYY-MM-DD') };
        case 4: return { startDate: today.subtract(30, 'day').format('YYYY-MM-DD'), endDate: today.format('YYYY-MM-DD') };
        default: return null;
      }
  }
}

// ============================================================================
// PATROL NORMALISER
// ============================================================================
function normalisePatrolClient(c) {
  const patrolsPerDay =
    c.PatrolsPerDay      ?? c.patrolsPerDay      ??
    c.patrols_per_day    ?? c.PatrolsPerDayCount  ?? null;

  const weekendPatrols =
    c.WeekendPatrols     ?? c.weekendPatrols      ??
    c.weekend_patrols_per_day ?? null;

  const hasCustom =
    c.HasCustomSchedule  ?? c.hasCustomSchedule   ??
    c.has_custom_schedule ?? (patrolsPerDay !== null);

  return {
    ClientID:           c.ClientID           ?? c.id              ?? c.client_id      ?? 0,
    ClientName:         c.ClientName         ?? c.name            ?? c.client_name    ?? 'Unknown',
    PatrolsPerDay:      patrolsPerDay,
    WeekendPatrols:     weekendPatrols,
    PatrolDays:         c.PatrolDays         ?? c.patrolDays      ?? c.patrol_days    ?? '',
    ScheduleType:       c.ScheduleType       ?? c.scheduleType    ?? c.schedule_type  ?? 'daily',
    CustomIntervalDays: c.CustomIntervalDays ?? c.customIntervalDays ?? null,
    ShiftType:          c.ShiftType          ?? c.shiftType       ?? c.shift_type     ?? '',
    WeeklyTotal:        c.WeeklyTotal        ?? c.weeklyTotal     ?? c.weekly_total   ?? null,
    HasCustomSchedule:  hasCustom,
    IsActive:           c.IsActive           ?? c.isActive        ?? c.is_active      ?? true,
    accountNumber:      c.AccountNumber      ?? c.accountNumber   ?? c.cue_ccliente   ?? '',
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
const toDateTimeLocal = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16);
};

const toDateInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const formatDateTime = (dateString) => {
  if (!dateString) return 'N/A';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'Invalid Date';
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return 'Invalid Date'; }
};

const formatDateRangeDisplay = (startDate, endDate, rangeLabel) => {
  if (rangeLabel) return rangeLabel;
  if (!startDate || !endDate) return 'N/A';
  try {
    const s    = new Date(startDate);
    const e    = new Date(endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 'N/A';
    const fmt     = { month: 'short', day: 'numeric' };
    const sFmt    = s.toLocaleDateString('en-US', fmt);
    const eFmt    = e.toLocaleDateString('en-US', { ...fmt, year: 'numeric' });
    const diffDays = Math.round((e - s) / (1000 * 60 * 60 * 24));
    return `${sFmt} – ${eFmt} (${diffDays} shift${diffDays !== 1 ? 's' : ''})`;
  } catch { return `${startDate} – ${endDate}`; }
};

const isJsonBlob = (str) => {
  if (typeof str !== 'string') return false;
  const t = str.trim();
  return t.startsWith('{') || t.startsWith('[') || t.startsWith('SCHEDULE::');
};

const normalizeEmailList = (emails) => {
  if (!emails) return [];
  if (typeof emails === 'string' && isJsonBlob(emails)) return [];
  if (Array.isArray(emails)) return emails.map((e) => e.trim()).filter(Boolean);
  if (typeof emails === 'string')
    return emails.split(/[,;\n]/).map((e) => e.trim()).filter(Boolean);
  return [];
};

const formatEmailsForDisplay = (emails) => {
  const list = normalizeEmailList(emails);
  if (list.length === 0) return 'No email configured';
  if (list.length === 1) return list[0];
  if (list.length === 2) return list.join(', ');
  return `${list[0]}, ${list[1]} +${list.length - 2} more`;
};

function getTimeUntilNextRun(nextRun) {
  if (!nextRun) return 'N/A';
  try {
    const diffMs = new Date(nextRun) - new Date();
    if (isNaN(diffMs)) return 'N/A';
    if (diffMs <= 0)   return 'Now';
    const h = Math.floor(diffMs / 3600000);
    const m = Math.floor((diffMs % 3600000) / 60000);
    return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
  } catch { return 'N/A'; }
}

// ============================================================================
// CLIENT HELPERS
// ============================================================================
// Always resolve to the numeric/string ID — never the name.
const getClientId    = (c) => c?.id ?? c?.ClientID ?? c?.cue_iid ?? c?.clientId ?? undefined;
const getClientName  = (c) => c?.name || c?.ClientName || c?.cue_cnombre || `Client ${getClientId(c)}`;
const getClientAcct  = (c) => c?.accountNumber || c?.AccountNumber || c?.cue_ncuenta || '';
const getClientEmail = (c) => c?.email || c?.ClientEmail || c?.cue_cemail || '';

const getScheduleEmails = (schedule) => {
  const raw = schedule?.emails || schedule?.email || '';
  if (isJsonBlob(raw)) return '';
  return raw;
};

// ============================================================================
// NOTIFICATION HOOK
// ============================================================================
const useNotification = () => {
  const [success, setSuccessState] = useState(null);
  const [error,   setErrorState]   = useState(null);
  const successTimer = useRef(null);
  const errorTimer   = useRef(null);

  const setSuccess = useCallback((msg) => {
    setSuccessState(msg);
    clearTimeout(successTimer.current);
    if (msg) successTimer.current = setTimeout(() => setSuccessState(null), CONFIG.NOTIFICATION_TIMEOUT);
  }, []);

  const setError = useCallback((msg) => {
    setErrorState(msg);
    clearTimeout(errorTimer.current);
    if (msg) errorTimer.current = setTimeout(() => setErrorState(null), CONFIG.ERROR_TIMEOUT);
  }, []);

  useEffect(() => () => {
    clearTimeout(successTimer.current);
    clearTimeout(errorTimer.current);
  }, []);

  return { success, setSuccess, error, setError };
};

// ============================================================================
// CLIENT SEARCH DROPDOWN
// Always stores/emits the numeric clientId, never the name string.
// ============================================================================
const ClientSearchDropdown = React.memo(({
  allClients, value, onChange, disabled, placeholder,
}) => {
  const [search, setSearch] = useState('');
  const [open, setOpen]     = useState(false);
  const containerRef        = useRef(null);

  // value is always a clientId string — find by ID, not name
  const selectedClient = useMemo(
    () => allClients.find((c) => String(getClientId(c)) === String(value)),
    [allClients, value]
  );

  const displayValue = selectedClient
    ? `${getClientName(selectedClient)}${getClientAcct(selectedClient) ? ` (${getClientAcct(selectedClient)})` : ''}`
    : '';

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return allClients.slice(0, 80);
    return allClients.filter((c) => {
      const name = getClientName(c).toLowerCase();
      const acct = getClientAcct(c).toLowerCase();
      const id   = String(getClientId(c) ?? '');
      return name.includes(term) || acct.includes(term) || id.includes(term);
    }).slice(0, 100);
  }, [allClients, search]);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // FIX: emit String(getClientId(client)) — never the name
  const handleSelect = (client) => {
    const id = String(getClientId(client));
    onChange(id, client);   // (clientId: string, clientObject: object)
    setSearch('');
    setOpen(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('', null);
    setSearch('');
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`w-full px-3 py-2 border rounded-lg text-sm flex items-center gap-2 cursor-pointer
          ${disabled ? 'bg-gray-100 cursor-not-allowed border-gray-200' : 'border-gray-300 hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500'}`}
        onClick={() => !disabled && setOpen(true)}
      >
        <Search size={14} className="text-gray-400 shrink-0" />
        {open ? (
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or account…"
            className="flex-1 outline-none bg-transparent text-sm"
            onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className={`flex-1 truncate ${displayValue ? 'text-gray-900' : 'text-gray-400'}`}>
            {displayValue || placeholder || '— Select a client —'}
          </span>
        )}
        {value && !disabled && (
          <button onClick={handleClear} className="shrink-0 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
        {!open && <ChevronDown size={14} className="text-gray-400 shrink-0" />}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500 text-center">No clients found</div>
          ) : (
            filtered.map((client) => {
              const id   = getClientId(client);
              const name = getClientName(client);
              const acct = getClientAcct(client);
              const isSelected = String(id) === String(value);
              return (
                // key is always the numeric ID — duplicated names won't collide
                <button key={id} onClick={() => handleSelect(client)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-0 ${isSelected ? 'bg-blue-50' : ''}`}>
                  <div className="font-medium text-sm text-gray-900 truncate">{name}</div>
                  {acct && <div className="text-xs text-gray-500">Account: {acct}</div>}
                  {/* Show ID as a disambiguator so admins can tell duplicates apart */}
                  <div className="text-xs text-gray-400">ID: {id}</div>
                </button>
              );
            })
          )}
          {allClients.length > 80 && !search && (
            <div className="px-4 py-2 text-xs text-gray-400 text-center border-t border-gray-100">
              Type to search all {allClients.length} clients
            </div>
          )}
        </div>
      )}
    </div>
  );
});
ClientSearchDropdown.displayName = 'ClientSearchDropdown';

// ============================================================================
// DEFAULT FORM VALUES
// ============================================================================
const DEFAULT_FORM_DATA = {
  clientId: '', emails: '', frequency: 2, intervalDays: 1,
  nextRun: '', isActive: true,
  reportPeriod: REPORT_PERIODS.PREVIOUS_WEEK,
  customStartDate: '', customEndDate: '',
  shiftType: REPORT_SHIFT_TYPES.BOTH, // ✅ FIX 19
};

const DEFAULT_PATROL_FORM = {
  clientId: '', patrolsPerDay: 11, weekendPatrols: 11,
  patrolDays: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
  shiftType: 'Day/Night', scheduleType: 'daily',
};

const DEFAULT_REPORT_FORM = {
  clientId: '', startDate: '', endDate: '',
  reportPeriod: REPORT_PERIODS.PREVIOUS_WEEK, recipientEmail: '',
  shiftType: REPORT_SHIFT_TYPES.BOTH, // ✅ FIX 19
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================
const StatusBadge = ({ schedule }) => {
  const emails = getScheduleEmails(schedule);
  if (!schedule.nextRun || !emails)
    return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">No Schedule</span>;
  if (schedule.isActive === false)
    return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">Paused</span>;
  const next = new Date(schedule.nextRun);
  if (isNaN(next.getTime()))
    return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">Invalid Date</span>;
  return next <= new Date()
    ? <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">Due Now</span>
    : <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">Scheduled</span>;
};

// ✅ FIX 19: small pill showing whether a schedule covers Day / Night / 24hr —
// this is what lets two schedules for the same client be told apart at a glance.
const ShiftBadge = ({ shiftType }) => {
  const { label, icon: Icon, className } = shiftBadge(shiftType);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${className}`}>
      <Icon size={11} />{label}
    </span>
  );
};

const StatCard = ({ label, value, icon, bgColor }) => (
  <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
      <div className={`p-2.5 ${bgColor} rounded-lg`}>{icon}</div>
    </div>
  </div>
);

const ScheduleCard = React.memo(({
  schedule, patrolData, selected, showBulkActions,
  onSelect, onSendQuick, onAdvance, onPreview,
  onPatrolSchedule, onToggleActive, onEdit, onDelete, isUpdating,
}) => {
  const displayEmails   = formatEmailsForDisplay(getScheduleEmails(schedule));
  const hasPatrol       = patrolData?.HasCustomSchedule;
  const patrolsPerDay   = patrolData?.PatrolsPerDay;
  const weeklyTotal     = patrolData?.WeeklyTotal;
  const quickSendPeriod = FREQUENCY_LABELS[schedule.frequency] || 'Weekly';
  const quickSendDetail = { 1: 'yesterday', 2: 'previous week', 3: 'last 3 days', 4: 'last 30 days' }[schedule.frequency] || 'previous week';

  return (
    <div className={`bg-white border rounded-xl p-5 hover:shadow-md transition-all ${
      selected ? 'ring-2 ring-blue-500 border-blue-300'
        : schedule.isActive === false ? 'border-gray-200 opacity-75' : 'border-gray-200'}`}>
      {showBulkActions && (
        <div className="mb-3">
          <input type="checkbox" checked={selected} onChange={() => onSelect(schedule.id)}
            className="h-4 w-4 text-blue-600 rounded border-gray-300"
            aria-label={`Select schedule for ${schedule.clientName}`} />
        </div>
      )}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900 text-sm truncate">{schedule.clientName}</h3>
            {/* ✅ FIX 19: shift badge sits right next to the name so Day/Night pairs are unmistakable */}
            <ShiftBadge shiftType={schedule.shiftType} />
          </div>
          {schedule.accountNumber && <p className="text-xs text-gray-400 mt-0.5">Acc: {schedule.accountNumber}</p>}
          {/* Show clientId so operators can verify they have the right record */}
          <p className="text-xs text-gray-300 mt-0.5">ID: {schedule.clientId}</p>
          {hasPatrol && patrolsPerDay != null ? (
            <p className="text-xs text-teal-600 mt-0.5">
              <Target size={10} className="inline mr-0.5" />
              {patrolsPerDay} patrols/day
              {weeklyTotal != null && <span className="text-teal-400 ml-1">({weeklyTotal}/wk)</span>}
            </p>
          ) : (
            <p className="text-xs text-amber-500 mt-0.5">⚠ No patrol schedule</p>
          )}
          <div className="mt-1.5"><StatusBadge schedule={schedule} /></div>
        </div>
        {schedule.emailCount > 0 && (
          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium shrink-0">
            {schedule.emailCount} {schedule.emailCount === 1 ? 'recipient' : 'recipients'}
          </span>
        )}
      </div>

      <div className="space-y-2 mb-4 text-sm text-gray-600">
        <div className="flex items-start gap-2">
          <Mail size={14} className="mt-0.5 shrink-0 text-gray-400" />
          <span className="truncate text-xs" title={getScheduleEmails(schedule)}>{displayEmails}</span>
        </div>
        <div className="flex items-start gap-2">
          <Clock size={14} className="mt-0.5 shrink-0 text-gray-400" />
          <div className="text-xs">
            <div>{formatDateTime(schedule.nextRun)}</div>
            {schedule.nextRun && schedule.isActive !== false && (
              <div className="text-gray-400">{getTimeUntilNextRun(schedule.nextRun)}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={14} className="shrink-0 text-gray-400" />
          <span className="text-xs">{quickSendPeriod}<span className="text-gray-400 ml-1">→ {quickSendDetail}</span></span>
        </div>
        {hasPatrol && patrolData.PatrolDays && (
          <div className="flex items-center gap-2">
            <Target size={14} className="shrink-0 text-gray-400" />
            <span className="text-xs text-gray-500 truncate">{patrolData.PatrolDays} · {patrolData.ShiftType || 'All shifts'}</span>
          </div>
        )}
      </div>

      <div className="flex justify-between pt-3 border-t border-gray-100">
        <div className="flex gap-1">
          <button onClick={() => onSendQuick(schedule)} disabled={isUpdating}
            className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-40 transition-colors"
            title={`Send Now (${quickSendDetail})`}>
            {isUpdating ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
          <button onClick={() => onAdvance(schedule.id)} disabled={isUpdating}
            className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg disabled:opacity-40 transition-colors"
            title="Advance to Tomorrow 9AM">
            {isUpdating ? <RefreshCw size={16} className="animate-spin" /> : <Zap size={16} />}
          </button>
          <button onClick={() => onPreview(schedule.clientId)}
            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Preview Analytics">
            <Eye size={16} />
          </button>
          <button onClick={() => onPatrolSchedule({ id: schedule.clientId, name: schedule.clientName })}
            className={`p-1.5 rounded-lg transition-colors ${hasPatrol ? 'text-teal-600 hover:bg-teal-50' : 'text-amber-500 hover:bg-amber-50'}`}
            title={hasPatrol ? 'Edit Patrol Schedule' : 'Configure Patrol Schedule'}>
            <Target size={16} />
          </button>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onToggleActive(schedule.id, schedule.isActive === false)}
            disabled={isUpdating}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
              schedule.isActive === false ? 'text-green-600 hover:bg-green-50' : 'text-yellow-600 hover:bg-yellow-50'}`}
            title={schedule.isActive === false ? 'Activate' : 'Pause'}>
            {isUpdating ? <RefreshCw size={16} className="animate-spin" />
              : schedule.isActive === false ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button onClick={() => onEdit(schedule)}
            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors" title="Edit">
            <Edit size={16} />
          </button>
          <button onClick={() => onDelete(schedule)}
            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
});
ScheduleCard.displayName = 'ScheduleCard';

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const SecurityReportsPage = () => {
  const [schedules,           setSchedules]           = useState([]);
  const [allClients,          setAllClients]          = useState([]);
  const [clientsLoading,      setClientsLoading]      = useState(false);
  const [patrolMap,           setPatrolMap]           = useState({});
  const [weekRangeInfo,       setWeekRangeInfo]       = useState(null);
  const [emailSendingEnabled, setEmailSendingEnabled] = useState(false);

  const [patrolClientSearch,       setPatrolClientSearch]       = useState('');
  const [showPatrolClientDropdown, setShowPatrolClientDropdown] = useState(false);

  const [loading,       setLoading]       = useState(false);
  const [searchTerm,    setSearchTerm]    = useState('');
  const [filterStatus,  setFilterStatus]  = useState('all');
  const [sortConfig,    setSortConfig]    = useState({ key: 'clientName', direction: 'asc' });
  const [activePolling, setActivePolling] = useState(true);

  const [showModal,        setShowModal]        = useState(false);
  const [modalMode,        setModalMode]        = useState('create');
  const [currentSchedule,  setCurrentSchedule]  = useState(null);
  const [showPreview,      setShowPreview]      = useState(false);
  const [previewData,      setPreviewData]      = useState(null);
  const [showManualReport, setShowManualReport] = useState(false);
  const [showBulkActions,  setShowBulkActions]  = useState(false);
  const [showPatrolModal,  setShowPatrolModal]  = useState(false);
  const [currentPatrol,    setCurrentPatrol]    = useState(null);

  const [formData,   setFormData]   = useState(DEFAULT_FORM_DATA);
  const [patrolForm, setPatrolForm] = useState(DEFAULT_PATROL_FORM);
  const [reportForm, setReportForm] = useState(DEFAULT_REPORT_FORM);

  const [updatingSchedules, setUpdatingSchedules] = useState({});
  const [isSendingReport,   setIsSendingReport]   = useState(false);
  const [selectedSchedules, setSelectedSchedules] = useState(new Set());

  const initialized         = useRef(false);
  const healthInProgress    = useRef(false);
  const isRefreshing        = useRef(false);
  const consecutiveFailures = useRef(0);
  const lastRefreshTime     = useRef(0);
  const pollTimer           = useRef(null);
  const patrolSearchRef     = useRef(null);

  const { success, setSuccess, error, setError } = useNotification();

  const filteredPatrolClients = useMemo(() => {
    const term = patrolClientSearch.trim().toLowerCase();
    if (!term) return allClients.slice(0, 50);
    return allClients.filter((c) => {
      const name = getClientName(c).toLowerCase();
      const acct = getClientAcct(c).toLowerCase();
      return name.includes(term) || acct.includes(term);
    }).slice(0, 100);
  }, [allClients, patrolClientSearch]);

  const filteredSchedules = useMemo(() => {
    let list = [...schedules];
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter((s) =>
        (s.clientName || '').toLowerCase().includes(term) ||
        getScheduleEmails(s).toLowerCase().includes(term)
      );
    }
    if (filterStatus !== 'all') {
      list = list.filter((s) => {
        if (filterStatus === 'paused')    return s.isActive === false;
        if (filterStatus === 'active')    return s.isActive !== false;
        if (!s.nextRun) return false;
        const isDue = new Date(s.nextRun) <= new Date();
        if (filterStatus === 'due')       return isDue;
        if (filterStatus === 'scheduled') return !isDue;
        return true;
      });
    }
    list.sort((a, b) => {
      let av = a[sortConfig.key] ?? '';
      let bv = b[sortConfig.key] ?? '';
      if (sortConfig.key === 'nextRun') { av = new Date(av).getTime() || 0; bv = new Date(bv).getTime() || 0; }
      if (av < bv) return sortConfig.direction === 'asc' ? -1 : 1;
      if (av > bv) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [schedules, searchTerm, filterStatus, sortConfig]);

  const stats = useMemo(() => {
    const withEmails      = schedules.filter((s) => normalizeEmailList(getScheduleEmails(s)).length > 0);
    const totalRecipients = withEmails.reduce((sum, s) => sum + normalizeEmailList(getScheduleEmails(s)).length, 0);
    const uniquePatrols   = Object.values(patrolMap).filter((v, i, arr) => arr.indexOf(v) === i);
    const configuredCount = uniquePatrols.filter((p) => p.HasCustomSchedule && p.PatrolsPerDay != null).length;
    return [
      { id: 'total',      label: 'Total Schedules',  value: schedules.length,    icon: <Calendar size={20} className="text-blue-600" />,   bgColor: 'bg-blue-50' },
      { id: 'recipients', label: 'Email Recipients', value: totalRecipients,     icon: <Users size={20} className="text-purple-600" />,    bgColor: 'bg-purple-50' },
      { id: 'due',        label: 'Due Reports',
        value: schedules.filter((s) => s.isActive !== false && s.nextRun && new Date(s.nextRun) <= new Date() && normalizeEmailList(getScheduleEmails(s)).length > 0).length,
        icon: <AlertCircle size={20} className="text-orange-600" />, bgColor: 'bg-orange-50' },
      { id: 'custom',     label: 'Custom Patrols',   value: configuredCount,     icon: <Target size={20} className="text-teal-600" />,     bgColor: 'bg-teal-50' },
      { id: 'email',      label: 'Email Status',     value: emailSendingEnabled ? 'ON' : 'OFF',
        icon: emailSendingEnabled ? <Bell size={20} className="text-green-600" /> : <BellOff size={20} className="text-red-500" />,
        bgColor: emailSendingEnabled ? 'bg-green-50' : 'bg-red-50' },
    ];
  }, [schedules, patrolMap, emailSendingEnabled]);

  // ==========================================================================
  // DATA FETCHING
  // ==========================================================================
  const fetchAllClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const res = await authFetch(CONFIG.CLIENTS_URL);
      const clients =
        (Array.isArray(res?.clients)       ? res.clients       : null) ||
        (Array.isArray(res?.data?.clients) ? res.data.clients  : null) ||
        (Array.isArray(res?.data)          ? res.data          : null) ||
        (Array.isArray(res)                ? res               : null);
      if (!clients || clients.length === 0) throw new Error('No clients returned from /api/clients');
      setAllClients(clients);
    } catch (e) {
      throw new Error(`Failed to load clients: ${e.message}`);
    } finally {
      setClientsLoading(false);
    }
  }, []);

  const fetchSchedules = useCallback(async () => {
    const res  = await authFetch(`${CONFIG.API_BASE_URL}`);
    const list =
      (Array.isArray(res?.schedules)       ? res.schedules      : null) ||
      (Array.isArray(res?.data?.schedules) ? res.data.schedules : null) ||
      (Array.isArray(res?.data)            ? res.data           : null) ||
      (Array.isArray(res)                  ? res                : null);
    if (Array.isArray(list)) {
      // ✅ FIX 19: normalise shiftType on every incoming row so the rest of
      // the UI (badges, edit modal, quick-send) always sees 'day'|'night'|'both'
      // even if the backend sends '', null, or a legacy value.
      setSchedules(list.map((s) => ({ ...s, shiftType: normaliseReportShiftType(s.shiftType) })));
    }
  }, []);

  const fetchPatrolSchedules = useCallback(async () => {
    try {
      let raw = [];
      try {
        const data = await authFetch(`/api/patrol-schedules`);
        raw = Array.isArray(data?.data?.clients) ? data.data.clients :
              Array.isArray(data?.clients)        ? data.clients      :
              Array.isArray(data?.data)           ? data.data         :
              Array.isArray(data)                 ? data              : [];
      } catch {
        const data = await authFetch(`${CONFIG.API_BASE_URL}/clients`);
        raw = Array.isArray(data?.data?.clients) ? data.data.clients :
              Array.isArray(data?.clients)        ? data.clients      :
              Array.isArray(data)                 ? data              : [];
      }
      const map = {};
      raw.forEach((c) => {
        const n = normalisePatrolClient(c);
        map[String(n.ClientID)] = n;
        map[Number(n.ClientID)] = n;
      });
      setPatrolMap(map);
    } catch (e) {
      console.warn('Could not load patrol schedules:', e.message);
    }
  }, []);

  const checkHealth = useCallback(async () => {
    if (healthInProgress.current) return;
    healthInProgress.current = true;
    try {
      const health  = await authFetch(`${CONFIG.API_BASE_URL}/health`);
      const enabled = health?.emailFeatures?.globalEnabled ?? health?.emailConfig?.enabled ?? health?.emailSendingEnabled ?? false;
      setEmailSendingEnabled(enabled);
      if (health?.weekRangeInfo) setWeekRangeInfo(health.weekRangeInfo);
    } catch (e) {
      if (e.status !== 503) setError(`Backend not responding: ${e.message}`);
    } finally {
      setTimeout(() => { healthInProgress.current = false; }, CONFIG.HEALTH_CHECK_COOLDOWN);
    }
  }, [setError]);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchSchedules(), checkHealth(), fetchAllClients(), fetchPatrolSchedules()]);
      consecutiveFailures.current = 0;
      lastRefreshTime.current     = Date.now();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fetchSchedules, checkHealth, fetchAllClients, fetchPatrolSchedules, setError]);

  const autoRefresh = useCallback(async () => {
    if (!activePolling || loading || isRefreshing.current) return;
    if (consecutiveFailures.current >= CONFIG.MAX_CONSECUTIVE_FAILURES) return;
    if (Date.now() - lastRefreshTime.current < CONFIG.AUTO_REFRESH_INTERVAL) return;
    isRefreshing.current = true;
    try {
      await Promise.all([fetchSchedules(), fetchPatrolSchedules()]);
      consecutiveFailures.current = 0;
      lastRefreshTime.current     = Date.now();
    } catch (e) {
      consecutiveFailures.current += 1;
      const isHard = e.status === 404 || e.status === 0;
      if (isHard || consecutiveFailures.current >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
        setActivePolling(false);
        setError(isHard ? `Auto-refresh stopped: ${e.message}` : `Auto-refresh paused after ${CONFIG.MAX_CONSECUTIVE_FAILURES} consecutive failures.`);
      }
    } finally { isRefreshing.current = false; }
  }, [activePolling, loading, fetchSchedules, fetchPatrolSchedules, setError]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    fetchAllData().catch((e) => setError(`Initialization failed: ${e.message}`));
  }, []);

  useEffect(() => {
    if (activePolling) {
      pollTimer.current = setInterval(autoRefresh, CONFIG.POLL_INTERVAL);
    } else {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    return () => clearInterval(pollTimer.current);
  }, [activePolling, autoRefresh]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (patrolSearchRef.current && !patrolSearchRef.current.contains(event.target))
        setShowPatrolClientDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ==========================================================================
  // SCHEDULE CRUD
  // ==========================================================================
  const openCreateModal = useCallback(() => {
    const nextRun = new Date();
    nextRun.setHours(nextRun.getHours() + 1);
    setFormData({ ...DEFAULT_FORM_DATA, nextRun: toDateTimeLocal(nextRun) });
    setCurrentSchedule(null);
    setModalMode('create');
    setShowModal(true);
  }, []);

  const openEditModal = useCallback((schedule) => {
    setFormData({
      // FIX: always store the numeric clientId, not the name
      clientId:        String(schedule.clientId),
      emails:          getScheduleEmails(schedule),
      frequency:       parseInt(schedule.frequency)    || 2,
      intervalDays:    parseInt(schedule.intervalDays) || 1,
      nextRun:         toDateTimeLocal(schedule.nextRun),
      isActive:        schedule.isActive !== false,
      reportPeriod:    schedule.reportPeriod || REPORT_PERIODS.PREVIOUS_WEEK,
      customStartDate: toDateInput(schedule.customStartDate),
      customEndDate:   toDateInput(schedule.customEndDate),
      // ✅ FIX 19: carry the existing shift forward into the edit form
      shiftType:       normaliseReportShiftType(schedule.shiftType),
    });
    setCurrentSchedule(schedule);
    setModalMode('edit');
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setCurrentSchedule(null);
    setFormData(DEFAULT_FORM_DATA);
  }, []);

  const createSchedule = useCallback(async () => {
    const emailList = normalizeEmailList(formData.emails);
    if (!formData.clientId || emailList.length === 0 || !formData.nextRun) {
      setError('Please fill in all required fields'); return;
    }
    if (formData.reportPeriod === REPORT_PERIODS.CUSTOM && (!formData.customStartDate || !formData.customEndDate)) {
      setError('Please select start and end dates for custom range'); return;
    }
    try {
      // FIX: parseInt on formData.clientId — it's always the numeric ID at this point
      const body = {
        clientId: parseInt(formData.clientId, 10),
        emails: emailList.join(', '),
        frequency: parseInt(formData.frequency), intervalDays: parseInt(formData.intervalDays) || 1,
        nextRun: formData.nextRun, type: 1, reportPeriod: formData.reportPeriod,
        shiftType: normaliseReportShiftType(formData.shiftType), // ✅ FIX 19
        ...(formData.reportPeriod === REPORT_PERIODS.CUSTOM && {
          customStartDate: formData.customStartDate, customEndDate: formData.customEndDate,
        }),
      };
      const res = await authFetch(`${CONFIG.API_BASE_URL}`, { method: 'POST', body: JSON.stringify(body) });
      setSuccess(res.message || `Schedule created for ${emailList.length} recipient(s)`);
      closeModal(); fetchSchedules();
    } catch (e) {
      // Surface the "already exists for this shift" 409 clearly, since that's
      // now the expected way to learn a Day/Night pair already exists.
      setError(e.message || 'Failed to create schedule');
    }
  }, [formData, fetchSchedules, closeModal, setError, setSuccess]);

  const updateSchedule = useCallback(async () => {
    if (!currentSchedule) return;
    const emailList = normalizeEmailList(formData.emails);
    if (emailList.length === 0 || !formData.nextRun) { setError('Please fill in all required fields'); return; }
    try {
      const body = {
        emails: emailList.join(', '), frequency: parseInt(formData.frequency),
        intervalDays: parseInt(formData.intervalDays) || 1,
        nextRun: formData.nextRun, reportPeriod: formData.reportPeriod,
        shiftType: normaliseReportShiftType(formData.shiftType), // ✅ FIX 19
        ...(formData.reportPeriod === REPORT_PERIODS.CUSTOM && {
          customStartDate: formData.customStartDate, customEndDate: formData.customEndDate,
        }),
      };
      const res = await authFetch(`${CONFIG.API_BASE_URL}/${currentSchedule.id}`, { method: 'PUT', body: JSON.stringify(body) });
      setSuccess(res.message || `Schedule updated for ${emailList.length} recipient(s)`);
      closeModal(); fetchSchedules();
    } catch (e) { setError(e.message || 'Failed to update schedule'); }
  }, [currentSchedule, formData, fetchSchedules, closeModal, setError, setSuccess]);

  const deleteSchedule = useCallback(async (schedule) => {
    const shiftLabel = shiftBadge(schedule.shiftType).label;
    if (!window.confirm(`Delete ${shiftLabel} schedule for ${schedule.clientName}?`)) return;
    try {
      await authFetch(`${CONFIG.API_BASE_URL}/${schedule.id}`, { method: 'DELETE' });
      setSuccess('Schedule deleted successfully'); fetchSchedules();
    } catch (e) { setError(e.message || 'Failed to delete schedule'); }
  }, [fetchSchedules, setError, setSuccess]);

  // ==========================================================================
  // SCHEDULE ACTIONS
  // ==========================================================================
  const setScheduleUpdating = (id, val) => setUpdatingSchedules((prev) => ({ ...prev, [id]: val }));

  const advanceSchedule = useCallback(async (scheduleId) => {
    const schedule = schedules.find((s) => s.id === scheduleId);
    if (!schedule) { setError('Schedule not found'); return; }
    setScheduleUpdating(scheduleId, true);
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      await authFetch(`${CONFIG.API_BASE_URL}/${scheduleId}`, {
        method: 'PUT',
        body: JSON.stringify({
          nextRun: toDateTimeLocal(tomorrow), frequency: schedule.frequency,
          emails: getScheduleEmails(schedule), intervalDays: schedule.intervalDays || 1,
          shiftType: schedule.shiftType, // ✅ FIX 19: preserve shift on advance
        }),
      });
      setSuccess(`Advanced. Next run: ${formatDateTime(tomorrow)}`); fetchSchedules();
    } catch (e) { setError(e.message || 'Failed to advance schedule'); }
    finally { setScheduleUpdating(scheduleId, false); }
  }, [schedules, fetchSchedules, setError, setSuccess]);

  const toggleScheduleActive = useCallback(async (scheduleId, makeActive) => {
    const schedule = schedules.find((s) => s.id === scheduleId);
    if (!schedule) { setError('Schedule not found'); return; }
    setScheduleUpdating(scheduleId, true);
    try {
      await authFetch(`${CONFIG.API_BASE_URL}/${scheduleId}`, {
        method: 'PUT',
        body: JSON.stringify({
          nextRun: schedule.nextRun, frequency: schedule.frequency,
          emails: getScheduleEmails(schedule), intervalDays: schedule.intervalDays || 1,
          isActive: makeActive, shiftType: schedule.shiftType, // ✅ FIX 19: preserve shift on toggle
        }),
      });
      setSuccess(`Schedule ${makeActive ? 'activated' : 'deactivated'} successfully`); fetchSchedules();
    } catch (e) { setError(e.message || 'Failed to update status'); }
    finally { setScheduleUpdating(scheduleId, false); }
  }, [schedules, fetchSchedules, setError, setSuccess]);

  // ==========================================================================
  // REPORT OPERATIONS
  // ==========================================================================
  const sendQuickReport = useCallback(async (schedule) => {
    const safeEmails = getScheduleEmails(schedule);
    const recipient  = normalizeEmailList(safeEmails)[0] || '';
    if (!recipient) { setError(`No valid recipient email for ${schedule.clientName}. Edit the schedule to add one.`); return; }

    const reportPeriod = FREQUENCY_PERIOD_MAP[schedule.frequency] ?? REPORT_PERIODS.PREVIOUS_WEEK;
    const dateOverride = getExplicitDateRange(schedule.frequency, reportPeriod, null, null);
    setScheduleUpdating(schedule.id, true);
    try {
      // FIX: schedule.clientId is already the numeric ID from the DB — send it directly
      const res = await authFetch(`${CONFIG.API_BASE_URL}/trigger/patrol-reports`, {
        method: 'POST',
        body: JSON.stringify({
          clientId: schedule.clientId,
          recipientEmail: recipient,
          reportPeriod,
          shiftType: normaliseReportShiftType(schedule.shiftType), // ✅ FIX 19: quick-send respects the schedule's shift
          ...(dateOverride && { startDate: dateOverride.startDate, endDate: dateOverride.endDate }),
        }),
      });
      setSuccess(res.message || `Quick report sent (${reportPeriod})!`); fetchSchedules();
    } catch (e) { setError(e.message || 'Failed to send report'); }
    finally { setScheduleUpdating(schedule.id, false); }
  }, [fetchSchedules, setError, setSuccess]);

  const sendManualReport = useCallback(async () => {
    if (!reportForm.clientId) { setError('Please select a client'); return; }
    if (reportForm.reportPeriod === REPORT_PERIODS.CUSTOM && (!reportForm.startDate || !reportForm.endDate)) {
      setError('Please select start and end dates'); return;
    }
    let recipientEmail = reportForm.recipientEmail.trim();
    if (!recipientEmail) {
      // FIX: look up by numeric ID, not by name
      const cl = allClients.find((c) => String(getClientId(c)) === String(reportForm.clientId));
      recipientEmail = getClientEmail(cl);
    }
    if (!recipientEmail) { setError('No recipient email. Enter one or check client email on file.'); return; }

    const clientSchedule = schedules.find((s) => String(s.clientId) === String(reportForm.clientId));
    const frequency      = clientSchedule?.frequency ?? 2;
    const dateOverride   = getExplicitDateRange(frequency, reportForm.reportPeriod, reportForm.startDate, reportForm.endDate);

    setIsSendingReport(true);
    try {
      // FIX: send clientId as integer, not name string
      const res = await authFetch(`${CONFIG.API_BASE_URL}/trigger/patrol-reports`, {
        method: 'POST',
        body: JSON.stringify({
          clientId: parseInt(reportForm.clientId, 10),
          recipientEmail,
          reportPeriod: reportForm.reportPeriod,
          shiftType: normaliseReportShiftType(reportForm.shiftType), // ✅ FIX 19
          ...(dateOverride && { startDate: dateOverride.startDate, endDate: dateOverride.endDate }),
        }),
      });
      setSuccess(res.message || 'Report generated!');
      setReportForm(DEFAULT_REPORT_FORM); setShowManualReport(false); fetchSchedules();
    } catch (e) { setError(e.message || 'Failed to send report'); }
    finally { setIsSendingReport(false); }
  }, [reportForm, allClients, schedules, fetchSchedules, setError, setSuccess]);

  const triggerBulkReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${CONFIG.API_BASE_URL}/trigger/dynamic-reports`, { method: 'POST', body: JSON.stringify({}) });
      setSuccess(`Bulk reports triggered: ${res.message || 'Success'}`); fetchSchedules();
    } catch (e) { setError(e.message || 'Failed to trigger bulk reports'); }
    finally { setLoading(false); }
  }, [fetchSchedules, setError, setSuccess]);

  const viewPreview = useCallback(async (clientId) => {
    try {
      // clientId is already numeric — no name lookup needed
      const data = await authFetch(`${CONFIG.API_BASE_URL}/analytics/client/${clientId}?days=7`);
      setPreviewData(data); setShowPreview(true);
    } catch (e) { setError(e.message || 'Failed to load preview'); }
  }, [setError]);

  // ==========================================================================
  // PATROL SCHEDULE MODAL
  // ==========================================================================
  const openPatrolModal = useCallback(async (client = null) => {
    setPatrolClientSearch(''); setShowPatrolClientDropdown(false);
    if (client?.id) {
      const cid         = client.id;
      const foundClient = allClients.find((c) => String(getClientId(c)) === String(cid));
      const clientName  = foundClient ? getClientName(foundClient) : client.name || `Client ${cid}`;
      const existing    = patrolMap[String(cid)];
      setPatrolForm({
        clientId: String(cid), clientName,
        patrolsPerDay: existing?.PatrolsPerDay ?? 11, weekendPatrols: existing?.WeekendPatrols ?? 11,
        patrolDays: existing?.PatrolDays || 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
        shiftType: existing?.ShiftType || 'Day/Night', scheduleType: existing?.ScheduleType || 'daily',
      });
      setCurrentPatrol({ id: cid, name: clientName });
      try {
        const res = await authFetch(`${CONFIG.API_BASE_URL}/clients/${cid}/patrols`);
        const cfg = res?.data?.patrolConfig || res?.patrolConfig || res?.data || null;
        if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
          const n = normalisePatrolClient(cfg);
          setPatrolForm((prev) => ({
            ...prev,
            patrolsPerDay: n.PatrolsPerDay ?? prev.patrolsPerDay, weekendPatrols: n.WeekendPatrols ?? prev.weekendPatrols,
            patrolDays: n.PatrolDays || prev.patrolDays, shiftType: n.ShiftType || prev.shiftType,
          }));
        }
      } catch { /* keep what we have */ }
    } else {
      setPatrolForm(DEFAULT_PATROL_FORM); setCurrentPatrol(null);
    }
    setShowPatrolModal(true);
  }, [allClients, patrolMap]);

  const closePatrolModal = useCallback(() => {
    setShowPatrolModal(false); setCurrentPatrol(null); setPatrolForm(DEFAULT_PATROL_FORM);
    setPatrolClientSearch(''); setShowPatrolClientDropdown(false);
  }, []);

  const selectPatrolClient = useCallback((client) => {
    // FIX: use getClientId — never the name
    const clientId   = String(getClientId(client));
    const clientName = getClientName(client);
    const existing   = patrolMap[clientId];
    setPatrolForm((prev) => ({
      ...prev, clientId, clientName,
      patrolsPerDay: existing?.PatrolsPerDay ?? prev.patrolsPerDay, weekendPatrols: existing?.WeekendPatrols ?? prev.weekendPatrols,
      patrolDays: existing?.PatrolDays || prev.patrolDays, shiftType: existing?.ShiftType || prev.shiftType,
    }));
    setPatrolClientSearch(clientName); setShowPatrolClientDropdown(false);
    authFetch(`${CONFIG.API_BASE_URL}/clients/${clientId}/patrols`)
      .then((res) => {
        const cfg = res?.data?.patrolConfig || res?.patrolConfig || res?.data || null;
        if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
          const n = normalisePatrolClient(cfg);
          setPatrolForm((prev) => ({
            ...prev,
            patrolsPerDay: n.PatrolsPerDay ?? prev.patrolsPerDay, weekendPatrols: n.WeekendPatrols ?? prev.weekendPatrols,
            patrolDays: n.PatrolDays || prev.patrolDays, shiftType: n.ShiftType || prev.shiftType,
          }));
        }
      }).catch(() => {});
  }, [patrolMap]);

  const upsertPatrolSchedule = useCallback(async () => {
    if (!patrolForm.clientId) { setError('Please select a client'); return; }
    setLoading(true);
    try {
      // FIX: patrolForm.clientId is always the numeric ID string — use it directly in the URL
      const res = await authFetch(`${CONFIG.API_BASE_URL}/clients/${patrolForm.clientId}/patrols`, {
        method: 'PUT',
        body: JSON.stringify({
          patrolsPerDay: parseInt(patrolForm.patrolsPerDay) || 0, weekendPatrols: parseInt(patrolForm.weekendPatrols) || 0,
          patrolDays: patrolForm.patrolDays, shiftType: patrolForm.shiftType, scheduleType: patrolForm.scheduleType,
        }),
      });
      if (res?.success) {
        setSuccess(`Patrol schedule saved: ${patrolForm.patrolsPerDay} patrols/day`);
        closePatrolModal(); await fetchPatrolSchedules(); await fetchSchedules();
      } else { setError(res?.message || 'Failed to save patrol schedule'); }
    } catch (e) { setError(e.message || 'Failed to save patrol schedule'); }
    finally { setLoading(false); }
  }, [patrolForm, fetchPatrolSchedules, fetchSchedules, closePatrolModal, setError, setSuccess]);

  // ==========================================================================
  // BULK OPERATIONS
  // ==========================================================================
  const toggleSelection = useCallback((id) => {
    setSelectedSchedules((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedSchedules((prev) => {
      const allIds = filteredSchedules.map((s) => s.id);
      return prev.size === allIds.length && allIds.length > 0 ? new Set() : new Set(allIds);
    });
  }, [filteredSchedules]);

  const bulkResetNextRun = useCallback(async () => {
    if (selectedSchedules.size === 0) { setError('Please select at least one schedule'); return; }
    setLoading(true);
    try {
      const res = await authFetch(`${CONFIG.API_BASE_URL}/bulk/reset-next-run`, { method: 'POST', body: JSON.stringify({ scheduleIds: Array.from(selectedSchedules) }) });
      setSuccess(`Reset ${res.summary?.success || 0} schedule(s)`);
      setSelectedSchedules(new Set()); setShowBulkActions(false); fetchSchedules();
    } catch (e) { setError(e.message || 'Failed to reset'); }
    finally { setLoading(false); }
  }, [selectedSchedules, fetchSchedules, setError, setSuccess]);

  // ==========================================================================
  // GLOBAL TOGGLES
  // ==========================================================================
  const toggleAutoRefresh = useCallback(() => {
    setActivePolling((prev) => {
      const next = !prev;
      if (next) { consecutiveFailures.current = 0; lastRefreshTime.current = 0; }
      setSuccess(next ? 'Auto-refresh resumed' : 'Auto-refresh paused');
      return next;
    });
  }, [setSuccess]);

  const toggleEmailSending = useCallback(async () => {
    const newState = !emailSendingEnabled;
    try {
      const res = await authFetch(`${CONFIG.API_BASE_URL}/toggle-email`, { method: 'POST', body: JSON.stringify({ enabled: newState }) });
      setEmailSendingEnabled(res.emailSendingEnabled ?? newState);
      setSuccess(`Email sending ${newState ? 'enabled' : 'disabled'} globally`);
    } catch (e) { setError(e.message || 'Failed to toggle email'); }
  }, [emailSendingEnabled, setError, setSuccess]);

  const patrolWeeklyPreview = useMemo(() => {
    const days         = patrolForm.patrolDays.split(',').map((d) => d.trim());
    const weekdayCount = days.filter((d) => d !== 'Sat' && d !== 'Sun').length;
    const weekendCount = days.filter((d) => d === 'Sat' || d === 'Sun').length;
    return (weekdayCount * (patrolForm.patrolsPerDay || 0)) + (weekendCount * (patrolForm.weekendPatrols || patrolForm.patrolsPerDay || 0));
  }, [patrolForm.patrolDays, patrolForm.patrolsPerDay, patrolForm.weekendPatrols]);

  const reportPeriodOptions = useMemo(() => {
    const clientSchedule = schedules.find((s) => String(s.clientId) === String(reportForm.clientId));
    const freq           = clientSchedule?.frequency ?? null;
    const opts = [
      { value: REPORT_PERIODS.PREVIOUS_WEEK, label: `Previous Week${weekRangeInfo?.label ? ` (${weekRangeInfo.label})` : ''}` },
      { value: REPORT_PERIODS.LAST_7_DAYS,   label: 'Last 7 Days' },
      { value: REPORT_PERIODS.YESTERDAY,     label: 'Yesterday — Daily (1 night)' },
      { value: REPORT_PERIODS.LAST_3_DAYS,   label: 'Last 3 Days — Twice a Week (3 nights)' },
      { value: REPORT_PERIODS.LAST_30_DAYS,  label: 'Last 30 Days — Monthly' },
      { value: REPORT_PERIODS.CUSTOM,        label: 'Custom Range' },
    ];
    return opts.map((o) => {
      const recommended =
        (freq === 1 && o.value === REPORT_PERIODS.YESTERDAY)    ||
        (freq === 3 && o.value === REPORT_PERIODS.LAST_3_DAYS)  ||
        (freq === 4 && o.value === REPORT_PERIODS.LAST_30_DAYS) ||
        (freq === 2 && o.value === REPORT_PERIODS.PREVIOUS_WEEK);
      return { ...o, label: recommended ? `★ ${o.label}` : o.label };
    });
  }, [schedules, reportForm.clientId, weekRangeInfo]);

  // ✅ FIX 19: when a client is selected in the manual report form and they
  // already have a saved schedule, default the shift picker to that
  // schedule's shift so the manual "send now" matches what they'd expect.
  useEffect(() => {
    if (!reportForm.clientId) return;
    const clientSchedule = schedules.find((s) => String(s.clientId) === String(reportForm.clientId));
    if (clientSchedule) {
      setReportForm((prev) => ({ ...prev, shiftType: normaliseReportShiftType(clientSchedule.shiftType) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportForm.clientId]);

  // ==========================================================================
  // RENDER
  // ==========================================================================
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center gap-3 py-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-600 rounded-lg"><Shield className="text-white" size={24} /></div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Security Reports Scheduler</h1>
                <p className="text-sm text-gray-500">Multi-Recipient · Day/Night Shift Scheduling · Patrol Schedule Management</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={toggleAutoRefresh}
                className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm transition-colors ${activePolling ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                {activePolling ? <><RefreshCw size={15} className="animate-spin" />Live</> : <><Pause size={15} />Paused</>}
              </button>
              <button onClick={toggleEmailSending}
                className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm transition-colors ${emailSendingEnabled ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-green-600 text-white hover:bg-green-700'}`}>
                {emailSendingEnabled ? <><BellOff size={15} />Disable Email</> : <><Bell size={15} />Enable Email</>}
              </button>
              <button onClick={() => { consecutiveFailures.current = 0; lastRefreshTime.current = 0; fetchAllData(); }} disabled={loading}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 flex items-center gap-2 text-sm">
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button onClick={openCreateModal}
                className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 text-sm">
                <Plus size={15} />New Schedule
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {success && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
            <CheckCircle className="text-green-600 shrink-0 mt-0.5" size={18} />
            <span className="text-green-800 text-sm font-medium">{success}</span>
          </div>
        )}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <XCircle className="text-red-600 shrink-0 mt-0.5" size={18} />
            <span className="text-red-800 text-sm font-medium">{error}</span>
          </div>
        )}

        {weekRangeInfo && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
            <Calendar className="text-blue-600 shrink-0" size={18} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-blue-900 font-semibold text-sm">Report Window:</span>
              <span className="text-blue-800 text-sm">
                {weekRangeInfo.label || formatDateRangeDisplay(weekRangeInfo.startDate, weekRangeInfo.endDate, null)}
              </span>
              {weekRangeInfo.shifts && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">{weekRangeInfo.shifts} shifts</span>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {stats.map((s) => <StatCard key={s.id} label={s.label} value={s.value} icon={s.icon} bgColor={s.bgColor} />)}
        </div>

        {/* Client info bar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Client Database</h3>
              <p className="text-xs text-gray-500">
                {clientsLoading ? 'Loading clients…' : `${allClients.length} clients loaded from /api/clients`}
                {' · '}{Object.values(patrolMap).filter((p) => p.HasCustomSchedule && p.PatrolsPerDay).length} with patrol schedules
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openPatrolModal()}
                className="px-3 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 flex items-center gap-2 text-sm">
                <Target size={14} />Set Patrol Schedule
              </button>
              <button onClick={() => { setAllClients([]); fetchAllClients().catch((e) => setError(e.message)); fetchPatrolSchedules(); }}
                disabled={clientsLoading}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 flex items-center gap-2 text-sm">
                <RefreshCw size={14} className={clientsLoading ? 'animate-spin' : ''} />
                {clientsLoading ? 'Loading…' : 'Refresh Clients'}
              </button>
            </div>
          </div>
        </div>

        {selectedSchedules.size > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Settings className="text-yellow-600 shrink-0" size={18} />
              <span className="font-medium text-yellow-900 text-sm">{selectedSchedules.size} schedule(s) selected</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={bulkResetNextRun}
                className="px-3 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center gap-2 text-sm">
                <RefreshCw size={14} />Reset Next Run
              </button>
              <button onClick={() => { setSelectedSchedules(new Set()); setShowBulkActions(false); }}
                className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Manual Report Generator */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-5 border-b border-gray-100 flex flex-wrap justify-between items-center gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Manual Report Generator</h2>
              <p className="text-xs text-gray-500 mt-0.5">Generate &amp; send patrol reports on demand</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={triggerBulkReports} disabled={loading}
                className="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-purple-400 flex items-center gap-2 text-sm">
                <Send size={14} />Run All Due
              </button>
              <button onClick={() => setShowManualReport((v) => !v)}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm">
                {showManualReport ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showManualReport ? 'Hide' : 'Manual Report'}
              </button>
            </div>
          </div>

          {showManualReport && (
            <div className="p-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Client * <span className="text-gray-400 font-normal">({allClients.length} available)</span>
                    </label>
                    {/* FIX: onChange receives (clientId, clientObject) — store clientId only */}
                    <ClientSearchDropdown allClients={allClients} value={reportForm.clientId}
                      onChange={(id) => setReportForm({ ...reportForm, clientId: id, reportPeriod: REPORT_PERIODS.PREVIOUS_WEEK })}
                      disabled={isSendingReport} placeholder="Search by name or account…" />
                    {reportForm.clientId && (() => {
                      const s = schedules.find((x) => String(x.clientId) === String(reportForm.clientId));
                      return s ? (
                        <p className="mt-1 text-xs text-blue-600">
                          Saved frequency: <strong>{FREQUENCY_LABELS[s.frequency] || 'Unknown'}</strong>
                          {' · '}shift: <strong>{shiftBadge(s.shiftType).label}</strong>{' — '}★ recommended period is pre-marked below
                        </p>
                      ) : null;
                    })()}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Report Period</label>
                    <select value={reportForm.reportPeriod} onChange={(e) => setReportForm({ ...reportForm, reportPeriod: e.target.value })}
                      disabled={isSendingReport}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100">
                      {reportPeriodOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  {/* ✅ FIX 19: shift picker for the manual/ad-hoc report */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Shift Type</label>
                    <select value={reportForm.shiftType} onChange={(e) => setReportForm({ ...reportForm, shiftType: e.target.value })}
                      disabled={isSendingReport}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100">
                      {REPORT_SHIFT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  {reportForm.reportPeriod === REPORT_PERIODS.CUSTOM && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                      <p className="text-xs text-amber-700 font-medium">Same weekday start &amp; end = 7 shifts</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Start</label>
                          <input type="date" value={reportForm.startDate} onChange={(e) => setReportForm({ ...reportForm, startDate: e.target.value })}
                            disabled={isSendingReport} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">End</label>
                          <input type="date" value={reportForm.endDate} onChange={(e) => setReportForm({ ...reportForm, endDate: e.target.value })}
                            disabled={isSendingReport} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Recipient Email(s) <span className="text-gray-400 font-normal">(optional — uses client email if blank)</span>
                    </label>
                    <textarea value={reportForm.recipientEmail} onChange={(e) => setReportForm({ ...reportForm, recipientEmail: e.target.value })}
                      placeholder="email@example.com, email2@example.com" disabled={isSendingReport} rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100" />
                  </div>

                  <button onClick={sendManualReport} disabled={!reportForm.clientId || isSendingReport}
                    className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium text-sm">
                    {isSendingReport ? <><RefreshCw size={15} className="animate-spin" />Generating…</> : <><Send size={15} />Generate &amp; Send Report</>}
                  </button>
                </div>

                <div className="bg-blue-50 p-5 rounded-lg">
                  <h3 className="font-semibold text-blue-900 mb-3 text-sm">✨ Report Features</h3>
                  <ul className="space-y-2 text-xs text-blue-800">
                    {[
                      ['Multiple Recipients',    'Comma, semicolon, or newline-separated'],
                      ['Custom Patrol Schedules','Set different patrols/day per client'],
                      ['Day / Night Schedules',  'Each client can have independent Day and Night report schedules'],
                      ['Frequency-aware Periods','★ marks the recommended period for each client'],
                      ['Duplicate Protection',   '2-minute cooldown per client+shift+range'],
                      ['PDF Generation',         'Attached automatically to every email, labeled by shift'],
                      ['Email Toggle',           `Currently ${emailSendingEnabled ? 'ENABLED ✅' : 'DISABLED ⛔'}`],
                      ['Bulk Trigger',           'Run All Due fires /trigger/dynamic-reports'],
                    ].map(([title, desc]) => (
                      <li key={title} className="flex items-start gap-2">
                        <CheckCircle className="text-green-500 mt-0.5 shrink-0" size={14} />
                        <span><strong>{title}:</strong> {desc}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 pt-3 border-t border-blue-200">
                    <p className="text-xs font-semibold text-blue-900 mb-2">Frequency → Report period:</p>
                    <ul className="space-y-1 text-xs text-blue-700">
                      <li>Daily (1) → Yesterday (1 shift)</li>
                      <li>Weekly (2) → Previous Week (7 shifts, backend window)</li>
                      <li>Twice a Week (3) → Last 3 Days (3 shifts)</li>
                      <li>Monthly (4) → Last 30 Days</li>
                      <li>Any → Custom Range (override)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Automated Schedules */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-5 border-b border-gray-100 flex flex-wrap justify-between items-center gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Automated Report Schedules</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {activePolling ? '● Live (30s)' : '○ Paused'} · {filteredSchedules.length} of {schedules.length} schedules
              </p>
            </div>
            <button onClick={() => setShowBulkActions((v) => !v)}
              className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm ${showBulkActions ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              <Settings size={14} />Bulk Actions
            </button>
          </div>

          <div className="p-5">
            <div className="mb-5 flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input type="text" placeholder="Search clients or emails…" value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="due">Due Now</option>
                <option value="scheduled">Scheduled</option>
                <option value="paused">Paused</option>
              </select>
              <button onClick={() => setSortConfig((prev) => ({ key: 'clientName', direction: prev.key === 'clientName' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm">
                {sortConfig.direction === 'asc' ? <ChevronUp size={15} /> : <ChevronDown size={15} />}Sort
              </button>
            </div>

            {showBulkActions && (
              <div className="mb-3 px-3 py-2 bg-gray-50 rounded-lg flex items-center gap-3">
                <input type="checkbox"
                  checked={selectedSchedules.size === filteredSchedules.length && filteredSchedules.length > 0}
                  onChange={selectAll} className="h-4 w-4 text-blue-600 rounded border-gray-300" />
                <span className="text-sm text-gray-600">
                  {selectedSchedules.size === 0 ? 'Select all' : `${selectedSchedules.size} selected`}
                </span>
              </div>
            )}

            {filteredSchedules.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="mx-auto mb-3 text-gray-300" size={48} />
                <p className="text-gray-500 text-sm">
                  {schedules.length === 0 ? 'No schedules yet. Click "New Schedule" to get started.' : 'No schedules match your search.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredSchedules.map((schedule, idx) => (
                  <ScheduleCard
                    key={schedule.id ?? `schedule-${idx}`}
                    schedule={schedule}
                    patrolData={patrolMap[String(schedule.clientId)] ?? null}
                    selected={selectedSchedules.has(schedule.id)}
                    showBulkActions={showBulkActions}
                    onSelect={toggleSelection} onSendQuick={sendQuickReport}
                    onAdvance={advanceSchedule} onPreview={viewPreview}
                    onPatrolSchedule={openPatrolModal} onToggleActive={toggleScheduleActive}
                    onEdit={openEditModal} onDelete={deleteSchedule}
                    isUpdating={!!updatingSchedules[schedule.id]}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Create / Edit Schedule Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">
                {modalMode === 'create' ? 'Create New Schedule' : `Edit — ${currentSchedule?.clientName}`}
              </h3>
              {modalMode === 'edit' && (
                <div className="mt-1"><ShiftBadge shiftType={currentSchedule?.shiftType} /></div>
              )}
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Client * <span className="text-gray-400 font-normal">({allClients.length} available)</span>
                </label>
                {modalMode === 'edit' ? (
                  <div className="px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-600">
                    {currentSchedule?.clientName || `Client ${currentSchedule?.clientId}`}
                    <span className="text-xs text-gray-400 ml-2">(ID: {currentSchedule?.clientId})</span>
                  </div>
                ) : (
                  /* FIX: onChange(id, _client) — store only the numeric id in formData.clientId */
                  <ClientSearchDropdown allClients={allClients} value={formData.clientId}
                    onChange={(id) => setFormData({ ...formData, clientId: id })}
                    placeholder="Search by name or account…" />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email Recipients * <span className="text-gray-400 font-normal">(multiple ok)</span>
                </label>
                <textarea value={formData.emails} onChange={(e) => setFormData({ ...formData, emails: e.target.value })}
                  placeholder="email1@example.com, email2@example.com" rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                <p className="mt-1 text-xs text-gray-400">Comma, semicolon, or newline-separated</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Frequency *</label>
                <select value={formData.frequency} onChange={(e) => setFormData({ ...formData, frequency: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                  {FREQUENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  {formData.frequency == 1 && "Daily → yesterday's data (1 shift)"}
                  {formData.frequency == 2 && 'Weekly → previous 7-shift window'}
                  {formData.frequency == 3 && 'Twice a week → last 3 shifts'}
                  {formData.frequency == 4 && 'Monthly → last 30 shifts'}
                </p>
              </div>

              {/* ✅ FIX 19: Shift Type selector — this is what unblocks having an
                  independent Day schedule and Night schedule for the same client.
                  The backend now scopes the duplicate check to (clientId, shiftType)
                  instead of clientId alone, so picking a different shift here than
                  an existing schedule creates a second, independent row. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Shift Type *</label>
                <select value={formData.shiftType} onChange={(e) => setFormData({ ...formData, shiftType: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                  {REPORT_SHIFT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  Lets you run separate Day and Night report schedules for the same client — each is tracked independently.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Report Period</label>
                <select value={formData.reportPeriod} onChange={(e) => setFormData({ ...formData, reportPeriod: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                  <option value={REPORT_PERIODS.PREVIOUS_WEEK}>Previous Week{weekRangeInfo?.label ? ` (${weekRangeInfo.label})` : ''}</option>
                  <option value={REPORT_PERIODS.LAST_7_DAYS}>Last 7 Days</option>
                  <option value={REPORT_PERIODS.YESTERDAY}>Yesterday — Daily (1 shift)</option>
                  <option value={REPORT_PERIODS.LAST_3_DAYS}>Last 3 Days — Twice a Week</option>
                  <option value={REPORT_PERIODS.LAST_30_DAYS}>Last 30 Days — Monthly</option>
                  <option value={REPORT_PERIODS.CUSTOM}>Custom Range</option>
                </select>
              </div>

              {formData.reportPeriod === REPORT_PERIODS.CUSTOM && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                  <p className="text-xs text-amber-700 font-medium">Same weekday for start &amp; end = 7-shift week</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
                      <input type="date" value={formData.customStartDate} onChange={(e) => setFormData({ ...formData, customStartDate: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
                      <input type="date" value={formData.customEndDate} onChange={(e) => setFormData({ ...formData, customEndDate: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Next Run *</label>
                <input type="datetime-local" value={formData.nextRun} onChange={(e) => setFormData({ ...formData, nextRun: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="isActive" checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300" />
                <label htmlFor="isActive" className="text-sm text-gray-700">Active schedule</label>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={closeModal} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">Cancel</button>
              <button onClick={modalMode === 'create' ? createSchedule : updateSchedule}
                disabled={!formData.clientId || !formData.emails || !formData.nextRun}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium">
                {modalMode === 'create' ? 'Create Schedule' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Patrol Schedule Modal */}
      {showPatrolModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">
                {currentPatrol ? `Edit Patrol — ${currentPatrol.name || `Client ${currentPatrol.id}`}` : 'Set Patrol Schedule'}
              </h3>
              <p className="text-xs text-gray-500 mt-1">Customize expected patrols per day for this client</p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Client *</label>
                {currentPatrol ? (
                  <div className="px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-600">
                    {currentPatrol.name || `Client ${currentPatrol.id}`}
                    <span className="text-xs text-gray-400 ml-2">(ID: {currentPatrol.id})</span>
                  </div>
                ) : (
                  <div ref={patrolSearchRef} className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                      <input type="text" value={patrolClientSearch}
                        onChange={(e) => { setPatrolClientSearch(e.target.value); setShowPatrolClientDropdown(true); if (!e.target.value) setPatrolForm((p) => ({ ...p, clientId: '', clientName: '' })); }}
                        onFocus={() => setShowPatrolClientDropdown(true)}
                        placeholder="Search by client name or account number…"
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" />
                    </div>
                    {showPatrolClientDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {filteredPatrolClients.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-500 text-center">No clients found</div>
                        ) : filteredPatrolClients.map((client) => {
                          const clientId   = getClientId(client);
                          const clientName = getClientName(client);
                          const clientAcct = getClientAcct(client);
                          const hasSchedule = patrolMap[String(clientId)]?.HasCustomSchedule;
                          return (
                            // FIX: key is always the numeric clientId
                            <button key={clientId} onClick={() => selectPatrolClient(client)}
                              className="w-full text-left px-4 py-2 hover:bg-teal-50 transition-colors border-b border-gray-100 last:border-0">
                              <div className="flex items-center justify-between">
                                <div className="font-medium text-sm text-gray-900">{clientName}</div>
                                {hasSchedule && <span className="text-xs text-teal-600 font-medium">configured</span>}
                              </div>
                              {clientAcct && <div className="text-xs text-gray-500">Account: {clientAcct}</div>}
                              {/* Show ID to disambiguate duplicate names */}
                              <div className="text-xs text-gray-400">ID: {clientId}</div>
                            </button>
                          );
                        })}
                        {allClients.length > 50 && !patrolClientSearch && (
                          <div className="px-4 py-2 text-xs text-gray-400 text-center border-t">
                            Type to search all {allClients.length} clients
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {patrolForm.clientId && !currentPatrol && (
                  <p className="mt-1 text-xs text-green-600">
                    Selected: {patrolForm.clientName || `Client ${patrolForm.clientId}`}
                    <span className="text-gray-400 ml-1">(ID: {patrolForm.clientId})</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Patrols Per Day (Weekdays)</label>
                <input type="number" min="0" max="50" value={patrolForm.patrolsPerDay}
                  onChange={(e) => setPatrolForm({ ...patrolForm, patrolsPerDay: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" />
                <p className="mt-1 text-xs text-gray-400">Expected patrols Monday–Friday</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Weekend Patrols (Sat &amp; Sun)</label>
                <input type="number" min="0" max="50" value={patrolForm.weekendPatrols}
                  onChange={(e) => setPatrolForm({ ...patrolForm, weekendPatrols: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" />
                <p className="mt-1 text-xs text-gray-400">Leave same as weekdays if no difference</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Active Patrol Days</label>
                <select value={patrolForm.patrolDays} onChange={(e) => setPatrolForm({ ...patrolForm, patrolDays: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500">
                  {PATROL_DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Shift Type</label>
                <select value={patrolForm.shiftType} onChange={(e) => setPatrolForm({ ...patrolForm, shiftType: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500">
                  {SHIFT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p className="mt-1 text-xs text-gray-400">This sets expected patrol counts per shift, separate from the report schedule's shift above.</p>
              </div>

              <div className="bg-teal-50 p-3 rounded-lg">
                <p className="text-xs text-teal-800 font-medium mb-1">Weekly Expected Patrols:</p>
                <p className="text-sm text-teal-900 font-bold">{patrolWeeklyPreview} patrols/week</p>
                <p className="text-xs text-teal-600 mt-1">
                  ({patrolForm.patrolsPerDay} × {patrolForm.patrolDays.split(',').filter((d) => d !== 'Sat' && d !== 'Sun').length} weekdays
                  + {patrolForm.weekendPatrols || patrolForm.patrolsPerDay} × {patrolForm.patrolDays.split(',').filter((d) => d === 'Sat' || d === 'Sun').length} weekend days)
                </p>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={closePatrolModal} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">Cancel</button>
              <button onClick={upsertPatrolSchedule} disabled={!patrolForm.clientId || loading}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium">
                {loading ? <RefreshCw size={16} className="animate-spin" /> : 'Save Patrol Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && previewData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-auto">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Analytics — {previewData.client?.name || 'Client'}</h3>
              <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600"><XCircle size={22} /></button>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div className="bg-blue-50 p-4 rounded-lg text-center">
                  <p className="text-xs text-blue-700 font-medium mb-1">Compliance Rate</p>
                  <p className="text-3xl font-bold text-blue-900">{previewData.analytics?.overallPerformance || 0}%</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg text-center">
                  <p className="text-xs text-green-700 font-medium mb-1">Patrols Completed</p>
                  <p className="text-3xl font-bold text-green-900">{previewData.analytics?.totalCompleted || 0}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[['Posts', previewData.analytics?.postsCount || 0], ['Events', previewData.analytics?.eventsCount || 0], ['Rating', previewData.analytics?.performanceRating || 'N/A']].map(([label, val]) => (
                  <div key={label} className="text-center bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">{label}</p>
                    <p className="text-xl font-bold text-gray-800">{val}</p>
                  </div>
                ))}
              </div>
              <div className="text-center">
                <button onClick={() => setShowPreview(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecurityReportsPage;