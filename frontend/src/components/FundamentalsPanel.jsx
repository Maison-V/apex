function formatMarketCap(value) {
  if (value == null) return '—'
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return `$${value.toLocaleString()}`
}

export default function FundamentalsPanel({ symbol, fundamentals, loading }) {
  const isEquity = fundamentals !== undefined

  return (
    <div className="panel">
      <p className="panel-title">Fundamentals — {symbol}</p>

      {loading && <div className="empty-hint">Loading fundamentals…</div>}

      {!loading && !isEquity && (
        <div className="empty-hint">Fundamentals apply to equities. Select a stock symbol to view.</div>
      )}

      {!loading && isEquity && fundamentals === null && (
        <div className="empty-hint">No fundamentals available for this symbol.</div>
      )}

      {!loading && fundamentals && (
        <>
          <div className="stat-row">
            <span className="label">Company</span>
            <span className="value">{fundamentals.name}</span>
          </div>
          <div className="stat-row">
            <span className="label">Sector</span>
            <span className="value">{fundamentals.sector}</span>
          </div>
          <div className="stat-row">
            <span className="label">Industry</span>
            <span className="value">{fundamentals.industry}</span>
          </div>
          <div className="stat-row">
            <span className="label">Market cap</span>
            <span className="value">{formatMarketCap(fundamentals.market_cap)}</span>
          </div>
          <div className="stat-row">
            <span className="label">P/E ratio</span>
            <span className="value">{fundamentals.pe_ratio ?? '—'}</span>
          </div>
          <div className="stat-row">
            <span className="label">EPS</span>
            <span className="value">{fundamentals.eps ?? '—'}</span>
          </div>
          <div className="stat-row">
            <span className="label">Dividend yield</span>
            <span className="value">{fundamentals.dividend_yield != null ? `${fundamentals.dividend_yield}%` : '—'}</span>
          </div>
          <div className="stat-row">
            <span className="label">52-week range</span>
            <span className="value">
              {fundamentals.week_52_low} – {fundamentals.week_52_high}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
