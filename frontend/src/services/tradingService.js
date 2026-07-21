class TradingService {
  constructor() {
    this.ws = null
    this.apiToken = null
    this.connected = false
    this.balances = {}
    this.proposals = new Map()
    this.contracts = []
    this.listeners = new Set()
  }

  setToken(token) {
    this.apiToken = token
  }

  connect() {
    if (this.ws) return
    if (!this.apiToken) return

    try {
      this.ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public')
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({ authorize: this.apiToken }))
      }
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.msg_type === 'authorize') {
            this.connected = true
            this.balances = {
              balance: data.authorize?.balance,
              currency: data.authorize?.currency,
              loginid: data.authorize?.loginid,
            }
            this.notify({ type: 'connected', ...this.balances })
          } else if (data.msg_type === 'buy') {
            const contract = {
              id: data.buy?.contract_id,
              transactionId: data.buy?.transaction_id,
              balanceAfter: data.buy?.balance_after,
              buyPrice: data.buy?.buy_price,
              longcode: data.buy?.longcode,
              startTime: data.buy?.start_time,
            }
            this.contracts.push(contract)
            this.notify({ type: 'contract_opened', ...contract })
          } else if (data.msg_type === 'proposal') {
            const id = data.proposal?.id
            if (id) {
              this.proposals.set(id, data.proposal)
              this.notify({ type: 'proposal', id, proposal: data.proposal })
            }
          } else if (data.msg_type === 'proposal_open_contract') {
            const contract = data.proposal_open_contract
            this.notify({ type: 'contract_update', contract })
          }
        } catch { /* ignore */ }
      }
      this.ws.onclose = () => {
        this.connected = false
        this.ws = null
      }
      this.ws.onerror = () => {
        this.ws?.close()
      }
    } catch { /* ignore */ }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
  }

  async getProposal({ contract_type, symbol, amount, duration, duration_unit, barrier, currency = 'USD' }) {
    if (!this.connected || !this.ws) return null
    return new Promise((resolve) => {
      const handler = (data) => {
        if (data.type === 'proposal') {
          this.listeners.delete(handler)
          resolve(data.proposal)
        }
      }
      this.listeners.add(handler)
      this.ws.send(JSON.stringify({
        proposal: 1,
        amount,
        basis: 'stake',
        contract_type,
        currency,
        duration,
        duration_unit,
        symbol,
        ...(barrier != null ? { barrier } : {}),
      }))
      setTimeout(() => {
        this.listeners.delete(handler)
        resolve(null)
      }, 5000)
    })
  }

  async buyContract(proposalId, price) {
    if (!this.connected || !this.ws) return null
    return new Promise((resolve) => {
      const handler = (data) => {
        if (data.type === 'contract_opened' || data.type === 'contract_update') {
          this.listeners.delete(handler)
          resolve(data)
        }
      }
      this.listeners.add(handler)
      this.ws.send(JSON.stringify({ buy: proposalId, price }))
      setTimeout(() => {
        this.listeners.delete(handler)
        resolve(null)
      }, 10000)
    })
  }

  async sellContract(contractId, price) {
    if (!this.connected || !this.ws) return null
    return new Promise((resolve) => {
      const handler = (data) => {
        if (data.type === 'contract_update') {
          this.listeners.delete(handler)
          resolve(data)
        }
      }
      this.listeners.add(handler)
      this.ws.send(JSON.stringify({ sell: contractId, price }))
      setTimeout(() => {
        this.listeners.delete(handler)
        resolve(null)
      }, 5000)
    })
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  notify(data) {
    this.listeners.forEach((fn) => fn(data))
  }
}

export const tradingService = new TradingService()
