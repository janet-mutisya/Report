import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Shield, 
  Calendar, 
  Activity, 
  CheckCircle, 
  Clock, 
  MapPin,
  FileText,
  Download,
  Loader,
  AlertCircle,
  TrendingUp,
  Eye,
  CheckSquare,
  BarChart3,
  PieChart,
  Users,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { 
  BarChart, Bar, 
  PieChart as RechartsPieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, 
  ResponsiveContainer 
} from 'recharts';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [events, setEvents] = useState([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [dateRange, setDateRange] = useState('week');
  const [customDates, setCustomDates] = useState({ startDate: '', endDate: '' });
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [exportingPDF, setExportingPDF] = useState(false);
  const rowsPerPage = 50;

  const normalizeEvents = useCallback((events = []) => {
    return events.map(e => ({
      date: e.date || e.Date || e.fecha || '-',
      time: e.time || e.Time || e.hora || '-',
      event: e.event || e.Event || e.evento || 'VigiControl Arrival',
      zone: e.zone || e.Zone || e.zona || 'Unknown Zone',
      code: e.code || e.Code || e.codigo || e.AlarmCode || e.alarmCode || '-',
      rawDate: e.date ? new Date(e.date) : null
    }));
  }, []);

  const loadDashboardSummary = useCallback(async (range) => {
    try {
      setLoadingSummary(true);
      setError(null);
      const token = localStorage.getItem('token');
      const today = new Date().toISOString().split('T')[0];
      let startDate = today;
      let endDate = today;

      if (range === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        startDate = weekAgo.toISOString().split('T')[0];
      } else if (range === 'month') {
        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        startDate = monthAgo.toISOString().split('T')[0];
      } else if (range === 'custom' && customDates.startDate && customDates.endDate) {
        startDate = customDates.startDate;
        endDate = customDates.endDate;
      }

      const response = await fetch(
        `http://localhost:5000/api/dashboard/summary?startDate=${startDate}&endDate=${endDate}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      setSummary(data.data);
    } catch (err) {
      console.error('Failed to load summary:', err);
      setError('Could not load summary data. Please try again.');
    } finally {
      setLoadingSummary(false);
    }
  }, [customDates.startDate, customDates.endDate]);

  const loadDashboardEvents = useCallback(async (range) => {
    setLoadingEvents(true);
    setError(null);
    setCurrentPage(1);
    
    try {
      const token = localStorage.getItem('token');
      const today = new Date().toISOString().split('T')[0];
      let startDate = today;
      let endDate = today;

      if (range === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        startDate = weekAgo.toISOString().split('T')[0];
      } else if (range === 'month') {
        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        startDate = monthAgo.toISOString().split('T')[0];
      } else if (range === 'custom' && customDates.startDate && customDates.endDate) {
        startDate = customDates.startDate;
        endDate = customDates.endDate;
      }

      const response = await fetch(
        `http://localhost:5000/api/dashboard/patrol-events?startDate=${startDate}&endDate=${endDate}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      
      if (data.success && data.data) {
        setEvents(normalizeEvents(data.data));
      }
    } catch (err) {
      console.error('Failed to load events:', err);
      setError('Could not load patrol data. Please check your connection and try again.');
    } finally {
      setLoadingEvents(false);
    }
  }, [customDates.startDate, customDates.endDate, normalizeEvents]);

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      const token = localStorage.getItem('token');
      const userData = JSON.parse(localStorage.getItem('user') || '{}');
      setUser(userData);

      const response = await fetch('http://localhost:5000/api/dashboard/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      setStatus(data);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
      setError('Failed to load dashboard data. Please try again later.');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (status?.hasAccess) {
      loadDashboardSummary('week');
      loadDashboardEvents('week');
    }
  }, [status?.hasAccess, loadDashboardSummary, loadDashboardEvents]);

  useEffect(() => {
    if (status?.hasAccess) {
      const warmupCache = async () => {
        try {
          const token = localStorage.getItem('token');
          fetch('http://localhost:5000/api/dashboard/warmup', {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              console.log('✅ Cache warmed up - next requests will be instant');
            }
          })
          .catch(err => {
            console.log('Cache warmup failed (non-critical):', err.message);
          });
        } catch (error) {
          console.log('Cache warmup error:', error);
        }
      };
      warmupCache();
    }
  }, [status?.hasAccess]);

  const handleDateRangeChange = async (range) => {
    setDateRange(range);
    await Promise.all([
      loadDashboardSummary(range),
      loadDashboardEvents(range)
    ]);
  };

  const handleCustomDateSearch = async () => {
    if (customDates.startDate && customDates.endDate) {
      setDateRange('custom');
      await Promise.all([
        loadDashboardSummary('custom'),
        loadDashboardEvents('custom')
      ]);
    }
  };

  const chartData = useMemo(() => {
    if (!events || events.length === 0) {
      return { dailyData: [], zoneData: [] };
    }

    const dailyMap = {};
    events.forEach(event => {
      const date = event.date;
      if (date !== '-') {
        dailyMap[date] = (dailyMap[date] || 0) + 1;
      }
    });

    const dailyData = Object.entries(dailyMap)
      .sort(([dateA], [dateB]) => new Date(dateA) - new Date(dateB))
      .map(([date, count]) => ({ date, arrivals: count }));

    const zoneMap = {};
    events.forEach(event => {
      const zone = event.zone;
      if (zone !== 'Unknown Zone' && zone !== '-') {
        zoneMap[zone] = (zoneMap[zone] || 0) + 1;
      }
    });

    const zoneData = Object.entries(zoneMap)
      .sort(([, countA], [, countB]) => countB - countA)
      .map(([zone, count]) => ({
        name: zone.length > 20 ? zone.substring(0, 17) + '...' : zone,
        value: count,
        fullName: zone
      }));

    return { dailyData, zoneData };
  }, [events]);

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5'];

  const exportToCSV = () => {
    if (!events || events.length === 0) return;
    const headers = ['Date', 'Time', 'Event', 'Zone', 'Code'];
    const rows = events.map(event => [event.date, event.time, event.event, event.zone, event.code]);
    const csvContent = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vigicontrol-arrivals-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const exportToPDF = async () => {
    if (!events || events.length === 0) return;
    setExportingPDF(true);
    try {
      const token = localStorage.getItem('token');
      const today = new Date().toISOString().split('T')[0];
      let startDate = today;
      let endDate = today;

      if (dateRange === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        startDate = weekAgo.toISOString().split('T')[0];
      } else if (dateRange === 'month') {
        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        startDate = monthAgo.toISOString().split('T')[0];
      } else if (dateRange === 'custom' && customDates.startDate && customDates.endDate) {
        startDate = customDates.startDate;
        endDate = customDates.endDate;
      }

      const response = await fetch(
        `http://localhost:5000/api/dashboard/pdf?startDate=${startDate}&endDate=${endDate}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (!response.ok) throw new Error('PDF export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `vigicontrol-report-${startDate}_to_${endDate}.pdf`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="([^"]+)"/);
        if (match) filename = match[1];
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF export error:', err);
      setError('Failed to export PDF. Please try again.');
    } finally {
      setExportingPDF(false);
    }
  };

  const getDateRangeLabel = () => {
    if (dateRange === 'week') return 'Last 7 Days';
    if (dateRange === 'month') return 'Last 30 Days';
    if (dateRange === 'custom' && customDates.startDate && customDates.endDate) {
      return `${customDates.startDate} to ${customDates.endDate}`;
    }
    return 'Recent Events';
  };

  const totalPages = Math.ceil(events.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const currentEvents = events.slice(startIndex, endIndex);

  const handlePreviousPage = () => setCurrentPage(prev => Math.max(1, prev - 1));
  const handleNextPage = () => setCurrentPage(prev => Math.min(totalPages, prev + 1));

  useEffect(() => {
    setCurrentPage(1);
  }, [events]);

  if (loadingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <Loader className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const ErrorAlert = ({ message, onRetry }) => (
    <div className="bg-linear-to-r from-red-50 to-pink-50 border-l-4 border-red-500 p-6 rounded-r-xl mb-6 shadow-lg">
      <div className="flex items-start">
        <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-1" />
        <div className="ml-3 flex-1">
          <p className="text-red-800 font-semibold">Error</p>
          <p className="text-red-700 mt-1">{message}</p>
          {onRetry && (
            <button onClick={onRetry} className="mt-3 px-4 py-2 bg-linear-to-r from-red-600 to-pink-600 text-white rounded-lg hover:from-red-700 hover:to-pink-700 transition">
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (status?.status === 'pending_link') {
    return (
      <div className="min-h-screen bg-linear-to-br from-yellow-50 to-orange-100 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-linear-to-br from-yellow-400 to-orange-500 rounded-full mb-4 shadow-lg">
                <Clock className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-2">Account Setup in Progress</h2>
              <p className="text-gray-600 text-lg">We're working on linking your security account</p>
            </div>
            {error && <ErrorAlert message={error} />}
            <div className="bg-linear-to-r from-yellow-50 to-orange-50 border-2 border-yellow-200 rounded-xl p-6 mb-6">
              <div className="flex gap-4">
                <AlertCircle className="w-6 h-6 text-yellow-600 shrink-0 mt-1" />
                <div>
                  <h3 className="font-bold text-yellow-900 mb-2 text-lg">What's happening?</h3>
                  <p className="text-yellow-800 leading-relaxed">
                    Our system is automatically discovering and linking your BM Security account. 
                    You'll receive an email notification once your account is ready.
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-4 mb-6">
              <div className="flex items-start gap-4 p-4 bg-green-50 rounded-lg border border-green-200">
                <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-gray-900">Account Created</p>
                  <p className="text-sm text-gray-600 mt-1">{user?.email}</p>
                  <p className="text-xs text-gray-500 mt-1">{user?.companyName}</p>
                </div>
              </div>
            </div>
            <div className="mt-8 text-center">
              <p className="text-sm text-gray-600 mb-2">Need immediate assistance?</p>
              <a href="mailto:support@bmsecurity.com" className="text-blue-600 font-semibold hover:text-blue-700">
                support@bmsecurity.com
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-blue-50 via-indigo-50 to-purple-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 bg-white rounded-2xl shadow-lg p-6 border-t-4 border-blue-600">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-linear-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                  <Shield className="w-8 h-8 text-white" />
                </div>
                <h1 className="text-3xl font-bold bg-linear-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                  VigiControl Dashboard
                </h1>
              </div>
              <p className="text-gray-600 ml-14">
                <span className="font-semibold">{user?.companyName}</span> • Account: <span className="font-mono text-blue-600">{status?.accountNumber}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Logged in as</p>
              <p className="font-medium text-gray-900">{user?.email}</p>
            </div>
          </div>
        </div>

        {error && <ErrorAlert message={error} onRetry={() => handleDateRangeChange(dateRange)} />}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-lg p-6 border-l-4 border-blue-500 hover:shadow-xl transition-all hover:-translate-y-1">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-linear-to-br from-blue-400 to-blue-600 rounded-xl shadow-md">
                <CheckSquare className="w-6 h-6 text-white" />
              </div>
              {loadingEvents ? <Loader className="w-5 h-5 text-blue-400 animate-spin" /> : <TrendingUp className="w-5 h-5 text-green-500" />}
            </div>
            {loadingSummary || loadingEvents ? (
              <div className="h-16 flex items-center"><Loader className="w-8 h-8 animate-spin text-blue-400 mx-auto" /></div>
            ) : (
              <>
                <p className="text-4xl font-bold bg-linear-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">{events.length}</p>
                <p className="text-sm font-medium text-gray-600">VigiControl Arrivals</p>
                <p className="text-xs text-gray-500 mt-1">{getDateRangeLabel()}</p>
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6 border-l-4 border-green-500 hover:shadow-xl transition-all hover:-translate-y-1">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-linear-to-br from-green-400 to-green-600 rounded-xl shadow-md">
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
              {loadingSummary ? <Loader className="w-5 h-5 text-green-400 animate-spin" /> : <Activity className="w-5 h-5 text-green-400" />}
            </div>
            {loadingSummary ? (
              <div className="h-16 flex items-center"><Loader className="w-8 h-8 animate-spin text-green-400 mx-auto" /></div>
            ) : (
              <>
                <p className="text-4xl font-bold text-green-600 mb-2">{summary?.summary?.performanceScore || 0}%</p>
                <p className="text-sm font-medium text-gray-600">Performance Score</p>
                <p className="text-xs text-gray-500 mt-1">Overall Completion Rate</p>
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6 border-l-4 border-purple-500 hover:shadow-xl transition-all hover:-translate-y-1">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-linear-to-br from-purple-400 to-purple-600 rounded-xl shadow-md">
                <MapPin className="w-6 h-6 text-white" />
              </div>
              {loadingSummary ? <Loader className="w-5 h-5 text-purple-400 animate-spin" /> : <Users className="w-5 h-5 text-purple-400" />}
            </div>
            {loadingSummary ? (
              <div className="h-16 flex items-center"><Loader className="w-8 h-8 animate-spin text-purple-400 mx-auto" /></div>
            ) : (
              <>
                <p className="text-4xl font-bold bg-linear-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-2">{summary?.summary?.totalPosts || 0}</p>
                <p className="text-sm font-medium text-gray-600">Security Posts</p>
                <p className="text-xs text-gray-500 mt-1">Total Locations</p>
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6 border-l-4 border-orange-500 hover:shadow-xl transition-all hover:-translate-y-1">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-linear-to-br from-orange-400 to-orange-600 rounded-xl shadow-md">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              {loadingSummary ? <Loader className="w-5 h-5 text-orange-400 animate-spin" /> : <Calendar className="w-5 h-5 text-orange-400" />}
            </div>
            {loadingSummary ? (
              <div className="h-16 flex items-center"><Loader className="w-8 h-8 animate-spin text-orange-400 mx-auto" /></div>
            ) : (
              <>
                <p className="text-4xl font-bold bg-linear-to-r from-orange-600 to-red-600 bg-clip-text text-transparent mb-2">{summary?.summary?.avgPerDay || 0}</p>
                <p className="text-sm font-medium text-gray-600">Avg Per Day</p>
                <p className="text-xs text-gray-500 mt-1">{summary?.summary?.daysCovered || 0} days in range</p>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-600" />
                Daily Arrivals Trend
              </h3>
              <span className="text-sm text-gray-500">{loadingEvents ? 'Loading...' : `${chartData.dailyData.length} days`}</span>
            </div>
            {loadingEvents ? (
              <div className="h-64 flex items-center justify-center bg-gray-50 rounded-xl">
                <div className="text-center">
                  <Loader className="w-12 h-12 animate-spin text-blue-400 mx-auto mb-2" />
                  <p className="text-gray-400 font-medium">Loading chart data...</p>
                </div>
              </div>
            ) : chartData.dailyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData.dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" stroke="#666" fontSize={12} angle={-45} textAnchor="end" height={80} />
                  <YAxis stroke="#666" fontSize={12} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                  <Legend />
                  <Bar dataKey="arrivals" name="Arrivals" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center bg-gray-50 rounded-xl">
                <div className="text-center">
                  <BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-400 font-medium">No data available</p>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <PieChart className="w-5 h-5 text-purple-600" />
                Zone Distribution
              </h3>
              <span className="text-sm text-gray-500">{loadingEvents ? 'Loading...' : `${chartData.zoneData.length} zones`}</span>
            </div>
            {loadingEvents ? (
              <div className="h-64 flex items-center justify-center bg-gray-50 rounded-xl">
                <div className="text-center">
                  <Loader className="w-12 h-12 animate-spin text-purple-400 mx-auto mb-2" />
                  <p className="text-gray-400 font-medium">Loading distribution...</p>
                </div>
              </div>
            ) : chartData.zoneData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <RechartsPieChart>
                  <Pie
                    data={chartData.zoneData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {chartData.zoneData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, name, props) => [`${value} arrivals`, props.payload.fullName]} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                  <Legend />
                </RechartsPieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center bg-gray-50 rounded-xl">
                <div className="text-center">
                  <PieChart className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-400 font-medium">No data available</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 mb-8 border border-gray-100">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600" />
            Filter Date Range
          </h3>
          
          <div className="flex flex-wrap gap-3 mb-4">
            <button
              onClick={() => handleDateRangeChange('week')}
              disabled={loadingEvents || loadingSummary}
              className={`px-6 py-3 rounded-xl font-semibold transition-all ${
                dateRange === 'week'
                  ? 'bg-linear-to-r from-blue-600 to-indigo-600 text-white shadow-lg scale-105'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              } ${loadingEvents || loadingSummary ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Last 7 Days
            </button>
            <button
              onClick={() => handleDateRangeChange('month')}
              disabled={loadingEvents || loadingSummary}
              className={`px-6 py-3 rounded-xl font-semibold transition-all ${
                dateRange === 'month'
                  ? 'bg-linear-to-r from-blue-600 to-indigo-600 text-white shadow-lg scale-105'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              } ${loadingEvents || loadingSummary ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Last 30 Days
            </button>
            <button
              onClick={() => setDateRange('custom')}
              disabled={loadingEvents || loadingSummary}
              className={`px-6 py-3 rounded-xl font-semibold transition-all ${
                dateRange === 'custom'
                  ? 'bg-linear-to-r from-blue-600 to-indigo-600 text-white shadow-lg scale-105'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              } ${loadingEvents || loadingSummary ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Custom Range
            </button>
          </div>

          {dateRange === 'custom' && (
            <div className="flex flex-wrap gap-4 items-end bg-linear-to-r from-blue-50 to-indigo-50 p-4 rounded-xl border border-blue-200">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Start Date</label>
                <input
                  type="date"
                  value={customDates.startDate}
                  onChange={(e) => setCustomDates({...customDates, startDate: e.target.value})}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-semibold text-gray-700 mb-2">End Date</label>
                <input
                  type="date"
                  value={customDates.endDate}
                  onChange={(e) => setCustomDates({...customDates, endDate: e.target.value})}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
              </div>
              <button
                onClick={handleCustomDateSearch}
                disabled={!customDates.startDate || !customDates.endDate || loadingEvents || loadingSummary}
                className="px-6 py-3 bg-linear-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-indigo-700 transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Apply Filter
              </button>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="bg-linear-to-r from-blue-600 to-indigo-600 p-6 text-white">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-xl flex items-center gap-2">
                  <CheckSquare className="w-6 h-6" />
                  VigiControl Arrivals
                </h3>
                <p className="text-blue-100 text-sm mt-1">
                  {getDateRangeLabel()} • {events.length} arrivals
                  {summary?.metadata?.dataSource && <span className="ml-2">• Source: {summary.metadata.dataSource}</span>}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={exportToCSV}
                  disabled={!events || events.length === 0}
                  className="flex items-center gap-2 px-5 py-3 bg-white text-blue-600 rounded-xl hover:bg-blue-50 transition font-semibold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-5 h-5" />
                  CSV
                </button>
                <button
                  onClick={exportToPDF}
                  disabled={!events || events.length === 0 || exportingPDF}
                  className="flex items-center gap-2 px-5 py-3 bg-linear-to-r from-green-500 to-emerald-600 text-white rounded-xl hover:from-green-600 hover:to-emerald-700 transition font-semibold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {exportingPDF ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <FileText className="w-5 h-5" />
                      PDF
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            {loadingEvents ? (
              <div className="p-16 text-center">
                <Loader className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
                <p className="text-gray-600 font-medium text-lg">Loading VigiControl arrivals...</p>
                <p className="text-gray-500 text-sm mt-2">This may take a moment</p>
              </div>
            ) : events.length > 0 ? (
              <>
                <table className="w-full">
                  <thead className="bg-linear-to-r from-gray-50 to-gray-100">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Date</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Time</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Event</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Zone</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {currentEvents.map((event, index) => (
                      <tr key={index} className="hover:bg-blue-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-gray-400" />
                            <span className="text-sm font-medium text-gray-900">{event.date}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-gray-400" />
                            <span className="text-sm font-medium text-gray-700">{event.time}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-2 px-3 py-1 bg-linear-to-r from-green-100 to-emerald-100 text-green-800 text-sm font-semibold rounded-full">
                            <CheckCircle className="w-4 h-4" />
                            {event.event}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-blue-600" />
                            <span className="text-sm font-medium text-gray-900">{event.zone}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {totalPages > 1 && (
                  <div className="bg-linear-to-r from-gray-50 to-gray-100 px-6 py-4 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-700">
                        Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                        <span className="font-semibold">{Math.min(endIndex, events.length)}</span> of{' '}
                        <span className="font-semibold">{events.length}</span> arrivals
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handlePreviousPage}
                          disabled={currentPage === 1}
                          className="flex items-center gap-1 px-4 py-2 bg-white border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-gray-700"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          Previous
                        </button>
                        <div className="px-4 py-2 bg-linear-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-semibold">
                          Page {currentPage} of {totalPages}
                        </div>
                        <button
                          onClick={handleNextPage}
                          disabled={currentPage === totalPages}
                          className="flex items-center gap-1 px-4 py-2 bg-white border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-gray-700"
                        >
                          Next
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="p-16 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                  <Eye className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-600 font-medium text-lg mb-2">No VigiControl arrivals found</p>
                <p className="text-gray-500 text-sm">
                  {dateRange === 'custom' ? 'Try different dates or select a preset range' : 'Try selecting a different date range'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}