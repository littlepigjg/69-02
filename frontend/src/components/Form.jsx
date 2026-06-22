import React from 'react'

export function FormField({ label, help, error, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && (
        <label style={{
          display: 'block', fontSize: 13, fontWeight: 600,
          marginBottom: 6, color: error ? '#dc2626' : '#374151'
        }}>{label}</label>
      )}
      {children}
      {help && !error && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{help}</div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{error}</div>
      )}
    </div>
  )
}

export function TextInput({
  value, onChange, type = 'text', placeholder, disabled,
  style, min, max, step
}) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      style={{
        width: '100%', padding: '10px 12px', borderRadius: 8,
        border: '1px solid #d1d5db', fontSize: 14, outline: 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        background: disabled ? '#f9fafb' : '#fff',
        color: disabled ? '#9ca3af' : '#1f2937',
        fontFamily: type === 'number' ? 'monospace' : 'inherit',
        ...style
      }}
      onFocus={e => {
        if (!disabled) {
          e.target.style.borderColor = '#6366f1'
          e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)'
        }
      }}
      onBlur={e => {
        e.target.style.borderColor = '#d1d5db'
        e.target.style.boxShadow = 'none'
      }}
    />
  )
}

export function SelectInput({ value, onChange, options, disabled, placeholder }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange?.(e.target.value)}
      disabled={disabled}
      style={{
        width: '100%', padding: '10px 12px', borderRadius: 8,
        border: '1px solid #d1d5db', fontSize: 14, background: disabled ? '#f9fafb' : '#fff',
        outline: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? '#9ca3af' : '#1f2937'
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function CheckboxInput({ checked, onChange, label, disabled }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={e => onChange?.(e.target.checked)}
        disabled={disabled}
        style={{ width: 18, height: 18, cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
      {label && <span style={{ fontSize: 14, color: '#374151' }}>{label}</span>}
    </label>
  )
}

export function Button({
  children, onClick, variant = 'default',
  size = 'md', disabled, icon, type = 'button', style
}) {
  const variants = {
    primary: { bg: '#6366f1', color: '#fff', hover: '#4f46e5', border: 'none', shadow: '0 4px 12px rgba(99,102,241,0.35)' },
    danger: { bg: '#dc2626', color: '#fff', hover: '#b91c1c', border: 'none', shadow: '0 4px 12px rgba(220,38,38,0.3)' },
    ghost: { bg: 'transparent', color: '#374151', hover: '#f3f4f6', border: 'none', shadow: 'none' },
    default: { bg: '#fff', color: '#374151', hover: '#f9fafb', border: '1px solid #d1d5db', shadow: 'none' }
  }
  const sizes = {
    sm: { padding: '6px 12px', fontSize: 12 },
    md: { padding: '10px 20px', fontSize: 14 },
    lg: { padding: '14px 28px', fontSize: 16 }
  }
  const v = variants[variant] || variants.default
  const s = sizes[size] || sizes.md

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = v.hover }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = v.bg }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        borderRadius: 8, fontWeight: variant === 'primary' || variant === 'danger' ? 600 : 400,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'all 0.15s',
        background: v.bg, color: v.color, border: v.border,
        boxShadow: v.shadow,
        ...s,
        ...style
      }}
    >
      {icon && <span style={{ fontSize: s.fontSize + 2 }}>{icon}</span>}
      {children}
    </button>
  )
}

export function IconButton({ icon, title, onClick, color, disabled }) {
  const colors = {
    default: { bg: '#f3f4f6', color: '#374151' },
    primary: { bg: '#eff6ff', color: '#2563eb' },
    success: { bg: '#d1fae5', color: '#065f46' },
    warning: { bg: '#fff7ed', color: '#c2410c' },
    danger: { bg: '#fef2f2', color: '#dc2626' },
    purple: { bg: '#ede9fe', color: '#6d28d9' }
  }
  const c = colors[color] || colors.default
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = 0.85 }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.opacity = 1 }}
      style={{
        width: 36, height: 36, borderRadius: 8, border: 'none',
        background: c.bg, color: c.color, cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 16, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', transition: 'opacity 0.15s',
        opacity: disabled ? 0.5 : 1
      }}
    >{icon}</button>
  )
}
