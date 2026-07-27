import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, Users, TrendingUp, Edit2, Trash2, Save, X, Download, Filter, Search, CheckCircle, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';

const API_BASE = 'http://localhost:5000/api';

// ✅ Canonical shift type values — must match backend VALID_SHIFT_TYPES
// There is NO default. Admin must select explicitly.
const SHIFT_OPTIONS = [
  { value: 'day',   label: 'Day Only (06:00 → 18:00)'   },
  { value: 'night', label: 'Night Only (18:00 → 06:00)'  },
  { value: 'both',  label: 'Day & Night (24h)'           },
];
const VALID_SHIFT_TYPES = SHIFT_OPTIONS.map(o => o.value);

const DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ✅ shiftType is '' (empty) by default — admin must pick explicitly
const EMPTY_FORM = {
  patrolsPerDay:      '',
  weekendPatrols:     '',
  patrolDays:         '',
  scheduleType:       'daily',
  customIntervalDays: null,
  shiftType:          '',   // NO default — form is invalid until admin selects
};

// ============================================================================
// AUTH HELPERS
// ============================================================================

function getAuthToken() {
  return (
    localStorage.getItem('authToken') ||
    localStorage.getItem('token')     ||
    sessionStorage.getItem('authToken') ||
    sessionStorage.getItem('token')   ||
    null
  );
}

async function authFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) throw new Error('Unauthorized — please log in again (401)');
  if (response.status === 403) throw new Error('Forbidden — admin access required (403)');
  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try { const body = await response.json(); msg = body.message || body.error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return response.json();
}

// ============================================================================
// UTILITIES
// ============================================================================

function validateForm(form) {
  const errors = {};
  const ppd = Number(form.patrolsPerDay);
  const wpd = Number(form.weekendPatrols);

  if (form.patrolsPerDay === '' || isNaN(ppd))  errors.patrolsPerDay  = 'Required';
  else if (ppd < 1 || ppd > 48)                 errors.patrolsPerDay  = 'Must be 1–48';

  if (form.weekendPatrols === '' || isNaN(wpd)) errors.weekendPatrols = 'Required';
  else if (wpd < 1 || wpd > 48)                 errors.weekendPatrols = 'Must be 1–48';

  if (!form.patrolDays || !form.patrolDays.trim()) errors.patrolDays  = 'Select at least one day';

  // ✅ shiftType is required — empty string or invalid value is an error
  if (!form.shiftType || !VALID_SHIFT_TYPES.includes(form.shiftType))
    errors.shiftType = 'Select a shift type (Day Only, Night Only, or Day & Night)';

  return errors;
}

function computeWeeklyTotal(form) {
  const days     = form.patrolDays ? form.patrolDays.split(',').filter(Boolean) : [];
  const weekdays = days.filter(d => !['Sat', 'Sun'].includes(d)).length;
  const weekend  = days.filter(d =>  ['Sat', 'Sun'].includes(d)).length;
  return weekdays * (Number(form.patrolsPerDay) || 0)
       + weekend  * (Number(form.weekendPatrols) || 0);
}

// ✅ Normalise shiftType from server.
// Returns null for missing/unknown — means "not configured", displayed as a warning.
function normaliseShiftType(raw) {
  if (!raw) return null;
  const lower = String(raw).toLowerCase().trim();
  if (lower === 'day'   || lower === 'day only'   || lower === 'day shift only'   || lower === 'dayshift')   return 'day';
  if (lower === 'night' || lower === 'night only' || lower === 'night shift only' || lower === 'nightshift') return 'night';
  if (lower === 'both'  || lower === 'day/night'  || lower === 'daynightshift'    || lower === '24/7')        return 'both';
  return null;   // unrecognised — treat as not configured
}

// Human-readable label for display
function shiftLabel(value) {
  if (!value) return null;
  return SHIFT_OPTIONS.find(o => o.value === value)?.label ?? null;
}

