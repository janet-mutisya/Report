import { useEffect, useState, useCallback } from "react";
import {
  AlertCircle,
  Download,
  Calendar,
  Building2,
  FileText,
  TrendingUp,
  Activity,
  MapPin,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Shield,
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
  const [pdfError, setPdfError] = useState("");

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  const createPieChartImage = async (metricsData) => {
    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 400;
    canvas.style.backgroundColor = '#ffffff';

    const ctx = canvas.getContext('2d');
    
    const completed = metricsData.totalCompleted;
    const missed = metricsData.totalMissedPatrols;
    const total = completed + missed;
    const completedPercent = total > 0 ? (completed / total * 100).toFixed(1) : 0;
    const missedPercent = total > 0 ? (missed / total * 100).toFixed(1) : 0;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2 - 20;
    const radius = Math.min(centerX, centerY) - 60;

    // Draw completed section (green)
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, 0, (completed / total) * 2 * Math.PI);
    ctx.closePath();
    ctx.fillStyle = '#10b981';
    ctx.fill();

    // Draw missed section (red)
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, (completed / total) * 2 * Math.PI, 2 * Math.PI);
    ctx.closePath();
    ctx.fillStyle = '#ef4444';
    ctx.fill();

    // Add labels
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Completed label
    const completedAngle = (completed / total) * Math.PI;
    const completedX = centerX + Math.cos(completedAngle) * (radius * 0.6);
    const completedY = centerY + Math.sin(completedAngle) * (radius * 0.6);
    ctx.fillText(`${completedPercent}%`, completedX, completedY - 10);
    ctx.font = '14px Arial';
    ctx.fillText('Completed', completedX, completedY + 12);

    // Missed label
    const missedAngle = (completed / total) * 2 * Math.PI + (missed / total) * Math.PI;
    const missedX = centerX + Math.cos(missedAngle) * (radius * 0.6);
    const missedY = centerY + Math.sin(missedAngle) * (radius * 0.6);
    ctx.font = 'bold 18px Arial';
    ctx.fillText(`${missedPercent}%`, missedX, missedY - 10);
    ctx.font = '14px Arial';
    ctx.fillText('Missed', missedX, missedY + 12);

    // Title
    ctx.fillStyle = '#1e40af';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Patrol Checks Distribution', centerX, 40);
    
    // Legend
    ctx.fillStyle = '#10b981';
    ctx.fillRect(centerX - 100, centerY + radius + 30, 15, 15);
    ctx.fillStyle = '#000000';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Completed: ${completed} checks`, centerX - 80, centerY + radius + 40);

    ctx.fillStyle = '#ef4444';
    ctx.fillRect(centerX - 100, centerY + radius + 55, 15, 15);
    ctx.fillStyle = '#000000';
    ctx.fillText(`Missed: ${missed} checks`, centerX - 80, centerY + radius + 65);
    
    return canvas.toDataURL('image/png');
  };

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
        .map((c, idx) => ({
          id: c.id || c._id || idx + 1,
          name: c.name || c.client_name || c.ClientName || c.clientName || "Unnamed Client",
          email: c.email || c.Email || c.clientEmail || "unknown@company.com",
        }));

      if (formattedClients.length === 0) {
        setErrorMessage("No clients available. Please add clients first.");
      } else {
        setClients(formattedClients);
      }
    } catch (error) {
      setErrorMessage("Failed to load clients list: " + (error?.message || String(error)));
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

  const formatEventDescription = (event) => {
    if (!event) return "Unknown Event";
    
    if (typeof event === 'string' && (event.includes('VIGICONTROL:') || event.includes('Arrival') || event.includes('Login') || event.includes('Logout'))) {
      return event;
    }
    
    const eventStr = String(event).toLowerCase().trim();
    
    const eventMappings = {
      'v04': 'VIGICONTROL: Arrival',
      'v10': 'VIGICONTROL: Login',
      'v11': 'VIGICONTROL: Logout',
      '_pi': 'Patrol Incident',
      '_pd': 'Patrol Departure',
      'vigicontrol: arribo': 'VIGICONTROL: Arrival',
      'vigicontrol: login': 'VIGICONTROL: Login',
      'vigicontrol: logout': 'VIGICONTROL: Logout',
    };

    if (eventMappings[eventStr]) {
      return eventMappings[eventStr];
    }

    for (const [code, description] of Object.entries(eventMappings)) {
      if (eventStr.includes(code)) {
        return description;
      }
    }

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
    } catch (error) {
      console.error("Error fetching report:", error);
      setErrorMessage("Failed to load report. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function exportToPDF() {
    if (!report) return;

    setPdfLoading(true);
    setPdfError("");

    try {
      const jsPDFScript = document.createElement('script');
      jsPDFScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      
      const html2canvasScript = document.createElement('script');
      html2canvasScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

      await Promise.all([
        new Promise((resolve, reject) => {
          jsPDFScript.onload = resolve;
          jsPDFScript.onerror = () => reject(new Error('Failed to load jsPDF'));
          document.head.appendChild(jsPDFScript);
        }),
        new Promise((resolve, reject) => {
          html2canvasScript.onload = resolve;
          html2canvasScript.onerror = () => reject(new Error('Failed to load html2canvas'));
          document.head.appendChild(html2canvasScript);
        })
      ]);

      const { jsPDF } = window.jspdf;

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      let currentY = margin;

      const COMPANY_NAME = "BOB_MORGAN SECURITY SERVICES";

      const addHeader = () => {
        // Blue header background
        pdf.setFillColor(37, 99, 235);
        pdf.rect(0, 0, pageWidth, 35, 'F');
        
        // White logo/text area
        pdf.setFillColor(255, 255, 255);
        pdf.rect(margin, 8, pageWidth - 2 * margin, 20, 'F');
        
        // Company name - only place it appears
        pdf.setTextColor(37, 99, 235);
        pdf.setFontSize(18);
        pdf.setFont(undefined, 'bold');
        pdf.text(COMPANY_NAME, pageWidth / 2, 16, { align: 'center' });
        
        // Report title
        pdf.setFontSize(12);
        pdf.setTextColor(100, 100, 100);
        pdf.text('Guard Performance Report', pageWidth / 2, 23, { align: 'center' });
        
        // Generation timestamp
        const now = new Date();
        pdf.setFontSize(9);
        pdf.text(`Generated: ${now.toLocaleString()}`, pageWidth - margin, 28, { align: 'right' });
      };

      const addFooter = () => {
        const footerY = pageHeight - 25;
        
        // Light blue footer background
        pdf.setFillColor(240, 245, 255);
        pdf.rect(0, footerY, pageWidth, 25, 'F');
        
        // Footer content with proper spacing
        pdf.setTextColor(37, 99, 235);
        pdf.setFontSize(10);
        pdf.setFont(undefined, 'bold');
        
        // First line - Contact information only
        pdf.text('Phone: 0722 330 330 | 0722 806 076', margin, footerY + 8);
        
        // Second line - Website and address
        pdf.setFontSize(9);
        pdf.setFont(undefined, 'normal');
        pdf.text('Website: www.bmsecurity.com', margin, footerY + 16);
        pdf.text('Address: Polo Cottage, Jamhuri', pageWidth / 2, footerY + 16, { align: 'center' });
        
        // Page number
        pdf.text(`Page ${pdf.internal.getNumberOfPages()}`, pageWidth - margin, footerY + 16, { align: 'right' });
      };

      const checkNewPage = (requiredHeight) => {
        if (currentY + requiredHeight > pageHeight - 40) {
          addFooter();
          pdf.addPage();
          currentY = margin;
          addHeader();
          currentY = 40;
          return true;
        }
        return false;
      };

      const addSectionTitle = (title, subtitle = '') => {
        checkNewPage(25);
        
        pdf.setFontSize(14);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(37, 99, 235);
        pdf.text(title, margin, currentY);
        currentY += 8;
        
        if (subtitle) {
          pdf.setFontSize(10);
          pdf.setFont(undefined, 'normal');
          pdf.setTextColor(100, 100, 100);
          pdf.text(subtitle, margin, currentY);
          currentY += 6;
        }
        
        currentY += 8;
        pdf.setTextColor(0, 0, 0);
      };

      const addSpacer = (height = 10) => {
        currentY += height;
      };

      // Start PDF generation
      addHeader();
      currentY = 40;

      // Report Information Section
      addSectionTitle('REPORT INFORMATION', 'Client and time period details');
      
      pdf.setFontSize(11);
      pdf.setFont(undefined, 'bold');
      pdf.text('Client:', margin, currentY);
      pdf.setFont(undefined, 'normal');
      pdf.text(client, margin + 20, currentY);
      currentY += 7;

      pdf.setFont(undefined, 'bold');
      pdf.text('Report Period:', margin, currentY);
      pdf.setFont(undefined, 'normal');
      pdf.text(`${startDate} ${startTime || '00:00'} to ${endDate} ${endTime || '23:59'}`, margin + 35, currentY);
      currentY += 7;

      pdf.setFont(undefined, 'bold');
      pdf.text('Generated On:', margin, currentY);
      pdf.setFont(undefined, 'normal');
      pdf.text(new Date().toLocaleString(), margin + 32, currentY);
      
      addSpacer(20);

      // Incident Report Section
      if (report.incident && report.incident.length > 0) {
        addSectionTitle('INCIDENT REPORT', 'Security incidents and alerts');
        
        const incidentData = report.incident[0];
        if (incidentData.IncidentReport) {
          checkNewPage(30);
          
          // Incident box with background
          pdf.setFillColor(254, 252, 232);
          pdf.rect(margin, currentY, pageWidth - 2 * margin, 25, 'F');
          pdf.setDrawColor(245, 158, 11);
          pdf.rect(margin, currentY, pageWidth - 2 * margin, 25);
          
          pdf.setFontSize(11);
          pdf.setFont(undefined, 'bold');
          pdf.setTextColor(180, 83, 9);
          pdf.text(incidentData.IncidentReport, margin + 5, currentY + 10, { 
            maxWidth: pageWidth - 2 * margin - 10 
          });
          
          currentY += 35;
        }
        addSpacer(15);
      }

      // Performance Overview with Chart
      if (metrics) {
        addSectionTitle('PERFORMANCE OVERVIEW', 'Patrol completion statistics');
        
        try {
          checkNewPage(120);
          const pieChartImage = await createPieChartImage(metrics);
          pdf.addImage(pieChartImage, 'PNG', margin, currentY, pageWidth - 2 * margin, 100);
          currentY += 110;
        } catch (chartError) {
          console.warn('Pie chart generation failed:', chartError);
          currentY += 10;
        }

        addSpacer(10);
      }

      // Overall Performance Statistics
      if (metrics) {
        addSectionTitle('OVERALL PERFORMANCE STATISTICS', 'Key performance indicators');
        
        const statsData = [
          `• Patrol Checks Completed: ${metrics.totalCompleted} of ${metrics.totalExpected} expected`,
          `• Overall Performance Rate: ${metrics.overallRate}% completion rate`,
          `• Active Security Posts: ${metrics.performanceData.length} monitored locations`,
          `• Total Incidents Reported: ${metrics.totalIncidents} security incidents`,
          `• Missed Patrol Checks: ${metrics.totalMissedPatrols} incomplete checks`,
          `• Patrol Efficiency: ${((metrics.totalCompleted / metrics.totalExpected) * 100).toFixed(1)}% overall efficiency`
        ];
        
        statsData.forEach(line => {
          checkNewPage(8);
          pdf.setFontSize(10);
          pdf.text(line, margin + 5, currentY);
          currentY += 6;
        });
        
        addSpacer(20);
      }

      // Patrol Performance Summary Table
      if (report.summary && report.summary.length > 0) {
        addSectionTitle('PATROL PERFORMANCE SUMMARY', 'Detailed post-by-post performance');
        
        checkNewPage(30);
        
        // Table header
        pdf.setFillColor(37, 99, 235);
        pdf.rect(margin, currentY, pageWidth - 2 * margin, 10, 'F');
        
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(9);
        pdf.setFont(undefined, 'bold');
        
        const headers = ['Security Post', 'Completed', 'Expected', 'Performance'];
        const colWidths = [80, 25, 25, 30];
        let xPos = margin + 5;
        
        headers.forEach((header, headerIdx) => {
          pdf.text(header, xPos, currentY + 7);
          xPos += colWidths[headerIdx];
        });
        
        currentY += 12;
        pdf.setTextColor(0, 0, 0);
        pdf.setFont(undefined, 'normal');

        // Table rows
        report.summary.forEach((row, index) => {
          checkNewPage(8);
          
          // Alternate row background
          if (index % 2 === 0) {
            pdf.setFillColor(248, 250, 252);
            pdf.rect(margin, currentY - 3, pageWidth - 2 * margin, 8, 'F');
          }

          xPos = margin + 5;
          const values = [
            row.SitePosts,
            String(row.ChecksCompleted),
            String(row.ExpectedChecks),
            row.PerformanceRate
          ];
          
          values.forEach((value, valueIdx) => {
            pdf.text(String(value), xPos, currentY + 3);
            xPos += colWidths[valueIdx];
          });
          
          currentY += 8;
        });
        
        addSpacer(20);
      }

      // Complete Events Log
      if (report.events && report.events.length > 0) {
        addSectionTitle('COMPLETE EVENTS LOG', `Total of ${report.events.length} logged events`);
        
        checkNewPage(20);
        
        // Events table header
        pdf.setFillColor(37, 99, 235);
        pdf.rect(margin, currentY, pageWidth - 2 * margin, 8, 'F');
        
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(8);
        pdf.setFont(undefined, 'bold');
        
        const eventHeaders = ['Date', 'Time', 'Event Description', 'Zone'];
        const eventColWidths = [20, 18, 110, 25];
        let eventXPos = margin + 3;
        
        eventHeaders.forEach((header, headerIdx) => {
          pdf.text(header, eventXPos, currentY + 5);
          eventXPos += eventColWidths[headerIdx];
        });
        
        currentY += 10;
        pdf.setTextColor(0, 0, 0);
        pdf.setFont(undefined, 'normal');

        // Events table rows
        report.events.forEach((eventItem, index) => {
          checkNewPage(6);
          
          // Alternate row background for better readability
          if (index % 2 === 0) {
            pdf.setFillColor(248, 250, 252);
            pdf.rect(margin, currentY - 2, pageWidth - 2 * margin, 6, 'F');
          }

          eventXPos = margin + 3;
          const eventDescription = eventItem.formattedEvent || formatEventDescription(eventItem.Event);
          const values = [
            eventItem.Date || 'N/A',
            eventItem.Time || 'N/A',
            eventDescription.length > 60 ? eventDescription.substring(0, 57) + '...' : eventDescription,
            eventItem.Zone || 'N/A'
          ];
          
          values.forEach((value, valueIdx) => {
            pdf.text(String(value), eventXPos, currentY + 3);
            eventXPos += eventColWidths[valueIdx];
          });
          
          currentY += 6;
        });
        
        addSpacer(15);
        
        // Events summary
        pdf.setFontSize(10);
        pdf.setFont(undefined, 'bold');
        pdf.text(`Total Events Logged: ${report.events.length}`, margin, currentY);
        currentY += 8;
      }

      // Performance Analysis & Recommendations
      addSectionTitle('PERFORMANCE ANALYSIS & RECOMMENDATIONS', 'Expert insights and improvement suggestions');
      
      const analysisLines = [
        {text: 'PERFORMANCE SUMMARY:', bold: true, spacing: 8},
        {text: `• Overall guard performance: ${metrics?.overallRate}% completion rate`, bold: false, spacing: 6},
        {text: `• Total incidents reported: ${metrics?.totalIncidents}`, bold: false, spacing: 6},
        {text: `• Total patrol checks completed: ${metrics?.totalCompleted} of ${metrics?.totalExpected} expected`, bold: false, spacing: 6},
        {text: `• Active monitoring locations: ${metrics?.performanceData.length} security posts`, bold: false, spacing: 6},
        {text: `• Patrol efficiency: ${((metrics?.totalCompleted / metrics?.totalExpected) * 100).toFixed(1)}%`, bold: false, spacing: 6},
        {text: '', bold: false, spacing: 10},
        {text: 'KEY RECOMMENDATIONS:', bold: true, spacing: 8},
        {text: '• Review posts with performance below 70% for improvement opportunities', bold: false, spacing: 6},
        {text: '• Investigate patterns in reported incidents for preventive measures', bold: false, spacing: 6},
        {text: '• Optimize patrol routes based on performance and incident data', bold: false, spacing: 6},
        {text: '• Ensure all security equipment and systems are functioning properly', bold: false, spacing: 6},
        {text: '• Consider additional training for areas with frequent missed patrols', bold: false, spacing: 6},
        {text: '• Implement regular equipment maintenance schedules', bold: false, spacing: 6},
        {text: '• Enhance communication protocols for incident reporting', bold: false, spacing: 6},
        {text: '• Conduct regular performance reviews with security personnel', bold: false, spacing: 6},
        {text: '• Implement incentive programs for high-performing posts', bold: false, spacing: 6}
      ];

      analysisLines.forEach(line => {
        checkNewPage(10);
        
        if (line.bold) {
          pdf.setFont(undefined, 'bold');
          pdf.setFontSize(11);
          pdf.setTextColor(37, 99, 235);
        } else {
          pdf.setFont(undefined, 'normal');
          pdf.setFontSize(10);
          pdf.setTextColor(0, 0, 0);
        }
        
        if (line.text) {
          pdf.text(line.text, margin, currentY);
        }
        currentY += line.spacing;
      });

      addSpacer(15);

      // Final signature section - removed company name repetition
      checkNewPage(20);
      pdf.setFontSize(9);
      pdf.setFont(undefined, 'normal');
      pdf.setTextColor(100, 100, 100);
      pdf.text('This report contains confidential information intended for authorized personnel only.', pageWidth / 2, currentY, { align: 'center' });

      // Add final footer
      addFooter();

      const filename = `Security-Guard-Report-${client}-${startDate}-${endDate}.pdf`;
      pdf.save(filename);

    } catch (error) {
      console.error('PDF generation error:', error);
      setPdfError('Failed to generate PDF: ' + error.message);
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

    const totalCompleted = performanceData.reduce((sum, item) => sum + item.completed, 0);
    const totalExpected = performanceData.reduce((sum, item) => sum + item.expected, 0);
    const overallRate = totalExpected > 0 ? ((totalCompleted / totalExpected) * 100).toFixed(1) : 0;
    const totalMissedPatrols = performanceData.reduce((sum, post) => sum + post.missed, 0);

    const eventsByZone = {};
    const eventsByDay = {};
    
    if (report.events) {
      report.events.forEach((event) => {
        const zone = event.Zone || "Unknown";
        eventsByZone[zone] = (eventsByZone[zone] || 0) + 1;

        if (event.Date) {
          try {
            const date = new Date(event.Date);
            if (!isNaN(date.getTime())) {
              const day = date.toLocaleDateString('en-US', { weekday: 'short' });
              eventsByDay[day] = (eventsByDay[day] || 0) + 1;
            }
          } catch (dateError) {
            console.warn('Invalid date format in event:', event.Date, dateError);
          }
        }
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

    const weeklyTrendData = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => {
      const dayIncidents = eventsByDay[day] || 0;
      return {
        day,
        performance: dayIncidents > 0 ? Math.max(70, 95 - (dayIncidents * 3)) : 90,
        incidents: dayIncidents,
      };
    });

    const incidentReport = report.incident?.[0]?.IncidentReport || "TOTAL INCIDENTS REPORTED = 0";
    const incidentCount = parseInt(incidentReport.split('=')[1]) || 0;

    return {
      totalIncidents: incidentCount,
      totalMissedPatrols,
      performanceData,
      zoneData,
      totalCompleted,
      totalExpected,
      overallRate,
      postComparisonData,
      weeklyTrendData,
    };
  };

  const metrics = report ? calculateDashboardMetrics() : null;
  const hasData = report && (report.summary?.length > 0 || report.events?.length > 0);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="bg-blue-600 rounded-xl shadow-lg p-8 mb-8 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold mb-2 flex items-center gap-3">
                <Activity className="w-10 h-10" />
                Live Performance Dashboard
              </h1>
              <p className="text-blue-100 text-lg">Real-time security operations analytics</p>
            </div>
            <div className="hidden md:block">
              <div className="bg-blue-500 rounded-lg px-6 py-3">
                <div className="text-sm text-blue-100">Last Updated</div>
                <div className="text-xl font-semibold">{new Date().toLocaleTimeString()}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 mb-8 border border-gray-200">
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
                className="w-full bg-blue-600 text-white rounded-lg p-2.5 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-all shadow-md hover:shadow-lg"
              >
                {loading ? "Loading..." : "Generate Report"}
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

        {pdfError && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6 flex items-start gap-3 shadow-md">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">PDF Generation Error</h3>
              <p className="text-red-700">{pdfError}</p>
            </div>
          </div>
        )}

        {hasData && metrics && (
          <>
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

            {report.incident && report.incident.length > 0 && (
              <div className="bg-white rounded-xl shadow-lg p-6 mb-8 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  Incident Report
                </h3>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <p className="text-lg font-semibold text-amber-800">
                    {report.incident[0].IncidentReport}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-blue-500 rounded-xl shadow-lg p-6 text-white">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase tracking-wide">Total Incidents</h3>
                  <AlertTriangle className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.totalIncidents}</p>
                <p className="text-sm opacity-80">Reported incidents</p>
              </div>

              <div className="bg-green-500 rounded-xl shadow-lg p-6 text-white">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase tracking-wide">Checks Completed</h3>
                  <CheckCircle className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.totalCompleted}</p>
                <p className="text-sm opacity-80">Total patrol checks</p>
              </div>

              <div className="bg-red-500 rounded-xl shadow-lg p-6 text-white">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase tracking-wide">Missed Patrols</h3>
                  <XCircle className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.totalMissedPatrols}</p>
                <p className="text-sm opacity-80">Incomplete checks</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-700">Overall Performance</h3>
                  <Activity className="w-5 h-5 text-green-600" />
                </div>
                <p className="text-3xl font-bold text-gray-900">{metrics.overallRate}%</p>
                <p className="text-sm text-gray-500 mt-1">Completion rate</p>
              </div>

              <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-700">Active Posts</h3>
                  <MapPin className="w-5 h-5 text-purple-600" />
                </div>
                <p className="text-3xl font-bold text-gray-900">{metrics.performanceData.length}</p>
                <p className="text-sm text-gray-500 mt-1">Monitored locations</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
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

              <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-600" />
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-blue-600" />
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

              {metrics.zoneData.length > 0 && (
                <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                  <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-blue-600" />
                    Events by Zone
                  </h3>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={metrics.zoneData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" tick={{ fill: "#6b7280", fontSize: 11 }} width={100} />
                      <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px" }} />
                      <Bar dataKey="events" fill="#f59e0b" radius={[0, 8, 8, 0]} name="Reported Events" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="mb-8">
              <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  Weekly Performance Trend
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={metrics.weeklyTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px" }} />
                    <Legend />
                    <Bar yAxisId="right" dataKey="incidents" fill="#f59e0b" name="Reported Events" />
                    <Line yAxisId="left" type="monotone" dataKey="performance" stroke="#8884d8" strokeWidth={3} name="Performance %" dot={{ fill: "#8884d8", r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6 mb-8 border border-gray-200">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Detailed Performance Summary</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-blue-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Post</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Completed</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Expected</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Performance</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {report.summary.map((row, idx) => {
                      const rate = parseFloat(row.PerformanceRate);
                      return (
                        <tr key={idx} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap font-semibold text-gray-900">{row.SitePosts}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">{row.ChecksCompleted}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">{row.ExpectedChecks}</td>
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

            {report.events?.length > 0 && (
              <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-600" />
                  Recent Events Log
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-blue-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Time</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Event Description</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Zone</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {report.events.map((event, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap text-gray-900 font-medium">{event.Date}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">{event.Time}</td>
                          <td className="px-4 py-3 text-gray-700">
                            {event.formattedEvent || formatEventDescription(event.Event)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">{event.Zone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !hasData && !errorMessage && (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center border border-gray-200">
            <Activity className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">No Data Available</h3>
            <p className="text-gray-600">Select a client and date/time range to generate the dashboard</p>
          </div>
        )}
      </div>
    </div>
  );
}