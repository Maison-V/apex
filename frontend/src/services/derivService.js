class DerivService {
  constructor() {
    this.ws = null
    this.prices = {}
    this.listeners = new Set()
    this.symbols = []
    this.reconnectTimer = null
    this.config = null
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
    this.symbols = symbols
    if (this.ws) return
    try {
      this.ws = new WebSocket(this.wsUrl())
      this.ws.onopen = () => {
        this.symbols.forEach((s) => {
          this.ws.send(JSON.stringify({ ticks: s }))
        })
      }
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
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
            this.notify(symbol)
          }
        } catch { /* ignore */ }
      }
      this.ws.onclose = () => {
        this.ws = null
        this.scheduleReconnect()
      }
      this.ws.onerror = () => {
        this.ws?.close()
      }
    } catch { /* ignore */ }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.prices = {}
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

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      if (this.symbols.length > 0) this.connect(this.symbols)
    }, 3000)
  }
}

export const derivService = new DerivService()
