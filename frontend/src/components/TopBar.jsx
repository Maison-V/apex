import { useAuth } from '../context/AuthContext'

export default function TopBar({ liveActive }) {
  const { user } = useAuth()
  const label = user?.user_metadata?.full_name || user?.email || 'Member'

  return (
    <div className="top-bar">
      <div>
        <h2>Market Dashboard</h2>
        <div className="subtitle">Prices, technicals, fundamentals &amp; movers across your watchlist</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {liveActive && (
          <span className="live-badge">
            <span className="live-dot" />
            LIVE
          </span>
        )}
        <div className="user-chip">{label}</div>
      </div>
    </div>
  )
}