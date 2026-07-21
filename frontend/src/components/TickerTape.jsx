export default function TickerTape({ quotes }) {
  const entries = Object.values(quotes)
  if (entries.length === 0) return null

  const doubled = [...entries, ...entries]

  return (
    <div className="ticker-tape">
      <div className="ticker-track">
        {doubled.map((q, i) => {
          const isUp = q.change_pct >= 0
          if (!q?.price) return null
          return (
            <span className="ticker-item" key={`${q.symbol}-${i}`}>
              <span className="sym">{q.symbol}</span>
              <span>{q.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              <span className={isUp ? 'up' : 'down'}>
                {isUp ? '+' : ''}{q.change_pct?.toFixed(2) ?? '0.00'}%
              </span>
              <span className="ticker-dot">&middot;</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}