// server/services/reportService.js - FULLY SYNCHRONIZED WITH API & MODEL
const PDFDocument = require('pdfkit');
const { fetchWeeklyReport } = require('../models/reportModel.js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || 'Africa/Nairobi';

/**
 * 🎨 Format percentage for display (no decimals)
 */
function formatPercentage(value) {
  return Math.round(value) + '%';
}

/**
 * 🎯 Get performance rating based on percentage
 */
function getPerformanceRating(percentage) {
  const numericValue = typeof percentage === 'number' ? percentage : parseInt(percentage) || 0;
  
  if (numericValue >= 90) return { rating: 'Excellent', color: 'green' };
  if (numericValue >= 80) return { rating: 'Good', color: 'blue' };
  if (numericValue >= 70) return { rating: 'Fair', color: 'orange' };
  return { rating: 'Poor', color: 'red' };
}

/**
 * 📊 Generate performance summary section
 */
function generatePerformanceSummary(doc, metadata, posts) {
  // Overall Performance Box
  const overallRating = getPerformanceRating(metadata.overallPerformance);
  
  doc.fontSize(14).fillColor('black').text('📊 Overall Performance', { underline: true });
  doc.moveDown(0.3);
  
  doc.fontSize(11)
    .text(`Total Expected Patrols: ${metadata.totalExpectedPatrols}`)
    .text(`Total Completed: ${metadata.totalCompleted}`)
    .text(`Overall Rate: ${formatPercentage(metadata.overallPerformance)}`)
    .fillColor(overallRating.color).text(`Performance Rating: ${overallRating.rating}`)
    .fillColor('black');
  
  doc.moveDown(0.5);
  
  // Performance Metrics
  doc.text(`Zones Monitored: ${posts.length}`)
    .fillColor('green').text(`Excellent Zones (≥90%): ${metadata.dataQuality.excellentZones || 0}`)
    .fillColor('red').text(`Underperforming Zones (<70%): ${metadata.dataQuality.underperformingZones || 0}`)
    .fillColor('black');
  
  // Data Source Indicator
  if (metadata.dataSource) {
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('gray')
      .text(`Data Source: ${metadata.dataSource}`, { align: 'left' });
    doc.fillColor('black');
  }
  
  doc.moveDown(1);
}

/**
 * 📋 Generate zone performance table
 */
function generateZonePerformanceTable(doc, posts) {
  doc.fontSize(14).fillColor('black').text('📍 Zone Performance Details', { underline: true });
  doc.moveDown(0.5);
  
  if (posts.length === 0) {
    doc.fontSize(11).fillColor('orange').text('⚠️ No zone performance data available.');
    doc.fontSize(9).fillColor('gray').text('This may indicate:');
    doc.text('  • No patrol data found for this period');
    doc.text('  • API connection issues (check fallback to database)');
    doc.text('  • Incorrect account number mapping');
    doc.fillColor('black');
    doc.moveDown(1);
    return;
  }
  
  // Table Header
  doc.fontSize(10).fillColor('black');
  doc.text('Security Post', 50, doc.y, { width: 150, continued: true });
  doc.text('Completed', 200, doc.y, { width: 60, continued: true, align: 'right' });
  doc.text('Expected', 260, doc.y, { width: 60, continued: true, align: 'right' });
  doc.text('Performance', 320, doc.y, { width: 80, align: 'right' });
  doc.moveDown(0.3);
  
  // Separator line
  doc.moveTo(50, doc.y).lineTo(400, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.3);
  
  // Table Rows
  posts.forEach((post, index) => {
    // Add new page if needed
    if (doc.y > 680) {
      doc.addPage();
      doc.fontSize(14).text('Zone Performance (continued)', { underline: true });
      doc.moveDown(0.5);
    }
    
    const yPos = doc.y;
    const rating = getPerformanceRating(post.Performance);
    
    // Alternate row background
    if (index % 2 === 0) {
      doc.rect(45, yPos - 2, 360, 15).fillColor('#f8f9fa').fill();
    }
    
    doc.fillColor('black').fontSize(9);
    
    // Security Post (truncate if too long)
    const postName = post.SecurityPost.length > 20 
      ? post.SecurityPost.substring(0, 20) + '...' 
      : post.SecurityPost;
    
    doc.text(postName, 50, yPos, { width: 150 });
    doc.text(post.Completed.toString(), 200, yPos, { width: 60, align: 'right' });
    doc.text(post.Expected.toString(), 260, yPos, { width: 60, align: 'right' });
    doc.fillColor(rating.color).text(post.Percentage, 320, yPos, { width: 80, align: 'right' });
    
    doc.moveDown(1);
  });
  
  doc.moveDown(0.5);
}

/**
 * 🕒 Generate event log section
 */
function generateEventLog(doc, events, metadata) {
  doc.addPage();
  doc.fontSize(14).fillColor('black').text('🕒 Event Log', { underline: true });
  doc.moveDown(0.5);
  
  if (events.length === 0) {
    doc.fontSize(11).fillColor('orange').text('⚠️ No events recorded in the selected period.');
    doc.fontSize(9).fillColor('gray');
    doc.text('Possible reasons:');
    doc.text('  • No patrol activity during this time range');
    doc.text('  • API/Database connection issues');
    doc.text('  • Events filtered out (check alarm codes)');
    
    if (metadata.dataSource) {
      doc.moveDown(0.3);
      doc.text(`Last checked source: ${metadata.dataSource}`);
    }
    
    doc.fillColor('black');
    doc.moveDown(1);
    return;
  }
  
  // Header
  doc.fontSize(9).fillColor('gray');
  doc.text('Date', 50, doc.y, { width: 80 });
  doc.text('Time', 130, doc.y, { width: 50 });
  doc.text('Zone', 180, doc.y, { width: 100 });
  doc.text('Event', 280, doc.y, { width: 150 });
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y).lineTo(430, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.3);
  
  // Display only recent events to avoid PDF size issues
  const displayEvents = events.slice(0, 150);
  
  displayEvents.forEach((event, index) => {
    if (doc.y > 720) { // Add new page if near bottom
      doc.addPage();
      doc.fontSize(12).fillColor('black').text('Event Log (continued)', { underline: true });
      doc.moveDown(0.5);
    }
    
    const yPos = doc.y;
    
    // Alternate row background
    if (index % 2 === 0) {
      doc.rect(45, yPos - 2, 400, 12).fillColor('#fafafa').fill();
    }
    
    doc.fontSize(8).fillColor('black');
    doc.text(event.Date, 50, yPos, { width: 80 });
    doc.text(event.Time, 130, yPos, { width: 50 });
    
    // Zone name
    const zoneName = event.Zone.length > 15 
      ? event.Zone.substring(0, 15) + '...' 
      : event.Zone;
    doc.text(zoneName, 180, yPos, { width: 100 });
    
    // Event description with wrapping
    const eventText = event.Event.length > 30 
      ? event.Event.substring(0, 30) + '...' 
      : event.Event;
    doc.text(eventText, 280, yPos, { width: 150 });
    
    doc.moveDown(0.6);
  });
  
  if (events.length > 150) {
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor('gray').text(
      `... and ${events.length - 150} more events (truncated for PDF size)`,
      { align: 'center' }
    );
  }
  
  doc.fillColor('black');
  doc.moveDown(0.5);
}

