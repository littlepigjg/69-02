function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function pick(obj, keys) {
  const result = {}
  for (const k of keys) {
    if (k in obj) result[k] = obj[k]
  }
  return result
}

function toBool(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())
  return Boolean(v)
}

function toInt(v, defaultValue = 0) {
  if (v === null || v === undefined || v === '') return defaultValue
  const n = parseInt(v, 10)
  return isNaN(n) ? defaultValue : n
}

function isValidTcpPort(port) {
  const n = Number(port)
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

function parseTcpTarget(target, portField) {
  if (portField !== undefined && portField !== null && portField !== '') {
    const n = Number(portField)
    if (Number.isInteger(n)) {
      return { host: target, port: n }
    }
  }
  if (target && target.includes(':')) {
    const idx = target.lastIndexOf(':')
    const hostPart = target.substring(0, idx)
    const portPart = target.substring(idx + 1)
    const n = Number(portPart)
    if (Number.isInteger(n)) {
      return { host: hostPart, port: n }
    }
  }
  return { host: target, port: null }
}

function asyncDebounce(fn, waitMs) {
  let timer = null
  let pending = false
  let queued = false

  async function wrapper(...args) {
    if (pending) {
      queued = true
      return
    }
    if (timer) {
      clearTimeout(timer)
    }
    return new Promise((resolve) => {
      timer = setTimeout(async () => {
        timer = null
        pending = true
        try {
          const result = await fn(...args)
          resolve(result)
        } finally {
          pending = false
          if (queued) {
            queued = false
            wrapper(...args)
          }
        }
      }, waitMs)
    })
  }

  wrapper.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    queued = false
  }

  return wrapper
}

function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str)
  } catch (e) {
    return fallback
  }
}

class ResumableTimeout {
  constructor() {
    this._timer = null
    this._fn = null
  }

  setTimeout(fn, delayMs) {
    this.clear()
    this._fn = fn
    this._timer = setTimeout(() => {
      this._timer = null
      this._fn = null
      fn()
    }, delayMs)
  }

  clear() {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
      this._fn = null
    }
  }

  get active() {
    return this._timer !== null
  }
}

class SafeEventEmitter {
  constructor() {
    this._listeners = new Map()
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set())
    this._listeners.get(event).add(fn)
    return () => this.off(event, fn)
  }

  off(event, fn) {
    this._listeners.get(event)?.delete(fn)
  }

  emit(event, ...args) {
    const listeners = this._listeners.get(event)
    if (!listeners) return
    for (const fn of [...listeners]) {
      try {
        fn(...args)
      } catch (e) {
        console.error(`[SafeEventEmitter] Listener error for "${event}":`, e)
      }
    }
  }

  removeAllListeners(event) {
    if (event) this._listeners.delete(event)
    else this._listeners.clear()
  }
}

module.exports = {
  clamp,
  pick,
  toBool,
  toInt,
  isValidTcpPort,
  parseTcpTarget,
  asyncDebounce,
  safeJsonParse,
  ResumableTimeout,
  SafeEventEmitter
}
