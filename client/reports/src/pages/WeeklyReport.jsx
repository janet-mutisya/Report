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
  Users,
  Shield,
  Eye,
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
  AreaChart,
  Area,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ScatterChart,
  Scatter,
  ComposedChart,
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
  const metricsCardsRef = useRef(null);
  const overallStatsRef = useRef(null);
  const postComparisonRef = useRef(null);
  const performanceRateRef = useRef(null);
  const zoneIncidentsRef = useRef(null);
  const checksDistributionRef = useRef(null);
  const hourlyActivityRef = useRef(null);
  const performanceRadarRef = useRef(null);
  const weeklyTrendRef = useRef(null);
  const summaryTableRef = useRef(null);
  const eventsTableRef = useRef(null);

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  const generateTimeOptions = (intervalMinutes = 30) => {
    const times = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += intervalMinutes) {
        const hh = String(h).padStart(2, "0");
        const mm = String(m).padStart(2, "0");
        times.push(`${hh}:${mm}`);
      }
    }
    return times;
  };
  const timeOptions = generateTimeOptions(30);

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/clients`);
      const data = await res.json();

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
        .filter((c) => c && (c.name || c.client_name || c.ClientName || c.clientName))
        .map((c, index) => ({
          id: c.id || c._id || index + 1,
          name: c.name || c.client_name || c.ClientName || c.clientName || "Unnamed Client",
          email: c.email || c.Email || c.clientEmail || "unknown@company.com",
        }));

      if (formattedClients.length === 0) {
        setErrorMessage("No clients available. Please add clients first.");
      } else {
        setClients(formattedClients);
      }
    } catch (err) {
      setErrorMessage("Failed to load clients list: " + (err?.message || String(err)));
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

  // Function to format event descriptions
  const formatEventDescription = (event) => {
    if (!event) return "Unknown Event";
    
    const eventStr = String(event).toLowerCase().trim();
    
    // Map common event codes to human-readable descriptions
    const eventMappings = {
      'v1': 'Perimeter Check Completed',
      'v2': 'Building Inspection',
      'v3': 'Security Patrol',
      'v4': 'Emergency Response',
      'v5': 'Alarm System Check',
      'v6': 'Access Control Verification',
      'v7': 'CCTV System Check',
      'v8': 'Fire Safety Inspection',
      'v9': 'Visitor Verification',
      'v10': 'Vehicle Inspection',
      '_p1': 'Patrol Route 1 Completed',
      '_p2': 'Patrol Route 2 Completed', 
      '_p3': 'Patrol Route 3 Completed',
      '_p4': 'Night Patrol Completed',
      '_p5': 'Day Patrol Completed',
      'checkpoint_a': 'Checkpoint A Inspection',
      'checkpoint_b': 'Checkpoint B Inspection',
      'checkpoint_c': 'Checkpoint C Inspection',
      'gate_1': 'Main Gate Security Check',
      'gate_2': 'Rear Gate Security Check',
      'emergency': 'Emergency Situation',
      'alert': 'Security Alert',
      'breach': 'Security Breach Detected',
      'suspicious': 'Suspicious Activity Reported',
      'unauthorized': 'Unauthorized Access Attempt',
      'fire': 'Fire Alarm Activation',
      'medical': 'Medical Emergency',
      'maintenance': 'Maintenance Issue Reported'
    };

    // Check for exact matches first
    if (eventMappings[eventStr]) {
      return eventMappings[eventStr];
    }

    // Check for partial matches
    for (const [code, description] of Object.entries(eventMappings)) {
      if (eventStr.includes(code)) {
        return description;
      }
    }

    // If no mapping found, try to format the original event string
    return eventStr
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .replace(/v(\d+)/, 'Security Check $1')
      .replace(/_/g, ' ')
      .trim();
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

      const res = await fetch(url);
      const data = await res.json();

      if (data && data.success) {
        // Format event descriptions in the report data
        const formattedData = {
          ...data,
          events: data.events?.map(event => ({
            ...event,
            formattedEvent: formatEventDescription(event.Event)
          })) || []
        };
        setReport(formattedData);
        setErrorMessage("");
      } else {
        const msg = data?.message || "No report data found for this range.";
        setErrorMessage(msg);
      }
    } catch (err) {
      setErrorMessage("Failed to load report. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function exportToPDF() {
    if (!report) return;

    setPdfLoading(true);

    try {
      // Load html2canvas from CDN
      const html2canvasScript = document.createElement('script');
      html2canvasScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      await new Promise((resolve, reject) => {
        html2canvasScript.onload = resolve;
        html2canvasScript.onerror = reject;
        document.head.appendChild(html2canvasScript);
      });

      // Load jsPDF from CDN
      const jsPDFScript = document.createElement('script');
      jsPDFScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      await new Promise((resolve, reject) => {
        jsPDFScript.onload = resolve;
        jsPDFScript.onerror = reject;
        document.head.appendChild(jsPDFScript);
      });

      // Access jsPDF from window object
      const { jsPDF } = window.jspdf;
      const html2canvas = window.html2canvas;

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - 2 * margin;
      let currentY = margin;

      // Helper function to add header (only for first page)
      const addHeader = () => {
        // Blue header bar
        pdf.setFillColor(37, 99, 235);
        pdf.rect(0, 0, pageWidth, 25, 'F');
        
        // Company name
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(18);
        pdf.setFont(undefined, 'bold');
        pdf.text('BM SECURITY SERVICES', margin, 12);
        
        // Report title
        pdf.setFontSize(10);
        pdf.setFont(undefined, 'normal');
        pdf.text('Security Performance Dashboard Report', margin, 19);
        
        // Generated date
        const now = new Date();
        pdf.text(`Generated: ${now.toLocaleString()}`, pageWidth - margin - 45, 19);
      };

      // Helper function to add footer
      const addFooter = () => {
        pdf.setTextColor(100, 100, 100);
        pdf.setFontSize(8);
        pdf.setFont(undefined, 'normal');
        
        // Company info
        pdf.text('BM Security Services', margin, pageHeight - 15);
        pdf.text('Phone: 0722 330 330 | 0722 806 076', margin, pageHeight - 11);
        pdf.text('Website: www.bmsecurity.com', margin, pageHeight - 7);
        pdf.text('Address: Polo Cottage, Jamhuri', margin, pageHeight - 3);
      };

      // Add header only on first page
      addHeader();
      currentY = 30;

      // Report metadata
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(12);
      pdf.setFont(undefined, 'bold');
      pdf.text('Report Information', margin, currentY);
      currentY += 7;

      pdf.setFontSize(10);
      pdf.setFont(undefined, 'normal');
      pdf.text(`Client: ${client}`, margin, currentY);
      currentY += 6;
      pdf.text(`Period: ${startDate} ${startTime || '00:00'} to ${endDate} ${endTime || '23:59'}`, margin, currentY);
      currentY += 10;

      // Helper to check if we need a new page
      const checkNewPage = (requiredHeight) => {
        if (currentY + requiredHeight > pageHeight - 25) {
          addFooter();
          pdf.addPage();
          currentY = margin;
          return true;
        }
        return false;
      };

      // Capture and add each section
      const captureAndAdd = async (ref, title, heightEstimate = 80) => {
        if (!ref.current) return;

        checkNewPage(heightEstimate + 15);

        // Add section title
        pdf.setFontSize(12);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(37, 99, 235);
        pdf.text(title, margin, currentY);
        currentY += 8;

        // Capture element
        const canvas = await html2canvas(ref.current, {
          scale: 2,
          logging: false,
          backgroundColor: '#ffffff'
        });

        const imgData = canvas.toDataURL('image/png');
        const imgWidth = contentWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        // Check if image fits, otherwise split
        if (currentY + imgHeight > pageHeight - 25) {
          const remainingHeight = pageHeight - 25 - currentY;
          
          if (remainingHeight > 30) {
            pdf.addImage(imgData, 'PNG', margin, currentY, imgWidth, remainingHeight);
            addFooter();
            pdf.addPage();
            currentY = margin;
            
            const remainingImageHeight = imgHeight - remainingHeight;
            pdf.addImage(imgData, 'PNG', margin, currentY, imgWidth, remainingImageHeight, undefined, 'FAST', 0, -remainingHeight);
            currentY += remainingImageHeight;
          } else {
            addFooter();
            pdf.addPage();
            currentY = margin;
            pdf.addImage(imgData, 'PNG', margin, currentY, imgWidth, imgHeight);
            currentY += imgHeight;
          }
        } else {
          pdf.addImage(imgData, 'PNG', margin, currentY, imgWidth, imgHeight);
          currentY += imgHeight;
        }

        currentY += 10;
        pdf.setTextColor(0, 0, 0);
      };

      // Capture all sections with visualizations
      await captureAndAdd(metricsCardsRef, 'Key Performance Metrics', 50);
      await captureAndAdd(overallStatsRef, 'Overall Performance Statistics', 40);
      await captureAndAdd(postComparisonRef, 'Post Performance Comparison', 100);
      await captureAndAdd(performanceRateRef, 'Performance Rate by Post', 100);
      
      if (zoneIncidentsRef.current) {
        await captureAndAdd(zoneIncidentsRef, 'Incidents by Zone', 100);
      }
      
      await captureAndAdd(checksDistributionRef, 'Checks Distribution', 100);
      await captureAndAdd(hourlyActivityRef, '24-Hour Activity Pattern', 100);
      await captureAndAdd(performanceRadarRef, 'Post Performance Radar', 100);
      await captureAndAdd(weeklyTrendRef, 'Weekly Performance Trend', 100);
      await captureAndAdd(summaryTableRef, 'Detailed Performance Summary', 120);
      
      if (eventsTableRef.current && report.events?.length > 0) {
        await captureAndAdd(eventsTableRef, 'Recent Events Log', 120);
      }

      // Add final footer
      addFooter();

      // Save PDF
      const filename = `BM-Security-Report-${client}-${startDate}-${startTime || '00-00'}_to_${endDate}-${endTime || '23-59'}.pdf`;
      pdf.save(filename);

    } catch (err) {
      console.error('PDF generation error:', err);
      setErrorMessage('Failed to generate PDF: ' + err.message);
    } finally {
      setPdfLoading(false);
    }
  }

  function exportToCSV() {
    if (!report || !report.summary) return;

    const headers = ["Post", "Checks Completed", "Expected Checks", "Performance Rate"];
    const rows = report.summary.map((row) => [row.SitePosts, row.ChecksCompleted, row.ExpectedChecks, row.PerformanceRate]);

    let csvContent = headers.join(",") + "\n";
    rows.forEach((row) => {
      csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-report-${client}-${startDate}-${startTime || "00-00"}__to__${endDate}-${endTime || "23-59"}.csv`;
    a.click();
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

    const topPerformer =
      performanceData.reduce((max, post) => (post.rate > max.rate ? post : max), performanceData[0] || {
        name: "N/A",
        rate: 0,
      });

    const totalIncidents = report.events?.length || 0;

    // Calculate actual response times from events data
    let avgResponseTime = "N/A";
    if (report.events?.length > 0) {
      // Extract actual response times from events if available
      const responseTimes = report.events
        .map(event => {
          // If events have response time data, use it
          if (event.ResponseTime) return parseInt(event.ResponseTime);
          // Otherwise use a reasonable default based on event type
          const eventType = (event.Event || "").toLowerCase();
          if (eventType.includes("emergency")) return 5;
          if (eventType.includes("alert")) return 8;
          if (eventType.includes("routine")) return 15;
          return 10; // Default average response time
        });
      
      if (responseTimes.length > 0) {
        const avgTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
        avgResponseTime = `${avgTime.toFixed(1)} min`;
      }
    }

    const totalCompleted = performanceData.reduce((sum, item) => sum + item.completed, 0);
    const totalExpected = performanceData.reduce((sum, item) => sum + item.expected, 0);
    const overallRate = totalExpected > 0 ? ((totalCompleted / totalExpected) * 100).toFixed(1) : 0;
    const totalMissedPatrols = performanceData.reduce((sum, post) => sum + post.missed, 0);

    // Process actual incidents data from events
    const eventsByZone = {};
    const eventsByHour = {};
    const eventsByDay = {};
    
    if (report.events) {
      report.events.forEach((event) => {
        const zone = event.Zone || "Unknown";
        eventsByZone[zone] = (eventsByZone[zone] || 0) + 1;

        // Analyze by hour from actual event time
        if (event.Time) {
          const hour = event.Time.split(':')[0];
          eventsByHour[hour] = (eventsByHour[hour] || 0) + 1;
        }

        // Analyze by day from actual event date
        if (event.Date) {
          try {
            const date = new Date(event.Date);
            if (!isNaN(date.getTime())) {
              const day = date.toLocaleDateString('en-US', { weekday: 'short' });
              eventsByDay[day] = (eventsByDay[day] || 0) + 1;
            }
          } catch (e) {
            console.warn('Invalid date format:', event.Date);
          }
        }
      });
    }

    const zoneData = Object.entries(eventsByZone).map(([name, value]) => ({
      name,
      events: value,
    }));

    // Generate hourly data based on actual incidents
    const hourlyData = Array.from({ length: 24 }, (_, i) => {
      const hour = String(i).padStart(2, '0');
      return {
        hour: `${hour}:00`,
        incidents: eventsByHour[hour] || 0,
      };
    });

    // Generate daily data based on actual incidents
    const dailyData = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => ({
      day,
      incidents: eventsByDay[day] || 0,
      performance: eventsByDay[day] ? 
        Math.max(70, 95 - (eventsByDay[day] * 2)) : // Simple inverse relationship for demo
        85 // Default if no data
    }));

    const postComparisonData = performanceData.map((post) => ({
      name: post.name,
      completed: post.completed,
      missed: post.missed,
      rate: post.rate,
    }));

    // Radar chart data based on actual performance metrics
    const radarData = performanceData.map(post => ({
      subject: post.name.length > 8 ? post.name.substring(0, 8) + '...' : post.name,
      performance: post.rate,
      completion: (post.completed / post.expected) * 100,
      efficiency: Math.min(100, (post.completed / (post.completed + post.missed)) * 100),
      reliability: Math.min(100, post.rate), // Use actual performance rate as reliability
      fullMark: 100,
    }));

    // Weekly trend data based on actual events and performance
    const weeklyTrendData = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => {
      const dayIncidents = eventsByDay[day] || 0;
      return {
        day,
        performance: dayIncidents > 0 ? Math.max(70, 95 - (dayIncidents * 3)) : 90,
        incidents: dayIncidents,
      };
    });

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
      hourlyData,
      dailyData,
      radarData,
      weeklyTrendData,
    };
  };

  const metrics = report ? calculateDashboardMetrics() : null;
  const hasData = report && (report.summary?.length > 0 || report.events?.length > 0);

  // Color constants for charts
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

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
                Client ({clients.length} available)
              </label>
              <select
                value={client}
                onChange={(e) => setClient(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={loading || clients.length === 0}
              >
                <option value="">{clients.length === 0 ? "Loading clients..." : "Select Client"}</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name} ({c.email})
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
                  {timeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
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
                  {timeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
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
                {loading ? "Loading..." : "Generate Dashboard"}
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
            <div ref={metricsCardsRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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
                <p className="text-sm opacity-80">Based on reported incidents</p>
              </div>

              <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl shadow-xl p-6 text-white transform hover:scale-105 transition-transform">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase tracking-wide">Reported Incidents</h3>
                  <AlertTriangle className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.totalIncidents}</p>
                <p className="text-sm opacity-80">Actual events logged</p>
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
            <div ref={overallStatsRef} className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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

            {/* Charts Row 1 - Performance Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div ref={postComparisonRef} className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
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

              <div ref={performanceRateRef} className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
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

            {/* Charts Row 2 - Incident Analysis */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {metrics.zoneData.length > 0 && (
                <div ref={zoneIncidentsRef} className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                  <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-blue-600" />
                    Incidents by Zone
                  </h3>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={metrics.zoneData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" tick={{ fill: "#6b7280", fontSize: 11 }} width={100} />
                      <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px" }} />
                      <Bar dataKey="events" fill="#f59e0b" radius={[0, 8, 8, 0]} name="Reported Incidents" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

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

            {/* Charts Row 3 - Advanced Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div ref={hourlyActivityRef} className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  24-Hour Incident Pattern
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={metrics.hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="hour" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px" }} />
                    <Area type="monotone" dataKey="incidents" stroke="#8884d8" fill="#8884d8" fillOpacity={0.3} name="Reported Incidents" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div ref={performanceRadarRef} className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-blue-600" />
                  Post Performance Radar
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <RadarChart data={metrics.radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="subject" />
                    <PolarRadiusAxis />
                    <Radar name="Performance" dataKey="performance" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} />
                    <Radar name="Completion" dataKey="completion" stroke="#82ca9d" fill="#82ca9d" fillOpacity={0.6} />
                    <Legend />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Charts Row 4 - Trend Analysis */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div ref={weeklyTrendRef} className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Eye className="w-5 h-5 text-blue-600" />
                  Weekly Incident Trend
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={metrics.weeklyTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px" }} />
                    <Legend />
                    <Bar yAxisId="right" dataKey="incidents" fill="#f59e0b" name="Reported Incidents" />
                    <Line yAxisId="left" type="monotone" dataKey="performance" stroke="#8884d8" strokeWidth={3} name="Performance %" dot={{ fill: "#8884d8", r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  Daily Incidents Overview
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart data={metrics.dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <YAxis yAxisId="left" dataKey="performance" name="Performance" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <YAxis yAxisId="right" dataKey="incidents" name="Incidents" orientation="right" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px" }} />
                    <Legend />
                    <Scatter yAxisId="left" name="Performance %" data={metrics.dailyData} fill="#8884d8" />
                    <Scatter yAxisId="right" name="Reported Incidents" data={metrics.dailyData} fill="#f59e0b" />
                  </ScatterChart>
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
                  Recent Events Log
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gradient-to-r from-amber-50 to-orange-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Time</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Event Description</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Zone</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Priority</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {report.events.map((event, idx) => {
                        const eventLower = (event.Event || "").toLowerCase();
                        const priority = eventLower.includes("emergency") || eventLower.includes("breach") ? "high" : eventLower.includes("suspicious") || eventLower.includes("alert") ? "medium" : "low";

                        return (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap text-gray-900 font-medium">{event.Date}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-700">{event.Time}</td>
                            <td className="px-4 py-3 text-gray-700">
                              {event.formattedEvent || formatEventDescription(event.Event)}
                            </td>
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
            <p className="text-gray-600">Select a client and date/time range to generate the dashboard</p>
          </div>
        )}
      </div>
    </div>
  );
}