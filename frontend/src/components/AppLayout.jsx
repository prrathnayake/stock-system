import React, { useMemo } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../providers/AuthProvider.jsx'
import { useTheme } from '../providers/ThemeProvider.jsx'

export default function AppLayout() {
  const { user, logout, organization } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const variant = user?.ui_variant || 'pro'

  const brandName = organization?.name || user?.organization?.name || 'Repair Center'
  const brandSubtitle = organization?.legal_name || 'Operations Suite'
  const brandLogo = organization?.logo_asset_url || organization?.logo_url

  const navItems = useMemo(() => ([
    { to: '/', label: 'Dashboard', end: true, roles: ['admin', 'user'] },
    { to: '/inventory', label: variant === 'tabular' ? 'Inventory Table' : 'Inventory', roles: ['admin', 'user'] },
    { to: '/invoices', label: 'Invoices', roles: ['admin'] },
    { to: '/scan', label: variant === 'minimal' ? 'Quick scan' : 'Scan', roles: ['admin', 'user'] },
    { to: '/work-orders', label: variant === 'visual' ? 'Service queue' : 'Work Orders', roles: ['admin'] },
    { to: '/settings', label: user?.role === 'admin' ? 'Administration' : 'Settings', roles: ['admin', 'user'] }
  ]), [user?.role, variant])

  const pageTitle = useMemo(() => {
    const match = navItems.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)))
    return match ? match.label : 'Dashboard'
  }, [location.pathname, navItems])

  return (
    <div className={`layout layout--${variant}`}>
      <aside className="sidebar">
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
      <div className="main">
        <header className="topbar">
          <div>
            <h1 className="topbar__title">{pageTitle}</h1>
            <p className="topbar__subtitle">{organization?.legal_name || organization?.name || user?.organization?.name || 'Operational insights and control center'}</p>
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
