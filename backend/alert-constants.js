const ALERT_TYPES = Object.freeze({
  DOWN: 'down',
  ESCALATION: 'escalation',
  RECOVERY: 'recovery',
  TEST: 'test'
})

const ALERT_STATUS = Object.freeze({
  PENDING: 'pending',
  SENT: 'sent',
  PARTIAL: 'partial',
  FAILED: 'failed'
})

const ALERT_CHANNELS = Object.freeze({
  EMAIL: 'email',
  WECHAT: 'wechat',
  DINGTALK: 'dingtalk'
})

const ALERT_LEVELS = Object.freeze({
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3
})

const ALERT_LEVEL_LABELS = Object.freeze({
  [ALERT_LEVELS.L0]: '普通告警',
  [ALERT_LEVELS.L1]: '重要告警',
  [ALERT_LEVELS.L2]: '紧急告警',
  [ALERT_LEVELS.L3]: '致命告警'
})

const DEFAULT_ALERT_CONFIG = Object.freeze({
  ENABLED: true,
  DEFAULT_SILENCE_MINUTES: 30,
  DEFAULT_CONSECUTIVE_FAILURES: 3,
  DEFAULT_ESCALATION_THRESHOLD: 5,
  DEFAULT_ESCALATION_LEVEL: 1,
  RECOVERY_LINK_PATH: '/services',
  MAX_FAILURE_RECORDS: 1000
})

const WECHAT_MSG_TYPES = Object.freeze({
  TEXT: 'text',
  MARKDOWN: 'markdown',
  NEWS: 'news'
})

const DINGTALK_MSG_TYPES = Object.freeze({
  TEXT: 'text',
  MARKDOWN: 'markdown',
  LINK: 'link',
  ACTION_CARD: 'actionCard'
})

const TEMPLATE_VARIABLES = Object.freeze([
  { key: 'serviceName', label: '服务名称', required: true },
  { key: 'serviceId', label: '服务ID', required: false },
  { key: 'serviceType', label: '服务类型', required: false },
  { key: 'serviceTarget', label: '服务目标地址', required: false },
  { key: 'failureTime', label: '故障发生时间', required: false },
  { key: 'recoveryTime', label: '服务恢复时间', required: false },
  { key: 'failureCount', label: '连续失败次数', required: false },
  { key: 'errorMessage', label: '最近一次错误信息', required: false },
  { key: 'recoveryLink', label: '快速恢复链接', required: false },
  { key: 'downtimeDuration', label: '故障持续时长', required: false },
  { key: 'alertLevel', label: '告警级别', required: false },
  { key: 'threshold', label: '升级阈值', required: false },
  { key: 'currentTime', label: '当前时间', required: false }
])

module.exports = {
  ALERT_TYPES,
  ALERT_STATUS,
  ALERT_CHANNELS,
  ALERT_LEVELS,
  ALERT_LEVEL_LABELS,
  DEFAULT_ALERT_CONFIG,
  WECHAT_MSG_TYPES,
  DINGTALK_MSG_TYPES,
  TEMPLATE_VARIABLES
}
