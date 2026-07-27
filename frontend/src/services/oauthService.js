const DERIV_APP_ID = import.meta.env.VITE_DERIV_APP_ID
const DERIV_REDIRECT_URI = import.meta.env.VITE_DERIV_REDIRECT_URI || 'https://apex-celestial.vercel.app/oauth/callback'
const DERIV_OAUTH_URL = 'https://oauth.deriv.com/oauth2/authorize'

class OAuthService {
  constructor() {
    this.token = null
    this.accountInfo = null
    this.listeners = new Set()
    if (!DERIV_APP_ID) {
      console.warn('VITE_DERIV_APP_ID not set — Deriv OAuth login will not work. Set it in Vercel env vars.')
    }
    this._checkUrlForToken()
  }

  get appId() {
    return DERIV_APP_ID
  }

  isConfigured() {
    return !!DERIV_APP_ID
  }

  _checkUrlForToken() {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token1')
    if (token) {
      this.token = token
      localStorage.setItem('deriv_oauth_token', token)
      const cleanUrl = window.location.pathname + window.location.hash
      window.history.replaceState({}, '', cleanUrl)
      return true
    }
    const saved = localStorage.getItem('deriv_oauth_token')
    if (saved) {
      this.token = saved
      return true
    }
    return false
  }

  login() {
    if (!DERIV_APP_ID) {
      alert('Deriv OAuth is not configured yet. The site admin needs to set VITE_DERIV_APP_ID.')
      return
    }
    window.location.href = `${DERIV_OAUTH_URL}?app_id=${DERIV_APP_ID}&l=EN&redirect_uri=${encodeURIComponent(DERIV_REDIRECT_URI)}`
  }

  logout() {
    this.token = null
    this.accountInfo = null
    localStorage.removeItem('deriv_oauth_token')
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
