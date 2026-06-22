const config = require('./config.json');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
const logDir = path.join(dataDir, 'logs');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

module.exports = {
  ...config,
  dbPath: path.resolve(config.dbPath),
  logDir: path.resolve(config.logDir)
};
