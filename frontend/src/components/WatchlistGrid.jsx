const CATEGORY_LABELS = {
  crypto: 'Crypto',
  forex: 'Forex',
  stocks: 'Equities',
  commodities: 'Commodities',
  synthetic: 'Synthetic',
}

export default function WatchlistGrid({ watchlist, quotes, activeCategory, onCategoryChange, selectedSymbol, onSelectSymbol }) {
  const categories = Object.keys(watchlist)
  const symbols = watchlist[activeCategory] ?? []

  return (
    <div className="section-block">
      <h3 className="section-title">Watchlist</h3>
      <p className="section-sub">Live-style quotes across crypto, forex, commodities, synthetics and equities</p>

      <div className="category-tabs">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`category-tab ${cat === activeCategory ? 'active' : ''}`}
            onClick={() => onCategoryChange(cat)}
          >
            {CATEGORY_LABELS[cat] ?? cat}
          </button>
        ))}
      </div>

      <div className="market-grid">
        {symbols.map((symbol) => {
          const q = quotes[symbol]
          if (!q) return null
          const isUp = q.change_pct >= 0
          return (
            <button
              type="button"
              key={symbol}
              className={`market-card ${symbol === selectedSymbol ? 'selected' : ''}`}
              onClick={() => onSelectSymbol(symbol)}
              aria-pressed={symbol === selectedSymbol}
            >
              <div className="market-card-top">
                <span className="symbol">{symbol}</span>
                <span className={`change-pill ${isUp ? 'up' : 'down'}`}>
                  {isUp ? '+' : ''}{q.change_pct.toFixed(2)}%
                </span>
              </div>
              <div className="price">{q.price?.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
              <div className="range">
                <span>L {q.low?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? '-'}</span>
                <span>H {q.high?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? '-'}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
