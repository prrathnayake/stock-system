import React, { useMemo } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../providers/AuthProvider.jsx';

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/inventory', label: 'Inventory' },
  { to: '/work-orders', label: 'Work Orders' },
  { to: '/scan', label: 'Scan' },
  { to: '/settings', label: 'Settings', roles: ['admin'] }
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const pageTitle = useMemo(() => {
    const match = navItems.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)));
    return match ? match.label : 'Dashboard';
  }, [location.pathname]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__dot" />
          <div>
            <p className="sidebar__title">Repair Center</p>
            <p className="sidebar__subtitle">Inventory Suite</p>
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
            <p className="topbar__subtitle">Operational insights and control center</p>
          </div>
          <div className="topbar__user">
            <span className="avatar">{(user?.name || user?.email || 'U').slice(0, 1).toUpperCase()}</span>
            <div>
              <p className="avatar__name">{user?.name || 'User'}</p>
              <p className="avatar__role">{user?.role || 'team member'}</p>
            </div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
