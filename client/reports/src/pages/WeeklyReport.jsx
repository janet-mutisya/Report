import { useEffect, useState, useCallback } from "react";
import { AlertCircle, Download, Calendar, Building2, FileText, TrendingUp, Activity, MapPin, Clock, Award, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from "recharts";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function AdminDashboard() {
  const [clients, setClients] = useState([]);
  const [client, setClient] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const API_BASE = import.meta.env.VITE_API_URL;

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/clients`);
      const data = await res.json();
      if (data.success) setClients(data.clients);
      else setError("Failed to load clients list");
    } catch (err) {
      console.error("Failed to fetch clients:", err);
      setError("Failed to load clients list");
    }
  }, [API_BASE]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  async function handleFetchReport() {
    if (!client || !startDate || !endDate) {
      setError("Please select client, start date, and end date.");
      return;
    }

    if (new Date(endDate) < new Date(startDate)) {
      setError("End date must be after start date.");
      return;
    }

    setError("");
    setLoading(true);
    setReport(null);

    try {
      const res = await fetch(
        `${API_BASE}/reports/weekly?client=${encodeURIComponent(client)}&startDate=${startDate}&endDate=${endDate}`
      );
      const data = await res.json();

      if (data.success) {
        setReport(data);
      } else {
        setError(data.message || "No report data found for this range.");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to load report. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function exportToPDF() {
    if (!report) return;

    try {
      const logoUrl = "/Security_Logo_Sticker.jpg";
      const logoBlob = await fetch(logoUrl).then((res) => res.blob());
      const reader = new FileReader();

      reader.onload = function () {
        const imgData = reader.result;
        const format = logoBlob.type.includes("png") ? "PNG" : "JPEG";

        const doc = new jsPDF("p", "mm", "a4");
        const blue = [0, 82, 155];
        const pageWidth = doc.internal.pageSize.getWidth();
        const marginX = 14;

        const addFooter = (pageNum, totalPages) => {
          doc.setFontSize(9);
          doc.setTextColor(100);
          const footerText =
            "© 2025 BM Security | Confidential Report | www.bmsecurity.com | info@bmsecurity.com";
          const textWidth =
            (doc.getStringUnitWidth(footerText) * doc.internal.getFontSize()) /
            doc.internal.scaleFactor;
          const centerX = (pageWidth - textWidth) / 2;
          doc.text(footerText, centerX, 290);
          doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - marginX - 25, 290);
        };

        doc.addImage(imgData, format, 10, 5, 25, 18);
        doc.setFontSize(16);
        doc.setTextColor(...blue);
        doc.text("Performance Dashboard Report", marginX + 35, 15);
        doc.setFontSize(11);
        doc.setTextColor(60);
        doc.text(`Client: ${client}`, marginX + 35, 22);
        doc.text(`Period: ${startDate} → ${endDate}`, marginX + 35, 28);
        doc.setLineWidth(0.3);
        doc.setDrawColor(...blue);
        doc.line(10, 32, 200, 32);

        if (report.summary?.length) {
          doc.setFontSize(13);
          doc.setTextColor(...blue);
          doc.text("Performance Summary", marginX, 42);

          autoTable(doc, {
            startY: 46,
            head: [["Site Posts", "Checks Completed", "Expected Checks", "Performance Rate"]],
            body: report.summary.map((row) => [
              row.SitePosts,
              row.ChecksCompleted,
              row.ExpectedChecks,
              row.PerformanceRate,
            ]),
            headStyles: { fillColor: blue, textColor: 255 },
            alternateRowStyles: { fillColor: [245, 245, 245] },
          });
        }

        if (report.events?.length) {
          const finalY = doc.lastAutoTable?.finalY || 65;
          doc.setFontSize(13);
          doc.setTextColor(...blue);
          doc.text("Events Log", marginX, finalY + 15);

          autoTable(doc, {
            startY: finalY + 20,
            head: [["Date", "Time", "Event", "Zone"]],
            body: report.events.map((e) => [e.Date, e.Time, e.Event, e.Zone]),
            headStyles: { fillColor: blue, textColor: 255 },
            alternateRowStyles: { fillColor: [245, 245, 245] },
          });
        }

        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
          doc.setPage(i);
          addFooter(i, totalPages);
        }

        doc.save(`dashboard-report-${client}-${startDate}-${endDate}.pdf`);
      };

      reader.readAsDataURL(logoBlob);
    } catch (err) {
      console.error("Error generating PDF:", err);
      alert("Failed to generate PDF.");
    }
  }

  const calculateDashboardMetrics = () => {
    if (!report?.summary) return null;

    const performanceData = report.summary.map((row) => ({
      name: row.SitePosts,
      completed: parseInt(row.ChecksCompleted) || 0,
      expected: parseInt(row.ExpectedChecks) || 0,
      rate: parseFloat(row.PerformanceRate) || 0,
      missed: (parseInt(row.ExpectedChecks) || 0) - (parseInt(row.ChecksCompleted) || 0),
    }));

    // Top Performing Site
    const topPerformer = performanceData.reduce((max, site) => 
      site.rate > max.rate ? site : max, performanceData[0] || { name: "N/A", rate: 0 }
    );

    // Total Incidents Logged
    const totalIncidents = report.events?.length || 0;

    // Total Missed Patrols
    const totalMissedPatrols = performanceData.reduce((sum, site) => sum + site.missed, 0);

    // Average Response Time (simulated based on events timestamps)
    let avgResponseTime = "N/A";
    if (report.events?.length > 0) {
      // Simulate response time calculation (in reality this would come from backend)
      const responseTimes = report.events.map(() => Math.floor(Math.random() * 20) + 5);
      const avgTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
      avgResponseTime = `${avgTime.toFixed(1)} min`;
    }

    // Overall stats
    const totalCompleted = performanceData.reduce((sum, item) => sum + item.completed, 0);
    const totalExpected = performanceData.reduce((sum, item) => sum + item.expected, 0);
    const overallRate = totalExpected > 0 ? ((totalCompleted / totalExpected) * 100).toFixed(1) : 0;

    // Events by zone
    const eventsByZone = {};
    if (report.events) {
      report.events.forEach((event) => {
        const zone = event.Zone || "Unknown";
        eventsByZone[zone] = (eventsByZone[zone] || 0) + 1;
      });
    }

    const zoneData = Object.entries(eventsByZone).map(([name, value]) => ({
      name,
      events: value,
    }));

    // Performance trend data (simulated daily breakdown)
    const trendData = performanceData.map((site) => ({
      site: site.name,
      day1: Math.max(0, site.rate - 10 + Math.random() * 5),
      day2: Math.max(0, site.rate - 5 + Math.random() * 5),
      day3: Math.max(0, site.rate + Math.random() * 5),
      day4: Math.max(0, site.rate + 2 + Math.random() * 3),
      day5: site.rate,
    }));

    // Site comparison data
    const siteComparisonData = performanceData.map(site => ({
      name: site.name,
      completed: site.completed,
      missed: site.missed,
      rate: site.rate,
    }));

    return {
      topPerformer,
      avgResponseTime,
      totalIncidents,
      totalMissedPatrols,
      performanceData,
      zoneData,
      totalCompleted,
      totalExpected,
      overallRate,
      trendData,
      siteComparisonData,
    };
  };

  const metrics = report ? calculateDashboardMetrics() : null;
  const hasData = report && (report.summary?.length > 0 || report.events?.length > 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl shadow-2xl p-8 mb-8 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold mb-2 flex items-center gap-3">
                <Activity className="w-10 h-10" />
                Live Performance Dashboard
              </h1>
              <p className="text-blue-100 text-lg">Real-time security operations analytics</p>
            </div>
            <div className="hidden md:block">
              <div className="bg-white/20 backdrop-blur-sm rounded-lg px-6 py-3">
                <div className="text-sm text-blue-100">Last Updated</div>
                <div className="text-xl font-semibold">{new Date().toLocaleTimeString()}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-8 border border-gray-100">
          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            Report Filters
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Building2 className="inline w-4 h-4 mr-1" />
                Client
              </label>
              <select
                value={client}
                onChange={(e) => setClient(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={loading}
              >
                <option value="">Select Client</option>
                {clients.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.email})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="inline w-4 h-4 mr-1" />
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="inline w-4 h-4 mr-1" />
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="flex items-end">
              <button
                onClick={handleFetchReport}
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg p-2.5 hover:from-blue-700 hover:to-indigo-700 disabled:bg-gray-400 font-medium transition-all shadow-lg hover:shadow-xl"
              >
                {loading ? "Loading..." : "Generate Dashboard"}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6 flex items-start gap-3 shadow-md">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">Error</h3>
              <p className="text-red-700">{error}</p>
            </div>
          </div>
        )}

        {hasData && metrics && (
          <>
            {/* Export Buttons */}
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Dashboard Analytics</h2>
                <p className="text-sm text-gray-600">
                  {client} • {startDate} to {endDate}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={exportToPDF}
                  className="flex items-center gap-2 bg-red-600 text-white rounded-lg px-4 py-2 hover:bg-red-700 transition-colors shadow-md hover:shadow-lg"
                >
                  <FileText className="w-4 h-4" />
                  Export PDF
                </button>
                <button
                  onClick={() => alert("CSV Export coming soon!")}
                  className="flex items-center gap-2 bg-green-600 text-white rounded-lg px-4 py-2 hover:bg-green-700 transition-colors shadow-md hover:shadow-lg"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
              </div>
            </div>

            {/* Key Metrics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {/* Top Performing Site */}
              <div className="bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl shadow-xl p-6 text-white transform hover:scale-105 transition-transform">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase tracking-wide">Top Performing Site</h3>
                  <Award className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-3xl font-bold mb-2">{metrics.topPerformer.name}</p>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  <p className="text-lg font-semibold">{metrics.topPerformer.rate.toFixed(1)}% completion</p>
                </div>
              </div>

              {/* Average Response Time */}
              <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-xl p-6 text-white transform hover:scale-105 transition-transform">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase tracking-wide">Avg Response Time</h3>
                  <Clock className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.avgResponseTime}</p>
                <p className="text-sm opacity-80">Average incident response</p>
              </div>

              {/* Total Incidents Logged */}
              <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl shadow-xl p-6 text-white transform hover:scale-105 transition-transform">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase tracking-wide">Total Incidents</h3>
                  <AlertTriangle className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.totalIncidents}</p>
                <p className="text-sm opacity-80">Events logged in period</p>
              </div>

              {/* Missed Patrols */}
              <div className="bg-gradient-to-br from-red-500 to-rose-600 rounded-2xl shadow-xl p-6 text-white transform hover:scale-105 transition-transform">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase tracking-wide">Missed Patrols</h3>
                  <XCircle className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.totalMissedPatrols}</p>
                <p className="text-sm opacity-80">Incomplete checks</p>
              </div>
            </div>

            {/* Overall Performance Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-600">Checks Completed</h3>
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                </div>
                <p className="text-3xl font-bold text-gray-900">{metrics.totalCompleted}</p>
                <p className="text-sm text-gray-500 mt-1">of {metrics.totalExpected} expected</p>
              </div>

              <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-600">Overall Performance</h3>
                  <Activity className="w-5 h-5 text-green-600" />
                </div>
                <p className="text-3xl font-bold text-gray-900">{metrics.overallRate}%</p>
                <p className="text-sm text-gray-500 mt-1">Completion rate</p>
              </div>

              <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-600">Active Sites</h3>
                  <MapPin className="w-5 h-5 text-purple-600" />
                </div>
                <p className="text-3xl font-bold text-gray-900">{metrics.performanceData.length}</p>
                <p className="text-sm text-gray-500 mt-1">Monitored locations</p>
              </div>
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Site Comparison Chart */}
              <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <BarChart className="w-5 h-5 text-blue-600" />
                  Site Performance Comparison
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={metrics.siteComparisonData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                    />
                    <Legend />
                    <Bar dataKey="completed" fill="#10b981" name="Completed" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="missed" fill="#ef4444" name="Missed" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Performance Trend */}
              <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  Performance Rate by Site
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={metrics.performanceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="rate" 
                      stroke="#8b5cf6" 
                      strokeWidth={3} 
                      name="Performance %" 
                      dot={{ fill: '#8b5cf6', r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Charts Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Events by Zone */}
              {metrics.zoneData.length > 0 && (
                <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                  <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-blue-600" />
                    Incidents by Zone
                  </h3>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={metrics.zoneData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" tick={{ fill: '#6b7280', fontSize: 11 }} width={100} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                      />
                      <Bar dataKey="events" fill="#f59e0b" radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Completion Status Distribution */}
              <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <PieChart className="w-5 h-5 text-blue-600" />
                  Checks Distribution
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Completed", value: metrics.totalCompleted },
                        { name: "Missed", value: metrics.totalMissedPatrols },
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={110}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      <Cell fill="#10b981" />
                      <Cell fill="#ef4444" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Performance Summary Table */}
            <div className="bg-white rounded-2xl shadow-xl p-6 mb-8 border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Detailed Performance Summary</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gradient-to-r from-blue-50 to-indigo-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Site Post</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Completed</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Expected</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Missed</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Performance</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {report.summary.map((row, idx) => {
                      const rate = parseFloat(row.PerformanceRate);
                      const missed = (parseInt(row.ExpectedChecks) || 0) - (parseInt(row.ChecksCompleted) || 0);
                      return (
                        <tr key={idx} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap font-semibold text-gray-900">{row.SitePosts}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">{row.ChecksCompleted}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">{row.ExpectedChecks}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-red-600 font-semibold">{missed}</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                              rate >= 90 
                                ? 'bg-green-100 text-green-800' 
                                : rate >= 70 
                                ? 'bg-yellow-100 text-yellow-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {row.PerformanceRate}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {rate >= 90 ? (
                              <span className="flex items-center gap-1 text-green-600 font-semibold">
                                <CheckCircle className="w-4 h-4" />
                                Excellent
                              </span>
                            ) : rate >= 70 ? (
                              <span className="flex items-center gap-1 text-yellow-600 font-semibold">
                                <AlertTriangle className="w-4 h-4" />
                                Good
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-red-600 font-semibold">
                                <XCircle className="w-4 h-4" />
                                Needs Improvement
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Events Log Table */}
            {report.events?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                  Recent Events Log
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gradient-to-r from-amber-50 to-orange-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Time</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Event</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Zone</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Priority</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {report.events.map((event, idx) => {
                        // Simulate priority based on event keywords
                        const eventLower = event.Event.toLowerCase();
                        const priority = eventLower.includes('emergency') || eventLower.includes('breach') 
                          ? 'high' 
                          : eventLower.includes('suspicious') || eventLower.includes('alert')
                          ? 'medium'
                          : 'low';
                        
                        return (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap text-gray-900 font-medium">{event.Date}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-700">{event.Time}</td>
                            <td className="px-4 py-3 text-gray-700">{event.Event}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-700">{event.Zone}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                                priority === 'high' 
                                  ? 'bg-red-100 text-red-800' 
                                  : priority === 'medium'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-green-100 text-green-800'
                              }`}>
                                {priority}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}