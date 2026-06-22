const { checkService } = require('./checker')
const storage = require('./storage')
const status = require('./status')
const notifier = require('./notifier')
const { DEFAULT_CONFIG } = require('./constants')
const { clamp } = require('./utils')

const serviceTimers = new Map()
const lastStatuses = new Map()

function getInterval(service) {
  const seconds = clamp(
    Number(service.interval_seconds) || DEFAULT_CONFIG.DEFAULT_INTERVAL_SECONDS,
    DEFAULT_CONFIG.MIN_INTERVAL_SECONDS,
    86400
  )
  return seconds * 1000
}

async function runCheck(service) {
  const timestamp = new Date().toISOString()

  let isMaintenance = false
  try {
    const active = await storage.maintenance.getActive(service.id, timestamp)
    isMaintenance = active.length > 0
  } catch (e) {
    console.error(`[Scheduler] Maintenance check error for #${service.id}:`, e.message)
  }

  const rawResult = await checkService(service)

  const storedResult = {
    service_id: service.id,
    timestamp,
    success: isMaintenance ? 1 : (rawResult.success ? 1 : 0),
    response_time_ms: rawResult.response_time_ms ?? null,
    error_message: isMaintenance ? null : (rawResult.error_message || null),
    status_code: rawResult.status_code ?? null,
    is_maintenance: isMaintenance ? 1 : 0
  }

  try {
    await storage.checkResults.insert(storedResult)
  } catch (e) {
    console.error(`[Scheduler] DB insert error for ${service.name}:`, e.message)
  }

  try {
    const summary = await status.getServiceSummary(service.id)
    notifier.notifyNewCheck(service.id, storedResult, summary)

    const previous = lastStatuses.get(service.id)
    if (previous !== summary.status) {
      lastStatuses.set(service.id, summary.status)
      if (previous !== undefined) {
        notifier.notifyStatusChange(service.id, summary.status, summary)
      }
    }
  } catch (e) {
    console.error(`[Scheduler] Summary calc error for ${service.name}:`, e.message)
  }
}

function startServiceCheck(service) {
  stopServiceCheck(service.id)

  if (!service.enabled) return

  const interval = getInterval(service)

  runCheck(service).catch(err => {
    console.error(`[Scheduler] Initial check error for ${service.name}:`, err.message)
  })

  const timer = setInterval(() => {
    runCheck(service).catch(err => {
      console.error(`[Scheduler] Check error for ${service.name}:`, err.message)
    })
  }, interval)

  serviceTimers.set(service.id, { timer, interval, service })
  console.log(`[Scheduler] Started monitoring "${service.name}" every ${interval / 1000}s`)
}

function stopServiceCheck(serviceId) {
  const existing = serviceTimers.get(serviceId)
  if (existing) {
    clearInterval(existing.timer)
    serviceTimers.delete(serviceId)
    lastStatuses.delete(serviceId)
    console.log(`[Scheduler] Stopped monitoring service #${serviceId}`)
  }
}

function restartServiceCheck(service) {
  stopServiceCheck(service.id)
  startServiceCheck(service)
}

async function startAll() {
  let allServices = []
  try {
    allServices = await storage.services.getAll()
  } catch (e) {
    console.error('[Scheduler] Failed to load services:', e.message)
    return
  }
  for (const svc of allServices) {
    if (svc.enabled) {
      startServiceCheck(svc)
    }
  }
  console.log(`[Scheduler] Started ${allServices.filter(s => s.enabled).length}/${allServices.length} service monitors`)
}

function stopAll() {
  for (const id of [...serviceTimers.keys()]) {
    stopServiceCheck(id)
  }
}

function reloadAll() {
  stopAll()
  startAll()
}

function isMonitoring(serviceId) {
  return serviceTimers.has(serviceId)
}

function listMonitoredIds() {
  return [...serviceTimers.keys()]
}

module.exports = {
  startAll,
  stopAll,
  reloadAll,
  startServiceCheck,
  stopServiceCheck,
  restartServiceCheck,
  isMonitoring,
  listMonitoredIds,
  runCheck,
  getInterval
}
