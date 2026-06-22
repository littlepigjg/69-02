const { checkService } = require('./checker')
const storage = require('./storage')
const status = require('./status')
const notifier = require('./notifier')
const alertManager = require('./alert-manager')
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

    try {
      const alertResult = await alertManager.processCheckResult(service, storedResult, summary)
      if (alertResult?.sent) {
        console.log(`[Scheduler] Alert sent for "${service.name}": ${alertResult.alertType} L${alertResult.alertLevel} via [${alertResult.channels?.join(',')}], recipients: [${alertResult.recipients?.join(', ')}]`)
      } else if (alertResult?.skipped) {
        if (alertResult.reason?.startsWith('failures_')) {
          // 正常积累失败次数，无需输出
        } else if (alertResult.reason === 'no_enabled_channels') {
          // 只在首次或间隔输出，避免刷屏
          if (!service._noChannelWarned) {
            console.log(`[Scheduler] Alert skipped for "${service.name}": no enabled channels. Configure channels in config.json alerts.channels.*.enabled`)
            service._noChannelWarned = true
          }
        } else if (alertResult.decision?.isEscalation) {
          console.log(`[Scheduler] Alert escalation would trigger for "${service.name}": L${alertResult.decision.alertLevel} (silenceUntil: ${alertResult.decision.inManualSilence ? 'manual' : 'no'})`)
        }
      } else if (alertResult?.error) {
        console.error(`[Scheduler] Alert processing error for "${service.name}":`, alertResult.error)
      }
    } catch (alertErr) {
      console.error(`[Scheduler] Alert processing error for ${service.name}:`, alertErr.message)
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
