// build.js - COMPLETE VERSION WITH ALL ASSETS INCLUDING LOGO
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RELEASE_DIR = path.join(__dirname, 'release');
const EXE_NAME = 'guard-report-server.exe';

console.log('\n🚀 Starting Build Process...\n');

// Step 1: Clean previous builds
console.log('🧹 Cleaning old builds...');
if (fs.existsSync(RELEASE_DIR)) {
  fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
  console.log('   ✓ Removed old release folder');
}
fs.mkdirSync(RELEASE_DIR, { recursive: true });
console.log('   ✓ Created fresh release folder\n');

// Step 2: Ensure required directories and files exist
console.log('📁 Ensuring required files exist...');

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('   ✓ Created data directory');
}

// Create clients.json if it doesn't exist
const clientsFile = path.join(dataDir, 'clients.json');
if (!fs.existsSync(clientsFile)) {
  fs.writeFileSync(clientsFile, JSON.stringify({ clients: [] }, null, 2));
  console.log('   ✓ Created clients.json');
} else {
  console.log('   ✓ clients.json exists');
}

// Verify assets folder exists
const assetsDir = path.join(__dirname, 'assets');
if (fs.existsSync(assetsDir)) {
  const logoPath = path.join(assetsDir, 'BM SECURITY LOGO.jpg');
  if (fs.existsSync(logoPath)) {
    console.log('   ✓ Logo found: BM SECURITY LOGO.jpg');
  } else {
    console.warn('   ⚠️  Logo not found in assets folder');
  }
} else {
  console.warn('   ⚠️  Assets folder not found');
}

// Verify frontend dist exists
const distDir = path.join(__dirname, '..', 'client', 'reports', 'dist');
if (fs.existsSync(distDir)) {
  console.log('   ✓ Frontend dist found');
} else {
  console.warn('   ⚠️  Frontend dist not found - will run in API-only mode');
}

console.log();

// Step 3: Build executable with ALL required files INCLUDING ASSETS
console.log('📦 Building executable (this takes 3-5 minutes)...\n');

try {
  const pkgCommand = [
    'pkg .',
    '--target node18-win-x64',
    `--output "${path.join(RELEASE_DIR, EXE_NAME)}"`,
    '--compress GZip',
    // Include ALL necessary assets
    '--assets "config/**/*"',
    '--assets "routes/**/*"',
    '--assets "service/**/*"',
    '--assets "models/**/*"',
    '--assets "middleware/**/*"',
    '--assets "utils/**/*"',
    '--assets "controllers/**/*"',
    '--assets "data/**/*"',              // ✅ Include data directory
    '--assets "assets/**/*"',            // ✅ CRITICAL: Include assets folder with logo
    '--assets "public/**/*"',
    '--assets "views/**/*"',
    '--assets "dist/**/*"',              // ✅ Include frontend if in server dir
    '--assets "../client/reports/dist/**/*"',  // ✅ Include frontend from client
    '--assets ".env"',                   // ✅ Include actual .env
    '--assets ".env.example"',
    '--assets "logger.js"'               // ✅ Include logger
  ].join(' ');

  execSync(pkgCommand, { 
    stdio: 'inherit',
    cwd: __dirname,
    shell: true
  });
  
  console.log('\n✅ Executable built successfully!\n');
} catch (error) {
  console.error('\n❌ Build failed:', error.message);
  console.error('\nTroubleshooting:');
  console.error('1. Ensure pkg is installed: npm install -g pkg');
  console.error('2. Check that package.json has correct "bin" entry');
  console.error('3. Verify all source files exist in their directories\n');
  process.exit(1);
}

// Step 4: Copy .env file directly (with actual credentials)
console.log('📁 Copying configuration files...');

const envSource = path.join(__dirname, '.env');
const envDest = path.join(RELEASE_DIR, '.env');

if (fs.existsSync(envSource)) {
  fs.copyFileSync(envSource, envDest);
  console.log('   ✓ Copied .env with production credentials');
} else {
  console.warn('   ⚠️  .env not found - users will need to create it manually');
}

// Also copy .env.example as backup
const envExample = path.join(__dirname, '.env.example');
if (fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, path.join(RELEASE_DIR, '.env.example'));
  console.log('   ✓ Copied .env.example');
}

// Copy clients.json to release
if (fs.existsSync(clientsFile)) {
  const releaseDataDir = path.join(RELEASE_DIR, 'data');
  if (!fs.existsSync(releaseDataDir)) {
    fs.mkdirSync(releaseDataDir, { recursive: true });
  }
  fs.copyFileSync(clientsFile, path.join(releaseDataDir, 'clients.json'));
  console.log('   ✓ Copied clients.json to release/data/');
}

// Step 4.5: Copy assets folder EXPLICITLY (including logo)
console.log('🎨 Copying assets folder with logo...');

const assetsSource = path.join(__dirname, 'assets');
const assetsDest = path.join(RELEASE_DIR, 'assets');

