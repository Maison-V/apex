import { useCallback, useEffect, useRef, useState } from 'react'
import { derivService } from '../services/derivService'

export default function HFTConsole({ watchlist }) {
  const [symbol, setSymbol] = useState('R_75')
  const [ticks, setTicks] = useState([])
  const [latency, setLatency] = useState([])
  const [stats, setStats] = useState({ tps: 0, avgLatency: 0, maxLatency: 0, totalTicks: 0 })
  const [availableSymbols, setAvailableSymbols] = useState(null)
  const lastTs = useRef(null)
  const tickCount = useRef(0)
  const secondStart = useRef(Date.now())

  const syntheticSymbols = availableSymbols ?? watchlist?.synthetic ?? ['R_75', 'R_100', 'BOOM500', 'CRASH500']

  useEffect(() => {
    let mounted = true
    async function init() {
      await derivService.init()
      const symbols = await derivService.fetchActiveSymbols('brief').catch(() => [])
      if (!mounted) return
      const filtered = symbols
        .filter(s => s.market === 'synthetic_index' && !s.is_trading_suspended)
        .map(s => s.underlying_symbol)
      setAvailableSymbols(filtered.length > 0 ? filtered : null)
      derivService.connect(filtered.length > 0 ? filtered : syntheticSymbols)
    }
    init()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const unsub = derivService.subscribe((sym, price, timestamp) => {
      if (sym !== symbol) return
      const now = Date.now()
      const ts = timestamp ? new Date(timestamp).getTime() : now
      const tickLatency = lastTs.current != null ? now - lastTs.current : 0
      lastTs.current = now

      tickCount.current += 1
      const elapsed = (now - secondStart.current) / 1000
      const currentTps = elapsed > 0 ? Math.round(tickCount.current / elapsed) : 0

      setLatency((prev) => [...prev.slice(-99), tickLatency])
      setTicks((prev) => {
        const next = [...prev, { price, latency: tickLatency, ts: timestamp || new Date().toISOString() }]
        return next.length > 100 ? next.slice(-100) : next
      })
      setStats({
        tps: currentTps,
        avgLatency: Math.round(tickLatency),
        maxLatency: Math.max(...latency.slice(-99), tickLatency),
        totalTicks: tickCount.current,
      })

      if (elapsed > 2) {
        tickCount.current = 0
        secondStart.current = now
      }
    })
    return () => unsub()
  }, [symbol])

  return (
    <div className="view-container">
      <div className="section-block">
        <h3 className="section-title">HFT Console</h3>
        <p className="section-sub">Real-time tick monitoring &amp; latency analysis for synthetic indices</p>

        <div className="ldp-controls">
          <select
            className="window-select"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          >
            {syntheticSymbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="live-badge" style={{ marginLeft: 'auto' }}>
            <span className="live-dot" />LIVE
          </div>
        </div>
      </div>

      <div className="hft-metrics">
        <div className="hft-metric">
          <div className="hft-metric-value">{stats.tps}<span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}> t/s</span></div>
          <div className="hft-metric-label">Ticks per second</div>
        </div>
        <div className="hft-metric">
          <div className="hft-metric-value">{stats.avgLatency}<span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}> ms</span></div>
          <div className="hft-metric-label">Avg latency</div>
        </div>
        <div className="hft-metric">
          <div className="hft-metric-value">{stats.maxLatency}<span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}> ms</span></div>
          <div className="hft-metric-label">Max latency</div>
        </div>
        <div className="hft-metric">
          <div className="hft-metric-value">{stats.totalTicks.toLocaleString()}</div>
          <div className="hft-metric-label">Total ticks (session)</div>
        </div>
      </div>

      <div className="ldp-card" style={{ marginBottom: 20 }}>
        <div className="ldp-card-title">Tick Feed (last 100)</div>
        <div className="hft-scroll">
          <table className="hft-tick-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Price</th>
                <th>Latency</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {ticks.length === 0 ? (
                <tr><td colSpan={4} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>Waiting for ticks...</td></tr>
              ) : (
                ticks.slice().reverse().map((t, i) => (
                  <tr key={ticks.length - i}>
                    <td>{ticks.length - i}</td>
                    <td>{typeof t.price === 'number' ? t.price.toFixed(4) : t.price}</td>
                    <td style={{ color: t.latency > 500 ? 'var(--down)' : t.latency > 200 ? '#ffa726' : 'var(--text-secondary)' }}>
                      {t.latency}ms
                    </td>
                    <td>{new Date(t.ts).toLocaleTimeString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-block">
        <h3 className="section-title">HFT Deployment Ideas</h3>
        <p className="section-sub">Strategies and tools you can build on this data feed</p>
        <div className="idea-grid">
          {IDEAS.map((idea, i) => (
            <div className="idea-card" key={i}>
              <h4>{idea.title}</h4>
              <p>{idea.description}</p>
              <div>
                {idea.tags.map((tag) => <span key={tag} className="idea-tag">{tag}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const IDEAS = [
  {
    title: 'Tick-to-Trade Engine',
    description: 'Route live ticks directly to Deriv API for sub-100ms execution. Monitor round-trip latency and optimize WebSocket buffer sizes for minimum delay.',
    tags: ['execution', 'latency'],
  },
  {
    title: 'Momentum Scalper',
    description: 'Detect micro-momentum shifts in tick sequences. Buy on 3 consecutive up-ticks with increasing volume, sell on 3 down-ticks. Exit after fixed tick count.',
    tags: ['scalping', 'momentum'],
  },
  {
    title: 'Statistical Arbitrage Bot',
    description: 'Monitor pairs like R_75/R_100 for mean reversion. When z-score exceeds threshold, place opposing bets expecting convergence within N ticks.',
    tags: ['stat-arb', 'pairs'],
  },
  {
    title: 'Boom/Crash Spike Catcher',
    description: 'Track cumulative tick movement on Boom/Crash indices. When price deviates X% from rolling mean, anticipate the corrective spike/plunge and trade accordingly.',
    tags: ['boom-crash', 'mean-reversion'],
  },
  {
    title: 'Tick Imbalance Detector',
    description: 'Track bid/ask imbalance from tick data. When 80%+ of recent ticks are on the same side, trade in that direction with tight stop-loss.',
    tags: ['order-flow', 'imbalance'],
  },
  {
    title: 'Volatility Regime Switch',
    description: 'Calculate rolling tick volatility (standard deviation of price changes). Switch between scalping (low vol) and trend-following (high vol) strategies adaptively.',
    tags: ['volatility', 'adaptive'],
  },
]
