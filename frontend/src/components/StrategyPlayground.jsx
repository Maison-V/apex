import { useEffect, useMemo, useRef, useState } from 'react'
import { derivService } from '../services/derivService'
import { tradingService } from '../services/tradingService'

const DURATION_UNITS = [
  { id: 't', label: 'Ticks' },
  { id: 'm', label: 'Minutes' },
]

const SIGNAL_STRATEGIES = [
  { id: 'momentum', label: 'Direction Momentum' },
  { id: 'volatility', label: 'Volatility Breakout' },
  { id: 'macd', label: 'MACD Crossover' },
  { id: 'bollinger', label: 'Bollinger Bounce' },
  { id: 'ma_cross', label: 'MA Crossover (5/20)' },
  { id: 'rsi', label: 'RSI Overbought/Oversold' },
]

function computeDirectionMomentum(prices, lookback, horizon) {
  if (prices.length < lookback + horizon + 2) return null
  const lastN = prices.slice(-lookback - 1)
  const allUp = lastN.every((p, i) => i === 0 || p >= lastN[i - 1])
  const allDown = lastN.every((p, i) => i === 0 || p <= lastN[i - 1])
  if (allUp) return { direction: 'CALL', confidence: 0.55, reason: `${lookback} consecutive rises` }
  if (allDown) return { direction: 'PUT', confidence: 0.55, reason: `${lookback} consecutive falls` }
  return null
}

function computeVolatilityBreakout(prices, mult) {
  if (prices.length < 30) return null
  const steps = []
  for (let i = 1; i < prices.length; i++) steps.push(prices[i] - prices[i - 1])
  const recent = steps.slice(-20)
  const avgAbs = recent.reduce((s, v) => s + Math.abs(v), 0) / recent.length
  const lastStep = steps[steps.length - 1]
  if (avgAbs === 0) return null
  if (Math.abs(lastStep) > mult * avgAbs) {
    return {
      direction: lastStep > 0 ? 'CALL' : 'PUT',
      confidence: 0.53,
      reason: `Large ${lastStep > 0 ? 'up' : 'down'} step (${Math.abs(lastStep).toFixed(1)} > ${mult}x avg)`,
    }
  }
  return null
}

function computeMACrossover(prices) {
  if (prices.length < 25) return null
  const ma5 = prices.slice(-5).reduce((s, v) => s + v, 0) / 5
  const ma20 = prices.slice(-20).reduce((s, v) => s + v, 0) / 20
  if (ma5 > ma20 * 1.0005) return { direction: 'CALL', confidence: 0.52, reason: 'MA5 above MA20' }
  if (ma5 < ma20 * 0.9995) return { direction: 'PUT', confidence: 0.52, reason: 'MA5 below MA20' }
  return { direction: Math.random() > 0.5 ? 'CALL' : 'PUT', confidence: 0.5, reason: 'No clear signal (random)' }
}

function computeBollingerBounce(prices) {
  if (prices.length < 25) return null
  const last20 = prices.slice(-20)
  const mean = last20.reduce((s, v) => s + v, 0) / last20.length
  const std = Math.sqrt(last20.reduce((s, v) => s + (v - mean) ** 2, 0) / last20.length)
  const price = prices[prices.length - 1]
  if (price <= mean - 2 * std) return { direction: 'CALL', confidence: 0.54, reason: 'Price at lower BB (bounce)' }
  if (price >= mean + 2 * std) return { direction: 'PUT', confidence: 0.54, reason: 'Price at upper BB (bounce)' }
  return null
}

function computeRSI(prices) {
  if (prices.length < 20) return null
  const steps = []
  for (let i = prices.length - 15; i < prices.length; i++) {
    if (i > 0) steps.push(prices[i] - prices[i - 1])
  }
  const gains = steps.filter(s => s > 0).reduce((s, v) => s + v, 0) / steps.length || 0
  const losses = steps.filter(s => s < 0).reduce((s, v) => s - v, 0) / steps.length || 0
  const rs = gains / (losses || 0.001)
  const rsi = 100 - 100 / (1 + rs)
  if (rsi < 25) return { direction: 'CALL', confidence: 0.52, reason: `RSI oversold (${rsi.toFixed(0)})` }
  if (rsi > 75) return { direction: 'PUT', confidence: 0.52, reason: `RSI overbought (${rsi.toFixed(0)})` }
  return null
}

