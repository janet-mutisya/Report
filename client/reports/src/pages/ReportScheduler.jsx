import React, { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, Clock, Mail, RefreshCw, Send, FileText, 
  CheckCircle, XCircle, Plus, Trash2, Edit, 
  Eye, Search, ChevronDown, ChevronUp,
  Shield, AlertCircle
} from 'lucide-react';

// API Configuration - FIXED TO MATCH BACKEND
const API_BASE_URL = 'http://localhost:5000/api';

const SecurityReportsPage = () => {
  // State Management
  const [schedules, setSchedules] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'clientName', direction: 'asc' });
  
  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [currentSchedule, setCurrentSchedule] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  
  // Form State
  const [formData, setFormData] = useState({
    clientId: '',
    email: '',
    frequency: 1,
    intervalDays: 1,
    nextRun: '',
    reportTime: '09:00'
  });
  
  const [reportForm, setReportForm] = useState({
    clientId: '',
    startDate: '',
    endDate: '',
    reportPeriod: 'previousWeek',
    recipientEmail: ''
  });

  // Show/Hide Manual Report Section
  const [showManualReport, setShowManualReport] = useState(false);
  
  // Manual Report Sending State
  const [isSendingReport, setIsSendingReport] = useState(false);

  // API Helper Function
  const fetchAPI = useCallback(async (url, options = {}) => {
    try {
      console.log(`🌐 API Call: ${options.method || 'GET'} ${url}`);
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ HTTP ${response.status}:`, errorText);
        let errorMessage = `HTTP ${response.status}`;
        
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || errorData.error || errorText;
        } catch {
          errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`;
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log(`✅ Response:`, data);
      return data;
    } catch (fetchError) {
      console.error('❌ API Error:', fetchError);
      if (fetchError.message.includes('Failed to fetch')) {
        throw new Error('Cannot connect to backend server. Please check if the server is running on port 5000.');
      }
      throw fetchError;
    }
  }, []);

  // Data Fetching - FIXED TO USE CORRECT ENDPOINTS
  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAPI(`${API_BASE_URL}/scheduler`);
      setSchedules(data.schedules || data.data || []);
    } catch (fetchError) {
      setError(fetchError.message);
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, [fetchAPI]);

  const fetchClients = useCallback(async () => {
    try {
      const data = await fetchAPI(`${API_BASE_URL}/scheduler/clients/basic`);
      setClients(data.clients || data.data || []);
    } catch (fetchError) {
      console.error('Error fetching clients:', fetchError);
      setClients([]);
    }
  }, [fetchAPI]);

  // Schedule Management - FIXED
  const createSchedule = useCallback(async () => {
    try {
      if (!formData.clientId || !formData.email || !formData.nextRun) {
        setError('Please fill in all required fields');
        return;
      }

      const requestBody = {
        clientId: parseInt(formData.clientId),
        email: formData.email.trim(),
        frequency: parseInt(formData.frequency),
        intervalDays: parseInt(formData.intervalDays) || 1,
        nextRun: formData.nextRun,
        type: 1
      };
      
      await fetchAPI(`${API_BASE_URL}/scheduler`, {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      
      setSuccess('Schedule created successfully');
      setShowModal(false);
      resetForm();
      fetchSchedules();
    } catch (createError) {
      console.error('❌ Create schedule error:', createError);
      setError(createError.message);
    }
  }, [formData, fetchAPI, fetchSchedules]);

  const updateSchedule = useCallback(async () => {
    try {
      if (!currentSchedule || !formData.email || !formData.nextRun) {
        setError('Please fill in all required fields');
        return;
      }

      const requestBody = {
        email: formData.email.trim(),
        frequency: parseInt(formData.frequency),
        intervalDays: parseInt(formData.intervalDays) || 1,
        nextRun: formData.nextRun
      };
      
      await fetchAPI(`${API_BASE_URL}/scheduler/${currentSchedule.id}`, {
        method: 'PUT',
        body: JSON.stringify(requestBody)
      });
      
      setSuccess('Schedule updated successfully');
      setShowModal(false);
      resetForm();
      setCurrentSchedule(null);
      fetchSchedules();
    } catch (updateError) {
      console.error('❌ Update failed:', updateError);
      setError(updateError.message);
    }
  }, [currentSchedule, formData, fetchAPI, fetchSchedules]);

  const deleteSchedule = useCallback(async (schedule) => {
    if (!window.confirm(`Are you sure you want to delete the schedule for ${schedule.clientName}?`)) return;
    
    try {
      await fetchAPI(`${API_BASE_URL}/scheduler/${schedule.id}`, {
        method: 'DELETE'
      });
      
      setSuccess('Schedule deleted successfully');
      fetchSchedules();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }, [fetchAPI, fetchSchedules]);

  // Report Functions - SEND MANUAL REPORT (UPDATED WITH LOADING STATE)
  const sendReport = useCallback(async () => {
    try {
      setIsSendingReport(true);
      setError(null);
      
      if (!reportForm.clientId) {
        setError('Please select a client');
        return;
      }

      console.log('📤 Sending manual report for client:', reportForm.clientId);
      
      const requestBody = {
        reportPeriod: reportForm.reportPeriod,
        recipientEmail: reportForm.recipientEmail || ''
      };

      if (reportForm.reportPeriod === 'custom') {
        if (!reportForm.startDate || !reportForm.endDate) {
          setError('Please select start and end dates for custom range');
          return;
        }
        requestBody.startDate = reportForm.startDate;
        requestBody.endDate = reportForm.endDate;
      }
      
      console.log('📤 Report request body:', requestBody);
      
      // Using the correct endpoint from your schedulerRoutes
      const responseData = await fetchAPI(`${API_BASE_URL}/scheduler/trigger/patrol-reports`, {
        method: 'POST',
        body: JSON.stringify({
          clientId: parseInt(reportForm.clientId),
          ...requestBody
        })
      });
      
      setSuccess(responseData.message || 'Report sent successfully! Check your email.');
      setReportForm({
        clientId: '',
        startDate: '',
        endDate: '',
        reportPeriod: 'previousWeek',
        recipientEmail: ''
      });
      setShowManualReport(false);
    } catch (reportError) {
      console.error('❌ Send report error:', reportError);
      setError(reportError.message);
    } finally {
      setIsSendingReport(false);
    }
  }, [reportForm, fetchAPI]);

  const sendQuickReport = useCallback(async (clientId) => {
    try {
      console.log('🚀 Sending quick report for client:', clientId);
      setSuccess('Quick report feature coming soon!');
    } catch (quickError) {
      console.error('❌ Quick report error:', quickError);
      setError(quickError.message);
    }
  }, []);

  const viewPreview = useCallback(async (clientId) => {
    try {
      console.log('👁️ Fetching preview for client:', clientId);
      setPreviewData({ summary: { totalPatrols: 0, complianceRate: 'N/A' } });
      setShowPreview(true);
    } catch (previewError) {
      console.error('❌ Preview error:', previewError);
      setError(previewError.message);
    }
  }, []);

  // Health Check - FIXED
  const checkBackendHealth = useCallback(async () => {
    try {
      const health = await fetchAPI(`${API_BASE_URL}/scheduler/health`);
      console.log('✅ Backend health:', health);
      return true;
    } catch (healthError) {
      console.error('❌ Backend health check failed:', healthError);
      setError('Backend server is not responding. Please ensure the server is running on port 5000.');
      return false;
    }
  }, [fetchAPI]);

  // Refresh All Data
  const refreshAllData = useCallback(() => {
    fetchSchedules();
    fetchClients();
  }, [fetchSchedules, fetchClients]);

  // Helper Functions
  const resetForm = () => {
    setFormData({
      clientId: '',
      email: '',
      frequency: 1,
      intervalDays: 1,
      nextRun: '',
      reportTime: '09:00'
    });
    setCurrentSchedule(null);
  };

  const openEditModal = (schedule) => {
    setFormData({
      clientId: schedule.clientId,
      email: schedule.email || '',
      frequency: parseInt(schedule.frequency) || 1,
      intervalDays: parseInt(schedule.intervalDays) || 1,
      nextRun: schedule.nextRun ? new Date(schedule.nextRun).toISOString().slice(0, 16) : '',
      reportTime: '09:00'
    });
    setCurrentSchedule(schedule);
    setModalMode('edit');
    setShowModal(true);
  };

  const openCreateModal = () => {
    resetForm();
    const defaultNextRun = new Date();
    defaultNextRun.setHours(defaultNextRun.getHours() + 1);
    setFormData(prev => ({
      ...prev,
      nextRun: defaultNextRun.toISOString().slice(0, 16)
    }));
    setModalMode('create');
    setShowModal(true);
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Invalid Date';
    }
  };

  const getFrequencyLabel = (freq) => {
    const labels = { 1: 'Daily', 2: 'Weekly', 3: 'Monthly' };
    return labels[freq] || 'Unknown';
  };

  const getStatusBadge = (nextRun) => {
    if (!nextRun) return null;
    try {
      const isDue = new Date(nextRun) <= new Date();
      return isDue ? 
        <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">Due Now</span> :
        <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">Scheduled</span>;
    } catch {
      return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">Invalid Date</span>;
    }
  };

  // Filter and Sort
  const filterAndSortSchedules = useCallback(() => {
    let filtered = [...schedules];

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(schedule => {
        const clientName = schedule.clientName?.toLowerCase() || '';
        const email = schedule.email?.toLowerCase() || '';
        return clientName.includes(term) || email.includes(term);
      });
    }

    if (filterStatus !== 'all') {
      filtered = filtered.filter(schedule => {
        if (!schedule.nextRun) return false;
        const isDue = new Date(schedule.nextRun) <= new Date();
        return filterStatus === 'due' ? isDue : !isDue;
      });
    }

    filtered.sort((a, b) => {
      let aValue = a[sortConfig.key] || '';
      let bValue = b[sortConfig.key] || '';
      
      if (sortConfig.key === 'nextRun') {
        aValue = new Date(aValue).getTime();
        bValue = new Date(bValue).getTime();
      }
      
      if (sortConfig.direction === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

    return filtered;
  }, [schedules, searchTerm, filterStatus, sortConfig]);

  const filteredSchedules = filterAndSortSchedules();

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // Effects
  useEffect(() => {
    const initializeApp = async () => {
      const isHealthy = await checkBackendHealth();
      if (isHealthy) {
        refreshAllData();
      }
    };
    initializeApp();
  }, [checkBackendHealth, refreshAllData]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Render Components
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Shield className="text-white" size={24} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">BM Security Reports</h1>
                <p className="text-sm text-gray-600">Automated patrol reporting system</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <button
                onClick={refreshAllData}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 flex items-center gap-2 transition-colors"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              
              <button
                onClick={openCreateModal}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 transition-colors"
              >
                <Plus size={16} />
                New Schedule
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Notifications */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
            <CheckCircle className="text-green-600 flex-shrink-0" size={20} />
            <span className="text-green-800 font-medium">{success}</span>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <XCircle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
            <span className="text-red-800 font-medium">{error}</span>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6 border border-blue-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Schedules</p>
                <p className="text-2xl font-bold text-gray-900">{schedules.length}</p>
              </div>
              <div className="p-3 bg-blue-100 rounded-lg">
                <Calendar className="text-blue-600" size={24} />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-purple-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Clients</p>
                <p className="text-2xl font-bold text-gray-900">{clients.length}</p>
              </div>
              <div className="p-3 bg-purple-100 rounded-lg">
                <FileText className="text-purple-600" size={24} />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-orange-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Due Reports</p>
                <p className="text-2xl font-bold text-gray-900">
                  {schedules.filter(s => new Date(s.nextRun) <= new Date()).length}
                </p>
              </div>
              <div className="p-3 bg-orange-100 rounded-lg">
                <AlertCircle className="text-orange-600" size={24} />
              </div>
            </div>
          </div>
        </div>

        {/* Manual Report Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Send Manual Report</h2>
              <p className="text-sm text-gray-600 mt-1">Generate and send patrol reports on demand</p>
            </div>
            <button
              onClick={() => setShowManualReport(!showManualReport)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
            >
              {showManualReport ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {showManualReport ? 'Hide' : 'Show'}
            </button>
          </div>
          
          {showManualReport && (
            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Client *</label>
                    <select
                      value={reportForm.clientId}
                      onChange={(e) => setReportForm({ ...reportForm, clientId: e.target.value })}
                      disabled={isSendingReport}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    >
                      <option value="">Select a client</option>
                      {clients.map((client) => (
                        <option key={client.ClientID} value={client.ClientID}>
                          {client.ClientName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Report Period</label>
                    <select
                      value={reportForm.reportPeriod}
                      onChange={(e) => setReportForm({ ...reportForm, reportPeriod: e.target.value })}
                      disabled={isSendingReport}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    >
                      <option value="previousWeek">Previous Week</option>
                      <option value="custom">Custom Range</option>
                    </select>
                  </div>

                  {reportForm.reportPeriod === 'custom' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                        <input
                          type="date"
                          value={reportForm.startDate}
                          onChange={(e) => setReportForm({ ...reportForm, startDate: e.target.value })}
                          disabled={isSendingReport}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                        <input
                          type="date"
                          value={reportForm.endDate}
                          onChange={(e) => setReportForm({ ...reportForm, endDate: e.target.value })}
                          disabled={isSendingReport}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Recipient Email (optional)
                    </label>
                    <input
                      type="email"
                      value={reportForm.recipientEmail}
                      onChange={(e) => setReportForm({ ...reportForm, recipientEmail: e.target.value })}
                      placeholder="Leave blank to use default"
                      disabled={isSendingReport}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      If not provided, report will be sent to the client's default email
                    </p>
                  </div>

                  <button
                    onClick={sendReport}
                    disabled={!reportForm.clientId || isSendingReport}
                    className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium transition-colors"
                  >
                    {isSendingReport ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        Sending Report...
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        Send Report Now
                      </>
                    )}
                  </button>
                </div>

                <div className="bg-blue-50 p-6 rounded-lg">
                  <h3 className="font-semibold text-blue-900 mb-4">Report Features</h3>
                  <ul className="space-y-3 text-sm text-blue-800">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="text-green-500 mt-0.5 flex-shrink-0" size={16} />
                      <span>Weekly patrol performance analysis</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="text-green-500 mt-0.5 flex-shrink-0" size={16} />
                      <span>Guard incident reports (V03 events)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="text-green-500 mt-0.5 flex-shrink-0" size={16} />
                      <span>Site post compliance rates</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="text-green-500 mt-0.5 flex-shrink-0" size={16} />
                      <span>Custom date range support</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="text-green-500 mt-0.5 flex-shrink-0" size={16} />
                      <span>PDF format with detailed metrics</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="text-green-500 mt-0.5 flex-shrink-0" size={16} />
                      <span>Automatic email delivery</span>
                    </li>
                  </ul>
                  
                  <div className="mt-6 p-4 bg-white rounded-lg border border-blue-200">
                    <h4 className="font-semibold text-gray-900 mb-2">Quick Tips</h4>
                    <ul className="space-y-2 text-xs text-gray-600">
                      <li>• Previous Week reports cover Monday-Sunday</li>
                      <li>• Custom range can span up to 90 days</li>
                      <li>• Reports are sent immediately</li>
                      <li>• Check spam folder if not received</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Schedules Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Automated Report Schedules</h2>
          </div>

          <div className="p-6">
            {/* Search Bar */}
            <div className="mb-6 flex gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  placeholder="Search clients..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Status</option>
                <option value="due">Due Now</option>
                <option value="scheduled">Scheduled</option>
              </select>
              <button
                onClick={() => handleSort('clientName')}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
              >
                {sortConfig.direction === 'asc' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                Sort
              </button>
            </div>

            {filteredSchedules.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="mx-auto mb-4 text-gray-400" size={48} />
                <p className="text-gray-600 mb-4">
                  {schedules.length === 0 
                    ? "No schedules found. Create your first schedule to get started." 
                    : "No schedules match your search criteria"
                  }
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredSchedules.map((schedule) => (
                  <div key={schedule.id} className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-lg transition-all">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="font-semibold text-gray-900">{schedule.clientName}</h3>
                        <div className="mt-1">{getStatusBadge(schedule.nextRun)}</div>
                      </div>
                    </div>

                    <div className="space-y-2 mb-4">
                      <div className="flex items-center text-sm text-gray-600">
                        <Mail size={16} className="mr-2" />
                        <span className="truncate">{schedule.email}</span>
                      </div>
                      <div className="flex items-center text-sm text-gray-600">
                        <Clock size={16} className="mr-2" />
                        <span>{formatDateTime(schedule.nextRun)}</span>
                      </div>
                      <div className="text-sm text-gray-600">
                        {getFrequencyLabel(schedule.frequency)}
                      </div>
                    </div>

                    <div className="flex justify-between pt-4 border-t">
                      <div className="flex gap-2">
                        <button
                          onClick={() => sendQuickReport(schedule.clientId)}
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
                          title="Send Report"
                        >
                          <Send size={18} />
                        </button>
                        <button
                          onClick={() => viewPreview(schedule.clientId)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                          title="Preview"
                        >
                          <Eye size={18} />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEditModal(schedule)}
                          className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                          title="Edit"
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => deleteSchedule(schedule)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-900">
                {modalMode === 'create' ? 'Create New Schedule' : 'Edit Schedule'}
              </h3>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Client *</label>
                <select
                  value={formData.clientId}
                  onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                  disabled={modalMode === 'edit'}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  <option value="">Select a client</option>
                  {clients.map((client) => (
                    <option key={client.ClientID} value={client.ClientID}>
                      {client.ClientName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="recipient@example.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Frequency *</label>
                <select
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value={1}>Daily</option>
                  <option value={2}>Weekly</option>
                  <option value={3}>Monthly</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Next Run Date *</label>
                <input
                  type="datetime-local"
                  value={formData.nextRun}
                  onChange={(e) => setFormData({ ...formData, nextRun: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={modalMode === 'create' ? createSchedule : updateSchedule}
                disabled={!formData.clientId || !formData.email || !formData.nextRun}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {modalMode === 'create' ? 'Create' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && previewData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-xl font-semibold text-gray-900">Report Preview</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle size={24} />
              </button>
            </div>
            
            <div className="p-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="font-semibold text-blue-900 mb-3">Summary</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-blue-600">Total Patrols</p>
                    <p className="text-2xl font-bold text-blue-900">
                      {previewData.summary?.totalPatrols || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-blue-600">Compliance</p>
                    <p className="text-2xl font-bold text-blue-900">
                      {previewData.summary?.complianceRate || 'N/A'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 text-center">
                <button
                  onClick={() => setShowPreview(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  Close Preview
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecurityReportsPage;