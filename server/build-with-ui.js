#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Building Guard Report Server with UI...\n');

// Configuration
const frontendPath = path.join(__dirname, '..', 'client', 'reports');
const serverPath = __dirname;
const distDestination = path.join(serverPath, 'dist');
const releasePath = path.join(serverPath, 'release');

// Step 1: Clean previous builds
console.log('🧹 Step 1: Cleaning previous builds...');
try {
  if (fs.existsSync(releasePath)) {
    fs.rmSync(releasePath, { recursive: true, force: true });
    console.log('   ✅ Cleaned release folder');
  }
  if (fs.existsSync(distDestination)) {
    fs.rmSync(distDestination, { recursive: true, force: true });
    console.log('   ✅ Cleaned dist folder');
  }
} catch (error) {
  console.error('   ⚠️ Warning: Could not clean all folders:', error.message);
}

// Step 2: Build frontend
console.log('\n📦 Step 2: Building frontend...');
try {
  process.chdir(frontendPath);
  console.log(`   Working directory: ${process.cwd()}`);
  
  execSync('pnpm build', { stdio: 'inherit' });
  console.log('   ✅ Frontend built successfully');
} catch (error) {
  console.error('   ❌ Frontend build failed:', error.message);
  process.exit(1);
}

// Step 3: Copy dist to server
console.log('\n📋 Step 3: Copying frontend to server...');
try {
  const frontendDist = path.join(frontendPath, 'dist');
  
  if (!fs.existsSync(frontendDist)) {
    throw new Error('Frontend dist folder not found');
  }
  
  // Create dist directory in server
  fs.mkdirSync(distDestination, { recursive: true });
  
  // Copy all files
  function copyRecursive(src, dest) {
    const stats = fs.statSync(src);
    
    if (stats.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      const entries = fs.readdirSync(src);
      
      for (const entry of entries) {
        copyRecursive(
          path.join(src, entry),
          path.join(dest, entry)
        );
      }
    } else {
      fs.copyFileSync(src, dest);
    }
  }
  
  copyRecursive(frontendDist, distDestination);
  
  // Verify copy
  const indexPath = path.join(distDestination, 'index.html');
  if (fs.existsSync(indexPath)) {
    console.log('   ✅ Frontend copied successfully');
    console.log(`   📂 Location: ${distDestination}`);
  } else {
    throw new Error('index.html not found after copy');
  }
} catch (error) {
  console.error('   ❌ Copy failed:', error.message);
  process.exit(1);
}

// Step 4: Update package.json to include dist
console.log('\n⚙️  Step 4: Updating PKG configuration...');
try {
  process.chdir(serverPath);
  
  const packageJsonPath = path.join(serverPath, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  // Ensure dist is in assets
  if (!packageJson.pkg.assets.includes('dist/**/*')) {
    packageJson.pkg.assets.push('dist/**/*');
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log('   ✅ Added dist/**/* to PKG assets');
  } else {
    console.log('   ✅ PKG already configured for dist');
  }
} catch (error) {
  console.error('   ⚠️ Warning: Could not update package.json:', error.message);
}

// Step 5: Build executable
console.log('\n🔨 Step 5: Building executable...');
try {
  process.chdir(serverPath);
  
  console.log('   Building Windows executable...');
  execSync('pkg . --targets node18-win-x64 --output release/guard-report-server.exe --compress GZip', { 
    stdio: 'inherit' 
  });
  
  console.log('   ✅ Executable built successfully');
} catch (error) {
  console.error('   ❌ Build failed:', error.message);
  process.exit(1);
}

// Step 6: Verify build
console.log('\n✅ Step 6: Verifying build...');
try {
  const exePath = path.join(releasePath, 'guard-report-server.exe');
  
  if (fs.existsSync(exePath)) {
    const stats = fs.statSync(exePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    
    console.log('   ✅ Build verification passed');
    console.log(`   📦 Executable: ${exePath}`);
    console.log(`   📊 Size: ${sizeMB} MB`);
  } else {
    throw new Error('Executable not found');
  }
} catch (error) {
  console.error('   ❌ Verification failed:', error.message);
  process.exit(1);
}

// Step 7: Create deployment package
console.log('\n📦 Step 7: Creating deployment package...');
try {
  const deploymentPath = path.join(serverPath, '..', 'deployment', 'windows');
  
  // Create deployment directory
  fs.mkdirSync(deploymentPath, { recursive: true });
  
  // Copy executable
  const exeSrc = path.join(releasePath, 'guard-report-server.exe');
  const exeDest = path.join(deploymentPath, 'guard-report-server.exe');
  fs.copyFileSync(exeSrc, exeDest);
  
  // Copy .env.example
  const envExample = path.join(serverPath, '.env.example');
  if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, path.join(deploymentPath, '.env'));
  }
  
const readme = `# Guard Report Server - Deployment Package

## Quick Start

1. **Configure the application:**
   - Open the .env file in a text editor
   - Update the database settings (DB_SERVER, DB_USER, DB_PASSWORD, etc.)
   - Set ENABLE_EMAIL_SENDING=true if you want email notifications
   - (Optional) Set REPORTS_OUTPUT_DIR to specify where PDFs are saved

2. **Run the server:**
   - Double-click guard-report-server.exe
   - Or run from command line: guard-report-server.exe

3. **Access the application:**
   - Open your browser and go to: http://localhost:5000
   - The UI is embedded in the executable

## PDF Report Storage

By default, PDF reports are saved to the system temporary directory:
- Windows: C:\\Users\\[Username]\\AppData\\Local\\Temp\\guard-reports\\

To save reports to a specific location:
- Set REPORTS_OUTPUT_DIR in .env file
- Example: REPORTS_OUTPUT_DIR=C:\\GuardReports
- Make sure the directory is writable by the user running the application

Old temporary files are automatically cleaned up after 24 hours.

## Important Notes

- The frontend UI is included in the executable
- Make sure port 5000 is available (or change PORT in .env)
- Keep the .env file in the same directory as the .exe
- For production, set NODE_ENV=production in .env
- PDF files are temporary and cleaned up automatically

## Troubleshooting

- **Port already in use:** Change PORT in .env file
- **Database connection fails:** Check DB settings in .env
- **Can't write reports:** Check REPORTS_OUTPUT_DIR permissions or leave blank to use temp
- **Can't access UI:** Make sure you're using http://localhost:5000

## Support

For issues, contact BM Security technical support.

---
Built on: ${new Date().toISOString()}
Version: 3.0.0
`;
  
  fs.writeFileSync(path.join(deploymentPath, 'README.txt'), readme);
  
  console.log('   ✅ Deployment package created');
  console.log(`   📂 Location: ${deploymentPath}`);
  console.log('\n   Package includes:');
  console.log('   - guard-report-server.exe (with embedded UI)');
  console.log('   - .env (configuration file)');
  console.log('   - README.txt (instructions)');
} catch (error) {
  console.error('   ⚠️ Warning: Could not create deployment package:', error.message);
}

console.log('\n' + '='.repeat(60));
console.log('🎉 BUILD COMPLETE!');
console.log('='.repeat(60));
console.log(`
📦 Executable: release/guard-report-server.exe
📂 Deployment: ../deployment/windows/
🚀 Ready to distribute!

To test locally:
  cd release
  .\\guard-report-server.exe

To deploy
  Copy the entire deployment/windows/ folder to the target machine
`);
