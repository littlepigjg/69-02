const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const storage = require('./storage');
const scheduler = require('./scheduler');
const notifier = require('./notifier');
const routes = require('./routes');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);

const frontendDir = path.join(__dirname, '..', 'frontend', 'dist');
try {
  const fs = require('fs');
  if (fs.existsSync(frontendDir)) {
    app.use(express.static(frontendDir));
    app.get(/^\/(?!api|ws).*/, (req, res) => {
      res.sendFile(path.join(frontendDir, 'index.html'));
    });
  }
} catch (e) {}

app.use((err, req, res, next) => {
  console.error('[Server] Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  await storage.initDB();
  console.log(`[Storage] Database initialized at ${config.dbPath}`);
  console.log(`[Storage] Logs directory: ${config.logDir}`);

  notifier.init(server);
  await scheduler.startAll();

  setInterval(() => {
    storage.cleanupOldData().catch(e => console.error('[Server] Cleanup error:', e.message));
  }, 60 * 60 * 1000);

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`  服务健康监控系统已启动`);
    console.log(`  后端 API: http://0.0.0.0:${config.port}/api`);
    console.log(`  WebSocket: ws://0.0.0.0:${config.port}/ws`);
    console.log(`  状态页面: http://0.0.0.0:${config.port}/`);
    console.log(`  管理页面: http://0.0.0.0:${config.port}/admin`);
    console.log(`========================================\n`);
  });
}

function shutdown(signal) {
  console.log(`\n[Server] Received ${signal}, shutting down...`);
  scheduler.stopAll();
  server.close(() => {
    console.log('[Server] Shutdown complete');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[Server] Forced shutdown');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(err => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
