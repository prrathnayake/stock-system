import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../providers/AuthProvider.jsx'
import { api } from '../lib/api'

export default function Settings() {
  const { user } = useAuth()
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

  const [formState, setFormState] = useState({
    low_stock_alerts_enabled: true,
    default_sla_hours: 24,
    notification_emails: ''
  })
  const [banner, setBanner] = useState(null)

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

  const mutation = useMutation({
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
    mutation.mutate(payload)
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
              <button className="button" type="submit" disabled={mutation.isLoading}>
                {mutation.isLoading ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