function computeMACD(prices) {
  if (prices.length < 30) return null
  const ema12 = prices.reduce((s, v, i) => i === 0 ? v : v * (2/13) + s * (11/13), 0)
  const ema26 = prices.reduce((s, v, i) => i === 0 ? v : v * (2/27) + s * (25/27), 0)
  const macd = ema12 - ema26
  const prevPrices = prices.slice(0, -1)
  const prevEma12 = prevPrices.reduce((s, v, i) => i === 0 ? v : v * (2/13) + s * (11/13), 0)
  const prevEma26 = prevPrices.reduce((s, v, i) => i === 0 ? v : v * (2/27) + s * (25/27), 0)
  const prevMacd = prevEma12 - prevEma26
  if (macd > prevMacd) return { direction: 'CALL', confidence: 0.51, reason: 'MACD rising' }
  if (macd < prevMacd) return { direction: 'PUT', confidence: 0.51, reason: 'MACD falling' }
  return null
}

const STRATEGY_FN = {
  momentum: (prices) => computeDirectionMomentum(prices, 5, 5),
  volatility: (prices) => computeVolatilityBreakout(prices, 1.2),
  macd: (prices) => computeMACD(prices),
  bollinger: (prices) => computeBollingerBounce(prices),
  ma_cross: (prices) => computeMACrossover(prices),
  rsi: (prices) => computeRSI(prices),
}

function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false })
}