if (fs.existsSync(assetsSource)) {
  // Create assets directory in release
  if (!fs.existsSync(assetsDest)) {
    fs.mkdirSync(assetsDest, { recursive: true });
    console.log('   ✓ Created assets folder in release');
  }
  
  // Copy all files from assets folder
  const assetsFiles = fs.readdirSync(assetsSource);
  let filesCopied = 0;
  
  assetsFiles.forEach(file => {
    const sourceFile = path.join(assetsSource, file);
    const destFile = path.join(assetsDest, file);
    
    if (fs.statSync(sourceFile).isFile()) {
      fs.copyFileSync(sourceFile, destFile);
      filesCopied++;
      
      if (file === 'BM SECURITY LOGO.jpg') {
        console.log(`   ✓ ✓✓✓ Copied LOGO: ${file}`);
      } else {
        console.log(`   ✓ Copied: ${file}`);
      }
    }
  });
  
  console.log(`   ✓ Copied assets folder with ${filesCopied} file(s)`);
  
  // Verify logo was copied
  const copiedLogoPath = path.join(assetsDest, 'BM SECURITY LOGO.jpg');
  if (fs.existsSync(copiedLogoPath)) {
    const stats = fs.statSync(copiedLogoPath);
    const sizeKB = (stats.size / 1024).toFixed(1);
    console.log(`   ✅ Logo verified (${sizeKB} KB)`);
  } else {
    console.warn('   ⚠️  Logo not found after copying');
  }
} else {
  console.warn('   ⚠️  Assets folder not found at:', assetsSource);
}
console.log();

// Step 5: Create START.bat launcher
const startBat = `@echo off
title BM Security Guard Report System
color 0A
cls

echo ========================================================
echo   BM SECURITY GUARD REPORT SYSTEM
echo ========================================================
echo.
echo [*] Starting server...
echo [*] Web Interface: http://localhost:5000
echo [*] API Endpoint: http://localhost:5000/api
echo [*] Health Check: http://localhost:5000/api/health
echo.
echo [*] Press Ctrl+C to stop server
echo.

REM Check if logo exists
if exist "assets\\BM SECURITY LOGO.jpg" (
  echo [*] Logo found: assets\\BM SECURITY LOGO.jpg
) else (
  echo [*] Logo NOT found in assets folder
)

REM Start the server
${EXE_NAME}

REM Handle errors
if errorlevel 1 (
    echo.
    echo ========================================
    echo   SERVER STOPPED OR CRASHED
    echo ========================================
    echo.
    echo Common issues:
    echo   1. Port 5000 already in use
    echo   2. Database connection failed
    echo   3. BM Security API credentials invalid
    echo.
    echo Check error messages above for details.
    echo.
    pause
)
`;

fs.writeFileSync(path.join(RELEASE_DIR, 'START.bat'), startBat);
console.log('   ✓ Created START.bat with logo check\n');

// Step 6: Create QUICK_START.txt
const quickStart = `BM SECURITY GUARD REPORT SYSTEM - QUICK START
===============================================

STEP 1: EXTRACT FILES
---------------------
Extract all files to: C:\\BMSecurity\\Reports\\
Keep all files together in the same folder.

IMPORTANT: DO NOT DELETE OR MOVE ANY FILES!
- guard-report-server.exe (main program)
- START.bat (launcher)
- .env (configuration with credentials)
- assets/ folder (contains logo)
- data/ folder (clients data)

STEP 2: RUN APPLICATION
-----------------------
Double-click: START.bat

The application will:
✓ Start automatically
✓ Open your browser to http://localhost:5000
✓ Include BM Security logo in PDF reports
✓ All settings are pre-configured

STEP 3: VERIFY
--------------
- Browser should open automatically
- If not, manually visit: http://localhost:5000
- Check health at: http://localhost:5000/api/health
- Check logo at: assets/BM SECURITY LOGO.jpg exists

TROUBLESHOOTING
---------------
✗ Port 5000 in use?
  → Close other applications or restart computer

✗ Logo not appearing in PDF reports?
  → Ensure "assets/BM SECURITY LOGO.jpg" file exists
  → Keep all files in same folder

✗ Database connection failed?
  → Ensure SQL Server is running
  → Verify server is "localhost" or correct IP

✗ Can't access BM Security API?
  → Check internet connection
  → Verify credentials are correct in .env

✗ Emails not sending?
  → Check EMAIL_USER and EMAIL_PASS in .env
  → Ensure ENABLE_EMAIL_SENDING=true

IMPORTANT NOTES
---------------
- Database: localhost, _Datos database
- API URL: https://bmsecurity.ultrasecuritysolution.com
- Email: alerts@bmsecurity.com (Office 365)
- Timezone: Africa/Nairobi
- Logo: assets/BM SECURITY LOGO.jpg
- All credentials are pre-configured

LOGO LOCATIONS CHECKED BY THE SYSTEM:
-------------------------------------
1. assets/BM SECURITY LOGO.jpg (primary)
2. server/assets/BM SECURITY LOGO.jpg
3. ./assets/BM SECURITY LOGO.jpg
4. process.cwd()/assets/BM SECURITY LOGO.jpg

SUPPORT
-------
For issues, contact your system administrator.

Version: 3.0.0
Build Date: ${new Date().toISOString().split('T')[0]}
`;

