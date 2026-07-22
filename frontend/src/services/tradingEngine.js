class TradingEngine {
  constructor() {
    this.derivService = null
    this.tradingService = null
    this.strategies = new Map()
    this.activeStrategyId = null
    this.running = false
    this.pendingTrade = false
    this.listeners = new Set()
    this._unsubTick = null
    this._unsubTrading = null

    this.config = {
      symbol: 'BOOM500',
      riskPercent: 80,
      duration: 1,
      durationUnit: 't',
      lookback: 5,
    }

    this.state = {
      upCounter: 0,
      downCounter: 0,
      lastPrice: null,
      currentPrice: null,
      prevPrice: null,
    }

    this.stats = {
      wins: 0,
      losses: 0,
      totalTrades: 0,
      totalProfit: 0,
      startBalance: 0,
      peakBalance: 0,
    }

    this.tradeLog = []
    this.currentContract = null

    this.registerStrategy('consecutive_counter', {
      name: 'Consecutive Counter',
      lookback: 5,
      onTick(tick, state, config) {
        if (state.lastPrice === null) return null
        if (tick > state.lastPrice) {
          state.upCounter++
          state.downCounter = 0
        } else if (tick < state.lastPrice) {
          state.downCounter++
          state.upCounter = 0
        }
        const lb = config.lookback || 5
        if (state.upCounter >= lb) {
          state.upCounter = 0
          state.downCounter = 0
          return { action: 'CALL', reason: `${lb} consecutive up ticks` }
        }
        if (state.downCounter >= lb) {
          state.downCounter = 0
          state.upCounter = 0
          return { action: 'PUT', reason: `${lb} consecutive down ticks` }
        }
        return null
      },
    })
  }

  init(derivService, tradingService) {
    this.derivService = derivService
    this.tradingService = tradingService
  }

  registerStrategy(id, impl) {
    this.strategies.set(id, impl)
  }

  getStrategies() {
    const result = {}
    this.strategies.forEach((impl, id) => {
      result[id] = { name: impl.name, lookback: impl.lookback }
    })
    return result
  }

  async start(config) {
    if (this.running) return
    if (!this.derivService || !this.tradingService) {
      this.notify({ type: 'error', message: 'Engine not initialized' })
      return
    }
    if (!this.tradingService.isConnected()) {
      this.notify({ type: 'error', message: 'Trading service not connected' })
      return
    }

    this.config = { ...this.config, ...config }
    this.activeStrategyId = this.config.strategyId || 'consecutive_counter'
    this.running = true
    this.pendingTrade = false
    this.currentContract = null
    this.resetState()

    const bal = this.tradingService.getBalance()
    this.stats.startBalance = bal.balance || 0
    this.stats.peakBalance = bal.balance || 0

    const symbol = this.config.symbol
    this.derivService.subscribeSymbol(symbol)

    this._unsubTick = this.derivService.subscribe((sym, price) => {
      if (!this.running || sym !== symbol) return
      this.processTick(price)
    })

    this.notify({ type: 'started', config: this.config })
  }

  stop() {
    this.running = false
    this.pendingTrade = false
    this.currentContract = null
    if (this._unsubTick) {
      this._unsubTick()
      this._unsubTick = null
    }
    this.notify({ type: 'stopped' })
  }

  emergencyStop() {
    this.stop()
  }

  processTick(price) {
    const previousTickPrice = this.state.currentPrice

    this.state.prevPrice = this.state.lastPrice
    this.state.lastPrice = previousTickPrice
    this.state.currentPrice = price

    if (previousTickPrice === null) {
      this.notify({ type: 'state_update', state: { ...this.state } })
      return
    }

    const strategy = this.strategies.get(this.activeStrategyId)
    if (strategy) {
      const signal = strategy.onTick(price, this.state, this.config)
      if (signal && !this.pendingTrade) {
        this.executeTrade(signal.action)
      }
    }

    this.notify({ type: 'state_update', state: { ...this.state } })
  }

  async executeTrade(direction) {
    if (this.pendingTrade || !this.running) return
    this.pendingTrade = true
    this.notify({ type: 'trade_start', direction })

    try {
      const bal = this.tradingService.getBalance()
      const balance = bal.balance
      if (!balance || balance < 1) {
        this.notify({ type: 'error', message: `Insufficient balance: ${balance}` })
        this.pendingTrade = false
        this.stop()
        return
      }

      const stake = Math.max(Math.round(balance * this.config.riskPercent / 100 * 100) / 100, 1)
      if (stake > balance) {
        this.notify({ type: 'error', message: `Stake $${stake} exceeds balance $${balance}` })
        this.pendingTrade = false
        this.stop()
        return
      }

      this.notify({ type: 'stake_calculated', stake, balance })

      const result = await this.tradingService.placeTrade({
        contract_type: direction,
        symbol: this.config.symbol,
        amount: stake,
        duration: this.config.duration,
        duration_unit: this.config.durationUnit,
      })

      if (result) {
        this.stats.totalTrades++
        if (result.status === 'won') this.stats.wins++
        else if (result.status === 'lost') this.stats.losses++
        this.stats.totalProfit += result.profit || 0

        const newBal = result.balanceAfter || (balance + (result.profit || 0))
        if (newBal > this.stats.peakBalance) this.stats.peakBalance = newBal

        const logEntry = {
          timestamp: new Date().toISOString(),
          symbol: this.config.symbol,
          direction,
          stake,
          entryTick: this.state.prevPrice,
          exitTick: this.state.currentPrice,
          profit: result.profit || 0,
          balanceAfter: newBal,
          status: result.status,
          contractId: result.contractId,
          transactionId: result.transactionId,
        }
        this.tradeLog.push(logEntry)
        this.currentContract = null

        this.notify({
          type: 'trade_complete',
          result,
          stats: { ...this.stats },
          log: logEntry,
        })
      } else {
        this.notify({ type: 'error', message: 'Trade failed - no result from broker' })
      }
    } catch (err) {
      this.notify({ type: 'error', message: `Trade error: ${err.message}` })
    }

    this.pendingTrade = false
  }

  getState() {
    return {
      config: { ...this.config },
      state: { ...this.state },
      stats: { ...this.stats },
      running: this.running,
      pendingTrade: this.pendingTrade,
      tradeCount: this.tradeLog.length,
    }
  }

  getTradeLog() {
    return [...this.tradeLog]
  }

  exportCsv() {
    const headers = [
      'Timestamp', 'Symbol', 'Direction', 'Stake', 'Entry Tick',
      'Exit Tick', 'Profit/Loss', 'Balance After', 'Status',
      'Contract ID', 'Transaction ID',
    ]
    const rows = this.tradeLog.map(t => [
      t.timestamp, t.symbol, t.direction, t.stake.toFixed(2),
      t.entryTick, t.exitTick, t.profit.toFixed(2),
      t.balanceAfter.toFixed(2), t.status, t.contractId, t.transactionId,
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    return csv
  }

  resetState() {
    this.state = { upCounter: 0, downCounter: 0, lastPrice: null, currentPrice: null, prevPrice: null }
    this.stats = { wins: 0, losses: 0, totalTrades: 0, totalProfit: 0, startBalance: 0, peakBalance: 0 }
  }

  resetStats() {
    this.resetState()
    this.tradeLog = []
    const bal = this.tradingService?.getBalance()
    this.stats.startBalance = bal?.balance || 0
    this.stats.peakBalance = bal?.balance || 0
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  notify(data) {
    this.listeners.forEach(fn => fn(data))
  }
}

export const tradingEngine = new TradingEngine()
