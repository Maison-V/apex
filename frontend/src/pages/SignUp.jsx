import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BrandMark from '../components/BrandMark'
import GridBackground from '../components/GridBackground'
import { useAuth } from '../context/AuthContext'
import { SUPABASE_ENABLED } from '../lib/supabaseClient'

export default function SignUp() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!SUPABASE_ENABLED) {
    navigate('/', { replace: true })
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const { data, error: signUpError } = await signUp({ email, password, fullName })
    setSubmitting(false)

    if (signUpError) {
      setError(signUpError.message)
      return
    }

    if (data?.session) {
      navigate('/', { replace: true })
    } else {
      setNotice('Account created. Check your email to confirm before signing in.')
    }
  }

  return (
    <div className="auth-shell">
      <GridBackground />
      <div className="auth-card">
        <div className="auth-header">
          <BrandMark />
          <h1>Create your account</h1>
          <p>Register to unlock the market intelligence dashboard.</p>
        </div>

        {error && <div className="form-error">{error}</div>}
        {notice && <div className="form-notice">{notice}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="fullName">Full name</label>
            <input
              id="fullName"
              type="text"
              autoComplete="name"
              placeholder="Jordan Blake"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
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
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Confirm password</label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <button className="btn-accent" type="submit" disabled={submitting}>
            {submitting ? 'Creating account\u2026' : 'Create account'}
          </button>
        </form>

        <div className="auth-footer">
          Already registered?{' '}
          <Link to="/signin">
            <button type="button">Sign in</button>
          </Link>
        </div>
      </div>
    </div>
  )
}