function normaliseClient(c) {
  return {
    ClientID:           c.ClientID          ?? c.id             ?? 0,
    ClientName:         c.ClientName        ?? c.name           ?? 'Unknown',
    PatrolsPerDay:      c.PatrolsPerDay     ?? c.patrolsPerDay  ?? null,
    WeekendPatrols:     c.WeekendPatrols    ?? c.weekendPatrols ?? null,
    PatrolDays:         c.PatrolDays        ?? c.patrolDays     ?? '',
    ScheduleType:       c.ScheduleType      ?? c.scheduleType   ?? 'daily',
    CustomIntervalDays: c.CustomIntervalDays ?? c.customIntervalDays ?? null,
    // ✅ normaliseShiftType returns null if not configured — never defaults to 'both'
    ShiftType:          normaliseShiftType(c.ShiftType ?? c.shiftType),
    WeeklyTotal:        c.WeeklyTotal       ?? c.weeklyTotal    ?? null,
    HasCustomSchedule:  c.HasCustomSchedule ?? c.hasCustomSchedule ?? false,
    IsActive:           c.IsActive          ?? c.isActive       ?? true,
    accountNumber:      c.AccountNumber     ?? c.accountNumber  ?? c.cue_ccliente ?? '',
  };
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const Badge = ({ children, color = 'gray' }) => {
  const palette = {
    green:  'bg-green-100  text-green-800',
    red:    'bg-red-100    text-red-800',
    purple: 'bg-purple-100 text-purple-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    blue:   'bg-blue-100   text-blue-800',
    gray:   'bg-gray-100   text-gray-700',
    orange: 'bg-orange-100 text-orange-800',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${palette[color] ?? palette.gray}`}>
      {children}
    </span>
  );
};

const DayPicker = ({ value, onChange, error }) => {
  const selected = value ? value.split(',').map(d => d.trim()).filter(Boolean) : [];
  const toggle   = (day) => {
    const next = selected.includes(day)
      ? selected.filter(d => d !== day)
      : [...selected, day];
    onChange(next.join(','));
  };
  return (
    <div>
      <div className="flex gap-1 flex-wrap">
        {DAY_OPTIONS.map(day => (
          <button key={day} type="button" onClick={() => toggle(day)}
            className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
              selected.includes(day)
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
            }`}>
            {day}
          </button>
        ))}
      </div>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
};

