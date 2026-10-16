'use strict';
// Minimal file logger: <userData>/logs/main.log, rotated to main.old.log at 1 MB.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;

function createLogger(dir) {
  const file = path.join(dir, 'logs', 'main.log');
  return function log(level, message) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file.replace(/main\.log$/, 'main.old.log'));
      fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${message}\n`);
    } catch { /* logging must never crash the app */ }
  };
}

module.exports = { createLogger };
