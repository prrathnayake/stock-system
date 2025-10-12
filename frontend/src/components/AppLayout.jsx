import React, { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../providers/AuthProvider.jsx'
import { useTheme } from '../providers/ThemeProvider.jsx'
import { APP_NAME, ORGANIZATION_TYPES } from '../lib/appInfo.js'

export default function AppLayout() {
  const { user, logout, organization } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const variant = user?.ui_variant || 'pro'
  const features = organization?.features || {}
  const barcodeEnabled = features.barcode_scanning_enabled !== false
  const workOrdersEnabled = features.work_orders_enabled !== false
  const salesEnabled = features.sales_module_enabled !== false
  const operationsEnabled = features.operations_module_enabled !== false
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return !window.matchMedia('(max-width: 960px)').matches
  })
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 960px)').matches
  })
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [routeLoading, setRouteLoading] = useState(false)
  const menuRef = useRef(null)
  const loaderTimer = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const media = window.matchMedia('(max-width: 960px)')
    const updateState = () => {
      const mobile = media.matches
      setIsMobile(mobile)
      setIsSidebarOpen((prev) => {
        const next = mobile ? false : true
        return prev === next ? prev : next
      })
    }
    updateState()
    media.addEventListener('change', updateState)
    return () => media.removeEventListener('change', updateState)
  }, [])

  useEffect(() => {
    if (!isMobile) return
    setIsSidebarOpen(false)
  }, [location.pathname, isMobile])

  useEffect(() => {
    if (!user?.transition_loading_enabled) {
      setRouteLoading(false)
      return undefined
    }
    if (loaderTimer.current) {
      window.clearTimeout(loaderTimer.current)
    }
    setRouteLoading(true)
    loaderTimer.current = window.setTimeout(() => {
      setRouteLoading(false)
      loaderTimer.current = null
    }, 450)
    return () => {
      if (loaderTimer.current) {
        window.clearTimeout(loaderTimer.current)
        loaderTimer.current = null
      }
    }
  }, [location.pathname, user?.transition_loading_enabled])

  useEffect(() => () => {
    if (loaderTimer.current) {
      window.clearTimeout(loaderTimer.current)
      loaderTimer.current = null
    }
  }, [])

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev)
  }

  const closeSidebar = () => {
    setIsSidebarOpen(false)
  }

  const handleProfileToggle = () => {
    setIsMenuOpen((prev) => !prev)
  }

  const handleProfileNavigate = (hash = '') => {
    setIsMenuOpen(false)
    const destination = hash ? `/settings${hash}` : '/settings'
    navigate(destination)
  }

  const handleLogout = () => {
    setIsMenuOpen(false)
    logout()
  }

  const activeType = organization?.type || user?.organization?.type || ''
  const typeInfo = ORGANIZATION_TYPES.find((item) => item.id === activeType)
  const brandName = organization?.name || user?.organization?.name || APP_NAME
  const brandSubtitle = organization?.legal_name || typeInfo?.label || 'Operations Suite'
  const brandLogo = organization?.logo_asset_url || organization?.logo_url

  const privilegedRoles = ['admin', 'developer']

  const navItems = useMemo(() => {
    const items = [
      { to: '/', label: 'Dashboard', end: true, roles: ['admin', 'user', 'developer'] },
      { to: '/inventory', label: variant === 'tabular' ? 'Inventory Table' : 'Inventory', roles: ['admin', 'user', 'developer'] },
      { to: '/operations', label: 'Operations', roles: ['admin', 'user', 'developer'] },
      { to: '/storage-bins', label: 'Branch locations', roles: ['admin', 'user', 'developer'] },
      { to: '/sales', label: 'Sales', roles: ['admin', 'user', 'developer'] },
      { to: '/invoices', label: 'Invoices', roles: ['admin', 'developer'] },
      { to: '/scan', label: variant === 'minimal' ? 'Quick scan' : 'Scan', roles: ['admin', 'user', 'developer'] },
      { to: '/work-orders', label: variant === 'visual' ? 'Service queue' : 'Work Orders', roles: ['admin', 'user', 'developer'] },
      { to: '/settings', label: privilegedRoles.includes(user?.role) ? 'Administration' : 'Settings', roles: ['admin', 'user', 'developer'] }
    ];
    let filtered = items
    if (organization?.invoicing_enabled === false) {
      filtered = filtered.filter((item) => item.to !== '/invoices')
    }
    if (!barcodeEnabled) {
      filtered = filtered.filter((item) => item.to !== '/scan')
    }
    if (!operationsEnabled) {
      filtered = filtered.filter((item) => item.to !== '/operations')
    }
    if (!salesEnabled) {
      filtered = filtered.filter((item) => item.to !== '/sales')
    }
    if (!workOrdersEnabled) {
      filtered = filtered.filter((item) => item.to !== '/work-orders')
    }
    return filtered
  }, [
    user?.role,
    variant,
    organization?.invoicing_enabled,
    barcodeEnabled,
    operationsEnabled,
    salesEnabled,
    workOrdersEnabled
  ])

  const quickLinks = useMemo(() => (
    [
      { to: '/', label: 'Home', roles: ['admin', 'user', 'developer'] },
      { to: '/inventory', label: 'Inventory', roles: ['admin', 'user', 'developer'] },
      operationsEnabled ? { to: '/operations', label: 'Operations', roles: ['admin', 'user', 'developer'] } : null,
      { to: '/storage-bins', label: 'Branch locations', roles: ['admin', 'user', 'developer'] },
      salesEnabled ? { to: '/sales', label: 'Sales', roles: ['admin', 'user', 'developer'] } : null,
      workOrdersEnabled ? { to: '/work-orders', label: 'Work orders', roles: ['admin', 'user', 'developer'] } : null
    ]
      .filter(Boolean)
      .filter((item) => (!item.roles || item.roles.includes(user?.role)))
  ), [user?.role, operationsEnabled, salesEnabled, workOrdersEnabled])

  const pageTitle = useMemo(() => {
    const match = navItems.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)))
    return match ? match.label : 'Dashboard'
  }, [location.pathname, navItems])

  useEffect(() => {
    if (!isMenuOpen) return undefined
    const handlePointerDown = (event) => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(event.target)) {
        setIsMenuOpen(false)
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMenuOpen])

  useEffect(() => {
    setIsMenuOpen(false)
  }, [location.pathname])

  return (
    <div
      className={`layout layout--${variant} ${isSidebarOpen ? 'layout--sidebar-open' : 'layout--sidebar-collapsed'}${isMobile ? ' layout--mobile' : ''}`}
    >
      <aside
        className="sidebar"
        id="app-sidebar"
        aria-hidden={!isSidebarOpen}
      >
        <div className="sidebar__brand">
          {brandLogo ? (
            <img className="sidebar__logo" src={brandLogo} alt={`${brandName} logo`} />
          ) : (
            <span className="sidebar__dot" />
          )}
          <div>
            <p className="sidebar__title">{brandName}</p>
            <p className="sidebar__subtitle" title={typeInfo?.description || brandSubtitle}>{brandSubtitle}</p>
          </div>
        </div>
        <nav className="sidebar__nav">
          {navItems
            .filter((item) => !item.roles || item.roles.includes(user?.role))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
        </nav>
      </aside>
      {isMobile && (
        <div
          className={`sidebar__backdrop${isSidebarOpen ? ' sidebar__backdrop--visible' : ''}`}
          role="presentation"
          onClick={closeSidebar}
        />
      )}
      <div className="main">
        {routeLoading && (
            <div className="route-loader" role="status" aria-live="polite">
              <div className="route-loader__panel">
                <div className="route-loader__spinner" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <p className="route-loader__text">Preparing your workspace…</p>
              </div>
            </div>
          )}
        <header className="topbar">
          <div className="topbar__lead">
            <button
              className="button button--ghost topbar__menu-button"
              type="button"
              onClick={toggleSidebar}
              aria-controls="app-sidebar"
              aria-expanded={isSidebarOpen}
            >
              {isSidebarOpen ? 'Hide menu' : 'Show menu'}
            </button>
            <div>
              <h1 className="topbar__title">{pageTitle}</h1>
              <p className="topbar__subtitle">{organization?.legal_name || organization?.name || user?.organization?.name || 'Operational insights and control center'}</p>
            </div>
          </div>
          <div className="topbar__actions">
            <nav className="topbar__quick-nav" aria-label="Quick navigation">
              {quickLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => `topbar__quick-link${isActive ? ' topbar__quick-link--active' : ''}`}
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
            <button className="button button--ghost" type="button" onClick={toggleTheme}>
              {theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}
            </button>
            <div className="topbar__profile" ref={menuRef}>
              <button
                className="topbar__profile-button"
                type="button"
                onClick={handleProfileToggle}
                aria-haspopup="true"
                aria-expanded={isMenuOpen}
              >
                <span className="avatar">{(user?.name || user?.email || 'U').slice(0, 1).toUpperCase()}</span>
                <span className="topbar__profile-label">
                  <span className="topbar__profile-name">{user?.name || user?.email || 'User'}</span>
                  <span className="topbar__profile-role">{user?.role || 'team member'}</span>
                </span>
                <span className="topbar__profile-caret" aria-hidden="true">▾</span>
              </button>
              <div className={`topbar__profile-menu${isMenuOpen ? ' topbar__profile-menu--open' : ''}`} role="menu">
                <button
                  type="button"
                  className="topbar__profile-item"
                  onClick={() => handleProfileNavigate('#profile')}
                  role="menuitem"
                >
                  Personal preferences
                </button>
                <button
                  type="button"
                  className="topbar__profile-item"
                  onClick={() => handleProfileNavigate('')}
                  role="menuitem"
                >
                  Workspace settings
                </button>
                {user?.role === 'admin' && (
                  <button
                    type="button"
                    className="topbar__profile-item"
                    onClick={() => handleProfileNavigate('#team')}
                    role="menuitem"
                  >
                    User management
                  </button>
                )}
                <div className="topbar__profile-separator" role="presentation" />
                <button
                  type="button"
                  className="topbar__profile-item topbar__profile-item--danger"
                  onClick={handleLogout}
                  role="menuitem"
                >
                  Log out
                </button>
              </div>
            </div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
