import { useCallback, useEffect, useRef, useState } from 'react'
import { derivService } from '../services/derivService'

const WINDOW_OPTIONS = [10, 25, 50, 100]
const MARKEY_WEIGHT = 0.7

function lastDigit(price) {
  const s = typeof price === 'number' ? Math.abs(price).toFixed(4) : String(price)
  const trimmed = s.replace(/[^0-9]/g, '')
  if (!trimmed) return 0
  return parseInt(trimmed.slice(-1), 10)
}

export default function LDPAnalyzer({ watchlist }) {
  const [symbol, setSymbol] = useState('R_75')
  const [windowSize, setWindowSize] = useState(25)
  const [digits, setDigits] = useState(Array(10).fill(0))
  const [transition, setTransition] = useState(Array.from({ length: 10 }, () => Array(10).fill(0)))
  const [lastDigits, setLastDigits] = useState([])
  const [prediction, setPrediction] = useState(null)
  const [accuracy, setAccuracy] = useState({ correct: 0, total: 0 })
  const [history, setHistory] = useState([])
  const [connected, setConnected] = useState(false)
  const lastDigitRef = useRef(null)
  const predictionRef = useRef(null)

  const syntheticSymbols = watchlist?.synthetic ?? ['R_75', 'R_100', 'BOOM500', 'CRASH500']

  useEffect(() => {
    let mounted = true
    async function init() {
      await derivService.init()
      derivService.connect(syntheticSymbols)
      if (mounted) setConnected(true)
    }
    init()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const unsub = derivService.subscribe((sym, price) => {
      if (sym !== symbol) return
      const digit = lastDigit(price)

      setLastDigits((prev) => {
        const next = [...prev, digit]
        return next.length > windowSize ? next.slice(-windowSize) : next
      })

      setDigits((prev) => {
        const copy = [...prev]
        copy[digit] += 1
        const total = copy.reduce((a, b) => a + b, 0)
        if (total > windowSize) {
          const oldest = lastDigitRef.current
          if (oldest != null) copy[oldest] = Math.max(0, copy[oldest] - 1)
        }
        return copy
      })

      const prevDigit = lastDigitRef.current
      if (prevDigit != null) {
        setTransition((prev) => {
          const copy = prev.map((r) => [...r])
          copy[prevDigit][digit] += 1
          return copy
        })
      }
      lastDigitRef.current = digit

      if (predictionRef.current != null) {
        const wasCorrect = predictionRef.current === digit
        setHistory((prev) => [...prev.slice(-59), { digit, correct: wasCorrect }])
        setAccuracy((prev) => ({
          correct: prev.correct + (wasCorrect ? 1 : 0),
          total: prev.total + 1,
        }))
      }
    })
    return () => unsub()
  }, [symbol, windowSize])

  useEffect(() => {
    if (lastDigits.length < 2) {
      setPrediction(null)
      return
    }
    const last = lastDigits[lastDigits.length - 1]
    const total = digits.reduce((a, b) => a + b, 0)
    if (total === 0) { setPrediction(null); return }

    const scores = Array(10).fill(0)
    for (let d = 0; d < 10; d++) {
      const freqProb = digits[d] / total
      const transFromLast = transition[last] ? transition[last][d] : 0
      const transSum = transition[last] ? transition[last].reduce((a, b) => a + b, 0) : 0
      const transProb = transSum > 0 ? transFromLast / transSum : 0
      scores[d] = (1 - MARKEY_WEIGHT) * freqProb + MARKEY_WEIGHT * transProb
    }

    const maxScore = Math.max(...scores)
    const bestDigit = scores.indexOf(maxScore)
    const scoreSum = scores.reduce((a, b) => a + b, 0)
    const confidence = scoreSum > 0 ? maxScore / scoreSum : 0
    predictionRef.current = bestDigit
    setPrediction({ digit: bestDigit, confidence, scores })
  }, [digits, transition, lastDigits])

  const currentPrediction = prediction
  const accuracyPct = accuracy.total > 0 ? ((accuracy.correct / accuracy.total) * 100).toFixed(1) : '--'

  return (
    <div className="view-container">
      <div className="section-block">
        <h3 className="section-title">Last Digit Predictor</h3>
        <p className="section-sub">
          Markov chain + frequency analysis on Deriv synthetic index ticks
        </p>

        <div className="ldp-controls">
          <select
            className="window-select"
            value={symbol}
            onChange={(e) => { setSymbol(e.target.value); setPrediction(null); predictionRef.current = null }}
          >
            {syntheticSymbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            className="window-select"
            value={windowSize}
            onChange={(e) => setWindowSize(Number(e.target.value))}
          >
            {WINDOW_OPTIONS.map((w) => <option key={w} value={w}>Window: {w} ticks</option>)}
          </select>

          <div className="live-badge" style={{ marginLeft: 'auto' }}>
            <span className="live-dot" />
            {connected ? 'LIVE' : 'CONNECTING'}
          </div>
        </div>
      </div>

      <div className="ldp-stats">
        <div className="ldp-stat">
          <div className="ldp-stat-value">{accuracyPct}%</div>
          <div className="ldp-stat-label">Prediction Accuracy</div>
        </div>
        <div className="ldp-stat">
          <div className="ldp-stat-value">{accuracy.total}</div>
          <div className="ldp-stat-label">Total Predictions</div>
        </div>
        <div className="ldp-stat">
          <div className="ldp-stat-value">{accuracy.correct}</div>
          <div className="ldp-stat-label">Correct</div>
        </div>
        <div className="ldp-stat">
          <div className="ldp-stat-value">{lastDigits.length}</div>
          <div className="ldp-stat-label">Ticks in Window</div>
        </div>
      </div>

      <div className="ldp-grid">
        <div className="ldp-card">
          <div className="ldp-card-title">Digit Frequency (last {windowSize} ticks)</div>
          <div className="digit-grid">
            {Array.from({ length: 10 }, (_, i) => {
              const total = digits.reduce((a, b) => a + b, 0) || 1
              const pct = (digits[i] / total) * 100
              const isHot = pct > 12
              const isCold = pct < 6 && digits[i] > 0
              const isPredicted = prediction && prediction.digit === i
              return (
                <div
                  key={i}
                  className={`digit-cell${isHot ? ' hot' : ''}${isCold ? ' cold' : ''}${isPredicted ? ' predicted' : ''}`}
                >
                  {i}
                  <span className="digit-count">{digits[i]}</span>
                  <div className="digit-bar" style={{ height: `${pct * 3}px` }} />
                </div>
              )
            })}
          </div>
        </div>

        <div className="ldp-card">
          <div className="ldp-card-title">Next Tick Prediction</div>
          {prediction ? (
            <>
              <div className="ldp-prediction-badge">
                <span>{prediction.digit}</span>
                <span className="ldp-prediction-label">
                  Confidence {(prediction.confidence * 100).toFixed(1)}%
                </span>
              </div>
              <div style={{ marginTop: 14, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Score distribution:
              </div>
              <div className="digit-grid" style={{ marginTop: 6 }}>
                {prediction.scores.map((s, i) => (
                  <div
                    key={i}
                    className={`digit-cell${i === prediction.digit ? ' predicted' : ''}`}
                    style={{ fontSize: '0.65rem', height: 32 }}
                    title={`Digit ${i}: ${(s * 100).toFixed(1)}%`}
                  >
                    {i}
                    <div className="digit-bar" style={{ height: `${s * 200}px` }} />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: 20 }}>
              Waiting for tick data...
            </div>
          )}
        </div>
      </div>

      <div className="ldp-card">
        <div className="ldp-card-title">Recent Predictions (last 60)</div>
        <div className="ldp-history">
          {history.length === 0 ? (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>No predictions yet</span>
          ) : (
            history.map((h, i) => (
              <div
                key={i}
                className={`ldp-history-dot ${h.correct ? 'correct' : 'wrong'}`}
                title={`Digit ${h.digit} - ${h.correct ? 'Correct' : 'Wrong'}`}
              >
                {h.digit}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
