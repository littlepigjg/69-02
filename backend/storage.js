const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const config = require('./config');

let db = null;
let SQL = null;
let dirty = false;

function saveDB() {
  if (!db || !dirty) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    const tmpPath = config.dbPath + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, config.dbPath);
    dirty = false;
  } catch (e) {
    console.error('[Storage] Save DB error:', e.message);
  }
}

setInterval(saveDB, 5000);

async function initDB() {
  SQL = await initSqlJs();

  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  if (fs.existsSync(config.dbPath)) {
    try {
      const buf = fs.readFileSync(config.dbPath);
      db = new SQL.Database(buf);
      console.log('[Storage] Loaded existing database');
    } catch (e) {
      console.warn('[Storage] Failed to load DB, creating new one:', e.message);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('http', 'https', 'tcp')),
      target TEXT NOT NULL,
      port INTEGER,
      method TEXT DEFAULT 'GET',
      expectedStatus INTEGER DEFAULT 200,
      interval_seconds INTEGER DEFAULT 30,
      timeout_ms INTEGER DEFAULT 5000,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  dirty = true;

  db.run(`
    CREATE TABLE IF NOT EXISTS check_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      success INTEGER NOT NULL,
      response_time_ms INTEGER,
      error_message TEXT,
      status_code INTEGER,
      is_maintenance INTEGER DEFAULT 0
    )
  `);
  dirty = true;

  db.run(`
    CREATE TABLE IF NOT EXISTS maintenance_windows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      description TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  dirty = true;

  db.run(`
    CREATE TABLE IF NOT EXISTS alert_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL,
      alert_type TEXT NOT NULL CHECK(alert_type IN ('down', 'escalation', 'recovery', 'test')),
      alert_level INTEGER DEFAULT 0,
      channels TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      failure_count INTEGER DEFAULT 0,
      error_message TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'partial', 'failed')),
      sent_channels TEXT,
      failed_channels TEXT,
      error_details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      sent_at TEXT
    )
  `);
  dirty = true;

  db.run(`
    CREATE TABLE IF NOT EXISTS alert_states (
      service_id INTEGER PRIMARY KEY,
      current_status TEXT NOT NULL DEFAULT 'up',
      consecutive_failures INTEGER DEFAULT 0,
      first_failure_time TEXT,
      last_failure_time TEXT,
      last_alert_time TEXT,
      last_alert_level INTEGER DEFAULT 0,
      last_sent_alert_id INTEGER,
      silence_until TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  dirty = true;

  db.run(`
    CREATE TABLE IF NOT EXISTS alert_config_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      silence_minutes INTEGER,
      consecutive_failures INTEGER,
      escalation_threshold INTEGER,
      escalation_level INTEGER,
      enable_email INTEGER,
      enable_wechat INTEGER,
      enable_dingtalk INTEGER,
      custom_recipients_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  dirty = true;

  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_results_service_time ON check_results(service_id, timestamp)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_maintenance_time ON maintenance_windows(start_time, end_time)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_alert_records_service ON alert_records(service_id, created_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_alert_records_type ON alert_records(alert_type, created_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_alert_states_status ON alert_states(current_status)');
    dirty = true;
  } catch (e) {}

  await cleanupOldData();
  saveDB();
}

async function cleanupOldData() {
  const cutoff = moment().subtract(config.dataRetentionDays, 'days').toISOString();
  db.run('DELETE FROM check_results WHERE timestamp < ?', [cutoff]);
  dirty = true;
  saveDB();
}

function appendLog(serviceId, result) {
  try {
    const logFile = path.join(config.logDir, `service-${serviceId}-${moment().format('YYYY-MM-DD')}.log`);
    const line = JSON.stringify({
      ts: result.timestamp,
      success: result.success ? 1 : 0,
      rt: result.response_time_ms,
      msg: result.error_message || '',
      status: result.status_code || '',
      maint: result.is_maintenance ? 1 : 0
    }) + '\n';
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (e) {
    console.error('[Storage] Log append error:', e.message);
  }
}

function run(sql, params = []) {
  db.run(sql, params);
  dirty = true;
  return { lastID: db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0], changes: null };
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const rows = query(sql, params);
  return rows.length ? rows[0] : undefined;
}

const services = {
  getAll: async () => query('SELECT * FROM services ORDER BY name'),
  getById: async (id) => queryOne('SELECT * FROM services WHERE id = ?', [id]),
  create: async (data) => {
    const payload = {
      method: 'GET',
      expectedStatus: 200,
      interval_seconds: config.defaultCheckIntervalSeconds,
      timeout_ms: config.defaultTimeoutMs,
      enabled: 1,
      port: null,
      ...data
    };
    const res = run(
      `INSERT INTO services (name, type, target, port, method, expectedStatus, interval_seconds, timeout_ms, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [payload.name, payload.type, payload.target, payload.port, payload.method, payload.expectedStatus, payload.interval_seconds, payload.timeout_ms, payload.enabled]
    );
    saveDB();
    return queryOne('SELECT * FROM services WHERE id = ?', [res.lastID]);
  },
  update: async (id, data) => {
    const keys = Object.keys(data);
    if (keys.length === 0) return queryOne('SELECT * FROM services WHERE id = ?', [id]);
    const sets = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k]);
    run(`UPDATE services SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, id]);
    saveDB();
    return queryOne('SELECT * FROM services WHERE id = ?', [id]);
  },
  remove: async (id) => {
    run('DELETE FROM services WHERE id = ?', [id]);
    run('DELETE FROM check_results WHERE service_id = ?', [id]);
    run('DELETE FROM maintenance_windows WHERE service_id = ?', [id]);
    saveDB();
    return { changes: 1 };
  }
};

const checkResults = {
  insert: async (result) => {
    const res = run(
      `INSERT INTO check_results (service_id, timestamp, success, response_time_ms, error_message, status_code, is_maintenance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [result.service_id, result.timestamp, result.success, result.response_time_ms, result.error_message, result.status_code, result.is_maintenance]
    );
    appendLog(result.service_id, result);
    if (process.memoryUsage().heapUsed > 512 * 1024 * 1024) saveDB();
    return res;
  },
  getLatest: async (serviceId, limit = 1) =>
    query('SELECT * FROM check_results WHERE service_id = ? ORDER BY timestamp DESC LIMIT ?', [serviceId, limit]),
  getByTimeRange: async (serviceId, from, to) =>
    query('SELECT * FROM check_results WHERE service_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC', [serviceId, from, to])
};

