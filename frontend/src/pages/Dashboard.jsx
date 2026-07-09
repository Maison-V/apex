import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import TickerTape from '../components/TickerTape'
import WatchlistGrid from '../components/WatchlistGrid'
import TechnicalsPanel from '../components/TechnicalsPanel'
import FundamentalsPanel from '../components/FundamentalsPanel'
import MarketMovers from '../components/MarketMovers'
import {
  getWatchlist,
  getAllQuotes,
  getTechnicals,
  getMarketMovers,
  getFundamentals,
} from '../services/marketService'

export default function Dashboard() {
  const [watchlist, setWatchlist] = useState({})
  const [quotes, setQuotes] = useState({})
  const [movers, setMovers] = useState(null)
  const [loadingCore, setLoadingCore] = useState(true)

  const [activeCategory, setActiveCategory] = useState('crypto')
  const [selectedSymbol, setSelectedSymbol] = useState(null)

  const [technicals, setTechnicals] = useState(null)
  const [loadingTechnicals, setLoadingTechnicals] = useState(false)

  const [fundamentals, setFundamentals] = useState(undefined)
  const [loadingFundamentals, setLoadingFundamentals] = useState(false)

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
    }
    loadCore()
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedSymbol) return
    let mounted = true

    setLoadingTechnicals(true)
    getTechnicals(selectedSymbol).then((data) => {
      if (mounted) {
        setTechnicals(data)
        setLoadingTechnicals(false)
      }
    })

    const stockSymbols = watchlist.stocks ?? []
    if (stockSymbols.includes(selectedSymbol)) {
      setLoadingFundamentals(true)
      getFundamentals(selectedSymbol).then((data) => {
        if (mounted) {
          setFundamentals(data)
          setLoadingFundamentals(false)
        }
      })
    } else {
      setFundamentals(undefined)
    }

    return () => {
      mounted = false
    }
  }, [selectedSymbol, watchlist])

  const handleCategoryChange = (category) => {
    setActiveCategory(category)
    const firstSymbol = watchlist[category]?.[0]
    if (firstSymbol) setSelectedSymbol(firstSymbol)
  }

  const tickerQuotes = useMemo(() => quotes, [quotes])

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-col">
        <TopBar />
        {!loadingCore && <TickerTape quotes={tickerQuotes} />}

        <div className="dash-body">
          {loadingCore ? (
            <div className="screen-center" style={{ minHeight: '40vh' }}>
              <div className="loader-glyph" aria-label="Loading dashboard">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : (
            <>
              <WatchlistGrid
                watchlist={watchlist}
                quotes={quotes}
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
      </div>
    </div>
  )
}
