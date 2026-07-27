import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, Search, CheckCircle, XCircle, AlertTriangle, Loader,
  Download, RefreshCw, Shield, UserPlus, Building2, Mail, Hash,
  ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Key, Trash2,
} from 'lucide-react';

const API_BASE = '/api';

function authHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json',
  };
}

function StatusBadge({ isActive }) {
  return isActive ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">
      <CheckCircle className="w-3 h-3" /> Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-100 text-red-800 text-xs font-semibold rounded-full">
      <XCircle className="w-3 h-3" /> Inactive
    </span>
  );
}

function StatCard({ icon, label, value, color }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
      <div className={`inline-flex p-2 rounded-lg mb-4 ${color}`}>{icon}</div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
    </div>
  );
}

function DeleteModal({ user, onConfirm, onCancel, loading }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-100 rounded-xl">
            <Trash2 className="w-5 h-5 text-red-600" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Delete User</h2>
        </div>
        <p className="text-sm text-gray-600 mb-2">Are you sure you want to permanently delete:</p>
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-4">
          <p className="font-semibold text-gray-900">{user.username}</p>
          {user.email && <p className="text-xs text-gray-500 mt-0.5">{user.email}</p>}
          {user.accountName && (
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              <Building2 className="w-3 h-3" /> {user.accountName}
            </p>
          )}
        </div>
        <p className="text-xs text-red-600 mb-5 font-medium">
          ⚠ This action is permanent and cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 text-sm font-medium transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 text-sm font-medium transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// Deduplicate an array of users by id, keeping the first occurrence
function dedupeUsers(arr) {
  const seen = new Set();
  return arr.filter(u => {
    const key = u.id ?? JSON.stringify(u);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function AdminDashboard() {
  const [users,         setUsers]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [deleteTarget,  setDeleteTarget]  = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [error,         setError]         = useState(null);
  const [successMsg,    setSuccessMsg]    = useState(null);
  const [searchTerm,   setSearchTerm]   = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [expandedRow,  setExpandedRow]  = useState(null);
  const [page,         setPage]         = useState(1);
  const limit = 50;
  const fetchedOnce = useRef(false);

  const flash = useCallback((msg, isError = false) => {
    if (isError) {
      setError(msg);
      setTimeout(() => setError(null), 5000);
    } else {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(null), 4000);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page, limit });
      if (searchTerm.trim()) params.set('search', searchTerm.trim());
      const res = await fetch(`${API_BASE}/auth/admin/users?${params}`, { headers: authHeaders() });
      if (res.status === 401) { flash('Session expired. Please log in again.', true); return; }
      if (res.status === 403) { flash('Access denied. Admin privileges required.', true); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const raw = Array.isArray(data) ? data : (data.users ?? []);
      setUsers(dedupeUsers(raw));
    } catch (err) {
      flash('Failed to load users. Please try again.', true);
      console.error('[AdminDashboard] loadUsers error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, searchTerm, flash]);

  useEffect(() => {
    if (fetchedOnce.current) return;
    fetchedOnce.current = true;
    loadUsers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!fetchedOnce.current) return;
    loadUsers();
  }, [loadUsers]);

  const norm = (u) => ({
    id:            u.id,
    username:      u.username      || '—',
    email:         u.email         || null,
    accountName:   u.accountName   || null,
    accountId:     u.accountId     || null,
    accountNumber: u.accountNumber || null,
    role:          u.role          || null,
    tipo:          u.tipo,
    isActive:      u.isActive      ?? true,
    mustChange:    u.mustChangePassword ?? false,
    raw: u,
  });

  const toggleActive = async (u) => {
    const action = u.isActive ? 'deactivate' : 'reactivate';
    if (!window.confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} "${u.username}"?`)) return;
    setActionLoading(u.id);
    try {
      const res  = await fetch(`${API_BASE}/auth/admin/users/${u.id}`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify({ isActive: !u.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Update failed');
      setUsers(prev => prev.map(usr => usr.id === u.id ? { ...usr, isActive: !u.isActive } : usr));
      flash(data.message || `User ${action}d successfully.`);
    } catch (err) {
      flash(err.message, true);
    } finally {
      setActionLoading(null);
    }
  };

  const resendCredentials = async (u) => {
    if (!u.email) { flash('No email address on record for this user.', true); return; }
    if (!window.confirm(`Resend login credentials to "${u.username}" at ${u.email}?`)) return;
    setActionLoading(u.id);
    try {
      const res  = await fetch(`${API_BASE}/auth/admin/users/${u.id}/resend-credentials`, {
        method: 'POST', headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to resend');
      flash(data.message || 'Credentials resent successfully.');
    } catch (err) {
      flash(err.message, true);
    } finally {
      setActionLoading(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/auth/admin/users/${deleteTarget.id}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Delete failed');
      flash(data.message || `User "${deleteTarget.username}" deleted.`);
      setDeleteTarget(null);
      setExpandedRow(null);
      setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
    } catch (err) {
      flash(err.message, true);
    } finally {
      setDeleteLoading(false);
    }
  };

  const exportCSV = () => {
    const rows = [
      ['Username', 'Email', 'Role', 'Client Account', 'Account ID', 'Active'],
      ...filteredUsers.map(u => [
        u.username, u.email || '', u.role || '',
        u.accountName || '', u.accountId || '',
        u.isActive ? 'Yes' : 'No',
      ]),
    ];
    const csv  = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const link = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: `portal-users-${new Date().toISOString().split('T')[0]}.csv`,
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const filteredUsers = users.map(norm).filter(u => {
    const term = searchTerm.toLowerCase();
    const matchSearch =
      u.username.toLowerCase().includes(term) ||
      (u.email       || '').toLowerCase().includes(term) ||
      (u.accountName || '').toLowerCase().includes(term);
    const matchFilter =
      activeFilter === 'all'      ? true :
      activeFilter === 'active'   ? u.isActive  :
      activeFilter === 'inactive' ? !u.isActive : true;
    return matchSearch && matchFilter;
  });

  const normalised = users.map(norm);
  const stats = {
    total:      normalised.length,
    active:     normalised.filter(u =>  u.isActive).length,
    inactive:   normalised.filter(u => !u.isActive).length,
    mustChange: normalised.filter(u =>  u.mustChange).length,
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">

        {/* Page header */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-xl">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
              <p className="text-sm text-gray-500">Manage portal user accounts</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => loadUsers()}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 text-sm font-medium transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              onClick={() => window.location.href = '/admin/create-user'}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition"
            >
              <UserPlus className="w-4 h-4" /> Create User
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <p className="text-red-800 text-sm flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
            <p className="text-green-800 text-sm flex-1">{successMsg}</p>
            <button onClick={() => setSuccessMsg(null)} className="text-green-400 hover:text-green-600 text-lg leading-none">×</button>
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard icon={<Users       className="w-5 h-5 text-blue-600"  />} label="Total Users"        value={stats.total}      color="bg-blue-50"  />
          <StatCard icon={<CheckCircle className="w-5 h-5 text-green-600" />} label="Active"             value={stats.active}     color="bg-green-50" />
          <StatCard icon={<XCircle     className="w-5 h-5 text-red-600"   />} label="Inactive"           value={stats.inactive}   color="bg-red-50"   />
          <StatCard icon={<Key         className="w-5 h-5 text-amber-600" />} label="Awaiting Pw Change" value={stats.mustChange} color="bg-amber-50" />
        </div>

        {/* Search / filter bar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-56">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
                  placeholder="Username, email, or account name…"
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Status</label>
              <select
                value={activeFilter}
                onChange={e => setActiveFilter(e.target.value)}
                className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <button
              onClick={exportCSV}
              disabled={!filteredUsers.length}
              className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium transition disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
        </div>

        {/* Users table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">
              Portal Users
              <span className="ml-2 text-sm text-gray-400 font-normal">
                {filteredUsers.length} of {users.length}
              </span>
            </h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-20 text-center">
              <Users className="w-12 h-12 text-gray-200 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">No users found</p>
              <button
                onClick={() => window.location.href = '/admin/create-user'}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition"
              >
                <UserPlus className="w-4 h-4" /> Create First User
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
                  <tr>
                    <th className="px-6 py-3 text-left">Username</th>
                    <th className="px-6 py-3 text-left">Email</th>
                    <th className="px-6 py-3 text-left">Client Account</th>
                    <th className="px-6 py-3 text-left">Status</th>
                    <th className="px-6 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredUsers.map((u, idx) => (
                    <React.Fragment key={`row-${u.id ?? idx}`}>
                      <tr
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => setExpandedRow(expandedRow === u.id ? null : u.id)}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs flex-shrink-0">
                              {u.username[0]?.toUpperCase() ?? '?'}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{u.username}</p>
                              {u.role === 'admin' && (
                                <span className="text-xs text-purple-600 font-semibold">Admin</span>
                              )}
                              {u.mustChange && (
                                <span className="block text-xs text-amber-600 font-medium">
                                  <Key className="w-3 h-3 inline mr-0.5" />Pw change pending
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          {u.email ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-6 py-4">
                          {u.accountName ? (
                            <div className="flex items-center gap-2">
                              <Building2 className="w-4 h-4 text-gray-300 shrink-0" />
                              <div>
                                <p className="font-medium text-gray-800 text-sm">{u.accountName}</p>
                                {u.accountId && (
                                  <p className="text-xs text-gray-400 font-mono">ID {u.accountId}</p>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge isActive={u.isActive} />
                        </td>
                        <td className="px-6 py-4" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => toggleActive(u)}
                              disabled={actionLoading === u.id}
                              title={u.isActive ? 'Deactivate' : 'Activate'}
                              className={`p-1.5 rounded-lg transition ${
                                u.isActive ? 'text-red-500 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'
                              } disabled:opacity-40`}
                            >
                              {actionLoading === u.id
                                ? <Loader className="w-4 h-4 animate-spin" />
                                : u.isActive
                                  ? <ToggleRight className="w-5 h-5" />
                                  : <ToggleLeft  className="w-5 h-5" />}
                            </button>
                            {u.email && u.isActive && (
                              <button
                                onClick={() => resendCredentials(u)}
                                disabled={actionLoading === u.id}
                                title="Resend login credentials"
                                className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50 transition disabled:opacity-40"
                              >
                                <Mail className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => setDeleteTarget(u)}
                              disabled={actionLoading === u.id}
                              title="Delete user permanently"
                              className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-40"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            {expandedRow === u.id
                              ? <ChevronUp   className="w-4 h-4 text-gray-400" />
                              : <ChevronDown className="w-4 h-4 text-gray-400" />}
                          </div>
                        </td>
                      </tr>

                      {expandedRow === u.id && (
                        <tr className="bg-blue-50">
                          <td colSpan={5} className="px-8 py-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                                  <Hash className="w-3 h-3" /> User ID
                                </p>
                                <p className="font-mono text-gray-700">{u.id ?? '—'}</p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                                  <Building2 className="w-3 h-3" /> Account ID
                                </p>
                                <p className="font-mono text-gray-700">{u.accountId ?? '—'}</p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                                  <Mail className="w-3 h-3" /> Email
                                </p>
                                <p className="text-gray-700">{u.email ?? '—'}</p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                                  <Key className="w-3 h-3" /> Password Status
                                </p>
                                <p className={`text-sm font-semibold ${u.mustChange ? 'text-amber-600' : 'text-green-600'}`}>
                                  {u.mustChange ? 'Change required on login' : 'Password set'}
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {users.length >= limit && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Page {page}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40 transition"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={users.length < limit || loading}
                className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40 transition"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {deleteTarget && (
        <DeleteModal
          user={deleteTarget}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
          loading={deleteLoading}
        />
      )}
    </div>
  );
}