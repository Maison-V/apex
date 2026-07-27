import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { derivService } from '../services/derivService'
import { oauthService } from '../services/oauthService'
import { tradingService } from '../services/tradingService'
import { tradingEngine } from '../services/tradingEngine'
import {
  computeAiRecommendation,
  analyzeRecentTrend,
  buildPatternHeatmap,
} from '../services/aiDigitService'

const PATTERNS_2D = Array.from({ length: 100 }, (_, i) =>
  String(i).padStart(2, '0')
)

import {
  ensembleModel,
  predictOddEven,
  predictHighLow,
  digitDistribution,
} from '../services/ldpModels'

const SYNTHETIC_SYMBOLS = [
  'R_75', 'R_100', 'R_25', 'R_50', 'R_10',
  '1HZ75V', '1HZ100V', '1HZ10V', '1HZ25V', '1HZ50V',
  'BOOM500', 'BOOM1000', 'BOOM300N', 'BOOM600', 'BOOM900',
  'CRASH500', 'CRASH1000', 'CRASH300N', 'CRASH600', 'CRASH900',
]

function isOneHz(sym) {
  return sym.startsWith('1HZ')
}

export default function AIDigitTrader({ watchlist }) {
  const [symbol, setSymbol] = useState('R_75')
  const [connected, setConnected] = useState(false)
  const [balance, setBalance] = useState(0)
  const [currency, setCurrency] = useState('USD')
  const [recommendation, setRecommendation] = useState(null)
  const [recentDigits, setRecentDigits] = useState([])
  const [digitFreq, setDigitFreq] = useState(Array(10).fill(0))
  const [oePred, setOePred] = useState(null)
  const [hlPred, setHlPred] = useState(null)
  const [trend, setTrend] = useState(null)
  const [heatmapData, setHeatmapData] = useState({})
  const [sampleSize, setSampleSize] = useState(200)
  const [botRunning, setBotRunning] = useState(false)
  const [botStatus, setBotStatus] = useState('idle')
  const [pendingTrade, setPendingTrade] = useState(false)
  const [totalTrades, setTotalTrades] = useState(0)
  const [wins, setWins] = useState(0)
  const [losses, setLosses] = useState(0)
  const [totalProfit, setTotalProfit] = useState(0)
  const [stake, setStake] = useState(1)
  const [minConfidence, setMinConfidence] = useState(60)
  const [tradeLog, setTradeLog] = useState([])
  const [errorMsg, setErrorMsg] = useState(null)
  const [message, setMessage] = useState(null)
  const [lastDigit, setLastDigit] = useState(null)
  const [showHeatmap, setShowHeatmap] = useState(true)
  const tradeLogRef = useRef([])
  const balanceRef = useRef(0)

  const syntheticSymbols = watchlist?.synthetic ?? SYNTHETIC_SYMBOLS
  const digits = useMemo(() => derivService.getDigits(symbol), [symbol])
  const windowedDigits = useMemo(
    () => digits.slice(-Math.min(sampleSize, digits.length)),
    [digits, sampleSize]
  )
  const dist = useMemo(() => digitDistribution(windowedDigits), [windowedDigits])

  useEffect(() => {
    tradingEngine.init(derivService, tradingService)
  }, [])

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
    const unsub = tradingEngine.subscribe((data) => {
      switch (data.type) {
        case 'started':
          setBotRunning(true)
          setBotStatus('running')
          break
        case 'stopped':
          setBotRunning(false)
          setBotStatus('stopped')
          setPendingTrade(false)
          break
        case 'trade_start':
          setPendingTrade(true)
          break
        case 'trade_complete': {
          const r = data.result
          setPendingTrade(false)
          setWins(data.stats.wins)
          setLosses(data.stats.losses)
          setTotalTrades(data.stats.totalTrades)
          setTotalProfit(data.stats.totalProfit)
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

  useEffect(() => {
    const unsub = derivService.subscribe((sym, price) => {
      if (sym !== symbol) return
      const allDigits = derivService.getDigits(symbol)
      const windowed = allDigits.slice(-sampleSize)
      setRecentDigits(windowed)
      setDigitFreq(digitDistribution(windowed))

      if (windowed.length >= 2) {
        setLastDigit(windowed[windowed.length - 1])
        const rec = computeAiRecommendation(windowed)
        setRecommendation(rec)
        setOePred(rec.oe)
        setHlPred(rec.hl)
        setTrend(rec.trend)
        setHeatmapData(rec.heatmap || {})
      }
    })
    return () => unsub()
  }, [symbol, sampleSize])

  const handleSymbolChange = useCallback((sym) => {
    setSymbol(sym)
    derivService.subscribeSymbol(sym)
  }, [])

  const handleStartBot = useCallback(() => {
    if (!connected) return
    const rec = recommendation
    if (!rec?.action) {
      setErrorMsg('No recommendation yet — wait for more digit data')
      return
    }
    tradingEngine.resetStats()
    tradeLogRef.current = []
    setTradeLog([])
    tradingEngine.start({
      symbol,
      strategyId: 'ai_digit',
      riskPercent: stake > 0 ? stake : 1,
      duration: 1,
      durationUnit: 't',
      minConfidence,
    })
  }, [connected, recommendation, symbol, stake, minConfidence])

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
    a.download = `ai-digit-trader-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : '—'
  const expectedValue = trades => trades > 0 ? (totalProfit / totalTrades).toFixed(4) : '—'
  const cnt = windowedDigits.length
  const cv = cnt > 0 ? ((digitFreq.reduce((s, v) => s + (v > 0 ? 1 : 0), 0) / 10) * 100).toFixed(1) : '—'

  const isOeValid = oePred?.confidence >= minConfidence
  const isHlValid = hlPred?.confidence >= minConfidence
  const oeColor = oePred?.confidence >= 90 ? '#2ecc71' : oePred?.confidence >= 70 ? '#f39c12' : '#e74c3c'
  const hlColor = hlPred?.confidence >= 90 ? '#2ecc71' : hlPred?.confidence >= 70 ? '#f39c12' : '#e74c3c'

  if (!oauthService.isAuthenticated()) {
    return (
      <div className="ldp-container" style={{ padding: 24, maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <div className="section-block" style={{ padding: '48px 36px' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🧠</div>
          <h2 className="section-title" style={{ fontSize: 24 }}>AI Digit Trader</h2>
          <p className="section-sub" style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6 }}>
            Machine learning digit prediction and auto-trading for Deriv synthetic indices.
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
        </div>
      </div>
    )
  }

  return (
    <div className="ldp-container" style={{ padding: 24, maxWidth: 1200 }}>
      <div className="section-block" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="section-title" style={{ fontSize: 20 }}>AI Digit Trader</h2>
            <p className="section-sub">AI-powered digit prediction &amp; auto-trading</p>
          </div>
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

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
        {/* Left panel — controls & stats */}
        <div>
          {(botRunning || pendingTrade) && (
            <div className="section-block" style={{ marginBottom: 12, textAlign: 'center', padding: '12px 16px' }}>
              <span style={{ color: pendingTrade ? '#f39c12' : '#2ecc71', fontWeight: 600, fontSize: 13 }}>
                {pendingTrade ? '● Trade in progress...' : '● Bot running'}
              </span>
            </div>
          )}

          <div className="section-block" style={{ marginBottom: 16 }}>
            <h3 className="section-title" style={{ margin: '0 0 12px 0' }}>Account</h3>
            <div style={{ fontSize: 13, lineHeight: 2 }}>
              <div>Balance: <strong>${balance.toFixed(2)}</strong> {currency}</div>
              <div>Session: <span style={{ color: '#2ecc71' }}>● Connected</span></div>
            </div>
          </div>

          <div className="section-block" style={{ marginBottom: 16 }}>
            <h3 className="section-title" style={{ margin: '0 0 12px 0' }}>Stats</h3>
            <div style={{ fontSize: 13, lineHeight: 2 }}>
              <div>Trades: {totalTrades} | {winRate}% win</div>
              <div>P/L: <span style={{ color: totalProfit >= 0 ? '#2ecc71' : '#e74c3c', fontWeight: 600 }}>
                {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
              </span></div>
            </div>
          </div>

          <div className="section-block">
            <h3 className="section-title" style={{ margin: '0 0 12px 0' }}>Settings</h3>

            <div className="settings-row">
              <label className="settings-label">Symbol</label>
              <select value={symbol} onChange={(e) => handleSymbolChange(e.target.value)} disabled={botRunning} className="strategy-select">
                {syntheticSymbols.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <label className="settings-label">Sample Size</label>
              <select value={sampleSize} onChange={(e) => setSampleSize(Number(e.target.value))} className="strategy-select">
                {[50, 100, 200, 500, 1000].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <label className="settings-label">Min Confidence</label>
              <select value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value))} className="strategy-select">
                {[50, 60, 70, 80, 90].map(n => <option key={n} value={n}>{n}%</option>)}
              </select>
            </div>
            <div className="settings-row">
              <label className="settings-label">Stake ($)</label>
              <input type="number" value={stake} onChange={(e) => setStake(Math.max(1, Number(e.target.value)))}
                min={1} disabled={botRunning}
                className="strategy-input-number" style={{ width: 80 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              {!botRunning ? (
                <button onClick={handleStartBot}
                  disabled={!connected || !recommendation?.action}
                  className="btn"
                  style={{
                    flex: 1, padding: '10px 16px', fontSize: 14, fontWeight: 600,
                    background: connected && recommendation?.action ? '#2ecc71' : '#555',
                    color: 'white', border: 'none', borderRadius: 6,
                    cursor: connected && recommendation?.action ? 'pointer' : 'not-allowed',
                    opacity: connected && recommendation?.action ? 1 : 0.5,
                  }}
                >
                  ▶ Start Auto Trader
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
            {!recommendation?.action && connected && (
              <p style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>
                Waiting for enough tick data to generate a prediction...
              </p>
            )}
          </div>
        </div>

        {/* Right panel — analysis & log */}
        <div>
          <div className="section-block" style={{ marginBottom: 16 }}>
            <h3 className="section-title" style={{ margin: '0 0 12px 0' }}>Live Predictions</h3>
            {cnt === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 13 }}>
                Waiting for tick data...
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Odd/Even */}
                <div style={{ padding: 12, borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Odd/Even</div>
                  {oePred ? (
                    <>
                      <div style={{ fontSize: 24, fontWeight: 700, color: oeColor }}>
                        {oePred.prediction === 'ODD' ? 'ODD' : 'EVEN'}
                      </div>
                      <div style={{ fontSize: 12, color: oeColor, marginTop: 2 }}>
                        {oePred.confidence.toFixed(1)}% confidence
                      </div>
                      {oePred.bias && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Bias: {oePred.bias}</div>}
                    </>
                  ) : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>—</div>}
                </div>

                {/* Over/Under */}
                <div style={{ padding: 12, borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Over/Under 4.5</div>
                  {hlPred ? (
                    <>
                      <div style={{ fontSize: 24, fontWeight: 700, color: hlColor }}>
                        {hlPred.prediction === 'OVER' ? 'OVER' : 'UNDER'}
                      </div>
                      <div style={{ fontSize: 12, color: hlColor, marginTop: 2 }}>
                        {hlPred.confidence.toFixed(1)}% confidence
                      </div>
                      {hlPred.bias && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Bias: {hlPred.bias}</div>}
                    </>
                  ) : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>—</div>}
                </div>
              </div>
            )}
          </div>

          {trend && (
            <div className="section-block" style={{ marginBottom: 16 }}>
              <h3 className="section-title" style={{ margin: '0 0 8px 0' }}>Trend Analysis</h3>
              <div style={{ fontSize: 12, lineHeight: 2 }}>
                <div>Direction: <strong>{trend.direction || '—'}</strong></div>
                <div>Strength: <strong>{trend.strength || '—'}</strong></div>
                <div>Volatility: <strong>{trend.volatility || '—'}</strong></div>
              </div>
            </div>
          )}

          <div className="section-block" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 className="section-title" style={{ margin: 0 }}>Digit Frequency (last {cnt})</h3>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Coverage: {cv}%</div>
            </div>
            {cnt > 0 ? (
              <div className="digit-grid">
                {digitFreq.map((f, i) => {
                  const pct = cnt > 0 ? (f / cnt * 100) : 0
                  const barH = Math.max(pct * 4, 2)
                  return (
                    <div key={i} className="digit-bar-col">
                      <div className="digit-bar" style={{ height: barH, background: pct > 12 ? '#2ecc71' : pct > 10 ? '#f39c12' : '#e74c3c' }} />
                      <div className="digit-label">{i}</div>
                      <div className="digit-pct">{pct.toFixed(1)}%</div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 13 }}>No data yet</p>
            )}
          </div>

          <div className="section-block" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 className="section-title" style={{ margin: 0 }}>Recent Digits</h3>
              {recommendation?.action && (
                <span style={{
                  fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                  background: recommendation.action === 'CALL' ? 'rgba(46,204,113,0.2)' : 'rgba(231,76,60,0.2)',
                  color: recommendation.action === 'CALL' ? '#2ecc71' : '#e74c3c',
                }}>
                  AI: {recommendation.action === 'CALL' ? 'RISE' : 'FALL'} ({recommendation.confidence.toFixed(0)}%)
                </span>
              )}
            </div>
            <div className="recent-digits" style={{ fontSize: 24, letterSpacing: 4 }}>
              {recentDigits.length > 0 ? recentDigits.slice(-80).map((d, i) => (
                <span key={i} style={{ color: d >= 5 ? '#2ecc71' : '#e74c3c' }}>{d}</span>
              )) : <span style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Waiting for ticks...</span>}
            </div>
          </div>

          {lastDigit != null && (
            <div className="section-block" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Last Digit</h3>
              </div>
              <div style={{ fontSize: 72, fontWeight: 700, textAlign: 'center', color: lastDigit >= 5 ? '#2ecc71' : '#e74c3c' }}>
                {lastDigit}
              </div>
            </div>
          )}

          <div className="section-block">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 className="section-title" style={{ margin: 0 }}>Trade Log</h3>
              {tradeLog.length > 0 && (
                <button onClick={handleExportCsv} className="btn btn-outline" style={{ padding: '4px 10px', fontSize: 11 }}>
                  Export CSV
                </button>
              )}
            </div>
            {tradeLog.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 13 }}>
                No trades yet. Start the auto trader to begin.
              </p>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 400, overflowY: 'auto' }}>
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
                          {t.direction === 'CALL' ? 'CALL' : 'PUT'}
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
    </div>
  )
}
