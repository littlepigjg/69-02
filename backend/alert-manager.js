const moment = require('moment')
const config = require('./config')
const storage = require('./storage')
const notifier = require('./notifier')
const { buildVariables, renderAlert, formatDuration } = require('./alert-template')
const { sendAll, getEnabledChannels, getEscalationRecipients } = require('./alert-senders')
const {
  isInSilence,
  calculateAlertLevel,
  shouldTriggerAlert,
  shouldSendRecovery,
  getEffectiveConfig
} = require('./alert-decision')
const { ALERT_TYPES, ALERT_LEVELS, DEFAULT_ALERT_CONFIG } = require('./alert-constants')

let _initialized = false
let _alertConfig = null

function getAlertConfig() {
  if (_alertConfig) return _alertConfig
  const cfg = config.alerts || {}
  _alertConfig = {
    enabled: cfg.enabled !== undefined ? cfg.enabled : DEFAULT_ALERT_CONFIG.ENABLED,
    defaultSilenceMinutes: cfg.defaultSilenceMinutes || DEFAULT_ALERT_CONFIG.DEFAULT_SILENCE_MINUTES,
    defaultConsecutiveFailures: cfg.defaultConsecutiveFailures || DEFAULT_ALERT_CONFIG.DEFAULT_CONSECUTIVE_FAILURES,
    defaultEscalationThreshold: cfg.defaultEscalationThreshold || DEFAULT_ALERT_CONFIG.DEFAULT_ESCALATION_THRESHOLD,
    defaultEscalationLevel: cfg.defaultEscalationLevel !== undefined ? cfg.defaultEscalationLevel : DEFAULT_ALERT_CONFIG.DEFAULT_ESCALATION_LEVEL,
    recoveryLinkBaseUrl: cfg.recoveryLinkBaseUrl || '',
    recoveryLinkPath: cfg.recoveryLinkPath || DEFAULT_ALERT_CONFIG.RECOVERY_LINK_PATH,
    channels: cfg.channels || {},
    templates: cfg.templates || {}
  }
  return _alertConfig
}

function reloadConfig() {
  _alertConfig = null
  return getAlertConfig()
}

function getServiceOverrides(serviceId) {
  return storage.alertConfigOverrides.getByService(serviceId)
}

function resolveEffectiveConfig(serviceId, overrides) {
  const cfg = getAlertConfig()
  return getEffectiveConfig(cfg, overrides || {})
}

async function sendAlert(service, state, checkResult, decision, overrides) {
  const cfg = getAlertConfig()
  const effCfg = resolveEffectiveConfig(service.id, overrides)
  const isEscalation = decision.isEscalation

  const channels = getEnabledChannels(cfg, overrides || {})
  if (channels.length === 0) {
    return { skipped: true, reason: 'no_enabled_channels', state }
  }

  const timestamp = checkResult?.timestamp || new Date().toISOString()
  const variables = buildVariables({
    service,
    failureCount: state.consecutive_failures,
    errorMessage: checkResult?.error_message || '',
    alertLevel: decision.alertLevel,
    threshold: effCfg.escalationThreshold,
    firstFailureTime: state.first_failure_time,
    currentTime: new Date(timestamp),
    recoveryLinkBaseUrl: effCfg.recoveryLinkBaseUrl,
    recoveryLinkPath: effCfg.recoveryLinkPath
  })

  const rendered = renderAlert(cfg.templates, decision.alertType, variables)
  const escalationRecipients = getEscalationRecipients(cfg, decision.alertLevel, isEscalation)

  const record = await storage.alertRecords.create({
    service_id: service.id,
    alert_type: decision.alertType,
    alert_level: decision.alertLevel,
    channels,
    title: rendered.title,
    content: rendered.content,
    failure_count: state.consecutive_failures,
    error_message: checkResult?.error_message || null
  })

  const sendParams = {
    title: rendered.title,
    content: rendered.content,
    alertLevel: decision.alertLevel,
    useEscalation: isEscalation,
    recipients: escalationRecipients.email
  }

  const sendResult = await sendAll(channels, cfg, sendParams)
  const updatedRecord = await storage.alertRecords.markSent(
    record.id,
    sendResult.sent,
    sendResult.failed,
    sendResult.errors.length > 0 ? sendResult.errors.join('; ') : null
  )

  const alertTime = new Date().toISOString()
  await storage.alertStates.updateAlertSent(
    service.id,
    alertTime,
    decision.alertLevel,
    record.id
  )

  const updatedState = {
    ...state,
    last_alert_time: alertTime,
    last_alert_level: decision.alertLevel,
    current_alert_level: decision.alertLevel,
    last_sent_alert_id: record.id
  }

  const broadcastType = isEscalation ? 'escalation_alert' : 'new_alert'
  notifier.broadcast({
    type: broadcastType,
    alert: updatedRecord,
    service,
    state: updatedState,
    decision,
    timestamp: alertTime
  })

  return {
    sent: true,
    alertType: decision.alertType,
    alertLevel: decision.alertLevel,
    isEscalation,
    channels,
    sendResult,
    record: updatedRecord,
    recipients: escalationRecipients.email,
    decision,
    state: updatedState
  }
}

