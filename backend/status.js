const moment = require('moment');
const config = require('./config');
const storage = require('./storage');

function calculateAvailability(results) {
  if (!results || results.length === 0) return { availability: 0, avgResponseTime: 0, totalChecks: 0, successfulChecks: 0 };

  const effective = results.filter(r => !r.is_maintenance);
  if (effective.length === 0) return { availability: 0, avgResponseTime: 0, totalChecks: 0, successfulChecks: 0 };

  const successful = effective.filter(r => r.success);
  const availability = (successful.length / effective.length) * 100;

  const withRT = effective.filter(r => r.response_time_ms != null);
  const avgRT = withRT.length > 0
    ? withRT.reduce((sum, r) => sum + r.response_time_ms, 0) / withRT.length
    : 0;

  return {
    availability: Math.round(availability * 100) / 100,
    avgResponseTime: Math.round(avgRT),
    totalChecks: effective.length,
    successfulChecks: successful.length
  };
}

async function getTrendData(serviceId, hours = config.trendWindowHours) {
  const to = moment().toISOString();
  const from = moment().subtract(hours, 'hours').toISOString();
  const results = await storage.checkResults.getByTimeRange(serviceId, from, to);

  const slotMinutes = Math.max(5, Math.ceil((hours * 60) / 96));
  const slots = [];
  const slotData = new Map();

  let current = moment(from).startOf('minute');
  const end = moment(to).startOf('minute');

  while (current <= end) {
    const key = current.format('YYYY-MM-DD HH:mm');
    slots.push(key);
    slotData.set(key, []);
    current = current.add(slotMinutes, 'minutes');
  }

  for (const r of results) {
    const tm = moment(r.timestamp).startOf('minute');
    const slotStart = moment(from).startOf('minute');
    const diff = tm.diff(slotStart, 'minutes');
    const slotIndex = Math.floor(diff / slotMinutes);
    if (slotIndex >= 0 && slotIndex < slots.length) {
      slotData.get(slots[slotIndex]).push(r);
    }
  }

  return slots.map(slot => {
    const data = slotData.get(slot);
    const calc = calculateAvailability(data);
    return {
      timestamp: slot,
      availability: calc.availability,
      avgResponseTime: calc.avgResponseTime,
      checks: calc.totalChecks
    };
  });
}

async function getServiceStatus(serviceId) {
  const latest = await storage.checkResults.getLatest(serviceId, 1);
  if (!latest || latest.length === 0) {
    return {
      status: 'unknown',
      lastCheck: null,
      response_time_ms: null,
      error_message: null,
      in_maintenance: false
    };
  }

  const latestResult = latest[0];
  const active = await storage.maintenance.getActive(serviceId);
  const inMaintenance = active.length > 0;

  let status;
  if (inMaintenance) {
    status = 'maintenance';
  } else if (latestResult.success) {
    status = 'up';
  } else {
    status = 'down';
  }

  return {
    status,
    lastCheck: latestResult.timestamp,
    response_time_ms: latestResult.response_time_ms,
    error_message: latestResult.error_message,
    in_maintenance: inMaintenance,
    status_code: latestResult.status_code
  };
}

async function getServiceSummary(serviceId, hours = config.trendWindowHours) {
  const to = moment().toISOString();
  const from = moment().subtract(hours, 'hours').toISOString();
  const results = await storage.checkResults.getByTimeRange(serviceId, from, to);
  const stats = calculateAvailability(results);
  const status = await getServiceStatus(serviceId);

  return {
    ...status,
    availability: stats.availability,
    avgResponseTime: stats.avgResponseTime,
    totalChecks: stats.totalChecks,
    successfulChecks: stats.successfulChecks,
    trendHours: hours
  };
}

module.exports = {
  calculateAvailability,
  getTrendData,
  getServiceStatus,
  getServiceSummary
};
