import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../providers/AuthProvider.jsx'
import { api } from '../lib/api'
import { setUserProfile as persistUserProfile } from '../lib/auth'

export default function Settings() {
  const { user, setUser } = useAuth()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin'

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

  const [formState, setFormState] = useState({
    low_stock_alerts_enabled: true,
    default_sla_hours: 24,
    notification_emails: ''
  })
  const [banner, setBanner] = useState(null)
  const [userBanner, setUserBanner] = useState(null)
  const [userForm, setUserForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'user',
    must_change_password: true
  })
  const [editingUser, setEditingUser] = useState(null)
  const [editForm, setEditForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'user',
    must_change_password: false
  })

  useEffect(() => {
    if (settingsData) {
      setFormState({
        low_stock_alerts_enabled: settingsData.low_stock_alerts_enabled !== false,
        default_sla_hours: settingsData.default_sla_hours ?? 24,
        notification_emails: Array.isArray(settingsData.notification_emails)
          ? settingsData.notification_emails.join(', ')
          : ''
      })
    }
  }, [settingsData])

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
        must_change_password: true
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
        must_change_password: false
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

  const handleSubmit = (event) => {
    event.preventDefault()
    const payload = {
      low_stock_alerts_enabled: formState.low_stock_alerts_enabled,
      default_sla_hours: Number(formState.default_sla_hours) || 0,
      notification_emails: formState.notification_emails
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean)
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
      must_change_password: Boolean(userForm.must_change_password)
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
      must_change_password: Boolean(selected.must_change_password)
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
      must_change_password: Boolean(editForm.must_change_password)
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
        </div>
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
                      <th>Reset required</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted">No additional users created yet.</td>
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
              <div className="form-actions">
                <button className="button" type="submit" disabled={settingsMutation.isLoading}>
                  {settingsMutation.isLoading ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
