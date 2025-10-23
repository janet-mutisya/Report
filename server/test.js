import fs from 'fs';
import { generateWeeklyReportPDF } from './service/reportService.js'; // Adjust path

async function test() {
  const clientName = 'BM HQ'; // Pick a client you know has data

  const pdfBuffer = await generateWeeklyReportPDF(clientName);

  if (!pdfBuffer) {
    console.log('No data found to generate report.');
    return;
  }

  // Save the PDF locally to inspect it
  fs.writeFileSync(`./${clientName}_weekly_report.pdf`, pdfBuffer);
  console.log('Report PDF generated and saved successfully!');
}

test();
