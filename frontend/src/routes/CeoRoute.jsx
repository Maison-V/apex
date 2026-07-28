import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function CeoRoute({ children }) {
  const { loading, isCeo } = useAuth()

  if (loading) {
    return (
      <div className="screen-center">
        <div className="loader-glyph" aria-label="Loading">
          <span /><span /><span />
        </div>
      </div>
    )
  }

  if (!isCeo) {
    return <Navigate to="/" replace />
  }

  return children
}
