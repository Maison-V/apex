export default function MarketMovers({ movers, loading }) {
  return (
    <div className="section-block">
      <h3 className="section-title">Market movers</h3>
      <p className="section-sub">Top gainers, losers and most active symbols across your watchlist</p>

      {loading && <div className="empty-hint">Loading market movers…</div>}

      {!loading && movers && (
        <div className="movers-columns">
          <div className="panel">
            <p className="panel-title">Top gainers</p>
            {movers.gainers.map((m) => (
              <div className="mover-row" key={m.symbol}>
                <span className="sym">{m.symbol}</span>
                <span style={{ color: 'var(--up)' }}>+{m.percent_change.toFixed(2)}%</span>
              </div>
            ))}
          </div>

          <div className="panel">
            <p className="panel-title">Top losers</p>
            {movers.losers.map((m) => (
              <div className="mover-row" key={m.symbol}>
                <span className="sym">{m.symbol}</span>
                <span style={{ color: 'var(--down)' }}>{m.percent_change.toFixed(2)}%</span>
              </div>
            ))}
          </div>

          <div className="panel">
            <p className="panel-title">Most active</p>
            {movers.most_active.map((m) => (
              <div className="mover-row" key={m.symbol}>
                <span className="sym">{m.symbol}</span>
                <span>{m.volume.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
