import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, Users, TrendingUp, Edit2, Trash2, Save, X, Download, Filter, Search, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

const API_BASE = 'http://localhost:5000/api';

const PatrolScheduleManager = () => {
  const [clients, setClients] = useState([]);
  const [allClients, setAllClients] = useState([]); // Store all clients for filtering
  const [filteredClients, setFilteredClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [editingClient, setEditingClient] = useState(null);
  const [notification, setNotification] = useState(null);
  const [performanceData, setPerformanceData] = useState(null);
  const [viewMode, setViewMode] = useState('list');
  const [performanceDays, setPerformanceDays] = useState(7);
  const [isRefreshingClients, setIsRefreshingClients] = useState(false);

  // Form state for editing/creating
  const [formData, setFormData] = useState({
    patrolsPerDay: 11,
    patrolDays: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
    scheduleType: 'daily',
    weekendPatrols: 11,
    customIntervalDays: null,
    shiftType: 'Day/Night'
  });

  const showNotification = useCallback((message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  // ✅ FIXED: Filter clients based on search query
  const filterClients = useCallback((query, status, clientsList) => {
    if (!clientsList || clientsList.length === 0) {
      setFilteredClients([]);
      return;
    }

    let filtered = [...clientsList];

    // Search filter
    if (query && query.trim().length >= 1) {
      const searchTerm = query.toLowerCase().trim();
      filtered = filtered.filter(client => {
        const name = client.ClientName?.toLowerCase() || client.name?.toLowerCase() || "";
        const id = client.ClientID?.toString() || client.id?.toString() || "";
        const account = client.accountNumber?.toString() || "";
        return name.includes(searchTerm) || id.includes(searchTerm) || account.includes(searchTerm);
      });
    }

    // Status filter
    if (status !== 'all') {
      if (status === 'active') {
        filtered = filtered.filter(c => c.IsActive || c.isActive);
      } else if (status === 'inactive') {
        filtered = filtered.filter(c => !c.IsActive && !c.isActive);
      } else if (status === 'custom') {
        filtered = filtered.filter(c => c.HasCustomSchedule || c.hasCustomSchedule);
      } else if (status === 'default') {
        filtered = filtered.filter(c => !c.HasCustomSchedule && !c.hasCustomSchedule);
      }
    }

    console.log(`🔍 Filtered to ${filtered.length} clients for query: "${query}" with status: "${status}"`);
    setFilteredClients(filtered);
  }, []);

  // ✅ FIXED: Load all clients using the same approach as SecurityReportsPage
  const fetchAllClients = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      setIsRefreshingClients(true);
      console.log('📊 Fetching ALL clients from main clients API...');
      setNotification(null);

      // Try main clients endpoint first (this should have all 2000+ clients)
      const response = await fetch(`${API_BASE}/clients`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // ✅ CRITICAL: Check response structure - this endpoint returns { clients: [], count: X }
      let clientsData = [];
      
      if (data && Array.isArray(data.clients)) {
        // Format 1: { clients: [], count: X }
        clientsData = data.clients;
        console.log(`✅ Loaded ${clientsData.length} clients (total: ${data.count || data.clients.length}) from /clients endpoint`);
      } else if (data && Array.isArray(data)) {
        // Format 2: Direct array
        clientsData = data;
        console.log(`✅ Loaded ${clientsData.length} clients from /clients endpoint (direct array)`);
      } else {
        console.warn("Unexpected response format from /clients:", data);
        
        // Fallback to patrol-schedules endpoint
        console.log('🔄 Falling back to patrol-schedules endpoint...');
        const patrolResponse = await fetch(`${API_BASE}/patrol-schedules/all`);
        if (patrolResponse.ok) {
          const patrolData = await patrolResponse.json();
          if (patrolData.success && Array.isArray(patrolData.clients)) {
            clientsData = patrolData.clients;
            console.log(`✅ Loaded ${clientsData.length} clients from fallback endpoint`);
          } else {
            throw new Error('Invalid fallback response format');
          }
        } else {
          throw new Error('Both endpoints failed');
        }
      }

      // Transform client data to consistent format
      const transformedClients = clientsData.map(client => ({
        // Original patrol-schedules format
        ClientID: client.ClientID || client.id || client.cue_codigo || 0,
        ClientName: client.ClientName || client.name || client.cue_cnombre || 'Unknown Client',
        PatrolsPerDay: client.PatrolsPerDay || client.patrolsPerDay || 11,
        PatrolDays: client.PatrolDays || client.patrolDays || 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
        ScheduleType: client.ScheduleType || client.scheduleType || 'daily',
        WeekendPatrols: client.WeekendPatrols || client.weekendPatrols || 11,
        CustomIntervalDays: client.CustomIntervalDays || client.customIntervalDays,
        ShiftType: client.ShiftType || client.shiftType || 'Day/Night',
        WeeklyTotal: client.WeeklyTotal || client.weeklyTotal || 77,
        HasCustomSchedule: client.HasCustomSchedule || client.hasCustomSchedule || false,
        IsActive: client.IsActive !== undefined ? client.IsActive : (client.isActive !== undefined ? client.isActive : true),
        // Additional fields from main clients endpoint
        accountNumber: client.accountNumber || client.cue_ccliente || '',
        email: client.email || '',
        phone: client.phone || '',
        address: client.address || ''
      }));

      // ✅ CRITICAL: Store all clients AND show all initially
      setAllClients(transformedClients);
      
      // Apply filters with current search term and status
      filterClients(searchTerm, filterStatus, transformedClients);

      if (transformedClients.length === 0) {
        showNotification('No clients found', 'error');
      } else {
        showNotification(`Loaded ${transformedClients.length} clients`, 'success');
      }

    } catch (error) {
      console.error('❌ Failed to fetch clients:', error);
      showNotification(`Failed to load clients: ${error.message}`, 'error');
      // ✅ CRITICAL: Clear both states on error
      setAllClients([]);
      setFilteredClients([]);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
      setIsRefreshingClients(false);
    }
  }, [searchTerm, filterStatus, filterClients, showNotification]);

  // Handle client search input change with debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      filterClients(searchTerm, filterStatus, allClients);
    }, 300); // 300ms debounce
    
    return () => clearTimeout(timer);
  }, [searchTerm, filterStatus, allClients, filterClients]);

  const fetchPerformanceData = useCallback(async (days = performanceDays) => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/patrol-schedules/performance?days=${days}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const text = await response.text();
      let result;
      
      try {
        result = JSON.parse(text);
      } catch (error) {
        console.error('Failed to parse JSON:', text);
        throw new Error('Server returned invalid JSON');
      }
      
      if (result.success) {
        setPerformanceData(result.data);
      } else {
        showNotification(result.message || 'Failed to fetch performance data', 'error');
      }
    } catch (error) {
      console.error('Error fetching performance:', error);
      showNotification('Error loading performance data: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [performanceDays, showNotification]);

  const handleEdit = (client) => {
    setEditingClient(client.ClientID);
    // Preserve ALL existing values from the client
    setFormData({
      patrolsPerDay: client.PatrolsPerDay,
      patrolDays: client.PatrolDays,
      scheduleType: client.ScheduleType,
      weekendPatrols: client.WeekendPatrols,
      customIntervalDays: client.CustomIntervalDays,
      shiftType: client.ShiftType
    });
  };

  const handleSave = async (clientId) => {
    try {
      const response = await fetch(`${API_BASE}/patrol-schedules/${clientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      let result;
      
      try {
        result = JSON.parse(text);
      } catch (error) {
        throw new Error('Server returned invalid JSON');
      }

      if (result.success) {
        showNotification('Schedule updated successfully', 'success');
        setEditingClient(null);
        // Refresh clients after update
        await fetchAllClients(false);
      } else {
        showNotification(result.message || 'Failed to update schedule', 'error');
      }
    } catch (error) {
      console.error('Error saving schedule:', error);
      showNotification('Error saving schedule: ' + error.message, 'error');
    }
  };

  const handleDelete = async (clientId, clientName) => {
    if (!window.confirm(`Are you sure you want to delete the custom schedule for ${clientName}? This will revert to default settings.`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/patrol-schedules/${clientId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      let result;
      
      try {
        result = JSON.parse(text);
      } catch (error) {
        throw new Error('Server returned invalid JSON');
      }

      if (result.success) {
        showNotification('Schedule deleted successfully', 'success');
        // Refresh clients after delete
        await fetchAllClients(false);
      } else {
        showNotification(result.message || 'Failed to delete schedule', 'error');
      }
    } catch (error) {
      console.error('Error deleting schedule:', error);
      showNotification('Error deleting schedule: ' + error.message, 'error');
    }
  };

  const handleCancel = () => {
    setEditingClient(null);
    setFormData({
      patrolsPerDay: 11,
      patrolDays: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
      scheduleType: 'daily',
      weekendPatrols: 11,
      customIntervalDays: null,
      shiftType: 'Day/Night'
    });
  };

  const exportToCSV = () => {
    const headers = ['Client ID', 'Client Name', 'Patrols/Day', 'Weekend Patrols', 'Patrol Days', 'Shift Type', 'Weekly Total', 'Has Custom', 'Account Number', 'Status'];
    const rows = filteredClients.map(c => [
      c.ClientID,
      c.ClientName,
      c.PatrolsPerDay,
      c.WeekendPatrols,
      c.PatrolDays,
      c.ShiftType,
      c.WeeklyTotal,
      c.HasCustomSchedule ? 'Yes' : 'No',
      c.accountNumber || '',
      c.IsActive ? 'Active' : 'Inactive'
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `patrol-schedules-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const getDayButtons = (selectedDays) => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const selected = selectedDays.split(',').map(d => d.trim());
    
    return days.map(day => (
      <button
        key={day}
        type="button"
        onClick={() => {
          const newDays = selected.includes(day)
            ? selected.filter(d => d !== day)
            : [...selected, day];
          setFormData({ ...formData, patrolDays: newDays.join(',') });
        }}
        className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
          selected.includes(day)
            ? 'bg-blue-600 text-white'
            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
        }`}
      >
        {day}
      </button>
    ));
  };

  // Handle manual refresh of clients
  const handleRefreshClients = () => {
    console.log("🔄 Refreshing clients...");
    setSearchTerm(""); // Clear search on refresh
    fetchAllClients(true);
  };

  // Handle clear client search
  const handleClearClientSearch = () => {
    setSearchTerm("");
    filterClients("", filterStatus, allClients);
  };

  // ✅ FIXED: Fetch clients on initial load
  useEffect(() => {
    fetchAllClients(true);
  }, [fetchAllClients]);

  if (loading && allClients.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading patrol schedules...</p>
          <p className="text-sm text-gray-500 mt-2">Fetching all clients from database...</p>
        </div>
      </div>
    );
  }

  // Calculate stats for the dashboard using allClients
  const activeClients = allClients.filter(c => c.IsActive).length;
  const customSchedules = allClients.filter(c => c.HasCustomSchedule).length;
  const defaultSchedules = allClients.filter(c => !c.HasCustomSchedule).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <Calendar className="w-8 h-8 text-blue-600" />
                Patrol Schedule Manager
              </h1>
              <p className="mt-1 text-gray-600">Manage client patrol schedules and performance</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setViewMode(viewMode === 'list' ? 'performance' : 'list');
                  if (viewMode === 'list') fetchPerformanceData();
                }}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
              >
                <TrendingUp className="w-4 h-4" />
                {viewMode === 'list' ? 'View Performance' : 'View Schedules'}
              </button>
              <button
                onClick={exportToCSV}
                disabled={filteredClients.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export CSV ({filteredClients.length})
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 ${
          notification.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        } text-white`}>
          {notification.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          {notification.message}
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Clients</p>
                <p className="text-2xl font-bold text-gray-900">{allClients.length}</p>
                <p className="text-xs text-gray-500 mt-1">Database total</p>
              </div>
              <Users className="w-10 h-10 text-blue-600" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Clients</p>
                <p className="text-2xl font-bold text-green-600">{activeClients}</p>
                <p className="text-xs text-gray-500 mt-1">{Math.round((activeClients / allClients.length) * 100)}% of total</p>
              </div>
              <CheckCircle className="w-10 h-10 text-green-600" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Custom Schedules</p>
                <p className="text-2xl font-bold text-purple-600">{customSchedules}</p>
                <p className="text-xs text-gray-500 mt-1">{Math.round((customSchedules / allClients.length) * 100)}% of total</p>
              </div>
              <Calendar className="w-10 h-10 text-purple-600" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Default Schedules</p>
                <p className="text-2xl font-bold text-gray-600">{defaultSchedules}</p>
                <p className="text-xs text-gray-500 mt-1">{Math.round((defaultSchedules / allClients.length) * 100)}% of total</p>
              </div>
              <Clock className="w-10 h-10 text-gray-600" />
            </div>
          </div>
        </div>

        {/* Client Refresh Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Clients Database</h3>
              <p className="text-sm text-gray-600">
                {filteredClients.length} of {allClients.length} clients shown • 
                {allClients.length >= 2000 ? ' Full database loaded' : ' Partial database loaded'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm">
                <span className="text-gray-500">Showing: </span>
                <span className="font-medium">{filteredClients.length} clients</span>
              </div>
              <button
                onClick={handleRefreshClients}
                disabled={isRefreshingClients}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 flex items-center gap-2 transition-colors"
              >
                <RefreshCw size={16} className={isRefreshingClients ? 'animate-spin' : ''} />
                {isRefreshingClients ? 'Refreshing...' : 'Refresh Clients'}
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, ID, or account number..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {searchTerm && searchTerm.trim().length >= 1 
                  ? `Showing ${filteredClients.length} of ${allClients.length} clients matching "${searchTerm}"`
                  : `Showing all ${allClients.length} clients`}
              </p>
            </div>
            <div className="flex gap-2">
              <Filter className="w-5 h-5 text-gray-400 self-center" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Clients ({allClients.length})</option>
                <option value="active">Active Only ({activeClients})</option>
                <option value="inactive">Inactive Only ({allClients.length - activeClients})</option>
                <option value="custom">Custom Schedules ({customSchedules})</option>
                <option value="default">Default Schedules ({defaultSchedules})</option>
              </select>
              <button
                onClick={handleClearClientSearch}
                disabled={!searchTerm}
                className="flex items-center gap-2 bg-gray-200 text-gray-700 rounded-lg px-4 py-2 hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 transition-all shrink-0"
              >
                <X className="w-4 h-4" />
                Clear
              </button>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-600 flex justify-between items-center">
            <span>
              Showing {filteredClients.length} of {allClients.length} clients
              {filterStatus !== 'all' && ` • Filtered by: ${filterStatus}`}
            </span>
            {(searchTerm || filterStatus !== 'all') && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setFilterStatus('all');
                  filterClients('', 'all', allClients);
                }}
                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                Clear all filters
              </button>
            )}
          </div>
        </div>

        {/* Main Content */}
        {viewMode === 'list' ? (
          /* Schedules List */
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {filteredClients.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="mx-auto mb-4 text-gray-400" size={48} />
                <p className="text-gray-600 mb-4">
                  {allClients.length === 0 
                    ? "No clients found. Check your backend connection." 
                    : "No clients match your search criteria"}
                </p>
                <button
                  onClick={handleClearClientSearch}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Clear Search
                </button>
              </div>
            ) : (
              <>
                <div className="px-6 py-4 bg-gray-50 border-b flex justify-between items-center">
                  <div>
                    <span className="text-sm font-medium text-gray-700">
                      {filteredClients.length} client{filteredClients.length !== 1 ? 's' : ''}
                    </span>
                    {allClients.length > 0 && (
                      <span className="text-sm text-gray-500 ml-2">
                        ({Math.round((filteredClients.length / allClients.length) * 100)}% of total)
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">
                    Scroll horizontally to see all columns →
                  </div>
                </div>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0 z-10">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Patrols/Day</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Weekend</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Days</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shift</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Weekly Total</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Account</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredClients.map((client) => (
                        <tr key={client.ClientID} className={editingClient === client.ClientID ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                          <td className="px-6 py-4">
                            <div className="flex items-center">
                              <div>
                                <div className="text-sm font-medium text-gray-900">{client.ClientName}</div>
                                <div className="text-sm text-gray-500">ID: {client.ClientID}</div>
                                {client.HasCustomSchedule && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 mt-1">
                                    Custom
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {editingClient === client.ClientID ? (
                              <input
                                type="number"
                                min="1"
                                max="24"
                                value={formData.patrolsPerDay}
                                onChange={(e) => setFormData({ ...formData, patrolsPerDay: parseInt(e.target.value) })}
                                className="w-20 px-2 py-1 border border-gray-300 rounded"
                              />
                            ) : (
                              <span className="text-sm text-gray-900">{client.PatrolsPerDay}</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {editingClient === client.ClientID ? (
                              <input
                                type="number"
                                min="1"
                                max="24"
                                value={formData.weekendPatrols}
                                onChange={(e) => setFormData({ ...formData, weekendPatrols: parseInt(e.target.value) })}
                                className="w-20 px-2 py-1 border border-gray-300 rounded"
                              />
                            ) : (
                              <span className="text-sm text-gray-900">{client.WeekendPatrols}</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {editingClient === client.ClientID ? (
                              <div className="flex gap-1 flex-wrap max-w-xs">
                                {getDayButtons(formData.patrolDays)}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-900">{client.PatrolDays}</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {editingClient === client.ClientID ? (
                              <select
                                value={formData.shiftType}
                                onChange={(e) => setFormData({ ...formData, shiftType: e.target.value })}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                              >
                                <option>Day/Night</option>
                                <option>Day Only</option>
                                <option>Night Only</option>
                                <option>24/7</option>
                              </select>
                            ) : (
                              <span className="text-sm text-gray-900">{client.ShiftType}</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-sm font-medium text-gray-900">{client.WeeklyTotal}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-sm text-gray-600">{client.accountNumber || 'N/A'}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              client.IsActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {client.IsActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm">
                            {editingClient === client.ClientID ? (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleSave(client.ClientID)}
                                  className="text-green-600 hover:text-green-900"
                                  title="Save"
                                >
                                  <Save className="w-5 h-5" />
                                </button>
                                <button
                                  onClick={handleCancel}
                                  className="text-gray-600 hover:text-gray-900"
                                  title="Cancel"
                                >
                                  <X className="w-5 h-5" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleEdit(client)}
                                  className="text-blue-600 hover:text-blue-900"
                                  title="Edit"
                                >
                                  <Edit2 className="w-5 h-5" />
                                </button>
                                {client.HasCustomSchedule && (
                                  <button
                                    onClick={() => handleDelete(client.ClientID, client.ClientName)}
                                    className="text-red-600 hover:text-red-900"
                                    title="Delete Custom Schedule"
                                  >
                                    <Trash2 className="w-5 h-5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        ) : (
          /* Performance View */
          <div className="space-y-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">Client Performance Metrics</h2>
              <div className="flex gap-3">
                <select
                  value={performanceDays}
                  onChange={(e) => {
                    setPerformanceDays(parseInt(e.target.value));
                    fetchPerformanceData(parseInt(e.target.value));
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="7">Last 7 Days</option>
                  <option value="30">Last 30 Days</option>
                  <option value="90">Last 90 Days</option>
                </select>
                <button
                  onClick={() => fetchPerformanceData()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Refresh
                </button>
              </div>
            </div>
            
            {performanceData ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {performanceData.clients?.map((client) => (
                  <div key={client.ClientID} className="bg-white rounded-lg shadow p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-bold text-lg text-gray-900">{client.ClientName}</h3>
                        <p className="text-sm text-gray-500">ID: {client.ClientID}</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                        client.performance?.performance === 'Excellent' ? 'bg-green-100 text-green-800' :
                        client.performance?.performance === 'Good' ? 'bg-blue-100 text-blue-800' :
                        client.performance?.performance === 'Fair' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {client.performance?.performance || 'N/A'}
                      </span>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Compliance Rate:</span>
                        <span className="text-sm font-bold text-gray-900">{client.performance?.complianceRate || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Expected Patrols:</span>
                        <span className="text-sm font-medium text-gray-900">{client.performance?.expectedPatrols || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Actual Patrols:</span>
                        <span className="text-sm font-medium text-gray-900">{client.performance?.actualPatrols || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Daily Average:</span>
                        <span className="text-sm font-medium text-gray-900">{client.performance?.dailyAverage || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Zones Covered:</span>
                        <span className="text-sm font-medium text-gray-900">{client.performance?.zonesCovered || 'N/A'}</span>
                      </div>
                    </div>
                    
                    <div className="mt-4 pt-4 border-t">
                      <p className="text-xs text-gray-500">Schedule: {client.ScheduleInfo || 'Default schedule'}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading performance data...</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PatrolScheduleManager;