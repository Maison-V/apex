import BrandMark from '../components/BrandMark'
import GridBackground from '../components/GridBackground'
import { useAuth } from '../context/AuthContext'

export default function PendingApproval({ rejected = false }) {
  const { signOut, profile } = useAuth()

  return (
    <div className="auth-shell">
      <GridBackground />
      <div className="auth-card">
        <div className="auth-header">
          <BrandMark />
          <h1>{rejected ? 'Access denied' : 'Awaiting approval'}</h1>
          <p>
            {rejected
              ? "Your account request wasn't approved for access to this dashboard."
              : `Thanks${profile?.full_name ? `, ${profile.full_name}` : ''}. Your account has been created and is waiting on approval before you can sign in.`}
          </p>
        </div>

        {!rejected && (
          <div className="form-notice">
            The CEO has been notified of your request. You'll be able to sign in as soon as it's approved.
          </div>
        )}

        <button className="btn-accent" type="button" onClick={signOut} style={{ marginTop: '1.5rem' }}>
          Sign out
        </button>
      </div>
    </div>
  )
}
