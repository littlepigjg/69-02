import React, { useEffect, useState } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Title, Tooltip, Legend, Filler, BarElement
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import { getAvailabilityColor } from '../lib/constants'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, BarElement)

export function AvailabilityTrendChart({ serviceId, hours = 24, height = 260 }) {
  const [trend, setTrend] = useState({ data: [] })

  useEffect(() => {
    let cancelled = false
    fetch(`/api/services/${serviceId}/trend?hours=${hours}`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled) setTrend(d)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [serviceId, hours])

  const lineData = {
    labels: trend.data.map(d => d.timestamp),
    datasets: [
      {
        label: '可用率 (%)',
        data: trend.data.map(d => d.availability),
        borderColor: '#6366f1',
        backgroundColor: '#6366f122',
        yAxisID: 'y',
        fill: true,
        tension: 0.3,
        pointRadius: 0
      },
      {
        label: '响应时间 (ms)',
        data: trend.data.map(d => d.avgResponseTime),
        borderColor: '#10b981',
        backgroundColor: 'transparent',
        yAxisID: 'y1',
        borderDash: [4, 4],
        pointRadius: 0
      }
    ]
  }

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          afterBody: (items) => {
            const idx = items[0]?.dataIndex
            const d = trend.data[idx]
            if (d) return `检测次数: ${d.checks}`
            return ''
          }
        }
      }
    },
    scales: {
      y: {
        type: 'linear', position: 'left', min: 0, max: 100,
        title: { display: true, text: '可用率 %' }
      },
      y1: {
        type: 'linear', position: 'right',
        grid: { drawOnChartArea: false },
        title: { display: true, text: '响应 ms' }
      }
    }
  }

  const uptimeColors = trend.data.map(d =>
    d.checks > 0 ? getAvailabilityColor(d.availability, true) : '#e5e7eb'
  )

  const barData = {
    labels: trend.data.map(d => d.timestamp),
    datasets: [{
      data: trend.data.map(d => d.checks > 0 ? 1 : 0),
      backgroundColor: uptimeColors,
      barPercentage: 1,
      categoryPercentage: 1,
      borderWidth: 0
    }]
  }

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const d = trend.data[ctx.dataIndex]
            if (!d || d.checks === 0) return '无数据'
            return `可用率 ${d.availability}%, 平均 ${d.avgResponseTime}ms (${d.checks}次检测)`
          }
        }
      }
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 12, font: { size: 10 } } },
      y: { display: false, max: 1 }
    }
  }

  return (
    <>
      <div style={{ height, marginBottom: 20 }}>
        <Line data={lineData} options={lineOptions} />
      </div>
      <div style={{ height: 40 }}>
        <Bar data={barData} options={barOptions} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8, fontSize: 12, color: '#6b7280' }}>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#10b981', borderRadius: 2, marginRight: 4 }} />正常 (≥99%)</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#f59e0b', borderRadius: 2, marginRight: 4 }} />波动 (80-99%)</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#ef4444', borderRadius: 2, marginRight: 4 }} />故障 (低于80%)</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#e5e7eb', borderRadius: 2, marginRight: 4 }} />无数据</span>
      </div>
    </>
  )
}

export function AvailabilityLegend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8, fontSize: 12, color: '#6b7280' }}>
      <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#10b981', borderRadius: 2, marginRight: 4 }} />正常 (≥99%)</span>
      <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#f59e0b', borderRadius: 2, marginRight: 4 }} />波动 (80-99%)</span>
      <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#ef4444', borderRadius: 2, marginRight: 4 }} />故障 (低于80%)</span>
      <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#e5e7eb', borderRadius: 2, marginRight: 4 }} />无数据</span>
    </div>
  )
}

export function HourSelector({ value, onChange, options = [1, 6, 24, 72, 168] }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map(h => (
        <button
          key={h}
          onClick={() => onChange?.(h)}
          style={{
            padding: '6px 14px', borderRadius: 6, border: 'none',
            background: value === h ? '#6366f1' : '#f3f4f6',
            color: value === h ? '#fff' : '#374151',
            cursor: 'pointer', fontSize: 13, fontWeight: value === h ? 600 : 400
          }}
        >
          {h < 24 ? `${h}小时` : `${h / 24}天`}
        </button>
      ))}
    </div>
  )
}

export default AvailabilityTrendChart
