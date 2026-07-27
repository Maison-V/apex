import { useCallback, useEffect, useRef, useState } from 'react'

import { derivService } from '../services/derivService'
import { oauthService } from '../services/oauthService'
import { tradingService } from '../services/tradingService'
import { tradingEngine } from '../services/tradingEngine'

const SYNTHETIC_SYMBOLS = [
  'R_75', 'R_100', 'R_25', 'R_50', 'R_10',
  '1HZ75V', '1HZ100V', '1HZ10V', '1HZ25V', '1HZ50V',
  'BOOM500', 'BOOM1000', 'BOOM300N', 'BOOM600', 'BOOM900',
  'CRASH500', 'CRASH1000', 'CRASH300N', 'CRASH600', 'CRASH900',
]

export default function ApexEscapePlan({ watchlist }) {
  const [connected, setConnected] = useState(false)
  const [balance, setBalance] = useState(0)
  const [currency, setCurrency] = useState('USD')

  const [riskPct, setRiskPct] = useState(80)
  const [symbol, setSymbol] = useState('BOOM500')
  const [duration, setDuration] = useState(1)
  const [durationUnit, setDurationUnit] = useState('t')
  const [lookback, setLookback] = useState(5)

  const [botRunning, setBotRunning] = useState(false)
  const [botStatus, setBotStatus] = useState('idle')
  const [pendingTrade, setPendingTrade] = useState(false)
  const [ticksReady, setTicksReady] = useState(false)

  const [upCounter, setUpCounter] = useState(0)
  const [downCounter, setDownCounter] = useState(0)
  const [lastPrice, setLastPrice] = useState(null)
  const [currentPrice, setCurrentPrice] = useState(null)
  const [activeContract, setActiveContract] = useState(null)

  const [wins, setWins] = useState(0)
  const [losses, setLosses] = useState(0)
  const [totalTrades, setTotalTrades] = useState(0)
  const [totalProfit, setTotalProfit] = useState(0)
  const [startBalance, setStartBalance] = useState(0)
  const [peakBalance, setPeakBalance] = useState(0)
  const [currentStake, setCurrentStake] = useState(0)

  const [tradeLog, setTradeLog] = useState([])
  const [errorMsg, setErrorMsg] = useState(null)
  const [message, setMessage] = useState(null)

  const tradeLogRef = useRef([])
  const balanceRef = useRef(0)

  useEffect(() => {
    tradingEngine.init(derivService, tradingService)
  }, [])

  useEffect(() => {
    if (!oauthService.isAuthenticated()) return
    const syms = watchlist?.synthetic ?? SYNTHETIC_SYMBOLS
    derivService.init().then(() => {
      derivService.connect(syms)
      setTicksReady(true)
    })
  }, [oauthService.isAuthenticated()])

  useEffect(() => {
    const unsub = tradingService.subscribe((data) => {
      if (data.type === 'connected') {
        setConnected(true)
        setBalance(data.balance || 0)
        setCurrency(data.currency || 'USD')
        balanceRef.current = data.balance || 0
      } else if (data.type === 'disconnected') {
        setConnected(false)
      } else if (data.type === 'error') {
        setErrorMsg(data.message)
        setConnected(false)
      }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!connected || !ticksReady) return
    const unsub = derivService.subscribe((sym, price) => {
      if (sym !== symbol) return
    })
    return () => unsub()
  }, [connected, ticksReady, symbol])

  useEffect(() => {
    const unsub = tradingEngine.subscribe((data) => {
      switch (data.type) {
        case 'started':
          setBotRunning(true)
          setBotStatus('running')
          setStartBalance(tradingEngine.stats.startBalance)
          setPeakBalance(tradingEngine.stats.peakBalance)
          setMessage(null)
          setErrorMsg(null)
          break
        case 'stopped':
          setBotRunning(false)
          setBotStatus('stopped')
          setPendingTrade(false)
          break
        case 'state_update': {
          const s = data.state
          setUpCounter(s.upCounter)
          setDownCounter(s.downCounter)
          setLastPrice(s.lastPrice)
          setCurrentPrice(s.currentPrice)
          break
        }
        case 'trade_start':
          setPendingTrade(true)
          setActiveContract(data.direction)
          break
        case 'stake_calculated':
          setCurrentStake(data.stake)
          break
        case 'trade_complete': {
          const r = data.result
          setPendingTrade(false)
          setActiveContract(null)
          setCurrentStake(0)
          setWins(data.stats.wins)
          setLosses(data.stats.losses)
          setTotalTrades(data.stats.totalTrades)
          setTotalProfit(data.stats.totalProfit)
          setPeakBalance(data.stats.peakBalance)
          const afterBal = r.balanceAfter || (balanceRef.current + (r.profit || 0))
          setBalance(afterBal)
          balanceRef.current = afterBal

          tradeLogRef.current = [data.log, ...tradeLogRef.current]
          setTradeLog([...tradeLogRef.current])
          break
        }
        case 'error':
          setPendingTrade(false)
          setErrorMsg(data.message)
          break
      }
    })
    return () => unsub()
  }, [])

  const handleLogout = useCallback(() => {
    tradingEngine.stop()
    tradingService.disconnect()
    derivService.disconnect()
    oauthService.logout()
    setConnected(false)
    setBalance(0)
    setBotRunning(false)
    setBotStatus('idle')
    setTradeLog([])
    tradeLogRef.current = []
  }, [])

  const handleStartBot = useCallback(() => {
    if (!connected) return
    setErrorMsg(null)
    setMessage('Starting bot...')
    tradingEngine.resetStats()
    tradeLogRef.current = []
    setTradeLog([])
    tradingEngine.start({
      symbol,
      riskPercent: riskPct,
      duration,
      durationUnit: durationUnit,
      lookback,
    })
  }, [connected, symbol, riskPct, duration, durationUnit, lookback])

  const handleStopBot = useCallback(() => {
    tradingEngine.stop()
  }, [])

  const handleEmergencyStop = useCallback(() => {
    tradingEngine.emergencyStop()
    setMessage('Emergency stop activated')
  }, [])

  const handleExportCsv = useCallback(() => {
    const csv = tradingEngine.exportCsv()
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `escape-plan-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : '—'
  const roi = startBalance > 0 ? (totalProfit / startBalance * 100).toFixed(1) : '—'
  const maxDrawdown = startBalance > 0 ? Math.min(0, ((peakBalance - balance) / peakBalance * 100)).toFixed(1) : '—'

  if (!oauthService.isAuthenticated()) {
    return (
      <div className="ldp-container" style={{ padding: 24, maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
        <div className="section-block" style={{ padding: '48px 36px' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🚀</div>
          <h2 className="section-title" style={{ fontSize: 24 }}>APEX Escape Plan</h2>
          <p className="section-sub" style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6 }}>
            Automated account flip bot using the consecutive counter strategy on Deriv synthetic indices.
          </p>
          <div style={{ marginTop: 28, padding: 20, background: 'rgba(243,156,18,0.1)', borderRadius: 8, border: '1px solid rgba(243,156,18,0.3)' }}>
            <p style={{ fontSize: 14, color: '#f39c12', fontWeight: 600, marginBottom: 8 }}>Connect Deriv Account</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Click <strong>CONNECT DERIV</strong> in the top bar to link your Deriv account via OAuth.
              No API keys needed.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="ldp-container" style={{ padding: 24, maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
        <div className="section-block" style={{ padding: '48px 36px' }}>
          <div className="loader-glyph" aria-label="Connecting">
            <span /><span /><span />
          </div>
          <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>Connecting to Deriv...</p>
          <button onClick={handleLogout}
            style={{
              marginTop: 24, padding: '8px 20px', borderRadius: 6, fontSize: 13,
              background: 'transparent', color: 'var(--text-muted)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}
          >
            Disconnect
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ldp-container" style={{ padding: 24, maxWidth: 1200 }}>
      <div className="section-block" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="section-title" style={{ fontSize: 20 }}>APEX Escape Plan</h2>
            <p className="section-sub">Automated consecutive counter trading bot</p>
          </div>
          <button
            onClick={handleLogout}
            className="btn btn-outline"
            style={{ padding: '6px 14px', fontSize: 12 }}
          >
            Disconnect
          </button>
        </div>
      </div>

      {errorMsg && (
        <div style={{
          padding: '10px 16px', marginBottom: 12, borderRadius: 6,
          background: 'rgba(231,76,60,0.15)', border: '1px solid rgba(231,76,60,0.4)',
          color: '#e74c3c', fontSize: 13,
        }}>
          {errorMsg}
          <button onClick={() => setErrorMsg(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer' }}>✕</button>
        </div>
      )}
      {message && (
        <div style={{
          padding: '10px 16px', marginBottom: 12, borderRadius: 6,
          background: 'rgba(46,204,113,0.15)', border: '1px solid rgba(46,204,113,0.4)',
          color: '#2ecc71', fontSize: 13,
        }}>
          {message}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="section-block">
          <h3 className="section-title" style={{ margin: '0 0 12px 0' }}>Account</h3>
          <div style={{ fontSize: 13, lineHeight: 2 }}>
            <div>Balance: <strong>${balance.toFixed(2)}</strong> {currency}</div>
            <div>Session: <span style={{ color: '#2ecc71' }}>● Connected</span></div>
          </div>
        </div>
        <div className="section-block">
          <h3 className="section-title" style={{ margin: '0 0 12px 0' }}>Stats</h3>
          <div style={{ fontSize: 13, lineHeight: 2 }}>
            <div>Trades: {totalTrades} | {winRate}% win</div>
            <div>P/L: <span style={{ color: totalProfit >= 0 ? '#2ecc71' : '#e74c3c', fontWeight: 600 }}>{totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}</span></div>
            <div>ROI: {roi}% | DD: {maxDrawdown}%</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
        <div>
          <div className="section-block" style={{ marginBottom: 16 }}>
            <h3 className="section-title" style={{ margin: '0 0 12px 0' }}>Strategy Settings</h3>

            <div className="settings-row">
              <label className="settings-label">Symbol</label>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} disabled={botRunning} className="strategy-select">
                {SYNTHETIC_SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <label className="settings-label">Risk %</label>
              <input type="number" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))}
                min={1} max={100} disabled={botRunning}
                className="strategy-input-number" style={{ width: 60 }}
              />
            </div>
            <div className="settings-row">
              <label className="settings-label">Duration</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                  min={1} max={100} disabled={botRunning}
                  className="strategy-input-number" style={{ width: 50 }}
                />
                <select value={durationUnit} onChange={(e) => setDurationUnit(e.target.value)} disabled={botRunning} className="strategy-select" style={{ width: 80 }}>
                  <option value="t">Ticks</option>
                  <option value="m">Minutes</option>
                </select>
              </div>
            </div>
            <div className="settings-row">
              <label className="settings-label">Lookback</label>
              <input type="number" value={lookback} onChange={(e) => setLookback(Number(e.target.value))}
                min={2} max={20} disabled={botRunning}
                className="strategy-input-number" style={{ width: 60 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              {!botRunning ? (
                <button onClick={handleStartBot} disabled={!connected}
                  className="btn"
                  style={{
                    flex: 1, padding: '10px 16px', fontSize: 14, fontWeight: 600,
                    background: connected ? '#2ecc71' : '#555', color: 'white',
                    border: 'none', borderRadius: 6, cursor: connected ? 'pointer' : 'not-allowed',
                    opacity: connected ? 1 : 0.5,
                  }}
                >
                  ▶ Start Bot
                </button>
              ) : (
                <>
                  <button onClick={handleStopBot}
                    className="btn"
                    style={{
                      flex: 1, padding: '10px 16px', fontSize: 14, fontWeight: 600,
                      background: '#e67e22', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer',
                    }}
                  >
                    ■ Stop
                  </button>
                  <button onClick={handleEmergencyStop}
                    className="btn"
                    style={{
                      padding: '10px 16px', fontSize: 14, fontWeight: 600,
                      background: '#e74c3c', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer',
                    }}
                  >
                    ⛔ Emergency
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="section-block">
            <h3 className="section-title" style={{ margin: '0 0 8px 0' }}>Live State</h3>
            <div style={{ fontSize: 12, lineHeight: 2 }}>
              <div>Up counter: <strong>{upCounter}</strong></div>
              <div>Down counter: <strong>{downCounter}</strong></div>
              <div>Last price: <strong>{lastPrice != null ? lastPrice.toFixed(4) : '—'}</strong></div>
              <div>Current price: <strong>{currentPrice != null ? currentPrice.toFixed(4) : '—'}</strong></div>
              {activeContract && <div>Active: <strong style={{ color: activeContract === 'CALL' ? '#2ecc71' : '#e74c3c' }}>{activeContract}</strong></div>}
              {currentStake > 0 && <div>Stake: <strong>${currentStake.toFixed(2)}</strong></div>}
              {pendingTrade && <div style={{ color: '#f39c12', fontWeight: 600 }}>Trade in progress...</div>}
            </div>
          </div>
        </div>

        <div className="section-block">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="section-title" style={{ margin: 0 }}>Trade Log</h3>
            {tradeLog.length > 0 && (
              <button onClick={handleExportCsv} className="btn btn-outline" style={{ padding: '4px 10px', fontSize: 11 }}>
                Export CSV
              </button>
            )}
          </div>
          {tradeLog.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 8, fontSize: 13 }}>
              No trades yet. Start the bot to begin.
            </p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 8, maxHeight: 400, overflowY: 'auto' }}>
              <table className="strategy-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Dir</th>
                    <th>Stake</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>P/L</th>
                    <th>Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeLog.map((t, i) => (
                    <tr key={i}>
                      <td>{new Date(t.timestamp).toLocaleTimeString('en-US', { hour12: false })}</td>
                      <td style={{ fontWeight: 600, color: t.direction === 'CALL' ? '#2ecc71' : '#e74c3c' }}>
                        {t.direction === 'CALL' ? 'RISE' : 'FALL'}
                      </td>
                      <td>${t.stake.toFixed(2)}</td>
                      <td>{t.entryTick != null ? t.entryTick.toFixed(1) : '—'}</td>
                      <td>{t.exitTick != null ? t.exitTick.toFixed(1) : '—'}</td>
                      <td style={{ color: t.profit >= 0 ? '#2ecc71' : '#e74c3c', fontWeight: 600 }}>
                        {t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}
                      </td>
                      <td>${t.balanceAfter.toFixed(2)}</td>
                      <td>
                        <span style={{
                          color: t.status === 'won' ? '#2ecc71' : t.status === 'lost' ? '#e74c3c' : '#f39c12',
                          fontWeight: 600,
                        }}>
                          {t.status === 'won' ? 'WIN' : t.status === 'lost' ? 'LOSS' : t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
