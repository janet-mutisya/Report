import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Calendar, Clock, Mail, RefreshCw, Send, FileText, 
  CheckCircle, XCircle, Plus, Trash2, Edit, 
  Eye, Search, ChevronDown, ChevronUp,
  Shield, AlertCircle, Zap, Play, Pause,
  Users, BarChart3, Settings, Download, Filter,
  Bell, BellOff, Database, Upload, EyeOff
} from 'lucide-react';

// API Configuration
const API_BASE_URL = 'http://localhost:5000/api';

const SecurityReportsPage = () => {
  // State Management
  const [schedules, setSchedules] = useState([]);
  const [clients, setClients] = useState([]);
  const [allClients, setAllClients] = useState([]); // Store all clients for filtering
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [clientSearchQuery, setClientSearchQuery] = useState(''); // Search for client dropdown
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'clientName', direction: 'asc' });
  const [analytics, setAnalytics] = useState(null);
  
  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [currentSchedule, setCurrentSchedule] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  
  // Form State - Updated with custom date fields
  const [formData, setFormData] = useState({
    clientId: '',
    email: '',
    emails: '',
    frequency: 1,
    intervalDays: 1,
    nextRun: '',
    isActive: true,
    reportPeriod: 'previousWeek',
    customStartDate: '',
    customEndDate: ''
  });
  
  const [reportForm, setReportForm] = useState({
    clientId: '',
    startDate: '',
    endDate: '',
    reportPeriod: 'previousWeek',
    recipientEmail: '',
    updateSchedule: true
  });

  // UI State
  const [showManualReport, setShowManualReport] = useState(false);
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [selectedSchedules, setSelectedSchedules] = useState(new Set());
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [emailSendingEnabled, setEmailSendingEnabled] = useState(true);
  
  // Active updates tracking
  const [updatingSchedules, setUpdatingSchedules] = useState({});
  const [activePolling, setActivePolling] = useState(true);
  const [emailStats, setEmailStats] = useState(null);

  // Refs
  const healthCheckInProgress = useRef(false);
  const initializationCompleted = useRef(false);
  const refreshInterval = useRef(null);
  const lastRefreshTime = useRef(Date.now());

  // Helper Functions
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

  const getStatusBadge = (schedule) => {
    if (!schedule.nextRun) {
      return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">No Schedule</span>;
    }
    
    try {
      if (schedule.isActive === false) {
        return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">Paused</span>;
      }
      
      const isDue = new Date(schedule.nextRun) <= new Date();
      return isDue ? 
        <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">Due Now</span> :
        <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">Scheduled</span>;
    } catch {
      return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">Invalid Date</span>;
    }
  };

  const getTimeUntilNextRun = (nextRun) => {
    if (!nextRun) return 'N/A';
    try {
      const now = new Date();
      const next = new Date(nextRun);
      const diffMs = next - now;
      
      if (diffMs <= 0) return 'Now';
      
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      
      if (diffHours > 0) {
        return `in ${diffHours}h ${diffMinutes}m`;
      }
      return `in ${diffMinutes}m`;
    } catch {
      return 'N/A';
    }
  };

  const resetForm = () => {
    setFormData({
      clientId: '',
      email: '',
      emails: '',
      frequency: 1,
      intervalDays: 1,
      nextRun: '',
      isActive: true,
      reportPeriod: 'previousWeek',
      customStartDate: '',
      customEndDate: ''
    });
    setCurrentSchedule(null);
    setClientSearchQuery('');
  };

  const openEditModal = (schedule) => {
    setFormData({
      clientId: schedule.clientId,
      email: schedule.email || '',
      emails: schedule.emails || schedule.email || '',
      frequency: parseInt(schedule.frequency) || 1,
      intervalDays: parseInt(schedule.intervalDays) || 1,
      nextRun: schedule.nextRun ? new Date(schedule.nextRun).toISOString().slice(0, 16) : '',
      isActive: schedule.isActive !== false,
      reportPeriod: schedule.reportPeriod || 'previousWeek',
      customStartDate: schedule.customStartDate || '',
      customEndDate: schedule.customEndDate || ''
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

  const filterAndSortSchedules = useCallback(() => {
    let filtered = [...schedules];

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(schedule => {
        const clientName = schedule.clientName?.toLowerCase() || '';
        const email = schedule.email?.toLowerCase() || '';
        const emails = schedule.emails?.toLowerCase() || '';
        return clientName.includes(term) || email.includes(term) || emails.includes(term);
      });
    }

    if (filterStatus !== 'all') {
      filtered = filtered.filter(schedule => {
        if (!schedule.nextRun) return false;
        if (filterStatus === 'paused') return schedule.isActive === false;
        if (filterStatus === 'active') return schedule.isActive !== false;
        
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

  // Filter clients based on search query
  const filterClients = useCallback((query) => {
    if (!query || query.trim().length < 2) {
      setClients(allClients);
      return;
    }
    
    const searchTerm = query.toLowerCase().trim();
    const filtered = allClients.filter(clientItem => {
      const name = clientItem.name || clientItem.cue_cnombre || "";
      const account = clientItem.accountNumber || "";
      return name.toLowerCase().includes(searchTerm) || 
             account.toLowerCase().includes(searchTerm);
    });
    
    console.log(`🔍 Filtered to ${filtered.length} clients for: "${query}"`);
    setClients(filtered);
  }, [allClients]);

  // Handle client search input change with debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      filterClients(clientSearchQuery);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [clientSearchQuery, filterClients]);

  const filteredSchedules = filterAndSortSchedules();

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const toggleScheduleSelection = (scheduleId) => {
    const newSelection = new Set(selectedSchedules);
    if (newSelection.has(scheduleId)) {
      newSelection.delete(scheduleId);
    } else {
      newSelection.add(scheduleId);
    }
    setSelectedSchedules(newSelection);
  };

  const selectAllSchedules = () => {
    if (selectedSchedules.size === filteredSchedules.length) {
      setSelectedSchedules(new Set());
    } else {
      setSelectedSchedules(new Set(filteredSchedules.map(s => s.id)));
    }
  };

  // Toggle Functions
  const toggleAutoRefresh = useCallback(() => {
    setActivePolling(prev => !prev);
    if (activePolling) {
      setSuccess('Auto-refresh paused');
    } else {
      setSuccess('Auto-refresh enabled (every 30 seconds)');
    }
  }, [activePolling]);

  // API Helper Function
  const fetchAPI = useCallback(async (url, options = {}, retryCount = 0, maxRetries = 2) => {
    try {
      console.log(`🌐 API Call: ${options.method || 'GET'} ${url}`);
      
      if (!options.method || options.method === 'GET') {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (response.status === 429) {
        if (retryCount < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
          console.log(`⏳ Rate limited, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return fetchAPI(url, options, retryCount + 1, maxRetries);
        }
        throw new Error(`Rate limit exceeded. Please wait before trying again.`);
      }

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
      return data;
    } catch (fetchError) {
      console.error('❌ API Error:', fetchError);
      if (fetchError.message.includes('Failed to fetch')) {
        throw new Error('Cannot connect to backend server. Make sure backend is running on http://localhost:5000');
      }
      throw fetchError;
    }
  }, []);

  // Health Check
  const checkBackendHealth = useCallback(async () => {
    if (healthCheckInProgress.current) {
      return false;
    }

    healthCheckInProgress.current = true;
    
    try {
      const health = await fetchAPI(`${API_BASE_URL}/scheduler/health`);
      console.log('✅ Backend health:', health);
      
      if (health.emailFeatures) {
        setEmailSendingEnabled(health.emailFeatures.enabled || false);
      }
      
      return true;
    } catch (healthError) {
      console.error('❌ Backend health check failed:', healthError);
      setError('Backend server is not responding. Make sure the backend is running on http://localhost:5000');
      return false;
    } finally {
      setTimeout(() => {
        healthCheckInProgress.current = false;
      }, 100);
    }
  }, [fetchAPI]);

  // ✅ FIXED: Load all clients
  const fetchAllClients = useCallback(async () => {
    try {
      console.log('📊 Fetching ALL clients...');
      setError(null);

      const response = await fetch(`${API_BASE_URL}/clients`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data || !Array.isArray(data.clients)) {
        console.warn("Unexpected response format:", data);
        throw new Error('Invalid clients response format');
      }

      console.log(`✅ Loaded ${data.clients.length} clients`);

      setAllClients(data.clients);
      setClients(data.clients);

    } catch (error) {
      console.error('❌ Failed to fetch clients:', error);
      setError(`Failed to load clients: ${error.message}`);
      setAllClients([]);
      setClients([]);
    }
  }, []);

  // ✅ FIXED: Fetch schedules, analytics, and email stats (NO CLIENTS)
  const fetchAllData = useCallback(async () => {
    try {
      setLoading(true);
      lastRefreshTime.current = Date.now();
      console.log('🔄 Fetching schedules and analytics...');
      
      // Fetch schedules
      const schedulesResponse = await fetchAPI(`${API_BASE_URL}/scheduler`);
      setSchedules(schedulesResponse.schedules || []);
      
      // Fetch analytics
      const analyticsResponse = await fetchAPI(`${API_BASE_URL}/scheduler/analytics/summary`);
      setAnalytics(analyticsResponse.analytics || null);
      
      // Fetch email stats
      const emailStatsResponse = await fetchAPI(`${API_BASE_URL}/scheduler/utils/email-stats`);
      setEmailStats(emailStatsResponse.stats || null);
      
      console.log('✅ All data fetched');
    } catch (err) {
      console.error('❌ Fetch error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchAPI]);

  // Auto-refresh
  const autoRefreshData = useCallback(async () => {
    if (!activePolling || loading) {
      return;
    }

    const timeSinceLastRefresh = Date.now() - lastRefreshTime.current;
    if (timeSinceLastRefresh < 30000) {
      return;
    }

    try {
      console.log('🔄 Auto-refreshing data...');
      
      const schedulesResponse = await fetchAPI(`${API_BASE_URL}/scheduler`);
      setSchedules(schedulesResponse.schedules || []);
      lastRefreshTime.current = Date.now();
      
      console.log('✅ Auto-refresh completed');
    } catch (refreshError) {
      console.error('❌ Auto-refresh error:', refreshError);
    }
  }, [activePolling, loading, fetchAPI]);

  // Toggle Email Sending
  const toggleEmailSending = useCallback(async () => {
    try {
      const newState = !emailSendingEnabled;
      console.log(`🛑 Toggling email sending to: ${newState ? 'ENABLED' : 'DISABLED'}`);
      
      await fetchAPI(`${API_BASE_URL}/scheduler/toggle-email`, {
        method: 'POST',
        body: JSON.stringify({ enabled: newState })
      });
      
      setEmailSendingEnabled(newState);
      setSuccess(`Email sending ${newState ? 'enabled' : 'disabled'} globally`);
      fetchAllData();
    } catch (error) {
      console.error('❌ Toggle email error:', error);
      setError(error.message || 'Failed to toggle email sending');
    }
  }, [emailSendingEnabled, fetchAPI, fetchAllData]);

  // Schedule Management
  const createSchedule = useCallback(async () => {
    try {
      if (!formData.clientId || !formData.emails || !formData.nextRun) {
        setError('Please fill in all required fields');
        return;
      }

      if (formData.reportPeriod === 'custom') {
        if (!formData.customStartDate || !formData.customEndDate) {
          setError('Please select start and end dates for custom range');
          return;
        }
      }

      const requestBody = {
        clientId: parseInt(formData.clientId),
        emails: formData.emails.trim(),
        frequency: parseInt(formData.frequency),
        intervalDays: parseInt(formData.intervalDays) || 1,
        nextRun: formData.nextRun,
        type: 1,
        reportPeriod: formData.reportPeriod
      };
      
      if (formData.reportPeriod === 'custom') {
        requestBody.customStartDate = formData.customStartDate;
        requestBody.customEndDate = formData.customEndDate;
      }
      
      console.log('📤 Creating schedule:', requestBody);
      
      await fetchAPI(`${API_BASE_URL}/scheduler`, {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      
      setSuccess('Schedule created successfully');
      setShowModal(false);
      resetForm();
      fetchAllData();
    } catch (createError) {
      console.error('❌ Create schedule error:', createError);
      setError(createError.message || 'Failed to create schedule');
    }
  }, [formData, fetchAPI, fetchAllData]);

  const updateSchedule = useCallback(async () => {
    try {
      if (!currentSchedule || !formData.emails || !formData.nextRun) {
        setError('Please fill in all required fields');
        return;
      }

      if (formData.reportPeriod === 'custom') {
        if (!formData.customStartDate || !formData.customEndDate) {
          setError('Please select start and end dates for custom range');
          return;
        }
      }

      const requestBody = {
        emails: formData.emails.trim(),
        frequency: parseInt(formData.frequency),
        intervalDays: parseInt(formData.intervalDays) || 1,
        nextRun: formData.nextRun,
        reportPeriod: formData.reportPeriod
      };
      
      if (formData.reportPeriod === 'custom') {
        requestBody.customStartDate = formData.customStartDate;
        requestBody.customEndDate = formData.customEndDate;
      }
      
      console.log('📤 Updating schedule:', requestBody);
      
      await fetchAPI(`${API_BASE_URL}/scheduler/${currentSchedule.id}`, {
        method: 'PUT',
        body: JSON.stringify(requestBody)
      });
      
      setSuccess('Schedule updated successfully');
      setShowModal(false);
      resetForm();
      setCurrentSchedule(null);
      fetchAllData();
    } catch (updateError) {
      console.error('❌ Update failed:', updateError);
      setError(updateError.message || 'Failed to update schedule');
    }
  }, [currentSchedule, formData, fetchAPI, fetchAllData]);

  const deleteSchedule = useCallback(async (schedule) => {
    if (!window.confirm(`Are you sure you want to delete the schedule for ${schedule.clientName}?`)) return;
    
    try {
      console.log(`🗑️ Deleting schedule ${schedule.id}`);
      
      await fetchAPI(`${API_BASE_URL}/scheduler/${schedule.id}`, {
        method: 'DELETE'
      });
      
      setSuccess('Schedule deleted successfully');
      fetchAllData();
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete schedule');
    }
  }, [fetchAPI, fetchAllData]);

  // Schedule Actions
  const advanceSchedule = useCallback(async (scheduleId) => {
    try {
      setUpdatingSchedules(prev => ({ ...prev, [scheduleId]: true }));
      console.log(`⏭️ Advancing schedule ${scheduleId}`);
      
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      
      const newNextRun = tomorrow.toISOString().slice(0, 16);
      
      await fetchAPI(`${API_BASE_URL}/scheduler/${scheduleId}`, {
        method: 'PUT',
        body: JSON.stringify({
          nextRun: newNextRun
        })
      });
      
      setSuccess(`Schedule advanced. Next run: ${formatDateTime(newNextRun)}`);
      fetchAllData();
    } catch (advanceError) {
      console.error('❌ Advance schedule error:', advanceError);
      setError(advanceError.message || 'Failed to advance schedule');
    } finally {
      setUpdatingSchedules(prev => ({ ...prev, [scheduleId]: false }));
    }
  }, [fetchAPI, fetchAllData]);

  const toggleScheduleActive = useCallback(async (scheduleId, isActive) => {
    try {
      setUpdatingSchedules(prev => ({ ...prev, [scheduleId]: true }));
      console.log(`🔧 ${isActive ? 'Activating' : 'Deactivating'} schedule ${scheduleId}`);
      
      const schedule = schedules.find(s => s.id === scheduleId);
      if (!schedule) {
        throw new Error('Schedule not found');
      }
      
      await fetchAPI(`${API_BASE_URL}/scheduler/${scheduleId}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...schedule,
          isActive
        })
      });
      
      setSuccess(`Schedule ${isActive ? 'activated' : 'deactivated'} successfully`);
      fetchAllData();
    } catch (toggleError) {
      console.error('❌ Toggle schedule error:', toggleError);
      setError(toggleError.message || 'Failed to update schedule status');
    } finally {
      setUpdatingSchedules(prev => ({ ...prev, [scheduleId]: false }));
    }
  }, [schedules, fetchAPI, fetchAllData]);

  // Report Functions
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
        clientId: parseInt(reportForm.clientId),
        recipientEmail: reportForm.recipientEmail || '',
        period: reportForm.reportPeriod,
        updateSchedule: reportForm.updateSchedule
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
      
      const response = await fetchAPI(`${API_BASE_URL}/scheduler/trigger/patrol-reports`, {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      
      console.log('✅ Report response:', response);
      
      let successMessage = response.message || 'Report sent successfully! Check your email.';
      
      if (response.data?.email?.error) {
        successMessage += ` (Email failed: ${response.data.email.error})`;
      } else if (!emailSendingEnabled) {
        successMessage += ' (Email sending is disabled)';
      }
      
      setSuccess(successMessage);
      
      // Reset form
      setReportForm({
        clientId: '',
        startDate: '',
        endDate: '',
        reportPeriod: 'previousWeek',
        recipientEmail: '',
        updateSchedule: true
      });
      setShowManualReport(false);
      
      fetchAllData();
    } catch (reportError) {
      console.error('❌ Send report error:', reportError);
      setError(reportError.message || 'Failed to send report');
    } finally {
      setIsSendingReport(false);
    }
  }, [reportForm, fetchAPI, emailSendingEnabled, fetchAllData]);

  const sendQuickReport = useCallback(async (schedule) => {
    try {
      setUpdatingSchedules(prev => ({ ...prev, [schedule.id]: true }));
      console.log('🚀 Sending quick report for:', schedule.clientName);
      
      const response = await fetchAPI(`${API_BASE_URL}/scheduler/trigger/patrol-reports`, {
        method: 'POST',
        body: JSON.stringify({
          clientId: schedule.clientId,
          recipientEmail: schedule.email || schedule.emails
        })
      });
      
      let successMessage = 'Quick report sent! ';
      if (response.data?.email?.error) {
        successMessage += `(Email failed: ${response.data.email.error})`;
      } else if (!emailSendingEnabled) {
        successMessage += '(Email sending is disabled)';
      }
      
      setSuccess(successMessage);
      fetchAllData();
    } catch (quickError) {
      console.error('❌ Quick report error:', quickError);
      setError(quickError.message || 'Failed to send quick report');
    } finally {
      setUpdatingSchedules(prev => ({ ...prev, [schedule.id]: false }));
    }
  }, [fetchAPI, emailSendingEnabled, fetchAllData]);

  const triggerBulkReports = useCallback(async () => {
    try {
      setLoading(true);
      console.log('🚀 Triggering bulk reports for all due schedules');
      
      const response = await fetchAPI(`${API_BASE_URL}/scheduler/trigger/patrol-reports`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      
      setSuccess(`Bulk reports triggered: ${response.message || 'Success'}`);
      fetchAllData();
    } catch (bulkError) {
      console.error('❌ Bulk report error:', bulkError);
      setError(bulkError.message || 'Failed to trigger bulk reports');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, fetchAllData]);

  const viewPreview = useCallback(async (clientId) => {
    try {
      console.log('👁️ Fetching preview for client:', clientId);
      const previewData = await fetchAPI(`${API_BASE_URL}/scheduler/analytics/client/${clientId}?days=7`);
      setPreviewData(previewData);
      setShowPreview(true);
    } catch (previewError) {
      console.error('❌ Preview error:', previewError);
      setError(previewError.message || 'Failed to load preview');
    }
  }, [fetchAPI]);

  // Bulk Operations
  const bulkResetNextRun = useCallback(async () => {
    if (selectedSchedules.size === 0) {
      setError('Please select at least one schedule');
      return;
    }

    try {
      setLoading(true);
      const scheduleIds = Array.from(selectedSchedules);
      
      const response = await fetchAPI(`${API_BASE_URL}/scheduler/bulk/reset-next-run`, {
        method: 'POST',
        body: JSON.stringify({ scheduleIds })
      });
      
      const successCount = response.summary?.success || 0;
      setSuccess(`Reset next run for ${successCount} schedule(s)`);
      setSelectedSchedules(new Set());
      setShowBulkActions(false);
      fetchAllData();
    } catch (bulkError) {
      console.error('❌ Bulk reset error:', bulkError);
      setError(bulkError.message || 'Failed to reset schedules');
    } finally {
      setLoading(false);
    }
  }, [selectedSchedules, fetchAPI, fetchAllData]);

  // Handle manual refresh of clients
  const handleRefreshClients = () => {
    console.log("🔄 Refreshing clients...");
    setClientSearchQuery("");
    fetchAllClients();
  };

  // Handle clear client search
  const handleClearClientSearch = () => {
    setClientSearchQuery("");
    setClients(allClients);
  };

  // ✅ FIXED: Effects - Proper initialization
  useEffect(() => {
    if (initializationCompleted.current) {
      return;
    }

    let mounted = true;

    const initializeApp = async () => {
      try {
        console.log('🔧 Initializing application...');
        
        // ✅ FIRST: Check backend health
        const isHealthy = await checkBackendHealth();
        
        if (mounted && isHealthy) {
          console.log('🔄 Fetching initial data...');
          
          // ✅ IMPORTANT: Fetch clients FIRST, independently
          await fetchAllClients();
          
          // ✅ Then fetch other data
          await fetchAllData();
          
          if (mounted) {
            initializationCompleted.current = true;
            console.log('🎉 Application initialization completed');
          }
        }
      } catch (initError) {
        if (mounted) {
          console.error('❌ Initialization error:', initError);
          setError(`Initialization failed: ${initError.message}`);
        }
      }
    };

    const timer = setTimeout(() => {
      initializeApp();
    }, 100);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [checkBackendHealth, fetchAllClients, fetchAllData]);

  // Auto-refresh interval
  useEffect(() => {
    if (activePolling) {
      refreshInterval.current = setInterval(autoRefreshData, 10000);
    } else if (refreshInterval.current) {
      clearInterval(refreshInterval.current);
      refreshInterval.current = null;
    }

    return () => {
      if (refreshInterval.current) {
        clearInterval(refreshInterval.current);
      }
    };
  }, [activePolling, autoRefreshData]);

  // Clear notifications
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

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (refreshInterval.current) {
        clearInterval(refreshInterval.current);
      }
    };
  }, []);

  // The JSX return statement remains exactly the same as in your original code
  // (From the header down to the preview modal)
  // ... [All the JSX code remains exactly the same] ...

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
                <h1 className="text-2xl font-bold text-gray-900">Security Reports Scheduler</h1>
                <p className="text-sm text-gray-600">Optimized Report Model Integration</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <button
                onClick={toggleAutoRefresh}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                  activePolling 
                    ? 'bg-green-600 text-white hover:bg-green-700' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {activePolling ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Auto-refresh ON
                  </>
                ) : (
                  <>
                    <Pause size={16} />
                    Auto-refresh OFF
                  </>
                )}
              </button>
              
              <button
                onClick={toggleEmailSending}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                  emailSendingEnabled
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {emailSendingEnabled ? (
                  <>
                    <BellOff size={16} />
                    Disable Emails
                  </>
                ) : (
                  <>
                    <Bell size={16} />
                    Enable Emails
                  </>
                )}
              </button>
              
              <button
                onClick={fetchAllData}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 flex items-center gap-2 transition-colors"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                {loading ? 'Refreshing...' : 'Refresh All'}
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
            <CheckCircle className="text-green-600 shrink-0" size={20} />
            <span className="text-green-800 font-medium">{success}</span>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <XCircle className="text-red-600 shrink-0 mt-0.5" size={20} />
            <span className="text-red-800 font-medium">{error}</span>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6 border border-blue-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Schedules</p>
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
                <p className="text-sm text-gray-600">Email Recipients</p>
                <p className="text-2xl font-bold text-gray-900">
                  {emailStats?.totalEmailRecipients || 0}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {emailStats?.averagePerSchedule || 1} per schedule
                </p>
              </div>
              <div className="p-3 bg-purple-100 rounded-lg">
                <Users className="text-purple-600" size={24} />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-orange-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Due Reports</p>
                <p className="text-2xl font-bold text-gray-900">
                  {analytics?.summary?.dueReports || 0}
                </p>
              </div>
              <div className="p-3 bg-orange-100 rounded-lg">
                <AlertCircle className="text-orange-600" size={24} />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-green-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Email Status</p>
                <p className="text-2xl font-bold text-gray-900">
                  {emailSendingEnabled ? 'ENABLED' : 'DISABLED'}
                </p>
              </div>
              <div className="p-3 bg-green-100 rounded-lg">
                {emailSendingEnabled ? (
                  <Bell className="text-green-600" size={24} />
                ) : (
                  <BellOff className="text-red-600" size={24} />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Client Refresh Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Clients Database</h3>
              <p className="text-sm text-gray-600">
                {clients.length} of {allClients.length} clients shown • Last refresh: {new Date(lastRefreshTime.current).toLocaleTimeString()}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm">
                <span className="text-gray-500">Showing: </span>
                <span className="font-medium">{clients.length} clients</span>
              </div>
              <button
                onClick={handleRefreshClients}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors"
              >
                <RefreshCw size={16} />
                Refresh Clients
              </button>
            </div>
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {selectedSchedules.size > 0 && (
          <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-100 rounded-lg">
                  <Settings className="text-yellow-600" size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-yellow-900">
                    {selectedSchedules.size} schedule(s) selected
                  </h3>
                  <p className="text-sm text-yellow-700">
                    Perform bulk actions on selected schedules
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={bulkResetNextRun}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center gap-2"
                >
                  <RefreshCw size={16} />
                  Reset Next Run
                </button>
                <button
                  onClick={() => {
                    setSelectedSchedules(new Set());
                    setShowBulkActions(false);
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Manual Report Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Manual Report Generator</h2>
              <p className="text-sm text-gray-600 mt-1">Generate and send patrol reports on demand</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={triggerBulkReports}
                disabled={loading}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-purple-400 flex items-center gap-2"
              >
                <Send size={16} />
                Run All Due Schedules
              </button>
              <button
                onClick={() => setShowManualReport(!showManualReport)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
              >
                {showManualReport ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {showManualReport ? 'Hide' : 'Show Manual Report'}
              </button>
            </div>
          </div>
          
          {showManualReport && (
            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-4">
                  {/* Client Search for Manual Report */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Client Search *
                    </label>
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        value={clientSearchQuery}
                        onChange={(e) => setClientSearchQuery(e.target.value)}
                        placeholder="Search client name or account..."
                        className="flex-1 border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && clientSearchQuery.trim().length >= 2) {
                            filterClients(clientSearchQuery);
                          }
                        }}
                      />
                      <button
                        onClick={() => filterClients(clientSearchQuery)}
                        disabled={!clientSearchQuery || clientSearchQuery.trim().length < 2}
                        className="flex items-center gap-2 bg-blue-600 text-white rounded-lg px-4 py-2.5 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all shrink-0"
                      >
                        <Search size={16} />
                        Search
                      </button>
                      <button
                        onClick={handleClearClientSearch}
                        disabled={!clientSearchQuery}
                        className="flex items-center gap-2 bg-gray-200 text-gray-700 rounded-lg px-4 py-2.5 hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 transition-all shrink-0"
                      >
                        <XCircle size={16} />
                        Clear
                      </button>
                    </div>
                    
                    <select
                      value={reportForm.clientId}
                      onChange={(e) => setReportForm({ ...reportForm, clientId: e.target.value })}
                      disabled={isSendingReport}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    >
                      <option value="">Select a client</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name || client.cue_cnombre} 
                          {client.accountNumber ? ` (${client.accountNumber})` : ""}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      {clientSearchQuery && clientSearchQuery.trim().length >= 2 
                        ? `Showing ${clients.length} of ${allClients.length} clients matching "${clientSearchQuery}"`
                        : `Showing all ${allClients.length} clients`}
                    </p>
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
                      <option value="last7days">Last 7 Days</option>
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
                      placeholder="Leave blank to use schedule emails"
                      disabled={isSendingReport}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                    <input
                      type="checkbox"
                      id="updateSchedule"
                      checked={reportForm.updateSchedule}
                      onChange={(e) => setReportForm({ ...reportForm, updateSchedule: e.target.checked })}
                      disabled={isSendingReport}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="updateSchedule" className="text-sm text-gray-700">
                      Update schedule's next run time
                    </label>
                  </div>

                  <button
                    onClick={sendReport}
                    disabled={!reportForm.clientId || isSendingReport}
                    className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium transition-colors"
                  >
                    {isSendingReport ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        Generating Report...
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        Generate & Send Report
                      </>
                    )}
                  </button>
                </div>

                <div className="bg-blue-50 p-6 rounded-lg">
                  <h3 className="font-semibold text-blue-900 mb-4">Report Features</h3>
                  <ul className="space-y-3 text-sm text-blue-800">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="text-green-500 mt-0.5 shrink-0" size={16} />
                      <span>Multiple email recipients per schedule</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="text-green-500 mt-0.5 shrink-0" size={16} />
                      <span>Optimized report model with API-first approach</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="text-green-500 mt-0.5 shrink-0" size={16} />
                      <span>Duplicate report prevention (2-min cooldown)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="text-green-500 mt-0.5 shrink-0" size={16} />
                      <span>Global email toggle: {emailSendingEnabled ? 'ENABLED' : 'DISABLED'}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="text-green-500 mt-0.5 shrink-0" size={16} />
                      <span>Custom date ranges support</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Database className="text-blue-500 mt-0.5 shrink-0" size={16} />
                      <span>Multi-table data sources with automatic fallback</span>
                    </li>
                  </ul>
                  
                  <div className="mt-6 p-4 bg-white rounded-lg border border-blue-200">
                    <h4 className="font-semibold text-gray-900 mb-2">Email Format Tips</h4>
                    <ul className="space-y-2 text-xs text-gray-600">
                      <li>• Multiple emails: <code className="bg-gray-100 px-1">email1@example.com, email2@example.com</code></li>
                      <li>• Or use semicolons: <code className="bg-gray-100 px-1">email1@example.com; email2@example.com</code></li>
                      <li>• Or newlines for long lists</li>
                      <li>• System validates and parses automatically</li>
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
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Automated Report Schedules</h2>
                <p className="text-sm text-gray-600 mt-1">
                  {activePolling ? 'Auto-refresh enabled (every 30s)' : 'Auto-refresh paused'}
                  • Last refresh: {new Date(lastRefreshTime.current).toLocaleTimeString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowBulkActions(!showBulkActions)}
                  className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                    showBulkActions
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  <Settings size={16} />
                  Bulk Actions
                </button>
              </div>
            </div>
          </div>

          <div className="p-6">
            {/* Search and Filters */}
            <div className="mb-6 flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  placeholder="Search clients or emails..."
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
                <option value="active">Active Only</option>
                <option value="due">Due Now</option>
                <option value="scheduled">Scheduled</option>
                <option value="paused">Paused</option>
              </select>
              <button
                onClick={() => handleSort('clientName')}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
              >
                {sortConfig.direction === 'asc' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                Sort
              </button>
            </div>

            {/* Bulk Selection Header */}
            {showBulkActions && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selectedSchedules.size === filteredSchedules.length && filteredSchedules.length > 0}
                  onChange={selectAllSchedules}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-700">
                  {selectedSchedules.size === 0 
                    ? 'Select schedules for bulk actions' 
                    : `${selectedSchedules.size} selected`
                  }
                </span>
              </div>
            )}

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
                  <div 
                    key={schedule.id} 
                    className={`bg-white border ${schedule.isActive === false ? 'border-gray-300' : 'border-gray-200'} rounded-xl p-6 hover:shadow-lg transition-all ${schedule.isActive === false ? 'opacity-75' : ''} ${selectedSchedules.has(schedule.id) ? 'ring-2 ring-blue-500' : ''}`}
                  >
                    {showBulkActions && (
                      <div className="mb-4">
                        <input
                          type="checkbox"
                          checked={selectedSchedules.has(schedule.id)}
                          onChange={() => toggleScheduleSelection(schedule.id)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                      </div>
                    )}
                    
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="font-semibold text-gray-900">{schedule.clientName}</h3>
                        <div className="mt-1">{getStatusBadge(schedule)}</div>
                      </div>
                      <div className="text-xs text-gray-500">
                        {schedule.accountNumber && `Acc: ${schedule.accountNumber}`}
                      </div>
                    </div>

                    <div className="space-y-3 mb-4">
                      <div className="flex items-start text-sm text-gray-600">
                        <Mail size={16} className="mr-2 mt-0.5 shrink-0" />
                        <div>
                          <div className="font-medium">Emails ({schedule.emailCount || 1})</div>
                          <div className="text-xs text-gray-500 truncate">
                            {schedule.formattedEmails || schedule.email || 'No email configured'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start text-sm text-gray-600">
                        <Clock size={16} className="mr-2 mt-0.5 shrink-0" />
                        <div>
                          <div className="font-medium">Next Run</div>
                          <div>{formatDateTime(schedule.nextRun)}</div>
                          {schedule.nextRun && schedule.isActive !== false && (
                            <div className="text-xs text-gray-500">
                              {getTimeUntilNextRun(schedule.nextRun)}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-sm text-gray-600">
                        <div className="font-medium">Frequency</div>
                        <div>{getFrequencyLabel(schedule.frequency)}</div>
                        {schedule.lastRun && (
                          <div className="text-xs text-gray-500">
                            Last run: {formatDateTime(schedule.lastRun)}
                          </div>
                        )}
                      </div>
                      {schedule.reportPeriod && (
                        <div className="text-sm text-gray-600">
                          <div className="font-medium">Report Period</div>
                          <div className="capitalize">{schedule.reportPeriod.replace(/([A-Z])/g, ' $1').trim()}</div>
                          {schedule.reportPeriod === 'custom' && schedule.customStartDate && schedule.customEndDate && (
                            <div className="text-xs text-gray-500">
                              {schedule.customStartDate} to {schedule.customEndDate}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between pt-4 border-t">
                      <div className="flex gap-2">
                        <button
                          onClick={() => sendQuickReport(schedule)}
                          disabled={updatingSchedules[schedule.id]}
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-50"
                          title="Send Report Now"
                        >
                          {updatingSchedules[schedule.id] ? (
                            <RefreshCw size={18} className="animate-spin" />
                          ) : (
                            <Send size={18} />
                          )}
                        </button>
                        <button
                          onClick={() => advanceSchedule(schedule.id)}
                          disabled={updatingSchedules[schedule.id]}
                          className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg disabled:opacity-50"
                          title="Advance Schedule"
                        >
                          {updatingSchedules[schedule.id] ? (
                            <RefreshCw size={18} className="animate-spin" />
                          ) : (
                            <Zap size={18} />
                          )}
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
                          onClick={() => toggleScheduleActive(schedule.id, !(schedule.isActive !== false))}
                          disabled={updatingSchedules[schedule.id]}
                          className={`p-2 rounded-lg ${schedule.isActive === false ? 'text-green-600 hover:bg-green-50' : 'text-yellow-600 hover:bg-yellow-50'}`}
                          title={schedule.isActive === false ? 'Activate' : 'Pause'}
                        >
                          {updatingSchedules[schedule.id] ? (
                            <RefreshCw size={18} className="animate-spin" />
                          ) : schedule.isActive === false ? (
                            <Play size={18} />
                          ) : (
                            <Pause size={18} />
                          )}
                        </button>
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

      {/* Create/Edit Schedule Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-900">
                {modalMode === 'create' ? 'Create New Schedule' : 'Edit Schedule'}
              </h3>
            </div>
            
            <div className="p-6 space-y-4">
              {/* Client Search for Modal */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Client *</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={clientSearchQuery}
                    onChange={(e) => setClientSearchQuery(e.target.value)}
                    placeholder="Search client name or account..."
                    className="flex-1 border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && clientSearchQuery.trim().length >= 2) {
                        filterClients(clientSearchQuery);
                      }
                    }}
                  />
                  <button
                    onClick={() => filterClients(clientSearchQuery)}
                    disabled={!clientSearchQuery || clientSearchQuery.trim().length < 2}
                    className="flex items-center gap-2 bg-blue-600 text-white rounded-lg px-4 py-2.5 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all shrink-0"
                  >
                    <Search size={16} />
                  </button>
                  <button
                    onClick={handleClearClientSearch}
                    disabled={!clientSearchQuery}
                    className="flex items-center gap-2 bg-gray-200 text-gray-700 rounded-lg px-4 py-2.5 hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 transition-all shrink-0"
                  >
                    <XCircle size={16} />
                  </button>
                </div>
                
                <select
                  value={formData.clientId}
                  onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                  disabled={modalMode === 'edit'}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  <option value="">Select a client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name || client.cue_cnombre} 
                      {client.accountNumber ? ` (${client.accountNumber})` : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {clientSearchQuery && clientSearchQuery.trim().length >= 2 
                    ? `Showing ${clients.length} of ${allClients.length} clients`
                    : `Total clients: ${allClients.length}`}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email(s) * <span className="text-gray-500 text-sm">(multiple emails supported)</span>
                </label>
                <textarea
                  value={formData.emails}
                  onChange={(e) => setFormData({ ...formData, emails: e.target.value })}
                  placeholder="email1@example.com, email2@example.com"
                  rows="3"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Separate multiple emails with commas, semicolons, or newlines
                </p>
              </div>

              {/* Report Period Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Report Period</label>
                <select
                  value={formData.reportPeriod}
                  onChange={(e) => setFormData({ ...formData, reportPeriod: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="previousWeek">Previous Week</option>
                  <option value="last7days">Last 7 Days</option>
                  <option value="custom">Custom Range</option>
                </select>
              </div>

              {/* Custom Date Range Fields */}
              {formData.reportPeriod === 'custom' && (
                <div className="grid grid-cols-2 gap-4 p-4 bg-blue-50 rounded-lg">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Start Date *</label>
                    <input
                      type="date"
                      value={formData.customStartDate}
                      onChange={(e) => setFormData({ ...formData, customStartDate: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">End Date *</label>
                    <input
                      type="date"
                      value={formData.customEndDate}
                      onChange={(e) => setFormData({ ...formData, customEndDate: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

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

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="isActive" className="text-sm text-gray-700">
                  Active schedule
                </label>
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
                disabled={!formData.clientId || !formData.emails || !formData.nextRun}
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
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-xl font-semibold text-gray-900">
                Report Preview - {previewData.client?.name}
              </h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle size={24} />
              </button>
            </div>
            
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h4 className="font-semibold text-blue-900 mb-2">Overall Performance</h4>
                  <p className="text-3xl font-bold text-blue-900">
                    {previewData.analytics?.overallPerformance || 0}%
                  </p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <h4 className="font-semibold text-green-900 mb-2">Patrols Completed</h4>
                  <p className="text-3xl font-bold text-green-900">
                    {previewData.analytics?.totalCompleted || 0}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Data Summary</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <p className="text-sm text-gray-600">Posts</p>
                      <p className="text-2xl font-bold">{previewData.analytics?.postsCount || 0}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-gray-600">Events</p>
                      <p className="text-2xl font-bold">{previewData.analytics?.eventsCount || 0}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-gray-600">Guard Reports</p>
                      <p className="text-2xl font-bold">{previewData.analytics?.guardReportsCount || 0}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Data Source</h4>
                  <p className="text-sm text-gray-600">
                    {previewData.analytics?.dataSource || 'Unknown'} • 
                    Processed in {previewData.analytics?.processingTime || 0}ms
                  </p>
                </div>

                <div className="text-center">
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
        </div>
      )}
    </div>
  );
};

export default SecurityReportsPage;