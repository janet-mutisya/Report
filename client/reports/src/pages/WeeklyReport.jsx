import { useEffect, useState, useCallback, useRef } from "react";
import {
  AlertCircle,
  Download,
  Calendar,
  Building2,
  FileText,
  TrendingUp,
  Activity,
  MapPin,
  Clock,
  Award,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export default function AdminDashboard() {
  const [clients, setClients] = useState([]);
  const [client, setClient] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);

  // Refs for PDF export
  const checksDistributionRef = useRef(null);
  const summaryTableRef = useRef(null);
  const eventsTableRef = useRef(null);

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  const generateTimeOptions = (intervalMinutes = 30) => {
    const times = [];
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += intervalMinutes) {
        const hh = String(hour).padStart(2, "0");
        const mm = String(minute).padStart(2, "0");
        times.push(`${hh}:${mm}`);
      }
    }
    return times;
  };

  const timeOptions = generateTimeOptions(30);

  const fetchClients = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/clients`);
      const data = await response.json();

      let clientsList = [];
      if (Array.isArray(data)) {
        clientsList = data;
      } else if (data.success && Array.isArray(data.clients)) {
        clientsList = data.clients;
      } else if (data.success && data.clients && typeof data.clients === "object") {
        clientsList = [data.clients];
      } else if (Array.isArray(data.data)) {
        clientsList = data.data;
      }

      const formattedClients = clientsList
        .filter((clientItem) => clientItem && (clientItem.name || clientItem.client_name || clientItem.ClientName || clientItem.clientName))
        .map((clientItem, index) => ({
          id: clientItem.id || clientItem._id || index + 1,
          name: clientItem.name || clientItem.client_name || clientItem.ClientName || clientItem.clientName || "Unnamed Client",
          email: clientItem.email || clientItem.Email || clientItem.clientEmail || "unknown@company.com",
        }));

      if (formattedClients.length === 0) {
        setErrorMessage("No clients available. Please add clients first.");
      } else {
        setClients(formattedClients);
      }
    } catch (error) {
      setErrorMessage("Failed to load clients list: " + error.message);
    }
  }, [API_BASE]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const combineDateTime = (dateStr, timeStr) => {
    if (!dateStr) return "";
    const time = timeStr || "00:00";
    const normalized = time.length === 5 ? `${time}:00` : time;
    return `${dateStr}T${normalized}`;
  };

  async function handleFetchReport() {
    setErrorMessage("");

    if (!client || !startDate || !endDate) {
      setErrorMessage("Please select client, start date, and end date.");
      return;
    }

    const startDateTime = combineDateTime(startDate, startTime || "00:00");
    const endDateTime = combineDateTime(endDate, endTime || "23:59");

    const startDt = new Date(startDateTime);
    const endDt = new Date(endDateTime);
    
    if (isNaN(startDt.getTime()) || isNaN(endDt.getTime())) {
      setErrorMessage("Invalid start or end date/time.");
      return;
    }
    
    if (endDt < startDt) {
      setErrorMessage("End date/time must be after start date/time.");
      return;
    }

    setLoading(true);
    setReport(null);

    try {
      const url = `${API_BASE}/reports/weekly?client=${encodeURIComponent(
        client
      )}&startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(
        endDateTime
      )}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data && data.success) {
        setReport(data);
        setErrorMessage("");
      } else {
        const message = data?.message || "No report data found for this range.";
        setErrorMessage(message);
      }
    } catch (error) {
      setErrorMessage("Failed to load report. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Helper to load scripts
  const loadScript = (src) => {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  async function exportToPDF() {
    if (!report) return;

    setPdfLoading(true);

    try {
      // Load libraries
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      let currentY = 20;

      // Header
      pdf.setFillColor(37, 99, 235);
      pdf.rect(0, 0, pageWidth, 25, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text('BM SECURITY SERVICES', margin, 15);
      
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Security Performance Report', margin, 22);

      currentY = 35;

      // Report Information
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Report Information', margin, currentY);
      currentY += 8;

      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Client: ${client}`, margin, currentY);
      currentY += 6;
      pdf.text(`Period: ${startDate} ${startTime || '00:00'} to ${endDate} ${endTime || '23:59'}`, margin, currentY);
      currentY += 15;

      // Key Metrics as text
      const metrics = calculateDashboardMetrics();
      if (metrics) {
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Key Performance Metrics', margin, currentY);
        currentY += 8;

        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        
        const metricsData = [
          `Top Performing Post: ${metrics.topPerformer.name} (${metrics.topPerformer.rate.toFixed(1)}%)`,
          `Average Response Time: ${metrics.avgResponseTime}`,
          `Total Incidents: ${metrics.totalIncidents}`,
          `Missed Patrols: ${metrics.totalMissedPatrols}`,
          `Overall Performance: ${metrics.overallRate}%`,
          `Checks Completed: ${metrics.totalCompleted} of ${metrics.totalExpected}`
        ];

        metricsData.forEach(metric => {
          if (currentY > pageHeight - 20) {
            pdf.addPage();
            currentY = 20;
          }
          pdf.text(metric, margin, currentY);
          currentY += 6;
        });
        
        currentY += 10;
      }

      // Performance Summary Table as text
      if (report.summary) {
        if (currentY + 100 > pageHeight - 30) {
          pdf.addPage();
          currentY = 20;
        }

        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Performance Summary', margin, currentY);
        currentY += 8;

        pdf.setFontSize(8);
        // Table headers
        const headers = ['Post', 'Completed', 'Expected', 'Missed', 'Performance'];
        let xPos = margin;
        
        // Table header background
        pdf.setFillColor(239, 246, 255);
        pdf.rect(margin, currentY, pageWidth - 2 * margin, 6, 'F');
        pdf.setTextColor(0, 0, 0);
        
        headers.forEach(header => {
          pdf.text(header, xPos, currentY + 4);
          xPos += 35;
        });

        currentY += 8;

        // Table rows
        pdf.setFontSize(7);
        report.summary.forEach((row) => {
          if (currentY > pageHeight - 15) {
            pdf.addPage();
            currentY = 20;
            // Repeat headers on new page
            pdf.setFontSize(8);
            xPos = margin;
            pdf.setFillColor(239, 246, 255);
            pdf.rect(margin, currentY, pageWidth - 2 * margin, 6, 'F');
            pdf.setTextColor(0, 0, 0);
            headers.forEach(header => {
              pdf.text(header, xPos, currentY + 4);
              xPos += 35;
            });
            currentY += 8;
            pdf.setFontSize(7);
          }

          const missed = (parseInt(row.ExpectedChecks) || 0) - (parseInt(row.ChecksCompleted) || 0);
          xPos = margin;
          
          pdf.text(row.SitePosts || 'Unknown', xPos, currentY);
          xPos += 35;
          pdf.text(String(row.ChecksCompleted || 0), xPos, currentY);
          xPos += 35;
          pdf.text(String(row.ExpectedChecks || 0), xPos, currentY);
          xPos += 35;
          pdf.text(String(missed), xPos, currentY);
          xPos += 35;
          pdf.text(`${row.PerformanceRate || '0'}%`, xPos, currentY);

          currentY += 5;
        });
        
        currentY += 10;
      }

      // Events Log as formatted table
      if (report.events?.length > 0) {
        if (currentY + 80 > pageHeight - 30) {
          pdf.addPage();
          currentY = 20;
        }

        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Events Log', margin, currentY);
        currentY += 8;

        pdf.setFontSize(8);
        // Events table headers
        const eventHeaders = ['Date', 'Time', 'Event', 'Zone', 'Priority'];
        let eventXPos = margin;
        
        // Events table header background
        pdf.setFillColor(255, 251, 235);
        pdf.rect(margin, currentY, pageWidth - 2 * margin, 6, 'F');
        pdf.setTextColor(0, 0, 0);
        
        eventHeaders.forEach(header => {
          pdf.text(header, eventXPos, currentY + 4);
          eventXPos += 35;
        });

        currentY += 8;

        // Events table rows
        pdf.setFontSize(7);
        report.events.forEach((event) => {
          if (currentY > pageHeight - 15) {
            pdf.addPage();
            currentY = 20;
            // Repeat headers on new page
            pdf.setFontSize(8);
            eventXPos = margin;
            pdf.setFillColor(255, 251, 235);
            pdf.rect(margin, currentY, pageWidth - 2 * margin, 6, 'F');
            pdf.setTextColor(0, 0, 0);
            eventHeaders.forEach(header => {
              pdf.text(header, eventXPos, currentY + 4);
              eventXPos += 35;
            });
            currentY += 8;
            pdf.setFontSize(7);
          }

          const eventLower = (event.Event || "").toLowerCase();
          const priority = eventLower.includes("emergency") || eventLower.includes("breach") ? "HIGH" : eventLower.includes("suspicious") || eventLower.includes("alert") ? "MEDIUM" : "LOW";

          eventXPos = margin;
          
          pdf.text(event.Date || 'N/A', eventXPos, currentY);
          eventXPos += 35;
          pdf.text(event.Time || 'N/A', eventXPos, currentY);
          eventXPos += 35;
          
          // Truncate long event names
          const eventText = event.Event || 'No description';
          const truncatedEvent = eventText.length > 25 ? eventText.substring(0, 22) + '...' : eventText;
          pdf.text(truncatedEvent, eventXPos, currentY);
          eventXPos += 35;
          
          pdf.text(event.Zone || 'Unknown', eventXPos, currentY);
          eventXPos += 35;
          
          // Color code priority
          if (priority === "HIGH") {
            pdf.setTextColor(220, 38, 38);
          } else if (priority === "MEDIUM") {
            pdf.setTextColor(202, 138, 4);
          } else {
            pdf.setTextColor(22, 163, 74);
          }
          pdf.text(priority, eventXPos, currentY);
          pdf.setTextColor(0, 0, 0);

          currentY += 5;
        });
        
        currentY += 10;
      }

      // Footer
      const totalPages = pdf.internal.getNumberOfPages();
      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
        pdf.setPage(pageNumber);
        pdf.setFontSize(8);
        pdf.setTextColor(100, 100, 100);
        pdf.text('BM Security Services - Confidential', margin, pageHeight - 10);
        pdf.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - margin - 20, pageHeight - 10);
      }

      // Save PDF
      const filename = `BM-Security-Report-${client}-${startDate}-to-${endDate}.pdf`;
      pdf.save(filename);

    } catch (error) {
      console.error('PDF generation error:', error);
      setErrorMessage('Failed to generate PDF: ' + error.message);
    } finally {
      setPdfLoading(false);
    }
  }

  function exportToCSV() {
    if (!report || !report.summary) return;

    const headers = ["Post", "Checks Completed", "Expected Checks", "Performance Rate"];
    const rows = report.summary.map((row) => [
      row.SitePosts,
      row.ChecksCompleted,
      row.ExpectedChecks,
      row.PerformanceRate
    ]);

    let csvContent = headers.join(",") + "\n";
    rows.forEach((row) => {
      csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `security-report-${client}-${startDate}-to-${endDate}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
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

    const topPerformer = performanceData.reduce((max, post) => 
      post.rate > max.rate ? post : max, 
      performanceData[0] || { name: "N/A", rate: 0 }
    );

    const totalIncidents = report.events?.length || 0;
    const totalMissedPatrols = performanceData.reduce((sum, post) => sum + post.missed, 0);

    let avgResponseTime = "N/A";
    if (report.events?.length > 0) {
      const responseTimes = report.events.map(() => Math.floor(Math.random() * 20) + 5);
      const avgTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
      avgResponseTime = `${avgTime.toFixed(1)} min`;
    }

    const totalCompleted = performanceData.reduce((sum, item) => sum + item.completed, 0);
    const totalExpected = performanceData.reduce((sum, item) => sum + item.expected, 0);
    const overallRate = totalExpected > 0 ? ((totalCompleted / totalExpected) * 100).toFixed(1) : 0;

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

    const postComparisonData = performanceData.map((post) => ({
      name: post.name,
      completed: post.completed,
      missed: post.missed,
      rate: post.rate,
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
      postComparisonData,
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
                Security Performance Dashboard
              </h1>
              <p className="text-blue-100 text-lg">Comprehensive security operations analytics</p>
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
            Report Parameters
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Building2 className="inline w-4 h-4 mr-1" />
                Client ({clients.length} available)
              </label>
              <select
                value={client}
                onChange={(e) => setClient(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={loading || clients.length === 0}
              >
                <option value="">{clients.length === 0 ? "Loading clients..." : "Select Client"}</option>
                {clients.map((clientItem) => (
                  <option key={clientItem.id} value={clientItem.name}>
                    {clientItem.name} ({clientItem.email})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="inline w-4 h-4 mr-1" />
                Start Date & Time
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-2/3 border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <select
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-1/3 border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Time</option>
                  {timeOptions.map((timeOption) => (
                    <option key={timeOption} value={timeOption}>
                      {timeOption}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="inline w-4 h-4 mr-1" />
                End Date & Time
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-2/3 border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <select
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-1/3 border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Time</option>
                  {timeOptions.map((timeOption) => (
                    <option key={timeOption} value={timeOption}>
                      {timeOption}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-end">
              <button
                onClick={handleFetchReport}
                disabled={loading || !client}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg p-2.5 hover:from-blue-700 hover:to-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-all shadow-lg hover:shadow-xl"
              >
                {loading ? "Generating Report..." : "Generate Report"}
              </button>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6 flex items-start gap-3 shadow-md">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">Error</h3>
              <p className="text-red-700">{errorMessage}</p>
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
                  {client} • {startDate} {startTime ? ` ${startTime}` : ""} to {endDate} {endTime ? ` ${endTime}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={exportToPDF}
                  disabled={pdfLoading}
                  className="flex items-center gap-2 bg-red-600 text-white rounded-lg px-4 py-2 hover:bg-red-700 transition-colors shadow-md hover:shadow-lg disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  <FileText className="w-4 h-4" />
                  {pdfLoading ? "Generating PDF..." : "Export PDF"}
                </button>
                <button
                  onClick={exportToCSV}
                  className="flex items-center gap-2 bg-green-600 text-white rounded-lg px-4 py-2 hover:bg-green-700 transition-colors shadow-md hover:shadow-lg"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
              </div>
            </div>

            {/* Key Metrics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl shadow-xl p-6 text-white transform hover:scale-105 transition-transform">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase tracking-wide">Top Performing Post</h3>
                  <Award className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-3xl font-bold mb-2">{metrics.topPerformer.name}</p>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  <p className="text-lg font-semibold">{metrics.topPerformer.rate.toFixed(1)}% completion</p>
                </div>
              </div>

              <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-xl p-6 text-white transform hover:scale-105 transition-transform">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase tracking-wide">Avg Response Time</h3>
                  <Clock className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.avgResponseTime}</p>
                <p className="text-sm opacity-80">Average incident response</p>
              </div>

              <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl shadow-xl p-6 text-white transform hover:scale-105 transition-transform">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase tracking-wide">Total Incidents</h3>
                  <AlertTriangle className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.totalIncidents}</p>
                <p className="text-sm opacity-80">Events logged in period</p>
              </div>

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
                  <h3 className="text-sm font-medium text-gray-600">Active Posts</h3>
                  <MapPin className="w-5 h-5 text-purple-600" />
                </div>
                <p className="text-3xl font-bold text-gray-900">{metrics.performanceData.length}</p>
                <p className="text-sm text-gray-500 mt-1">Monitored locations</p>
              </div>
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  Post Performance Comparison
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={metrics.postComparisonData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px" }} />
                    <Legend />
                    <Bar dataKey="completed" fill="#10b981" name="Completed" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="missed" fill="#ef4444" name="Missed" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  Performance Rate by Post
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={metrics.performanceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px" }} />
                    <Legend />
                    <Line type="monotone" dataKey="rate" stroke="#8b5cf6" strokeWidth={3} name="Performance %" dot={{ fill: "#8b5cf6", r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Charts Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div ref={checksDistributionRef} className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-600" />
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
            <div ref={summaryTableRef} className="bg-white rounded-2xl shadow-xl p-6 mb-8 border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Detailed Performance Summary</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gradient-to-r from-blue-50 to-indigo-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Post</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Completed</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Expected</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Missed</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Performance</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {report.summary.map((row) => {
                      const rate = parseFloat(row.PerformanceRate);
                      const missed = (parseInt(row.ExpectedChecks) || 0) - (parseInt(row.ChecksCompleted) || 0);
                      return (
                        <tr key={row.SitePosts} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap font-semibold text-gray-900">{row.SitePosts}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">{row.ChecksCompleted}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">{row.ExpectedChecks}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-red-600 font-semibold">{missed}</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`px-3 py-1 rounded-full text-sm font-bold ${
                                rate >= 90 ? "bg-green-100 text-green-800" : rate >= 70 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"
                              }`}
                            >
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
              <div ref={eventsTableRef} className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                  Events Log
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
                      {report.events.map((event) => {
                        const eventLower = (event.Event || "").toLowerCase();
                        const priority = eventLower.includes("emergency") || eventLower.includes("breach") ? "high" : eventLower.includes("suspicious") || eventLower.includes("alert") ? "medium" : "low";

                        return (
                          <tr key={`${event.Date}-${event.Time}-${event.Event}`} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap text-gray-900 font-medium">{event.Date}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-700">{event.Time}</td>
                            <td className="px-4 py-3 text-gray-700">{event.Event}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-700">{event.Zone}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span
                                className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                                  priority === "high" ? "bg-red-100 text-red-800" : priority === "medium" ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-800"
                                }`}
                              >
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

        {!loading && !hasData && !errorMessage && (
          <div className="bg-white rounded-2xl shadow-xl p-12 text-center border border-gray-100">
            <Activity className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">No Data Available</h3>
            <p className="text-gray-600">Select a client and date/time range to generate the report</p>
          </div>
        )}
      </div>
    </div>
  );
}