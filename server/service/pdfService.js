// server/service/pdfService.js - CLIENT-FRIENDLY VERSION WITH ALL EVENTS
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// Import the report model - ALL DATA COMES FROM HERE
import { fetchPatrolReport } from '../models/reportModel.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

// COLOR SCHEME - Blue, White, Black
const COLORS = {
  primary: '#1e40af',
  primaryDark: '#1e3a8a',
  white: '#ffffff',
  black: '#000000',
  gray: {
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    600: '#4b5563',
    800: '#1f2937'
  }
};

// Logger utility
const logger = {
  info: (...args) => console.log('[PDF]', ...args),
  warn: (...args) => console.warn('[PDF WARN]', ...args),
  error: (...args) => console.error('[PDF ERROR]', ...args),
  debug: (...args) => process.env.NODE_ENV === 'development' && console.log('[PDF DEBUG]', ...args)
};

/**
 * Load logo from file system
 */
function loadLogoFromFile() {
  try {
    const possiblePaths = [
      path.join(process.cwd(), 'assets', 'BM SECURITY LOGO.jpg'),
      path.join(process.cwd(), 'server', 'assets', 'BM SECURITY LOGO.jpg'),
      path.join(__dirname, '..', 'assets', 'BM SECURITY LOGO.jpg'),
      path.join(__dirname, '..', '..', 'assets', 'BM SECURITY LOGO.jpg'),
      path.join(__dirname, '..', '..', '..', 'assets', 'BM SECURITY LOGO.jpg')
    ];

    for (const logoPath of possiblePaths) {
      if (fs.existsSync(logoPath)) {
        logger.info(`✅ Logo found at: ${logoPath}`);
        return {
          buffer: fs.readFileSync(logoPath),
          path: logoPath
        };
      }
    }
    
    logger.warn(`⚠️ Logo not found in any of the expected locations`);
    return null;
  } catch (error) {
    logger.error('Logo load error:', error.message);
    return null;
  }
}

/**
 * Text wrapping utility
 */
