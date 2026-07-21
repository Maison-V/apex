import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { derivService } from '../services/derivService'
import {
  ensembleModel,
  predictOddEven,
  predictHighLow,
  frequencyModel,
  markovModel,
  trigramModel,
  gapModel,
  rangeModel,
  momentumModel,
} from '../services/ldpModels'

const WINDOW_OPTIONS = [10, 25, 50, 100, 200, 500]
const MODEL_OPTIONS = [
  { id: 'ensemble', label: 'Ensemble (all models weighted)' },
  { id: 'frequency', label: 'Digit Frequency' },
  { id: 'markov', label: 'Markov Chain (bigram)' },
  { id: 'trigram', label: 'Trigram Chain' },
  { id: 'gap', label: 'Gap Analysis (overdue digits)' },
  { id: 'range', label: 'Range Clustering (0-2 / 3-6 / 7-9)' },
  { id: 'momentum', label: 'Digit Momentum (trend)' },
]

const MODEL_FN = {
  ensemble: (digits) => ensembleModel(digits).probs,
  frequency: frequencyModel,
  markov: markovModel,
  trigram: trigramModel,
  gap: gapModel,
  range: rangeModel,
  momentum: momentumModel,
}

function findBestDigit(probs) {
  const maxP = Math.max(...probs)
  return probs.indexOf(maxP)
}

function confidenceFromProbs(probs) {
  const maxP = Math.max(...probs)
  const sumP = probs.reduce((a, b) => a + b, 0)
  return sumP > 0 ? maxP / sumP : 0
}

