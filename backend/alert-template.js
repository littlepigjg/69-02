const { ALERT_TYPES, TEMPLATE_VARIABLES } = require('./alert-constants')

const DEFAULT_TEMPLATES = {
  [ALERT_TYPES.DOWN]: {
    title: '【服务故障告警】{{serviceName}}',
    content: '服务名称：{{serviceName}}\n故障时间：{{failureTime}}\n连续失败：{{failureCount}}次\n错误信息：{{errorMessage}}\n快速恢复：{{recoveryLink}}'
  },
  [ALERT_TYPES.ESCALATION]: {
    title: '【告警升级】{{serviceName}} 持续故障超过{{threshold}}次',
    content: '⚠️ 告警升级 ⚠️\n服务名称：{{serviceName}}\n故障时间：{{failureTime}}\n连续失败：{{failureCount}}次\n当前级别：L{{alertLevel}}\n错误信息：{{errorMessage}}\n快速恢复：{{recoveryLink}}'
  },
  [ALERT_TYPES.RECOVERY]: {
    title: '【服务恢复通知】{{serviceName}}',
    content: '✅ 服务已恢复正常\n服务名称：{{serviceName}}\n恢复时间：{{recoveryTime}}\n故障时长：{{downtimeDuration}}\n快速恢复：{{recoveryLink}}'
  },
  [ALERT_TYPES.TEST]: {
    title: '【测试告警】{{serviceName}}',
    content: '🔔 这是一条测试告警\n服务名称：{{serviceName}}\n发送时间：{{currentTime}}\n如果收到此消息，说明告警配置生效正常'
  }
}

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

function escapeHtml(str) {
  if (typeof str !== 'string') return str
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function escapeMarkdown(str) {
  if (typeof str !== 'string') return str
  return str
    .replace(/([_*`\[\]()#+\-.!])/g, '\\$1')
}

function getVariableValue(variables, key, defaultValue = '') {
  if (variables == null) return defaultValue
  if (key in variables) {
    const val = variables[key]
    return val == null ? defaultValue : String(val)
  }
  return defaultValue
}

function renderTemplate(template, variables, options = {}) {
  if (!template || typeof template !== 'string') return ''
  const { escape = null, missingValue = '-', extraVars = {} } = options
  const mergedVars = { ...variables, ...extraVars }
  return template.replace(VARIABLE_PATTERN, (match, key) => {
    let value = getVariableValue(mergedVars, key, missingValue)
    if (escape === 'html') value = escapeHtml(value)
    else if (escape === 'markdown') value = escapeMarkdown(value)
    return value
  })
}

function validateTemplate(template, requiredVars = []) {
  const errors = []
  const warnings = []
  const foundVars = new Set()
  let match

  const titleTpl = typeof template === 'string' ? template : (template?.title || '')
  const contentTpl = typeof template === 'string' ? '' : (template?.content || '')
  const fullTpl = titleTpl + '\n' + contentTpl

  VARIABLE_PATTERN.lastIndex = 0
  while ((match = VARIABLE_PATTERN.exec(fullTpl)) !== null) {
    foundVars.add(match[1])
  }

  const knownKeys = TEMPLATE_VARIABLES.map(v => v.key)
  for (const v of foundVars) {
    if (!knownKeys.includes(v)) {
      warnings.push(`未知变量: {{${v}}}`)
    }
  }

  for (const req of requiredVars) {
    if (!foundVars.has(req)) {
      errors.push(`缺少必需变量: {{${req}}}`)
    }
  }

  return { valid: errors.length === 0, errors, warnings, foundVariables: [...foundVars] }
}

function getTemplate(configTemplates, alertType) {
  const custom = configTemplates?.[alertType]
  const def = DEFAULT_TEMPLATES[alertType] || DEFAULT_TEMPLATES[ALERT_TYPES.DOWN]
  return {
    title: custom?.title || def.title,
    content: custom?.content || def.content
  }
}

function formatDuration(milliseconds) {
  if (!milliseconds || milliseconds < 0) return '-'
  const totalSeconds = Math.floor(milliseconds / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts = []
  if (days > 0) parts.push(`${days}天`)
  if (hours > 0) parts.push(`${hours}小时`)
  if (minutes > 0) parts.push(`${minutes}分钟`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`)
  return parts.join('')
}

function buildVariables({ service, failureCount, errorMessage, alertLevel, threshold,
                         firstFailureTime, recoveryTime, currentTime = new Date(),
                         recoveryLinkBaseUrl = '', recoveryLinkPath = '/services' }) {
  const vars = {
    serviceName: service?.name || 'Unknown Service',
    serviceId: service?.id || '',
    serviceType: service?.type || '',
    serviceTarget: service?.target || '',
    failureCount: failureCount ?? 0,
    errorMessage: errorMessage || '-',
    alertLevel: alertLevel ?? 0,
    threshold: threshold ?? 0,
    currentTime: currentTime.toISOString(),
    recoveryLink: recoveryLinkBaseUrl
      ? `${recoveryLinkBaseUrl.replace(/\/$/, '')}${recoveryLinkPath}/${service?.id || ''}`
      : '-'
  }

  if (firstFailureTime) {
    vars.failureTime = new Date(firstFailureTime).toISOString()
  }
  if (recoveryTime) {
    vars.recoveryTime = new Date(recoveryTime).toISOString()
  }
  if (firstFailureTime && (recoveryTime || currentTime)) {
    const start = new Date(firstFailureTime).getTime()
    const end = recoveryTime ? new Date(recoveryTime).getTime() : currentTime.getTime()
    vars.downtimeDuration = formatDuration(end - start)
  }

  return vars
}

function renderAlert(configTemplates, alertType, variables, options = {}) {
  const template = getTemplate(configTemplates, alertType)
  const { titleEscape = null, contentEscape = null } = options
  return {
    title: renderTemplate(template.title, variables, { escape: titleEscape, ...options }),
    content: renderTemplate(template.content, variables, { escape: contentEscape, ...options })
  }
}

function listVariables() {
  return TEMPLATE_VARIABLES
}

module.exports = {
  DEFAULT_TEMPLATES,
  VARIABLE_PATTERN,
  escapeHtml,
  escapeMarkdown,
  renderTemplate,
  validateTemplate,
  getTemplate,
  formatDuration,
  buildVariables,
  renderAlert,
  listVariables
}