function wrapText(doc, text, maxWidth, fontSize = 8) {
  if (!text) return [''];
  
  doc.fontSize(fontSize);
  const words = String(text).split(' ');
  const lines = [];
  let currentLine = '';
  
  for (const word of words) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    if (doc.widthOfString(testLine) <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  
  if (currentLine) lines.push(currentLine);
  return lines.length ? lines : [''];
}

/**
 * Clean post name by removing leading numbers
 */
function cleanPostName(postName) {
  if (!postName) return postName;
  return postName.replace(/^\d+\.\s*/, '').trim();
}

/**
 * Format date for display
 */
function formatDate(dateString) {
  try {
    const date = dayjs(dateString).tz(TZ);
    if (date.isValid()) {
      return date.format('DD/MM/YYYY');
    }
    return dateString;
  } catch (error) {
    return dateString;
  }
}

/**
 * Calculate actual days between dates
 */
function calculateActualDays(startDate, endDate) {
  try {
    const start = dayjs(startDate);
    const end = dayjs(endDate);
    
    if (!start.isValid() || !end.isValid()) {
      return 0;
    }
    
    // Add 1 day because it's inclusive
    const days = end.diff(start, 'day') + 1;
    
    logger.info(`📅 Day calculation: ${start.format('DD/MM/YYYY')} to ${end.format('DD/MM/YYYY')} = ${days} days`);
    return days;
  } catch (error) {
    logger.error('Error calculating days:', error.message);
    return 0;
  }
}

/**
 * Extract and format incident text
 */
function extractIncidentReport(event) {
  try {
    // First check if it's already a processed guard report
    if (event.report) {
      return event.report;
    }
    
    // Extract from raw V03 event data
    const rawText = event.rec_cObservaciones || 
                    event.Observaciones || 
                    event.observaciones || 
                    event.rec_cContenido || 
                    '';
    
    if (!rawText.trim()) {
      return 'No details provided';
    }
    
    let cleanText = rawText.trim();
    
    // Remove [VigiControl] tags and timestamps
    cleanText = cleanText.replace(/\[VigiControl\]/gi, '');
    cleanText = cleanText.replace(/\[\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\]/g, '');
    
    // Remove [Admin] sections
    const adminIndex = cleanText.indexOf('[Admin]');
    if (adminIndex !== -1) {
      cleanText = cleanText.substring(0, adminIndex).trim();
    }
    
    // Clean up multiple spaces and newlines
    cleanText = cleanText.replace(/\s+/g, ' ').trim();
    
    return cleanText || 'Incident reported (no details)';
  } catch (error) {
    logger.warn(`Error extracting incident text: ${error.message}`);
    return 'Error processing incident details';
  }
}

/**
 * Categorize incidents based on content
 */
function categorizeIncident(incidentText) {
  const text = incidentText.toLowerCase();
  
  if (text.includes('theft') || text.includes('steal') || text.includes('robbery')) {
    return 'THEFT';
  } else if (text.includes('vandal') || text.includes('damage') || text.includes('broken')) {
    return 'VANDALISM';
  } else if (text.includes('fire') || text.includes('smoke') || text.includes('flame')) {
    return 'FIRE';
  } else if (text.includes('suspicious') || text.includes('unknown') || text.includes('strange')) {
    return 'SUSPICIOUS ACTIVITY';
  } else if (text.includes('medical') || text.includes('injury') || text.includes('hurt')) {
    return 'MEDICAL EMERGENCY';
  } else if (text.includes('power') || text.includes('electricity') || text.includes('outage')) {
    return 'POWER OUTAGE';
  } else if (text.includes('security') || text.includes('breach') || text.includes('intruder')) {
    return 'SECURITY BREACH';
  } else if (text.includes('equipment') || text.includes('fault') || text.includes('malfunction')) {
    return 'EQUIPMENT ISSUE';
  } else if (text.includes('weather') || text.includes('rain') || text.includes('storm')) {
    return 'WEATHER RELATED';
  } else if (text.includes('animal') || text.includes('dog') || text.includes('wildlife')) {
    return 'ANIMAL INCIDENT';
  }
  
  return 'GENERAL INCIDENT';
}

/**
 * Process guard reports (incident reports)
 */
function processGuardReports(reportData) {
  const incidents = [];
  
  // Method 1: Check guardReports array
  if (Array.isArray(reportData.guardReports) && reportData.guardReports.length > 0) {
    reportData.guardReports.forEach(report => {
      if (report.type === 'INCIDENT_REPORT' || report.__type === 'INCIDENT_REPORT') {
        const incidentText = report.report || 'No details provided';
        const category = categorizeIncident(incidentText);
        
        incidents.push({
          id: report.id || report.rec_iid || `inc-${incidents.length + 1}`,
          date: report.date || 'N/A',
          zone: report.zone || 'Unknown Post',
          report: incidentText,
          category: category,
          priority: category.includes('THEFT') || category.includes('FIRE') || category.includes('MEDICAL') ? 'HIGH' : 'MEDIUM'
        });
      }
    });
  }
  
  // Method 2: Check events array for any incident events (fallback)
  if (incidents.length === 0 && Array.isArray(reportData.events)) {
    reportData.events.forEach(event => {
      const alarmCode = (event.rec_calarma || event.AlarmCode || '').toString().trim().toUpperCase();
      
      if (alarmCode === 'V03') {
        const incidentText = extractIncidentReport(event);
        const category = categorizeIncident(incidentText);
        
        // Parse date
        let incidentDate = 'N/A';
        if (event.rec_tfechahora) {
          const dateObj = dayjs(event.rec_tfechahora);
          if (dateObj.isValid()) {
            incidentDate = dateObj.format('DD/MM/YYYY HH:mm');
          }
        }
        
        // Get zone name
        let zoneName = event.Zone || 'Unknown Post';
        if (!zoneName || zoneName === 'Unknown Post') {
          zoneName = event.rec_czona ? `Post ${event.rec_czona}` : 'Unknown Post';
        }
        
        incidents.push({
          id: event.rec_iid || `inc-${incidents.length + 1}`,
          date: incidentDate,
          zone: zoneName,
          report: incidentText,
          category: category,
          priority: category.includes('THEFT') || category.includes('FIRE') || category.includes('MEDICAL') ? 'HIGH' : 'MEDIUM'
        });
      }
    });
  }
  
  logger.info(`📊 Processed ${incidents.length} incident reports`);
  return incidents;
}

/**
 * Process patrol events for activity log
 */
function processPatrolEvents(reportData) {
  const patrolEvents = [];
  
  if (Array.isArray(reportData.events)) {
    reportData.events.forEach(event => {
      const alarmCode = (event.rec_calarma || event.AlarmCode || '').toString().trim().toUpperCase();
      
      // Only include patrol arrivals in activity log
      if (alarmCode === 'V04') {
        patrolEvents.push({
          Date: event.Date || 'N/A',
          Time: event.Time || 'N/A',
          Event: 'Vigicontrol Arrival',
          Zone: event.Zone || 'Unknown Post'
        });
      }
    });
  }
  
  logger.info(`📊 Processed ${patrolEvents.length} patrol events for activity log`);
  return patrolEvents;
}

/**
 * MAIN: Generate Dashboard PDF
 */
export async function generateDashboardPDF(clientData) {
  const startTime = Date.now();
  
  logger.info('='.repeat(60));
  logger.info('PDF GENERATION STARTED');
  logger.info('='.repeat(60));
  
  try {
    const { clientId, clientName = "Unknown Client", startDate, endDate } = clientData;

    // Validate inputs
    if (!clientId) {
      throw new Error('Client ID is required');
    }
    if (!startDate || !endDate) {
      throw new Error('Start and end dates are required');
    }

    logger.info(`📋 Requesting report for Client ID: ${clientId}`);
    logger.info(`📅 Date Range: ${startDate} to ${endDate}`);

    // Fetch all data from report model
    const reportData = await fetchPatrolReport(clientId, startDate, endDate, true, 'custom');
    
    logger.info('📦 Report data received from fetchPatrolReport');

    // Check if report generation was successful
    if (!reportData.metadata || !reportData.metadata.success) {
      const errorMsg = reportData.metadata?.error?.message || 'Unknown error during report generation';
      logger.error(`❌ Report generation failed: ${errorMsg}`);
      throw new Error(`Report generation failed: ${errorMsg}`);
    }

    // Process data correctly
    const posts = Array.isArray(reportData.posts) ? reportData.posts : [];
    const incidents = processGuardReports(reportData);  // Incident reports only
    const patrolEvents = processPatrolEvents(reportData);  // Patrol logs only
    
    logger.info(`✅ Data processed:`);
    logger.info(`   - Security Posts: ${posts.length}`);
    logger.info(`   - Incidents: ${incidents.length}`);
    logger.info(`   - Patrol Events: ${patrolEvents.length}`);

    // Extract metadata with fallbacks
    const {
      clientName: reportClientName = clientName,
      overallPerformance = 0,
      totalCompleted = 0,
      totalExpectedPatrols = 0,
      dataQuality = {}
    } = reportData.metadata || {};

    const displayClientName = clientName || reportClientName || 'Unknown Client';

    // Calculate actual days for display
    const actualDays = calculateActualDays(startDate, endDate);
    
    logger.info(`📊 Performance Metrics:`);
    logger.info(`   - Overall: ${overallPerformance}%`);
    logger.info(`   - Completed Patrols: ${totalCompleted}`);
    logger.info(`   - Expected Patrols: ${totalExpectedPatrols}`);
    logger.info(`   - Incidents Reported: ${incidents.length}`);
    logger.info(`   - Period: ${actualDays} days`);

    // Warn if no data
    if (posts.length === 0 && patrolEvents.length === 0 && incidents.length === 0) {
      logger.warn('⚠️ WARNING: No data found for this report!');
    }

    // Date formatting
    const startDateFormatted = formatDate(startDate);
    const endDateFormatted = formatDate(endDate);
    const startDay = dayjs(startDate).format('dddd');
    const endDay = dayjs(endDate).format('dddd');

    // Load logo
    const logoData = loadLogoFromFile();

    // Create PDF document
    const doc = new PDFDocument({ 
      margin: 40,
      size: "A4",
      bufferPages: true,
      info: {
        Title: `Security Report - ${displayClientName}`,
        Author: 'BM Security',
        Subject: `Security Performance ${startDateFormatted} to ${endDateFormatted}`,
        Creator: 'BM Security PDF Service'
      }
    });

    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    
    const pdfPromise = new Promise((resolve, reject) => {
      doc.on("end", () => {
        logger.info('✅ PDF buffer completed');
        resolve(Buffer.concat(buffers));
      });
      doc.on("error", (err) => {
        logger.error('❌ PDF error:', err);
        reject(err);
      });
    });

    // PDF Layout constants
    let yPos = 40;
    const pageWidth = 515;
    const pageHeight = 750;

    const checkPageBreak = (neededSpace) => {
      if (yPos + neededSpace > pageHeight) {
        doc.addPage();
        yPos = 40;
        return true;
      }
      return false;
    };

    logger.info('📝 Starting PDF content generation...');

    // ==================== HEADER WITH LOGO ====================
    const logoWidth = 160;
    const logoHeight = 80;
    const logoX = 40;
    const logoY = yPos;

    if (logoData && logoData.buffer) {
      try {
        logger.info('Adding BM Security logo to PDF...');
        doc.image(logoData.buffer, logoX, logoY, {
          width: logoWidth,
          height: logoHeight,
          fit: [logoWidth, logoHeight]
        });
      } catch (error) {
        logger.error('Error adding logo:', error.message);
        doc.font('Helvetica-Bold')
           .fillColor(COLORS.primary)
           .fontSize(16)
           .text('BM SECURITY', logoX, logoY + 10);
      }
    } else {
      doc.font('Helvetica-Bold')
         .fillColor(COLORS.primary)
         .fontSize(16)
         .text('BM SECURITY', logoX, logoY + 10);
    }

    // Header text content - REMOVED PATROL WINDOW STATEMENT
    const headerTextX = logoX + logoWidth + 15;
    const headerTextY = logoY + 15;
    
    doc.font('Helvetica-Bold')
       .fillColor(COLORS.primary)
       .fontSize(20)
       .text('SECURITY PATROL REPORT', headerTextX, headerTextY);
    
    doc.fillColor(COLORS.black)
       .fontSize(14)
       .text(displayClientName.toUpperCase(), headerTextX, headerTextY + 28);
    
    doc.fillColor(COLORS.gray[600])
       .fontSize(10)
       .text(`Period: ${startDateFormatted} to ${endDateFormatted} (${startDay} to ${endDay})`, headerTextX, headerTextY + 50);
    
    yPos += Math.max(logoHeight, 90) + 10;

    // ==================== PERFORMANCE OVERVIEW ====================
    checkPageBreak(130);
    
    doc.fillColor(COLORS.primary)
       .fontSize(16)
       .font('Helvetica-Bold')
       .text('PERFORMANCE OVERVIEW', 40, yPos);
    
    yPos += 30;

    const performanceLevel = overallPerformance >= 90 ? 'EXCELLENT' : 
                           overallPerformance >= 80 ? 'GOOD' : 
                           overallPerformance >= 70 ? 'SATISFACTORY' : 'NEEDS IMPROVEMENT';

    // Calculate high-priority incidents
    const highPriorityIncidents = incidents.filter(i => i.priority === 'HIGH').length;
    const totalIncidents = incidents.length;

    // Metrics with client-friendly language - NO TECHNICAL TERMS
    const metrics = [
      { 
        label: 'Overall Performance', 
        value: `${overallPerformance}%`, 
        subtext: `${totalCompleted}/${totalExpectedPatrols} patrols completed (${performanceLevel})`
      },
      { 
        label: 'Security Posts', 
        value: dataQuality.postsCount || posts.length, 
        subtext: `${dataQuality.excellentZones || 0} excellent, ${dataQuality.underperformingZones || 0} needs attention`
      },
      { 
        label: 'Incident Reports', 
        value: totalIncidents, 
        subtext: totalIncidents === 0 ? 'All clear - no incidents' : 
                 `${highPriorityIncidents} high priority incidents`
      },
      { 
        label: 'Patrol Activities', 
        value: patrolEvents.length, 
        subtext: `${patrolEvents.length} patrol logs recorded`
      }
    ];

    logger.info('📊 Rendering performance metrics...');

    // Metrics grid
    metrics.forEach((metric, index) => {
      const xPos = 40 + (index % 2) * 270;
      const yMetric = yPos + Math.floor(index / 2) * 55;
      
      doc.fillColor(COLORS.primary)
         .fontSize(22)
         .font('Helvetica-Bold')
         .text(String(metric.value), xPos, yMetric);
      
      doc.fillColor(COLORS.black)
         .fontSize(10)
         .font('Helvetica-Bold')
         .text(metric.label, xPos, yMetric + 24);
      
      doc.fillColor(COLORS.gray[600])
         .fontSize(8)
         .font('Helvetica')
         .text(metric.subtext, xPos, yMetric + 38, { width: 250 });
    });

    yPos += 125;

    // ==================== INCIDENT REPORTS SECTION ====================
    logger.info(`📋 Rendering incident reports section (${totalIncidents} incidents)...`);
    
    checkPageBreak(120);
    
    doc.fillColor(COLORS.primary)
       .fontSize(16)
       .font('Helvetica-Bold')
       .text('INCIDENT REPORTS', 40, yPos);
    
    yPos += 30;

    if (totalIncidents === 0) {
      // Show positive message instead of technical "no V03 reports"
      doc.strokeColor(COLORS.gray[300])
         .lineWidth(1)
         .rect(40, yPos, pageWidth, 50)
         .stroke();
      
      doc.fillColor('#f0f9ff')
         .rect(40, yPos, pageWidth, 50)
         .fill();
      
      doc.fillColor(COLORS.primary)
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('✓ All Clear', 50, yPos + 10);
      
      doc.fillColor(COLORS.gray[600])
         .fontSize(9)
         .font('Helvetica')
         .text('No security incidents were reported during this period', 50, yPos + 28);
      
      yPos += 65;
    } else {
      // Show incident count summary
      doc.fillColor(COLORS.gray[600])
         .fontSize(10)
         .font('Helvetica')
         .text(`Total: ${totalIncidents} incident${totalIncidents !== 1 ? 's' : ''} reported`, 40, yPos);
      
      yPos += 25;

      // Display each incident report with full details
      incidents.forEach((incident, index) => {
        logger.debug(`   Rendering incident #${index + 1}: ${incident.category}`);
        
        const reportLines = wrapText(doc, incident.report, 450, 9);
        const reportHeight = 95 + (reportLines.length * 12);
        
        checkPageBreak(reportHeight + 25);
        
        // Incident card with border
        const cardColor = incident.priority === 'HIGH' ? '#fef2f2' : '#f0f9ff';
        const borderColor = incident.priority === 'HIGH' ? '#dc2626' : COLORS.primary;
        
        doc.strokeColor(borderColor)
           .lineWidth(1.5)
           .rect(40, yPos, pageWidth, reportHeight)
           .stroke();
        
        doc.fillColor(cardColor)
           .rect(40, yPos, pageWidth, reportHeight)
           .fill();
        
        // Incident header with category
        doc.fillColor(borderColor)
           .fontSize(12)
           .font('Helvetica-Bold')
           .text(`INCIDENT #${index + 1} - ${incident.category}`, 50, yPos + 12);
        
        // Priority badge
        if (incident.priority === 'HIGH') {
          doc.fillColor('#dc2626')
             .fontSize(8)
             .font('Helvetica-Bold')
             .text('HIGH PRIORITY', 400, yPos + 14);
        }
        
        yPos += 32;
        
        // Description label
        doc.fillColor(COLORS.black)
           .fontSize(9)
           .font('Helvetica-Bold')
           .text('Description:', 50, yPos);
        
        yPos += 16;
        
        // Description text
        doc.fillColor(COLORS.gray[800])
           .fontSize(9)
           .font('Helvetica');
        
        reportLines.forEach((line, lineIndex) => {
          doc.text(line, 50, yPos + (lineIndex * 12), { width: 450 });
        });
        
        yPos += (reportLines.length * 12) + 14;
        
        // Metadata (Date and Location)
        doc.strokeColor(COLORS.gray[300])
           .lineWidth(0.5)
           .moveTo(50, yPos)
           .lineTo(pageWidth + 15, yPos)
           .stroke();
        
        yPos += 10;
        
        doc.fillColor(COLORS.gray[600])
           .fontSize(8)
           .font('Helvetica')
           .text(`Date: ${incident.date || 'N/A'}`, 50, yPos)
           .text(`Location: ${cleanPostName(incident.zone || 'Unknown')}`, 250, yPos);
        
        yPos += 30;
      });
    }

    yPos += 20;

    // ==================== PATROL PERFORMANCE TABLE ====================
    if (posts.length > 0) {
      logger.info(`📊 Rendering patrol performance table (${posts.length} posts)...`);
      
      checkPageBreak(90);
      
      doc.fillColor(COLORS.primary)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('PATROL PERFORMANCE BY LOCATION', 40, yPos);
      
      yPos += 35;

      // Table header
      doc.fillColor(COLORS.primary)
         .rect(40, yPos, pageWidth, 22)
         .fill();
      
      doc.fillColor(COLORS.white)
         .fontSize(9)
         .font('Helvetica-Bold')
         .text('SECURITY POST', 45, yPos + 8, { width: 250 })
         .text('COMPLETED', 310, yPos + 8, { width: 80 })
         .text('EXPECTED', 400, yPos + 8, { width: 80 })
         .text('PERFORMANCE', 490, yPos + 8, { width: 60 });
      
      yPos += 22;

      const sortedPosts = [...posts].sort((a, b) => (b.Performance || 0) - (a.Performance || 0));

      // Table rows
      sortedPosts.forEach((post, index) => {
        checkPageBreak(18);
        
        if (index % 2 === 0) {
          doc.fillColor(COLORS.gray[100])
             .rect(40, yPos, pageWidth, 18)
             .fill();
        }
        
        doc.fillColor(COLORS.black)
           .fontSize(8)
           .font('Helvetica')
           .text(cleanPostName(post.SecurityPost || 'Unknown'), 45, yPos + 6, { width: 250 })
           .text(String(post.Completed || 0), 310, yPos + 6)
           .text(String(post.Expected || 0), 400, yPos + 6)
           .text(post.Percentage || '0%', 490, yPos + 6);
        
        yPos += 18;
      });

      checkPageBreak(24);
      
      // Grand total row
      doc.fillColor(COLORS.primary)
         .rect(40, yPos, pageWidth, 24)
         .fill();
      
      doc.fillColor(COLORS.white)
         .fontSize(10)
         .font('Helvetica-Bold')
         .text('TOTAL PATROLS', 45, yPos + 9)
         .text(String(totalCompleted), 310, yPos + 9)
         .text(String(totalExpectedPatrols), 400, yPos + 9)
         .text(`${overallPerformance}%`, 490, yPos + 9);
      
      yPos += 40;
    } else {
      logger.warn('⚠️ No posts to display in performance table');
    }

    // ==================== SECURITY ACTIVITY LOG ====================
    if (patrolEvents.length > 0) {
      logger.info(`📋 Rendering security activity log (${patrolEvents.length} patrol events)...`);
      
      checkPageBreak(110);
      
      doc.fillColor(COLORS.primary)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('SECURITY ACTIVITY LOG', 40, yPos);
      
      yPos += 35;

      doc.fillColor(COLORS.gray[600])
         .fontSize(9)
         .font('Helvetica')
         .text(`Showing all ${patrolEvents.length} patrol arrival logs`, 40, yPos);
      
      yPos += 22;

      // Table header
      doc.fillColor(COLORS.primary)
         .rect(40, yPos, pageWidth, 26)
         .fill();
      
      doc.fillColor(COLORS.white)
         .fontSize(10)
         .font('Helvetica-Bold')
         .text('DATE', 45, yPos + 10, { width: 75 })
         .text('TIME', 125, yPos + 10, { width: 60 })
         .text('EVENT', 195, yPos + 10, { width: 180 })
         .text('LOCATION', 375, yPos + 10, { width: 175 });
      
      yPos += 32;

      // ✅ FIXED: Display ALL events (removed the 50-event limit)
      // Event rows - Show ALL patrol events
      patrolEvents.forEach((event, index) => {
        const eventText = event.Event || 'Patrol Arrival';
        
        const eventLines = wrapText(doc, eventText, 175, 9);
        const zoneLines = wrapText(doc, event.Zone || 'Unknown', 170, 9);
        const maxLines = Math.max(eventLines.length, zoneLines.length);
        const rowHeight = Math.max(20, maxLines * 12);
        
        checkPageBreak(rowHeight + 6);
        
        if (index % 2 === 0) {
          doc.fillColor(COLORS.gray[100])
             .rect(40, yPos, pageWidth, rowHeight)
             .fill();
        }
        
        doc.fillColor(COLORS.black)
           .fontSize(9)
           .font('Helvetica')
           .text(event.Date || 'N/A', 45, yPos + 7, { width: 75 })
           .text(event.Time || 'N/A', 125, yPos + 7, { width: 60 });
        
        eventLines.forEach((line, lineIndex) => {
          doc.text(line, 195, yPos + 7 + (lineIndex * 12), { width: 175 });
        });
        
        zoneLines.forEach((line, lineIndex) => {
          doc.text(line, 375, yPos + 7 + (lineIndex * 12), { width: 170 });
        });
        
        yPos += rowHeight + 3;
      });

      yPos += 20;
    } else {
      logger.warn('⚠️ No patrol events to display in activity log');
    }

    // ==================== DATA SUMMARY SECTION ====================
    checkPageBreak(80);
    
    doc.fillColor(COLORS.primary)
       .fontSize(14)
       .font('Helvetica-Bold')
       .text('REPORT SUMMARY', 40, yPos);
    
    yPos += 25;
    
    doc.strokeColor(COLORS.gray[300])
       .lineWidth(0.5)
       .rect(40, yPos, pageWidth, 60)
       .stroke();
    
    doc.fillColor(COLORS.gray[100])
       .rect(40, yPos, pageWidth, 60)
       .fill();
    
    doc.fillColor(COLORS.black)
       .fontSize(9)
       .font('Helvetica-Bold')
       .text('Activity Breakdown:', 50, yPos + 10);
    
    doc.fillColor(COLORS.gray[600])
       .fontSize(8)
       .font('Helvetica')
       .text(`• Patrol Activities: ${patrolEvents.length} arrival logs`, 60, yPos + 25)
       .text(`• Incident Reports: ${totalIncidents} incident${totalIncidents !== 1 ? 's' : ''}`, 60, yPos + 38)
       .text(`• Reporting Period: ${actualDays} day${actualDays !== 1 ? 's' : ''} (${startDateFormatted} to ${endDateFormatted})`, 60, yPos + 51);
    
    doc.fillColor(COLORS.gray[600])
       .fontSize(7)
       .font('Helvetica')
       .text(`Report generated: ${dayjs().format('DD/MM/YYYY HH:mm')}`, 40, yPos + 75);
    
    yPos += 90;

    // ==================== FOOTER ====================
    logger.info('📄 Adding page footers...');
    
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      
      const footerY = 780;
      
      doc.fillColor(COLORS.gray[600])
         .fontSize(8)
         .font('Helvetica')
         .text('Confidential Security Report - For Authorized Personnel Only', 40, footerY)
         .text(`Page ${i + 1} of ${pageCount}`, 480, footerY);
    }

    logger.info('✅ PDF content generation complete');
    doc.end();
    
    const totalTime = Date.now() - startTime;
    logger.info('='.repeat(60));
    logger.info(`✅ PDF GENERATED SUCCESSFULLY in ${totalTime}ms`);
    logger.info(`   - Pages: ${pageCount}`);
    logger.info(`   - Security Posts: ${posts.length}`);
    logger.info(`   - Patrol Events: ${patrolEvents.length}`);
    logger.info(`   - Incident Reports: ${totalIncidents}`);
    logger.info(`   - Reporting Period: ${actualDays} days`);
    logger.info('='.repeat(60));
    
    return pdfPromise;

  } catch (error) {
    logger.error('='.repeat(60));
    logger.error('❌ PDF GENERATION FAILED');
    logger.error(`   Error: ${error.message}`);
    if (error.stack) {
      logger.error(`   Stack trace: ${error.stack.split('\n')[1]}`);
    }
    logger.error('='.repeat(60));
    throw error;
  }
}

