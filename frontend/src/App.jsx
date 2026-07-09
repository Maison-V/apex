import { useState, useEffect } from 'react'
import { api } from './api/client'
import './App.css'

const NAV = ['Dashboard', 'Markets', 'Swarms', 'Workflows', 'Alerts']

function App() {
  const [tab, setTab] = useState('Dashboard')

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">APEX</div>
        <nav>
          {NAV.map(n => (
            <button key={n} className={`nav-btn ${tab === n ? 'active' : ''}`} onClick={() => setTab(n)}>
              {n}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">APEX v1.0</div>
      </aside>
      <main className="main">
        {tab === 'Dashboard' && <Dashboard />}
        {tab === 'Markets' && <Markets />}
        {tab === 'Swarms' && <Swarms />}
        {tab === 'Workflows' && <Workflows />}
        {tab === 'Alerts' && <Alerts />}
      </main>
    </div>
  )
}

function Dashboard() {
  const [prices, setPrices] = useState({})
  const [movers, setMovers] = useState({})
  const [alerts, setAlerts] = useState([])
  const [time, setTime] = useState(new Date().toLocaleTimeString())

  useEffect(() => {
    const fetch = async () => {
      try {
        const [p, m, a] = await Promise.all([api.getPrices(), api.getMovers(), api.getAlerts()])
        setPrices(p.prices || {})
        setMovers(m)
        setAlerts(Array.isArray(a) ? a : [])
      } catch (e) { console.error(e) }
    }
    fetch()
    const iv = setInterval(() => { fetch(); setTime(new Date().toLocaleTimeString()) }, 30000)
    return () => clearInterval(iv)
  }, [])

  const entries = Object.entries(prices)
  const activeAlerts = alerts.filter(a => !a.triggered).length

  return (
    <div className="pane">
      <div className="pane-header"><h2>Dashboard</h2><span className="time">{time}</span></div>
      <div className="stats-row">
        <div className="stat-card"><span className="stat-num">{entries.length}</span><span>Assets Tracked</span></div>
        <div className="stat-card"><span className="stat-num">{activeAlerts}</span><span>Active Alerts</span></div>
        <div className="stat-card"><span className="stat-num">{movers?.top_gainers?.length || 0}</span><span>Top Gainers</span></div>
        <div className="stat-card"><span className="stat-num">{movers?.top_losers?.length || 0}</span><span>Top Losers</span></div>
      </div>
      <div className="price-grid">
        {entries.slice(0, 12).map(([sym, q]) => (
          <div key={sym} className={`price-card ${(q.change_pct || 0) >= 0 ? 'up' : 'down'}`}>
            <div className="pc-symbol">{sym}</div>
            <div className="pc-price">${q.price?.toFixed(2)}</div>
            <div className="pc-change">{(q.change_pct || 0) >= 0 ? '+' : ''}{q.change_pct?.toFixed(2)}%</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Markets() {
  const [prices, setPrices] = useState({})
  const [technicals, setTechnicals] = useState({})
  const [symbol, setSymbol] = useState('BTC/USD')
  const [interval, setInterval] = useState('1h')
  const [series, setSeries] = useState([])
  const [fundamentals, setFundamentals] = useState(null)

  useEffect(() => {
    api.getPrices().then(r => setPrices(r.prices || {})).catch(console.error)
  }, [])

  useEffect(() => {
    Promise.all([
      api.getTechnicals(symbol, interval),
      api.getTimeSeries(symbol, interval, 30),
    ]).then(([t, s]) => { setTechnicals(t); setSeries(s) }).catch(console.error)
  }, [symbol, interval])

  const loadFundamentals = async () => {
    try { setFundamentals(await api.getFundamentals(symbol)) } catch { setFundamentals(null) }
  }

  const lastN = series.slice(-10).reverse()

  return (
    <div className="pane">
      <div className="pane-header"><h2>Markets</h2></div>
      <div className="market-controls">
        <input value={symbol} onChange={e => setSymbol(e.target.value)} className="input" placeholder="Symbol..." />
        <select value={interval} onChange={e => setInterval(e.target.value)} className="input select">
          <option value="1min">1m</option><option value="5min">5m</option><option value="15min">15m</option>
          <option value="1h">1h</option><option value="4h">4h</option><option value="1day">1D</option>
        </select>
        <button className="btn" onClick={loadFundamentals}>Fundamentals</button>
      </div>
      <div className="split">
        <div className="split-left">
          <h3>Price History</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Vol</th></tr></thead>
              <tbody>
                {lastN.map((r, i) => (
                  <tr key={i}>
                    <td>{r.datetime?.slice(5, 16) || r.datetime}</td>
                    <td>{parseFloat(r.open).toFixed(2)}</td>
                    <td>{parseFloat(r.high).toFixed(2)}</td>
                    <td>{parseFloat(r.low).toFixed(2)}</td>
                    <td>{parseFloat(r.close).toFixed(2)}</td>
                    <td>{parseFloat(r.volume || 0).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="split-right">
          <h3>Technicals ({interval})</h3>
          <div className="tech-grid">
            {technicals.rsi != null && <div className="tech-card"><label>RSI</label><span className={technicals.rsi > 70 ? 'red' : technicals.rsi < 30 ? 'green' : ''}>{technicals.rsi.toFixed(1)}</span></div>}
            {technicals.macd?.macd && <div className="tech-card"><label>MACD</label><span>{parseFloat(technicals.macd.macd).toFixed(4)}</span></div>}
            {technicals.macd?.macd_signal && <div className="tech-card"><label>Signal</label><span>{parseFloat(technicals.macd.macd_signal).toFixed(4)}</span></div>}
            {technicals.macd?.macd_histogram && <div className="tech-card"><label>Hist</label><span className={parseFloat(technicals.macd.macd_histogram) >= 0 ? 'green' : 'red'}>{parseFloat(technicals.macd.macd_histogram).toFixed(4)}</span></div>}
            {technicals.sma_20 && <div className="tech-card"><label>SMA 20</label><span>{technicals.sma_20.toFixed(2)}</span></div>}
            {technicals.sma_50 && <div className="tech-card"><label>SMA 50</label><span>{technicals.sma_50.toFixed(2)}</span></div>}
          </div>
          {fundamentals && (
            <div className="fundamentals">
              <h3>Fundamentals</h3>
              <pre>{JSON.stringify(fundamentals, null, 2).slice(0, 1000)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Swarms() {
  const [swarms, setSwarms] = useState({})
  const [name, setName] = useState('')
  const [topology, setTopology] = useState('hierarchical')
  const [agents, setAgents] = useState(4)
  const [goal, setGoal] = useState('')

  const load = () => api.getSwarms().then(setSwarms).catch(console.error)
  useEffect(() => { load() }, [])

  const create = async () => {
    if (!name) return
    await api.createSwarm({ name, topology, max_agents: agents, goal: goal || undefined })
    setName(''); setGoal(''); load()
  }

  const entries = Object.entries(swarms)

  return (
    <div className="pane">
      <div className="pane-header"><h2>Swarms</h2></div>
      <div className="create-row">
        <input className="input" placeholder="Name..." value={name} onChange={e => setName(e.target.value)} />
        <select className="input select" value={topology} onChange={e => setTopology(e.target.value)}>
          <option value="hierarchical">Hierarchical</option>
          <option value="mesh">Mesh</option>
          <option value="hierarchical-mesh">Hierarchical Mesh</option>
          <option value="adaptive">Adaptive</option>
        </select>
        <input type="number" className="input" style={{width:80}} min={1} max={20} value={agents} onChange={e => setAgents(Number(e.target.value))} />
        <input className="input" placeholder="Goal (optional)..." value={goal} onChange={e => setGoal(e.target.value)} />
        <button className="btn" onClick={create}>Deploy</button>
      </div>
      <div className="swarm-grid">
        {entries.length === 0 && <p className="muted">No swarms deployed</p>}
        {entries.map(([id, s]) => (
          <div key={id} className="swarm-card">
            <div className="swarm-header"><strong>{s.name}</strong><span className={`badge ${s.status}`}>{s.status}</span></div>
            <div className="swarm-body">
              <div className="swarm-stat"><label>Topology</label><span>{s.topology}</span></div>
              <div className="swarm-stat"><label>Agents</label><span>{s.max_agents}</span></div>
              <div className="swarm-stat"><label>Tasks</label><span>{s.tasks_completed} / {s.tasks_completed + s.tasks_pending}</span></div>
              {s.goal && <div className="swarm-stat"><label>Goal</label><span className="goal">{s.goal}</span></div>}
            </div>
            <button className="btn small danger" onClick={() => api.deleteSwarm(id).then(load)}>Shutdown</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Workflows() {
  const [workflows, setWorkflows] = useState({})
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [steps, setSteps] = useState('')

  const load = () => api.getWorkflows().then(setWorkflows).catch(console.error)
  useEffect(() => { load() }, [])

  const create = async () => {
    if (!name) return
    let parsed = []
    try { parsed = steps ? JSON.parse(steps) : [{id:'step-1',name:'Default',type:'task'}] } catch { return }
    await api.createWorkflow({ name, description: desc || undefined, steps: parsed })
    setName(''); setDesc(''); setSteps(''); load()
  }

  const entries = Object.entries(workflows)

  return (
    <div className="pane">
      <div className="pane-header"><h2>Workflows</h2></div>
      <div className="create-row vert">
        <input className="input" placeholder="Workflow name..." value={name} onChange={e => setName(e.target.value)} />
        <input className="input" placeholder="Description..." value={desc} onChange={e => setDesc(e.target.value)} />
        <textarea className="input ta" placeholder='Steps JSON: [{"id":"s1","name":"Research","type":"task"},...]' value={steps} onChange={e => setSteps(e.target.value)} rows={3} />
        <button className="btn" onClick={create}>Create</button>
      </div>
      <div className="swarm-grid">
        {entries.length === 0 && <p className="muted">No workflows</p>}
        {entries.map(([id, w]) => (
          <div key={id} className="swarm-card">
            <div className="swarm-header"><strong>{w.name}</strong><span className={`badge ${w.status}`}>{w.status}</span></div>
            <div className="swarm-body">
              {w.description && <p className="desc">{w.description}</p>}
              <div className="steps-pipeline">
                {(w.steps || []).map((s, i) => (
                  <div key={s.id} className={`step ${s.status}`}>
                    <span className="step-num">{i + 1}</span>
                    <span className="step-name">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card-actions">
              {w.status === 'created' && <button className="btn small" onClick={() => api.runWorkflow(id).then(load)}>Run</button>}
              {w.status === 'running' && <button className="btn small warning" onClick={() => api.pauseWorkflow(id).then(load)}>Pause</button>}
              <button className="btn small danger" onClick={() => api.deleteWorkflow(id).then(load)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Alerts() {
  const [alerts, setAlerts] = useState([])
  const [symbol, setSymbol] = useState('')
  const [condition, setCondition] = useState('price_above')
  const [threshold, setThreshold] = useState(0)

  const load = () => api.getAlerts().then(setAlerts).catch(console.error)
  useEffect(() => { load() }, [])

  const create = async () => {
    if (!symbol || !threshold) return
    await api.createAlert({ symbol, condition, threshold })
    setSymbol(''); setThreshold(0); load()
  }

  return (
    <div className="pane">
      <div className="pane-header"><h2>Alerts</h2></div>
      <div className="create-row">
        <input className="input" placeholder="Symbol..." value={symbol} onChange={e => setSymbol(e.target.value)} />
        <select className="input select" value={condition} onChange={e => setCondition(e.target.value)}>
          <option value="price_above">Price Above</option>
          <option value="price_below">Price Below</option>
          <option value="rsi_oversold">RSI Oversold (&lt;30)</option>
          <option value="rsi_overbought">RSI Overbought (&gt;70)</option>
        </select>
        <input type="number" className="input" style={{width:120}} step="any" placeholder="Threshold..." value={threshold} onChange={e => setThreshold(Number(e.target.value))} />
        <button className="btn" onClick={create}>Add Alert</button>
      </div>
      <div className="alert-list">
        {alerts.length === 0 && <p className="muted">No alerts configured</p>}
        {alerts.map(a => (
          <div key={a.id} className={`alert-row ${a.triggered ? 'triggered' : ''}`}>
            <span className="alert-symbol">{a.symbol}</span>
            <span className="alert-cond">{a.condition.replace('_', ' ')}</span>
            <span className="alert-thresh">{a.threshold}</span>
            <span className={`badge ${a.triggered ? 'triggered' : 'active'}`}>{a.triggered ? 'Triggered' : 'Active'}</span>
            <button className="btn small danger" onClick={() => api.deleteAlert(a.id).then(load)}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