const NumInput = ({ value, onChange, error, placeholder = '—' }) => (
  <div>
    <input
      type="number" min="1" max="48"
      value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-20 px-2 py-1 border rounded text-sm text-center ${
        error ? 'border-red-400 bg-red-50' : 'border-gray-300'
      } focus:outline-none focus:ring-2 focus:ring-blue-400`}
    />
    {error && <p className="text-red-500 text-xs mt-0.5">{error}</p>}
  </div>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const PatrolScheduleManager = () => {
  const [allClients,      setAllClients]      = useState([]);
  const [filteredClients, setFilteredClients] = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [isRefreshing,    setIsRefreshing]    = useState(false);
  const [searchTerm,      setSearchTerm]      = useState('');
  const [filterStatus,    setFilterStatus]    = useState('all');
  const [editingClient,   setEditingClient]   = useState(null);
  const [formData,        setFormData]        = useState(EMPTY_FORM);
  const [formErrors,      setFormErrors]      = useState({});
  const [notification,    setNotification]    = useState(null);
  const [performanceData, setPerformanceData] = useState(null);
  const [viewMode,        setViewMode]        = useState('list');
  const [performanceDays, setPerformanceDays] = useState(7);

  // ── Notification ─────────────────────────────────────────────────────────
  const showNotification = useCallback((message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  // ── Filter ────────────────────────────────────────────────────────────────
  const applyFilters = useCallback((query, status, list) => {
    let result = [...(list || [])];
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(c =>
        (c.ClientName || '').toLowerCase().includes(q) ||
        String(c.ClientID).includes(q)                 ||
        String(c.accountNumber || '').includes(q)
      );
    }
    if      (status === 'active')       result = result.filter(c =>  c.IsActive);
    else if (status === 'inactive')     result = result.filter(c => !c.IsActive);
    else if (status === 'custom')       result = result.filter(c =>  c.HasCustomSchedule);
    else if (status === 'default')      result = result.filter(c => !c.HasCustomSchedule);
    else if (status === 'unconfigured') result = result.filter(c => !c.HasCustomSchedule || !c.PatrolsPerDay || !c.ShiftType);
    setFilteredClients(result);
  }, []);

  useEffect(() => {
    applyFilters(searchTerm, filterStatus, allClients);
  }, [searchTerm, filterStatus, allClients, applyFilters]);

  // ── Fetch all clients ─────────────────────────────────────────────────────
  const fetchAllClients = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setIsRefreshing(true);
    try {
      const data = await authFetch(`${API_BASE}/patrol-schedules`);
      const raw  = Array.isArray(data)
        ? data
        : data.data && Array.isArray(data.data.clients) ? data.data.clients
        : Array.isArray(data.clients) ? data.clients
        : Array.isArray(data.data)    ? data.data
        : [];
      const transformed = raw.map(normaliseClient);
      setAllClients(transformed);
      showNotification(`Loaded ${transformed.length} clients`, 'success');
    } catch (err) {
      const isAuthError = err.message.includes('401') || err.message.includes('403');
      showNotification(
        isAuthError
          ? `Auth error: ${err.message}`
          : `Failed to load clients: ${err.message}`,
        'error'
      );
      setAllClients([]);
      setFilteredClients([]);
    } finally {
      if (showSpinner) setLoading(false);
      setIsRefreshing(false);
    }
  }, [showNotification]);

  useEffect(() => { fetchAllClients(true); }, [fetchAllClients]);

  // ── Edit ──────────────────────────────────────────────────────────────────
  const handleEdit = (client) => {
    setEditingClient(client.ClientID);
    setFormErrors({});
    setFormData({
      patrolsPerDay:      client.PatrolsPerDay      ?? '',
      weekendPatrols:     client.WeekendPatrols      ?? '',
      patrolDays:         client.PatrolDays          || '',
      scheduleType:       client.ScheduleType        || 'daily',
      customIntervalDays: client.CustomIntervalDays  || null,
      // ✅ Use stored value if valid, otherwise '' — forces admin to pick explicitly
      shiftType:          VALID_SHIFT_TYPES.includes(client.ShiftType) ? client.ShiftType : '',
    });
  };

  const handleCancel = () => {
    setEditingClient(null);
    setFormData(EMPTY_FORM);
    setFormErrors({});
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async (clientId) => {
    const errors = validateForm(formData);
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }

    try {
      const payload = {
        ...formData,
        patrolsPerDay:  parseInt(formData.patrolsPerDay,  10),
        weekendPatrols: parseInt(formData.weekendPatrols, 10),
        // shiftType is already validated as 'day' | 'night' | 'both' by validateForm
      };

      const result = await authFetch(`${API_BASE}/patrol-schedules/${clientId}`, {
        method: 'POST',
        body:   JSON.stringify(payload),
      });

      if (result.success) {
        setAllClients(prev => prev.map(c => {
          if (c.ClientID !== clientId) return c;
          const ppd      = payload.patrolsPerDay;
          const wpd      = payload.weekendPatrols;
          const days     = payload.patrolDays ? payload.patrolDays.split(',').filter(Boolean) : [];
          const weekdays = days.filter(d => !['Sat','Sun'].includes(d)).length;
          const weekend  = days.filter(d =>  ['Sat','Sun'].includes(d)).length;
          return {
            ...c,
            PatrolsPerDay:     ppd,
            WeekendPatrols:    wpd,
            PatrolDays:        payload.patrolDays,
            ScheduleType:      payload.scheduleType,
            ShiftType:         payload.shiftType,   // already 'day' | 'night' | 'both'
            WeeklyTotal:       weekdays * ppd + weekend * wpd,
            HasCustomSchedule: true,
          };
        }));
        showNotification('Schedule saved successfully', 'success');
        handleCancel();
        fetchAllClients(false);
      } else {
        showNotification(result.message || 'Save failed', 'error');
      }
    } catch (err) {
      showNotification(`Error saving: ${err.message}`, 'error');
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (clientId, clientName) => {
    if (!window.confirm(`Delete custom schedule for "${clientName}"?\n\nThis client will show as "Not Configured" and reports will fail until a new schedule is set.`)) return;
    try {
      const result = await authFetch(`${API_BASE}/patrol-schedules/${clientId}`, { method: 'DELETE' });
      if (result.success) {
        setAllClients(prev => prev.map(c =>
          c.ClientID !== clientId ? c : {
            ...c,
            PatrolsPerDay:     null,
            WeekendPatrols:    null,
            PatrolDays:        '',
            ShiftType:         null,   // ✅ null — not configured, no silent default
            WeeklyTotal:       null,
            HasCustomSchedule: false,
          }
        ));
        showNotification('Schedule deleted — client is now unconfigured', 'success');
        fetchAllClients(false);
      } else {
        showNotification(result.message || 'Delete failed', 'error');
      }
    } catch (err) {
      showNotification(`Error deleting: ${err.message}`, 'error');
    }
  };

  // ── Performance ────────────────────────────────────────────────────────────
  const fetchPerformanceData = useCallback(async (days = performanceDays) => {
    try {
      setLoading(true);
      const result = await authFetch(`${API_BASE}/patrol-schedules/performance?days=${days}`);
      if (result.success) setPerformanceData(result.data);
      else showNotification(result.message || 'Failed to load performance', 'error');
    } catch (err) {
      showNotification(`Performance error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [performanceDays, showNotification]);

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportToCSV = () => {
    const headers = [
      'Client ID','Client Name','Patrols/Day (Weekday)','Patrols/Day (Weekend)',
      'Patrol Days','Shift Type','Weekly Total','Configured','Account','Status',
    ];
    const rows = filteredClients.map(c => [
      c.ClientID, c.ClientName,
      c.PatrolsPerDay   ?? 'NOT SET',
      c.WeekendPatrols  ?? 'NOT SET',
      c.PatrolDays      || 'NOT SET',
      c.ShiftType ? (shiftLabel(c.ShiftType) ?? c.ShiftType) : 'NOT SET',
      c.WeeklyTotal     ?? 'NOT SET',
      c.HasCustomSchedule ? 'Yes' : 'No',
      c.accountNumber   || '',
      c.IsActive ? 'Active' : 'Inactive',
    ]);
    const csv  = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `patrol-schedules-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  // A client is "fully configured" only when it has both patrolsPerDay AND shiftType set
  const stats = {
    total:        allClients.length,
    active:       allClients.filter(c =>  c.IsActive).length,
    configured:   allClients.filter(c =>  c.HasCustomSchedule && c.PatrolsPerDay && c.ShiftType).length,
    unconfigured: allClients.filter(c => !c.HasCustomSchedule || !c.PatrolsPerDay || !c.ShiftType).length,
  };

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (loading && allClients.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600 font-medium">Loading patrol schedules…</p>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="w-7 h-7 text-blue-600" />
              Patrol Schedule Manager
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Configure required patrols per client — shift type is required</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const next = viewMode === 'list' ? 'performance' : 'list';
                setViewMode(next);
                if (next === 'performance') fetchPerformanceData();
              }}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm flex items-center gap-2"
            >
              <TrendingUp className="w-4 h-4" />
              {viewMode === 'list' ? 'Performance' : 'Schedules'}
            </button>
            <button
              onClick={exportToCSV}
              disabled={filteredClients.length === 0}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export ({filteredClients.length})
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-lg shadow-lg flex items-center gap-2 text-white text-sm font-medium max-w-md ${
          notification.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}>
          {notification.type === 'success'
            ? <CheckCircle className="w-4 h-4 shrink-0" />
            : <XCircle    className="w-4 h-4 shrink-0" />}
          <span>{notification.message}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Clients',  value: stats.total,        icon: Users,         color: 'blue'   },
            { label: 'Active',         value: stats.active,       icon: CheckCircle,   color: 'green'  },
            { label: 'Fully Configured', value: stats.configured, icon: Calendar,      color: 'purple',
              sub: `${stats.total > 0 ? Math.round(stats.configured / stats.total * 100) : 0}% of total` },
            { label: 'Not Configured', value: stats.unconfigured, icon: AlertTriangle, color: 'yellow',
              sub: 'Missing patrols/day or shift type' },
          ].map(({ label, value, icon: Icon, color, sub }) => (
            <div key={label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
                <p className={`text-2xl font-bold mt-1 text-${color}-600`}>{value}</p>
                {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
              </div>
              <Icon className={`w-9 h-9 text-${color}-200`} />
            </div>
          ))}
        </div>

        {/* Unconfigured alert */}
        {stats.unconfigured > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                {stats.unconfigured} client{stats.unconfigured !== 1 ? 's' : ''} are missing patrol configuration
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Reports for unconfigured clients will fail immediately. Both <strong>Patrols/Day</strong> and <strong>Shift Type</strong> are required.
              </p>
            </div>
            <button
              onClick={() => setFilterStatus('unconfigured')}
              className="ml-auto text-xs text-amber-700 underline hover:text-amber-900 whitespace-nowrap"
            >
              Show unconfigured
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text" placeholder="Search by name, ID or account…"
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400 shrink-0" />
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none">
                <option value="all">All ({allClients.length})</option>
                <option value="active">Active ({stats.active})</option>
                <option value="inactive">Inactive ({allClients.length - stats.active})</option>
                <option value="configured">Configured ({stats.configured})</option>
                <option value="unconfigured">Not Configured ({stats.unconfigured})</option>
              </select>
            </div>

            <button
              onClick={() => { setSearchTerm(''); fetchAllClients(true); }}
              disabled={isRefreshing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 text-sm flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <p className="text-xs text-gray-400">
            Showing <span className="font-semibold text-gray-600">{filteredClients.length}</span> of {allClients.length} clients
            {(searchTerm || filterStatus !== 'all') && (
              <button onClick={() => { setSearchTerm(''); setFilterStatus('all'); }}
                className="ml-2 text-blue-500 hover:underline">
                Clear filters
              </button>
            )}
          </p>
        </div>

        {/* Main content */}
        {viewMode === 'list' ? (

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {filteredClients.length === 0 ? (
              <div className="py-20 text-center">
                <Calendar className="mx-auto w-12 h-12 text-gray-300 mb-3" />
                <p className="text-gray-500 text-sm">
                  {allClients.length === 0
                    ? 'No clients loaded — check backend connection or authentication.'
                    : 'No clients match your filters.'}
                </p>
                <button onClick={() => { setSearchTerm(''); setFilterStatus('all'); }}
                  className="mt-3 text-sm text-blue-600 hover:underline">
                  Clear filters
                </button>
              </div>
            ) : (
              <>
                <div className="px-6 py-3 bg-gray-50 border-b flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {filteredClients.length} client{filteredClients.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs text-gray-400">Scroll right for all columns →</span>
                </div>

                <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0 z-10">
                      <tr>
                        {['Client','Patrols / Weekday','Patrols / Weekend','Active Days','Shift Type','Weekly Total','Account','Status','Actions'].map(h => (
                          <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-100">
                      {filteredClients.map(client => {
                        const isEditing        = editingClient === client.ClientID;
                        const missingPatrols   = !client.PatrolsPerDay;
                        const missingShiftType = !client.ShiftType;
                        const isUnconfigured   = !client.HasCustomSchedule || missingPatrols || missingShiftType;

                        return (
                          <tr key={client.ClientID}
                            className={isEditing ? 'bg-blue-50' : isUnconfigured ? 'bg-amber-50/40' : 'hover:bg-gray-50'}>

                            {/* Client name */}
                            <td className="px-5 py-3 whitespace-nowrap">
                              <div className="font-medium text-gray-900">{client.ClientName}</div>
                              <div className="text-gray-400 text-xs">ID: {client.ClientID}</div>
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {client.HasCustomSchedule && <Badge color="purple">Custom</Badge>}
                                {missingPatrols   && <Badge color="yellow">⚠ No patrol count</Badge>}
                                {missingShiftType && <Badge color="orange">⚠ No shift type</Badge>}
                              </div>
                            </td>

                            {/* Weekday patrols */}
                            <td className="px-5 py-3">
                              {isEditing ? (
                                <NumInput
                                  value={formData.patrolsPerDay}
                                  onChange={v => { setFormData(f => ({ ...f, patrolsPerDay: v })); setFormErrors(e => ({ ...e, patrolsPerDay: '' })); }}
                                  error={formErrors.patrolsPerDay} placeholder="e.g. 4"
                                />
                              ) : (
                                <span className={client.PatrolsPerDay ? 'font-semibold text-gray-800' : 'text-amber-500 font-medium'}>
                                  {client.PatrolsPerDay ?? '— not set'}
                                </span>
                              )}
                            </td>

                            {/* Weekend patrols */}
                            <td className="px-5 py-3">
                              {isEditing ? (
                                <NumInput
                                  value={formData.weekendPatrols}
                                  onChange={v => { setFormData(f => ({ ...f, weekendPatrols: v })); setFormErrors(e => ({ ...e, weekendPatrols: '' })); }}
                                  error={formErrors.weekendPatrols} placeholder="e.g. 3"
                                />
                              ) : (
                                <span className={client.WeekendPatrols ? 'font-semibold text-gray-800' : 'text-amber-500 font-medium'}>
                                  {client.WeekendPatrols ?? '— not set'}
                                </span>
                              )}
                            </td>

                            {/* Active days */}
                            <td className="px-5 py-3">
                              {isEditing ? (
                                <DayPicker
                                  value={formData.patrolDays}
                                  onChange={v => { setFormData(f => ({ ...f, patrolDays: v })); setFormErrors(e => ({ ...e, patrolDays: '' })); }}
                                  error={formErrors.patrolDays}
                                />
                              ) : (
                                <span className={client.PatrolDays ? 'text-gray-700' : 'text-amber-500'}>
                                  {client.PatrolDays || '— not set'}
                                </span>
                              )}
                            </td>

                            {/* Shift type */}
                            <td className="px-5 py-3">
                              {isEditing ? (
                                <div>
                                  <select
                                    value={formData.shiftType}
                                    onChange={e => { setFormData(f => ({ ...f, shiftType: e.target.value })); setFormErrors(er => ({ ...er, shiftType: '' })); }}
                                    className={`px-2 py-1 border rounded text-sm ${
                                      formErrors.shiftType ? 'border-red-400 bg-red-50' : 'border-gray-300'
                                    } focus:outline-none focus:ring-2 focus:ring-blue-400`}
                                  >
                                    {/* ✅ Placeholder forces an explicit choice — no value defaults */}
                                    <option value="">— select shift type —</option>
                                    {SHIFT_OPTIONS.map(({ value, label }) => (
                                      <option key={value} value={value}>{label}</option>
                                    ))}
                                  </select>
                                  {formErrors.shiftType && (
                                    <p className="text-red-500 text-xs mt-0.5">{formErrors.shiftType}</p>
                                  )}
                                </div>
                              ) : (
                                // ✅ null ShiftType shown as a warning badge, not silently hidden
                                client.ShiftType ? (
                                  <span className="text-gray-700">{shiftLabel(client.ShiftType)}</span>
                                ) : (
                                  <Badge color="orange">⚠ Not set</Badge>
                                )
                              )}
                            </td>

                            {/* Weekly total */}
                            <td className="px-5 py-3 text-center">
                              {isEditing ? (
                                <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold">
                                  {computeWeeklyTotal(formData) || '—'}
                                </span>
                              ) : (
                                <span className={client.WeeklyTotal ? 'font-bold text-gray-800' : 'text-amber-500'}>
                                  {client.WeeklyTotal ?? '—'}
                                </span>
                              )}
                            </td>

                            {/* Account */}
                            <td className="px-5 py-3 text-gray-500 text-xs">{client.accountNumber || '—'}</td>

                            {/* Status */}
                            <td className="px-5 py-3">
                              <Badge color={client.IsActive ? 'green' : 'red'}>
                                {client.IsActive ? 'Active' : 'Inactive'}
                              </Badge>
                            </td>

                            {/* Actions */}
                            <td className="px-5 py-3">
                              {isEditing ? (
                                <div className="flex gap-2">
                                  <button onClick={() => handleSave(client.ClientID)} className="text-green-600 hover:text-green-800" title="Save">
                                    <Save className="w-5 h-5" />
                                  </button>
                                  <button onClick={handleCancel} className="text-gray-500 hover:text-gray-700" title="Cancel">
                                    <X className="w-5 h-5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex gap-2">
                                  <button onClick={() => handleEdit(client)} className="text-blue-600 hover:text-blue-800" title="Configure">
                                    <Edit2 className="w-5 h-5" />
                                  </button>
                                  {client.HasCustomSchedule && (
                                    <button onClick={() => handleDelete(client.ClientID, client.ClientName)}
                                      className="text-red-500 hover:text-red-700" title="Remove schedule">
                                      <Trash2 className="w-5 h-5" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

        ) : (
          /* Performance view */
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Client Performance</h2>
              <div className="flex gap-2">
                <select
                  value={performanceDays}
                  onChange={e => { const d = parseInt(e.target.value); setPerformanceDays(d); fetchPerformanceData(d); }}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </select>
                <button onClick={() => fetchPerformanceData()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                  Refresh
                </button>
              </div>
            </div>

            {performanceData ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {performanceData.clients?.map(client => {
                  const p = client.performance || {};
                  const colorMap = { Excellent: 'green', Good: 'blue', Fair: 'yellow' };
                  return (
                    <div key={client.ClientID} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="font-semibold text-gray-900">{client.ClientName}</h3>
                          <p className="text-xs text-gray-400">ID: {client.ClientID}</p>
                        </div>
                        <Badge color={colorMap[p.performance] || 'red'}>{p.performance || 'N/A'}</Badge>
                      </div>
                      <div className="space-y-2 text-sm">
                        {[
                          ['Compliance', p.complianceRate],
                          ['Expected',   p.expectedPatrols],
                          ['Actual',     p.actualPatrols],
                          ['Daily avg',  p.dailyAverage],
                          ['Zones',      p.zonesCovered],
                        ].map(([label, val]) => (
                          <div key={label} className="flex justify-between">
                            <span className="text-gray-500">{label}</span>
                            <span className="font-medium text-gray-800">{val ?? '—'}</span>
                          </div>
                        ))}
                      </div>
                      {client.ScheduleInfo && (
                        <p className="text-xs text-gray-400 mt-3 pt-3 border-t">{client.ScheduleInfo}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto" />
                  <p className="text-gray-500 text-sm mt-3">Loading performance data…</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PatrolScheduleManager;