import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import FirstLogin from '../pages/FirstLogin.jsx';
import Inventory from '../pages/Inventory.jsx';
import Login from '../pages/Login.jsx';
import Scan from '../pages/Scan.jsx';
import Settings from '../pages/Settings.jsx';
import Invoices from '../pages/Invoices.jsx';
import WorkOrders from '../pages/WorkOrders.jsx';
import Sales from '../pages/Sales.jsx';
import { useAuth } from '../providers/AuthProvider.jsx';

function ProtectedRoute({ children, allowDuringCredentialReset = false }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (user?.must_change_password) {
    if (allowDuringCredentialReset) {
      return children;
    }
    return <Navigate to="/first-login" replace />;
  }
  if (allowDuringCredentialReset) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function PublicRoute({ children }) {
  const { isAuthenticated, user } = useAuth();
  if (isAuthenticated) {
    if (user?.must_change_password) {
      return <Navigate to="/first-login" replace />;
    }
    return <Navigate to="/" replace />;
  }
  return children;
}

function RoleRoute({ children, roles }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function InvoicingRoute({ children }) {
  const { organization } = useAuth();
  if (organization?.invoicing_enabled === false) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={(
            <PublicRoute>
              <Login />
            </PublicRoute>
          )}
        />
        <Route
          path="/first-login"
          element={(
            <ProtectedRoute allowDuringCredentialReset>
              <FirstLogin />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/"
          element={(
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          )}
        >
          <Route index element={<Dashboard />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="sales" element={<Sales />} />
          <Route
            path="invoices"
            element={(<RoleRoute roles={['admin']}><InvoicingRoute><Invoices /></InvoicingRoute></RoleRoute>)}
          />
          <Route
            path="work-orders"
            element={<RoleRoute roles={['admin', 'user']}><WorkOrders /></RoleRoute>}
          />
          <Route path="scan" element={<Scan />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
