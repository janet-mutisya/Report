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
  Clock,
  RefreshCw,
  Sun,
  Moon,
  Users
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

export default function SecurityDashboard() {
  const [clients, setClients] = useState([]);
  const [client, setClient] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [shiftType, setShiftType] = useState("Day/Night");
  const [availableShifts, setAvailableShifts] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [clientScheduleInfo, setClientScheduleInfo] = useState(null);

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  // Enhanced text wrapping for PDF with proper width calculation
  const wrapText = (pdf, text, maxWidth, fontSize = 9) => {
    if (!text) return [''];
    const lines = [];
    const textStr = String(text).trim();
    const words = textStr.split(' ');
    let currentLine = '';
    
    pdf.setFontSize(fontSize);
    
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = pdf.getStringUnitWidth(testLine) * fontSize / pdf.internal.scaleFactor;
      
      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = word;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines.length > 0 ? lines : [''];
  };

  // Create optimized pie chart for PDF
  const createPieChartImage = async (metricsData) => {
    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 280;
    const ctx = canvas.getContext('2d');
    
    const completed = metricsData.totalCompleted;
    const missed = metricsData.totalMissedPatrols;
    const total = completed + missed;
    const completedPercent = total > 0 ? (completed / total * 100).toFixed(1) : 0;
    const missedPercent = total > 0 ? (missed / total * 100).toFixed(1) : 0;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 85;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (completed > 0) {
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, 0, (completed / total) * 2 * Math.PI);
      ctx.closePath();
      ctx.fillStyle = '#10b981';
      ctx.fill();
    }

    if (missed > 0) {
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, (completed / total) * 2 * Math.PI, 2 * Math.PI);
      ctx.closePath();
      ctx.fillStyle = '#ef4444';
      ctx.fill();
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (completed > 0) {
      const angle = (completed / total / 2) * 2 * Math.PI;
      const x = centerX + Math.cos(angle) * (radius * 0.6);
      const y = centerY + Math.sin(angle) * (radius * 0.6);
      ctx.fillText(`${completedPercent}%`, x, y - 8);
      ctx.font = '14px Arial';
      ctx.fillText('Completed', x, y + 10);
    }

    if (missed > 0) {
      const angle = (completed / total) * 2 * Math.PI + (missed / total / 2) * 2 * Math.PI;
      const x = centerX + Math.cos(angle) * (radius * 0.6);
      const y = centerY + Math.sin(angle) * (radius * 0.6);
      ctx.font = 'bold 18px Arial';
      ctx.fillText(`${missedPercent}%`, x, y - 8);
      ctx.font = '14px Arial';
      ctx.fillText('Missed', x, y + 10);
    }

    ctx.fillStyle = '#1e40af';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('Performance Overview', centerX, 22);
    
    const legendY = centerY + radius + 40;
    ctx.fillStyle = '#10b981';
    ctx.fillRect(centerX - 90, legendY, 18, 18);
    ctx.fillStyle = '#000000';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Completed: ${completed}`, centerX - 65, legendY + 13);

    ctx.fillStyle = '#ef4444';
    ctx.fillRect(centerX - 90, legendY + 25, 18, 18);
    ctx.fillStyle = '#000000';
    ctx.fillText(`Missed: ${missed}`, centerX - 65, legendY + 38);
    
    return canvas.toDataURL('image/png');
  };

  const fetchClients = useCallback(async () => {
    try {
      setErrorMessage("");
      const response = await fetch(`${API_BASE}/clients`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
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
      setErrorMessage("Failed to load clients: " + (error?.message || String(error)));
      console.error("Client fetch error:", error);
    }
  }, [API_BASE]);

  const fetchClientScheduleInfo = useCallback(async (clientName) => {
    if (!clientName) {
      setAvailableShifts([]);
      setShiftType("Day/Night");
      setClientScheduleInfo(null);
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/reports/client/shifts?client=${encodeURIComponent(clientName)}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setAvailableShifts(data.availableShifts || []);
        setClientScheduleInfo(data.schedule);
        
        const defaultShift = data.availableShifts?.find(shift => shift.default);
        if (defaultShift) {
          setShiftType(defaultShift.value);
        } else {
          setShiftType("Day/Night");
        }
      } else {
        throw new Error(data.message || "Failed to fetch schedule");
      }
    } catch (error) {
      console.warn("Schedule fetch warning:", error);
      const defaultShifts = [
        { value: "Day/Night", label: "Day & Night Shifts", default: true },
        { value: "Day", label: "Day Shift Only" },
        { value: "Night", label: "Night Shift Only" }
      ];
      setAvailableShifts(defaultShifts);
      setShiftType("Day/Night");
      setClientScheduleInfo(null);
    }
  }, [API_BASE]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    if (client) {
      fetchClientScheduleInfo(client);
    } else {
      setAvailableShifts([]);
      setShiftType("Day/Night");
      setClientScheduleInfo(null);
    }
  }, [client, fetchClientScheduleInfo]);

  const generateTimeOptions = (intervalMinutes = 30) => {
    const times = [];
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += intervalMinutes) {
        const hours = String(hour).padStart(2, "0");
        const minutes = String(minute).padStart(2, "0");
        times.push(`${hours}:${minutes}`);
      }
    }
    return times;
  };

  const timeOptions = generateTimeOptions(30);

  const combineDateTime = (dateStr, timeStr) => {
    if (!dateStr) return "";
    const time = timeStr || "00:00";
    const normalized = time.length === 5 ? `${time}:00` : time;
    return `${dateStr}T${normalized}`;
  };

  const formatEventDescription = useCallback((event) => {
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
  }, []);

  const handleFetchReport = useCallback(async () => {
    setErrorMessage("");

    if (!client || !startDate || !endDate) {
      setErrorMessage("Please select client, start date, and end date.");
      return;
    }

    const startDateTime = combineDateTime(startDate, startTime || "00:00");
    const endDateTime = combineDateTime(endDate, endTime || "23:59");

    const startDateObj = new Date(startDateTime);
    const endDateObj = new Date(endDateTime);
    
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      setErrorMessage("Invalid date/time format.");
      return;
    }
    
    if (endDateObj < startDateObj) {
      setErrorMessage("End date/time must be after start date/time.");
      return;
    }

    setLoading(true);
    setReport(null);

    try {
      const url = `${API_BASE}/reports/patrol?client=${encodeURIComponent(
        client
      )}&startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(
        endDateTime
      )}&shiftType=${encodeURIComponent(shiftType)}`;

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }

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
        setErrorMessage(data?.message || "No data found for this range.");
      }
    } catch (error) {
      console.error("Report fetch error:", error);
      setErrorMessage("Failed to load report. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [API_BASE, client, startDate, startTime, endDate, endTime, shiftType, formatEventDescription]);

  const calculateDashboardMetrics = useCallback(() => {
    if (!report?.summary) return null;

    const performanceData = report.summary.map((row) => ({
      name: row.SitePosts,
      completed: parseInt(row.ChecksCompleted) || 0,
      expected: parseInt(row.ExpectedChecks) || 0,
      rate: parseFloat(row.PerformanceRate) || 0,
      missed: Math.max(0, (parseInt(row.ExpectedChecks) || 0) - (parseInt(row.ChecksCompleted) || 0)),
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
          } catch {
            console.warn('Invalid date:', event.Date);
          }
        }
      });
    }

    const zoneData = Object.entries(eventsByZone).map(([name, value]) => ({
      name,
      events: value,
    }));

    const postComparisonData = performanceData.map((post) => ({
      name: post.name.length > 15 ? post.name.substring(0, 15) + '...' : post.name,
      completed: post.completed,
      missed: post.missed,
      rate: post.rate,
    }));

    const weeklyTrendData = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => ({
      day,
      performance: eventsByDay[day] ? Math.max(70, 95 - (eventsByDay[day] * 3)) : 90,
      incidents: eventsByDay[day] || 0,
    }));

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
  }, [report]);

  const getShiftLabel = useCallback((shiftValue) => {
    const shift = availableShifts.find(shiftItem => shiftItem.value === shiftValue);
    return shift?.label || shiftValue;
  }, [availableShifts]);

  const getShiftIcon = (shiftTypeValue) => {
    if (!shiftTypeValue) return <Shield className="w-4 h-4" />;
    const normalized = shiftTypeValue.toLowerCase();
    if (normalized.includes("day") && !normalized.includes("night")) {
      return <Sun className="w-4 h-4 text-yellow-500" />;
    } else if (normalized.includes("night")) {
      return <Moon className="w-4 h-4 text-blue-500" />;
    }
    return <Shield className="w-4 h-4 text-green-500" />;
  };

  // REWRITTEN PDF EXPORT WITH MULTI-LINE TEXT WRAPPING FOR EVENTS
  const exportToPDF = useCallback(async () => {
    if (!report) return;

    setPdfLoading(true);
    setPdfError("");

    try {
      if (!window.jspdf) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load jsPDF'));
          document.head.appendChild(script);
        });
      }

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      let yPos = margin;
      let currentPage = 1;
      let totalPages = 1;

      const COMPANY_NAME = "BOB_MORGAN SECURITY SERVICES";

      const addHeader = (isFirstPage = false) => {
        if (isFirstPage) {
          pdf.setFillColor(30, 64, 175);
          pdf.rect(0, 0, pageWidth, 35, 'F');
          
          pdf.setFillColor(255, 255, 255);
          pdf.rect(margin, 8, pageWidth - 2 * margin, 20, 'F');
          
          pdf.setTextColor(30, 64, 175);
          pdf.setFontSize(16);
          pdf.setFont(undefined, 'bold');
          pdf.text(COMPANY_NAME, pageWidth / 2, 16, { align: 'center' });
          
          pdf.setFontSize(12);
          pdf.setTextColor(100, 116, 139);
          pdf.text('SECURITY PATROL PERFORMANCE REPORT', pageWidth / 2, 23, { align: 'center' });
          
          yPos = 40;
        } else {
          pdf.setFillColor(30, 64, 175);
          pdf.rect(0, 0, pageWidth, 15, 'F');
          
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(10);
          pdf.setFont(undefined, 'bold');
          pdf.text(`${COMPANY_NAME} - Report Continuation`, pageWidth / 2, 10, { align: 'center' });
          
          yPos = 20;
        }
      };

      const addFooter = () => {
        const footerY = pageHeight - 15;
        
        pdf.setDrawColor(226, 232, 240);
        pdf.line(margin, footerY - 5, pageWidth - margin, footerY - 5);
        
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(8);
        pdf.text('Confidential Security Report - For Authorized Personnel Only', margin, footerY);
        pdf.text(`Page ${currentPage} of ${totalPages}`, pageWidth - margin, footerY, { align: 'right' });
        
        currentPage++;
      };

      const checkSpace = (neededHeight) => {
        if (yPos + neededHeight > pageHeight - 20) {
          addFooter();
          pdf.addPage();
          addHeader(false);
          totalPages++;
          return true;
        }
        return false;
      };

      const addSectionTitle = (title, subtitle = '') => {
        checkSpace(12);
        
        pdf.setFillColor(248, 250, 252);
        pdf.rect(margin, yPos, pageWidth - 2 * margin, 10, 'F');
        
        pdf.setFontSize(11);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(30, 64, 175);
        pdf.text(title.toUpperCase(), margin + 3, yPos + 6);
        
        if (subtitle) {
          pdf.setFontSize(8);
          pdf.setFont(undefined, 'normal');
          pdf.setTextColor(100, 116, 139);
          pdf.text(subtitle, pageWidth - margin - 3, yPos + 6, { align: 'right' });
        }
        
        yPos += 12;
      };

      // Simple table row for headers and summary data
      const addTableRow = (columns, isHeader = false, columnWidths = []) => {
        const rowHeight = 7;
        
        if (checkSpace(rowHeight)) {
          if (isHeader) {
            return addTableRow(columns, true, columnWidths);
          }
        }
        
        if (isHeader) {
          pdf.setFillColor(30, 64, 175);
          pdf.rect(margin, yPos, pageWidth - 2 * margin, rowHeight, 'F');
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(8);
          pdf.setFont(undefined, 'bold');
        } else {
          if ((yPos / rowHeight) % 2 === 0) {
            pdf.setFillColor(248, 250, 252);
          } else {
            pdf.setFillColor(255, 255, 255);
          }
          pdf.rect(margin, yPos, pageWidth - 2 * margin, rowHeight, 'F');
          pdf.setTextColor(0, 0, 0);
          pdf.setFontSize(8);
          pdf.setFont(undefined, 'normal');
        }

        let currentX = margin;
        
        columns.forEach((text, index) => {
          const colWidth = columnWidths[index];
          const padding = 2;
          const textX = currentX + padding;
          const maxWidth = colWidth - (padding * 2);
          
          const textStr = String(text || '');
          
          pdf.text(textStr, textX, yPos + 5, { 
            maxWidth: maxWidth,
            align: 'left'
          });
          
          currentX += colWidth;
        });

        yPos += rowHeight;
        return rowHeight;
      };

      // NEW: Multi-line table row function for events with proper text wrapping
      const addMultiLineTableRow = (columns, isHeader = false, columnWidths = []) => {
        const minRowHeight = 7;
        const lineHeight = 4;
        const padding = 2;
        
        // Calculate wrapped text for each column
        const wrappedColumns = columns.map((text, index) => {
          const colWidth = columnWidths[index];
          const maxWidth = colWidth - (padding * 2);
          return wrapText(pdf, String(text || ''), maxWidth, 7);
        });
        
        // Find the maximum number of lines needed
        const maxLines = Math.max(...wrappedColumns.map(lines => lines.length));
        const rowHeight = Math.max(minRowHeight, maxLines * lineHeight + 2);
        
        // Check if we need a new page
        if (checkSpace(rowHeight)) {
          if (isHeader) {
            return addMultiLineTableRow(columns, true, columnWidths);
          }
        }
        
        // Set background and text colors
        if (isHeader) {
          pdf.setFillColor(30, 64, 175);
          pdf.rect(margin, yPos, pageWidth - 2 * margin, rowHeight, 'F');
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(8);
          pdf.setFont(undefined, 'bold');
        } else {
          if ((yPos / rowHeight) % 2 === 0) {
            pdf.setFillColor(248, 250, 252);
          } else {
            pdf.setFillColor(255, 255, 255);
          }
          pdf.rect(margin, yPos, pageWidth - 2 * margin, rowHeight, 'F');
          pdf.setTextColor(0, 0, 0);
          pdf.setFontSize(7);
          pdf.setFont(undefined, 'normal');
        }

        // Draw text for each column with wrapping
        let currentX = margin;
        
        wrappedColumns.forEach((lines, index) => {
          const colWidth = columnWidths[index];
          const textX = currentX + padding;
          
          lines.forEach((line, lineIndex) => {
            const textY = yPos + 4 + (lineIndex * lineHeight);
            pdf.text(line, textX, textY);
          });
          
          currentX += colWidth;
        });

        yPos += rowHeight;
        return rowHeight;
      };

      const pdfMetrics = calculateDashboardMetrics();

      addHeader(true);

      // CLIENT INFORMATION
      addSectionTitle('CLIENT INFORMATION', 'Report Details');
      
      const infoBoxHeight = 25;
      checkSpace(infoBoxHeight);
      
      pdf.setDrawColor(226, 232, 240);
      pdf.setFillColor(255, 255, 255);
      pdf.rect(margin, yPos, pageWidth - 2 * margin, infoBoxHeight, 'S');
      
      const col1 = margin + 5;
      const col2 = pageWidth / 2;
      
      pdf.setFontSize(9);
      pdf.setFont(undefined, 'bold');
      pdf.setTextColor(30, 64, 175);
      pdf.text('CLIENT:', col1, yPos + 7);
      pdf.text('REPORT PERIOD:', col1, yPos + 13);
      pdf.text('SHIFT TYPE:', col1, yPos + 19);
      
      pdf.setFont(undefined, 'normal');
      pdf.setTextColor(0, 0, 0);
      pdf.text(client || 'Not specified', col1 + 15, yPos + 7);
      pdf.text(`${startDate} ${startTime || '00:00'} to ${endDate} ${endTime || '23:59'}`, col1 + 30, yPos + 13);
      pdf.text(getShiftLabel(shiftType), col1 + 20, yPos + 19);
      
      pdf.setFont(undefined, 'bold');
      pdf.setTextColor(30, 64, 175);
      pdf.text('GENERATED:', col2, yPos + 7);
      pdf.text('TOTAL POSTS:', col2, yPos + 13);
      pdf.text('PERFORMANCE:', col2, yPos + 19);
      
      pdf.setFont(undefined, 'normal');
      pdf.setTextColor(0, 0, 0);
      pdf.text(new Date().toLocaleDateString(), col2 + 20, yPos + 7);
      pdf.text(String(report.summary?.length || 0), col2 + 25, yPos + 13);
      pdf.text(`${pdfMetrics?.overallRate || 0}%`, col2 + 25, yPos + 19);
      
      yPos += infoBoxHeight + 5;

      // INCIDENT REPORT
      addSectionTitle('INCIDENT OVERVIEW', 'Security Events');
      
      if (pdfMetrics && pdfMetrics.totalIncidents > 0 && report.incident && report.incident.length > 0) {
        pdf.setFillColor(254, 252, 232);
        pdf.setDrawColor(245, 158, 11);
        pdf.rect(margin, yPos, pageWidth - 2 * margin, 15, 'FD');
        
        pdf.setFontSize(10);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(180, 83, 9);
        
        const incidentText = report.incident[0].IncidentReport;
        const wrappedIncident = wrapText(pdf, incidentText, pageWidth - 2 * margin - 4, 10);
        wrappedIncident.forEach((line, lineIndex) => {
          pdf.text(line, margin + 3, yPos + 6 + (lineIndex * 4));
        });
        
        yPos += 12 + (wrappedIncident.length * 4);
      } else {
        pdf.setFillColor(240, 253, 244);
        pdf.setDrawColor(34, 197, 94);
        pdf.rect(margin, yPos, pageWidth - 2 * margin, 10, 'FD');
        
        pdf.setFontSize(9);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(22, 163, 74);
        pdf.text('✓ NO SECURITY INCIDENTS REPORTED DURING THIS PERIOD', margin + 3, yPos + 6);
        
        yPos += 12;
      }

      // KEY PERFORMANCE METRICS
      if (pdfMetrics) {
        addSectionTitle('KEY PERFORMANCE METRICS', 'Overview');
        
        checkSpace(25);
        
        const metrics = [
          { label: 'TOTAL INCIDENTS', value: pdfMetrics.totalIncidents, color: '#dc2626' },
          { label: 'COMPLETED CHECKS', value: pdfMetrics.totalCompleted, color: '#16a34a' },
          { label: 'MISSED PATROLS', value: pdfMetrics.totalMissedPatrols, color: '#ea580c' },
          { label: 'PERFORMANCE RATE', value: `${pdfMetrics.overallRate}%`, color: '#2563eb' }
        ];
        
        const boxWidth = (pageWidth - 2 * margin - 15) / 4;
        const boxHeight = 20;
        
        metrics.forEach((metric, index) => {
          const xPos = margin + (index * (boxWidth + 5));
          
          pdf.setFillColor(255, 255, 255);
          pdf.setDrawColor(229, 231, 235);
          pdf.rect(xPos, yPos, boxWidth, boxHeight, 'FD');
          
          pdf.setFillColor(metric.color);
          pdf.rect(xPos, yPos, boxWidth, 3, 'F');
          
          pdf.setFontSize(12);
          pdf.setFont(undefined, 'bold');
          pdf.setTextColor(metric.color);
          pdf.text(metric.value.toString(), xPos + (boxWidth / 2), yPos + 10, { align: 'center' });
          
          pdf.setFontSize(7);
          pdf.setTextColor(75, 85, 99);
          pdf.text(metric.label, xPos + (boxWidth / 2), yPos + 16, { align: 'center' });
        });
        
        yPos += boxHeight + 8;
      }

      // PERFORMANCE PIE CHART
      if (pdfMetrics) {
        addSectionTitle('PERFORMANCE DISTRIBUTION', 'Visual Analytics');
        
        try {
          const pieChartImage = await createPieChartImage(pdfMetrics);
          const chartWidth = 120;
          const chartHeight = 80;
          const chartX = (pageWidth - chartWidth) / 2;
          
          checkSpace(chartHeight + 10);
          pdf.addImage(pieChartImage, 'PNG', chartX, yPos, chartWidth, chartHeight);
          yPos += chartHeight + 5;
        } catch (chartError) {
          console.warn('Chart generation failed:', chartError);
          checkSpace(20);
          pdf.setFontSize(9);
          pdf.setTextColor(0, 0, 0);
          pdf.text(`Performance Overview: ${pdfMetrics.overallRate}% Completion Rate`, margin, yPos);
          yPos += 5;
          pdf.text(`Completed Checks: ${pdfMetrics.totalCompleted} | Missed Patrols: ${pdfMetrics.totalMissedPatrols}`, margin, yPos);
          yPos += 8;
        }
      }

      // PERFORMANCE SUMMARY TABLE
      if (report.summary && report.summary.length > 0) {
        addSectionTitle('PERFORMANCE SUMMARY BY POST', 'Detailed Analysis');

        const summaryColumnWidths = [90, 30, 30, 30];
        
        addTableRow(['SECURITY POST', 'COMPLETED', 'EXPECTED', 'PERFORMANCE %'], true, summaryColumnWidths);

        pdf.setFont(undefined, 'normal');
        report.summary.forEach((row) => {
          const completed = parseInt(row.ChecksCompleted) || 0;
          const expected = parseInt(row.ExpectedChecks) || 0;
          const performanceRate = parseFloat(row.PerformanceRate) || 0;
          const performanceText = isNaN(performanceRate) ? 'N/A' : `${performanceRate}%`;
          
          addTableRow([
            String(row.SitePosts || 'Unknown'),
            String(completed),
            String(expected),
            performanceText
          ], false, summaryColumnWidths);
        });
        
        yPos += 3;
      }

      // EVENTS LOG WITH MULTI-LINE WRAPPING
      if (report.events && report.events.length > 0) {
        addSectionTitle('SECURITY EVENTS LOG', 'Complete Activity Timeline');

        // Adjusted column widths with more space for Event and Zone
        // Date: 22mm, Time: 18mm, Event: 70mm, Zone: 70mm (Total = 180mm)
        const eventColumnWidths = [22, 18, 70, 70];
        
        addMultiLineTableRow(['DATE', 'TIME', 'EVENT DESCRIPTION', 'ZONE'], true, eventColumnWidths);

        pdf.setFont(undefined, 'normal');
        
        report.events.forEach((event) => {
          const eventDesc = event.formattedEvent || formatEventDescription(event.Event);
          const eventTime = event.Time || 'N/A';
          const eventZone = event.Zone || 'N/A';
          const eventDate = event.Date || 'N/A';
          
          addMultiLineTableRow([
            eventDate,
            eventTime,
            eventDesc,
            eventZone
          ], false, eventColumnWidths);
        });

        yPos += 5;
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139);
        pdf.text(`Total Events: ${report.events.length}`, margin, yPos);
        yPos += 5;
      }

      // EXECUTIVE SUMMARY
      addSectionTitle('EXECUTIVE SUMMARY', 'Key Findings');
      
      checkSpace(25);
      
      const summaryPoints = [
        `Overall performance rate: ${pdfMetrics?.overallRate || 0}%`,
        `Total security checks completed: ${pdfMetrics?.totalCompleted || 0}`,
        `Incidents reported: ${pdfMetrics?.totalIncidents || 0}`,
        `Report covers ${report.summary?.length || 0} security posts`,
        `Time period: ${startDate} to ${endDate}`,
        `Total events logged: ${report.events?.length || 0}`
      ];
      
      pdf.setFontSize(9);
      pdf.setTextColor(0, 0, 0);
      
      summaryPoints.forEach((point, pointIndex) => {
        pdf.text(`• ${point}`, margin + 5, yPos + (pointIndex * 4));
      });
      
      yPos += (summaryPoints.length * 4) + 5;

      addFooter();

      const safeClientName = (client || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
      const safeShiftType = shiftType.replace(/\//g, '_');
      const filename = `Security_Report_${safeClientName}_${safeShiftType}_${startDate}.pdf`;
      
      pdf.save(filename);

    } catch (error) {
      console.error('PDF generation error:', error);
      setPdfError(`Failed to generate PDF: ${error.message}`);
    } finally {
      setPdfLoading(false);
    }
  }, [client, startDate, startTime, endDate, endTime, shiftType, report, getShiftLabel, calculateDashboardMetrics, formatEventDescription]);

  const exportToCSV = useCallback(() => {
    if (!report || !report.summary) return;

    const headers = ["Post", "Checks Completed", "Expected Checks", "Performance Rate"];
    const rows = report.summary.map((row) => [row.SitePosts, row.ChecksCompleted, row.ExpectedChecks, row.PerformanceRate]);

    let csvContent = headers.join(",") + "\n";
    rows.forEach((row) => {
      csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dashboard-report-${client}-${shiftType.replace('/', '_')}-${startDate}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  }, [report, client, shiftType, startDate]);

  const metrics = report ? calculateDashboardMetrics() : null;
  const hasData = report && (report.summary?.length > 0 || report.events?.length > 0);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    if (!startDate) setStartDate(oneWeekAgo);
    if (!endDate) setEndDate(today);
  }, [startDate, endDate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl shadow-2xl p-8 mb-8 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold mb-2 flex items-center gap-3">
                <Activity className="w-10 h-10" />
                Security Performance Dashboard
              </h1>
              <p className="text-blue-100 text-lg">Real-time security operations analytics</p>
            </div>
            <div className="hidden md:flex items-center gap-4">
              <button
                onClick={fetchClients}
                className="flex items-center gap-2 bg-blue-500 hover:bg-blue-400 px-4 py-2 rounded-lg transition-all"
                title="Refresh clients"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <div className="bg-blue-500 bg-opacity-50 rounded-lg px-6 py-3">
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Client */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Building2 className="inline w-4 h-4 mr-1" />
                Client ({clients.length})
              </label>
              <select
                value={client}
                onChange={(event) => setClient(event.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={loading || clients.length === 0}
              >
                <option value="">{clients.length === 0 ? "Loading..." : "Select Client"}</option>
                {clients.map((clientItem) => (
                  <option key={clientItem.id} value={clientItem.name}>
                    {clientItem.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Start Date/Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="inline w-4 h-4 mr-1" />
                Start Date & Time
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="w-2/3 border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  className="w-1/3 border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Time</option>
                  {timeOptions.map((time) => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* End Date/Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="inline w-4 h-4 mr-1" />
                End Date & Time
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="w-2/3 border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  className="w-1/3 border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Time</option>
                  {timeOptions.map((time) => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Shift Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Clock className="inline w-4 h-4 mr-1" />
                Shift Type
              </label>
              <select
                value={shiftType}
                onChange={(event) => setShiftType(event.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                disabled={loading || (client && availableShifts.length === 0)}
              >
                {!client ? (
                  <option value="">Select client first</option>
                ) : availableShifts.length === 0 ? (
                  <option value="">Loading...</option>
                ) : (
                  availableShifts.map((shift) => (
                    <option key={shift.value} value={shift.value}>
                      {shift.label} {shift.default && "★"}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Generate Button */}
            <div className="flex items-end">
              <button
                onClick={handleFetchReport}
                disabled={loading || !client}
                className="w-full bg-blue-600 text-white rounded-lg p-2.5 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-all shadow-lg hover:shadow-xl"
              >
                {loading ? "Loading..." : "Generate Report"}
              </button>
            </div>
          </div>

          {/* Schedule Info */}
          {clientScheduleInfo && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Patrol Schedule Configuration
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div>
                  <span className="text-blue-600">Shift:</span>
                  <p className="font-medium flex items-center gap-1">
                    {getShiftIcon(clientScheduleInfo.shiftType)}
                    {clientScheduleInfo.shiftType || "Day/Night"}
                  </p>
                </div>
                <div>
                  <span className="text-blue-600">Patrols/Day:</span>
                  <p className="font-medium">{clientScheduleInfo.patrolsPerDay || '11'}</p>
                </div>
                <div>
                  <span className="text-blue-600">Type:</span>
                  <p className="font-medium capitalize">{clientScheduleInfo.scheduleType || 'Daily'}</p>
                </div>
                <div>
                  <span className="text-blue-600">Active Days:</span>
                  <p className="font-medium text-xs">{clientScheduleInfo.patrolDays || 'Mon-Sun'}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Errors */}
        {errorMessage && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6 flex items-start gap-3 shadow-lg">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">Error</h3>
              <p className="text-red-700">{errorMessage}</p>
            </div>
          </div>
        )}

        {pdfError && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6 flex items-start gap-3 shadow-lg">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">PDF Error</h3>
              <p className="text-red-700">{pdfError}</p>
            </div>
          </div>
        )}

        {/* Dashboard Content */}
        {hasData && metrics && (
          <>
            {/* Report Header */}
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Dashboard Analytics</h2>
                <p className="text-sm text-gray-600">
                  {client} • {startDate} {startTime ? ` ${startTime}` : ""} to {endDate} {endTime ? ` ${endTime}` : ""}
                  <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs font-medium">
                    {getShiftLabel(shiftType)}
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={exportToPDF}
                  disabled={pdfLoading}
                  className="flex items-center gap-2 bg-red-600 text-white rounded-lg px-4 py-2 hover:bg-red-700 transition-all shadow-lg hover:shadow-xl disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  <FileText className="w-4 h-4" />
                  {pdfLoading ? "Generating..." : "Export PDF"}
                </button>
                <button
                  onClick={exportToCSV}
                  className="flex items-center gap-2 bg-purple-600 text-white rounded-lg px-4 py-2 hover:bg-purple-700 transition-all shadow-lg hover:shadow-xl"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
              </div>
            </div>

            {/* Incident Report */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-8 border border-gray-200">
              <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                Incident Report
              </h3>
              {metrics.totalIncidents > 0 && report.incident && report.incident.length > 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <p className="text-lg font-semibold text-amber-800">
                    {report.incident[0].IncidentReport}
                  </p>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-lg font-semibold text-green-800 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    No incidents reported during this period
                  </p>
                </div>
              )}
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase">Total Incidents</h3>
                  <AlertTriangle className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.totalIncidents}</p>
                <p className="text-sm opacity-80">Reported incidents</p>
              </div>

              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase">Checks Completed</h3>
                  <CheckCircle className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.totalCompleted}</p>
                <p className="text-sm opacity-80">Total patrol checks</p>
              </div>

              <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl shadow-lg p-6 text-white">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase">Missed Patrols</h3>
                  <XCircle className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.totalMissedPatrols}</p>
                <p className="text-sm opacity-80">Incomplete checks</p>
              </div>

              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase">Performance</h3>
                  <TrendingUp className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.overallRate}%</p>
                <p className="text-sm opacity-80">Completion rate</p>
              </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 gap-6 mb-8">
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
            </div>

            {/* Performance Distribution Chart */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-8 border border-gray-200">
              <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-600" />
                Performance Distribution
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

            {/* Performance Summary Table */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-8 border border-gray-200">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Detailed Performance Summary</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-blue-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Post</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Completed</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Expected</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Performance</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {report.summary.map((row, rowIndex) => {
                      const completed = parseInt(row.ChecksCompleted) || 0;
                      const expected = parseInt(row.ExpectedChecks) || 0;
                      const rate = parseFloat(row.PerformanceRate);
                      return (
                        <tr key={rowIndex} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-semibold text-gray-900">{row.SitePosts}</td>
                          <td className="px-4 py-3 text-gray-700">{completed}</td>
                          <td className="px-4 py-3 text-gray-700">{expected}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-3 py-1 rounded-full text-sm font-bold ${
                                rate >= 90 ? "bg-green-100 text-green-800" : rate >= 70 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"
                              }`}
                            >
                              {row.PerformanceRate}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Events Log */}
            {report.events?.length > 0 && (
              <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-600" />
                  Complete Events Log
                </h3>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-blue-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Time</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase w-1/3">Event</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase w-1/3">Zone</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {report.events.map((event, eventIndex) => (
                        <tr key={eventIndex} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap text-gray-900 font-medium">{event.Date}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">{event.Time || 'N/A'}</td>
                          <td className="px-4 py-3 text-gray-700">
                            {event.formattedEvent || formatEventDescription(event.Event)}
                          </td>
                          <td className="px-4 py-3 text-gray-700">{event.Zone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* Empty State */}
        {!loading && !hasData && !errorMessage && (
          <div className="bg-white rounded-2xl shadow-xl p-12 text-center border border-gray-200">
            <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">No Data Available</h3>
            <p className="text-gray-600 mb-4">Select a client and date range to generate your dashboard</p>
            <div className="text-sm text-gray-500 space-y-1">
              <p>✓ Choose a client from the dropdown</p>
              <p>✓ Set start and end dates</p>
              <p>✓ Select shift type</p>
              <p>✓ Click "Generate Report"</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}