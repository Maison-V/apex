import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { SUPABASE_ENABLED } from '../lib/supabaseClient'
import PendingApproval from '../pages/PendingApproval'

export default function ProtectedRoute({ children }) {
  const { session, loading, isPending, isRejected } = useAuth()
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

  if (SUPABASE_ENABLED && session && isPending) {
    return <PendingApproval />
  }

  if (SUPABASE_ENABLED && session && isRejected) {
    return <PendingApproval rejected />
  }

  return children
}
