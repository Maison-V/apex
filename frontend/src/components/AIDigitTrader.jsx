import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { derivService } from '../services/derivService'
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
  const [authState, setAuthState] = useState(null)
  const [accountInfo, setAccountInfo] = useState(null)
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
    let mounted = true
    async function init() {
      await derivService.init()
      const symbols = await derivService.fetchActiveSymbols('brief').catch(() => [])
      if (!mounted) return
      const filtered = symbols
        .filter(s => s.market === 'synthetic_index' && !s.is_trading_suspended)
        .map(s => s.underlying_symbol)
      const syms = filtered.length > 0 ? filtered : syntheticSymbols
      derivService.connect(syms)
      if (mounted) setConnected(true)

      const savedPat = localStorage.getItem('deriv_pat')
      const savedAppId = localStorage.getItem('deriv_app_id') || ''
      const savedType = localStorage.getItem('deriv_account_type') || 'demo'
      if (savedPat) {
        setAuthState('authenticated')
        tradingService.setAppId(savedAppId)
        tradingService.setPat(savedPat)
        tradingService.connect(savedType)
      } else {
        setAuthState('unauthenticated')
      }
    }
    init()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const unsub = tradingService.subscribe((data) => {
      if (data.type === 'connected') {
        setConnected(true)
        setAccountInfo({ loginid: data.loginid, account_type: data.account_type, currency: data.currency })
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

  const handleTrade = useCallback(async (direction) => {
    const bal = tradingService.getBalance()
    const balance = bal.balance
    if (!balance || balance < 1) {
      setErrorMsg('Insufficient balance')
      return
    }
    setPendingTrade(true)
    setErrorMsg(null)
    const isHz = isOneHz(symbol)
    const stake = Math.max(Math.round(balance * 0.8 / 100 * 100) / 100, 1)
    if (stake > balance) {
      setErrorMsg(`Stake $${stake} exceeds balance $${balance}`)
      setPendingTrade(false)
      return
    }
    try {
      const result = await tradingService.placeTrade({
        contract_type: direction,
        symbol,
        amount: stake,
        duration: isHz ? 60 : 1,
        duration_unit: isHz ? 's' : 't',
      })
      if (result) {
        const profit = result.profit || 0
        const afterBal = result.balanceAfter || (balance + profit)
        setBalance(afterBal)
        const entry = {
          timestamp: new Date().toISOString(),
          symbol,
          direction,
          stake,
          entryTick: null,
          exitTick: null,
          profit,
          balanceAfter: afterBal,
          status: result.status,
        }
        setTradeLog(prev => [entry, ...prev])
        if (result.status === 'won') setWins(w => w + 1)
        else setLosses(l => l + 1)
        setTotalTrades(t => t + 1)
        setTotalProfit(p => p + profit)
      } else {
        setErrorMsg('Trade failed — no result from broker')
      }
    } catch (err) {
      setErrorMsg(`Trade error: ${err.message}`)
    }
    setPendingTrade(false)
  }, [symbol])

  const handleStartBot = useCallback(() => {
    if (!connected || !recommendation || !recommendation.action) return
    setErrorMsg(null)
    setMessage('Starting AI Auto Trade...')
    tradingEngine.resetStats()
    tradeLogRef.current = []
    setTradeLog([])
    const isHz = isOneHz(symbol)
    tradingEngine.start({
      symbol,
      riskPercent: 80,
      duration: isHz ? 60 : 1,
      durationUnit: isHz ? 's' : 't',
      lookback: isHz ? 3 : 5,
      strategyId: 'consecutive_counter',
    })
  }, [connected, symbol, recommendation])

  const handleStopBot = useCallback(() => {
    tradingEngine.stop()
    setMessage('Bot stopped')
  }, [])

  const handleLogin = useCallback(() => {
    const pat = localStorage.getItem('deriv_pat')
    const appId = localStorage.getItem('deriv_app_id') || ''
    if (pat) {
      setAuthState('authenticated')
      tradingService.setAppId(appId)
      tradingService.setPat(pat)
      tradingService.connect(localStorage.getItem('deriv_account_type') || 'demo')
    }
  }, [])

  const handleLogout = useCallback(() => {
    tradingEngine.stop()
    tradingService.disconnect()
    localStorage.removeItem('deriv_pat')
    localStorage.removeItem('deriv_account_type')
    setAuthState('unauthenticated')
    setAccountInfo(null)
    setConnected(false)
    setBalance(0)
    setBotRunning(false)
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

  const heatmapEntries = useMemo(() => {
    return Object.entries(heatmapData).sort(([a], [b]) => a.localeCompare(b))
  }, [heatmapData])

  const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : '—'

  if (authState !== 'authenticated') {
    return (
      <div className="ldp-container" style={{ padding: 24, maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
        <div className="section-block" style={{ padding: '48px 36px' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
          <h2 className="section-title" style={{ fontSize: 24 }}>AI Digit Trader</h2>
          <p className="section-sub" style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6 }}>
            AI-powered digit analysis and automated trading for Deriv synthetic indices.
            Connect your Deriv account to start.
          </p>
          <div style={{ marginTop: 24 }}>
            <button onClick={handleLogin}
              style={{
                padding: '12px 32px', borderRadius: 6, fontSize: 14, fontWeight: 600,
                background: connected ? '#2ecc71' : '#ff4444', color: 'white',
                border: 'none', cursor: 'pointer',
              }}
            >
              {connected ? 'Connect Deriv Account' : 'Connect Deriv Account'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8, marginTop: 16 }}>
            <p>1. Save your Deriv PAT in localStorage (deriv_pat)</p>
            <p>2. Click connect to link your account</p>
            <p>3. The AI will analyze digits and recommend trades</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="view-container">
      <div className="section-block" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 className="section-title" style={{ fontSize: 20 }}>AI Digit Trader</h3>
            <p className="section-sub">AI-powered digit analysis & automated trading</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: connected ? '#2ecc71' : '#e74c3c',
            }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
            {accountInfo && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
                {balance.toFixed(2)} {currency}
              </span>
            )}
            <button onClick={handleLogout}
              style={{ marginLeft: 8, padding: '4px 12px', fontSize: 11, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div style={{ padding: '8px 14px', marginBottom: 12, borderRadius: 6, background: 'rgba(231,76,60,0.15)', border: '1px solid rgba(231,76,60,0.4)', color: '#e74c3c', fontSize: 13 }}>
          {errorMsg}
          <button onClick={() => setErrorMsg(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {message && !errorMsg && (
        <div style={{ padding: '8px 14px', marginBottom: 12, borderRadius: 6, background: 'rgba(52,152,219,0.12)', border: '1px solid rgba(52,152,219,0.3)', color: '#3498db', fontSize: 13 }}>
          {message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={symbol} onChange={(e) => {
          const s = e.target.value
          setSymbol(s)
          derivService.subscribeSymbol(s)
        }}
          style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
        >
          {syntheticSymbols.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sampleSize} onChange={(e) => setSampleSize(Number(e.target.value))}
          style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
        >
          <option value={50}>Last 50 Digits</option>
          <option value={100}>Last 100 Digits</option>
          <option value={200}>Last 200 Digits</option>
          <option value={500}>Last 500 Digits</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
          Ticks: {digits.length}
        </span>
      </div>

      <div className="pa-grid pa-grid-3" style={{ marginBottom: 16 }}>
        <div className="pa-card">
          <div className="pa-head">
            <span>AI Recommendation ⚡</span>
            <span className="pa-pill pa-pill-blue" style={{ marginLeft: 8 }}>
              {recommendation ? `${recommendation.confidence}%` : '—'}
            </span>
          </div>
          <div className="pa-real" style={{ padding: 12 }}>
            {recommendation && recommendation.action ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 700, color: recommendation.action === 'CALL' ? '#2ecc71' : '#e74c3c', marginBottom: 4 }}>
                  {recommendation.signal || recommendation.action}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {recommendation.reason}
                </div>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${recommendation.confidence}%`,
                    background: recommendation.confidence >= 65 ? '#2ecc71' : recommendation.confidence >= 55 ? '#f39c12' : '#e74c3c',
                    transition: 'width 0.3s',
                  }} />
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                {recommendation ? recommendation.reason : 'Analysing recent patterns…'}
              </div>
            )}
          </div>
        </div>

        <div className="pa-card" id="pa-me-conf">
          <div className="pa-head">
            <span>Even/Odd Prediction</span>
          </div>
          <div className="pa-real" style={{ padding: 12 }}>
            {oePred ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: '#3498db' }}>EVEN: {(oePred.even * 100).toFixed(0)}%</span>
                  <span style={{ fontSize: 13, color: '#e74c3c' }}>ODD: {(oePred.odd * 100).toFixed(0)}%</span>
                </div>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0, left: `${Math.min(oePred.even, oePred.odd) * 100}%`,
                    width: `${Math.abs(oePred.even - oePred.odd) * 100}%`,
                    background: oePred.predicted === 'even' ? '#3498db' : '#e74c3c',
                    borderRadius: 3, transition: 'left 0.3s, width 0.3s',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Confidence: {oePred.confidence < 0.55 ? 'Low' : oePred.confidence < 0.65 ? 'Medium' : 'High'}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: oePred.confidence < 0.55 ? 'var(--text-muted)' : oePred.predicted === 'odd' ? '#e74c3c' : '#3498db',
                  }}>
                    {oePred.predicted === 'odd' ? 'ODD' : 'EVEN'}
                  </span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>Waiting for data...</div>
            )}
          </div>
        </div>

        <div className="pa-card">
          <div className="pa-head">
            <span>Over/Under Prediction</span>
          </div>
          <div className="pa-real" style={{ padding: 12 }}>
            {hlPred ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: '#9b59b6' }}>0-4: {(hlPred.low * 100).toFixed(0)}%</span>
                  <span style={{ fontSize: 13, color: '#2ecc71' }}>5-9: {(hlPred.high * 100).toFixed(0)}%</span>
                </div>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0, left: `${Math.min(hlPred.low, hlPred.high) * 100}%`,
                    width: `${Math.abs(hlPred.low - hlPred.high) * 100}%`,
                    background: hlPred.predicted === 'high' ? '#2ecc71' : '#9b59b6',
                    borderRadius: 3, transition: 'left 0.3s, width 0.3s',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Confidence: {hlPred.confidence < 0.55 ? 'Low' : hlPred.confidence < 0.65 ? 'Medium' : 'High'}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: hlPred.predicted === 'high' ? '#2ecc71' : '#9b59b6',
                  }}>
                    {hlPred.predicted === 'high' ? 'HIGH (5-9)' : 'LOW (0-4)'}
                  </span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>Waiting for data...</div>
            )}
          </div>
        </div>
      </div>

      <div className="pa-card" style={{ marginBottom: 16 }}>
        <div className="pa-head">
          <span>Recent Digit Trend</span>
          <span className="pa-sub">{trend?.description || 'Analyzing...'}</span>
        </div>
        <div className="pa-real" style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Last: <strong style={{ color: 'var(--text)' }}>{trend?.last ?? '—'}</strong></div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Avg: <strong style={{ color: 'var(--text)' }}>{trend?.avg ?? '—'}</strong></div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Mode: <strong style={{ color: 'var(--text)' }}>{trend?.mode ?? '—'}</strong></div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Streak: <strong style={{ color: trend?.streak?.count >= 4 ? '#f39c12' : 'var(--text)' }}>{trend?.streak?.count ? `${trend.streak.digit}×${trend.streak.count}` : 'None'}</strong></div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {recentDigits.slice(-40).map((d, i) => (
              <div key={i} style={{
                width: 20, height: 20, borderRadius: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 600,
                background: d >= 5 ? 'rgba(46,204,113,0.2)' : 'rgba(155,89,182,0.2)',
                color: d >= 5 ? '#2ecc71' : '#9b59b6',
              }}>
                {d}
              </div>
            ))}
          </div>
        </div>
      </div>

      {showHeatmap && (
        <div className="pa-card pa-heatmap-card" style={{ marginBottom: 16 }}>
          <div className="pa-head">
            <span>PATTERN HEATMAP</span>
            <span className="pa-sub">2-digit patterns (00–99) · likely next digit</span>
            <button onClick={() => setShowHeatmap(false)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
            >
              Hide
            </button>
          </div>
          <div style={{ padding: 8, maxHeight: 300, overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(20, 1fr)', gap: 2 }}>
              {PATTERNS_2D.map(pattern => {
                const entry = heatmapData[pattern]
                let bg = 'var(--surface)'
                let textColor = 'var(--text-muted)'
                if (entry && entry.count >= 1) {
                  const intensity = Math.min(entry.confidence * 2, 1)
                  if (entry.predicted >= 5) {
                    bg = `rgba(46,204,113,${0.1 + intensity * 0.4})`
                    textColor = intensity > 0.5 ? '#2ecc71' : 'var(--text-muted)'
                  } else {
                    bg = `rgba(231,76,60,${0.1 + intensity * 0.4})`
                    textColor = intensity > 0.5 ? '#e74c3c' : 'var(--text-muted)'
                  }
                }
                return (
                  <div key={pattern} style={{
                    background: bg, color: textColor,
                    fontSize: 8, textAlign: 'center', padding: '2px 0',
                    borderRadius: 2, cursor: 'default',
                  }}
                    title={entry ? `${pattern} → ${entry.predicted} (${(entry.confidence * 100).toFixed(0)}%) [seen ${entry.count}x]` : pattern}
                  >
                    {pattern}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {!showHeatmap && (
        <button onClick={() => setShowHeatmap(true)}
          style={{ marginBottom: 16, padding: '4px 12px', fontSize: 11, background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}
        >
          Show Pattern Heatmap
        </button>
      )}

      <div className="section-block" style={{ marginBottom: 16 }}>
        <div className="ldp-card-title" style={{ marginBottom: 12 }}>Digit Distribution</div>
        <div className="digit-grid">
          {Array.from({ length: 10 }, (_, i) => {
            const total = dist.reduce((a, b) => a + b, 0) || 1
            const pct = (dist[i] / total) * 100
            const expected = 10
            const deviation = pct - expected
            const isHot = deviation > 3
            const isCold = deviation < -3
            return (
              <div key={i} className={`digit-cell${isHot ? ' hot' : ''}${isCold ? ' cold' : ''}`}>
                {i}
                <span className="digit-count">{dist[i]}</span>
                <div className="digit-bar" style={{ height: `${Math.max(2, pct * 3)}px` }} />
              </div>
            )
          })}
        </div>
      </div>

      <div className="section-block" style={{ marginBottom: 16 }}>
        <h3 className="section-title">AI Auto Trade</h3>
        <p className="section-sub">Automatically trades when AI confidence exceeds threshold</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Stake:</span>
            <input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value))}
              min={0.35} step={0.5}
              style={{ width: 70, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Min Confidence:</span>
            <input type="number" value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value))}
              min={10} max={100}
              style={{ width: 60, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>%</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            {!botRunning ? (
              <button onClick={handleStartBot} disabled={!connected || !recommendation?.action}
                style={{
                  padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                  background: connected && recommendation?.action ? '#2ecc71' : '#555',
                  color: 'white', border: 'none', cursor: connected && recommendation?.action ? 'pointer' : 'not-allowed',
                  opacity: connected && recommendation?.action ? 1 : 0.5,
                }}
              >
                ▶ Start Auto Trade
              </button>
            ) : (
              <>
                <button onClick={handleStopBot}
                  style={{ padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#e67e22', color: 'white', border: 'none', cursor: 'pointer' }}
                >
                  ■ Stop
                </button>
                <button onClick={() => { tradingEngine.emergencyStop(); setMessage('Emergency stop') }}
                  style={{ padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#e74c3c', color: 'white', border: 'none', cursor: 'pointer' }}
                >
                  ⛔ Emergency
                </button>
              </>
            )}
          </div>
        </div>

        {recommendation?.action && !botRunning && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 6, background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.2)' }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Next trade ready:
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => handleTrade(recommendation.action)}
                style={{
                  padding: '8px 24px', borderRadius: 6, fontSize: 14, fontWeight: 600,
                  background: recommendation.action === 'CALL' ? '#2ecc71' : '#e74c3c',
                  color: 'white', border: 'none', cursor: 'pointer',
                }}
              >
                {recommendation.signal || recommendation.action} ({(recommendation.confidence)}%)
              </button>
              {pendingTrade && <span style={{ fontSize: 12, color: '#f39c12' }}>Trade in progress...</span>}
            </div>
          </div>
        )}
      </div>

      <div className="section-block">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 className="section-title" style={{ margin: 0 }}>Trade Log</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#2ecc71' }}>{wins}W</span>
            <span style={{ fontSize: 12, color: '#e74c3c' }}>{losses}L</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>|</span>
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: totalProfit >= 0 ? '#2ecc71' : '#e74c3c',
            }}>
              {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({winRate}% win rate)</span>
            {tradeLog.length > 0 && (
              <button onClick={handleExportCsv} style={{ padding: '2px 8px', fontSize: 10, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer' }}>
                CSV
              </button>
            )}
          </div>
        </div>
        {tradeLog.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 13 }}>No trades yet.</p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
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

      <style>{`
        .pa-grid { display: grid; gap: 12px; }
        .pa-grid-3 { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
        .pa-card {
          background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
        }
        .pa-head {
          padding: 8px 12px; font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.5px; color: var(--text-muted);
          border-bottom: 1px solid var(--border);
          display: flex; align-items: center; gap: 6px;
        }
        .pa-sub { font-weight: 400; text-transform: none; color: var(--text-muted); font-size: 10px; }
        .pa-pill {
          padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;
        }
        .pa-pill-blue { background: rgba(46,204,113,0.15); color: #2ecc71; }
        .strategy-table {
          width: 100%; border-collapse: collapse;
        }
        .strategy-table th, .strategy-table td {
          padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border);
        }
        .strategy-table th {
          color: var(--text-muted); font-weight: 600; font-size: 10px;
          text-transform: uppercase; letter-spacing: 0.5px;
        }
        .table-wrap { border-radius: 6px; overflow: hidden; border: 1px solid var(--border); }
        .digit-grid {
          display: flex; gap: 4px; justify-content: center; align-items: flex-end;
        }
        .digit-cell {
          display: flex; flex-direction: column; align-items: center;
          padding: 6px 4px; border-radius: 6px; min-width: 32px;
          background: var(--surface); border: 1px solid var(--border);
          font-size: 16px; font-weight: 700; position: relative;
        }
        .digit-cell.hot { border-color: #2ecc71; background: rgba(46,204,113,0.08); }
        .digit-cell.cold { border-color: #e74c3c; background: rgba(231,76,60,0.08); }
        .digit-count { font-size: 9px; font-weight: 400; color: var(--text-muted); }
        .digit-bar {
          width: 100%; background: var(--accent); border-radius: 2px; min-height: 2px;
        }
        .pa-heatmap-card .pa-head button:hover { color: var(--text); }
      `}</style>
    </div>
  )
}

