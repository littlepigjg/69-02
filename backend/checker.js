const axios = require('axios')
const net = require('net')
const { SERVICE_TYPES, ERROR_MESSAGES } = require('./constants')
const { isValidTcpPort, parseTcpTarget } = require('./utils')

async function checkHttp(service) {
  let url = service.target
  const startTime = Date.now()
  const timeout = service.timeout_ms || 5000

  try {
    if (service.type === SERVICE_TYPES.HTTP && !/^https?:\/\//.test(url)) {
      url = `http://${url}`
    } else if (service.type === SERVICE_TYPES.HTTPS && !/^https?:\/\//.test(url)) {
      url = `https://${url}`
    }

    const method = (service.method || 'GET').toLowerCase()
    const expectedStatus = service.expectedStatus || 200

    let httpsAgent = undefined
    if (service.type === SERVICE_TYPES.HTTPS) {
      const https = require('https')
      httpsAgent = new https.Agent({ rejectUnauthorized: false })
    }

    const response = await axios({
      method,
      url,
      timeout,
      validateStatus: () => true,
      httpsAgent
    })

    const responseTime = Date.now() - startTime
    const success = response.status === expectedStatus

    return {
      success,
      response_time_ms: responseTime,
      status_code: response.status,
      error_message: success ? null : `Expected status ${expectedStatus}, got ${response.status}`
    }
  } catch (err) {
    return {
      success: false,
      response_time_ms: Math.max(0, Date.now() - startTime),
      status_code: null,
      error_message: err.code || err.message || 'Unknown error'
    }
  }
}

function checkTcp(service) {
  return new Promise((resolve) => {
    const startTime = Date.now()
    const timeout = service.timeout_ms || 5000

    const { host, port } = parseTcpTarget(service.target, service.port)

    if (!host) {
      resolve({
        success: false,
        response_time_ms: 0,
        status_code: null,
        error_message: 'TCP target host is empty'
      })
      return
    }

    if (!isValidTcpPort(port)) {
      resolve({
        success: false,
        response_time_ms: 0,
        status_code: null,
        error_message: `${ERROR_MESSAGES.TCP_NO_PORT} (got: ${port})`
      })
      return
    }

    const socket = new net.Socket()
    let finished = false

    const finish = (success, error_message, status_code = null) => {
      if (finished) return
      finished = true
      try { socket.destroy() } catch (_) {}
      resolve({
        success,
        response_time_ms: Math.max(0, Date.now() - startTime),
        status_code,
        error_message
      })
    }

    try {
      socket.setTimeout(timeout)
    } catch (_) {}

    socket.on('connect', () => finish(true, null))
    socket.on('timeout', () => finish(false, 'Connection timeout'))
    socket.on('error', (err) => finish(false, err.code || err.message || 'Connection error'))

    try {
      socket.connect(port, host)
    } catch (err) {
      finish(false, err.message || 'Invalid target')
    }
  })
}

async function checkService(service) {
  if (!service || !service.type) {
    return {
      success: false,
      response_time_ms: 0,
      status_code: null,
      error_message: 'Invalid service config'
    }
  }

  if (service.type === SERVICE_TYPES.TCP) {
    return checkTcp(service)
  }

  if (service.type === SERVICE_TYPES.HTTP || service.type === SERVICE_TYPES.HTTPS) {
    return checkHttp(service)
  }

  return {
    success: false,
    response_time_ms: 0,
    status_code: null,
    error_message: `${ERROR_MESSAGES.INVALID_SERVICE_TYPE} (got: ${service.type})`
  }
}

module.exports = {
  checkService,
  checkHttp,
  checkTcp
}
