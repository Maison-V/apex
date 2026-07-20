function rsiReading(rsi) {
  if (rsi >= 70) return 'Overbought'
  if (rsi <= 30) return 'Oversold'
  return 'Neutral'
}

export default function TechnicalsPanel({ symbol, technicals, loading }) {
  return (
    <div className="panel">
      <p className="panel-title">Technical analysis &mdash; {symbol}</p>

      {loading && <div className="empty-hint">Loading technicals&hellip;</div>}
      {!loading && !technicals && <div className="empty-hint">No technical data for this symbol.</div>}

      {!loading && technicals && (
        <>
          <div className="stat-row">
            <span className="label">RSI (14)</span>
            <span className="value">
              {technicals.rsi?.toFixed(1)} &middot; {rsiReading(technicals.rsi)}
            </span>
          </div>
          <div className="gauge-track">
            <div className="gauge-fill" style={{ width: `${Math.min(100, technicals.rsi)}%` }} />
          </div>

          <div className="stat-row" style={{ marginTop: 14 }}>
            <span className="label">MACD</span>
            <span className="value">{technicals.macd?.macd?.toFixed(3)}</span>
          </div>
          <div className="stat-row">
            <span className="label">Signal line</span>
            <span className="value">{technicals.macd?.macd_signal?.toFixed(3)}</span>
          </div>
          <div className="stat-row">
            <span className="label">Histogram</span>
            <span className="value">{technicals.macd?.macd_hist?.toFixed(3)}</span>
          </div>

          <div className="stat-row" style={{ marginTop: 14 }}>
            <span className="label">SMA 20</span>
            <span className="value">{technicals.sma_20?.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
          </div>
          <div className="stat-row">
            <span className="label">SMA 50</span>
            <span className="value">{technicals.sma_50?.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
          </div>

          <div className="stat-row" style={{ marginTop: 14 }}>
            <span className="label">Bollinger upper</span>
            <span className="value">{technicals.bbands?.upper_band?.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
          </div>
          <div className="stat-row">
            <span className="label">Bollinger mid</span>
            <span className="value">{technicals.bbands?.middle_band?.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
          </div>
          <div className="stat-row">
            <span className="label">Bollinger lower</span>
            <span className="value">{technicals.bbands?.lower_band?.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
          </div>
        </>
      )}
    </div>
  )
}