const WebSocket = require('ws');

let wss = null;
const clients = new Set();

function init(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'hello', message: 'Connected to health monitor' }));

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  console.log(`[WebSocket] Server ready on /ws`);
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (err) {
        clients.delete(client);
      }
    }
  }
}

function notifyStatusChange(serviceId, status, summary) {
  broadcast({
    type: 'status_change',
    serviceId,
    status,
    summary,
    timestamp: new Date().toISOString()
  });
}

function notifyNewCheck(serviceId, result, summary) {
  broadcast({
    type: 'new_check',
    serviceId,
    result: {
      success: result.success,
      response_time_ms: result.response_time_ms,
      timestamp: result.timestamp,
      error_message: result.error_message,
      status_code: result.status_code,
      is_maintenance: result.is_maintenance
    },
    summary,
    timestamp: new Date().toISOString()
  });
}

function notifyMaintenanceChange(serviceId, maintenance) {
  broadcast({
    type: 'maintenance_change',
    serviceId,
    maintenance,
    timestamp: new Date().toISOString()
  });
}

function notifyServiceUpdate(serviceId, service) {
  broadcast({
    type: 'service_update',
    serviceId,
    service,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  init,
  broadcast,
  notifyStatusChange,
  notifyNewCheck,
  notifyMaintenanceChange,
  notifyServiceUpdate
};
