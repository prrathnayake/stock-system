import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { setTokens, setUserProfile } from '../lib/auth'
import { useAuth } from '../providers/AuthProvider.jsx'

export default function FirstLogin() {
  const navigate = useNavigate()
  const { user, setUser, logout } = useAuth()
  const [fullName, setFullName] = useState(user?.full_name || user?.name || '')
  const [email, setEmail] = useState(user?.email || 'admin@example.com')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (loading) return

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation must match')
      return
    }

    setLoading(true)
    setError('')

    try {
      const { data } = await api.post('/auth/update-credentials', {
        full_name: fullName,
        email,
        password: newPassword,
        current_password: currentPassword
      })
      setTokens(data.access, data.refresh)
      setUserProfile(data.user)
      setUser(data.user)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to update credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login">
      <div className="login__panel">
        <div className="login__brand">
          <span className="sidebar__dot" />
          <h1>Secure your account</h1>
          <p>Update the default administrator details before continuing.</p>
        </div>
        <form className="login__form" onSubmit={submit}>
          <label className="field" data-help="This name will be shown to your team across the app.">
            <span>Full name</span>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} required />
          </label>
          <label className="field" data-help="Primary email used for login and notifications.">
            <span>Email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </label>
          <label className="field" data-help="Verify the temporary password before setting a new one.">
            <span>Current password</span>
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
          </label>
          <label className="field" data-help="Choose a strong password with at least 8 characters.">
            <span>New password</span>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
          </label>
          <label className="field" data-help="Confirm the new password to avoid typos.">
            <span>Confirm new password</span>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="button button--primary" type="submit" disabled={loading}>
            {loading ? 'Updating…' : 'Save and continue'}
          </button>
        </form>
        <p className="muted login__hint">Need to start over? <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => {
            logout()
            navigate('/login')
          }}
        >Log out</button></p>
      </div>
    </div>
  )
}
