import { useEffect } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { SUPABASE_ENABLED } from '../lib/supabaseClient'

export default function SignIn() {
  const { session, signIn } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (session) navigate('/', { replace: true })
  }, [session, navigate])

  if (!SUPABASE_ENABLED) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    await signIn({ email: fd.get('email'), password: fd.get('password') })
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>APEX</h1>
        <p className="auth-sub">Sign in to your account</p>
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Password" required />
        <button type="submit">Sign In</button>
        <p className="auth-alt">
          No account? <a href="/signup">Sign up</a>
        </p>
      </form>
    </div>
  )
}