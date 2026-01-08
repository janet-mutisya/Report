// scripts/checkClientEmails.js
// CHANGE THIS LINE:
// import bmSecurityAPI from "../service/bmSecurityAPI.js";

// TO THIS:
import bmSecurityAPI from "../service/bmSecurityAPI.js";
import fs from "fs";

async function fetchAllClients() {
  try {
    // Ensure we're authenticated first
    await bmSecurityAPI.ensureAuthenticated();
    
    let allClients = [];
    let page = 1;
    const limit = 50;

    console.log('🔍 Fetching all clients from BM Security...\n');

    while (true) {
      const sort = JSON.stringify([{ property: "cue_ncuenta", direction: "ASC" }]);
      const filter = JSON.stringify([
        { property: "cue_nparticion", value: "0" },
        { property: "tip_nTipo", value: 5 }
      ]);

      const params = {
        page,
        start: (page - 1) * limit,
        limit,
        sort,
        filter,
        oauth_token: bmSecurityAPI.token
      };

      const response = await fetch(
        `${bmSecurityAPI.baseURL}/Rest/Search/CuentaByDealer?${new URLSearchParams(params)}`,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const clients = data?.data || data?.rows || [];

      if (clients.length === 0) break;

      allClients.push(...clients);
      console.log(`📥 Page ${page}: ${clients.length} clients (total: ${allClients.length})`);

      if (clients.length < limit) break;

      page++;
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allClients;

  } catch (error) {
    console.error('❌ Error fetching clients:', error.message);
    throw error;
  }
}

async function analyzeClientEmails() {
  try {
    const allClients = await fetchAllClients();

    // Separate clients with and without emails
    const clientsWithEmail = allClients.filter(c => {
      const email = c.cue_correo || c.cue_cemail || c.email;
      return email && email.trim() !== '' && email.includes('@');
    });

    const clientsWithoutEmail = allClients.filter(c => {
      const email = c.cue_correo || c.cue_cemail || c.email;
      return !email || email.trim() === '' || !email.includes('@');
    });

    // Calculate statistics
    const totalClients = allClients.length;
    const withEmailCount = clientsWithEmail.length;
    const withoutEmailCount = clientsWithoutEmail.length;
    const withEmailPercent = ((withEmailCount / totalClients) * 100).toFixed(1);
    const withoutEmailPercent = ((withoutEmailCount / totalClients) * 100).toFixed(1);

    console.log('\n' + '='.repeat(60));
    console.log('📊 CLIENT EMAIL ANALYSIS');
    console.log('='.repeat(60));
    console.log(`Total Clients:        ${totalClients}`);
    console.log(`✅ With Email:        ${withEmailCount} (${withEmailPercent}%)`);
    console.log(`❌ Without Email:     ${withoutEmailCount} (${withoutEmailPercent}%)`);
    console.log('='.repeat(60) + '\n');

    // Save detailed reports
    const withEmailReport = clientsWithEmail.map(c => ({
      accountNumber: c.cue_ncuenta,
      email: c.cue_correo || c.cue_cemail || c.email,
      name: c.cue_cnombre || c.nombre,
      company: c.cue_cempresa || c.empresa || ''
    }));

    const withoutEmailReport = clientsWithoutEmail.map(c => ({
      accountNumber: c.cue_ncuenta,
      name: c.cue_cnombre || c.nombre,
      company: c.cue_cempresa || c.empresa || ''
    }));

    // Save to JSON files
    fs.writeFileSync(
      'reports/clients_with_email.json',
      JSON.stringify(withEmailReport, null, 2)
    );

    fs.writeFileSync(
      'reports/clients_without_email.json',
      JSON.stringify(withoutEmailReport, null, 2)
    );

    // Save summary CSV for easy viewing
    const csvLines = [
      'Account Number,Email,Name,Company,Has Email',
      ...allClients.map(c => {
        const email = c.cue_correo || c.cue_cemail || c.email || '';
        const hasEmail = email && email.includes('@') ? 'YES' : 'NO';
        return [
          c.cue_ncuenta,
          email,
          (c.cue_cnombre || c.nombre || '').replace(/,/g, ';'),
          (c.cue_cempresa || c.empresa || '').replace(/,/g, ';'),
          hasEmail
        ].join(',');
      })
    ];

    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync('reports/all_clients_summary.csv', csvLines.join('\n'));

    console.log('📁 Files created:');
    console.log('  ✅ reports/clients_with_email.json');
    console.log('  ✅ reports/clients_without_email.json');
    console.log('  ✅ reports/all_clients_summary.csv');
    console.log('\n💡 Open the CSV in Excel to review all clients\n');

    // Show sample emails
    if (clientsWithEmail.length > 0) {
      console.log('📧 Sample clients with emails (first 10):');
      clientsWithEmail.slice(0, 10).forEach(c => {
        console.log(`  ${c.cue_ncuenta} - ${c.cue_correo || c.cue_cemail}`);
      });
    }

    if (clientsWithoutEmail.length > 0) {
      console.log('\n❌ Sample clients WITHOUT emails (first 10):');
      clientsWithoutEmail.slice(0, 10).forEach(c => {
        console.log(`  ${c.cue_ncuenta} - ${c.cue_cnombre || c.nombre || 'No name'}`);
      });
    }

    // Recommendations
    console.log('\n' + '='.repeat(60));
    console.log('💡 RECOMMENDATIONS:');
    console.log('='.repeat(60));

    if (withEmailPercent >= 80) {
      console.log('✅ Good news! Most clients have emails.');
      console.log('   → Proceed with email-based signup system');
      console.log('   → Send account numbers via email');
    } else if (withEmailPercent >= 50) {
      console.log('⚠️  About half your clients have emails.');
      console.log('   → Use email signup for clients with emails');
      console.log('   → Manual account creation for others');
    } else {
      console.log('❌ Warning: Most clients lack email addresses.');
      console.log('   → Consider manual account creation for all');
      console.log('   → Or collect emails before onboarding');
    }
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Fatal Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the analysis
console.log('🚀 Starting client email analysis...\n');
analyzeClientEmails()
  .then(() => {
    console.log('✅ Analysis complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  });