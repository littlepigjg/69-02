export function classNames(...args) {
  return args.filter(Boolean).join(' ')
}

export function formatRelativeTime(isoString) {
  if (!isoString) return '从未'
  const diff = Date.now() - new Date(isoString).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  return `${day}天前`
}

export function formatDurationMinutes(totalMinutes) {
  if (totalMinutes < 60) return `${totalMinutes}分钟`
  if (totalMinutes < 1440) return `${Math.round(totalMinutes / 60)}小时`
  return `${Math.round(totalMinutes / 1440)}天`
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function debounce(fn, delayMs) {
  let timer = null
  return function (...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delayMs)
  }
}

export function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str)
  } catch (e) {
    return fallback
  }
}

export function getStatusMeta(status) {
  const map = {
    up: { bg: '#d1fae5', text: '#065f46', dot: '#10b981', label: '正常运行' },
    down: { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444', label: '服务故障' },
    maintenance: { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b', label: '维护中' },
    unknown: { bg: '#f3f4f6', text: '#4b5563', dot: '#9ca3af', label: '未知' }
  }
  return map[status] || map.unknown
}
