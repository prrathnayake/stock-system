import React, { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../providers/AuthProvider.jsx'
import { useTheme } from '../providers/ThemeProvider.jsx'

export default function AppLayout() {
  const { user, logout, organization } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const variant = user?.ui_variant || 'pro'
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return !window.matchMedia('(max-width: 960px)').matches
  })
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 960px)').matches
  })

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

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev)
  }

  const closeSidebar = () => {
    setIsSidebarOpen(false)
  }

  const brandName = organization?.name || user?.organization?.name || 'Repair Center'
  const brandSubtitle = organization?.legal_name || 'Operations Suite'
  const brandLogo = organization?.logo_asset_url || organization?.logo_url

  const navItems = useMemo(() => {
    const items = [
      { to: '/', label: 'Dashboard', end: true, roles: ['admin', 'user'] },
      { to: '/inventory', label: variant === 'tabular' ? 'Inventory Table' : 'Inventory', roles: ['admin', 'user'] },
      { to: '/invoices', label: 'Invoices', roles: ['admin'] },
      { to: '/scan', label: variant === 'minimal' ? 'Quick scan' : 'Scan', roles: ['admin', 'user'] },
      { to: '/work-orders', label: variant === 'visual' ? 'Service queue' : 'Work Orders', roles: ['admin'] },
      { to: '/settings', label: user?.role === 'admin' ? 'Administration' : 'Settings', roles: ['admin', 'user'] }
    ];
    if (organization?.invoicing_enabled === false) {
      return items.filter((item) => item.to !== '/invoices');
    }
    return items;
  }, [user?.role, variant, organization?.invoicing_enabled])

  const pageTitle = useMemo(() => {
    const match = navItems.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)))
    return match ? match.label : 'Dashboard'
  }, [location.pathname, navItems])

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
            <p className="sidebar__subtitle">{brandSubtitle}</p>
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
        <div className="sidebar__footer">
          <button className="sidebar__logout" onClick={logout}>Log out</button>
        </div>
      </aside>
      {isMobile && (
        <div
          className={`sidebar__backdrop${isSidebarOpen ? ' sidebar__backdrop--visible' : ''}`}
          role="presentation"
          onClick={closeSidebar}
        />
      )}
      <div className="main">
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
            <button className="button button--ghost" type="button" onClick={toggleTheme}>
              {theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}
            </button>
            <div className="topbar__user">
              <span className="avatar">{(user?.name || user?.email || 'U').slice(0, 1).toUpperCase()}</span>
              <div>
                <p className="avatar__name">{user?.name || 'User'}</p>
                <p className="avatar__role">{user?.role || 'team member'}</p>
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
