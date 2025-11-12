import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, Mail, RefreshCw, Send, FileText, TrendingUp, AlertCircle, CheckCircle, XCircle, Settings, Plus, Trash2, Edit, Eye, Play, Users, BarChart3, Download, History, Server, Zap, Activity, AlertTriangle, Search, Filter, ChevronDown, ChevronUp } from 'lucide-react';

// API Configuration
const API_BASE_URL = 'http://localhost:5000/api/scheduler';

const EnhancedScheduler = () => {
  // Tab State
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Data State
  const [schedules, setSchedules] = useState([]);
  const [clients, setClients] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [status, setStatus] = useState(null);
  
  // UI State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [currentSchedule, setCurrentSchedule] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [showHistorical, setShowHistorical] = useState(false);
  
  // Form State
  const [formData, setFormData] = useState({
    clientId: '',
    email: '',
    frequency: 1,
    intervalDays: 1,
    nextRun: ''
  });
  
  const [reportForm, setReportForm] = useState({
    clientId: '',
    startDate: '',
    endDate: '',
    recipientEmail: '',
    reportPeriod: 'previousWeek'
  });

  const [historicalForm, setHistoricalForm] = useState({
    clientId: '',
    startDate: '',
    endDate: '',
    analysisType: 'compliance',
    groupBy: 'week'
  });
  
  // Historical Data State
  const [historicalData, setHistoricalData] = useState({
    summary: null,
    patrols: [],
    trends: [],
    compliance: [],
    statistics: null
  });

  // View State for Historical Data
  const [historicalView, setHistoricalView] = useState('summary');
  const [sortField, setSortField] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [searchTerm, setSearchTerm] = useState('');

  // Helper Functions with proper dependencies
  const calculateAveragePerDay = useCallback((patrols) => {
    if (patrols.length === 0) return 0;
    
    const dates = [...new Set(patrols.map(p => p.PatrolDate?.split('T')[0]))];
    return Math.round(patrols.length / dates.length);
  }, []);

  const findMostActiveZone = useCallback((patrols) => {
    if (patrols.length === 0) return 'N/A';
    
    const zoneCounts = patrols.reduce((acc, patrol) => {
      const zone = patrol.ZoneCode || 'Unknown';
      acc[zone] = (acc[zone] || 0) + 1;
      return acc;
    }, {});
    
    return Object.entries(zoneCounts).sort((a, b) => b[1] - a[1])[0][0];
  }, []);

  const getWeekNumber = useCallback((date) => {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }, []);

  const calculateHourlyDistribution = useCallback((patrols) => {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    return hours.map(hour => ({
      hour,
      count: patrols.filter(p => new Date(p.PatrolDate).getHours() === hour).length
    })).filter(h => h.count > 0);
  }, []);

  const generateSummary = useCallback((patrols) => {
    const totalPatrols = patrols.length;
    const completedPatrols = patrols.filter(p => p.Status === 'Completed').length;
    const complianceRate = totalPatrols > 0 ? Math.round((completedPatrols / totalPatrols) * 100) : 0;
    
    return {
      totalPatrols,
      completedPatrols,
      complianceRate,
      averagePerDay: calculateAveragePerDay(patrols),
      mostActiveZone: findMostActiveZone(patrols)
    };
  }, [calculateAveragePerDay, findMostActiveZone]);

  const groupPatrols = useCallback((patrols, groupBy) => {
    return patrols.reduce((acc, patrol) => {
      const date = new Date(patrol.PatrolDate);
      let key;
      
      switch (groupBy) {
        case 'day':
          key = date.toISOString().split('T')[0];
          break;
        case 'week':
          key = `Week ${getWeekNumber(date)}`;
          break;
        case 'month':
          key = date.toLocaleString('default', { month: 'long', year: 'numeric' });
          break;
        default:
          key = date.toISOString().split('T')[0];
      }
      
      if (!acc[key]) acc[key] = [];
      acc[key].push(patrol);
      return acc;
    }, {});
  }, [getWeekNumber]);

  const analyzeTrends = useCallback((patrols) => {
    // Group by week and calculate trends
    const weeklyData = patrols.reduce((acc, patrol) => {
      const week = getWeekNumber(new Date(patrol.PatrolDate));
      if (!acc[week]) {
        acc[week] = { total: 0, completed: 0 };
      }
      acc[week].total++;
      if (patrol.Status === 'Completed') acc[week].completed++;
      return acc;
    }, {});

    return Object.entries(weeklyData).map(([week, data]) => ({
      period: `Week ${week}`,
      total: data.total,
      completed: data.completed,
      compliance: Math.round((data.completed / data.total) * 100)
    }));
  }, [getWeekNumber]);

  const calculateCompliance = useCallback((patrols, groupBy) => {
    const grouped = groupPatrols(patrols, groupBy);
    
    return Object.entries(grouped).map(([period, data]) => ({
      period,
      total: data.length,
      completed: data.filter(p => p.Status === 'Completed').length,
      compliance: Math.round((data.filter(p => p.Status === 'Completed').length / data.length) * 100)
    }));
  }, [groupPatrols]);

  const calculateStatistics = useCallback((patrols) => {
    const zones = [...new Set(patrols.map(p => p.ZoneCode).filter(Boolean))];
    const statusCounts = patrols.reduce((acc, patrol) => {
      acc[patrol.Status] = (acc[patrol.Status] || 0) + 1;
      return acc;
    }, {});

    return {
      totalZones: zones.length,
      statusDistribution: statusCounts,
      patrolsByHour: calculateHourlyDistribution(patrols)
    };
  }, [calculateHourlyDistribution]);

  // API Helper
  const fetchAPI = useCallback(async (url, options = {}) => {
    try {
      console.log(`🌐 API Call: ${options.method || 'GET'} ${url}`);
      if (options.body) {
        console.log('📤 Request Body:', JSON.parse(options.body));
      }
      
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
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      console.log(`✅ Response:`, data);
      return data;
    } catch (err) {
      console.error('❌ API Error:', err);
      if (err.message.includes('Failed to fetch')) {
        throw new Error('Cannot connect to backend server. Please check if the server is running.');
      }
      throw err;
    }
  }, []);

  // Data Fetching
  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAPI(API_BASE_URL);
      setSchedules(data.schedules || []);
    } catch (err) {
      setError(err.message);
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, [fetchAPI]);

  const fetchClients = useCallback(async () => {
    try {
      const data = await fetchAPI(`${API_BASE_URL}/clients/basic`);
      setClients(data.clients || []);
    } catch (err) {
      console.error('Error fetching clients:', err);
      setClients([]);
    }
  }, [fetchAPI]);

  const fetchAnalytics = useCallback(async () => {
    try {
      const data = await fetchAPI(`${API_BASE_URL}/analytics/summary`);
      setAnalytics(data.analytics);
    } catch (err) {
      console.error('Error fetching analytics:', err);
    }
  }, [fetchAPI]);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await fetchAPI(`${API_BASE_URL}/status`);
      setStatus(data.status);
    } catch (err) {
      console.error('Error fetching status:', err);
    }
  }, [fetchAPI]);

  // Actions
  const createSchedule = useCallback(async () => {
    if (!formData.clientId || !formData.email || !formData.nextRun) {
      setError('Please fill in all required fields');
      return;
    }

    const frequency = parseInt(formData.frequency);
    if (isNaN(frequency) || frequency < 1 || frequency > 3) {
      setError('Invalid frequency. Must be 1 (Daily), 2 (Weekly), or 3 (Monthly)');
      return;
    }

    try {
      setLoading(true);
      console.log('📤 Creating schedule for client:', formData.clientId);
      
      const requestBody = {
        clientId: parseInt(formData.clientId),
        email: formData.email.trim(),
        frequency: frequency,
        intervalDays: parseInt(formData.intervalDays) || 1,
        nextRun: formData.nextRun,
        type: 1
      };
      
      console.log('✅ Request body:', requestBody);
      
      await fetchAPI(`${API_BASE_URL}/schedule/${formData.clientId}`, {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      
      setSuccess('Schedule created successfully');
      setShowModal(false);
      resetForm();
      await fetchSchedules();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [formData, fetchAPI, fetchSchedules]);

  const updateSchedule = useCallback(async () => {
    if (!currentSchedule || !formData.email || !formData.nextRun) {
      setError('Please fill in all required fields');
      return;
    }

    const frequency = parseInt(formData.frequency);
    if (isNaN(frequency) || frequency < 1 || frequency > 3) {
      setError('Invalid frequency. Must be 1 (Daily), 2 (Weekly), or 3 (Monthly)');
      return;
    }

    const intervalDays = parseInt(formData.intervalDays);
    if (isNaN(intervalDays) || intervalDays < 1) {
      setError('Invalid interval days. Must be at least 1');
      return;
    }

    try {
      setLoading(true);
      console.log('📝 Updating schedule ID:', currentSchedule.id);
      
      const requestBody = {
        email: formData.email.trim(),
        frequency: frequency,
        intervalDays: intervalDays,
        nextRun: formData.nextRun
      };
      
      console.log('✅ Update request body:', requestBody);
      
      await fetchAPI(`${API_BASE_URL}/schedule/${currentSchedule.id}`, {
        method: 'PUT',
        body: JSON.stringify(requestBody)
      });
      
      setSuccess('Schedule updated successfully');
      setShowModal(false);
      resetForm();
      setCurrentSchedule(null);
      await fetchSchedules();
    } catch (err) {
      console.error('❌ Update failed:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentSchedule, formData, fetchAPI, fetchSchedules]);

  const deleteSchedule = useCallback(async (schedule) => {
    if (!confirm(`Delete schedule for ${schedule.clientName}?`)) return;
    
    try {
      setLoading(true);
      console.log('🗑️ Deleting schedule ID:', schedule.id);
      
      await fetchAPI(`${API_BASE_URL}/schedule/${schedule.id}`, {
        method: 'DELETE'
      });
      
      setSuccess('Schedule deleted successfully');
      await fetchSchedules();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, fetchSchedules]);

  const sendReport = useCallback(async () => {
    if (!reportForm.clientId) {
      setError('Please select a client');
      return;
    }

    try {
      setLoading(true);
      console.log('📧 Sending report for client:', reportForm.clientId);
      
      await fetchAPI(`${API_BASE_URL}/send-enhanced/${reportForm.clientId}`, {
        method: 'POST',
        body: JSON.stringify(reportForm)
      });
      
      setSuccess('Report sent successfully! Check your email.');
      setReportForm({
        clientId: '',
        startDate: '',
        endDate: '',
        recipientEmail: '',
        reportPeriod: 'previousWeek'
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [reportForm, fetchAPI]);

  const sendQuickReport = useCallback(async (clientId) => {
    try {
      setLoading(true);
      console.log('🚀 Sending quick report for client:', clientId);
      
      await fetchAPI(`${API_BASE_URL}/send-enhanced/${clientId}`, {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          reportPeriod: 'previousWeek'
        })
      });
      
      setSuccess('Report sent successfully!');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchAPI]);

  const viewPreview = useCallback(async (clientId) => {
    try {
      setLoading(true);
      console.log('👁️ Fetching preview for client:', clientId);
      
      const data = await fetchAPI(`${API_BASE_URL}/preview/${clientId}`);
      setPreviewData(data.data);
      setShowPreview(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchAPI]);

  // ENHANCED Historical Data Fetching
  const viewHistorical = useCallback(async () => {
    if (!historicalForm.clientId) {
      setError('Please select a client');
      return;
    }

    try {
      setLoading(true);
      console.log('📊 Fetching enhanced historical data for client:', historicalForm.clientId);
      
      const params = new URLSearchParams({
        analysisType: historicalForm.analysisType,
        groupBy: historicalForm.groupBy
      });
      
      if (historicalForm.startDate) params.append('startDate', historicalForm.startDate);
      if (historicalForm.endDate) params.append('endDate', historicalForm.endDate);
      
      const data = await fetchAPI(`${API_BASE_URL}/historical/${historicalForm.clientId}?${params}`);
      
      // Transform and enhance the data for better visualization
      const enhancedData = {
        summary: data.summary || generateSummary(data.patrols || []),
        patrols: data.patrols || [],
        trends: analyzeTrends(data.patrols || []),
        compliance: calculateCompliance(data.patrols || [], historicalForm.groupBy),
        statistics: calculateStatistics(data.patrols || [])
      };
      
      setHistoricalData(enhancedData);
      setShowHistorical(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [historicalForm, fetchAPI, generateSummary, analyzeTrends, calculateCompliance, calculateStatistics]);

  const triggerReports = useCallback(async (type = 'dynamic') => {
    try {
      setLoading(true);
      console.log(`🚀 Triggering ${type} reports...`);
      
      await fetchAPI(`${API_BASE_URL}/trigger/${type}-reports`, {
        method: 'POST'
      });
      
      setSuccess(`${type === 'dynamic' ? 'Dynamic' : 'Patrol'} reports triggered successfully`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchAPI]);

  // Refresh all data
  const refreshAllData = useCallback(() => {
    window.location.reload();
  }, []);

  // Helpers
  const resetForm = () => {
    setFormData({
      clientId: '',
      email: '',
      frequency: 1,
      intervalDays: 1,
      nextRun: ''
    });
    setCurrentSchedule(null);
  };

  const openEditModal = (schedule) => {
    console.log('🔧 Opening edit modal for schedule:', schedule);
    
    const frequency = parseInt(schedule.frequency);
    const intervalDays = parseInt(schedule.intervalDays);
    
    const validFrequency = (frequency >= 1 && frequency <= 3) ? frequency : 1;
    const validIntervalDays = (intervalDays >= 1) ? intervalDays : 1;
    
    console.log('✅ Setting form with validated values:', {
      frequency: validFrequency,
      intervalDays: validIntervalDays
    });
    
    setFormData({
      clientId: schedule.clientId,
      email: schedule.email || '',
      frequency: validFrequency,
      intervalDays: validIntervalDays,
      nextRun: schedule.nextRun ? new Date(schedule.nextRun).toISOString().slice(0, 16) : ''
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
      frequency: 1,
      intervalDays: 1,
      nextRun: defaultNextRun.toISOString().slice(0, 16)
    }));
    setModalMode('create');
    setShowModal(true);
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getFrequencyLabel = (freq) => {
    const labels = { 1: 'Daily', 2: 'Weekly', 3: 'Monthly' };
    return labels[freq] || 'Unknown';
  };

  const getStatusBadge = (nextRun) => {
    const isDue = new Date(nextRun) <= new Date();
    return isDue ? 
      <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">Due Now</span> :
      <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">Scheduled</span>;
  };

  // Filter and sort historical data
  const filteredPatrols = historicalData.patrols
    .filter(patrol => 
      patrol.ZoneCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      patrol.Content?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      patrol.Status?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];
      
      if (sortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Load initial data
  useEffect(() => {
    Promise.all([
      fetchSchedules(),
      fetchClients(),
      fetchAnalytics(),
      fetchStatus()
    ]);
  }, [fetchSchedules, fetchClients, fetchAnalytics, fetchStatus]);

  // Auto-dismiss notifications
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

  // Schedule List Item Component
  const ScheduleListItem = ({ schedule }) => (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all duration-200 hover:border-blue-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4 flex-1 min-w-0">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Calendar className="text-blue-600" size={20} />
            </div>
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-3 mb-1">
              <h3 className="font-semibold text-gray-900 text-lg truncate">{schedule.clientName}</h3>
              {schedule.nextRun && getStatusBadge(schedule.nextRun)}
            </div>
            <div className="flex items-center space-x-4 text-sm text-gray-600">
              <div className="flex items-center space-x-1">
                <Mail size={14} />
                <span className="truncate">{schedule.email}</span>
              </div>
              <div className="flex items-center space-x-1">
                <Clock size={14} />
                <span>{getFrequencyLabel(schedule.frequency)}</span>
                {schedule.intervalDays > 1 && <span>(every {schedule.intervalDays})</span>}
              </div>
              <div className="flex items-center space-x-1">
                <span>Next: {formatDateTime(schedule.nextRun)}</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
          <button
            onClick={() => sendQuickReport(schedule.clientId)}
            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
            title="Send Report Now"
          >
            <Send size={16} />
          </button>
          <button
            onClick={() => viewPreview(schedule.clientId)}
            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="Preview"
          >
            <Eye size={16} />
          </button>
          <button
            onClick={() => openEditModal(schedule)}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Edit"
          >
            <Edit size={16} />
          </button>
          <button
            onClick={() => deleteSchedule(schedule)}
            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  // Enhanced Historical Data Modal Component
  const HistoricalDataModal = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-7xl w-full my-8 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Historical Data Analysis</h3>
            <p className="text-gray-600 text-sm mt-1">
              Comprehensive view of patrol performance and trends
            </p>
          </div>
          <button
            onClick={() => setShowHistorical(false)}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XCircle size={24} />
          </button>
        </div>

        {/* View Toggle */}
        <div className="border-b border-gray-200 flex-shrink-0">
          <div className="px-6 py-3">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
              {['summary', 'trends', 'detailed'].map(view => (
                <button
                  key={view}
                  onClick={() => setHistoricalView(view)}
                  className={`px-4 py-2 rounded-md text-sm font-medium capitalize transition-colors ${
                    historicalView === view
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {view}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {historicalView === 'summary' && <SummaryView data={historicalData} />}
          {historicalView === 'trends' && <TrendsView data={historicalData} />}
          {historicalView === 'detailed' && <DetailedView 
            patrols={filteredPatrols}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
          />}
        </div>
      </div>
    </div>
  );

  // Summary View Component
  const SummaryView = ({ data }) => (
    <div className="p-6 space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg">
          <p className="text-blue-600 text-sm font-medium mb-1">Total Patrols</p>
          <p className="text-2xl font-bold text-blue-900">{data.summary?.totalPatrols || 0}</p>
        </div>
        <div className="bg-green-50 p-4 rounded-lg">
          <p className="text-green-600 text-sm font-medium mb-1">Completed</p>
          <p className="text-2xl font-bold text-green-900">{data.summary?.completedPatrols || 0}</p>
        </div>
        <div className="bg-purple-50 p-4 rounded-lg">
          <p className="text-purple-600 text-sm font-medium mb-1">Compliance Rate</p>
          <p className="text-2xl font-bold text-purple-900">{data.summary?.complianceRate || 0}%</p>
        </div>
        <div className="bg-orange-50 p-4 rounded-lg">
          <p className="text-orange-600 text-sm font-medium mb-1">Avg/Day</p>
          <p className="text-2xl font-bold text-orange-900">{data.summary?.averagePerDay || 0}</p>
        </div>
      </div>

      {/* Statistics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Zone Activity */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="font-semibold text-gray-900 mb-4">Zone Activity</h4>
          <div className="space-y-2">
            <p><span className="font-medium">Most Active Zone:</span> {data.summary?.mostActiveZone || 'N/A'}</p>
            <p><span className="font-medium">Total Zones:</span> {data.statistics?.totalZones || 0}</p>
          </div>
        </div>

        {/* Status Distribution */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="font-semibold text-gray-900 mb-4">Status Distribution</h4>
          <div className="space-y-2">
            {data.statistics?.statusDistribution && Object.entries(data.statistics.statusDistribution).map(([status, count]) => (
              <div key={status} className="flex justify-between items-center">
                <span className="capitalize">{status}:</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="font-semibold text-gray-900 mb-4">Recent Patrols</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-gray-700">Date</th>
                <th className="px-3 py-2 text-left text-gray-700">Zone</th>
                <th className="px-3 py-2 text-left text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.patrols.slice(0, 5).map((patrol, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-3 py-2">{formatDateTime(patrol.PatrolDate)}</td>
                  <td className="px-3 py-2">{patrol.ZoneCode || 'N/A'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      patrol.Status === 'Completed' 
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {patrol.Status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // Trends View Component
  const TrendsView = ({ data }) => (
    <div className="p-6 space-y-6">
      {/* Compliance Trends */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="font-semibold text-gray-900 mb-4">Compliance Trends</h4>
        <div className="space-y-3">
          {data.compliance.slice(0, 8).map((item, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <span className="text-sm text-gray-600">{item.period}</span>
              <div className="flex items-center gap-3">
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-green-500 h-2 rounded-full transition-all"
                    style={{ width: `${item.compliance}%` }}
                  ></div>
                </div>
                <span className="text-sm font-medium w-12">{item.compliance}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="font-semibold text-gray-900 mb-4">Weekly Performance</h4>
          <div className="space-y-2">
            {data.trends.slice(0, 6).map((trend, idx) => (
              <div key={idx} className="flex justify-between items-center text-sm">
                <span>{trend.period}</span>
                <div className="flex gap-4">
                  <span className="text-gray-600">{trend.completed}/{trend.total}</span>
                  <span className="font-medium">{trend.compliance}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="font-semibold text-gray-900 mb-4">Hourly Distribution</h4>
          <div className="space-y-2">
            {data.statistics?.patrolsByHour?.slice(0, 6).map((hour, idx) => (
              <div key={idx} className="flex justify-between items-center text-sm">
                <span>{hour.hour}:00 - {hour.hour + 1}:00</span>
                <span className="font-medium">{hour.count} patrols</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // Detailed View Component
  const DetailedView = ({ patrols, sortField, sortDirection, onSort, searchTerm, onSearchChange }) => (
    <div className="p-6 space-y-4">
      {/* Search and Filters */}
      <div className="flex gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search by zone, content, or status..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <div className="text-sm text-gray-600 flex items-center">
          {patrols.length} records found
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th 
                  className="px-4 py-3 text-left text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => onSort('PatrolDate')}
                >
                  <div className="flex items-center gap-1">
                    Date
                    {sortField === 'PatrolDate' && (
                      sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </div>
                </th>
                <th 
                  className="px-4 py-3 text-left text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => onSort('ZoneCode')}
                >
                  <div className="flex items-center gap-1">
                    Zone
                    {sortField === 'ZoneCode' && (
                      sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-gray-700">Content</th>
                <th 
                  className="px-4 py-3 text-left text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => onSort('Status')}
                >
                  <div className="flex items-center gap-1">
                    Status
                    {sortField === 'Status' && (
                      sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {patrols.map((patrol, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{formatDateTime(patrol.PatrolDate)}</td>
                  <td className="px-4 py-3 font-medium">{patrol.ZoneCode || 'N/A'}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{patrol.Content || 'Patrol'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      patrol.Status === 'Completed' 
                        ? 'bg-green-100 text-green-800'
                        : patrol.Status === 'Missed'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {patrol.Status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {patrols.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No patrol records found matching your search
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-20">
      {/* Fixed Top Navigation */}
      <div className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 shadow-sm z-40">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <div>
                <h1 className="text-xl font-bold text-gray-900">Security Report Scheduler</h1>
                <p className="text-gray-600 text-sm hidden sm:block">Automated patrol reports and schedule management</p>
              </div>
              
              {/* Navigation Tabs */}
              <nav className="flex gap-1">
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 text-sm font-medium ${
                    activeTab === 'dashboard'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <BarChart3 size={18} />
                  Dashboard
                </button>
                <button
                  onClick={() => setActiveTab('schedules')}
                  className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 text-sm font-medium ${
                    activeTab === 'schedules'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <Calendar size={18} />
                  Schedules
                </button>
                <button
                  onClick={() => setActiveTab('reports')}
                  className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 text-sm font-medium ${
                    activeTab === 'reports'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <Send size={18} />
                  Reports
                </button>
                <button
                  onClick={() => setActiveTab('historical')}
                  className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 text-sm font-medium ${
                    activeTab === 'historical'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <History size={18} />
                  Historical
                </button>
              </nav>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={refreshAllData}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors text-sm font-medium"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                Refresh All
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Notifications */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3 animate-fade-in">
            <CheckCircle className="text-green-600 flex-shrink-0" size={20} />
            <span className="text-green-800 font-medium">{success}</span>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 animate-fade-in">
            <XCircle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <span className="text-red-800 font-medium block">{error}</span>
            </div>
          </div>
        )}

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Analytics Cards */}
            {analytics && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-3 bg-blue-100 rounded-lg">
                      <Users className="text-blue-600" size={24} />
                    </div>
                    <TrendingUp className="text-green-500" size={20} />
                  </div>
                  <p className="text-gray-600 text-sm font-medium">Auto-Report Clients</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{analytics.summary?.activeClients || 0}</p>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-3 bg-red-100 rounded-lg">
                      <AlertCircle className="text-red-600" size={24} />
                    </div>
                    <Activity className="text-red-500" size={20} />
                  </div>
                  <p className="text-gray-600 text-sm font-medium">Due Reports</p>
                  <p className="text-3xl font-bold text-red-600 mt-1">{analytics.summary?.dueReports || 0}</p>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-3 bg-orange-100 rounded-lg">
                      <Clock className="text-orange-600" size={24} />
                    </div>
                    <Calendar className="text-orange-500" size={20} />
                  </div>
                  <p className="text-gray-600 text-sm font-medium">Upcoming (7 days)</p>
                  <p className="text-3xl font-bold text-orange-600 mt-1">{analytics.summary?.upcomingReports || 0}</p>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-3 bg-green-100 rounded-lg">
                      <BarChart3 className="text-green-600" size={24} />
                    </div>
                    <CheckCircle className="text-green-500" size={20} />
                  </div>
                  <p className="text-gray-600 text-sm font-medium">Recent Patrols</p>
                  <p className="text-3xl font-bold text-green-600 mt-1">{analytics.summary?.recentPatrols || 0}</p>
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <button
                onClick={() => setActiveTab('schedules')}
                className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all hover:border-blue-300 text-left group"
              >
                <Calendar className="text-blue-600 mb-3 group-hover:text-blue-700" size={32} />
                <h3 className="font-semibold text-gray-900 mb-2">Manage Schedules</h3>
                <p className="text-gray-600 text-sm">View and edit automated report schedules</p>
              </button>

              <button
                onClick={() => setActiveTab('reports')}
                className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all hover:border-green-300 text-left group"
              >
                <Send className="text-green-600 mb-3 group-hover:text-green-700" size={32} />
                <h3 className="font-semibold text-gray-900 mb-2">Send Manual Report</h3>
                <p className="text-gray-600 text-sm">Generate and send custom reports</p>
              </button>

              <button
                onClick={() => setActiveTab('historical')}
                className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all hover:border-purple-300 text-left group"
              >
                <History className="text-purple-600 mb-3 group-hover:text-purple-700" size={32} />
                <h3 className="font-semibold text-gray-900 mb-2">Historical Data</h3>
                <p className="text-gray-600 text-sm">Analyze past performance trends</p>
              </button>
            </div>

            {/* Manual Triggers */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Zap size={20} className="text-yellow-600" />
                Manual Triggers
              </h3>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => triggerReports('dynamic')}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                >
                  <Play size={16} />
                  Trigger Dynamic Reports
                </button>
                <button
                  onClick={() => triggerReports('patrol')}
                  disabled={loading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                >
                  <Play size={16} />
                  Trigger Patrol Reports
                </button>
              </div>
            </div>

            {/* System Status */}
            {status && (
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Server size={20} className="text-blue-600" />
                  System Status
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Total Schedules</p>
                    <p className="text-2xl font-bold text-gray-900">{status.schedules?.total || 0}</p>
                  </div>
                  <div className="p-4 bg-red-50 rounded-lg">
                    <p className="text-sm text-red-600 mb-1">Due Now</p>
                    <p className="text-2xl font-bold text-red-600">{status.schedules?.due || 0}</p>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-blue-600 mb-1">Server Time</p>
                    <p className="text-sm font-mono text-blue-900">{status.serverTime}</p>
                  </div>
                </div>
                {status.testMode && (
                  <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-yellow-800 text-sm flex items-center gap-2">
                      <AlertTriangle size={16} />
                      <strong>TEST MODE:</strong> Emails will not actually be sent
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Schedules Tab - LIST LAYOUT */}
        {activeTab === 'schedules' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Automated Schedules</h2>
                <button
                  onClick={openCreateModal}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors"
                >
                  <Plus size={16} />
                  New Schedule
                </button>
              </div>
            </div>

            <div className="p-6">
              {loading && schedules.length === 0 ? (
                <div className="text-center py-12">
                  <RefreshCw className="animate-spin mx-auto mb-4 text-gray-400" size={32} />
                  <p className="text-gray-600">Loading schedules...</p>
                </div>
              ) : schedules.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="mx-auto mb-4 text-gray-400" size={48} />
                  <p className="text-gray-600 mb-4">No schedules found</p>
                  <button
                    onClick={openCreateModal}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Create First Schedule
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {schedules.map((schedule) => (
                    <ScheduleListItem key={schedule.id} schedule={schedule} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">Send Manual Report</h2>
            
            <div className="space-y-4 max-w-2xl">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Client *</label>
                <select
                  value={reportForm.clientId}
                  onChange={(e) => setReportForm({ ...reportForm, clientId: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="previousWeek">Previous Week</option>
                  <option value="custom">Custom Range</option>
                  <option value="historical">Historical (Year to Date)</option>
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
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                    <input
                      type="date"
                      value={reportForm.endDate}
                      onChange={(e) => setReportForm({ ...reportForm, endDate: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Recipient Email (optional)</label>
                <input
                  type="email"
                  value={reportForm.recipientEmail}
                  onChange={(e) => setReportForm({ ...reportForm, recipientEmail: e.target.value })}
                  placeholder="Leave blank to use default"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={sendReport}
                  disabled={!reportForm.clientId || loading}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2 font-medium transition-colors"
                >
                  <Send size={16} />
                  {loading ? 'Sending...' : 'Send Report'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Historical Tab - ENHANCED */}
        {activeTab === 'historical' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">Historical Data Analysis</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Analysis Configuration */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Client *</label>
                  <select
                    value={historicalForm.clientId}
                    onChange={(e) => setHistoricalForm({ ...historicalForm, clientId: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select a client</option>
                    {clients.map((client) => (
                      <option key={client.ClientID} value={client.ClientID}>
                        {client.ClientName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                    <input
                      type="date"
                      value={historicalForm.startDate}
                      onChange={(e) => setHistoricalForm({ ...historicalForm, startDate: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                    <input
                      type="date"
                      value={historicalForm.endDate}
                      onChange={(e) => setHistoricalForm({ ...historicalForm, endDate: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Analysis Options */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Analysis Type</label>
                  <select
                    value={historicalForm.analysisType}
                    onChange={(e) => setHistoricalForm({ ...historicalForm, analysisType: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="compliance">Compliance Analysis</option>
                    <option value="frequency">Frequency Analysis</option>
                    <option value="performance">Performance Analysis</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Group By</label>
                  <select
                    value={historicalForm.groupBy}
                    onChange={(e) => setHistoricalForm({ ...historicalForm, groupBy: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="day">Daily</option>
                    <option value="week">Weekly</option>
                    <option value="month">Monthly</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-200">
              <button
                onClick={viewHistorical}
                disabled={!historicalForm.clientId || loading}
                className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2 font-medium transition-colors"
              >
                <History size={16} />
                {loading ? 'Analyzing Data...' : 'View Historical Analysis'}
              </button>
              
              <button
                onClick={() => {
                  // Reset form
                  setHistoricalForm({
                    clientId: '',
                    startDate: '',
                    endDate: '',
                    analysisType: 'compliance',
                    groupBy: 'week'
                  });
                }}
                className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Reset
              </button>
            </div>

            {/* Quick Stats Preview */}
            {historicalData.summary && (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h4 className="font-semibold text-gray-900 mb-3">Quick Overview</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Total Patrols</p>
                    <p className="font-semibold">{historicalData.summary.totalPatrols}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Compliance</p>
                    <p className="font-semibold">{historicalData.summary.complianceRate}%</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Avg/Day</p>
                    <p className="font-semibold">{historicalData.summary.averagePerDay}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Active Zones</p>
                    <p className="font-semibold">{historicalData.statistics?.totalZones || 0}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Frequency * <span className="text-xs text-gray-500">(Current: {formData.frequency})</span>
                </label>
                <select
                  value={formData.frequency}
                  onChange={(e) => {
                    const newFreq = parseInt(e.target.value);
                    console.log('🔄 Frequency changed to:', newFreq);
                    setFormData({ ...formData, frequency: newFreq });
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value={1}>Daily</option>
                  <option value={2}>Weekly</option>
                  <option value={3}>Monthly</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Interval Days <span className="text-xs text-gray-500">(Current: {formData.intervalDays})</span>
                </label>
                <input
                  type="number"
                  min="1"
                  value={formData.intervalDays}
                  onChange={(e) => {
                    const newInterval = parseInt(e.target.value) || 1;
                    console.log('🔄 Interval changed to:', newInterval);
                    setFormData({ ...formData, intervalDays: newInterval });
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Next Run *</label>
                <input
                  type="datetime-local"
                  value={formData.nextRun}
                  onChange={(e) => setFormData({ ...formData, nextRun: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={modalMode === 'create' ? createSchedule : updateSchedule}
                disabled={!formData.clientId || !formData.email || !formData.nextRun || loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Saving...' : modalMode === 'create' ? 'Create' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && previewData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full my-8">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-xl font-semibold text-gray-900">Report Preview - {previewData.clientName}</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XCircle size={24} />
              </button>
            </div>
            
            <div className="p-6 max-h-[70vh] overflow-y-auto">
              <div className="bg-blue-50 p-4 rounded-lg mb-6">
                <h4 className="font-semibold text-blue-900 mb-3">Summary</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-blue-600">Total Patrols</p>
                    <p className="text-2xl font-bold text-blue-900">{previewData.summary?.totalCompleted || 0}</p>
                  </div>
                  <div>
                    <p className="text-blue-600">Compliance</p>
                    <p className="text-2xl font-bold text-blue-900">{previewData.summary?.complianceRate || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {previewData.patrols?.past?.sample && (
                <div className="mb-6">
                  <h4 className="font-semibold text-gray-900 mb-3">Recent Patrols</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-700">Date</th>
                          <th className="px-3 py-2 text-left text-gray-700">Zone</th>
                          <th className="px-3 py-2 text-left text-gray-700">Event</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {previewData.patrols.past.sample.map((patrol, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-3 py-2">{formatDateTime(patrol.PatrolDate)}</td>
                            <td className="px-3 py-2">{patrol.ZoneCode || 'N/A'}</td>
                            <td className="px-3 py-2 text-gray-600">{patrol.Content || 'Patrol'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowPreview(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Historical Data Modal */}
      {showHistorical && <HistoricalDataModal />}

      <style>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
};

export default EnhancedScheduler;