export const SERVICE_STATUS = Object.freeze({
  UP: 'up',
  DOWN: 'down',
  MAINTENANCE: 'maintenance',
  UNKNOWN: 'unknown'
})

export const SERVICE_TYPES = Object.freeze({
  HTTP: 'http',
  HTTPS: 'https',
  TCP: 'tcp'
})

export const STATUS_STYLES = Object.freeze({
  [SERVICE_STATUS.UP]: { bg: '#d1fae5', text: '#065f46', dot: '#10b981', label: '正常运行' },
  [SERVICE_STATUS.DOWN]: { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444', label: '服务故障' },
  [SERVICE_STATUS.MAINTENANCE]: { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b', label: '维护中' },
  [SERVICE_STATUS.UNKNOWN]: { bg: '#f3f4f6', text: '#4b5563', dot: '#9ca3af', label: '未知' }
})

export const WS_MESSAGE_TYPES = Object.freeze({
  HELLO: 'hello',
  STATUS_CHANGE: 'status_change',
  NEW_CHECK: 'new_check',
  MAINTENANCE_CHANGE: 'maintenance_change',
  SERVICE_UPDATE: 'service_update',
  SERVICE_DELETED: 'service_deleted'
})

export const AVAILABILITY_COLORS = Object.freeze({
  GOOD: '#10b981',
  WARN: '#f59e0b',
  BAD: '#ef4444',
  NONE: '#e5e7eb'
})

export function getAvailabilityColor(availability, hasData = true) {
  if (!hasData) return AVAILABILITY_COLORS.NONE
  if (availability >= 99) return AVAILABILITY_COLORS.GOOD
  if (availability >= 80) return AVAILABILITY_COLORS.WARN
  return AVAILABILITY_COLORS.BAD
}