/**
 * 🛡️ Generate guard reports section
 */
function generateGuardReports(doc, guardReports) {
  if (guardReports.length === 0) {
    doc.addPage();
    doc.fontSize(14).fillColor('black').text('🛡️ Guard Incident Reports', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('gray').text('No guard reports filed during this period.');
    doc.moveDown(1);
    return;
  }
  
  doc.addPage();
  doc.fontSize(14).fillColor('black').text('🛡️ Guard Incident Reports', { underline: true });
  doc.moveDown(0.5);
  
  doc.fontSize(9).fillColor('gray')
    .text(`Total Reports: ${guardReports.length}`)
    .fillColor('black');
  doc.moveDown(0.5);
  
  guardReports.forEach((report, index) => {
    if (doc.y > 650) { // Add new page if near bottom
      doc.addPage();
      doc.fontSize(12).text('Guard Reports (continued)', { underline: true });
      doc.moveDown(0.5);
    }
    
    doc.fontSize(10).fillColor('blue').text(`Report #${index + 1} - ${report.date}`);
    doc.fontSize(9).fillColor('gray').text(`Zone: ${report.zone}`);
    doc.moveDown(0.2);
    
    doc.fontSize(9).fillColor('black');
    
    // Format report text with proper wrapping
    doc.text(report.report, { 
      width: 450, 
      align: 'left' 
    });
    
    doc.moveDown(0.5);
    
    // Separator
    if (index < guardReports.length - 1) {
      doc.moveTo(50, doc.y).lineTo(500, doc.y).strokeColor('#eeeeee').stroke();
      doc.moveDown(0.5);
    }
  });
}

/**
 * 📝 Generate header section
 */
function generateHeader(doc, metadata, startDate, endDate) {
  // Title
  doc.fontSize(20).fillColor('#2c3e50').text('SECURITY PATROL REPORT', { align: 'center' });
  doc.moveDown(0.5);
  
  // Client and Period Info
  doc.fontSize(12).fillColor('black')
    .text(`Client: ${metadata.clientName || 'Unknown Client'}`, { align: 'center' })
    .text(`Period: ${dayjs(startDate).format('DD/MM/YYYY')} - ${dayjs(endDate).format('DD/MM/YYYY')}`, { align: 'center' })
    .text(`Shift Type: ${metadata.shiftType || 'Day/Night'}`, { align: 'center' })
    .text(`Days in Range: ${metadata.daysInRange || 0} days`, { align: 'center' });
  
  doc.moveDown(1);
  
  // Add divider
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#2c3e50').lineWidth(2).stroke();
  doc.moveDown(1);
}

/**
 * 📄 Generate footer section
 */
function generateFooter(doc, metadata) {
  doc.moveDown(2);
  
  // Add separator line
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.5);
  
  doc.fontSize(8).fillColor('gray')
    .text(`Report generated: ${dayjs(metadata.generatedAt).tz(TZ).format('DD/MM/YYYY HH:mm:ss')}`, { align: 'center' })
    .text(`System: Vigicontrol Security Patrol Monitoring`, { align: 'center' })
    .text(`Client ID: ${metadata.clientId}`, { align: 'center' });
  
  // Data source information
  if (metadata.dataSource) {
    doc.text(`Data Source: ${metadata.dataSource}`, { align: 'center' });
  }
  
  // Data quality indicator
  if (!metadata.dataQuality.isValid) {
    doc.moveDown(0.3);
    doc.fillColor('orange').text('⚠️ Data quality issues detected - some information may be incomplete', { align: 'center' });
    
    if (metadata.dataQuality.issues && metadata.dataQuality.issues.length > 0) {
      doc.fontSize(7);
      metadata.dataQuality.issues.slice(0, 3).forEach(issue => {
        doc.text(`• ${issue}`, { align: 'center' });
      });
    }
  }
  
  doc.fillColor('black');
}

