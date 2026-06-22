import React, { useState, useEffect } from 'react'
import { getAvailabilityColor } from '../lib/constants'

export default function MiniAvailabilityBars({ serviceId, hours = 24, height = 36 }) {
  const [data, setData] = useState([])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/services/${serviceId}/trend?hours=${hours}`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled) setData(d.data || [])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [serviceId, hours])

  const bars = data.length > 0 ? data : Array(48).fill(null)
  return (
    <div style={{ height, display: 'flex', borderRadius: 6, overflow: 'hidden', gap: 1, background: '#f3f4f6', flex: 1 }}>
      {bars.map((point, i) => {
        if (!point || point.checks === 0) {
          return <div key={i} style={{ flex: 1, background: '#e5e7eb' }} />
        }
        const color = getAvailabilityColor(point.availability, true)
        return (
          <div
            key={i}
            style={{ flex: 1, background: color }}
            title={`${point.timestamp}: ${point.availability}%`}
          />
        )
      })}
    </div>
  )
}
