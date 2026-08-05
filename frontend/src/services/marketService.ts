export interface Watchlist {
  [category: string]: string[];
}

export interface Quote {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  volume?: number;
  change?: number;
  change_pct?: number;
  low?: number;
  high?: number;
  timestamp?: string;
  source?: string;
}

export interface Mover {
  symbol: string;
  percent_change?: number;
  volume?: number;
}

export interface MarketMovers {
  gainers: Mover[];
  losers: Mover[];
  most_active: Mover[];
}

export type TechnpriceOids = Record<string, unknown>;

const API_BASE = "";
const USE_MOCK = false;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function getWatchlist(): Promise<Watchlist> {
  if (USE_MOCK) return (await import("@/data/mockMarketData")).WATCHLIST;
  try {
    return await fetchJson<Watchlist>("/api/market/watchlist");
  } catch {
    return (await import("@/data/mockMarketData")).WATCHLIST;
  }
}

export async function getAllQuotes(): Promise<Record<string, Quote>> {
  if (USE_MOCK) {
    await delay(400);
    return (await import("@/data/mockMarketData")).MOCK_QUOTES;
  }
  try {
    const res = await fetchJson<{ prices: Record<string, Quote> }>("/api/market/prices");
    return res.prices || {};
  } catch {
    return (await import("@/data/mockMarketData")).MOCK_QUOTES;
  }
}

export async function getTechnicals(symbol: string): Promise<unknown> {
  if (USE_MOCK) {
    await delay(350);
    const m = (await import("@/data/mockMarketData")).MOCK_TECHNICALS as Record<string, unknown>;
    return m[symbol] ?? null;
  }
  return fetchJson<unknown>(`/api/market/technicals/${encodeURIComponent(symbol)}`);
}

export async function getMarketMovers(): Promise<MarketMovers> {
  if (USE_MOCK) {
    await delay(300);
    return (await import("@/data/mockMarketData")).MOCK_MOVERS;
  }
  try {
    const res = await fetchJson<{ prices: Record<string, Quote> }>("/api/market/scan");
    const prices = Object.values(res.prices || {}).filter(Boolean);
    const sorted = [...prices].sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0));
    return {
      gainers: sorted.slice(0, 5).map((q) => ({ symbol: q.symbol, percent_change: q.change_pct })),
      losers: sorted.slice(-5).reverse().map((q) => ({ symbol: q.symbol, percent_change: q.change_pct })),
      most_active: [...prices]
        .sort((a, b) => (b.volume || 0) - (a.volume || 0))
        .slice(0, 5)
        .map((q) => ({ symbol: q.symbol, volume: q.volume || 0 })),
    };
  } catch {
    return (await import("@/data/mockMarketData")).MOCK_MOVERS;
  }
}

export async function getFundamentals(symbol: string): Promise<unknown | null> {
  if (USE_MOCK) {
    await delay(300);
    const m = (await import("@/data/mockMarketData")).MOCK_FUNDAMENTALS as Record<string, unknown>;
    return m[symbol] ?? null;
  }
  try {
    return await fetchJson<unknown>(`/api/market/fundamentals/${encodeURIComponent(symbol)}`);
  } catch {
    return null;
  }
}

export async function getLiveTicks(): Promise<{ ticks: Record<string, Quote> }> {
  try {
    return await fetchJson<{ ticks: Record<string, Quote> }>("/api/market/ticks/live");
  } catch {
    return { ticks: {} };
  }
}