/**
 * 🚨 Generate error/warning page for reports with issues
 */
function generateWarningPage(doc, metadata) {
  if (!metadata.dataQuality || metadata.dataQuality.isValid) return;
  
  doc.addPage();
  doc.fontSize(16).fillColor('orange').text('⚠️ Data Quality Notice', { align: 'center' });
  doc.moveDown(1);
  
  doc.fontSize(10).fillColor('black');
  doc.text('This report was generated with the following data quality issues:', { align: 'center' });
  doc.moveDown(0.5);
  
  if (metadata.dataQuality.issues && metadata.dataQuality.issues.length > 0) {
    metadata.dataQuality.issues.forEach((issue, index) => {
      doc.fontSize(9).text(`${index + 1}. ${issue}`, { indent: 50 });
    });
  }
  
  doc.moveDown(1);
  doc.fontSize(9).fillColor('gray');
  doc.text('Recommendations:', { indent: 50, underline: true });
  doc.text('• Verify API connectivity and account number mappings', { indent: 60 });
  doc.text('• Check database table availability for the date range', { indent: 60 });
  doc.text('• Confirm patrol schedules are configured correctly', { indent: 60 });
  doc.text('• Review system logs for detailed error information', { indent: 60 });
  
  if (metadata.error) {
    doc.moveDown(1);
    doc.fontSize(8).fillColor('red');
    doc.text(`Error Details: ${metadata.error.message}`, { indent: 50 });
  }
  
  doc.fillColor('black');
}

