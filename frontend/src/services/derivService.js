function lastDigit(price) {
  const s = String(price).replace(/[^0-9]/g, '')
  if (!s) return 0
  return parseInt(s.slice(-1), 10)
}

class DerivService {
  constructor() {
    this.ws = null
    this.prices = {}
    this.tickHistory = {}
    this.digitHistory = {}
    this.listeners = new Set()
    this.symbols = []
    this.reconnectTimer = null
    this._reconnectAttempts = 0
    this._heartbeatTimer = null
    this._intentionalClose = false
    this.config = null
  }

  _startHeartbeat() {
    this._stopHeartbeat()
    this._heartbeatTimer = setInterval(() => {
      try { this.ws?.send(JSON.stringify({ ping: 1 })) } catch {}
    }, 30000)
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
  }

  async init() {
    try {
      const res = await fetch('/api/deriv/config')
      this.config = await res.json()
    } catch {
      this.config = { public_ws: 'wss://api.derivws.com/trading/v1/options/ws/public' }
    }
  }

  wsUrl() {
    return this.config?.public_ws || 'wss://api.derivws.com/trading/v1/options/ws/public'
  }

  connect(symbols) {
    const newSymbols = symbols.filter(s => !this.symbols.includes(s))
    if (!newSymbols.length && this.ws) return
    this.symbols = [...new Set([...this.symbols, ...symbols])]
    this._intentionalClose = false
    newSymbols.forEach((s) => {
      if (!this.digitHistory[s]) {
        this.digitHistory[s] = []
        this.tickHistory[s] = []
      }
    })
    if (this.ws) {
      newSymbols.forEach((s) => {
        this.ws.send(JSON.stringify({ ticks: s }))
      })
      return
    }
    try {
      this.ws = new WebSocket(this.wsUrl())
      this.ws.onopen = () => {
        this._reconnectAttempts = 0
        this._startHeartbeat()
        this.symbols.forEach((s) => {
          this.ws.send(JSON.stringify({ ticks: s }))
        })
      }
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.msg_type === 'ping') return
          if (data.error) {
            console.warn('Deriv WS error:', data.error?.message || data.error?.code, 'for req:', data.echo_req)
            return
          }
          if (data.tick) {
            const { symbol, quote, epoch, ask, bid } = data.tick
            this.prices[symbol] = {
              price: quote,
              ask,
              bid,
              timestamp: epoch
                ? new Date(epoch * 1000).toISOString()
                : new Date().toISOString(),
            }
            if (this.tickHistory[symbol]) {
              this.tickHistory[symbol].push({ price: quote, epoch })
              if (this.tickHistory[symbol].length > 10000) {
                this.tickHistory[symbol].splice(0, 1000)
              }
            }
            if (this.digitHistory[symbol]) {
              this.digitHistory[symbol].push(lastDigit(quote))
              if (this.digitHistory[symbol].length > 10000) {
                this.digitHistory[symbol].splice(0, 1000)
              }
            }
            this.notify(symbol)
          }
        } catch { /* ignore */ }
      }
      this.ws.onclose = () => {
        this.ws = null
        this._stopHeartbeat()
        if (!this._intentionalClose) {
          this.scheduleReconnect()
        }
      }
      this.ws.onerror = () => {
        this.ws?.close()
      }
    } catch { /* ignore */ }
  }

  disconnect() {
    this._intentionalClose = true
    this._reconnectAttempts = 0
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this._stopHeartbeat()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  clearHistory() {
    this.tickHistory = {}
    this.digitHistory = {}
  }

  getDigits(symbol) {
    return this.digitHistory[symbol] || []
  }

  getTicks(symbol) {
    return this.tickHistory[symbol] || []
  }

  subscribeSymbol(sym) {
    if (this.symbols.includes(sym)) return
    this.symbols.push(sym)
    this.tickHistory[sym] = []
    this.digitHistory[sym] = []
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ticks: sym }))
    }
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  notify(symbol) {
    const price = this.prices[symbol]
    if (price) {
      this.listeners.forEach((fn) => fn(symbol, price.price, price.timestamp))
    }
  }

  async fetchActiveSymbols(detail = 'full') {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.wsUrl())
        const timeout = setTimeout(() => {
          ws.close()
          reject(new Error('Timeout fetching active symbols'))
        }, 10000)
        ws.onopen = () => {
          ws.send(JSON.stringify({ active_symbols: detail }))
        }
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.msg_type === 'active_symbols') {
              clearTimeout(timeout)
              ws.close()
              resolve(data.active_symbols || [])
            }
          } catch { /* ignore */ }
        }
        ws.onerror = () => {
          clearTimeout(timeout)
          reject(new Error('WebSocket error fetching active symbols'))
        }
      } catch (err) {
        reject(err)
      }
    })
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    const attempt = this._reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 30000)
    this.reconnectTimer = setTimeout(() => {
      if (this.symbols.length > 0 && !this._intentionalClose) {
        this.connect(this.symbols)
      }
    }, delay)
  }
}

export const derivService = new DerivService()
