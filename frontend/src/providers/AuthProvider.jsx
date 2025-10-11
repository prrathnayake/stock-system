import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { clearTokens, getAccessToken, getUserProfile, setTokens, setUserProfile } from '../lib/auth';
import { resolveAssetUrl } from '../lib/urls';

const AuthContext = createContext(null);

function normalizeOrganization(value) {
  if (!value) return null;
  const rawLogo = value.logo_url || '';
  const logoVersion = value.logo_updated_at || value.logoUpdatedAt || null;
  const resolvedLogo = resolveAssetUrl(rawLogo);
  const versionedLogo = resolvedLogo && logoVersion
    ? `${resolvedLogo}${resolvedLogo.includes('?') ? '&' : '?'}v=${encodeURIComponent(logoVersion)}`
    : resolvedLogo;
  return {
    ...value,
    name: value.name || '',
    legal_name: value.legal_name || '',
    contact_email: value.contact_email || '',
    timezone: value.timezone || '',
    abn: value.abn || '',
    tax_id: value.tax_id || '',
    address: value.address || '',
    phone: value.phone || '',
    website: value.website || '',
    logo_url: rawLogo,
    logo_asset_url: versionedLogo,
    logo_updated_at: logoVersion,
    type: value.type || '',
    invoice_prefix: value.invoice_prefix || '',
    default_payment_terms: value.default_payment_terms || '',
    invoice_notes: value.invoice_notes || '',
    currency: value.currency || 'AUD',
    invoicing_enabled: value.invoicing_enabled !== false,
    banner_images: Array.isArray(value.banner_images)
      ? value.banner_images.filter((item) => typeof item === 'string' && item.trim().length > 0)
      : []
  };
}

function normalizeUser(value) {
  if (!value) return null;
  return {
    ...value,
    ui_variant: value.ui_variant || 'pro',
    organization: normalizeOrganization(value.organization)
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

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
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
