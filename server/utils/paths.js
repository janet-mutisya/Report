// server/utils/paths.js
const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * Get a writable directory for temporary files
 * Works in both development and packaged (PKG) environments
 */
function getWritableDirectory(subFolder = 'guard-reports') {
  // Check if custom directory is specified in environment
  const customDir = process.env.REPORTS_OUTPUT_DIR;
  
  if (customDir && customDir.trim() !== '') {
    // Use custom directory from .env
    const fullPath = path.resolve(customDir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    return fullPath;
  }
  
  // Use system temp directory
  const tempDir = os.tmpdir();
  const appTempDir = path.join(tempDir, subFolder);
  
  if (!fs.existsSync(appTempDir)) {
    fs.mkdirSync(appTempDir, { recursive: true });
  }
  
  return appTempDir;
}

/**
 * Get path for a temporary PDF file
 */
function getTempPdfPath(filename) {
  const dir = getWritableDirectory('guard-reports');
  const timestamp = Date.now();
  const safeName = filename.replace(/[^a-z0-9_-]/gi, '_');
  return path.join(dir, `${safeName}_${timestamp}.pdf`);
}

/**
 * Clean up old temporary files (older than specified hours)
 */
function cleanupOldTempFiles(hoursOld = 24) {
  try {
    const dir = getWritableDirectory('guard-reports');
    
    // Check if directory exists
    if (!fs.existsSync(dir)) {
      return;
    }
    
    const files = fs.readdirSync(dir);
    const now = Date.now();
    const maxAge = hoursOld * 60 * 60 * 1000;
    
    let cleaned = 0;
    files.forEach(file => {
      try {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch (error) {
        // Skip files that can't be accessed
        console.warn(`Could not clean up file ${file}:`, error.message);
      }
    });
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} old temp PDF file(s)`);
    }
  } catch (error) {
    console.warn('Temp file cleanup warning:', error.message);
  }
}

module.exports = {
  getWritableDirectory,
  getTempPdfPath,
  cleanupOldTempFiles
};
