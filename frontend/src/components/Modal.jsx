import React from 'react'

export default function Modal({ title, children, onClose, actions, width = 640 }) {
  if (!title && !children && !actions) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        padding: 16
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 14, padding: 24,
          maxWidth: width, width: '100%', maxHeight: '90vh', overflow: 'auto'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 20, fontWeight: 700 }}>{title}</h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            style={{
              border: 'none', background: 'none', fontSize: 24,
              cursor: 'pointer', color: '#6b7280', lineHeight: 1
            }}
          >×</button>
        </div>
        {children}
        {actions && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
