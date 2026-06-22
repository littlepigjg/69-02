import React, { createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import StatusPage from './pages/StatusPage.jsx'
import AdminPage from './pages/AdminPage.jsx'
import useMonitorData from './hooks/useMonitorData'

const AppContext = createContext(null)

export function useApp() {
  return useContext(AppContext)
}

function Header() {
  const loc = useLocation()
  const navLink = (to, label) => {
    const active = (to === '/' && loc.pathname === '/') || (to !== '/' && loc.pathname.startsWith(to))
    return (
      <Link
        to={to}
        style={{
          padding: '8px 16px',
          borderRadius: 8,
          background: active ? '#e0e7ff' : 'transparent',
          color: active ? '#4f46e5' : '#4b5563',
          fontWeight: active ? 600 : 400,
          marginRight: 8,
          transition: 'all 0.15s'
        }}
      >{label}</Link>
    )
  }

  return (
    <header style={{
      background: '#fff',
      borderBottom: '1px solid #e5e7eb',
      padding: '16px 32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100
    }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 'bold', marginRight: 12
        }}>HM</div>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>服务健康监控</h1>
        <nav style={{ marginLeft: 32 }}>
          {navLink('/', '状态总览')}
          {navLink('/admin', '管理配置')}
        </nav>
      </div>
      <div style={{ fontSize: 13, color: '#6b7280' }}>
        {new Date().toLocaleString('zh-CN')}
      </div>
    </header>
  )
}

export default function App() {
  const data = useMonitorData()

  return (
    <AppContext.Provider value={data}>
      <BrowserRouter>
        <Header />
        <main style={{ padding: '24px 32px', maxWidth: 1600, margin: '0 auto' }}>
          <Routes>
            <Route path="/" element={<StatusPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </BrowserRouter>
    </AppContext.Provider>
  )
}
