import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { oauthService } from '../services/oauthService'
import { tradingService } from '../services/tradingService'

export default function OAuthCallback() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Connecting to Deriv...')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token1')

    if (!token) {
      setStatus('No authorization code found.')
      setTimeout(() => navigate('/', { replace: true }), 1500)
      return
    }

    localStorage.setItem('deriv_oauth_token', token)
    oauthService.token = token
    setStatus('Authorized! Connecting to Deriv...')

    tradingService.connectWithOAuth(token, 'demo').then((ok) => {
      setStatus(ok ? 'Connected! Redirecting...' : 'Connection issue. Redirecting...')
      setTimeout(() => navigate('/', { replace: true }), 800)
    })
  }, [navigate])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0d0d0d', color: '#fff',
      fontFamily: 'monospace',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12, lineHeight: 1 }}>
          <span style={{ animation: 'pulse 1s ease-in-out infinite' }}>&#9673;</span>
        </div>
        <div>{status}</div>
        <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
          {oauthService.isAuthenticated() ? 'Token acquired' : 'No token'}
        </div>
      </div>
    </div>
  )
}
