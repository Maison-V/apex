import { useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import TickerTape from '../components/TickerTape'
import WatchlistGrid from '../components/WatchlistGrid'
import TechnicalsPanel from '../components/TechnicalsPanel'
import FundamentalsPanel from '../components/FundamentalsPanel'
import MarketMovers from '../components/MarketMovers'
import LDPAnalyzer from '../components/LDPAnalyzer'
import HFTConsole from '../components/HFTConsole'
import StrategyPlayground from '../components/StrategyPlayground'
import SpikeDetector from '../components/SpikeDetector'
import ApexEscapePlan from '../components/ApexEscapePlan'
import {
  getWatchlist,
  getAllQuotes,
  getTechnicals,
  getMarketMovers,
  getFundamentals,
  getLiveTicks,
} from '../services/marketService'
import { derivService } from '../services/derivService'

export default function Dashboard() {
  const [currentView, setCurrentView] = useState('dashboard')
  const [watchlist, setWatchlist] = useState({})
  const [quotes, setQuotes] = useState({})
  const [derivQuotes, setDerivQuotes] = useState({})
  const [movers, setMovers] = useState(null)
  const [loadingCore, setLoadingCore] = useState(true)

  const [activeCategory, setActiveCategory] = useState('crypto')
  const [selectedSymbol, setSelectedSymbol] = useState(null)

  const [technicals, setTechnicals] = useState(null)
  const [loadingTechnicals, setLoadingTechnicals] = useState(false)

  const [fundamentals, setFundamentals] = useState(undefined)
  const [loadingFundamentals, setLoadingFundamentals] = useState(false)

  const [liveActive, setLiveActive] = useState(false)
  const derivSymbolsRef = useRef(new Set())

  useEffect(() => {
    let mounted = true
    async function loadCore() {
      const [wl, q, mv] = await Promise.all([getWatchlist(), getAllQuotes(), getMarketMovers()])
      if (!mounted) return
      setWatchlist(wl)
      setQuotes(q)
      setMovers(mv)
      setLoadingCore(false)
      const firstSymbol = wl[activeCategory]?.[0]
      if (firstSymbol) setSelectedSymbol(firstSymbol)

      const syntheticSymbols = wl.synthetic ?? []
      derivSymbolsRef.current = new Set(syntheticSymbols)
      if (syntheticSymbols.length > 0) {
        await derivService.init()
        derivService.connect(syntheticSymbols)
      } else {
        setDerivQuotes({})
      }
    }
    loadCore()
    return () => { mounted = false; derivService.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedSymbol) return
    let mounted = true

    setLoadingTechnicals(true)
    getTechnicals(selectedSymbol).then((data) => {
      if (mounted) { setTechnicals(data); setLoadingTechnicals(false) }
    })

    const stockSymbols = watchlist.stocks ?? []
    if (stockSymbols.includes(selectedSymbol)) {
      setLoadingFundamentals(true)
      getFundamentals(selectedSymbol).then((data) => {
        if (mounted) { setFundamentals(data); setLoadingFundamentals(false) }
      })
    } else {
      setFundamentals(undefined)
    }

    return () => { mounted = false }
  }, [selectedSymbol, watchlist])

  useEffect(() => {
    let mounted = true
    let timeoutId

    async function pollTicks() {
      if (!mounted) return
      try {
        const res = await getLiveTicks()
        if (!mounted) return
        const ticks = res.ticks || {}
        const hasTicks = Object.keys(ticks).length > 0
        setLiveActive(hasTicks)
        if (hasTicks) {
          setQuotes((prev) => {
            const updated = { ...prev }
            for (const [sym, t] of Object.entries(ticks)) {
              if (derivSymbolsRef.current.has(sym)) continue
              const price = t.price ?? t.last ?? t.bid
              if (!price) continue
              const prevQuote = prev[sym]
              const change = prevQuote?.price != null ? price - prevQuote.price : 0
              const changePct = prevQuote?.price ? (change / prevQuote.price) * 100 : 0
              updated[sym] = {
                ...(prevQuote || {}),
                symbol: sym,
                price,
                bid: t.bid,
                ask: t.ask,
                volume: t.volume ?? prevQuote?.volume ?? 0,
                change: t.change ?? change,
                change_pct: t.change_pct ?? changePct,
                low: t.low ?? prevQuote?.low ?? price,
                high: t.high ?? prevQuote?.high ?? price,
                timestamp: t.timestamp ?? new Date().toISOString(),
              }
            }
            return updated
          })
        }
      } catch {
        if (mounted) setLiveActive(false)
      }
      if (mounted) timeoutId = setTimeout(pollTicks, 200)
    }

    pollTicks()
    return () => { mounted = false; clearTimeout(timeoutId) }
  }, [])

  useEffect(() => {
    const unsub = derivService.subscribe((symbol, price, timestamp) => {
      setDerivQuotes((prev) => {
        const wasReal = prev[symbol]?.source === 'deriv'
        const prevPrice = prev[symbol]?.price
        const change = wasReal && prevPrice != null ? price - prevPrice : 0
        const changePct = wasReal && prevPrice ? (change / prevPrice) * 100 : 0
        return {
          ...prev,
          [symbol]: {
            ...(prev[symbol] || {}),
            symbol,
            price,
            change,
            change_pct: changePct,
            low: prev[symbol]?.low != null && prev[symbol].low < price ? prev[symbol].low : price,
            high: prev[symbol]?.high != null && prev[symbol].high > price ? prev[symbol].high : price,
            volume: prev[symbol]?.volume ?? 0,
            source: 'deriv',
            timestamp,
          },
        }
      })
    })
    return () => unsub()
  }, [])

  const mergedQuotes = useMemo(() => ({ ...quotes, ...derivQuotes }), [quotes, derivQuotes])

  const handleCategoryChange = (category) => {
    setActiveCategory(category)
    const firstSymbol = watchlist[category]?.[0]
    if (firstSymbol) setSelectedSymbol(firstSymbol)
  }

  const viewTitle = currentView === 'dashboard' ? 'Market Dashboard'
    : currentView === 'escape' ? 'APEX Escape Plan'
    : currentView === 'ldp' ? 'Last Digit Predictor'
    : currentView === 'hft' ? 'HFT Console'
    : currentView === 'strategy' ? 'Strategy Playground'
    : currentView === 'spike' ? 'Spike Detector'
    : 'Dashboard'

  return (
    <div className="app-shell">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <div className="main-col">
        <TopBar liveActive={currentView === 'dashboard' && liveActive} title={viewTitle} />
        {currentView === 'dashboard' ? (
          <>
            {!loadingCore && <TickerTape quotes={mergedQuotes} />}
            <div className="dash-body">
              {loadingCore ? (
                <div className="screen-center" style={{ minHeight: '40vh' }}>
                  <div className="loader-glyph" aria-label="Loading dashboard">
                    <span /><span /><span />
                  </div>
                </div>
              ) : (
                <>
                  <WatchlistGrid
                    watchlist={watchlist}
                    quotes={mergedQuotes}
                    activeCategory={activeCategory}
                    onCategoryChange={handleCategoryChange}
                    selectedSymbol={selectedSymbol}
                    onSelectSymbol={setSelectedSymbol}
                  />

                  <div className="section-block">
                    <h3 className="section-title">Analysis</h3>
                    <p className="section-sub">Technical indicators and fundamentals for the selected symbol</p>
                    <div className="panels-grid">
                      <TechnicalsPanel symbol={selectedSymbol} technicals={technicals} loading={loadingTechnicals} />
                      <FundamentalsPanel symbol={selectedSymbol} fundamentals={fundamentals} loading={loadingFundamentals} />
                    </div>
                  </div>

                  <MarketMovers movers={movers} loading={false} />
                </>
              )}
            </div>
          </>
        ) : currentView === 'ldp' ? (
          <div className="dash-body">
            <LDPAnalyzer watchlist={watchlist} />
          </div>
        ) : currentView === 'spike' ? (
          <div className="dash-body">
            <SpikeDetector watchlist={watchlist} />
          </div>
        ) : currentView === 'escape' ? (
          <div className="dash-body">
            <ApexEscapePlan watchlist={watchlist} />
          </div>
        ) : currentView === 'strategy' ? (
          <div className="dash-body">
            <StrategyPlayground watchlist={watchlist} />
          </div>
        ) : (
          <div className="dash-body">
            <HFTConsole watchlist={watchlist} />
          </div>
        )}
      </div>
    </div>
  )
}