export default function StrategyPlayground({ watchlist }) {
  const [symbol, setSymbol] = useState('1HZ75V')
  const [strategy, setStrategy] = useState('momentum')
  const [duration, setDuration] = useState(5)
  const [durationUnit, setDurationUnit] = useState('t')
  const [amount, setAmount] = useState(10)
  const contractType = 'CALL'
  const [apiToken, setApiToken] = useState(() => localStorage.getItem('deriv_pat') || '')
  const [tokenSaved, setTokenSaved] = useState(false)
  const [connected, setConnected] = useState(false)
  const [balance, setBalance] = useState(null)
  const [signal, setSignal] = useState(null)
  const [tradeHistory, setTradeHistory] = useState([])
  const [accuracy, setAccuracy] = useState({ correct: 0, total: 0, pct: 0 })
  const [pendingTrade, setPendingTrade] = useState(false)
  const [lastTradeResult, setLastTradeResult] = useState(null)
  const [availableSymbols, setAvailableSymbols] = useState([])
  const [symbolsLoading, setSymbolsLoading] = useState(false)

  const ticksRef = useRef([])
  const pricesRef = useRef([])
  const accuracyRef = useRef({ correct: 0, total: 0 })

  // Auto margin-flip mode
  const [tradeMode, setTradeMode] = useState('manual')
  const [marginPercent, setMarginPercent] = useState(80)
  const [flipMultiplier, setFlipMultiplier] = useState(2)
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoSession, setAutoSession] = useState(null)

  const pendingTradeRef = useRef(false)
  const autoRunningRef = useRef(false)
  const marginPercentRef = useRef(80)
  const balanceAmountRef = useRef(0)
  const signalRef = useRef(null)

  const syntheticSymbols = watchlist?.synthetic ?? ['R_75', 'R_100', 'BOOM500', 'CRASH500']

  // Fetch active symbols from API on mount
  useEffect(() => {
    let mounted = true
    setSymbolsLoading(true)
    derivService.fetchActiveSymbols('brief').then((symbols) => {
      if (!mounted) return
      const sorted = symbols.sort((a, b) => a.market.localeCompare(b.market) || a.underlying_symbol.localeCompare(b.underlying_symbol))
      setAvailableSymbols(sorted)
      // Auto-select a 1s volatility index
      const oneSec = sorted.find(s => s.underlying_symbol.includes('1HZ') && !s.is_trading_suspended)
      if (oneSec) setSymbol(oneSec.underlying_symbol)
      setSymbolsLoading(false)
    }).catch(() => {
      if (mounted) setSymbolsLoading(false)
    })
    return () => { mounted = false }
  }, [])

  // Connect to Deriv ticks
  useEffect(() => {
    let mounted = true
    const unsub = derivService.subscribe((sym, price, _timestamp) => {
      if (!mounted || sym !== symbol) return
      pricesRef.current.push(price)
      if (pricesRef.current.length > 500) pricesRef.current.shift()

      const ticks = derivService.getTicks(sym)
      ticksRef.current = ticks.slice(-200)

      // Compute signal
      const fn = STRATEGY_FN[strategy]
      if (fn && pricesRef.current.length > 20) {
        const sig = fn(pricesRef.current)
        if (sig) {
          setSignal(sig)
          signalRef.current = sig
        }
      }
    })
    return () => { mounted = false; unsub() }
  }, [symbol, strategy])

  // Subscribe to trading service events
  useEffect(() => {
    const unsub = tradingService.subscribe((data) => {
      if (data.type === 'connected') {
        setConnected(true)
        setBalance({ balance: data.balance, currency: data.currency, loginid: data.loginid })
      } else if (data.type === 'contract_opened') {
        setTradeHistory(prev => [{
          id: data.id,
          transactionId: data.transactionId,
          buyPrice: data.buyPrice,
          longcode: data.longcode,
          time: new Date().toISOString(),
          status: 'open',
        }, ...prev])
        setPendingTrade(false)
      } else if (data.type === 'contract_update') {
        setTradeHistory(prev => prev.map(t =>
          t.id === data.contract?.contract_id
            ? { ...t, status: data.contract?.status, profit: data.contract?.profit, exitTime: data.contract?.exit_time }
            : t
        ))
      }
    })
    return () => unsub()
  }, [])

  const handleConnect = () => {
    if (!apiToken.trim()) return
    const appId = localStorage.getItem('deriv_app_id') || ''
    const accountType = localStorage.getItem('deriv_account_type') || 'demo'
    tradingService.setAppId(appId)
    tradingService.setPat(apiToken.trim())
    tradingService.connect(accountType)
    setTokenSaved(true)
    localStorage.setItem('deriv_pat', apiToken.trim())
  }

  const handleDisconnect = () => {
    tradingService.disconnect()
    setConnected(false)
    setBalance(null)
    setTokenSaved(false)
  }

  // Restore PAT on mount
  useEffect(() => {
    const saved = localStorage.getItem('deriv_pat')
    if (saved) {
      setApiToken(saved)
      setTokenSaved(true)
      const appId = localStorage.getItem('deriv_app_id') || ''
      const accountType = localStorage.getItem('deriv_account_type') || 'demo'
      tradingService.setAppId(appId)
      tradingService.setPat(saved)
      tradingService.connect(accountType)
    }
  }, [])

  const handleTrade = async () => {
    if (pendingTrade || !signal) return
    setPendingTrade(true)
    setLastTradeResult(null)

    try {
      const proposal = await tradingService.getProposal({
        contract_type: signal.direction,
        symbol,
        amount,
        duration,
        duration_unit: durationUnit,
      })
      if (proposal) {
        const result = await tradingService.buyContract(proposal.id, amount)
        if (result) {
          setLastTradeResult({ success: true, message: `${signal.direction} contract opened at $${amount}` })
        } else {
          setLastTradeResult({ success: false, message: 'Failed to open contract' })
        }
      } else {
        setLastTradeResult({ success: false, message: 'Failed to get proposal' })
      }
    } catch {
      setLastTradeResult({ success: false, message: 'Error executing trade' })
    }
    setPendingTrade(false)
  }

  // Sync balance and margin to refs for auto-trade engine
  useEffect(() => {
    if (balance) balanceAmountRef.current = balance.balance
  }, [balance])
  useEffect(() => { marginPercentRef.current = marginPercent }, [marginPercent])

  const startAutoTrade = () => {
    if (!connected || !balance) return
    balanceAmountRef.current = balance.balance
    pendingTradeRef.current = false
    setAutoRunning(true)
  }

  const stopAutoTrade = () => {
    autoRunningRef.current = false
    setAutoRunning(false)
  }

  // Auto-trade engine
  useEffect(() => {
    if (!autoRunning || !connected) return
    autoRunningRef.current = true

    const startBal = balanceAmountRef.current
    const session = {
      startBalance: startBal,
      currentBalance: startBal,
      peakBalance: startBal,
      trades: 0,
      wins: 0,
      losses: 0,
      totalProfit: 0,
      maxDrawdown: 0,
      status: 'running',
    }
    setAutoSession({ ...session })

    let stopped = false

    const loop = async () => {
      while (autoRunningRef.current && !stopped) {
        const sig = signalRef.current
        if (!sig || pendingTradeRef.current) {
          await new Promise(r => setTimeout(r, 200))
          continue
        }

        const bal = balanceAmountRef.current
        if (bal < 1) {
          session.status = 'bust'
          session.currentBalance = 0
          setAutoSession({ ...session })
          setAutoRunning(false)
          autoRunningRef.current = false
          return
        }

        const targetBal = startBal * flipMultiplier
        if (bal >= targetBal) {
          session.status = 'target_hit'
          setAutoSession({ ...session })
          setAutoRunning(false)
          autoRunningRef.current = false
          return
        }

        pendingTradeRef.current = true
        const stake = Math.max(Math.round(bal * marginPercentRef.current / 100 * 100) / 100, 1)

        try {
          const result = await tradingService.placeTrade({
            contract_type: sig.direction,
            symbol,
            amount: stake,
            duration: 1,
            duration_unit: 't',
          })

          if (result && !stopped) {
            const pnl = result.profit || 0
            session.trades++
            if (result.status === 'won') session.wins++
            else session.losses++
            session.totalProfit += pnl
            const newBal = result.balanceAfter ?? (bal + pnl)
            balanceAmountRef.current = newBal
            session.currentBalance = newBal
            if (newBal > session.peakBalance) session.peakBalance = newBal
            const dd = session.peakBalance > 0 ? (session.peakBalance - newBal) / session.peakBalance * 100 : 0
            if (dd > session.maxDrawdown) session.maxDrawdown = dd
            setAutoSession({ ...session })
          }
        } catch {
          // trade failed, continue loop
        }
        pendingTradeRef.current = false
      }
    }

    loop()
    return () => { stopped = true }
  }, [autoRunning, connected, symbol, flipMultiplier])

  // Track signal accuracy
  useEffect(() => {
    if (!signal || pricesRef.current.length < 2) return
    const timeout = setTimeout(() => {
      const prices = pricesRef.current
      if (prices.length < duration + 2) return
      const entry = prices[prices.length - 1 - duration]
      const exit = prices[prices.length - 1]
      let correct = false
      if (signal.direction === 'CALL' && exit > entry) correct = true
      if (signal.direction === 'PUT' && exit < entry) correct = true

      const acc = accuracyRef.current
      acc.total++
      if (correct) acc.correct++
      accuracyRef.current = acc
      setAccuracy({ correct: acc.correct, total: acc.total, pct: acc.total > 0 ? (acc.correct / acc.total * 100).toFixed(1) : 0 })
    }, duration * 1000)
    return () => clearTimeout(timeout)
  }, [signal, duration])

  const recentPrice = useMemo(() => {
    return pricesRef.current.length > 0 ? pricesRef.current[pricesRef.current.length - 1] : null
  }, [pricesRef.current.length])

  return (
    <div className="ldp-container" style={{ padding: '24px', maxWidth: 1200 }}>
      <div className="section-block" style={{ marginBottom: 20 }}>
        <h2 className="section-title">Deriv Strategy Playground</h2>
        <p className="section-sub">Live Rise/Fall trading signals using technical analysis on Deriv synthetic indices</p>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {/* Left Column - Controls */}
        <div style={{ flex: 1, minWidth: 300 }}>
          {/* PAT Connection Section */}
          <div className="section-block" style={{ marginBottom: 16 }}>
            <h3 className="section-title">Deriv API Connection</h3>
            <p className="section-sub">Enter your Deriv PAT from <code>app.deriv.com/account/api-token</code></p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="Enter Deriv PAT"
                className="strategy-input"
                disabled={connected}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
              />
              {!connected ? (
                <button className="btn btn-primary" onClick={handleConnect} disabled={!apiToken.trim()}>Connect</button>
              ) : (
                <button className="btn btn-outline" onClick={handleDisconnect}>Disconnect</button>
              )}
            </div>
            {balance && (
              <div style={{ marginTop: 8, display: 'flex', gap: 16 }}>
                <span style={{ color: 'var(--accent)' }}>Balance: {balance.balance} {balance.currency}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{balance.loginid}</span>
              </div>
            )}
            {!connected && tokenSaved && <p style={{ color: '#e67e22', fontSize: 12, marginTop: 4 }}>Connecting...</p>}
          </div>

          {/* Strategy Controls */}
          <div className="section-block" style={{ marginBottom: 16 }}>
            <h3 className="section-title">Strategy Settings</h3>
            <div className="settings-row">
              <label className="settings-label">Symbol</label>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="strategy-select">
                {symbolsLoading ? (
                  <option value="">Loading symbols...</option>
                ) : availableSymbols.length > 0 ? (
                  (() => {
                    const groups = {}
                    availableSymbols.forEach(s => {
                      const m = s.market || 'other'
                      if (!groups[m]) groups[m] = []
                      if (!s.is_trading_suspended) groups[m].push(s)
                    })
                    const sorted = Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]))
                    return sorted.flatMap(([market, syms]) => [
                      <optgroup key={market} label={market.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}>
                        {syms.map(s => (
                          <option key={s.underlying_symbol} value={s.underlying_symbol}>
                            {s.underlying_symbol} — {s.underlying_symbol_name}
                          </option>
                        ))}
                      </optgroup>
                    ])
                  })()
                ) : (
                  syntheticSymbols.map(s => <option key={s} value={s}>{s}</option>)
                )}
              </select>
            </div>
            <div className="settings-row">
              <label className="settings-label">Strategy</label>
              <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="strategy-select">
                {SIGNAL_STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>

            {/* Trade Mode Toggle */}
            <div className="settings-row">
              <label className="settings-label">Trade Mode</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setTradeMode('manual')}
                  className="btn"
                  style={{
                    padding: '4px 12px', fontSize: 12, borderRadius: 4,
                    background: tradeMode === 'manual' ? 'var(--accent)' : 'var(--surface)',
                    color: tradeMode === 'manual' ? '#000' : 'var(--text)',
                    border: '1px solid var(--border)', cursor: 'pointer',
                  }}
                >Manual</button>
                <button
                  onClick={() => setTradeMode('margin')}
                  className="btn"
                  style={{
                    padding: '4px 12px', fontSize: 12, borderRadius: 4,
                    background: tradeMode === 'margin' ? 'var(--accent)' : 'var(--surface)',
                    color: tradeMode === 'margin' ? '#000' : 'var(--text)',
                    border: '1px solid var(--border)', cursor: 'pointer',
                  }}
                >Auto Margin</button>
              </div>
            </div>

            {tradeMode === 'manual' && (
              <>
                <div className="settings-row">
                  <label className="settings-label">Duration</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} min={1} max={100}
                      className="strategy-input-number" style={{ width: 80, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                    />
                    <select value={durationUnit} onChange={(e) => setDurationUnit(e.target.value)} className="strategy-select" style={{ width: 100 }}>
                      {DURATION_UNITS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="settings-row">
                  <label className="settings-label">Bet Amount</label>
                  <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} min={1} max={100}
                    className="strategy-input-number" style={{ width: 120, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                  />
                </div>
              </>
            )}

            {tradeMode === 'margin' && (
              <>
                <div className="settings-row">
                  <label className="settings-label">Margin %</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="range" min={5} max={100} value={marginPercent}
                      onChange={(e) => setMarginPercent(Number(e.target.value))}
                      style={{ width: 100 }} />
                    <span style={{ width: 40, textAlign: 'right', fontWeight: 600 }}>{marginPercent}%</span>
                  </div>
                </div>
                <div className="settings-row">
                  <label className="settings-label">Flip Target</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="number" value={flipMultiplier} onChange={(e) => setFlipMultiplier(Number(e.target.value))} min={1.1} max={100} step={0.1}
                      className="strategy-input-number" style={{ width: 80, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>x</span>
                  </div>
                </div>
                <div className="settings-row">
                  <label className="settings-label">Auto Trade</label>
                  {!autoRunning ? (
                    <button
                      onClick={startAutoTrade}
                      disabled={!connected}
                      className="btn"
                      style={{
                        padding: '6px 16px', fontSize: 13, borderRadius: 4,
                        background: '#2ecc71', color: 'white', border: 'none', cursor: 'pointer',
                        opacity: !connected ? 0.5 : 1,
                      }}
                    >
                      {!connected ? 'Connect First' : 'Start Auto Flip'}
                    </button>
                  ) : (
                    <button
                      onClick={stopAutoTrade}
                      className="btn"
                      style={{
                        padding: '6px 16px', fontSize: 13, borderRadius: 4,
                        background: '#e74c3c', color: 'white', border: 'none', cursor: 'pointer',
                      }}
                    >Stop Auto Flip</button>
                  )}
                </div>
                {autoRunning && (
                  <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)' }}>
                    <div style={{ fontSize: 12, color: '#2ecc71', fontWeight: 600 }}>● Auto-trading active — compounding {marginPercent}% margin on {symbol}</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Column - Live Signal */}
        <div style={{ flex: 1.5, minWidth: 400 }}>
          <div className="section-block" style={{ marginBottom: 16 }}>
            <h3 className="section-title">Live Signal</h3>
            <p className="section-sub">Current price: {recentPrice?.toFixed(2) ?? '—'}</p>

            {/* Auto Session Stats */}
            {autoRunning && autoSession && (
              <div style={{
                padding: 16, borderRadius: 8, marginTop: 8, marginBottom: 12,
                background: autoSession.status === 'target_hit' ? 'rgba(46,204,113,0.15)' : autoSession.status === 'bust' ? 'rgba(231,76,60,0.15)' : 'rgba(52,152,219,0.1)',
                border: `1px solid ${autoSession.status === 'target_hit' ? 'rgba(46,204,113,0.4)' : autoSession.status === 'bust' ? 'rgba(231,76,60,0.4)' : 'rgba(52,152,219,0.3)'}`,
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                  {autoSession.status === 'target_hit' ? '🎯 Target Reached!' : autoSession.status === 'bust' ? '💥 Account Busted' : '🔄 Auto-Flip Running'}
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: autoSession.totalProfit >= 0 ? '#2ecc71' : '#e74c3c' }}>
                      ${autoSession.currentBalance.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Balance</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600 }}>{autoSession.trades}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Trades</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: '#2ecc71' }}>{autoSession.wins}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Wins</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: '#e74c3c' }}>{autoSession.losses}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Losses</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600 }}>
                      {autoSession.trades > 0 ? (autoSession.wins / autoSession.trades * 100).toFixed(1) : '—'}%
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Win Rate</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: autoSession.maxDrawdown > 30 ? '#e74c3c' : autoSession.maxDrawdown > 15 ? '#f39c12' : '#2ecc71' }}>
                      {autoSession.maxDrawdown.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Max DD</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: autoSession.totalProfit >= 0 ? '#2ecc71' : '#e74c3c' }}>
                      ${autoSession.totalProfit >= 0 ? '+' : ''}{autoSession.totalProfit.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total P&L</div>
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  Target: ${(autoSession.startBalance * flipMultiplier).toFixed(2)} ({flipMultiplier}x) | Start: ${autoSession.startBalance.toFixed(2)}
                </div>
              </div>
            )}

            {signal && tradeMode === 'manual' ? (
              <div style={{
                padding: 16, borderRadius: 8, marginTop: 8,
                background: signal.direction === 'CALL' ? 'rgba(46, 204, 113, 0.15)' : 'rgba(231, 76, 60, 0.15)',
                border: `1px solid ${signal.direction === 'CALL' ? 'rgba(46, 204, 113, 0.4)' : 'rgba(231, 76, 60, 0.4)'}`,
              }}>
                <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
                  {signal.direction === 'CALL' ? '📈 RISE' : '📉 FALL'}
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                  Confidence: {(signal.confidence * 100).toFixed(0)}% | Reason: {signal.reason}
                </div>
                <button
                  className={`btn ${signal.direction === 'CALL' ? 'btn-success' : 'btn-danger'}`}
                  onClick={handleTrade}
                  disabled={pendingTrade || !connected}
                  style={{ marginTop: 12, padding: '8px 24px', fontSize: 14 }}
                >
                  {pendingTrade ? 'Opening...' : `Trade ${signal.direction === 'CALL' ? 'Rise' : 'Fall'} ($${amount})`}
                </button>
                {!connected && <p style={{ color: '#e67e22', fontSize: 11, marginTop: 6 }}>Connect your PAT above to trade</p>}
                {lastTradeResult && (
                  <p style={{ color: lastTradeResult.success ? '#2ecc71' : '#e74c3c', fontSize: 12, marginTop: 6 }}>
                    {lastTradeResult.message}
                  </p>
                )}
              </div>
            ) : signal && tradeMode === 'margin' && !autoRunning ? (
              <div style={{ padding: 16, borderRadius: 8, marginTop: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
                  {signal.direction === 'CALL' ? '📈' : '📉'} {signal.direction === 'CALL' ? 'RISE' : 'FALL'} signal detected
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Reason: {signal.reason} — Press "Start Auto Flip" to begin auto-trading
                </div>
              </div>
            ) : !signal && (
              <div style={{ padding: 16, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Waiting for signal... (needs {strategy === 'momentum' ? '5' : '20'} ticks of data)
              </div>
            )}
          </div>

          {/* Accuracy Tracker */}
          {tradeMode === 'manual' && (
            <div className="section-block" style={{ marginBottom: 16 }}>
              <h3 className="section-title">Live Accuracy</h3>
              <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: accuracy.pct > 52 ? '#2ecc71' : accuracy.pct > 50 ? '#f39c12' : '#e74c3c' }}>
                    {accuracy.pct}%
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Win Rate</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{accuracy.correct}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Correct</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{accuracy.total}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{accuracy.total > 0 ? ((accuracy.correct / accuracy.total * 1.92 - 1) * 100).toFixed(1) : '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>ROI %</div>
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                Breakeven at 52.08% (92% payout) | {accuracy.pct > 52.08 ? '✅ Profitable' : '❌ Below breakeven'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Trade History */}
      <div className="section-block">
        <h3 className="section-title">Trade History</h3>
        <p className="section-sub">Recent trades executed via Deriv API</p>
        {tradeHistory.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 8 }}>No trades yet</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="strategy-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>ID</th>
                  <th>Contract</th>
                  <th>Stake</th>
                  <th>Status</th>
                  <th>P&L</th>
                </tr>
              </thead>
              <tbody>
                {tradeHistory.slice(0, 20).map((t) => (
                  <tr key={t.id}>
                    <td>{formatTime(t.time)}</td>
                    <td style={{ fontSize: 11 }}>{String(t.id).slice(0, 8)}...</td>
                    <td>{t.longcode || '—'}</td>
                    <td>${t.buyPrice?.toFixed(2) || '—'}</td>
                    <td>
                      <span style={{
                        color: t.status === 'won' ? '#2ecc71' : t.status === 'lost' ? '#e74c3c' : t.status === 'open' ? '#3498db' : 'var(--text-muted)',
                        fontWeight: 600,
                      }}>
                        {t.status || '—'}
                      </span>
                    </td>
                    <td style={{ color: (t.profit || 0) >= 0 ? '#2ecc71' : '#e74c3c' }}>
                      {t.profit != null ? `$${t.profit.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        .strategy-input::placeholder { color: var(--text-muted); opacity: 0.6; }
        .strategy-select {
          padding: 6px 10px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text);
          font-size: 13px;
        }
        .strategy-input-number {
          font-size: 14px;
        }
        .settings-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 10px;
        }
        .settings-label {
          font-size: 13px;
          color: var(--text-muted);
        }
        .strategy-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .strategy-table th, .strategy-table td {
          padding: 8px 12px;
          text-align: left;
          border-bottom: 1px solid var(--border);
        }
        .strategy-table th {
          color: var(--text-muted);
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .btn-success {
          background: #2ecc71;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        }
        .btn-success:hover { background: #27ae60; }
        .btn-success:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-danger {
          background: #e74c3c;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        }
        .btn-danger:hover { background: #c0392b; }
        .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-outline {
          background: transparent;
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 8px 16px;
          cursor: pointer;
        }
        .btn-outline:hover { border-color: var(--accent); }
      `}</style>
    </div>
  )
}
