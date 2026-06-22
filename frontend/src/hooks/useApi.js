import { useState, useCallback } from 'react'

export function useApi(baseUrl = '/api') {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const request = useCallback(async (path, options = {}) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        body: options.body && typeof options.body !== 'string'
          ? JSON.stringify(options.body)
          : options.body
      })
      const text = await res.text()
      let data
      try {
        data = text ? JSON.parse(text) : null
      } catch (_) {
        data = text
      }
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      return data
    } catch (e) {
      setError(e.message)
      throw e
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  return {
    loading,
    error,
    request,
    get: (path) => request(path, { method: 'GET' }),
    post: (path, body) => request(path, { method: 'POST', body }),
    put: (path, body) => request(path, { method: 'PUT', body }),
    del: (path) => request(path, { method: 'DELETE' })
  }
}

export default useApi
