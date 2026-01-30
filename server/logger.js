// logger.js - Professional logging utility with environment-based control
const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.isDev = process.env.NODE_ENV !== 'production';
    this.logToFile = process.env.LOG_TO_FILE === 'true';
    this.logFilePath = process.env.LOG_FILE_PATH || 'app.log';
    
    // Log levels (higher number = more verbose)
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
  }

  shouldLog(level) {
    const currentLevel = this.levels[this.logLevel] || 2;
    const messageLevel = this.levels[level] || 2;
    return messageLevel <= currentLevel;
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] ${level.toUpperCase()}:`;
    
    if (data) {
      return `${prefix} ${message}\n${JSON.stringify(data, null, 2)}`;
    }
    return `${prefix} ${message}`;
  }

  writeToFile(message) {
    if (!this.logToFile) return;
    
    try {
      fs.appendFileSync(this.logFilePath, message + '\n');
    } catch (error) {
      // Silent fail to avoid recursive logging
    }
  }

  log(level, message, data = null) {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(level, message, data);
    
    // Write to file if enabled
    this.writeToFile(formattedMessage);
    
    // Console output
    switch (level) {
      case 'error':
        console.error(formattedMessage);
        break;
      case 'warn':
        console.warn(formattedMessage);
        break;
      default:
        console.log(formattedMessage);
    }
  }

  error(message, data = null) {
    this.log('error', message, data);
  }

  warn(message, data = null) {
    this.log('warn', message, data);
  }

  info(message, data = null) {
    this.log('info', message, data);
  }

  debug(message, data = null) {
    this.log('debug', message, data);
  }

  trace(message, data = null) {
    this.log('trace', message, data);
  }

  // Special method for startup banner
  banner(lines) {
    if (this.shouldLog('info')) {
      console.log('\n' + lines.join('\n') + '\n');
    }
  }

  // Clean console (for production startup)
  clearConsole() {
    if (!this.isDev && process.stdout.isTTY) {
      console.clear();
    }
  }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger;