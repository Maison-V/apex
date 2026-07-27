import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { oauthService } from '../services/oauthService'
import { tradingService } from '../services/tradingService'

export default function OAuthCallback() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Connecting to Deriv...')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const error = params.get('error')

    if (error) {
      setStatus(`Authorization denied: ${error}`)
      setTimeout(() => navigate('/', { replace: true }), 2000)
      return
    }

    if (!code) {
      setStatus('No authorization code found.')
      setTimeout(() => navigate('/', { replace: true }), 1500)
      return
    }

    const savedState = sessionStorage.getItem('deriv_oauth_state')
    if (state && savedState && state !== savedState) {
      setStatus('Security error: state mismatch.')
      setTimeout(() => navigate('/', { replace: true }), 2000)
      return
    }
    sessionStorage.removeItem('deriv_oauth_state')

    const codeVerifier = sessionStorage.getItem('deriv_code_verifier')
    sessionStorage.removeItem('deriv_code_verifier')

    setStatus('Exchanging authorization...')

    fetch('/api/auth/deriv/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        redirect_uri: window.location.origin + '/oauth/callback',
      }),
    })
      .then((res) => {
        if (!res.ok) return res.text().then((t) => { throw new Error(t) })
        return res.json()
      })
      .then((data) => {
        const accessToken = data.access_token
        if (!accessToken) {
          setStatus('Failed to get access token.')
          return
        }
        localStorage.setItem('deriv_oauth_token', accessToken)
        oauthService.token = accessToken
        setStatus('Authorized! Connecting to Deriv...')
        return tradingService.connectWithOAuth(accessToken, 'demo')
      })
      .then((ok) => {
        setStatus(ok ? 'Connected! Redirecting...' : 'Connection issue. Redirecting...')
        setTimeout(() => navigate('/', { replace: true }), 800)
      })
      .catch((err) => {
        setStatus(`Error: ${err.message}`)
        setTimeout(() => navigate('/', { replace: true }), 2000)
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
      </div>
    </div>
  )
}
