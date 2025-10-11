import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../providers/AuthProvider.jsx'
import { APP_NAME, PASSWORD_REQUIREMENTS } from '../lib/appInfo.js'

export default function Login() {
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { login } = useAuth()

  async function submit(e) {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    try {
      const loggedIn = await login(email, password)
      if (loggedIn?.must_change_password) {
        navigate('/first-login')
      } else {
        navigate('/')
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login">
      <div className="login__panel">
        <div className="login__brand">
          <span className="sidebar__dot" />
          <h1>{APP_NAME}</h1>
          <p>Authenticate to access your centralized stock workspace.</p>
        </div>
        <form className="login__form" onSubmit={submit}>
          <label className="field" data-help={`Email address associated with your ${APP_NAME} user account.`}>
            <span>Email</span>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
          </label>
          <label className="field" data-help={`Your secure account password. ${PASSWORD_REQUIREMENTS}`}>
            <span>Password</span>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
          </label>
          {error && <p className="error">{String(error)}</p>}
          <button className="button button--primary" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="muted login__hint">Use the seeded admin credentials to get started, then create dedicated users.</p>
      </div>
    </div>
  )
}