/**
 * Generate historical report PDF (alias)
 */
export async function generateHistoricalReportPDF(data, clientName, dateRange) {
  const pdfData = {
    clientId: data.clientId || data.client?.ClientID,
    clientName: clientName,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate
  };
  
  return await generateDashboardPDF(pdfData);
}

/**
 * Generate patrol report PDF (alias)
 */
export async function generatePatrolReportPDF(data, clientName, dateRange) {
  const pdfData = {
    clientId: data.clientId || data.client?.ClientID,
    clientName: clientName,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate
  };
  
  return await generateDashboardPDF(pdfData);
}

/**
 * Main PDF generation function with error handling
 */
export async function generatePDFReport(clientData) {
  try {
    const pdfBuffer = await generateDashboardPDF(clientData);
    
    return {
      success: true,
      pdfBuffer: pdfBuffer,
      timestamp: new Date(),
      metadata: {
        clientId: clientData.clientId,
        clientName: clientData.clientName,
        startDate: clientData.startDate,
        endDate: clientData.endDate
      }
    };
    
  } catch (error) {
    logger.error('PDF report error:', error.message);
    
    // Create error PDF
    const doc = new PDFDocument();
    const buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});
    
    doc.fontSize(20)
       .text('Report Generation Error', 50, 50)
       .fontSize(12)
       .text(`Error: ${error.message}`, 50, 100)
       .text(`Time: ${new Date().toISOString()}`, 50, 150)
       .text(`Client ID: ${clientData.clientId || 'Unknown'}`, 50, 200);
    
    doc.end();
    
    return {
      success: false,
      pdfBuffer: Buffer.concat(buffers),
      error: error.message,
      timestamp: new Date()
    };
  }
}

export default {
  generateDashboardPDF,
  generateHistoricalReportPDF,
  generatePatrolReportPDF,
  generatePDFReport
};