import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import BrandMark from '../components/BrandMark'
import ConstellationField from '../components/ConstellationField'
import { useAuth } from '../context/AuthContext'
import { SUPABASE_ENABLED } from '../lib/supabaseClient'

export default function SignIn() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const from = location.state?.from?.pathname || '/'

  if (!SUPABASE_ENABLED) {
    navigate(from, { replace: true })
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    const { error: signInError } = await signIn({ email, password })
    setSubmitting(false)
    if (signInError) {
      setError(signInError.message)
      return
    }
    navigate(from, { replace: true })
  }

  return (
    <div className="auth-shell">
      <ConstellationField />
      <div className="auth-card">
        <div className="auth-header">
          <BrandMark />
          <h1>Access the terminal</h1>
          <p>Sign in to view live market statistics and analysis.</p>
        </div>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="btn-gold" type="submit" disabled={submitting}>
            {submitting ? 'Signing in\u2026' : 'Sign in'}
          </button>
        </form>

        <div className="auth-footer">
          New to APEX CELESTIAL?{' '}
          <Link to="/signup">
            <button type="button">Create an account</button>
          </Link>
        </div>
      </div>
    </div>
  )
}