export default function LDPAnalyzer({ watchlist }) {
  const [symbol, setSymbol] = useState('R_75')
  const [windowSize, setWindowSize] = useState(50)
  const [modelId, setModelId] = useState('ensemble')
  const [confThreshold, setConfThreshold] = useState(0.15)
  const [connected, setConnected] = useState(false)
  const [prediction, setPrediction] = useState(null)
  const [oePrediction, setOePrediction] = useState(null)
  const [hlPrediction, setHlPrediction] = useState(null)
  const [accuracy, setAccuracy] = useState({ correct: 0, total: 0, pct: 0 })
  const [oeAccuracy, setOeAccuracy] = useState({ correct: 0, total: 0, pct: 0 })
  const [hlAccuracy, setHlAccuracy] = useState({ correct: 0, total: 0, pct: 0 })
  const [history, setHistory] = useState([])
  const [modelMeta, setModelMeta] = useState(null)
  const predictionRef = useRef(null)
  const oePredictionRef = useRef(null)
  const hlPredictionRef = useRef(null)

  const syntheticSymbols = watchlist?.synthetic ?? ['R_75', 'R_100', 'BOOM500', 'CRASH500']

  const digits = useMemo(() => derivService.getDigits(symbol), [symbol])
  const displayDigits = useMemo(
    () => digits.slice(-Math.min(windowSize, digits.length)),
    [digits, windowSize]
  )

  const dist = useMemo(() => {
    const d = Array(10).fill(0)
    for (const digit of displayDigits) d[digit]++
    return d
  }, [displayDigits])

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
    const unsub = derivService.subscribe((sym, price, ts) => {
      if (sym !== symbol) return
      const digit = derivService.getDigits(symbol)
      const windowed = digit.slice(-Math.min(windowSize, digit.length))

      if (windowed.length < 2) { setPrediction(null); return }

      const modelFn = MODEL_FN[modelId] || MODEL_FN.ensemble
      const probs = modelFn(windowed)
      const predicted = findBestDigit(probs)
      const conf = confidenceFromProbs(probs)

      const m = ensembleModel(windowed)
      setModelMeta(m.metadata)

      predictionRef.current = predicted
      setPrediction({ digit: predicted, confidence: conf, probs })

      const oe = predictOddEven(windowed)
      oePredictionRef.current = oe.predicted
      setOePrediction(oe)

      const hl = predictHighLow(windowed)
      hlPredictionRef.current = hl.predicted
      setHlPrediction(hl)

      if (digit.length >= 2) {
        const lastDigit = digit[digit.length - 1]
        const wasCorrect = predictionRef.current === lastDigit
        const oeCorrect =
          (oePredictionRef.current === 'odd' && lastDigit % 2 === 1) ||
          (oePredictionRef.current === 'even' && lastDigit % 2 === 0)
        const hlCorrect =
          (hlPredictionRef.current === 'high' && lastDigit >= 5) ||
          (hlPredictionRef.current === 'low' && lastDigit < 5)

        setHistory((prev) => [
          ...prev.slice(-59),
          { digit: lastDigit, correct: wasCorrect, oeCorrect, hlCorrect, conf },
        ])
        setAccuracy((prev) => ({
          correct: prev.correct + (wasCorrect ? 1 : 0),
          total: prev.total + 1,
          pct: 0,
        }))
        setOeAccuracy((prev) => ({
          correct: prev.correct + (oeCorrect ? 1 : 0),
          total: prev.total + 1,
          pct: 0,
        }))
        setHlAccuracy((prev) => ({
          correct: prev.correct + (hlCorrect ? 1 : 0),
          total: prev.total + 1,
          pct: 0,
        }))
      }
    })
    return () => unsub()
  }, [symbol, windowSize, modelId])

  useEffect(() => {
    if (accuracy.total > 0) {
      setAccuracy((prev) => ({ ...prev, pct: (prev.correct / prev.total) * 100 }))
    }
    if (oeAccuracy.total > 0) {
      setOeAccuracy((prev) => ({ ...prev, pct: (prev.correct / prev.total) * 100 }))
    }
    if (hlAccuracy.total > 0) {
      setHlAccuracy((prev) => ({ ...prev, pct: (prev.correct / prev.total) * 100 }))
    }
  }, [accuracy.total, oeAccuracy.total, hlAccuracy.total])

  const handleModelChange = (id) => {
    setModelId(id)
    setPrediction(null)
    setAccuracy({ correct: 0, total: 0, pct: 0 })
    setOeAccuracy({ correct: 0, total: 0, pct: 0 })
    setHlAccuracy({ correct: 0, total: 0, pct: 0 })
    setHistory([])
  }

  const handleClear = () => {
    derivService.clearHistory()
    setPrediction(null)
    setOePrediction(null)
    setHlPrediction(null)
    setAccuracy({ correct: 0, total: 0, pct: 0 })
    setOeAccuracy({ correct: 0, total: 0, pct: 0 })
    setHlAccuracy({ correct: 0, total: 0, pct: 0 })
    setHistory([])
    setModelMeta(null)
  }

  const totalTicks = digits.length
  const filterActive = confThreshold > 0.15
  const filteredHistory = filterActive
    ? history.filter((h) => h.conf >= confThreshold)
    : history
  const filteredCorrect = filteredHistory.filter((h) => h.correct).length
  const filteredTotal = filteredHistory.length
  const filteredPct = filteredTotal > 0 ? (filteredCorrect / filteredTotal) * 100 : 0

  const currentPrediction = prediction

  return (
    <div className="view-container">
      <div className="section-block">
        <h3 className="section-title">Last Digit Predictor</h3>
        <p className="section-sub">
          Multi-model prediction engine on Deriv synthetic index ticks &mdash; persistent across navigation
        </p>

        <div className="ldp-controls">
          <select className="window-select" value={symbol} onChange={(e) => { setSymbol(e.target.value); handleClear() }}>
            {syntheticSymbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select className="window-select" value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))}>
            {WINDOW_OPTIONS.map((w) => <option key={w} value={w}>Window: {w} ticks</option>)}
          </select>

          <select className="window-select" value={modelId} onChange={(e) => handleModelChange(e.target.value)}>
            {MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>

          <div className="window-select" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Conf &ge;</span>
            <input
              type="range" min="0.10" max="0.50" step="0.01"
              value={confThreshold}
              onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
              style={{ width: 60 }}
            />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              {(confThreshold * 100).toFixed(0)}%
            </span>
          </div>

          <button className="clear-btn" onClick={handleClear}>Clear</button>

          <div className="live-badge" style={{ marginLeft: 'auto' }}>
            <span className="live-dot" />
            {connected ? 'LIVE' : 'CONNECTING'}
          </div>
        </div>
      </div>

      <div className="ldp-stats">
        <div className="ldp-stat">
          <div className="ldp-stat-value">{totalTicks}</div>
          <div className="ldp-stat-label">Total Ticks Collected</div>
        </div>
        <div className="ldp-stat">
          <div className="ldp-stat-value">{accuracy.pct.toFixed(1)}%</div>
          <div className="ldp-stat-label">Digit Accuracy ({accuracy.correct}/{accuracy.total})</div>
        </div>
        <div className="ldp-stat">
          <div className="ldp-stat-value">{oeAccuracy.pct.toFixed(1)}%</div>
          <div className="ldp-stat-label">Odd/Even Accuracy</div>
        </div>
        <div className="ldp-stat">
          <div className="ldp-stat-value">{hlAccuracy.pct.toFixed(1)}%</div>
          <div className="ldp-stat-label">High/Low (0-4 vs 5-9)</div>
        </div>
      </div>

      {filterActive && filteredTotal > 0 && (
        <div className="ldp-stats" style={{ marginTop: -12 }}>
          <div className="ldp-stat" style={{ borderLeftColor: 'var(--up)' }}>
            <div className="ldp-stat-value">{filteredPct.toFixed(1)}%</div>
            <div className="ldp-stat-label">Filtered Accuracy (conf &ge; {(confThreshold * 100).toFixed(0)}%) &mdash; {filteredCorrect}/{filteredTotal}</div>
          </div>
        </div>
      )}

      <div className="ldp-grid">
        <div className="ldp-card">
          <div className="ldp-card-title">Digit Distribution (last {displayDigits.length} ticks)</div>
          <div className="digit-grid">
            {Array.from({ length: 10 }, (_, i) => {
              const total = dist.reduce((a, b) => a + b, 0) || 1
              const pct = (dist[i] / total) * 100
              const expected = 10
              const deviation = pct - expected
              const isHot = deviation > 3
              const isCold = deviation < -3
              const isPredicted = prediction && prediction.digit === i
              return (
                <div
                  key={i}
                  className={`digit-cell${isHot ? ' hot' : ''}${isCold ? ' cold' : ''}${isPredicted ? ' predicted' : ''}`}
                >
                  {i}
                  <span className="digit-count">{dist[i]}</span>
                  <div className="digit-bar" style={{ height: `${Math.max(2, pct * 3)}px` }} />
                </div>
              )
            })}
          </div>
        </div>

        <div className="ldp-card">
          <div className="ldp-card-title">Next Tick Predictions</div>
          {prediction ? (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <div>
                  <div className="ldp-prediction-badge">
                    <span>{prediction.digit}</span>
                    <span className="ldp-prediction-label">
                      {(prediction.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    Digit ({MODEL_OPTIONS.find((m) => m.id === modelId)?.label})
                  </div>
                </div>
                {oePrediction && (
                  <div>
                    <div className="ldp-prediction-badge" style={{ fontSize: '1.2rem' }}>
                      <span>{oePrediction.predicted.toUpperCase()}</span>
                      <span className="ldp-prediction-label">
                        {(oePrediction.confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4 }}>
                      Odd/Even
                    </div>
                  </div>
                )}
                {hlPrediction && (
                  <div>
                    <div className="ldp-prediction-badge" style={{ fontSize: '1.2rem' }}>
                      <span>{hlPrediction.predicted.toUpperCase()}</span>
                      <span className="ldp-prediction-label">
                        {(hlPrediction.confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4 }}>
                      High/Low
                    </div>
                  </div>
                )}
              </div>

              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Score distribution:
              </div>
              <div className="digit-grid" style={{ marginTop: 6 }}>
                {prediction.probs.map((s, i) => (
                  <div
                    key={i}
                    className={`digit-cell${i === prediction.digit ? ' predicted' : ''}`}
                    style={{ fontSize: '0.65rem', height: 32 }}
                    title={`Digit ${i}: ${(s * 100).toFixed(1)}%`}
                  >
                    {i}
                    <div className="digit-bar" style={{ height: `${Math.max(2, s * 200)}px` }} />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: 20 }}>
              Waiting for tick data... (need at least 2 ticks)
            </div>
          )}
        </div>
      </div>

      {modelMeta && modelId === 'ensemble' && (
        <div className="ldp-card" style={{ marginBottom: 20 }}>
          <div className="ldp-card-title">Ensemble Model Breakdown</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {Object.entries(modelMeta).map(([name, data]) => (
              <div key={name} style={{ marginBottom: 4 }}>
                <span style={{ color: 'var(--text-primary)' }}>{name.padEnd(12)}</span>
                {' → '}predicts <strong style={{ color: 'var(--accent)' }}>{data.top ?? data.predicted}</strong>
                {' '} (confidence {(data.prob ?? data.confidence * 100).toFixed(1)}%)
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ldp-card">
        <div className="ldp-card-title">
          Recent Predictions (last 60)
          {filterActive && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>filtered min conf {(confThreshold * 100).toFixed(0)}%</span>}
        </div>
        <div className="ldp-history">
          {history.length === 0 ? (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>No predictions yet</span>
          ) : (
            history.map((h, i) => (
              <div
                key={i}
                className={`ldp-history-dot ${h.correct ? 'correct' : 'wrong'} ${h.conf >= confThreshold ? '' : 'dimmed'}`}
                title={`Digit ${h.digit} - ${h.correct ? 'Correct' : 'Wrong'} (conf ${(h.conf * 100).toFixed(0)}%)`}
              >
                {h.correct ? '✓' : '✗'}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