const maintenance = {
  getAll: async (serviceId = null) => {
    if (serviceId !== null && serviceId !== undefined) {
      return query('SELECT * FROM maintenance_windows WHERE service_id = ? ORDER BY start_time DESC', [serviceId]);
    }
    return query('SELECT * FROM maintenance_windows ORDER BY start_time DESC');
  },
  getActive: async (serviceId, time = new Date().toISOString()) =>
    query(`SELECT * FROM maintenance_windows WHERE (service_id = ? OR service_id IS NULL)
           AND active = 1 AND start_time <= ? AND end_time >= ?`, [serviceId, time, time]),
  create: async (data) => {
    const payload = { active: 1, description: '', service_id: null, ...data };
    const res = run(
      `INSERT INTO maintenance_windows (service_id, name, start_time, end_time, description, active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [payload.service_id, payload.name, payload.start_time, payload.end_time, payload.description, payload.active]
    );
    saveDB();
    return queryOne('SELECT * FROM maintenance_windows WHERE id = ?', [res.lastID]);
  },
  update: async (id, data) => {
    const keys = Object.keys(data);
    if (keys.length === 0) return queryOne('SELECT * FROM maintenance_windows WHERE id = ?', [id]);
    const sets = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k]);
    run(`UPDATE maintenance_windows SET ${sets} WHERE id = ?`, [...values, id]);
    saveDB();
    return queryOne('SELECT * FROM maintenance_windows WHERE id = ?', [id]);
  },
  remove: async (id) => {
    run('DELETE FROM maintenance_windows WHERE id = ?', [id]);
    saveDB();
    return { changes: 1 };
  }
};

const alertRecords = {
  create: async (data) => {
    const payload = {
      alert_level: 0,
      failure_count: 0,
      error_message: null,
      status: 'pending',
      sent_channels: null,
      failed_channels: null,
      error_details: null,
      sent_at: null,
      ...data,
      channels: JSON.stringify(data.channels || [])
    };
    const res = run(
      `INSERT INTO alert_records (service_id, alert_type, alert_level, channels, title, content,
        failure_count, error_message, status, sent_channels, failed_channels, error_details, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [payload.service_id, payload.alert_type, payload.alert_level, payload.channels,
        payload.title, payload.content, payload.failure_count, payload.error_message,
        payload.status,
        payload.sent_channels ? JSON.stringify(payload.sent_channels) : null,
        payload.failed_channels ? JSON.stringify(payload.failed_channels) : null,
        payload.error_details, payload.sent_at]
    );
    saveDB();
    return queryOne('SELECT * FROM alert_records WHERE id = ?', [res.lastID]);
  },
  update: async (id, data) => {
    const keys = Object.keys(data);
    if (keys.length === 0) return queryOne('SELECT * FROM alert_records WHERE id = ?', [id]);
    const sets = keys.map(k => {
      if (k === 'channels' || k === 'sent_channels' || k === 'failed_channels') {
        return `${k} = ?`;
      }
      return `${k} = ?`;
    }).join(', ');
    const values = keys.map(k => {
      if (k === 'channels' || k === 'sent_channels' || k === 'failed_channels') {
        return data[k] ? JSON.stringify(data[k]) : null;
      }
      return data[k];
    });
    run(`UPDATE alert_records SET ${sets} WHERE id = ?`, [...values, id]);
    saveDB();
    return queryOne('SELECT * FROM alert_records WHERE id = ?', [id]);
  },
  markSent: async (id, sentChannels = [], failedChannels = [], errorDetails = null) => {
    const status = sentChannels.length > 0 && failedChannels.length === 0
      ? 'sent'
      : sentChannels.length > 0
        ? 'partial'
        : 'failed';
    return alertRecords.update(id, {
      status,
      sent_channels: sentChannels,
      failed_channels: failedChannels,
      error_details: errorDetails,
      sent_at: new Date().toISOString()
    });
  },
  getById: async (id) => queryOne('SELECT * FROM alert_records WHERE id = ?', [id]),
  getByService: async (serviceId, limit = 50) =>
    query('SELECT * FROM alert_records WHERE service_id = ? ORDER BY created_at DESC LIMIT ?', [serviceId, limit]),
  getByType: async (alertType, limit = 50) =>
    query('SELECT * FROM alert_records WHERE alert_type = ? ORDER BY created_at DESC LIMIT ?', [alertType, limit]),
  getAll: async (limit = 100, offset = 0) =>
    query('SELECT * FROM alert_records ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]),
  getByTimeRange: async (from, to, serviceId = null) => {
    if (serviceId !== null && serviceId !== undefined) {
      return query('SELECT * FROM alert_records WHERE service_id = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC',
        [serviceId, from, to]);
    }
    return query('SELECT * FROM alert_records WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC',
      [from, to]);
  },
  getStats: async (days = 7) => {
    const cutoff = moment().subtract(days, 'days').toISOString();
    const byType = query(`SELECT alert_type, COUNT(*) as count, status
                          FROM alert_records WHERE created_at >= ?
                          GROUP BY alert_type, status`, [cutoff]);
    const byChannel = query(`SELECT alert_type, COUNT(*) as count
                             FROM alert_records WHERE created_at >= ?
                             GROUP BY alert_type`, [cutoff]);
    const total = queryOne('SELECT COUNT(*) as total FROM alert_records WHERE created_at >= ?', [cutoff]);
    return { byType, byChannel, total: total?.total || 0, days };
  }
};

const alertStates = {
  getByService: async (serviceId) => queryOne('SELECT * FROM alert_states WHERE service_id = ?', [serviceId]),
  getAll: async () => query('SELECT * FROM alert_states'),
  getAllDown: async () => query('SELECT * FROM alert_states WHERE current_status = ?', ['down']),
  upsert: async (serviceId, data) => {
    const existing = await alertStates.getByService(serviceId);
    const now = new Date().toISOString();
    if (!existing) {
      const payload = {
        current_status: 'up',
        consecutive_failures: 0,
        first_failure_time: null,
        last_failure_time: null,
        last_alert_time: null,
        last_alert_level: 0,
        last_sent_alert_id: null,
        silence_until: null,
        ...data
      };
      run(
        `INSERT INTO alert_states (service_id, current_status, consecutive_failures, first_failure_time,
          last_failure_time, last_alert_time, last_alert_level, last_sent_alert_id, silence_until, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [serviceId, payload.current_status, payload.consecutive_failures,
          payload.first_failure_time, payload.last_failure_time,
          payload.last_alert_time, payload.last_alert_level, payload.last_sent_alert_id,
          payload.silence_until, now]
      );
    } else {
      const sets = Object.keys(data).map(k => `${k} = ?`).join(', ');
      const values = Object.values(data);
      run(`UPDATE alert_states SET ${sets}, updated_at = ? WHERE service_id = ?`,
        [...values, now, serviceId]);
    }
    saveDB();
    return alertStates.getByService(serviceId);
  },
  recordFailure: async (serviceId, timestamp) => {
    const existing = await alertStates.getByService(serviceId);
    if (!existing) {
      return alertStates.upsert(serviceId, {
        current_status: 'down',
        consecutive_failures: 1,
        first_failure_time: timestamp,
        last_failure_time: timestamp
      });
    }
    const newCount = (existing.consecutive_failures || 0) + 1;
    return alertStates.upsert(serviceId, {
      current_status: 'down',
      consecutive_failures: newCount,
      first_failure_time: existing.first_failure_time || timestamp,
      last_failure_time: timestamp
    });
  },
  recordSuccess: async (serviceId) => {
    return alertStates.upsert(serviceId, {
      current_status: 'up',
      consecutive_failures: 0,
      first_failure_time: null,
      last_failure_time: null,
      last_alert_level: 0,
      silence_until: null
    });
  },
  updateAlertSent: async (serviceId, alertTime, alertLevel, alertId) => {
    return alertStates.upsert(serviceId, {
      last_alert_time: alertTime,
      last_alert_level: alertLevel,
      last_sent_alert_id: alertId
    });
  },
  setSilence: async (serviceId, silenceUntilISO) => {
    return alertStates.upsert(serviceId, { silence_until: silenceUntilISO });
  },
  remove: async (serviceId) => {
    run('DELETE FROM alert_states WHERE service_id = ?', [serviceId]);
    saveDB();
    return { changes: 1 };
  }
};

const alertConfigOverrides = {
  getByService: async (serviceId) => queryOne('SELECT * FROM alert_config_overrides WHERE service_id = ?', [serviceId]),
  getAll: async () => query('SELECT * FROM alert_config_overrides'),
  create: async (data) => {
    const payload = {
      silence_minutes: null,
      consecutive_failures: null,
      escalation_threshold: null,
      escalation_level: null,
      enable_email: null,
      enable_wechat: null,
      enable_dingtalk: null,
      custom_recipients_json: null,
      ...data
    };
    const res = run(
      `INSERT INTO alert_config_overrides (service_id, silence_minutes, consecutive_failures,
        escalation_threshold, escalation_level, enable_email, enable_wechat, enable_dingtalk, custom_recipients_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [payload.service_id, payload.silence_minutes, payload.consecutive_failures,
        payload.escalation_threshold, payload.escalation_level,
        payload.enable_email, payload.enable_wechat, payload.enable_dingtalk,
        payload.custom_recipients_json ? JSON.stringify(payload.custom_recipients_json) : null]
    );
    saveDB();
    return queryOne('SELECT * FROM alert_config_overrides WHERE id = ?', [res.lastID]);
  },
  update: async (id, data) => {
    const keys = Object.keys(data);
    if (keys.length === 0) return queryOne('SELECT * FROM alert_config_overrides WHERE id = ?', [id]);
    const sets = keys.map(k => {
      if (k === 'custom_recipients_json') return `${k} = ?`;
      return `${k} = ?`;
    }).join(', ');
    const values = keys.map(k => {
      if (k === 'custom_recipients_json') return data[k] ? JSON.stringify(data[k]) : null;
      return data[k];
    });
    run(`UPDATE alert_config_overrides SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, id]);
    saveDB();
    return queryOne('SELECT * FROM alert_config_overrides WHERE id = ?', [id]);
  },
  upsertByService: async (serviceId, data) => {
    const existing = await alertConfigOverrides.getByService(serviceId);
    if (existing) {
      return alertConfigOverrides.update(existing.id, data);
    }
    return alertConfigOverrides.create({ service_id: serviceId, ...data });
  },
  remove: async (id) => {
    run('DELETE FROM alert_config_overrides WHERE id = ?', [id]);
    saveDB();
    return { changes: 1 };
  },
  removeByService: async (serviceId) => {
    run('DELETE FROM alert_config_overrides WHERE service_id = ?', [serviceId]);
    saveDB();
    return { changes: 1 };
  }
};

process.on('beforeExit', saveDB);
process.on('SIGINT', () => { saveDB(); process.exit(0); });
process.on('SIGTERM', () => { saveDB(); process.exit(0); });

module.exports = {
  initDB,
  cleanupOldData,
  services,
  checkResults,
  maintenance,
  alertRecords,
  alertStates,
  alertConfigOverrides
};
