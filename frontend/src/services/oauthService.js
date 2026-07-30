const DERIV_APP_ID = import.meta.env.VITE_DERIV_APP_ID
const DERIV_REDIRECT_URI = import.meta.env.VITE_DERIV_REDIRECT_URI || 'https://apex-celestial.vercel.app/oauth/callback'
const DERIV_AUTH_URL = 'https://oauth.deriv.com/oauth2/authorize'

class OAuthService {
  constructor() {
    this.token = null
    this.accountInfo = null
    this.listeners = new Set()
    if (!DERIV_APP_ID) {
      console.warn('VITE_DERIV_APP_ID not set — Deriv OAuth login will not work. Set it in Vercel env vars.')
    }
  }

  get appId() {
    return DERIV_APP_ID
  }

  isConfigured() {
    return !!DERIV_APP_ID
  }

  async login() {
    if (!DERIV_APP_ID) {
      alert('Deriv OAuth is not configured yet. The site admin needs to set VITE_DERIV_APP_ID.')
      return
    }
    const state = crypto.randomUUID()
    sessionStorage.setItem('deriv_oauth_state', state)
    sessionStorage.removeItem('deriv_code_verifier')
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: DERIV_APP_ID,
      redirect_uri: DERIV_REDIRECT_URI,
      state,
    })
    window.location.href = `${DERIV_AUTH_URL}?${params}`
  }

  logout() {
    this.token = null
    this.accountInfo = null
    localStorage.removeItem('deriv_oauth_token')
    sessionStorage.removeItem('deriv_code_verifier')
    sessionStorage.removeItem('deriv_oauth_state')
    this.notify({ type: 'logout' })
  }

  getToken() {
    return this.token
  }

  isAuthenticated() {
    return !!this.token
  }

  setAccountInfo(info) {
    this.accountInfo = info
    this.notify({ type: 'account', info })
  }

  getAccountInfo() {
    return this.accountInfo
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  notify(data) {
    this.listeners.forEach(fn => fn(data))
  }
}

export const oauthService = new OAuthService()
