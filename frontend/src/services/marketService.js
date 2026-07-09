import { WATCHLIST } from '../data/mockMarketData'

const API_BASE = ''
const USE_MOCK = false

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

export async function getWatchlist() {
  return WATCHLIST
}

export async function getAllQuotes() {
  if (USE_MOCK) { await delay(400); return (await import('../data/mockMarketData')).MOCK_QUOTES }
  const res = await fetchJson('/api/market/prices')
  return res.prices || {}
}

export async function getTechnicals(symbol) {
  if (USE_MOCK) { await delay(350); const m = (await import('../data/mockMarketData')).MOCK_TECHNICALS; return m[symbol] ?? null }
  return fetchJson(`/api/market/technicals/${encodeURIComponent(symbol)}`)
}

export async function getMarketMovers() {
  if (USE_MOCK) { await delay(300); return (await import('../data/mockMarketData')).MOCK_MOVERS }
  const res = await fetchJson('/api/market/scan')
  const prices = Object.values(res.prices || {}).filter(Boolean)
  const sorted = [...prices].sort((a, b) => b.change_pct - a.change_pct)
  return {
    gainers: sorted.slice(0, 5).map((q) => ({ symbol: q.symbol, percent_change: q.change_pct })),
    losers: sorted.slice(-5).reverse().map((q) => ({ symbol: q.symbol, percent_change: q.change_pct })),
    most_active: [...prices].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 5).map((q) => ({ symbol: q.symbol, volume: q.volume || 0 })),
  }
}

export async function getFundamentals(symbol) {
  if (USE_MOCK) { await delay(300); const m = (await import('../data/mockMarketData')).MOCK_FUNDAMENTALS; return m[symbol] ?? null }
  try { return await fetchJson(`/api/market/fundamentals/${encodeURIComponent(symbol)}`) }
  catch { return null }
}