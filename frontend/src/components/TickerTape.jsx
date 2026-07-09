export default function TickerTape({ quotes }) {
  const entries = Object.values(quotes)
  if (entries.length === 0) return null

  // duplicate the list so the CSS scroll animation loops seamlessly
  const doubled = [...entries, ...entries]

  return (
    <div className="ticker-tape">
      <div className="ticker-track">
        {doubled.map((q, i) => {
          const isUp = q.change_pct >= 0
          return (
            <span className="ticker-item" key={`${q.symbol}-${i}`}>
              <span className="sym">{q.symbol}</span>
              <span>{q.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              <span className={isUp ? 'up' : 'down'}>
                {isUp ? '▲' : '▼'} {Math.abs(q.change_pct).toFixed(2)}%
              </span>
              <span className="ticker-dot">·</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
