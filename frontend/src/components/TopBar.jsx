import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { oauthService } from '../services/oauthService'
import { tradingService } from '../services/tradingService'

export default function TopBar({ liveActive, title }) {
  const { user } = useAuth()
  const [derivConnected, setDerivConnected] = useState(false)
  const [derivBalance, setDerivBalance] = useState(null)
  const label = user?.user_metadata?.full_name || user?.email || 'Member'

  useEffect(() => {
    if (oauthService.isAuthenticated() && tradingService.isConnected()) {
      setDerivConnected(true)
      const bal = tradingService.getBalance()
      setDerivBalance(bal)
    } else {
      setDerivConnected(false)
      setDerivBalance(null)
    }

    const unsub = tradingService.subscribe((data) => {
      if (data.type === 'connected') {
        setDerivConnected(true)
        setDerivBalance(data)
      } else if (data.type === 'disconnected' || data.type === 'error') {
        setDerivConnected(false)
      }
    })
    return () => unsub()
  }, [])

  const handleDerivLogin = () => {
    if (!oauthService.isConfigured()) {
      alert('Deriv OAuth not configured — set VITE_DERIV_APP_ID on Vercel and register the redirect URI in your Deriv app settings:\n\n' + window.location.origin + '/oauth/callback')
      return
    }
    oauthService.login()
  }

  const handleDerivLogout = () => {
    tradingService.disconnect()
    oauthService.logout()
  }

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
        {derivConnected ? (
          <span
            className="deriv-badge connected"
            onClick={handleDerivLogout}
            title="Click to disconnect Deriv"
            style={{ cursor: 'pointer' }}
          >
            <span className="live-dot" />
            DERIV {derivBalance?.balance?.toFixed(2)} {derivBalance?.currency}
          </span>
        ) : (
          <span
            className={`deriv-badge${!oauthService.isConfigured() ? ' disabled' : ''}`}
            onClick={handleDerivLogin}
            title={oauthService.isConfigured() ? 'Connect your Deriv account via OAuth' : 'Set VITE_DERIV_APP_ID to enable Deriv login'}
            style={{ cursor: 'pointer' }}
          >
            &#9673; {oauthService.isConfigured() ? 'CONNECT DERIV' : 'DERIV NEEDS SETUP'}
          </span>
        )}
        <div className="user-chip">{label}</div>
      </div>
    </div>
  )
}
