import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="screen-center">
        <div className="loader-glyph" aria-label="Loading">
          <span />
          <span />
          <span />
        </div>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/signin" replace />
  }

  return children
}
