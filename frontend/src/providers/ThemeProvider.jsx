import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

const ThemeContext = createContext(null)
const STORAGE_KEY = 'ui_theme_mode'
const prefersDark = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') {
      return stored
    }
    return prefersDark() ? 'dark' : 'light'
  })

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, theme)
    }
  }, [theme])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const listener = (event) => {
      setTheme((current) => {
        const stored = window.localStorage.getItem(STORAGE_KEY)
        if (stored === 'light' || stored === 'dark') {
          return stored
        }
        return event.matches ? 'dark' : 'light'
      })
    }
    media.addEventListener?.('change', listener)
    return () => media.removeEventListener?.('change', listener)
  }, [])

  const value = useMemo(() => ({
    theme,
    setTheme,
    toggleTheme: () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }), [theme])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
