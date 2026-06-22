import { useEffect, useRef, useCallback, useState } from 'react'
import { safeJsonParse } from '../lib/utils'

const WS_READY_STATES = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
}

const DEFAULT_OPTIONS = {
  reconnect: true,
  minReconnectDelay: 1000,
  maxReconnectDelay: 10000,
  backoffMultiplier: 2,
  shouldReconnect: () => true
}

export default function useWebSocket(path, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const wsRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const reconnectCountRef = useRef(0)
  const manualCloseRef = useRef(false)
  const listenersRef = useRef(new Set())
  const connectingRef = useRef(false)

  const [connectionState, setConnectionState] = useState('idle')

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const closeSocket = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null
        wsRef.current.onmessage = null
        wsRef.current.onerror = null
        wsRef.current.onclose = null
        if (
          wsRef.current.readyState === WS_READY_STATES.OPEN ||
          wsRef.current.readyState === WS_READY_STATES.CONNECTING
        ) {
          wsRef.current.close()
        }
      } catch (e) {
        console.error('[WS] Close error:', e)
      }
      wsRef.current = null
    }
    connectingRef.current = false
  }, [])

  const scheduleReconnect = useCallback(() => {
    clearReconnectTimer()
    if (!opts.reconnect || manualCloseRef.current) return
    if (!opts.shouldReconnect()) return

    const delay = Math.min(
      opts.minReconnectDelay * Math.pow(opts.backoffMultiplier, reconnectCountRef.current),
      opts.maxReconnectDelay
    )
    reconnectCountRef.current += 1
    console.log(`[WS] Scheduling reconnect attempt #${reconnectCountRef.current} in ${delay}ms`)
    setConnectionState('reconnecting')

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null
      connect()
    }, delay)
  }, [opts, clearReconnectTimer])

  const connect = useCallback(() => {
    if (connectingRef.current) {
      console.log('[WS] Already connecting, skipped duplicate attempt')
      return
    }
    if (wsRef.current && (
      wsRef.current.readyState === WS_READY_STATES.OPEN ||
      wsRef.current.readyState === WS_READY_STATES.CONNECTING
    )) {
      console.log('[WS] Already open/connecting, skipped')
      return
    }

    closeSocket()
    clearReconnectTimer()
    connectingRef.current = true
    manualCloseRef.current = false

    const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3001'
    const url = `${proto}//${host}${path}`

    console.log(`[WS] Connecting to ${url}`)
    setConnectionState('connecting')

    let ws
    try {
      ws = new WebSocket(url)
    } catch (e) {
      console.error('[WS] Failed to create WebSocket:', e)
      connectingRef.current = false
      scheduleReconnect()
      return
    }

    wsRef.current = ws

    ws.onopen = () => {
      connectingRef.current = false
      reconnectCountRef.current = 0
      console.log('[WS] Connected')
      setConnectionState('open')
      emit({ type: 'open' })
    }

    ws.onmessage = (e) => {
      const msg = safeJsonParse(e.data)
      if (msg !== null) {
        emit({ type: 'message', data: msg })
      } else {
        console.warn('[WS] Invalid JSON received')
      }
    }

    ws.onerror = () => {
      console.error('[WS] Connection error')
      emit({ type: 'error' })
    }

    ws.onclose = (event) => {
      connectingRef.current = false
      console.log(`[WS] Closed (code=${event.code}, wasClean=${event.wasClean})`)
      setConnectionState('closed')
      emit({ type: 'close', data: event })
      wsRef.current = null
      if (!manualCloseRef.current) {
        scheduleReconnect()
      }
    }
  }, [path, closeSocket, clearReconnectTimer, scheduleReconnect])

  const emit = (event) => {
    for (const fn of [...listenersRef.current]) {
      try {
        fn(event)
      } catch (e) {
        console.error('[WS] Listener error:', e)
      }
    }
  }

  const subscribe = useCallback((fn) => {
    listenersRef.current.add(fn)
    return () => listenersRef.current.delete(fn)
  }, [])

  const send = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WS_READY_STATES.OPEN) {
      const payload = typeof data === 'string' ? data : JSON.stringify(data)
      wsRef.current.send(payload)
      return true
    }
    return false
  }, [])

  const disconnect = useCallback(() => {
    console.log('[WS] Manual disconnect')
    manualCloseRef.current = true
    clearReconnectTimer()
    closeSocket()
    setConnectionState('closed')
  }, [closeSocket, clearReconnectTimer])

  const reconnectNow = useCallback(() => {
    console.log('[WS] Forced reconnect')
    reconnectCountRef.current = 0
    clearReconnectTimer()
    connect()
  }, [clearReconnectTimer, connect])

  useEffect(() => {
    connect()
    return () => {
      manualCloseRef.current = true
      clearReconnectTimer()
      closeSocket()
      listenersRef.current.clear()
    }
  }, [connect, closeSocket, clearReconnectTimer])

  return {
    connectionState,
    subscribe,
    send,
    connect,
    disconnect,
    reconnectNow,
    isConnected: connectionState === 'open',
    isConnecting: connectionState === 'connecting' || connectionState === 'reconnecting'
  }
}
