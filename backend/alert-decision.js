const { ALERT_TYPES, ALERT_LEVELS } = require('./alert-constants')

function isInSilence(silenceUntil) {
  if (!silenceUntil) return false
  return new Date(silenceUntil).getTime() > Date.now()
}

function calculateAlertLevel(consecutiveFailures, escalationThreshold, baseLevel = ALERT_LEVELS.L0) {
  if (!escalationThreshold || escalationThreshold <= 0) return baseLevel
  const levelsAbove = Math.floor(consecutiveFailures / escalationThreshold)
  return Math.min(baseLevel + levelsAbove, ALERT_LEVELS.L3)
}

function getSilenceRemainingMs(lastAlertTime, silenceMinutes) {
  if (!lastAlertTime || silenceMinutes <= 0) return 0
  const lastAlertMs = new Date(lastAlertTime).getTime()
  const silenceMs = silenceMinutes * 60 * 1000
  const elapsed = Date.now() - lastAlertMs
  return Math.max(0, silenceMs - elapsed)
}

function shouldTriggerAlert(state, effCfg) {
  if (!state) return { shouldSend: false, reason: 'no_state' }
  if (state.current_status !== 'down') return { shouldSend: false, reason: 'not_down' }

  if (state.consecutive_failures < effCfg.consecutiveFailures) {
    return {
      shouldSend: false,
      reason: `failures_${state.consecutive_failures}_lt_${effCfg.consecutiveFailures}`,
      currentFailures: state.consecutive_failures,
      requiredFailures: effCfg.consecutiveFailures
    }
  }

  const newLevel = calculateAlertLevel(
    state.consecutive_failures,
    effCfg.escalationThreshold,
    ALERT_LEVELS.L0
  )

  const isEscalation = state.last_alert_level != null
    ? newLevel > state.last_alert_level
    : newLevel > ALERT_LEVELS.L0

  const inManualSilence = isInSilence(state.silence_until)

  if (!state.last_alert_time) {
    return {
      shouldSend: true,
      alertType: ALERT_TYPES.DOWN,
      alertLevel: newLevel,
      isEscalation: false,
      inManualSilence,
      silenceRemainingMs: 0
    }
  }

  const silenceRemainingMs = getSilenceRemainingMs(state.last_alert_time, effCfg.silenceMinutes)
  const inIntervalSilence = silenceRemainingMs > 0

  if (isEscalation) {
    return {
      shouldSend: true,
      alertType: ALERT_TYPES.ESCALATION,
      alertLevel: newLevel,
      isEscalation: true,
      previousLevel: state.last_alert_level,
      inManualSilence,
      inIntervalSilence,
      silenceRemainingMs,
      note: inManualSilence ? '升级告警穿透手动静默期' : (inIntervalSilence ? '升级告警穿透间隔静默期' : '')
    }
  }

  if (inManualSilence) {
    return {
      shouldSend: false,
      reason: 'in_manual_silence',
      silenceUntil: state.silence_until,
      alertLevel: newLevel,
      isEscalation: false,
      inManualSilence: true
    }
  }

  if (inIntervalSilence) {
    return {
      shouldSend: false,
      reason: `silence_${Math.ceil(silenceRemainingMs / 1000)}s`,
      silenceRemainingMs,
      silenceRemainingSeconds: Math.ceil(silenceRemainingMs / 1000),
      alertLevel: newLevel,
      isEscalation: false,
      inIntervalSilence: true
    }
  }

  return {
    shouldSend: true,
    alertType: ALERT_TYPES.DOWN,
    alertLevel: newLevel,
    isEscalation: false,
    inManualSilence: false,
    inIntervalSilence: false,
    silenceRemainingMs: 0
  }
}

function shouldSendRecovery(state) {
  if (!state) return false
  return state.current_status === 'down' && !!state.last_sent_alert_id
}

function getEffectiveConfig(defaultCfg, overrides = null) {
  const o = overrides || {}
  return {
    silenceMinutes: o.silence_minutes != null ? o.silence_minutes : defaultCfg.defaultSilenceMinutes,
    consecutiveFailures: o.consecutive_failures != null ? o.consecutive_failures : defaultCfg.defaultConsecutiveFailures,
    escalationThreshold: o.escalation_threshold != null ? o.escalation_threshold : defaultCfg.defaultEscalationThreshold,
    escalationLevel: o.escalation_level != null ? o.escalation_level : defaultCfg.defaultEscalationLevel,
    recoveryLinkBaseUrl: defaultCfg.recoveryLinkBaseUrl,
    recoveryLinkPath: defaultCfg.recoveryLinkPath
  }
}

function getMergedRecipients(defaultRecipients, escalationRecipients, alertLevel) {
  const base = [...(defaultRecipients || [])]
  if (!escalationRecipients || escalationRecipients.length === 0 || alertLevel <= 0) {
    return base
  }
  const toAdd = Math.min(alertLevel, escalationRecipients.length)
  for (let i = 0; i < toAdd; i++) {
    base.push(escalationRecipients[i])
  }
  return [...new Set(base)]
}

module.exports = {
  isInSilence,
  calculateAlertLevel,
  getSilenceRemainingMs,
  shouldTriggerAlert,
  shouldSendRecovery,
  getEffectiveConfig,
  getMergedRecipients
}
