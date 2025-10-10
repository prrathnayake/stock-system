import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AppRouter from './routes/AppRouter.jsx'
import { AuthProvider } from './providers/AuthProvider.jsx'
import { ThemeProvider } from './providers/ThemeProvider.jsx'
import { flushQueue } from './lib/offlineQueue'
import './styles.css'

const qc = new QueryClient()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
)

if (typeof window !== 'undefined') {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
  if (navigator.onLine) {
    flushQueue().catch(() => {})
  }
}
