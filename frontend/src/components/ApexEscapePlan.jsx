import { useCallback, useEffect, useRef, useState } from 'react'

import { derivService } from '../services/derivService'
import { tradingService } from '../services/tradingService'
import { tradingEngine } from '../services/tradingEngine'

const SYNTHETIC_SYMBOLS = [
  'R_75', 'R_100', 'R_25', 'R_50', 'R_10',
  '1HZ75V', '1HZ100V', '1HZ10V', '1HZ25V', '1HZ50V',
  'BOOM500', 'BOOM1000', 'BOOM300N', 'BOOM600', 'BOOM900',
  'CRASH500', 'CRASH1000', 'CRASH300N', 'CRASH600', 'CRASH900',
]

export default function ApexEscapePlan({ watchlist }) {
  const [authState, setAuthState] = useState(null)
  const [accountInfo, setAccountInfo] = useState(null)
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
  const [patInput, setPatInput] = useState(() => localStorage.getItem('deriv_pat') || '')
  const [accountType, setAccountType] = useState(() => {
    return localStorage.getItem('deriv_account_type') || 'demo'
  })
  const [connecting, setConnecting] = useState(false)
  const [connectMsg, setConnectMsg] = useState('')
  const [appId, setAppId] = useState(() => localStorage.getItem('deriv_app_id') || '')

  const tradeLogRef = useRef([])
  const balanceRef = useRef(0)
  const accountTypeRef = useRef('demo')

  // Init engine
  useEffect(() => {
    tradingEngine.init(derivService, tradingService)
  }, [])

  // Check for existing PAT on mount
  useEffect(() => {
    const savedType = localStorage.getItem('deriv_account_type') || 'demo'
    const savedPat = localStorage.getItem('deriv_pat')
    const savedAppId = localStorage.getItem('deriv_app_id') || ''
    if (savedPat) {
      setAccountType(savedType)
      setAuthState('authenticated')
      tradingService.setAppId(savedAppId)
      tradingService.setPat(savedPat)
      tradingService.connect(savedType)
    } else {
      setAuthState('unauthenticated')
    }
  }, [])

  // Listen for trading service events
  useEffect(() => {
    const unsub = tradingService.subscribe((data) => {
      if (data.type === 'connected') {
        const accType = data.account_type || 'real'
        setConnected(true)
        setConnectMsg('')
        setAccountInfo({ loginid: data.loginid, account_type: accType, currency: data.currency })
        setBalance(data.balance || 0)
        setCurrency(data.currency || 'USD')
        balanceRef.current = data.balance || 0
        localStorage.setItem('deriv_account_type', accType)
        setAccountType(accType)
        accountTypeRef.current = accType
        // Connect tick data feed
        derivService.init().then(() => {
          derivService.connect(['BOOM500', 'RISE100'])
        })
      } else if (data.type === 'disconnected') {
        setConnected(false)
        if (!botRunning) setAuthState('unauthenticated')
      } else if (data.type === 'error') {
        setErrorMsg(data.message)
        setConnected(false)
        setConnecting(false)
        setConnectMsg('')
      } else if (data.type === 'status') {
        setConnectMsg(data.message)
      }
    })
    return () => unsub()
  }, [botRunning])

  // Listen for engine events
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

  const handlePatConnect = useCallback(() => {
    const pat = patInput.trim()
    if (!pat) return
    setConnecting(true)
    setErrorMsg(null)
    setAuthState('authenticated')
    localStorage.setItem('deriv_pat', pat)
    localStorage.setItem('deriv_account_type', accountType)
    localStorage.setItem('deriv_app_id', appId)
    tradingService.setAppId(appId)
    tradingService.setPat(pat)
    tradingService.connect(accountType)
  }, [patInput, accountType, appId])

  const handleCancelConnect = useCallback(() => {
    setConnecting(false)
    setConnectMsg('')
    setErrorMsg(null)
    setAuthState('unauthenticated')
    setTimeout(() => tradingService.disconnect(), 0)
  }, [])

  const handleLogout = useCallback(() => {
    tradingEngine.stop()
    tradingService.disconnect()
    derivService.disconnect()
    localStorage.removeItem('deriv_pat')
    localStorage.removeItem('deriv_account_type')
    setAuthState('unauthenticated')
    setAccountInfo(null)
    setConnected(false)
    setBalance(0)
    setConnecting(false)
    setApiTokenInput('')
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
      durationUnit,
      lookback,
      strategyId: 'consecutive_counter',
    })
  }, [connected, symbol, riskPct, duration, durationUnit, lookback])

  const handleStopBot = useCallback(() => {
    tradingEngine.stop()
    setMessage('Bot stopped')
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

  if (authState !== 'authenticated') {
    return (
      <div className="ldp-container" style={{ padding: 24, maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
        <div className="section-block" style={{ padding: '48px 36px' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🚀</div>
          <h2 className="section-title" style={{ fontSize: 24 }}>APEX Escape Plan</h2>
          <p className="section-sub" style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6 }}>
            Automated account flip bot using the consecutive counter strategy on Deriv synthetic indices.
          </p>

          <div style={{ marginTop: 28, marginBottom: 16, textAlign: 'left' }}>
            <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
              Account Type
            </label>
            <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
              <button onClick={() => {
                setAccountType('demo')
                accountTypeRef.current = 'demo'
                setErrorMsg(null)
              }}
                style={{
                  flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600,
                  border: '1px solid var(--border)', cursor: 'pointer',
                  borderRight: 'none', borderRadius: '6px 0 0 6px',
                  background: accountType === 'demo' ? '#f39c12' : 'transparent',
                  color: accountType === 'demo' ? '#fff' : 'var(--text-muted)',
                }}
              >
                Demo
              </button>
              <button onClick={() => {
                setAccountType('real')
                accountTypeRef.current = 'real'
                setErrorMsg(null)
              }}
                style={{
                  flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600,
                  border: '1px solid var(--border)', cursor: 'pointer',
                  borderRadius: '0 6px 6px 0',
                  background: accountType === 'real' ? '#2ecc71' : 'transparent',
                  color: accountType === 'real' ? '#fff' : 'var(--text-muted)',
                }}
              >
                Real
              </button>
            </div>

            <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
              Deriv App ID
            </label>
            <input type="text" value={appId}
              onChange={(e) => { setAppId(e.target.value); localStorage.setItem('deriv_app_id', e.target.value) }}
              placeholder="1089"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 16,
              }}
            />

            <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
              Personal Access Token (PAT)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="password" value={patInput}
                onChange={(e) => setPatInput(e.target.value)}
                placeholder="Paste your PAT here"
                onKeyDown={(e) => e.key === 'Enter' && handlePatConnect()}
                style={{
                  flex: 1, padding: '12px 14px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text)', fontSize: 14, outline: 'none',
                }}
              />
              <button onClick={handlePatConnect}
                disabled={!patInput.trim() || connecting}
                style={{
                  padding: '12px 24px', borderRadius: 6, fontSize: 14, fontWeight: 600,
                  background: patInput.trim() && !connecting ? '#ff4444' : '#555',
                  color: 'white', border: 'none', cursor: patInput.trim() && !connecting ? 'pointer' : 'not-allowed',
                  opacity: patInput.trim() && !connecting ? 1 : 0.5, whiteSpace: 'nowrap',
                }}
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8, marginTop: 16 }}>
            <p>1. Go to <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noopener noreferrer"
              style={{ color: '#3498db' }}>app.deriv.com/account/api-token</a></p>
            <p>2. Create a PAT with <strong>trade</strong> scope</p>
            <p>3. Enter your App ID and PAT above, then click Connect</p>
          </div>
        </div>
      </div>
    )
  }

  if (authState === 'authenticated' && !connected) {
    return (
      <div className="ldp-container" style={{ padding: 24, maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
        <div className="section-block" style={{ padding: '60px 40px' }}>
          {errorMsg ? (
            <>
              <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
              <p style={{ marginTop: 16, color: '#e74c3c', fontSize: 14 }}>{errorMsg}</p>
              <button onClick={() => { setErrorMsg(null); setAuthState('unauthenticated') }}
                style={{
                  marginTop: 24, padding: '10px 24px', borderRadius: 6, fontSize: 14, fontWeight: 600,
                  background: '#ff4444', color: 'white', border: 'none', cursor: 'pointer',
                }}
              >
                Back to Login
              </button>
            </>
          ) : (
            <>
              <div className="loader-glyph" aria-label="Connecting">
                <span /><span /><span />
              </div>
              <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>{connectMsg || 'Connecting to Deriv...'}</p>
              <button onClick={handleCancelConnect}
                style={{
                  marginTop: 24, padding: '8px 20px', borderRadius: 6, fontSize: 13,
                  background: 'transparent', color: 'var(--text-muted)',
                  border: '1px solid var(--border)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ldp-container" style={{ padding: 24, maxWidth: 1200 }}>
      {/* Header */}
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

      {message && !errorMsg && (
        <div style={{
          padding: '10px 16px', marginBottom: 12, borderRadius: 6,
          background: 'rgba(52,152,219,0.12)', border: '1px solid rgba(52,152,219,0.3)',
          color: '#3498db', fontSize: 13,
        }}>
          {message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* Left Column */}
        <div style={{ flex: 1, minWidth: 300 }}>

          {/* Account Info */}
          <div className="section-block" style={{ marginBottom: 16 }}>
            <h3 className="section-title">Connected Account</h3>
            {accountInfo && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Account ID</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{accountInfo.loginid || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Type</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: accountInfo.account_type === 'demo' ? '#f39c12' : '#2ecc71' }}>
                    {accountInfo.account_type || '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Currency</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{currency || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Balance</span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: connected ? '#2ecc71' : 'var(--text-muted)' }}>
                    {balance.toFixed(2)} {currency}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Status</span>
                  <span style={{
                    fontWeight: 600, fontSize: 12,
                    color: connected ? '#2ecc71' : '#e74c3c',
                  }}>
                    {connected ? '● Live' : '○ Disconnected'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="section-block" style={{ marginBottom: 16 }}>
            <h3 className="section-title">Bot Settings</h3>
            <div className="settings-row">
              <label className="settings-label">Risk %</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="range" min={5} max={100} value={riskPct}
                  onChange={(e) => setRiskPct(Number(e.target.value))}
                  disabled={botRunning}
                  style={{ width: 100 }} />
                <span style={{ width: 40, textAlign: 'right', fontWeight: 600, fontSize: 13 }}>{riskPct}%</span>
              </div>
            </div>
            <div className="settings-row">
              <label className="settings-label">Symbol</label>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} disabled={botRunning} className="strategy-select">
                {(watchlist?.synthetic ?? SYNTHETIC_SYMBOLS).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <label className="settings-label">Duration</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                  min={1} max={100} disabled={botRunning}
                  className="strategy-input-number" style={{ width: 60, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
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
                className="strategy-input-number" style={{ width: 60, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
              />
            </div>

            {/* Bot Controls */}
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

          {/* Trade Log */}
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
                            {t.status}
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

        {/* Right Column - Dashboard */}
        <div style={{ flex: 1.5, minWidth: 350 }}>

          {/* Bot Status */}
          <div className="section-block" style={{ marginBottom: 16 }}>
            <h3 className="section-title">Bot Dashboard</h3>
            <div style={{
              display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8,
              padding: 16, borderRadius: 8,
              background: botRunning ? 'rgba(46,204,113,0.08)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${botRunning ? 'rgba(46,204,113,0.3)' : 'var(--border)'}`,
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Bot Status</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: botRunning ? '#2ecc71' : botStatus === 'stopped' ? '#e67e22' : 'var(--text-muted)' }}>
                  {botRunning ? '● Running' : botStatus === 'stopped' ? '● Stopped' : '○ Idle'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Current Stake</div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{currentStake > 0 ? `$${currentStake.toFixed(2)}` : '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Active Contract</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: activeContract === 'CALL' ? '#2ecc71' : activeContract === 'PUT' ? '#e74c3c' : 'var(--text-muted)' }}>
                  {activeContract || '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Connection</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: connected ? '#2ecc71' : '#e74c3c' }}>
                  {connected ? '● Live' : '○ Offline'}
                </div>
              </div>
            </div>
          </div>

          {/* Tick Monitor */}
          <div className="section-block" style={{ marginBottom: 16 }}>
            <h3 className="section-title">Tick Monitor</h3>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              <div style={{ flex: 1, minWidth: 120, padding: 12, borderRadius: 6, background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.2)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Up Counter</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#2ecc71' }}>{upCounter}</div>
              </div>
              <div style={{ flex: 1, minWidth: 120, padding: 12, borderRadius: 6, background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.2)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Down Counter</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#e74c3c' }}>{downCounter}</div>
              </div>
              <div style={{ flex: 1, minWidth: 120, padding: 12, borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Target</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{lookback}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Previous Tick</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{lastPrice != null ? lastPrice.toFixed(1) : '—'}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Current Tick</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{currentPrice != null ? currentPrice.toFixed(1) : '—'}</div>
              </div>
            </div>
          </div>

          {/* Performance Stats */}
          <div className="section-block">
            <h3 className="section-title">Performance</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
              <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', minWidth: 80, flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#2ecc71' }}>{wins}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Wins</div>
              </div>
              <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', minWidth: 80, flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#e74c3c' }}>{losses}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Losses</div>
              </div>
              <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', minWidth: 80, flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: winRate > 52 ? '#2ecc71' : winRate > 50 ? '#f39c12' : '#e74c3c' }}>{winRate}{winRate !== '—' ? '%' : ''}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Win Rate</div>
              </div>
              <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', minWidth: 80, flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{totalTrades}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total Trades</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
              <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', minWidth: 80, flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: totalProfit >= 0 ? '#2ecc71' : '#e74c3c' }}>
                  ${totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Net Profit</div>
              </div>
              <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', minWidth: 80, flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: roi > 0 ? '#2ecc71' : roi < 0 ? '#e74c3c' : 'var(--text)' }}>
                  {roi !== '—' ? `${roi}%` : '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ROI</div>
              </div>
              <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', minWidth: 80, flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#3498db' }}>
                  ${startBalance.toFixed(2)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Start Balance</div>
              </div>
              <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', minWidth: 80, flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{maxDrawdown}%</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Max DD</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
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
        .strategy-select {
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text);
          font-size: 13px;
        }
        .strategy-input-number {
          font-size: 13px;
        }
        .strategy-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        .strategy-table th, .strategy-table td {
          padding: 6px 8px;
          text-align: left;
          border-bottom: 1px solid var(--border);
        }
        .strategy-table th {
          color: var(--text-muted);
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .btn-outline {
          background: transparent;
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 4px;
          cursor: pointer;
        }
        .btn-outline:hover { border-color: var(--accent); }
        .table-wrap { border-radius: 6px; overflow: hidden; border: 1px solid var(--border); }
      `}</style>
    </div>
  )
}
