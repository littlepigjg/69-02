import React from 'react'
import { getStatusMeta } from '../lib/utils'

export default function StatusBadge({ status, size = 'md', style }) {
  const meta = getStatusMeta(status)
  const sz = size === 'lg' ? 14 : size === 'sm' ? 8 : 10

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: size === 'lg' ? '8px 14px' : '4px 10px',
      borderRadius: 999, background: meta.bg, color: meta.text,
      fontSize: size === 'lg' ? 15 : 13, fontWeight: 500,
      ...style
    }}>
      <span style={{
        width: sz, height: sz, borderRadius: '50%',
        background: meta.dot, boxShadow: `0 0 0 4px ${meta.dot}22`
      }} />
      {meta.label}
    </span>
  )
}
