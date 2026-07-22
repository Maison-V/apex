class OAuthService {
  constructor() {
    this.token = null
    this.accountInfo = null
    this.listeners = new Set()
    this._checkUrlForToken()
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

  login(appId) {
    const redirectUri = encodeURIComponent(window.location.origin + '/oauth/callback')
    window.location.href = `https://oauth.deriv.com/oauth2/authorize?app_id=${appId || '1089'}&l=EN&redirect_uri=${redirectUri}`
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
