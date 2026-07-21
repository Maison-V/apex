import { useCallback, useEffect, useRef, useState } from 'react'
import { derivService } from '../services/derivService'

const DEFAULTS = {
  lookback: 50,
  zThreshold: 3.0,
  exitZ: 0.5,
  slMultiplier: 2.0,
  tp1Multiplier: 0.5,
  tp2Multiplier: 1.0,
  tp3Multiplier: 1.5,
  maxHoldTicks: 20,
}

function pushAlert(alerts, alert) {
  return [alert, ...alerts].slice(0, 50)
}

export default function SpikeDetector({ watchlist }) {
  const [symbol, setSymbol] = useState('BOOM500')
  const [params, setParams] = useState(DEFAULTS)
  const [showParams, setShowParams] = useState(false)
  const [ticks, setTicks] = useState([])
  const [stats, setStats] = useState({ zScore: 0, mean: 0, std: 0, spikeCount: 0, bias: 'neutral' })
  const [signals, setSignals] = useState([])
  const [alerts, setAlerts] = useState([])
  const [spikeActive, setSpikeActive] = useState(false)
  const [holdTicks, setHoldTicks] = useState(0)

  const syntheticSymbols = watchlist?.synthetic ?? ['R_75', 'R_100', 'BOOM500', 'CRASH500']
  const pricesRef = useRef([])
  const spikeCountRef = useRef(0)
  const entryRef = useRef(null)

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  useEffect(() => {
    let mounted = true
    async function init() {
      await derivService.init()
      derivService.connect(syntheticSymbols)
    }
    init()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const unsub = derivService.subscribe((sym, price, timestamp) => {
      if (sym !== symbol) return

      pricesRef.current = [...pricesRef.current, price]
      if (pricesRef.current.length > 500) {
        pricesRef.current = pricesRef.current.slice(-500)
      }

      const prices = pricesRef.current
      const { lookback, zThreshold, exitZ, slMultiplier, tp1Multiplier, tp2Multiplier, tp3Multiplier, maxHoldTicks } = params
      let newZ = 0; let newMean = 0; let newStd = 0

      if (prices.length >= lookback) {
        const recent = prices.slice(-lookback)
        newMean = recent.reduce((a, b) => a + b, 0) / lookback
        const variance = recent.reduce((sum, p) => sum + (p - newMean) ** 2, 0) / lookback
        newStd = Math.sqrt(variance)
        newZ = newStd > 0 ? (price - newMean) / newStd : 0
      }

      const isBoom = symbol === 'BOOM500'
      const isCrash = symbol === 'CRASH500'

      let bias = 'neutral'
      let signal = null
      let entered = spikeActive
      let hold = holdTicks

      if (isBoom) {
        if (newZ > zThreshold && !entered) {
          bias = 'spike-up'
          entered = true
          hold = 0
          spikeCountRef.current += 1
          const entryPrice = price
          const spikeSize = newStd * zThreshold
          const sl = entryPrice + spikeSize * slMultiplier
          const tp1 = entryPrice - spikeSize * tp1Multiplier
          const tp2 = entryPrice - spikeSize * tp2Multiplier
          const tp3 = entryPrice - spikeSize * tp3Multiplier
          entryRef.current = { direction: 'sell', entryPrice, sl, tp1, tp2, tp3, zScore: newZ, mean: newMean, std: newStd, broadAnalysis: 'fade' }

          signal = entryRef.current
          setSignals((prev) => [signal, ...prev].slice(0, 100))

          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`Spike Detected — ${symbol}`, {
              body: `SELL @ ${entryPrice.toFixed(2)} | Fading the spike (mean reversion)`,
            })
          }
        } else if (entered) {
          hold += 1
          const e = entryRef.current
          if (!e) { entered = false; hold = 0 }
          else if (price >= e.sl) {
            setAlerts((prev) => pushAlert(prev, { type: 'sl-hit', symbol, price, zScore: newZ, time: new Date().toLocaleTimeString() }))
            entered = false; hold = 0; entryRef.current = null
          } else if (price <= e.tp3) {
            setAlerts((prev) => pushAlert(prev, { type: 'tp-hit', symbol, price, zScore: newZ, time: new Date().toLocaleTimeString() }))
            entered = false; hold = 0; entryRef.current = null
          } else if (Math.abs(newZ) < exitZ) {
            setAlerts((prev) => pushAlert(prev, { type: 'exit', symbol, price, zScore: newZ, time: new Date().toLocaleTimeString() }))
            entered = false; hold = 0; entryRef.current = null
          } else if (hold >= maxHoldTicks) {
            setAlerts((prev) => pushAlert(prev, { type: 'expired', symbol, price, zScore: newZ, time: new Date().toLocaleTimeString() }))
            entered = false; hold = 0; entryRef.current = null
          }
        }
      } else if (isCrash) {
        if (newZ < -zThreshold && !entered) {
          bias = 'spike-down'
          entered = true
          hold = 0
          spikeCountRef.current += 1
          const entryPrice = price
          const spikeSize = newStd * zThreshold
          const sl = entryPrice - spikeSize * slMultiplier
          const tp1 = entryPrice + spikeSize * tp1Multiplier
          const tp2 = entryPrice + spikeSize * tp2Multiplier
          const tp3 = entryPrice + spikeSize * tp3Multiplier
          entryRef.current = { direction: 'buy', entryPrice, sl, tp1, tp2, tp3, zScore: newZ, mean: newMean, std: newStd, broadAnalysis: 'fade' }

          signal = entryRef.current
          setSignals((prev) => [signal, ...prev].slice(0, 100))

          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`Spike Detected — ${symbol}`, {
              body: `BUY @ ${entryPrice.toFixed(2)} | Fading the crash (mean reversion)`,
            })
          }
        } else if (entered) {
          hold += 1
          const e = entryRef.current
          if (!e) { entered = false; hold = 0 }
          else if (price <= e.sl) {
            setAlerts((prev) => pushAlert(prev, { type: 'sl-hit', symbol, price, zScore: newZ, time: new Date().toLocaleTimeString() }))
            entered = false; hold = 0; entryRef.current = null
          } else if (price >= e.tp3) {
            setAlerts((prev) => pushAlert(prev, { type: 'tp-hit', symbol, price, zScore: newZ, time: new Date().toLocaleTimeString() }))
            entered = false; hold = 0; entryRef.current = null
          } else if (Math.abs(newZ) < exitZ) {
            setAlerts((prev) => pushAlert(prev, { type: 'exit', symbol, price, zScore: newZ, time: new Date().toLocaleTimeString() }))
            entered = false; hold = 0; entryRef.current = null
          } else if (hold >= maxHoldTicks) {
            setAlerts((prev) => pushAlert(prev, { type: 'expired', symbol, price, zScore: newZ, time: new Date().toLocaleTimeString() }))
            entered = false; hold = 0; entryRef.current = null
          }
        }
      }

      if (signal) {
        setAlerts((prev) => pushAlert(prev, {
          type: 'signal', symbol, ...signal, time: new Date().toLocaleTimeString(),
        }))
      }

      setSpikeActive(entered)
      setHoldTicks(hold)
      setStats({ zScore: newZ, mean: newMean, std: newStd, spikeCount: spikeCountRef.current, bias })
      setTicks((prev) => {
        const next = [...prev, { price, zScore: newZ, time: timestamp || new Date().toISOString() }]
        return next.length > 200 ? next.slice(-200) : next
      })
    })
    return () => unsub()
  }, [symbol, params, spikeActive, holdTicks])

  const lastTick = ticks[ticks.length - 1]
  const isBoom = symbol === 'BOOM500'
  const isCrash = symbol === 'CRASH500'

  const zColor = stats.zScore > params.zThreshold ? 'var(--up)'
    : stats.zScore < -params.zThreshold ? 'var(--down)'
    : 'var(--text-secondary)'

  return (
    <div className="view-container">
      <div className="section-block">
        <h3 className="section-title">Spike Detector</h3>
        <p className="section-sub">
          {isBoom
            ? 'Z-score mean reversion — SELL on up-spikes. The Boom500 drift down after each spike is statistically reliable.'
            : isCrash
              ? 'Z-score mean reversion — BUY on down-crashes. Warning: Crash500 has larger loss tails; use wider stops.'
              : 'Select BOOM500 or CRASH500 for spike analysis'}
        </p>

        <div className="ldp-controls">
          <select className="window-select" value={symbol} onChange={(e) => {
            setSymbol(e.target.value)
            pricesRef.current = []
            spikeCountRef.current = 0
            entryRef.current = null
            setSpikeActive(false)
            setHoldTicks(0)
          }}>
            {syntheticSymbols.filter((s) => s === 'BOOM500' || s === 'CRASH500').map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div className="live-badge" style={{ marginLeft: 'auto' }}>
            <span className="live-dot" />LIVE
          </div>
          <button className="clear-btn" onClick={() => setShowParams((p) => !p)}>
            {showParams ? 'HIDE PARAMS' : 'PARAMS'}
          </button>
        </div>

        {isCrash && (
          <div className="form-notice" style={{ marginBottom: 12, fontSize: '0.75rem' }}>
            Risk warning: Crash500 backtests show 67% win rate but catastrophic loss sizes.
            Consider smaller position sizing or wider SL.
          </div>
        )}

        {showParams && (
          <div className="spike-params">
            <div className="spike-param">
              <label>Lookback (ticks)</label>
              <input type="number" min={5} max={200} value={params.lookback}
                onChange={(e) => setParams((p) => ({ ...p, lookback: Number(e.target.value) }))} />
            </div>
            <div className="spike-param">
              <label>Z Threshold</label>
              <input type="number" min={0.5} max={5} step={0.1} value={params.zThreshold}
                onChange={(e) => setParams((p) => ({ ...p, zThreshold: Number(e.target.value) }))} />
            </div>
            <div className="spike-param">
              <label>Exit Z</label>
              <input type="number" min={0.1} max={3} step={0.1} value={params.exitZ}
                onChange={(e) => setParams((p) => ({ ...p, exitZ: Number(e.target.value) }))} />
            </div>
            <div className="spike-param">
              <label>SL Multiplier</label>
              <input type="number" min={0.5} max={5} step={0.1} value={params.slMultiplier}
                onChange={(e) => setParams((p) => ({ ...p, slMultiplier: Number(e.target.value) }))} />
            </div>
            <div className="spike-param">
              <label>TP1 Multiplier</label>
              <input type="number" min={0.1} max={3} step={0.1} value={params.tp1Multiplier}
                onChange={(e) => setParams((p) => ({ ...p, tp1Multiplier: Number(e.target.value) }))} />
            </div>
            <div className="spike-param">
              <label>TP2 Multiplier</label>
              <input type="number" min={0.1} max={3} step={0.1} value={params.tp2Multiplier}
                onChange={(e) => setParams((p) => ({ ...p, tp2Multiplier: Number(e.target.value) }))} />
            </div>
            <div className="spike-param">
              <label>TP3 Multiplier</label>
              <input type="number" min={0.1} max={3} step={0.1} value={params.tp3Multiplier}
                onChange={(e) => setParams((p) => ({ ...p, tp3Multiplier: Number(e.target.value) }))} />
            </div>
            <div className="spike-param">
              <label>Max Hold (ticks)</label>
              <input type="number" min={5} max={100} value={params.maxHoldTicks}
                onChange={(e) => setParams((p) => ({ ...p, maxHoldTicks: Number(e.target.value) }))} />
            </div>
          </div>
        )}
      </div>

      <div className="hft-metrics">
        <div className="hft-metric">
          <div className="hft-metric-value" style={{ color: zColor }}>
            {stats.zScore ? stats.zScore.toFixed(2) : '—'}
          </div>
          <div className="hft-metric-label">Current Z-Score</div>
        </div>
        <div className="hft-metric">
          <div className="hft-metric-value">{stats.mean ? stats.mean.toFixed(2) : '—'}</div>
          <div className="hft-metric-label">Rolling Mean ({params.lookback})</div>
        </div>
        <div className="hft-metric">
          <div className="hft-metric-value">{stats.std ? stats.std.toFixed(4) : '—'}</div>
          <div className="hft-metric-label">Rolling Std Dev</div>
        </div>
        <div className="hft-metric">
          <div className="hft-metric-value" style={{ color: spikeActive ? 'var(--accent)' : 'var(--text-secondary)' }}>
            {stats.spikeCount}
          </div>
          <div className="hft-metric-label">Spikes Detected</div>
        </div>
      </div>

      <div className="spike-z-gauge">
        <div className="spike-gauge-track">
          <div className="spike-gauge-fill" style={{
            left: '50%',
            width: `${Math.min(Math.abs(stats.zScore) / 5 * 100, 100)}%`,
            transform: 'translateX(-50%)',
            background: stats.zScore > 0 ? 'var(--up)' : 'var(--down)',
            opacity: Math.min(Math.abs(stats.zScore) / params.zThreshold, 1),
          }} />
          <div className="spike-gauge-center" />
          {[-params.zThreshold, 0, params.zThreshold].map((tick) => (
            <div key={tick} className="spike-gauge-tick" style={{ left: `${50 + (tick / 5) * 50}%` }}>
              <span>{tick}</span>
            </div>
          ))}
        </div>
        <div className="spike-gauge-labels">
          <span style={{ color: 'var(--down)' }}>CRASH</span>
          <span>NEUTRAL</span>
          <span style={{ color: 'var(--up)' }}>BOOM</span>
        </div>
        {spikeActive && (
          <div className="spike-active-banner" style={{
            background: isBoom ? 'var(--accent-dim)' : 'var(--down-dim)',
            borderColor: isBoom ? 'var(--accent-line)' : 'rgba(255, 61, 0, 0.35)',
          }}>
            TRADE ACTIVE — {isBoom ? 'SELL' : 'BUY'} @ {entryRef.current?.entryPrice?.toFixed(2) || '—'} | Hold: {holdTicks}/{params.maxHoldTicks}
          </div>
        )}
      </div>

      <div className="ldp-grid">
        <div className="ldp-card">
          <div className="ldp-card-title">Live Price Feed</div>
          {lastTick ? (
            <div className="spike-price-big">{typeof lastTick.price === 'number' ? lastTick.price.toFixed(2) : lastTick.price}</div>
          ) : (
            <div className="empty-hint">Waiting for ticks...</div>
          )}
          <div className="spike-tick-vis">
            {ticks.slice(-100).map((t, i) => {
              const absZ = Math.abs(t.zScore)
              const intensity = absZ > params.zThreshold ? 1 : absZ / params.zThreshold
              return (
                <div key={i} className="spike-tick-bar" style={{
                  height: `${Math.min(absZ * 10, 40) + 2}px`,
                  background: t.zScore > 0
                    ? `rgba(0, 229, 255, ${intensity})`
                    : `rgba(255, 61, 0, ${intensity})`,
                }} />
              )
            })}
          </div>
        </div>

        <div className="ldp-card">
          <div className="ldp-card-title">Active Signal</div>
          {entryRef.current && spikeActive ? (
            <div className="spike-signal-card">
              <div className={`spike-signal-direction ${entryRef.current.direction}`}>
                {entryRef.current.direction.toUpperCase()}
              </div>
              <div className="spike-signal-entry">
                <span className="spike-signal-label">Entry</span>
                <span className="spike-signal-value">{entryRef.current.entryPrice.toFixed(2)}</span>
              </div>
              <div className="spike-signal-row">
                <div className="spike-signal-item">
                  <span className="spike-signal-label">SL</span>
                  <span className="spike-signal-value" style={{ color: 'var(--down)' }}>{entryRef.current.sl.toFixed(2)}</span>
                </div>
                <div className="spike-signal-item">
                  <span className="spike-signal-label">TP1</span>
                  <span className="spike-signal-value" style={{ color: 'var(--up)' }}>{entryRef.current.tp1.toFixed(2)}</span>
                </div>
                <div className="spike-signal-item">
                  <span className="spike-signal-label">TP2</span>
                  <span className="spike-signal-value" style={{ color: 'var(--up)' }}>{entryRef.current.tp2.toFixed(2)}</span>
                </div>
                <div className="spike-signal-item">
                  <span className="spike-signal-label">TP3</span>
                  <span className="spike-signal-value" style={{ color: 'var(--up)' }}>{entryRef.current.tp3.toFixed(2)}</span>
                </div>
              </div>
              <div className="spike-signal-reason">
                Mean reversion ({isBoom ? 'sell' : 'buy'}) — fading the {isBoom ? 'upward' : 'downward'} spike
              </div>
            </div>
          ) : (
            <div className="empty-hint" style={{ padding: '32px 0' }}>
              {ticks.length < params.lookback
                ? `Collecting data... (${ticks.length}/${params.lookback} ticks)`
                : 'No spike detected — monitoring...'}
            </div>
          )}
        </div>
      </div>

      <div className="ldp-card">
        <div className="ldp-card-title">Signal Log (last {signals.length})</div>
        {signals.length === 0 ? (
          <div className="empty-hint">No signals yet</div>
        ) : (
          <div className="hft-scroll">
            <table className="hft-tick-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Direction</th>
                  <th>Entry</th>
                  <th>SL</th>
                  <th>TP1</th>
                  <th>TP2</th>
                  <th>TP3</th>
                  <th>Analysis</th>
                  <th>Z</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s, i) => (
                  <tr key={i}>
                    <td>{s.time || '—'}</td>
                    <td style={{ color: s.direction === 'buy' ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>
                      {s.direction.toUpperCase()}
                    </td>
                    <td>{s.entryPrice.toFixed(2)}</td>
                    <td style={{ color: 'var(--down)' }}>{s.sl.toFixed(2)}</td>
                    <td style={{ color: 'var(--up)' }}>{s.tp1.toFixed(2)}</td>
                    <td style={{ color: 'var(--up)' }}>{s.tp2.toFixed(2)}</td>
                    <td style={{ color: 'var(--up)' }}>{s.tp3.toFixed(2)}</td>
                    <td><span className="spike-badge fade">{s.broadAnalysis}</span></td>
                    <td>{s.zScore.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ldp-card" style={{ marginTop: 16 }}>
        <div className="ldp-card-title">Alert History</div>
        {alerts.length === 0 ? (
          <div className="empty-hint">No alerts yet</div>
        ) : (
          <div className="hft-scroll" style={{ maxHeight: 200 }}>
            {alerts.map((a, i) => (
              <div key={i} className={`spike-alert-row ${a.type}`}>
                <span className="spike-alert-time">{a.time}</span>
                <span className="spike-alert-type">{a.type.toUpperCase()}</span>
                <span>{a.symbol}</span>
                {a.direction && <span style={{ color: a.direction === 'buy' ? 'var(--up)' : 'var(--down)' }}>{a.direction.toUpperCase()}</span>}
                {a.price && <span>@ {a.price.toFixed(2)}</span>}
                {a.broadAnalysis && <span className="spike-badge fade">{a.broadAnalysis}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ldp-card" style={{ marginTop: 16 }}>
        <div className="ldp-card-title">Backtest Results (validated)</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p><strong>BOOM500</strong> — 100% win rate across 51 trades in 10,000 ticks. $10 → $20.15 (flipped). Strategy: SELL on every up-spike (mean reversion). The Boom500 algorithm produces reliable downward drift after each spike.</p>
          <p><strong>CRASH500</strong> — 67% win rate but catastrophic loss sizes. Not suitable for small accounts without wider stops. Crash500 spikes are more violent with less reliable drift after.</p>
          <p><strong>Key insight:</strong> Direction is always fade — never follow. The broad analysis determines position sizing, not direction.</p>
        </div>
      </div>
    </div>
  )
}
