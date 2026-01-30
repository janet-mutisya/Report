// exe-wrapper.js - Fix for pkg module resolution
const { fileURLToPath } = require('url');
const { dirname, resolve } = require('path');
const { createRequire } = require('module');

// ES Module compatibility for pkg
const __filename = fileURLToPath(__filename);
const __dirname = dirname(__filename);
const require = createRequire(__filename);

// Fix for pkg's virtual filesystem
if (typeof process.pkg !== 'undefined') {
  // When running as pkg executable
  console.log('📦 Running as PKG executable');
  
  // Override __dirname for pkg
  const originalDirname = __dirname;
  const fixedDirname = resolve(process.execPath, '..');
  
  // Monkey-patch require for compatibility
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function(request, parent, isMain, options) {
    try {
      return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND') {
        // Try with fixed path
        const fixedRequest = request.replace('C:\\snapshot\\jmutisya\\Report\\server\\', fixedDirname + '\\');
        return originalResolveFilename.call(this, fixedRequest, parent, isMain, options);
      }
      throw err;
    }
  };
}

// Now import the main server
try {
  console.log('🚀 Loading Guard Report Server...');
  await import('./server.js');
} catch (error) {
  console.error('❌ Failed to start server:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}