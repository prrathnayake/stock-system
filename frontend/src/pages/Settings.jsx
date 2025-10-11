import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../providers/AuthProvider.jsx'
import { api } from '../lib/api'
import { getAccessToken, setUserProfile as persistUserProfile } from '../lib/auth'

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
    currency: organization?.currency || 'AUD'
  })

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
        currency: organizationDetails.currency || 'AUD'
      })
    }
  }, [organizationDetails])

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
        currency: data.currency || 'AUD'
      })
      queryClient.invalidateQueries({ queryKey: ['organization'] })
      if (user) {
        const updatedUser = {
          ...user,
          organization: user.organization
            ? {
              ...user.organization,
              name: data.name,
              slug: data.slug,
              id: data.id,
              contact_email: data.contact_email,
              timezone: data.timezone,
              legal_name: data.legal_name,
              abn: data.abn,
              tax_id: data.tax_id,
              address: data.address,
              phone: data.phone,
              website: data.website,
              logo_url: data.logo_url,
              invoice_prefix: data.invoice_prefix,
              default_payment_terms: data.default_payment_terms,
              invoice_notes: data.invoice_notes,
              currency: data.currency
            }
            : {
              id: data.id,
              name: data.name,
              slug: data.slug,
              contact_email: data.contact_email,
              timezone: data.timezone,
              legal_name: data.legal_name,
              abn: data.abn,
              tax_id: data.tax_id,
              address: data.address,
              phone: data.phone,
              website: data.website,
              logo_url: data.logo_url,
              invoice_prefix: data.invoice_prefix,
              default_payment_terms: data.default_payment_terms,
              invoice_notes: data.invoice_notes,
              currency: data.currency
            }
        }
        setUser(updatedUser)
        persistUserProfile(updatedUser)
      }
    },
    onError: (error) => {
      setOrgBanner({ type: 'error', message: error.response?.data?.error || 'Unable to update organization.' })
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
      currency: orgForm.currency.trim()
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
              <label className="field">
                <span>Organization name</span>
                <input
                  value={orgForm.name}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
              </label>
              <label className="field">
                <span>Legal name</span>
                <input
                  value={orgForm.legal_name}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, legal_name: e.target.value }))}
                  placeholder="Registered business name"
                />
              </label>
              <label className="field">
                <span>Notification email</span>
                <input
                  type="email"
                  value={orgForm.contact_email}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, contact_email: e.target.value }))}
                  placeholder="alerts@your-company.com"
                />
                <small className="muted">Administrative emails and backup alerts will be delivered here.</small>
              </label>
              <label className="field">
                <span>Timezone</span>
                <input
                  value={orgForm.timezone}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, timezone: e.target.value }))}
                  placeholder="e.g. America/New_York"
                />
              </label>
              <label className="field">
                <span>ABN / business number</span>
                <input
                  value={orgForm.abn}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, abn: e.target.value }))}
                  placeholder="e.g. 12 345 678 901"
                />
              </label>
              <label className="field">
                <span>Tax registration</span>
                <input
                  value={orgForm.tax_id}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, tax_id: e.target.value }))}
                  placeholder="VAT, GST or other tax ID"
                />
              </label>
              <label className="field field--span">
                <span>Registered address</span>
                <textarea
                  rows={3}
                  value={orgForm.address}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, address: e.target.value }))}
                  placeholder="Street, city, state and postcode"
                />
              </label>
              <label className="field">
                <span>Support phone</span>
                <input
                  value={orgForm.phone}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="e.g. +61 2 1234 5678"
                />
              </label>
              <label className="field">
                <span>Website</span>
                <input
                  value={orgForm.website}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, website: e.target.value }))}
                  placeholder="https://example.com"
                />
              </label>
              <label className="field field--span">
                <span>Logo URL</span>
                <input
                  value={orgForm.logo_url}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, logo_url: e.target.value }))}
                  placeholder="Link to hosted logo image"
                />
                <small className="muted">Used across the dashboard and invoice preview when provided.</small>
              </label>
              <label className="field">
                <span>Invoice prefix</span>
                <input
                  value={orgForm.invoice_prefix}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, invoice_prefix: e.target.value }))}
                  placeholder="e.g. INV- or JOB-"
                />
              </label>
              <label className="field">
                <span>Default payment terms</span>
                <input
                  value={orgForm.default_payment_terms}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, default_payment_terms: e.target.value }))}
                  placeholder="e.g. Net 14"
                />
              </label>
              <label className="field">
                <span>Default currency</span>
                <input
                  value={orgForm.currency}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, currency: e.target.value }))}
                  placeholder="e.g. AUD"
                />
              </label>
              <label className="field field--span">
                <span>Default invoice notes</span>
                <textarea
                  rows={3}
                  value={orgForm.invoice_notes}
                  onChange={(e) => setOrgForm((prev) => ({ ...prev, invoice_notes: e.target.value }))}
                  placeholder="Displayed on all invoices by default"
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
                <label className="field">
                  <span>Full name</span>
                  <input
                    value={userForm.full_name}
                    onChange={(e) => setUserForm((prev) => ({ ...prev, full_name: e.target.value }))}
                    required
                  />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(e) => setUserForm((prev) => ({ ...prev, email: e.target.value }))}
                    required
                  />
                </label>
                <label className="field">
                  <span>Temporary password</span>
                  <input
                    type="password"
                    value={userForm.password}
                    onChange={(e) => setUserForm((prev) => ({ ...prev, password: e.target.value }))}
                    required
                  />
                </label>
                <label className="field">
                  <span>Role</span>
                  <select
                    value={userForm.role}
                    onChange={(e) => setUserForm((prev) => ({ ...prev, role: e.target.value }))}
                  >
                    <option value="user">User</option>
                    <option value="admin">Administrator</option>
                  </select>
                </label>
                <label className="field">
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
                <label className="field field--checkbox">
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
                <h3>Active users</h3>
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
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={7} className="muted">No additional users created yet.</td>
                      </tr>
                    )}
                    {users.map((account) => (
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
                    ))}
                  </tbody>
                </table>

                {editingUser && (
                  <form className="form-grid form-grid--inline" onSubmit={handleUpdateUser}>
                    <h4>Edit {editingUser.full_name}</h4>
                    <label className="field">
                      <span>Full name</span>
                      <input
                        value={editForm.full_name}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, full_name: e.target.value }))}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Email</span>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Role</span>
                      <select
                        value={editForm.role}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, role: e.target.value }))}
                      >
                        <option value="user">User</option>
                        <option value="admin">Administrator</option>
                      </select>
                    </label>
                    <label className="field">
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
                    <label className="field">
                      <span>New password</span>
                      <input
                        type="password"
                        value={editForm.password}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))}
                        placeholder="Leave blank to keep current password"
                      />
                    </label>
                    <label className="field field--checkbox">
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
              <label className="field">
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
              <label className="field">
                <span>Default SLA window (hours)</span>
                <input
                  type="number"
                  min="0"
                  value={formState.default_sla_hours}
                  onChange={(e) => setFormState((prev) => ({ ...prev, default_sla_hours: e.target.value }))}
                />
              </label>
              <label className="field field--span">
                <span>Escalation emails</span>
                <textarea
                  rows={2}
                  value={formState.notification_emails}
                  onChange={(e) => setFormState((prev) => ({ ...prev, notification_emails: e.target.value }))}
                  placeholder="ops@example.com, lead@example.com"
                />
                <p className="muted">Comma-separated list of recipients notified for SLA breaches.</p>
              </label>
              <label className="field">
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
              <label className="field">
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
              <label className="field">
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