async function handleServiceDown(service, checkResult) {
  const cfg = getAlertConfig()
  if (!cfg.enabled) return { skipped: true, reason: 'disabled' }

  const timestamp = checkResult.timestamp || new Date().toISOString()
  const overrides = await getServiceOverrides(service.id)
  const state = await storage.alertStates.recordFailure(service.id, timestamp)
  const effCfg = resolveEffectiveConfig(service.id, overrides)
  const decision = shouldTriggerAlert(state, effCfg)

  await storage.alertStates.updateCurrentAlertLevel(service.id, decision.alertLevel)
  state.current_alert_level = decision.alertLevel

  if (!decision.shouldSend) {
    return { skipped: true, reason: decision.reason, state, decision }
  }

  return sendAlert(service, state, checkResult, decision, overrides)
}

async function handleServiceUp(service, previousState) {
  const cfg = getAlertConfig()
  if (!cfg.enabled) return { skipped: true, reason: 'disabled' }

  const now = new Date().toISOString()
  await storage.alertStates.recordSuccess(service.id)

  if (!shouldSendRecovery(previousState)) {
    return {
      skipped: true,
      reason: previousState?.current_status !== 'down' ? 'was_not_down' : 'no_prior_alert',
      previousState
    }
  }

  const overrides = await getServiceOverrides(service.id)
  const effCfg = resolveEffectiveConfig(service.id, overrides)
  const channels = getEnabledChannels(cfg, overrides || {})

  if (channels.length === 0) {
    return { skipped: true, reason: 'no_enabled_channels' }
  }

  const variables = buildVariables({
    service,
    failureCount: previousState.consecutive_failures || 0,
    errorMessage: '',
    alertLevel: ALERT_LEVELS.L0,
    threshold: 0,
    firstFailureTime: previousState.first_failure_time,
    recoveryTime: now,
    currentTime: new Date(now),
    recoveryLinkBaseUrl: effCfg.recoveryLinkBaseUrl,
    recoveryLinkPath: effCfg.recoveryLinkPath
  })

  const rendered = renderAlert(cfg.templates, ALERT_TYPES.RECOVERY, variables)
  const escalationRecipients = getEscalationRecipients(cfg, previousState.last_alert_level || ALERT_LEVELS.L0, false)

  const record = await storage.alertRecords.create({
    service_id: service.id,
    alert_type: ALERT_TYPES.RECOVERY,
    alert_level: ALERT_LEVELS.L0,
    channels,
    title: rendered.title,
    content: rendered.content,
    failure_count: 0,
    error_message: null
  })

  const sendParams = {
    title: rendered.title,
    content: rendered.content,
    alertLevel: ALERT_LEVELS.L0,
    useEscalation: false,
    recipients: escalationRecipients.email
  }

  const sendResult = await sendAll(channels, cfg, sendParams)
  const updatedRecord = await storage.alertRecords.markSent(
    record.id,
    sendResult.sent,
    sendResult.failed,
    sendResult.errors.length > 0 ? sendResult.errors.join('; ') : null
  )

  notifier.broadcast({
    type: 'recovery_alert',
    alert: updatedRecord,
    service,
    previousState,
    timestamp: new Date().toISOString()
  })

  return {
    sent: true,
    alertType: ALERT_TYPES.RECOVERY,
    channels,
    sendResult,
    record: updatedRecord,
    recipients: escalationRecipients.email
  }
}

async function handleStatusChange(service, newStatus, checkResult, previousState) {
  try {
    if (newStatus === 'down') {
      return await handleServiceDown(service, checkResult)
    } else if (newStatus === 'up' || newStatus === 'maintenance') {
      return await handleServiceUp(service, previousState)
    }
    return { skipped: true, reason: `status_${newStatus}` }
  } catch (e) {
    console.error(`[AlertManager] handleStatusChange error for service #${service?.id}:`, e)
    return { error: e.message }
  }
}

async function processCheckResult(service, checkResult, summary) {
  const cfg = getAlertConfig()
  if (!cfg.enabled) return { skipped: true, reason: 'disabled' }

  const isMaintenance = !!checkResult.is_maintenance
  if (isMaintenance) {
    return { skipped: true, reason: 'maintenance_mode' }
  }

  const timestamp = checkResult.timestamp || new Date().toISOString()
  const prevState = await storage.alertStates.getByService(service.id)

  if (!checkResult.success) {
    const newState = await storage.alertStates.recordFailure(service.id, timestamp)
    const overrides = await getServiceOverrides(service.id)
    const effCfg = resolveEffectiveConfig(service.id, overrides)
    const decision = shouldTriggerAlert(newState, effCfg)

    if (!decision.shouldSend) {
      return { skipped: true, reason: decision.reason, state: newState, decision }
    }

    return sendAlert(service, newState, checkResult, decision, overrides)
  } else {
    if (prevState?.current_status === 'down') {
      return handleServiceUp(service, prevState)
    } else {
      await storage.alertStates.upsert(service.id, {
        current_status: 'up',
        consecutive_failures: 0,
        first_failure_time: null,
        last_failure_time: null,
        silence_until: null
      })
      return { skipped: true, reason: 'still_up' }
    }
  }
}

