import React, { useState } from 'react'
import { api } from '../lib/api'

export default function Login() {
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    try {
      const { data } = await api.post('/auth/login', { email, password })
      localStorage.setItem('access', data.access)
      localStorage.setItem('refresh', data.refresh)
      location.href = '/'
    } catch (e) {
      setError(e.response?.data?.error || 'Login failed')
    }
  }

  return (
    <div className="container">
      <div className="card" style={{maxWidth:460, margin:'40px auto'}}>
        <h2>Sign in</h2>
        <form onSubmit={submit}>
          <label>Email</label>
          <input value={email} onChange={e=>setEmail(e.target.value)} />
          <label>Password</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} />
          {error && <p style={{color:'crimson'}}>{String(error)}</p>}
          <button type="submit">Login</button>
        </form>
      </div>
    </div>
  )
}
