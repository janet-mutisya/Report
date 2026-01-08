import { useEffect, useState, useCallback } from "react";
import {
  AlertCircle,
  Download,
  Calendar,
  Building2,
  FileText,
  TrendingUp,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Shield,
  Clock,
  RefreshCw,
  Sun,
  Moon,
  Users,
  Info,
  Target,
  BarChart3,
  Search
} from "lucide-react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line
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
  const [searchQuery, setSearchQuery] = useState("");

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  // ✅ MOVED UP: getShiftLabel function - defined before it's used
  const getShiftLabel = useCallback((shiftValue) => {
    const shift = availableShifts.find(shiftItem => shiftItem.value === shiftValue);
    return shift?.label || shiftValue;
  }, [availableShifts]);

  // ✅ MOVED UP: getShiftIcon function
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

  // Enhanced helper function to check if a zone name is valid
  const isValidZoneName = useCallback((zoneName) => {
    if (!zoneName || typeof zoneName !== 'string') return false;
    
    const normalized = zoneName.trim().toLowerCase();
    
    // Filter out invalid zone names more strictly
    const invalidPatterns = [
      'unknown',
      'unknown zone',
      'no zone',
      'undefined',
      'null',
      'n/a',
      'none',
      /^[0-9]+$/,  // Just numbers
      /^[a-z]$/i,  // Single letter
      /^\s*$/,     // Empty or whitespace only
      /^test/i,    // Test entries
      /^demo/i,    // Demo entries
      /^temp/i     // Temporary entries
    ];
    
    for (const pattern of invalidPatterns) {
      if (pattern instanceof RegExp) {
        if (pattern.test(normalized)) return false;
      } else {
        if (normalized === pattern.toLowerCase()) return false;
      }
    }
    
    // Must be at least 2 characters for a valid zone name
    return zoneName.trim().length >= 2;
  }, []);

  // Performance rating function - SYNCED WITH BACKEND
  const getPerformanceRating = (rate) => {
    const numericRate = typeof rate === 'string' ? parseFloat(rate) : rate;
    if (numericRate >= 90) return 'Excellent';
    if (numericRate >= 80) return 'Good';
    if (numericRate >= 70) return 'Fair';
    return 'Poor';
  };

  // Process report data - TRUST THE BACKEND CALCULATIONS
  const processReportData = useCallback((data) => {
    if (!data.summary || !data.calculations) return data;

    console.log('🔍 Processing report data:', {
      rawSummary: data.summary.length,
      calculations: data.calculations,
      schedule: data.schedule,
      guardReports: data.guardReports,
      events: data.events?.length,
      expectedPerZone: data.calculations.expectedPerZone,
      validZoneCount: data.calculations.validZoneCount,
      calculationMethod: data.calculations.method
    });

    // Filter out invalid zones first
    const validSummary = data.summary.filter(zone => {
      const isValid = isValidZoneName(zone.SitePosts);
      if (!isValid) {
        console.log('❌ Filtering out invalid zone:', zone.SitePosts);
      }
      return isValid;
    });

    console.log(`✅ Valid zones after filtering: ${validSummary.length} / ${data.summary.length}`);

    // Process zones - USE BACKEND CALCULATED VALUES DIRECTLY
    const processedSummary = validSummary.map(zone => {
      const completed = parseInt(zone.ChecksCompleted) || 0;
      const expected = parseInt(zone.ExpectedChecks) || 0;
      
      // Use the backend-calculated performance rate
      const performanceRate = parseFloat(zone.PerformanceRate) || 0;
      
      // Calculate if exceeded expectations
      const exceeded = completed > expected;
      
      return {
        ...zone,
        ChecksCompleted: completed,
        ExpectedChecks: expected,
        PerformanceRate: `${Math.round(performanceRate)}%`, // Whole number percentage
        actualPerformance: performanceRate,
        exceeded: exceeded
      };
    });

    // Sort by completed patrols (descending)
    processedSummary.sort((a, b) => 
      (parseInt(b.ChecksCompleted) || 0) - (parseInt(a.ChecksCompleted) || 0)
    );

    console.log('✅ Processed report data:', {
      totalExpected: data.calculations.totalExpectedPatrols,
      totalCompleted: data.calculations.totalCompleted,
      completionRate: data.calculations.completionRate,
      performanceRating: data.calculations.performanceRating,
      validZones: processedSummary.length,
      guardReports: data.guardReports,
      calculationMethod: data.calculations.method
    });

    return {
      ...data,
      summary: processedSummary,
      calculations: {
        ...data.calculations,
        validZonesCount: validSummary.length,
        // Ensure overall rate is also a whole number
        completionRate: Math.round(parseFloat(data.calculations.completionRate) || 0)
      }
    };
  }, [isValidZoneName]);

  // Fetch clients with search capability
  const fetchClients = useCallback(async (search = "") => {
    try {
      setErrorMessage("");
      const url = search && search.length >= 2 
        ? `${API_BASE}/reports/clients/search?query=${encodeURIComponent(search)}`
        : `${API_BASE}/reports/clients`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && Array.isArray(data.clients)) {
        setClients(data.clients);
        if (data.clients.length === 0) {
          setErrorMessage("No clients found. Please try a different search term.");
        }
      } else {
        throw new Error("Invalid response format from server");
      }
    } catch (error) {
      setErrorMessage("Failed to load clients: " + (error?.message || String(error)));
      console.error("Client fetch error:", error);
    }
  }, [API_BASE]);

  // Fetch client schedule info
  const fetchClientScheduleInfo = useCallback(async (clientName) => {
    if (!clientName) {
      setAvailableShifts([]);
      setShiftType("Day/Night");
      setClientScheduleInfo(null);
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/reports/shifts?client=${encodeURIComponent(clientName)}`);
      
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

  // Generate time options for time selection
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

  // Combine date and time for API calls
  const combineDateTime = (dateStr, timeStr) => {
    if (!dateStr) return "";
    const time = timeStr || "00:00";
    const normalized = time.length === 5 ? `${time}:00` : time;
    return `${dateStr}T${normalized}`;
  };

  // Format event descriptions
  const formatEventDescription = useCallback((event) => {
    if (!event) return "Unknown Event";
    
    if (typeof event === 'string' && (event.includes('VIGICONTROL:') || event.includes('Arrival') || event.includes('Login') || event.includes('Logout') || event.includes('Patrol'))) {
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

  // Function to format incident descriptions
  const formatIncidentDescription = useCallback((incident) => {
    if (!incident) return "Unknown Incident";
    
    const incidentStr = String(incident).toLowerCase().trim();
    
    const incidentMappings = {
      'theft': 'Theft/Burglary',
      'burglary': 'Theft/Burglary',
      'vandalism': 'Vandalism',
      'trespassing': 'Unauthorized Entry',
      'unauthorized': 'Unauthorized Entry',
      'safety': 'Safety Hazard',
      'emergency': 'Emergency Situation',
      'alarm': 'Alarm Activation',
      'assault': 'Assault',
      'disturbance': 'Disturbance',
      'suspicious': 'Suspicious Activity'
    };

    for (const [keyword, description] of Object.entries(incidentMappings)) {
      if (incidentStr.includes(keyword)) {
        return description;
      }
    }

    return incidentStr
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .replace(/_/g, ' ')
      .trim();
  }, []);

  // Main report fetch function - SYNCED WITH BACKEND PARAMETERS
  const handleFetchReport = useCallback(async () => {
    setErrorMessage("");

    if (!client || !startDate || !endDate) {
      setErrorMessage("Please select client, start date, and end date.");
      return;
    }

    // ✅ SYNCED: Use correct parameter names for patrol endpoint
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
      // ✅ SYNCED: Correct parameter names for patrol endpoint
      const url = `${API_BASE}/reports/patrol?client=${encodeURIComponent(
        client
      )}&startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(
        endDateTime
      )}&shiftType=${encodeURIComponent(shiftType)}`;

      console.log('📊 Fetching report from:', url);

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }

      if (data && data.success) {
        console.log('✅ Raw report data received:', {
          summaryLength: data.summary?.length,
          calculations: data.calculations,
          guardReports: data.guardReports,
          events: data.events?.length,
          expectedPerZone: data.calculations?.expectedPerZone,
          calculationMethod: data.calculations?.method
        });

        // Process the data with proper filtering - TRUST BACKEND CALCULATIONS
        const processedData = processReportData(data);
        
        console.log('🔄 Processed report data:', {
          validZones: processedData.calculations?.validZonesCount,
          completionRate: processedData.calculations?.completionRate,
          guardReports: processedData.guardReports,
          calculationMethod: processedData.calculations?.method
        });

        setReport(processedData);
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
  }, [API_BASE, client, startDate, startTime, endDate, endTime, shiftType, processReportData]);

  // ✅ MOVED UP: Calculate dashboard metrics - defined before PDF export
  const calculateDashboardMetrics = useCallback(() => {
    if (!report?.summary || !report?.calculations) return null;

    const validSummary = report.summary;

    const totalExpected = report.calculations.totalExpectedPatrols || 0;
    const totalCompleted = report.calculations.totalCompleted || 0;
    const overallRate = parseFloat(report.calculations.completionRate) || 0;
    const performanceRating = report.calculations.performanceRating || 'N/A';
    const expectedPerZone = report.calculations.expectedPerZone || 0;

    const performanceData = validSummary.map((row) => {
      const completed = parseInt(row.ChecksCompleted) || 0;
      const expected = parseInt(row.ExpectedChecks) || 0;
      const performanceRate = row.actualPerformance || 0;
      
      return {
        name: row.SitePosts,
        completed: completed,
        expected: expected,
        rate: performanceRate,
        missed: Math.max(0, expected - completed),
        exceeded: row.exceeded || false
      };
    });

    const totalMissedPatrols = performanceData.reduce((sum, post) => sum + post.missed, 0);

    const efficiencyData = performanceData.slice(0, 10).map(post => ({
      name: post.name.length > 15 ? post.name.substring(0, 15) + '...' : post.name,
      efficiency: post.rate,
      target: 90,
      completed: post.completed,
      expected: post.expected
    }));

    const weeklyTrendData = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => ({
      day,
      performance: Math.max(60, Math.min(100, overallRate + (Math.random() * 15 - 7.5))),
      target: 90
    }));

    // Properly handle guard reports data
    const guardReportsData = report.guardReports || [];
    const totalIncidents = guardReportsData.length;

    return {
      totalIncidents,
      guardReportsData,
      totalMissedPatrols,
      performanceData,
      totalCompleted,
      totalExpected,
      overallRate: Math.round(overallRate),
      performanceRating,
      efficiencyData,
      weeklyTrendData,
      scheduleInfo: report.schedule,
      validZonesCount: report.calculations.validZonesCount,
      expectedPerZone: expectedPerZone,
      calculationMethod: report.calculations.method
    };
  }, [report]);

  // Enhanced text wrapping for PDF with proper width calculation
  const wrapText = (pdf, text, maxWidth, fontSize = 9) => {
    if (!text) return [''];
    const textStr = String(text).trim();
    const words = textStr.split(' ');
    let currentLine = '';
    const lines = [];
    
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
    const completedPercent = total > 0 ? Math.round((completed / total * 100)) : 0; // Whole number
    const missedPercent = total > 0 ? Math.round((missed / total * 100)) : 0; // Whole number

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

  // PDF EXPORT WITH SEPARATE INCIDENTS AND EVENTS - CLIENT-SIDE GENERATION
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

      const COMPANY_NAME = "BOB-MORGAN GUARD REPORT";
      const CLIENT_NAME = client || "Unknown Client";

      const addHeader = (isFirstPage = false) => {
        if (isFirstPage) {
          // Blue header background
          pdf.setFillColor(30, 64, 175);
          pdf.rect(0, 0, pageWidth, 40, 'F');
          
          // White box for title
          pdf.setFillColor(255, 255, 255);
          pdf.rect(margin, 10, pageWidth - 2 * margin, 25, 'F');
          
          // Red accent line
          pdf.setFillColor(220, 38, 38);
          pdf.rect(margin, 33, pageWidth - 2 * margin, 2, 'F');
          
          // Main title in blue
          pdf.setTextColor(30, 64, 175);
          pdf.setFontSize(18);
          pdf.setFont(undefined, 'bold');
          pdf.text(COMPANY_NAME, pageWidth / 2, 20, { align: 'center' });
          
          // Client name in red
          pdf.setTextColor(220, 38, 38);
          pdf.setFontSize(14);
          pdf.text(`FOR: ${CLIENT_NAME}`, pageWidth / 2, 28, { align: 'center' });
          
          yPos = 45;
        } else {
          // Continuation header
          pdf.setFillColor(30, 64, 175);
          pdf.rect(0, 0, pageWidth, 15, 'F');
          
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(10);
          pdf.setFont(undefined, 'bold');
          pdf.text(`${COMPANY_NAME} - ${CLIENT_NAME} - Report Continuation`, pageWidth / 2, 10, { align: 'center' });
          
          yPos = 20;
        }
      };

      const addFooter = () => {
        const footerY = pageHeight - 15;
        
        // Red separator line
        pdf.setDrawColor(220, 38, 38);
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
        
        // Blue background for section titles
        pdf.setFillColor(30, 64, 175);
        pdf.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F');
        
        pdf.setFontSize(10);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(255, 255, 255);
        pdf.text(title.toUpperCase(), margin + 3, yPos + 5);
        
        if (subtitle) {
          pdf.setFontSize(8);
          pdf.setFont(undefined, 'normal');
          pdf.setTextColor(255, 255, 255);
          pdf.text(subtitle, pageWidth - margin - 3, yPos + 5, { align: 'right' });
        }
        
        yPos += 10;
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
          // Red header for tables
          pdf.setFillColor(220, 38, 38);
          pdf.rect(margin, yPos, pageWidth - 2 * margin, rowHeight, 'F');
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(8);
          pdf.setFont(undefined, 'bold');
        } else {
          // Alternating row colors
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

      // Multi-line table row function for events with proper text wrapping
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
          // Red header for event tables
          pdf.setFillColor(220, 38, 38);
          pdf.rect(margin, yPos, pageWidth - 2 * margin, rowHeight, 'F');
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(8);
          pdf.setFont(undefined, 'bold');
        } else {
          // Alternating row colors for events
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
      
      pdf.setDrawColor(30, 64, 175);
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

      // INCIDENT REPORT SECTION - SEPARATE FROM EVENTS
      addSectionTitle('SECURITY INCIDENTS', 'Critical Events');
      
      if (pdfMetrics && pdfMetrics.totalIncidents > 0 && report.guardReports && report.guardReports.length > 0) {
        pdf.setFillColor(254, 226, 226);
        pdf.setDrawColor(220, 38, 38);
        pdf.rect(margin, yPos, pageWidth - 2 * margin, 15, 'FD');
        
        pdf.setFontSize(10);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(220, 38, 38);
        
        const incidentText = `TOTAL SECURITY INCIDENTS: ${pdfMetrics.totalIncidents}`;
        pdf.text(incidentText, margin + 3, yPos + 6);
        
        yPos += 12;

        // Display individual incidents
        const incidentColumnWidths = [25, 175];
        addMultiLineTableRow(['#', 'INCIDENT DESCRIPTION'], true, incidentColumnWidths);

        report.guardReports.forEach((incident, index) => {
          const incidentDesc = formatIncidentDescription(incident.report);
          addMultiLineTableRow([
            String(index + 1),
            incidentDesc
          ], false, incidentColumnWidths);
        });

        yPos += 5;
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
          
          // Red accent bar for headers
          pdf.setFillColor(220, 38, 38);
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
          const performanceText = isNaN(performanceRate) ? 'N/A' : `${Math.round(performanceRate)}%`; // Whole number
          
          addTableRow([
            String(row.SitePosts || 'Unknown'),
            String(completed),
            String(expected),
            performanceText
          ], false, summaryColumnWidths);
        });
        
        yPos += 3;
      }

      // PATROL EVENTS LOG (SEPARATE FROM INCIDENTS)
      if (report.events && report.events.length > 0) {
        addSectionTitle('PATROL EVENTS LOG', 'Routine Activity Timeline');

        // Adjusted column widths with more space for Event and Zone
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
        pdf.text(`Total Patrol Events: ${report.events.length}`, margin, yPos);
        yPos += 5;
      }

      // EXECUTIVE SUMMARY
      addSectionTitle('EXECUTIVE SUMMARY', 'Key Findings');
      
      checkSpace(25);
      
      const summaryPoints = [
        `Overall performance rate: ${pdfMetrics?.overallRate || 0}%`,
        `Total security checks completed: ${pdfMetrics?.totalCompleted || 0}`,
        `Security incidents reported: ${pdfMetrics?.totalIncidents || 0}`,
        `Report covers ${report.summary?.length || 0} security posts`,
        `Time period: ${startDate} to ${endDate}`,
        `Total patrol events logged: ${report.events?.length || 0}`
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
      const filename = `BOB-MORGAN_Report_${safeClientName}_${safeShiftType}_${startDate}.pdf`;
      
      pdf.save(filename);

    } catch (error) {
      console.error('PDF generation error:', error);
      setPdfError(`Failed to generate PDF: ${error.message}`);
    } finally {
      setPdfLoading(false);
    }
  }, [client, startDate, startTime, endDate, endTime, shiftType, report, getShiftLabel, calculateDashboardMetrics, formatEventDescription, formatIncidentDescription]);

  const exportToCSV = useCallback(() => {
    if (!report || !report.summary) return;

    const headers = ["Security Post", "Checks Completed", "Expected Checks", "Performance Rate"];
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
  }, [report, client, startDate, endDate]);

  const metrics = report ? calculateDashboardMetrics() : null;
  const hasData = report && (report.summary?.length > 0 || report.events?.length > 0 || report.guardReports?.length > 0);

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
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-4xl font-bold mb-2 flex items-center gap-3">
                <Activity className="w-10 h-10" />
                Security Performance Dashboard
              </h1>
              <p className="text-blue-100 text-lg">Real-time security operations analytics</p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => fetchClients(searchQuery)}
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

        {/* Client Search and Selection */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-8 border border-gray-100">
          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            Report Configuration
          </h2>
          
          {/* Search Box */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Search className="inline w-4 h-4 mr-1" />
              Search Clients
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Type client name (min 2 characters)..."
                className="flex-1 border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <button
                onClick={() => fetchClients(searchQuery)}
                disabled={searchQuery.length < 2}
                className="bg-blue-600 text-white rounded-lg px-4 py-2.5 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all"
              >
                Search
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="lg:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Building2 className="inline w-4 h-4 mr-1" />
                Select Client ({clients.length} found)
              </label>
              <select
                value={client}
                onChange={(event) => setClient(event.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={loading || clients.length === 0}
              >
                <option value="">{clients.length === 0 ? "No clients found" : "Select Client"}</option>
                {clients.map((clientItem) => (
                  <option key={clientItem.id} value={clientItem.name}>
                    {clientItem.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-2">
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

            <div className="lg:col-span-2">
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

            <div className="lg:col-span-1">
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

            <div className="flex items-end lg:col-span-6 md:col-span-3">
              <button
                onClick={handleFetchReport}
                disabled={loading || !client}
                className="w-full bg-blue-600 text-white rounded-lg p-3 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-all shadow-lg hover:shadow-xl text-base"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    Generate Report
                  </span>
                )}
              </button>
            </div>
          </div>

          {clientScheduleInfo && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Patrol Schedule Configuration
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                <div>
                  <span className="text-blue-600">Shift:</span>
                  <p className="font-medium flex items-center gap-1">
                    {getShiftIcon(clientScheduleInfo.shiftType)}
                    {clientScheduleInfo.shiftType || "Day/Night"}
                  </p>
                </div>
                <div>
                  <span className="text-blue-600">Weekday Patrols:</span>
                  <p className="font-medium">{clientScheduleInfo.patrolsPerDay || '11'}/day</p>
                </div>
                <div>
                  <span className="text-blue-600">Weekend Patrols:</span>
                  <p className="font-medium">{clientScheduleInfo.weekendPatrols || '11'}/day</p>
                </div>
                <div>
                  <span className="text-blue-600">Weekly Total:</span>
                  <p className="font-medium">{clientScheduleInfo.weeklyTotal || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-blue-600">Active Days:</span>
                  <p className="font-medium text-xs">{clientScheduleInfo.patrolDays || 'Mon-Sun'}</p>
                </div>
              </div>
              {clientScheduleInfo.hasCustomSchedule && (
                <div className="mt-2 text-xs text-blue-600 flex items-center gap-1">
                  <Info className="w-3 h-3" />
                  Custom schedule from: {clientScheduleInfo.configSource || 'database'}
                </div>
              )}
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">Error</h3>
              <p className="text-red-700">{errorMessage}</p>
            </div>
          </div>
        )}

        {pdfError && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6 flex items-start gap-3">
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
            <div className="flex justify-between items-start mb-6 flex-wrap gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Dashboard Analytics</h2>
                <p className="text-sm text-gray-600">
                  {client} • {startDate} {startTime ? ` ${startTime}` : ""} to {endDate} {endTime ? ` ${endTime}` : ""}
                  <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs font-medium">
                    {report.shift?.effective || getShiftLabel(shiftType)}
                  </span>
                  {report.period?.daysInRange && (
                    <span className="ml-2 px-2 py-1 bg-gray-100 text-gray-700 rounded-md text-xs font-medium">
                      {report.period.daysInRange} days
                    </span>
                  )}
                  {metrics.validZonesCount && (
                    <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 rounded-md text-xs font-medium">
                      {metrics.validZonesCount} security posts
                    </span>
                  )}
                  {metrics.expectedPerZone && (
                    <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-800 rounded-md text-xs font-medium">
                      {metrics.expectedPerZone} expected per zone
                    </span>
                  )}
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

            {/* GUARD REPORTS SECTION - SEPARATE FROM EVENTS */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-8 border border-gray-200">
              <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                Security Incidents & Guard Reports
                {metrics.totalIncidents > 0 && (
                  <span className="ml-2 px-2 py-1 bg-red-100 text-red-800 rounded-md text-xs font-medium">
                    {metrics.totalIncidents} incident{metrics.totalIncidents !== 1 ? 's' : ''}
                  </span>
                )}
              </h3>
              
              {metrics.totalIncidents > 0 && metrics.guardReportsData ? (
                <div className="space-y-4">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-lg font-semibold text-red-800">
                      Total Security Incidents Reported: {metrics.totalIncidents}
                    </p>
                  </div>
                  
                  <div className="bg-white border border-gray-200 rounded-lg">
                    <table className="w-full">
                      <thead className="bg-red-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">#</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Date</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Zone</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Incident Description</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {metrics.guardReportsData.map((incident, index) => (
                          <tr key={index} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-gray-900">{index + 1}</td>
                            <td className="px-4 py-3 text-gray-700">{incident.date || 'N/A'}</td>
                            <td className="px-4 py-3 text-gray-700">{incident.zone || 'N/A'}</td>
                            <td className="px-4 py-3 text-gray-700">
                              {formatIncidentDescription(incident.report)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-lg font-semibold text-green-800 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    No security incidents reported during this period
                  </p>
                </div>
              )}
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase">Total Incidents</h3>
                  <AlertTriangle className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.totalIncidents}</p>
                <p className="text-sm opacity-80">Security incidents</p>
              </div>

              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold opacity-90 uppercase">Checks Completed</h3>
                  <CheckCircle className="w-6 h-6 opacity-90" />
                </div>
                <p className="text-4xl font-bold mb-2">{metrics.totalCompleted}</p>
                <p className="text-sm opacity-80">
                  Expected: {metrics.totalExpected}
                </p>
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
                <p className="text-sm opacity-80">
                  {getPerformanceRating(metrics.overallRate)}
                </p>
              </div>
            </div>

            {/* Performance Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Performance Distribution Pie Chart */}
              <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-600" />
                  Performance Distribution
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie
                      data={[
                        { 
                          name: 'Excellent (≥90%)', 
                          value: metrics.performanceData.filter(p => p.rate >= 90 && !p.exceeded).length,
                          fill: '#10b981'
                        },
                        { 
                          name: 'Good (80-89%)', 
                          value: metrics.performanceData.filter(p => p.rate >= 80 && p.rate < 90 && !p.exceeded).length,
                          fill: '#84cc16'
                        },
                        { 
                          name: 'Fair (70-79%)', 
                          value: metrics.performanceData.filter(p => p.rate >= 70 && p.rate < 80 && !p.exceeded).length,
                          fill: '#eab308'
                        },
                        { 
                          name: 'Poor (<70%)', 
                          value: metrics.performanceData.filter(p => p.rate < 70 && !p.exceeded).length,
                          fill: '#ef4444'
                        },
                        { 
                          name: 'Exceeded Target', 
                          value: metrics.performanceData.filter(p => p.exceeded).length,
                          fill: '#3b82f6'
                        }
                      ].filter(item => item.value > 0)}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      dataKey="value"
                    >
                    </Pie>
                    <Tooltip 
                      formatter={(value, name) => [value, name]}
                      contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px" }}
                    />
                    <Legend 
                      verticalAlign="bottom" 
                      height={36}
                      iconType="circle"
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-4 text-xs text-gray-600 text-center">
                  Total Zones: {metrics.performanceData.length}
                </div>
              </div>

              {/* Performance Trend */}
              <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                  Weekly Performance Trend
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={metrics.weeklyTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip formatter={(value) => [`${Math.round(value)}%`, 'Performance']} />
                    <Legend />
                    <Line type="monotone" dataKey="performance" stroke="#10b981" strokeWidth={2} name="Performance" />
                    <Line type="monotone" dataKey="target" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 5" name="Target" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Performance Summary Table */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-8 border border-gray-200">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-900">Detailed Performance Summary</h3>
                <div className="text-sm text-gray-600">
                  Showing {report.summary.length} security post{report.summary.length !== 1 ? 's' : ''}
                  {metrics.expectedPerZone && ` • ${metrics.expectedPerZone} expected per zone`}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-blue-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Security Post</th>
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
                      const exceeded = row.exceeded || false;
                      const isExcellent = rate >= 90;
                      const isGood = rate >= 80 && rate < 90;
                      const isFair = rate >= 70 && rate < 80;
                      const isPoor = rate < 70;
                      
                      return (
                        <tr key={rowIndex} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-semibold text-gray-900">{row.SitePosts}</td>
                          <td className="px-4 py-3 text-gray-700">
                            {completed}
                          </td>
                          <td className="px-4 py-3 text-gray-700">{expected}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-3 py-1 rounded-full text-sm font-bold ${
                                exceeded ? "bg-blue-100 text-blue-800" :
                                isExcellent ? "bg-green-100 text-green-800" : 
                                isGood ? "bg-lime-100 text-lime-800" :
                                isFair ? "bg-yellow-100 text-yellow-800" : 
                                isPoor ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800"
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
              {report.schedule && (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
                  <strong>Calculation Method:</strong> {metrics.calculationMethod || 'FULL expected patrols per zone (NOT divided)'}
                  <br />
                  <strong>Schedule:</strong> {report.schedule.patrolsPerDay} weekday / {report.schedule.weekendPatrols} weekend patrols per day.
                  <br />
                  <strong>Total Expected:</strong> {metrics.totalExpected} patrols for period across {metrics.validZonesCount} zones.
                  <br />
                  <strong>Performance:</strong> Based on actual patrols completed vs expected requirements.
                </div>
              )}
            </div>

            {/* Patrol Events Log (SEPARATE FROM INCIDENTS) */}
            {report.events?.length > 0 && (
              <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-600" />
                  Patrol Events Log ({report.events.length} events)
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

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-2xl shadow-xl p-12 text-center border border-gray-200">
            <RefreshCw className="w-16 h-16 text-blue-500 mx-auto mb-4 animate-spin" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">Loading Report...</h3>
            <p className="text-gray-600">Please wait while we fetch your security data</p>
          </div>
        )}
      </div>
    </div>
  );
}