/**
 * 📊 MAIN FUNCTION: Generate PDF report with full API integration
 */
async function generateWeeklyReportPDF(clientId, startDate, endDate) {
  try {
    console.log(`\n🧾 ========================================`);
    console.log(`📊 GENERATING PDF REPORT`);
    console.log(`   Client ID: ${clientId}`);
    console.log(`   Period: ${startDate} → ${endDate}`);
    console.log(`========================================\n`);
    
    // 1️⃣ Fetch data using the synchronized report model (with API integration)
    const reportData = await fetchWeeklyReport(clientId, startDate, endDate);
    
    if (!reportData.metadata.success) {
      throw new Error(`Failed to fetch report data: ${reportData.metadata.error?.message || 'Unknown error'}`);
    }
    
    console.log(`\n✅ Data Successfully Fetched:`);
    console.log(`   Client: ${reportData.metadata.clientName}`);
    console.log(`   Posts: ${reportData.posts.length}`);
    console.log(`   Events: ${reportData.events.length}`);
    console.log(`   Guard Reports: ${reportData.guardReports.length}`);
    console.log(`   Performance: ${reportData.metadata.overallPerformance}%`);
    console.log(`   Data Source: ${reportData.metadata.dataSource || 'Database'}`);
    
    // Warn if no data
    if (reportData.posts.length === 0 && reportData.events.length === 0) {
      console.warn(`\n⚠️  WARNING: No patrol data found!`);
      console.warn(`   This could indicate:`);
      console.warn(`   • API connection issues`);
      console.warn(`   • Incorrect account number mapping`);
      console.warn(`   • No patrols during this period`);
      console.warn(`   • Database fallback returned no results\n`);
    }
    
    // 2️⃣ Create PDF document
    const doc = new PDFDocument({ 
      margin: 50, 
      size: "A4",
      info: {
        Title: `Security Patrol Report - ${reportData.metadata.clientName}`,
        Author: 'Vigicontrol Security System',
        Subject: `Patrol Report ${dayjs(startDate).format('DD/MM/YYYY')} - ${dayjs(endDate).format('DD/MM/YYYY')}`,
        Keywords: 'security,patrol,report,vigicontrol',
        Creator: 'Vigicontrol Reporting System',
        CreationDate: new Date()
      }
    });
    
    const buffers = [];
    doc.on("data", chunk => buffers.push(chunk));
    
    const pdfPromise = new Promise((resolve, reject) => {
      doc.on("end", () => {
        console.log(`✅ PDF document finalized`);
        resolve(Buffer.concat(buffers));
      });
      doc.on("error", reject);
    });
    
    // 3️⃣ Generate PDF sections using synchronized data
    console.log(`\n📄 Building PDF sections...`);
    
    generateHeader(doc, reportData.metadata, startDate, endDate);
    generatePerformanceSummary(doc, reportData.metadata, reportData.posts);
    generateZonePerformanceTable(doc, reportData.posts);
    generateEventLog(doc, reportData.events, reportData.metadata);
    generateGuardReports(doc, reportData.guardReports);
    
    // Generate warning page if there are data quality issues
    if (!reportData.metadata.dataQuality.isValid) {
      generateWarningPage(doc, reportData.metadata);
    }
    
    generateFooter(doc, reportData.metadata);
    
    // 4️⃣ Finalize PDF
    doc.end();
    
    const pdfBuffer = await pdfPromise;
    
    console.log(`\n✅ ========================================`);
    console.log(`   PDF GENERATION COMPLETE`);
    console.log(`   Client: ${reportData.metadata.clientName}`);
    console.log(`   Size: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   Pages: ~${Math.ceil((reportData.posts.length / 20) + (reportData.events.length / 40) + 3)}`);
    console.log(`========================================\n`);
    
    return pdfBuffer;
    
  } catch (error) {
    console.error('\n❌ ========================================');
    console.error('   PDF GENERATION FAILED');
    console.error('   Error:', error.message);
    console.error('========================================\n');
    
    // Generate error PDF
    const errorDoc = new PDFDocument({ margin: 50, size: "A4" });
    const errorBuffers = [];
    errorDoc.on("data", chunk => errorBuffers.push(chunk));
    
    const errorPdfPromise = new Promise(resolve => {
      errorDoc.on("end", () => resolve(Buffer.concat(errorBuffers)));
    });
    
    errorDoc.fontSize(16).fillColor('red').text('❌ Report Generation Failed', { align: 'center' });
    errorDoc.moveDown();
    errorDoc.fontSize(12).fillColor('black').text(`Error: ${error.message}`);
    errorDoc.moveDown();
    errorDoc.text(`Client ID: ${clientId}`);
    errorDoc.text(`Period: ${startDate} to ${endDate}`);
    errorDoc.moveDown();
    
    errorDoc.fontSize(10).fillColor('gray');
    errorDoc.text('Possible causes:', { underline: true });
    errorDoc.text('• BMSecurity API connection failure');
    errorDoc.text('• Invalid account number or client ID');
    errorDoc.text('• Database connection issues');
    errorDoc.text('• No data available for the selected period');
    errorDoc.moveDown();
    
    errorDoc.text('Please try again or contact system administrator.', { align: 'center' });
    
    errorDoc.end();
    return await errorPdfPromise;
  }
}

