import { useAuth } from '../context/AuthContext'

export default function TopBar({ liveActive, title }) {
  const { user } = useAuth()
  const label = user?.user_metadata?.full_name || user?.email || 'Member'

  return (
    <div className="top-bar">
      <div>
        <h2>{title || 'Market Dashboard'}</h2>
        <div className="subtitle">
          {title === 'Market Dashboard' ? 'Prices · Technicals · Fundamentals · Movers'
            : title === 'HFT Console' ? 'Tick monitoring · Latency · HFT strategies'
            : title === 'Last Digit Predictor' ? 'Digit frequency · Markov chain · Prediction accuracy'
            : title === 'Spike Detector' ? 'Z-score spike detection · Mean reversion · Boom/Crash analysis'
            : 'Real-time market intelligence'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
