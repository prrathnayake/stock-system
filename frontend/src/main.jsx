import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Scan from './pages/Scan.jsx'
import WorkOrders from './pages/WorkOrders.jsx'
import './styles.css'

const qc = new QueryClient()

function AppShell() {
  const token = localStorage.getItem('access');
  return (
    <BrowserRouter>
      <nav className="nav">
        <b>RC Stock</b>
        <div className="grow" />
        <Link to="/">Dashboard</Link>
        <Link to="/scan">Scan</Link>
        <Link to="/work-orders">Work Orders</Link>
        {!token ? <Link to="/login">Login</Link> : <button onClick={() => { localStorage.clear(); location.href='/login'; }}>Logout</button>}
      </nav>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={token ? <Dashboard /> : <Navigate to="/login" />} />
        <Route path="/scan" element={token ? <Scan /> : <Navigate to="/login" />} />
        <Route path="/work-orders" element={token ? <WorkOrders /> : <Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <AppShell />
    </QueryClientProvider>
  </React.StrictMode>
)