/**
 * 🧪 TEST FUNCTION: Generate test PDF with validation
 */
async function generateTestReport(clientId = 1001, startDate = null, endDate = null) {
  try {
    console.log('\n🧪 ========================================');
    console.log('   RUNNING TEST REPORT GENERATION');
    console.log('========================================\n');
    
    const testStartDate = startDate || dayjs().subtract(7, 'day').format('YYYY-MM-DD');
    const testEndDate = endDate || dayjs().format('YYYY-MM-DD');
    
    console.log(`   Test Parameters:`);
    console.log(`   Client ID: ${clientId}`);
    console.log(`   Start Date: ${testStartDate}`);
    console.log(`   End Date: ${testEndDate}\n`);
    
    const pdfBuffer = await generateWeeklyReportPDF(
      clientId, 
      testStartDate, 
      testEndDate
    );
    
    return {
      success: true,
      pdfSize: pdfBuffer.length,
      pdfSizeKB: (pdfBuffer.length / 1024).toFixed(2),
      clientId,
      period: `${testStartDate} to ${testEndDate}`,
      message: 'Test PDF generated successfully'
    };
  } catch (error) {
    console.error('\n❌ Test report failed:', error);
    return {
      success: false,
      error: error.message,
      clientId,
      period: `${startDate} to ${endDate}`
    };
  }
}

/**
 * 📧 Generate report for email attachment
 */