async function sendTestAlert(serviceId, options = {}) {
  const cfg = getAlertConfig()
  if (!cfg.enabled) return { skipped: true, reason: 'disabled' }

  const service = serviceId ? await storage.services.getById(serviceId) : null
  const mockService = service || {
    id: 0,
    name: options.serviceName || '测试服务',
    type: options.serviceType || 'http',
    target: options.serviceTarget || 'https://example.com'
  }

  const alertLevel = options.alertLevel != null ? parseInt(options.alertLevel, 10) : ALERT_LEVELS.L0
  const isEscalation = options.isEscalation || alertLevel > ALERT_LEVELS.L0

  const channelFilter = options.channels || null
  const overrides = serviceId ? (await getServiceOverrides(serviceId)) : null
  let channels = getEnabledChannels(cfg, overrides || {})
  if (channelFilter && channelFilter.length > 0) {
    channels = channels.filter(c => channelFilter.includes(c))
  }

  if (channels.length === 0) {
    return { skipped: true, reason: 'no_enabled_channels' }
  }

  const effCfg = resolveEffectiveConfig(serviceId, overrides)
  const now = new Date().toISOString()

  const variables = buildVariables({
    service: mockService,
    failureCount: options.failureCount || 1,
    errorMessage: options.errorMessage || '这是一个测试告警，用于验证告警配置是否正常工作',
    alertLevel,
    threshold: effCfg.escalationThreshold,
    firstFailureTime: now,
    currentTime: new Date(now),
    recoveryLinkBaseUrl: effCfg.recoveryLinkBaseUrl,
    recoveryLinkPath: effCfg.recoveryLinkPath
  })

  const alertType = options.alertType || ALERT_TYPES.TEST
  const rendered = renderAlert(cfg.templates, alertType, variables)
  const escalationRecipients = getEscalationRecipients(cfg, alertLevel, isEscalation)

  const record = await storage.alertRecords.create({
    service_id: mockService.id,
    alert_type: alertType,
    alert_level: alertLevel,
    channels,
    title: rendered.title,
    content: rendered.content,
    failure_count: options.failureCount || 1,
    error_message: options.errorMessage || null
  })

  const sendParams = {
    title: rendered.title,
    content: rendered.content,
    alertLevel,
    useEscalation: isEscalation,
    recipients: escalationRecipients.email
  }

  const sendResult = await sendAll(channels, cfg, sendParams)
  const updatedRecord = await storage.alertRecords.markSent(
    record.id,
    sendResult.sent,
    sendResult.failed,
    sendResult.errors.length > 0 ? sendResult.errors.join('; ') : null
  )

  return {
    sent: true,
    test: true,
    alertType,
    alertLevel,
    isEscalation,
    channels,
    recipients: escalationRecipients.email,
    sendResult,
    record: updatedRecord
  }
}

async function setServiceSilence(serviceId, minutes) {
  if (minutes <= 0) {
    return storage.alertStates.setSilence(serviceId, null)
  }
  const silenceUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  return storage.alertStates.setSilence(serviceId, silenceUntil)
}

async function init() {
  if (_initialized) return
  getAlertConfig()
  const downStates = await storage.alertStates.getAllDown()
  console.log(`[AlertManager] Initialized. Current down services: ${downStates.length}`)
  _initialized = true
}

async function getAlertSummary() {
  const cfg = getAlertConfig()
  const stats = await storage.alertRecords.getStats(7)
  const downStates = await storage.alertStates.getAllDown()
  const allStates = await storage.alertStates.getAll()

  return {
    enabled: cfg.enabled,
    totalRecords7d: stats.total,
    byType: stats.byType,
    byChannel: stats.byChannel,
    currentDown: downStates.length,
    totalTracked: allStates.length,
    config: {
      silenceMinutes: cfg.defaultSilenceMinutes,
      consecutiveFailures: cfg.defaultConsecutiveFailures,
      escalationThreshold: cfg.defaultEscalationThreshold,
      enabledChannels: getEnabledChannels(cfg)
    }
  }
}

module.exports = {
  init,
  reloadConfig,
  getAlertConfig,
  getEffectiveConfig: resolveEffectiveConfig,
  handleStatusChange,
  processCheckResult,
  sendTestAlert,
  setServiceSilence,
  getAlertSummary,
  isInSilence,
  calculateAlertLevel,
  shouldTriggerAlert,
  shouldSendRecovery
}
