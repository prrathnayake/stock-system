import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { clearTokens, getAccessToken, getUserProfile, setTokens, setUserProfile } from '../lib/auth';

const AuthContext = createContext(null);

function normalizeUser(value) {
  if (!value) return null;
  return {
    ...value,
    ui_variant: value.ui_variant || 'pro'
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      const cachedUser = getUserProfile();
      setUser(normalizeUser(cachedUser));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const variant = user?.ui_variant || 'pro';
    document.documentElement.dataset.uiVariant = variant;
    return () => {
      document.documentElement.dataset.uiVariant = '';
    };
  }, [user?.ui_variant]);

  const login = async (organization, email, password) => {
    const { data } = await api.post('/auth/login', { organization, email, password });
    const normalizedUser = normalizeUser(data.user);
    setTokens(data.access, data.refresh);
    setUserProfile(normalizedUser);
    setUser(normalizedUser);
    return normalizedUser;
  };

  const logout = () => {
    clearTokens();
    setUser(null);
  };

  const value = useMemo(() => ({
    user,
    organization: user?.organization || null,
    isAuthenticated: Boolean(user && getAccessToken()),
    loading,
    login,
    logout,
    setUser
  }), [user, loading]);

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