async function generateEmailReport(clientId, startDate, endDate, clientName = 'Client') {
  try {
    console.log(`\n📧 Generating email report for ${clientName}...`);
    
    const pdfBuffer = await generateWeeklyReportPDF(clientId, startDate, endDate);
    
    const fileName = `Patrol_Report_${clientName.replace(/\s+/g, '_')}_${dayjs(startDate).format('DDMMYYYY')}_${dayjs(endDate).format('DDMMYYYY')}.pdf`;
    
    return {
      success: true,
      pdfBuffer,
      fileName,
      clientName,
      period: `${dayjs(startDate).format('DD/MM/YYYY')} - ${dayjs(endDate).format('DD/MM/YYYY')}`,
      generatedAt: new Date(),
      fileSizeKB: (pdfBuffer.length / 1024).toFixed(2)
    };
  } catch (error) {
    console.error('❌ Email report generation failed:', error);
    return {
      success: false,
      error: error.message,
      fileName: null,
      pdfBuffer: null
    };
  }
}

/**
 * 🔍 Get report metadata without generating PDF
 */
async function getReportMetadata(clientId, startDate, endDate) {
  try {
    console.log(`\n🔍 Fetching report metadata for client ${clientId}...`);
    
    const reportData = await fetchWeeklyReport(clientId, startDate, endDate);
    
    return {
      success: reportData.metadata.success,
      metadata: {
        clientName: reportData.metadata.clientName,
        clientId: reportData.metadata.clientId,
        startDate: reportData.metadata.startDate,
        endDate: reportData.metadata.endDate,
        overallPerformance: reportData.metadata.overallPerformance,
        totalZones: reportData.posts.length,
        totalEvents: reportData.events.length,
        totalGuardReports: reportData.guardReports.length,
        dataQuality: reportData.metadata.dataQuality,
        dataSource: reportData.metadata.dataSource,
        shiftType: reportData.metadata.shiftType,
        daysInRange: reportData.metadata.daysInRange
      },
      summary: {
        posts: reportData.posts.length,
        events: reportData.events.length,
        guardReports: reportData.guardReports.length,
        totalExpected: reportData.metadata.totalExpectedPatrols,
        totalCompleted: reportData.metadata.totalCompleted
      }
    };
  } catch (error) {
    console.error('❌ Failed to get report metadata:', error);
    return {
      success: false,
      error: error.message,
      metadata: null,
      summary: null
    };
  }
}

/**
 * 🔍 Validate report data before PDF generation
 */
async function validateReportData(clientId, startDate, endDate) {
  try {
    console.log(`\n🔍 Validating report data availability...`);
    
    const metadata = await getReportMetadata(clientId, startDate, endDate);
    
    const warnings = [];
    const errors = [];
    
    if (!metadata.success) {
      errors.push('Failed to fetch report data');
      return { valid: false, errors, warnings };
    }
    
    if (metadata.summary.posts === 0) {
      warnings.push('No security posts found - report will be empty');
    }
    
    if (metadata.summary.events === 0) {
      warnings.push('No patrol events found for this period');
    }
    
    if (metadata.metadata.overallPerformance === 0) {
      warnings.push('Zero performance detected - verify patrol data');
    }
    
    if (!metadata.metadata.dataQuality.isValid) {
      warnings.push('Data quality issues detected');
      if (metadata.metadata.dataQuality.issues) {
        warnings.push(...metadata.metadata.dataQuality.issues);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      metadata: metadata.metadata,
      canGeneratePDF: errors.length === 0,
      recommendGeneration: errors.length === 0 && warnings.length < 3
    };
  } catch (error) {
    return {
      valid: false,
      errors: [error.message],
      warnings: [],
      canGeneratePDF: false
    };
  }
}

module.exports = {
  generateWeeklyReportPDF,
  generateTestReport,
  generateEmailReport,
  getReportMetadata,
  validateReportData
};