fs.writeFileSync(path.join(RELEASE_DIR, 'QUICK_START.txt'), quickStart);
console.log('   ✓ Created QUICK_START.txt with logo info\n');

// Step 7: Display build summary
const exePath = path.join(RELEASE_DIR, EXE_NAME);
if (fs.existsSync(exePath)) {
  const stats = fs.statSync(exePath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  
  console.log('═'.repeat(70));
  console.log('✅ BUILD COMPLETE!');
  console.log('═'.repeat(70));
  console.log(`\n📦 Release Location: ${RELEASE_DIR}`);
  console.log(`\n📋 Files Created:`);
  console.log(`   ✓ ${EXE_NAME} (${sizeMB} MB)`);
  console.log(`   ✓ START.bat (auto-launcher)`);
  console.log(`   ✓ .env (production credentials included)`);
  console.log(`   ✓ .env.example (backup reference)`);
  console.log(`   ✓ assets/ folder with logo`);  // Highlighted
  console.log(`   ✓ data/clients.json`);
  console.log(`   ✓ QUICK_START.txt`);
  
  console.log(`\n🎯 Ready for Distribution:`);
  console.log(`   The release folder contains EVERYTHING needed.`);
  console.log(`   ✅ Logo included: assets/BM SECURITY LOGO.jpg`);
  
  console.log(`\n📦 To Distribute:`);
  console.log(`   1. ZIP the entire release folder`);
  console.log(`   2. Name it: BMSecurity-Reports-v3.0.zip`);
  console.log(`   3. Users just extract and run START.bat`);
  
  console.log(`\n👥 User Instructions (Very Simple):`);
  console.log(`   1. Extract ZIP anywhere (e.g., C:\\BMSecurity\\Reports)`);
  console.log(`   2. Double-click START.bat`);
  console.log(`   3. Browser opens automatically to http://localhost:5000`);
  console.log(`   4. Logo appears in PDF reports ✅`);
  console.log(`   5. Everything just works! ✨`);
  
  console.log(`\n⚠️  Security Note:`);
  console.log(`   • .env file contains production credentials`);
  console.log(`   • Only share with authorized users`);
  console.log(`   • Keep the ZIP file secure`);
  
  console.log(`\n✅ Pre-Configured Settings:`);
  console.log(`   • Database: localhost, _Datos`);
  console.log(`   • BM Security API: Full credentials included`);
  console.log(`   • Email: alerts@bmsecurity.com configured`);
  console.log(`   • Logo: assets/BM SECURITY LOGO.jpg included`);
  console.log(`   • Timezone: Africa/Nairobi`);
  console.log(`   • Scheduler: 5-minute intervals`);
  
  console.log('\n═'.repeat(70) + '\n');
  
  // Create a deployment checklist
  const checklist = `DEPLOYMENT CHECKLIST
===================

Before distributing:
☐ Test the executable on a clean machine
☐ Verify database connection works
☐ Test BM Security API login
☐ Send a test email
☐ Generate a PDF report with logo
☐ Check scheduler runs properly
☐ Verify browser auto-opens
☐ Confirm logo appears in PDFs: assets/BM SECURITY LOGO.jpg

Ready to distribute:
☐ ZIP the release folder
☐ Name: BMSecurity-Reports-v3.0.zip
☐ Include QUICK_START.txt in email
☐ Provide support contact info

User Requirements:
☐ Windows 10/11 or Windows Server
☐ SQL Server accessible at "localhost"
☐ Internet connection (for BM Security API)
☐ Port 5000 available
☐ 2GB RAM minimum
☐ Keep ALL files together in same folder

Logo Verification:
☐ assets/BM SECURITY LOGO.jpg exists (must be exact filename)
☐ Logo appears in PDF reports
☐ Check PDF service can find the logo

Support Information:
☐ Include your email/phone for support
☐ Include BM Security support contact
☐ Mention this is pre-configured
☐ Provide logo troubleshooting: Check assets folder

Credentials Included:
✓ Database: sa / Password12$
✓ BM API: admindss@softguard.com
✓ Email: alerts@bmsecurity.com
✓ Logo: assets/BM SECURITY LOGO.jpg
✓ All settings in .env
`;
  
  fs.writeFileSync(path.join(RELEASE_DIR, 'DEPLOYMENT_CHECKLIST.txt'), checklist);
  console.log('📋 Created DEPLOYMENT_CHECKLIST.txt\n');
  
} else {
  console.error('❌ Executable was not created! Check errors above.\n');
  process.exit(1);
}