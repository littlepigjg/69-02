import React, { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import Modal from '../components/Modal.jsx'
import MiniAvailabilityBars from '../components/MiniAvailabilityBars.jsx'
import { AvailabilityTrendChart, HourSelector } from '../components/Charts.jsx'
import { formatRelativeTime } from '../lib/utils'

function ServiceCard({ service, onClick, selected }) {
  const statusColor = {
    up: '#10b981', down: '#ef4444', maintenance: '#f59e0b', unknown: '#9ca3af'
  }[service.summary?.status] || '#9ca3af'

  const avail = service.summary?.availability ?? 0
  const availColor = avail >= 99 ? '#059669' : avail >= 95 ? '#d97706' : '#dc2626'

  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff', borderRadius: 14, padding: 20,
        border: selected ? `2px solid ${statusColor}` : '2px solid transparent',
        boxShadow: selected ? `0 4px 20px ${statusColor}33` : '0 1px 3px rgba(0,0,0,0.06)',
        cursor: 'pointer', transition: 'all 0.2s',
        minWidth: 280, flex: '1 1 320px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{service.name}</h3>
          <div style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>
            {service.type.toUpperCase()} · {service.target}{service.type === 'tcp' && service.port ? `:${service.port}` : ''}
          </div>
        </div>
        <StatusBadge status={service.summary?.status} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div style={{ background: '#f9fafb', padding: 10, borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>可用率</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: availColor }}>
            {avail.toFixed(2)}%
          </div>
        </div>
        <div style={{ background: '#f9fafb', padding: 10, borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>平均响应</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#4f46e5' }}>
            {service.summary?.avgResponseTime || 0}ms
          </div>
        </div>
      </div>

      <MiniAvailabilityBars serviceId={service.id} />

      {service.summary?.lastCheck && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 10 }}>
          上次检测: {formatRelativeTime(service.summary.lastCheck)}
        </div>
      )}
    </div>
  )
}

function ServiceDetailPanel({ service, onClose }) {
  const [hours, setHours] = useState(24)

  if (!service) return null

  return (
    <Modal title={`${service.name} - 详情`} onClose={onClose} width={960}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <StatusBadge status={service.summary?.status} size="lg" />
        <div style={{ flex: 1 }} />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 24
      }}>
        <StatBox label="服务类型" value={service.type.toUpperCase()} />
        <StatBox
          label="目标地址"
          value={`${service.target}${service.type === 'tcp' && service.port ? `:${service.port}` : ''}`}
          mono
        />
        <StatBox
          label="检测方法"
          value={service.type === 'tcp' ? 'TCP连接' : `${service.method} ${service.expectedStatus}`}
        />
        <StatBox label="检测间隔" value={`${service.interval_seconds}秒`} />
        <StatBox label="超时时间" value={`${service.timeout_ms}ms`} />
        <StatBox
          label="检测次数"
          value={`${service.summary?.successfulChecks || 0}/${service.summary?.totalChecks || 0}`}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <HourSelector value={hours} onChange={setHours} />
      </div>

      <AvailabilityTrendChart serviceId={service.id} hours={hours} />

      {service.summary?.error_message && (
        <div style={{
          marginTop: 16, padding: 12,
          background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca'
        }}>
          <div style={{ fontSize: 12, color: '#991b1b', fontWeight: 600, marginBottom: 4 }}>
            最新错误信息
          </div>
          <div style={{
            fontSize: 13, color: '#7f1d1d',
            fontFamily: 'monospace', wordBreak: 'break-all'
          }}>
            {service.summary.error_message}
          </div>
        </div>
      )}
    </Modal>
  )
}

function StatBox({ label, value, mono }) {
  return (
    <div style={{ background: '#f9fafb', padding: 14, borderRadius: 10 }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{
        fontSize: 15, fontWeight: 600,
        fontFamily: mono ? 'monospace' : 'inherit',
        wordBreak: 'break-all'
      }}>{value}</div>
    </div>
  )
}

export default function StatusPage() {
  const { services, lastUpdate, isConnected, connectionState } = useApp()
  const [selected, setSelected] = useState(null)

  const counts = useMemo(() => {
    let up = 0, down = 0, maint = 0, unk = 0
    for (const s of services) {
      const st = s.summary?.status
      if (st === 'up') up++
      else if (st === 'down') down++
      else if (st === 'maintenance') maint++
      else unk++
    }
    return { up, down, maint, unk, total: services.length }
  }, [services])

  const selectedService = selected ? services.find(s => s.id === selected) : null

  const connBadge = {
    idle: { bg: '#f3f4f6', text: '#6b7280', label: '未连接' },
    connecting: { bg: '#dbeafe', text: '#2563eb', label: '连接中...' },
    reconnecting: { bg: '#fef3c7', text: '#92400e', label: '重连中...' },
    open: { bg: '#d1fae5', text: '#065f46', label: '实时已连接' },
    closed: { bg: '#fee2e2', text: '#991b1b', label: '连接已断开' }
  }[connectionState] || { bg: '#f3f4f6', text: '#6b7280', label: '未知' }

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16
      }}>
        <div>
          <h2 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>服务状态总览</h2>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            共 <b style={{ color: '#1f2937' }}>{counts.total}</b> 个服务
            {counts.down > 0 && <span style={{ color: '#dc2626', marginLeft: 12 }}>· {counts.down} 个故障</span>}
            {counts.maint > 0 && <span style={{ color: '#d97706', marginLeft: 12 }}>· {counts.maint} 个维护中</span>}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            background: connBadge.bg, color: connBadge.text,
            borderRadius: 999, fontSize: 13, fontWeight: 500
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isConnected ? '#10b981' : '#9ca3af',
              animation: !isConnected ? 'pulse 2s infinite' : 'none'
            }} />
            {connBadge.label}
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <CountBadge label="正常" value={counts.up} color="#10b981" />
            <CountBadge label="故障" value={counts.down} color="#ef4444" danger />
            <CountBadge label="维护" value={counts.maint} color="#f59e0b" />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {services.length === 0 && (
          <div style={{
            background: '#fff', borderRadius: 14, padding: 60, textAlign: 'center',
            width: '100%', color: '#6b7280'
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📡</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: '#1f2937' }}>
              暂无监控服务
            </div>
            <div style={{ marginBottom: 20 }}>请前往「管理配置」页面添加要监控的服务端点</div>
            <Link to="/admin" style={{
              display: 'inline-block', padding: '10px 20px',
              background: '#6366f1', color: '#fff', borderRadius: 8, fontWeight: 600
            }}>添加服务</Link>
          </div>
        )}
        {services.map(svc => (
          <ServiceCard
            key={svc.id}
            service={svc}
            selected={selected === svc.id}
            onClick={() => setSelected(selected === svc.id ? null : svc.id)}
          />
        ))}
      </div>

      {selectedService && (
        <ServiceDetailPanel
          service={selectedService}
          onClose={() => setSelected(null)}
        />
      )}

      {lastUpdate && (
        <div style={{ textAlign: 'center', marginTop: 32, color: '#9ca3af', fontSize: 12 }}>
          数据更新于 {new Date(lastUpdate).toLocaleString('zh-CN')} · 状态变化实时推送
        </div>
      )}
    </div>
  )
}

function CountBadge({ label, value, color, danger }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '10px 16px', background: '#fff',
      borderRadius: 10, border: '1px solid #e5e7eb'
    }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
      <div>
        <div style={{ fontSize: 10, color: '#6b7280' }}>{label}</div>
        <div style={{ fontWeight: 700, color: danger ? '#dc2626' : '#1f2937' }}>{value}</div>
      </div>
    </div>
  )
}
