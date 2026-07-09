import { useEffect } from 'react'
import { Link, useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { SUPABASE_ENABLED } from '../lib/supabaseClient'

export default function SignUp() {
  const { session, signUp } = useAuth()
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
    await signUp({ email: fd.get('email'), password: fd.get('password'), fullName: fd.get('fullName') })
  }

  return (
    <div className="sign-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>APEX</h1>
        <p className="auth-sub">Create your account</p>
        <input name="fullName" type="text" placeholder="Full Name" required />
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Password" required />
        <button type="submit">Sign Up</button>
        <p className="auth-alt">
          Already have an account? <Link to="/signin">Sign in</Link>
        </p>
      </form>
    </div>
  )
}