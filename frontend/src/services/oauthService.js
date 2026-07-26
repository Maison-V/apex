const DERIV_APP_ID = import.meta.env.VITE_DERIV_APP_ID || '1089'
const DERIV_OAUTH_URL = 'https://oauth.deriv.com/oauth2/authorize'

class OAuthService {
  constructor() {
    this.token = null
    this.accountInfo = null
    this.listeners = new Set()
    this._checkUrlForToken()
  }

  get appId() {
    return DERIV_APP_ID
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
    const redirectUri = encodeURIComponent(window.location.origin + '/oauth/callback')
    window.location.href = `${DERIV_OAUTH_URL}?app_id=${DERIV_APP_ID}&l=EN&redirect_uri=${redirectUri}`
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
