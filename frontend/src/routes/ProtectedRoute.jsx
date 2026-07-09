import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { SUPABASE_ENABLED } from '../lib/supabaseClient'

export default function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="screen-center">
        <div className="loader-glyph" aria-label="Loading">
          <span /><span /><span />
        </div>
      </div>
    )
  }

  if (SUPABASE_ENABLED && !session) {
    return <Navigate to="/signin" state={{ from: location }} replace />
  }

  return children
}