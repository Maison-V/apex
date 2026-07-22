import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function OAuthCallback() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Processing...')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token1')

    if (token) {
      localStorage.setItem('deriv_oauth_token', token)
      setStatus('Authorized! Redirecting...')
      setTimeout(() => navigate('/'), 800)
    } else {
      setStatus('No authorization code found. Redirecting...')
      setTimeout(() => navigate('/'), 1500)
    }
  }, [navigate])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0d0d0d', color: '#fff',
      fontFamily: 'monospace',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔐</div>
        <div>{status}</div>
      </div>
    </div>
  )
}
