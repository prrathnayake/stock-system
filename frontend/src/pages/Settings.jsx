import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../providers/AuthProvider.jsx'
import { api } from '../lib/api'
import { getAccessToken, setUserProfile as persistUserProfile } from '../lib/auth'
import { resolveAssetUrl } from '../lib/urls'

const uiVariants = [
  {
    id: 'pro',
    name: 'Professional',
    description: 'Balanced layout with charts, tables and actionable KPIs.'
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Graph-focused workspace for performance tracking and forecasting.'
  },
  {
    id: 'tabular',
    name: 'Tabular',
    description: 'High-density tables optimised for bulk operations and data entry.'
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Distraction-free controls with simplified navigation for rapid work.'
  },
  {
    id: 'visual',
    name: 'Visual',
    description: 'Large charts and tiles for status-at-a-glance monitoring.'
  }
]

export default function Settings() {
  const { user, setUser, organization } = useAuth()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin'
  const activeVariant = uiVariants.find((variant) => variant.id === (user?.ui_variant || 'pro')) || uiVariants[0]

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data } = await api.get('/settings')
      return data
    },
    enabled: isAdmin
  })

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await api.get('/users')
      return data
    },
    enabled: isAdmin
  })

  const [userSearch, setUserSearch] = useState('')

  const filteredUsers = useMemo(() => {
    if (!userSearch) return users
    const term = userSearch.toLowerCase()
    return users.filter((account) => {
      const name = (account.full_name || '').toLowerCase()
      const email = (account.email || '').toLowerCase()
      const role = (account.role || '').toLowerCase()
      return name.includes(term) || email.includes(term) || role.includes(term)
    })
  }, [users, userSearch])

  const { data: backups = [] } = useQuery({
    queryKey: ['backups'],
    queryFn: async () => {
      const { data } = await api.get('/backups')
      return data?.backups || []
    },
    enabled: isAdmin
  })

  const { data: activities = [] } = useQuery({
    queryKey: ['user-activities'],
    queryFn: async () => {
      const { data } = await api.get('/users/activities')
      return data
    },
    enabled: isAdmin
  })

  const { data: organizationDetails } = useQuery({
    queryKey: ['organization'],
    queryFn: async () => {
      const { data } = await api.get('/organization')
      return data
    },
    enabled: isAdmin
  })

  const [formState, setFormState] = useState({
    low_stock_alerts_enabled: true,
    default_sla_hours: 24,
    notification_emails: '',
    backup_enabled: false,
    backup_schedule: '0 3 * * *',
    backup_retain_days: 14
  })
  const [banner, setBanner] = useState(null)
  const [userBanner, setUserBanner] = useState(null)
  const [preferencesBanner, setPreferencesBanner] = useState(null)
  const [userForm, setUserForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'user',
    must_change_password: true,
    ui_variant: 'pro'
  })
  const [editingUser, setEditingUser] = useState(null)
  const [editForm, setEditForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'user',
    must_change_password: false,
    ui_variant: 'pro'
  })
  const [selectedVariant, setSelectedVariant] = useState(user?.ui_variant || 'pro')
  const [orgBanner, setOrgBanner] = useState(null)
  const [orgForm, setOrgForm] = useState({
    name: organization?.name || user?.organization?.name || '',
    contact_email: organization?.contact_email || '',
    legal_name: organization?.legal_name || '',
    timezone: organization?.timezone || '',
    abn: organization?.abn || '',
    tax_id: organization?.tax_id || '',
    address: organization?.address || '',
    phone: organization?.phone || '',
    website: organization?.website || '',
    logo_url: organization?.logo_url || '',
    invoice_prefix: organization?.invoice_prefix || '',
    default_payment_terms: organization?.default_payment_terms || '',
    invoice_notes: organization?.invoice_notes || '',
    currency: organization?.currency || 'AUD',
    invoicing_enabled: organization?.invoicing_enabled !== false
  })
  const [logoPreview, setLogoPreview] = useState(resolveAssetUrl(organization?.logo_url || ''))

  useEffect(() => {
    if (settingsData) {
      setFormState({
        low_stock_alerts_enabled: settingsData.low_stock_alerts_enabled !== false,
        default_sla_hours: settingsData.default_sla_hours ?? 24,
        notification_emails: Array.isArray(settingsData.notification_emails)
          ? settingsData.notification_emails.join(', ')
          : '',
        backup_enabled: settingsData.backup_enabled !== false,
        backup_schedule: settingsData.backup_schedule || '0 3 * * *',
        backup_retain_days: settingsData.backup_retain_days ?? 14
      })
    }
  }, [settingsData])

  useEffect(() => {
    setSelectedVariant(user?.ui_variant || 'pro')
  }, [user?.ui_variant])

  useEffect(() => {
    if (organizationDetails) {
      setOrgForm({
        name: organizationDetails.name || '',
        legal_name: organizationDetails.legal_name || '',
        contact_email: organizationDetails.contact_email || '',
        timezone: organizationDetails.timezone || '',
        abn: organizationDetails.abn || '',
        tax_id: organizationDetails.tax_id || '',
        address: organizationDetails.address || '',
        phone: organizationDetails.phone || '',
        website: organizationDetails.website || '',
        logo_url: organizationDetails.logo_url || '',
        invoice_prefix: organizationDetails.invoice_prefix || '',
        default_payment_terms: organizationDetails.default_payment_terms || '',
        invoice_notes: organizationDetails.invoice_notes || '',
        currency: organizationDetails.currency || 'AUD',
        invoicing_enabled: organizationDetails.invoicing_enabled !== false
      })
      setLogoPreview(resolveAssetUrl(organizationDetails.logo_url || ''))
    }
  }, [organizationDetails])

  useEffect(() => {
    setLogoPreview(resolveAssetUrl(orgForm.logo_url || ''))
  }, [orgForm.logo_url])

  const settingsMutation = useMutation({
    mutationFn: async (payload) => {
      const response = await api.put('/settings', payload)
      return response
    },
    onSuccess: (response) => {
      if (response?.data?.offline) {
        setBanner('Offline update queued. Settings will sync when back online.')
      } else {
        setBanner('Settings saved successfully.')
      }
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    }
  })

  const preferencesMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.put('/users/me/preferences', payload)
      return data
    },
    onSuccess: (updated) => {
      const merged = {
        ...user,
        ...updated,
        name: updated.full_name || updated.name || user?.name,
        ui_variant: updated.ui_variant || selectedVariant
      }
      setUser(merged)
      persistUserProfile(merged)
      setPreferencesBanner({ type: 'success', message: 'Interface preferences updated.' })
    },
    onError: (error) => {
      setPreferencesBanner({ type: 'error', message: error.response?.data?.error || 'Unable to save preferences.' })
    }
  })

  const createUserMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/users', payload)
      return data
    },
    onSuccess: () => {
      setUserBanner({ type: 'success', message: 'User account created successfully.' })
      setUserForm({
        full_name: '',
        email: '',
        password: '',
        role: 'user',
        must_change_password: true,
        ui_variant: 'pro'
      })
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => {
      setUserBanner({ type: 'error', message: error.response?.data?.error || 'Unable to create user.' })
    }
  })

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, payload }) => {
      const { data } = await api.put(`/users/${id}`, payload)
      return data
    },
    onSuccess: (updatedUser) => {
      setUserBanner({ type: 'success', message: 'User details updated successfully.' })
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setEditingUser(null)
      setEditForm({
        full_name: '',
        email: '',
        password: '',
        role: 'user',
        must_change_password: false,
        ui_variant: 'pro'
      })
      if (updatedUser?.id === user?.id) {
        const merged = {
          ...user,
          ...updatedUser,
          name: updatedUser.full_name
        }
        setUser(merged)
        persistUserProfile(merged)
      }
    },
    onError: (error) => {
      setUserBanner({ type: 'error', message: error.response?.data?.error || 'Unable to update user.' })
    }
  })

  const deleteUserMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/users/${id}`)
    },
    onSuccess: (_data, id) => {
      setUserBanner({ type: 'success', message: 'User removed successfully.' })
      if (editingUser?.id === id) {
        setEditingUser(null)
        setEditForm({
          full_name: '',
          email: '',
          password: '',
          role: 'user',
          must_change_password: false
        })
      }
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => {
      setUserBanner({ type: 'error', message: error.response?.data?.error || 'Unable to remove user.' })
    }
  })

  const organizationMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.put('/organization', payload)
      return data
    },
    onSuccess: (data) => {
      setOrgBanner({ type: 'success', message: 'Organization profile updated.' })
      setOrgForm({
        name: data.name || '',
        legal_name: data.legal_name || '',
        contact_email: data.contact_email || '',
        timezone: data.timezone || '',
        abn: data.abn || '',
        tax_id: data.tax_id || '',
        address: data.address || '',
        phone: data.phone || '',
        website: data.website || '',
        logo_url: data.logo_url || '',
        invoice_prefix: data.invoice_prefix || '',
        default_payment_terms: data.default_payment_terms || '',
        invoice_notes: data.invoice_notes || '',
        currency: data.currency || 'AUD',
        invoicing_enabled: data.invoicing_enabled !== false
      })
      queryClient.invalidateQueries({ queryKey: ['organization'] })
      setLogoPreview(resolveAssetUrl(data.logo_url || ''))
      updateCachedOrganization(data)
    },
    onError: (error) => {
      setOrgBanner({ type: 'error', message: error.response?.data?.error || 'Unable to update organization.' })
    }
  })

  const updateCachedOrganization = (data) => {
    if (!user) return
    const logoUrl = data.logo_url || ''
    const mergedOrg = {
      ...(user.organization || {}),
      id: data.id ?? user.organization?.id ?? null,
      name: data.name ?? user.organization?.name ?? '',
      slug: data.slug ?? user.organization?.slug ?? '',
      contact_email: data.contact_email ?? user.organization?.contact_email ?? '',
      timezone: data.timezone ?? user.organization?.timezone ?? '',
      legal_name: data.legal_name ?? user.organization?.legal_name ?? '',
      abn: data.abn ?? user.organization?.abn ?? '',
      tax_id: data.tax_id ?? user.organization?.tax_id ?? '',
      address: data.address ?? user.organization?.address ?? '',
      phone: data.phone ?? user.organization?.phone ?? '',
      website: data.website ?? user.organization?.website ?? '',
      logo_url: logoUrl,
      logo_asset_url: resolveAssetUrl(logoUrl),
      invoice_prefix: data.invoice_prefix ?? user.organization?.invoice_prefix ?? '',
      default_payment_terms: data.default_payment_terms ?? user.organization?.default_payment_terms ?? '',
      invoice_notes: data.invoice_notes ?? user.organization?.invoice_notes ?? '',
      currency: data.currency ?? user.organization?.currency ?? 'AUD',
      invoicing_enabled: data.invoicing_enabled !== undefined
        ? data.invoicing_enabled
        : (user.organization?.invoicing_enabled !== false)
    }
    const mergedUser = {
      ...user,
      organization: mergedOrg
    }
    setUser(mergedUser)
    persistUserProfile(mergedUser)
  }

  const uploadLogoMutation = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData()
      formData.append('logo', file)
      const { data } = await api.post('/organization/logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      return data
    },
    onSuccess: (data) => {
      const nextLogo = data.logo_url || ''
      setOrgForm((prev) => ({ ...prev, logo_url: nextLogo }))
      setLogoPreview(resolveAssetUrl(nextLogo))
      setOrgBanner({ type: 'info', message: 'Logo updated successfully.' })
      queryClient.invalidateQueries({ queryKey: ['organization'] })
      updateCachedOrganization(data)
    },
    onError: (error) => {
      setOrgBanner({ type: 'error', message: error.response?.data?.error || 'Unable to upload logo.' })
    }
  })

  const runBackupMutation = useMutation({
    mutationFn: async () => {
      await api.post('/backups/run')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      setBanner('Backup started successfully. Refresh in a moment to see the new snapshot.')
    },
    onError: (error) => {
      setBanner(error.response?.data?.error || 'Unable to trigger backup right now.')
    }
  })

  const handleSavePreferences = (event) => {
    event.preventDefault()
    setPreferencesBanner(null)
    preferencesMutation.mutate({ ui_variant: selectedVariant })
  }

  const handleLogoUpload = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setOrgBanner({ type: 'error', message: 'Please upload a PNG or JPG image.' })
      event.target.value = ''
      return
    }
    const input = event.target
    setOrgBanner(null)
    uploadLogoMutation.mutate(file, {
      onSettled: () => {
        input.value = ''
      }
    })
  }

  const toggleInvoicing = () => {
    setOrgForm((prev) => ({
      ...prev,
      invoicing_enabled: !prev.invoicing_enabled
    }))
  }

  const handleOrganizationSubmit = (event) => {
    event.preventDefault()
    setOrgBanner(null)
    const payload = {
      name: orgForm.name.trim(),
      contact_email: orgForm.contact_email.trim(),
      legal_name: orgForm.legal_name.trim(),
      timezone: orgForm.timezone.trim(),
      abn: orgForm.abn.trim(),
      tax_id: orgForm.tax_id.trim(),
      address: orgForm.address.trim(),
      phone: orgForm.phone.trim(),
      website: orgForm.website.trim(),
      logo_url: orgForm.logo_url.trim(),
      invoice_prefix: orgForm.invoice_prefix.trim(),
      default_payment_terms: orgForm.default_payment_terms.trim(),
      invoice_notes: orgForm.invoice_notes.trim(),
      currency: orgForm.currency.trim(),
      invoicing_enabled: Boolean(orgForm.invoicing_enabled)
    }
    if (!payload.name) {
      setOrgBanner({ type: 'error', message: 'Organization name is required.' })
      return
    }
    if (!payload.contact_email) delete payload.contact_email
    if (!payload.legal_name) delete payload.legal_name
    if (!payload.timezone) delete payload.timezone
    if (!payload.abn) delete payload.abn
    if (!payload.tax_id) delete payload.tax_id
    if (!payload.address) delete payload.address
    if (!payload.phone) delete payload.phone
    if (!payload.website) delete payload.website
    if (!payload.logo_url) delete payload.logo_url
    if (!payload.invoice_prefix) delete payload.invoice_prefix
    if (!payload.default_payment_terms) delete payload.default_payment_terms
    if (!payload.invoice_notes) delete payload.invoice_notes
    if (!payload.currency) {
      delete payload.currency
    } else {
      payload.currency = payload.currency.toUpperCase()
    }
    organizationMutation.mutate(payload)
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const payload = {
      low_stock_alerts_enabled: formState.low_stock_alerts_enabled,
      default_sla_hours: Number(formState.default_sla_hours) || 0,
      notification_emails: formState.notification_emails
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean),
      backup_enabled: Boolean(formState.backup_enabled),
      backup_schedule: formState.backup_schedule.trim(),
      backup_retain_days: Number(formState.backup_retain_days) || 0
    }
    settingsMutation.mutate(payload)
  }

  const handleCreateUser = (event) => {
    event.preventDefault()
    setUserBanner(null)
    const payload = {
      full_name: userForm.full_name.trim(),
      email: userForm.email.trim(),
      password: userForm.password,
      role: userForm.role,
      must_change_password: Boolean(userForm.must_change_password),
      ui_variant: userForm.ui_variant
    }
    if (!payload.full_name || !payload.email || !payload.password) {
      setUserBanner({ type: 'error', message: 'All fields are required to create a user.' })
      return
    }
    createUserMutation.mutate(payload)
  }

  const handleStartEdit = (selected) => {
    setUserBanner(null)
    setEditingUser(selected)
    setEditForm({
      full_name: selected.full_name,
      email: selected.email,
      password: '',
      role: selected.role,
      must_change_password: Boolean(selected.must_change_password),
      ui_variant: selected.ui_variant || 'pro'
    })
  }

  const handleCancelEdit = () => {
    setEditingUser(null)
    setEditForm({
      full_name: '',
      email: '',
      password: '',
      role: 'user',
      must_change_password: false
    })
  }

  const handleUpdateUser = (event) => {
    event.preventDefault()
    if (!editingUser) return
    setUserBanner(null)
    const payload = {
      full_name: editForm.full_name.trim(),
      email: editForm.email.trim(),
      role: editForm.role,
      must_change_password: Boolean(editForm.must_change_password),
      ui_variant: editForm.ui_variant
    }
    if (editForm.password) {
      payload.password = editForm.password
    }
    updateUserMutation.mutate({ id: editingUser.id, payload })
  }

  const handleDeleteUser = (id) => {
    if (id === user?.id) {
      setUserBanner({ type: 'error', message: 'You cannot remove your own account.' })
      return
    }
    const confirmed = typeof window !== 'undefined' ? window.confirm('Remove this user account?') : true
    if (!confirmed) return
    setUserBanner(null)
    deleteUserMutation.mutate(id)
  }

  return (
    <div className="page">
      <div className="card">
        <h2>Account</h2>
        <div className="details-grid">
          <div>
            <span className="muted">Name</span>
            <p>{user?.name || '—'}</p>
          </div>
          <div>
            <span className="muted">Email</span>
            <p>{user?.email || '—'}</p>
          </div>
          <div>
            <span className="muted">Role</span>
            <p className="badge badge--muted">{user?.role || 'team member'}</p>
          </div>
          <div>
            <span className="muted">Organization</span>
            <p>{user?.organization?.name || '—'}</p>
          </div>
          <div>
            <span className="muted">Interface style</span>
            <p className="badge">{activeVariant.name}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <h2>Personal preferences</h2>
            <p className="muted">Tailor the interface to match how you like to work.</p>
          </div>
        </div>
        {preferencesBanner && (
          <div className={`banner banner--${preferencesBanner.type === 'error' ? 'danger' : 'info'}`}>
            {preferencesBanner.message}
          </div>
        )}
        <form className="variant-form" onSubmit={handleSavePreferences}>
          <div className="variant-grid">
            {uiVariants.map((variant) => (
              <label
                key={variant.id}
                className={`variant-option${selectedVariant === variant.id ? ' variant-option--active' : ''}`}
              >
                <input
                  type="radio"
                  name="ui-variant"
                  value={variant.id}
                  checked={selectedVariant === variant.id}
                  onChange={() => setSelectedVariant(variant.id)}
                />
                <div className="variant-option__body">
                  <div className={`variant-preview variant-preview--${variant.id}`} aria-hidden="true" />
                  <div>
                    <p className="variant-option__title">{variant.name}</p>
                    <p className="variant-option__description muted">{variant.description}</p>
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button className="button button--primary" type="submit" disabled={preferencesMutation.isLoading}>
              {preferencesMutation.isLoading ? 'Saving…' : 'Save preferences'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Deployment checklist</h2>
        <ul className="checklist">
          <li>
            <strong>Environment variables</strong>
            <p className="muted">Define secure JWT secrets, database credentials and the allowed CORS origin before going live.</p>
          </li>
          <li>
            <strong>Database backups</strong>
            <p className="muted">Schedule nightly backups of the MySQL database and verify the restoration procedure.</p>
          </li>
          <li>
            <strong>Access control</strong>
            <p className="muted">Provision accounts for staff using the admin console or SQL migrations.</p>
          </li>
          <li>
            <strong>Legal documents</strong>
            <p className="muted">Add your terms of service, privacy notice and any other required files to the repository.</p>
          </li>
        </ul>
      </div>

      {isAdmin && (
        <>
          <div className="card">
            <div className="card__header">
              <div>
                <h2>Organization profile</h2>
                <p className="muted">Manage branding, legal and invoicing defaults for this organization.</p>
              </div>
            </div>
            {orgBanner && (
              <div className={`banner banner--${orgBanner.type === 'error' ? 'danger' : 'info'}`}>
                {orgBanner.message}
              </div>
            )}
            <form className="form-grid" onSubmit={handleOrganizationSubmit}>
              <label className="field" data-help="Display name shown in navigation and dashboards.">
                <span>Organization name</span>
                <input
                  value={orgForm.name}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
              </label>
              <label className="field" data-help="Registered legal entity name used on invoices.">
                <span>Legal name</span>
                <input
                  value={orgForm.legal_name}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, legal_name: e.target.value }))}
                  placeholder="Registered business name"
                />
              </label>
              <label className="field" data-help="Primary address for alerts and administrative notifications.">
                <span>Notification email</span>
                <input
                  type="email"
                  value={orgForm.contact_email}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, contact_email: e.target.value }))}
                  placeholder="alerts@your-company.com"
                />
                <small className="muted">Administrative emails and backup alerts will be delivered here.</small>
              </label>
              <label className="field" data-help="Timezone used for due dates and scheduling.">
                <span>Timezone</span>
                <input
                  value={orgForm.timezone}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, timezone: e.target.value }))}
                  placeholder="e.g. America/New_York"
                />
              </label>
              <label className="field" data-help="Government-issued business number for compliance.">
                <span>ABN / business number</span>
                <input
                  value={orgForm.abn}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, abn: e.target.value }))}
                  placeholder="e.g. 12 345 678 901"
                />
              </label>
              <label className="field" data-help="Tax identifier displayed on quotes and invoices.">
                <span>Tax registration</span>
                <input
                  value={orgForm.tax_id}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, tax_id: e.target.value }))}
                  placeholder="VAT, GST or other tax ID"
                />
              </label>
              <label className="field field--span" data-help="Head office or registered trading address.">
                <span>Registered address</span>
                <textarea
                  rows={3}
                  value={orgForm.address}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, address: e.target.value }))}
                  placeholder="Street, city, state and postcode"
                />
              </label>
              <label className="field" data-help="Main phone number for customer contact.">
                <span>Support phone</span>
                <input
                  value={orgForm.phone}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="e.g. +61 2 1234 5678"
                />
              </label>
              <label className="field" data-help="Public website or knowledge base link for staff reference.">
                <span>Website</span>
                <input
                  value={orgForm.website}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, website: e.target.value }))}
                  placeholder="https://example.com"
                />
              </label>
              <label className="field field--span" data-help="Upload a PNG or JPG logo or provide a hosted link for branding.">
                <span>Brand logo</span>
                {logoPreview ? (
                  <div className="logo-preview">
                    <img src={logoPreview} alt="Logo preview" />
                  </div>
                ) : null}
                <div className="field__stack">
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={handleLogoUpload}
                    disabled={uploadLogoMutation.isLoading}
                  />
                  <input
                    value={orgForm.logo_url}
                    onChange={(e) => setOrgForm((prev) => ({ ...prev, logo_url: e.target.value }))}
                    placeholder="Link to hosted logo image"
                  />
                </div>
                <small className="muted">
                  {uploadLogoMutation.isLoading
                    ? 'Uploading logo…'
                    : 'PNG or JPG up to 2 MB. Leave blank to use the default system mark.'}
                </small>
              </label>
              <div className="field field--span">
                <span>Invoicing visibility</span>
                <div className="field__stack">
                  <button
                    type="button"
                    className={`button ${orgForm.invoicing_enabled ? 'button--ghost' : 'button--primary'}`}
                    onClick={toggleInvoicing}
                  >
                    {orgForm.invoicing_enabled ? 'Disable invoicing' : 'Enable invoicing'}
                  </button>
                  <small className="muted">
                    {orgForm.invoicing_enabled
                      ? 'Invoices are visible to admins. Disable to hide all invoicing features across the workspace.'
                      : 'Invoices are hidden for everyone. Enable to restore invoicing screens and defaults.'}
                  </small>
                </div>
              </div>
              <label className="field" data-help="Prefix automatically applied to new invoice numbers.">
                <span>Invoice prefix</span>
                <input
                  value={orgForm.invoice_prefix}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, invoice_prefix: e.target.value }))}
                  placeholder="e.g. INV- or JOB-"
                  disabled={!orgForm.invoicing_enabled}
                />
              </label>
              <label className="field" data-help="Default credit terms displayed on new invoices.">
                <span>Default payment terms</span>
                <input
                  value={orgForm.default_payment_terms}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, default_payment_terms: e.target.value }))}
                  placeholder="e.g. Net 14"
                  disabled={!orgForm.invoicing_enabled}
                />
              </label>
              <label className="field" data-help="Currency code used for pricing and billing.">
                <span>Default currency</span>
                <input
                  value={orgForm.currency}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, currency: e.target.value }))}
                  placeholder="e.g. AUD"
                  disabled={!orgForm.invoicing_enabled}
                />
              </label>
              <label className="field field--span" data-help="Standard footer text appended to every invoice.">
                <span>Default invoice notes</span>
                <textarea
                  rows={3}
                  value={orgForm.invoice_notes}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, invoice_notes: e.target.value }))}
                  placeholder="Displayed on all invoices by default"
                  disabled={!orgForm.invoicing_enabled}
                />
              </label>
              <div className="form-actions">
                <button className="button button--primary" type="submit" disabled={organizationMutation.isLoading}>
                  {organizationMutation.isLoading ? 'Saving…' : 'Save organization'}
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="card__header">
              <div>
                <h2>User management</h2>
                <p className="muted">Control who can access the platform and enforce secure practices.</p>
              </div>
            </div>
            {userBanner && (
              <div className={`banner banner--${userBanner.type === 'error' ? 'danger' : 'info'}`}>
                {userBanner.message}
              </div>
            )}
            <div className="grid split">
              <form className="form-grid" onSubmit={handleCreateUser}>
                <h3>Invite a team member</h3>
                <label className="field" data-help="Name shown to other teammates and on activity logs.">
                  <span>Full name</span>
                  <input
                    value={userForm.full_name}
                    onChange={(e) => setUserForm((prev) => ({ ...prev, full_name: e.target.value }))}
                    required
                  />
                </label>
                <label className="field" data-help="Work email address used to sign in and receive notifications.">
                  <span>Email</span>
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(e) => setUserForm((prev) => ({ ...prev, email: e.target.value }))}
                    required
                  />
                </label>
                <label className="field" data-help="Initial password the user must change after first login.">
                  <span>Temporary password</span>
                  <input
                    type="password"
                    value={userForm.password}
                    onChange={(e) => setUserForm((prev) => ({ ...prev, password: e.target.value }))}
                    required
                  />
                </label>
                <label className="field" data-help="Determines administrative permissions for the user.">
                  <span>Role</span>
                  <select
                    value={userForm.role}
                    onChange={(e) => setUserForm((prev) => ({ ...prev, role: e.target.value }))}
                  >
                    <option value="user">User</option>
                    <option value="admin">Administrator</option>
                  </select>
                </label>
                <label className="field" data-help="Preferred interface layout that loads after login.">
                  <span>Interface style</span>
                  <select
                    value={userForm.ui_variant}
                    onChange={(e) => setUserForm((prev) => ({ ...prev, ui_variant: e.target.value }))}
                  >
                    {uiVariants.map((variant) => (
                      <option key={variant.id} value={variant.id}>{variant.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field field--checkbox" data-help="Forces the invited user to set a personal password.">
                  <input
                    type="checkbox"
                    checked={userForm.must_change_password}
                    onChange={(e) => setUserForm((prev) => ({ ...prev, must_change_password: e.target.checked }))}
                  />
                  <span>Require password change on next login</span>
                </label>
                <div className="form-actions">
                  <button className="button button--primary" type="submit" disabled={createUserMutation.isLoading}>
                    {createUserMutation.isLoading ? 'Creating…' : 'Create user'}
                  </button>
                </div>
              </form>

              <div className="user-management">
                <div className="user-management__header">
                  <h3>Active users</h3>
                  <div className="user-management__search">
                    <label className="field">
                      <span>Search users</span>
                      <input
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        placeholder="Search by name, email or role"
                      />
                    </label>
                  </div>
                </div>
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Interface</th>
                      <th>Reset required</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="muted">
                          {users.length === 0
                            ? 'No additional users created yet.'
                            : 'No users match your search.'}
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((account) => (
                        <tr key={account.id}>
                          <td>{account.full_name}</td>
                          <td>{account.email}</td>
                          <td>
                            <span className={`badge badge--${account.role === 'admin' ? 'info' : 'muted'}`}>
                              {account.role}
                            </span>
                          </td>
                          <td>{(uiVariants.find((variant) => variant.id === account.ui_variant)?.name) || 'Professional'}</td>
                          <td>{account.must_change_password ? 'Yes' : 'No'}</td>
                          <td>{account.created_at ? new Date(account.created_at).toLocaleDateString() : '—'}</td>
                          <td className="table__actions">
                            <button
                              type="button"
                              className="button button--ghost button--small"
                              onClick={() => handleStartEdit(account)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="button button--ghost button--small"
                              onClick={() => handleDeleteUser(account.id)}
                              disabled={deleteUserMutation.isLoading}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                {editingUser && (
                  <form className="form-grid form-grid--inline" onSubmit={handleUpdateUser}>
                    <h4>Edit {editingUser.full_name}</h4>
                    <label className="field" data-help="Update the name that appears in user menus and logs.">
                      <span>Full name</span>
                      <input
                        value={editForm.full_name}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, full_name: e.target.value }))}
                        required
                      />
                    </label>
                    <label className="field" data-help="Change the email address used to sign in.">
                      <span>Email</span>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                        required
                      />
                    </label>
                    <label className="field" data-help="Adjust the user's access level.">
                      <span>Role</span>
                      <select
                        value={editForm.role}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, role: e.target.value }))}
                      >
                        <option value="user">User</option>
                        <option value="admin">Administrator</option>
                      </select>
                    </label>
                    <label className="field" data-help="Select the workspace layout this user will see by default.">
                      <span>Interface style</span>
                      <select
                        value={editForm.ui_variant}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, ui_variant: e.target.value }))}
                      >
                        {uiVariants.map((variant) => (
                          <option key={variant.id} value={variant.id}>{variant.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field" data-help="Optional reset to immediately change the account password.">
                      <span>New password</span>
                      <input
                        type="password"
                        value={editForm.password}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))}
                        placeholder="Leave blank to keep current password"
                      />
                    </label>
                    <label className="field field--checkbox" data-help="Prompt the user to pick a new password after this update.">
                      <input
                        type="checkbox"
                        checked={editForm.must_change_password}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, must_change_password: e.target.checked }))}
                      />
                      <span>Require password change on next login</span>
                    </label>
                    <div className="form-actions">
                      <button className="button button--primary" type="submit" disabled={updateUserMutation.isLoading}>
                        {updateUserMutation.isLoading ? 'Saving…' : 'Save user'}
                      </button>
                      <button className="button button--ghost button--small" type="button" onClick={handleCancelEdit}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__header">
              <div>
                <h2>Operational settings</h2>
                <p className="muted">Tune SLA targets, notifications and alerting without redeploying.</p>
              </div>
            </div>
            {banner && <div className="banner banner--info">{banner}</div>}
            <form className="form-grid" onSubmit={handleSubmit}>
              <label className="field" data-help="Toggle proactive notifications when products fall below reorder points.">
                <span>Low stock alerts</span>
                <select
                  value={formState.low_stock_alerts_enabled ? 'enabled' : 'disabled'}
                  onChange={(e) => setFormState((prev) => ({
                    ...prev,
                    low_stock_alerts_enabled: e.target.value === 'enabled'
                  }))}
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <label className="field" data-help="Target response time applied to new work orders.">
                <span>Default SLA window (hours)</span>
                <input
                  type="number"
                  min="0"
                  value={formState.default_sla_hours}
                  onChange={(e) => setFormState((prev) => ({ ...prev, default_sla_hours: e.target.value }))}
                />
              </label>
              <label className="field field--span" data-help="People alerted when escalations or SLA breaches occur.">
                <span>Escalation emails</span>
                <textarea
                  rows={2}
                  value={formState.notification_emails}
                  onChange={(e) => setFormState((prev) => ({ ...prev, notification_emails: e.target.value }))}
                  placeholder="ops@example.com, lead@example.com"
                />
                <p className="muted">Comma-separated list of recipients notified for SLA breaches.</p>
              </label>
              <label className="field" data-help="Enable scheduled exports of your database for recovery.">
                <span>Automatic backups</span>
                <select
                  value={formState.backup_enabled ? 'enabled' : 'disabled'}
                  onChange={(e) => setFormState((prev) => ({
                    ...prev,
                    backup_enabled: e.target.value === 'enabled'
                  }))}
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <label className="field" data-help="Cron expression describing when backups should run.">
                <span>Backup schedule (cron)</span>
                <input
                  type="text"
                  value={formState.backup_schedule}
                  onChange={(e) => setFormState((prev) => ({ ...prev, backup_schedule: e.target.value }))}
                  placeholder="0 3 * * *"
                  required={formState.backup_enabled}
                />
                <p className="muted">Use cron syntax to control when automatic backups run.</p>
              </label>
              <label className="field" data-help="How long backups are kept before automatic cleanup.">
                <span>Retention window (days)</span>
                <input
                  type="number"
                  min="0"
                  value={formState.backup_retain_days}
                  onChange={(e) => setFormState((prev) => ({ ...prev, backup_retain_days: e.target.value }))}
                />
                <p className="muted">Older backups beyond this window are pruned automatically.</p>
              </label>
              <div className="form-actions">
                <button className="button" type="submit" disabled={settingsMutation.isLoading}>
                  {settingsMutation.isLoading ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="card__header">
              <div>
                <h2>User activity</h2>
                <p className="muted">Audit trail of key actions taken by product administrators.</p>
              </div>
            </div>
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>User</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {activities.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">No activity recorded yet.</td>
                  </tr>
                )}
                {activities.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.action}</strong>
                      {entry.description && <p className="muted">{entry.description}</p>}
                    </td>
                    <td>{entry.user ? `${entry.user.name || entry.user.email}` : 'System'}</td>
                    <td>{entry.performed_at ? new Date(entry.performed_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card__header">
              <div>
                <h2>Database backups</h2>
                <p className="muted">Review automated snapshots and trigger an on-demand backup if required.</p>
              </div>
              <button
                className="button button--primary"
                type="button"
                onClick={() => runBackupMutation.mutate()}
                disabled={runBackupMutation.isLoading}
              >
                {runBackupMutation.isLoading ? 'Starting…' : 'Run backup now'}
              </button>
            </div>
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Created</th>
                  <th>Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {backups.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">No backups generated yet.</td>
                  </tr>
                )}
                {backups.map((backup) => (
                  <tr key={backup.file}>
                    <td>{backup.file}</td>
                    <td>{backup.createdAt ? new Date(backup.createdAt).toLocaleString() : '—'}</td>
                    <td>{(backup.size / 1024 / 1024).toFixed(2)} MB</td>
                    <td>
                      <a
                        className="button button--ghost button--small"
                        href={`${api.defaults.baseURL}/backups/${backup.file}?token=${getAccessToken()}`}
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
