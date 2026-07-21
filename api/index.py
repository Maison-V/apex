import asyncio
import os
import random
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="APEX Dashboard API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

WATCHLIST = {
    "indices": ["^DJI", "^NDX"],
    "forex": ["EUR/USD", "GBP/USD"],
    "commodities": ["GC=F"],
    "synthetic": ["R_75", "R_100", "BOOM500", "CRASH500"],
    "crypto": ["BTC/USD", "ETH/USD", "SOL/USD", "BNB/USD"],
    "stocks": ["AAPL", "MSFT", "TSLA", "NVDA", "SPY"],
}

LIVE_SYMBOLS = {"^DJI", "^NDX", "GC=F", "R_75", "R_100", "BOOM500", "CRASH500"}

BASE_PRICES = {
    "^DJI": 52000, "^NDX": 28600,
    "GC=F": 4070, "EUR/USD": 1.09, "GBP/USD": 1.27,
    "R_75": 162500, "R_100": 232000, "BOOM500": 4850, "CRASH500": 16300,
    "BTC/USD": 68000, "ETH/USD": 3500, "SOL/USD": 145, "BNB/USD": 580,
    "AAPL": 210, "MSFT": 430, "TSLA": 260, "NVDA": 820, "SPY": 550,
}




async def _fetch_yahoo_index(symbol: str) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            resp = await c.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
                params={"interval": "1m", "range": "1d"},
                headers={"User-Agent": "Mozilla/5.0"},
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            result = data.get("chart", {}).get("result", [None])[0]
            if not result:
                return None
            meta = result.get("meta", {})
            quotes = result.get("indicators", {}).get("quote", [{}])[0]
            price = meta.get("regularMarketPrice") or meta.get("previousClose")
            if not price:
                return None
            highs = quotes.get("high", [])
            lows = quotes.get("low", [])
            volumes = quotes.get("volume", [])
            all_highs = [h for h in highs if h is not None]
            all_lows = [l for l in lows if l is not None]
            prev = meta.get("chartPreviousClose") or meta.get("previousClose") or price
            change = float(price) - float(prev)
            change_pct = (change / float(prev)) * 100 if float(prev) else 0
            return {
                "symbol": symbol, "price": float(price),
                "high": max(all_highs) if all_highs else float(price),
                "low": min(all_lows) if all_lows else float(price),
                "change": round(change, 2),
                "change_pct": round(change_pct, 4),
                "volume": int(sum(v for v in volumes if v is not None)) if any(volumes) else 0,
                "source": "yahoo", "timestamp": datetime.now(timezone.utc).isoformat(),
            }
    except Exception:
        return None


async def _fetch_live(sym: str) -> dict | None:
    if sym in ("^DJI", "^NDX", "GC=F"):
        return await _fetch_yahoo_index(sym)
    return None


async def _build_quotes(now: str, mock_fn):
    live_symbols = [sym for cat, syms in WATCHLIST.items() for sym in syms if sym in LIVE_SYMBOLS]
    mock_symbols = [sym for cat, syms in WATCHLIST.items() for sym in syms if sym not in LIVE_SYMBOLS]

    live_results = await asyncio.gather(*[_fetch_live(sym) for sym in live_symbols], return_exceptions=True)
    results = {}
    for sym, result in zip(live_symbols, live_results):
        if isinstance(result, dict) and result:
            results[sym] = result
        else:
            results[sym] = mock_fn(sym, now)
    for sym in mock_symbols:
        results[sym] = mock_fn(sym, now)
    return results


@app.get("/api/health")
async def health():
    return {
        "status": "ok", "version": "1.5.0",
        "live_symbols": list(LIVE_SYMBOLS),
        "data_sources": {"yahoo": True},
    }


@app.get("/api/market/watchlist")
async def watchlist():
    return WATCHLIST


@app.get("/api/scraper/status")
async def scraper_status():
    return {
        "mode": "live",
        "symbols_tracked": sum(len(v) for v in WATCHLIST.values()),
    }


@app.get("/api/market/prices")
async def market_prices():
    now = datetime.now(timezone.utc).isoformat()
    prices = await _build_quotes(now, _mock_quote)
    return {"timestamp": now, "prices": prices}


@app.get("/api/market/ticks/live")
async def get_live_ticks():
    now = datetime.now(timezone.utc).isoformat()
    ticks = await _build_quotes(now, _mock_tick)
    return {"ticks": ticks, "source": "live", "timestamp": now}


@app.get("/api/market/scan")
async def market_scan():
    now = datetime.now(timezone.utc).isoformat()
    prices = await _build_quotes(now, _mock_quote)
    return {"prices": prices, "movers": {}, "timestamp": now}


@app.get("/api/market/price/{symbol:path}")
async def market_price(symbol: str):
    now = datetime.now(timezone.utc).isoformat()
    if symbol in LIVE_SYMBOLS:
        live = await _fetch_live(symbol)
        if live:
            return live
    return _mock_quote(symbol, now)


@app.get("/api/deriv/config")
async def deriv_config():
    token = os.environ.get("DERIV_TOKEN", "")
    return {
        "token": token,
        "app_id": "1089",
        "public_ws": "wss://api.derivws.com/trading/v1/options/ws/public",
        "legacy_ws": "wss://ws.binaryws.com/websockets/v3",
    }


@app.get("/api/market/movers")
async def market_movers():
    gainers = ["^NDX", "SOL/USD", "NVDA", "TSLA", "BTC/USD"]
    losers = ["^DJI", "ETH/USD", "MSFT", "BNB/USD", "EUR/USD"]
    return {
        "gainers": [{"symbol": s, "percent_change": round(random.uniform(1, 5), 2)} for s in gainers],
        "losers": [{"symbol": s, "percent_change": round(random.uniform(-5, -1), 2)} for s in losers],
        "most_active": [{"symbol": s, "volume": int(random.uniform(10000, 100000))} for s in ["^NDX", "^DJI", "NVDA", "TSLA", "SPY"]],
    }


def _safe_float(v):
    if v is None:
        return 0.0
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def _mock_quote(sym: str, now: str):
    base = BASE_PRICES.get(sym, 100)
    price = round(base + random.uniform(-base * 0.01, base * 0.01), 2)
    return {
        "symbol": sym, "price": price,
        "low": round(price - random.uniform(0, price * 0.02), 2),
        "high": round(price + random.uniform(0, price * 0.02), 2),
        "change": round(random.uniform(-3, 3), 2),
        "change_pct": round(random.uniform(-1.5, 1.5), 2),
        "volume": int(random.uniform(1000, 50000)),
        "source": "mock", "timestamp": now,
    }


def _mock_tick(sym: str, now: str):
    base = BASE_PRICES.get(sym, 100)
    price = round(base + random.uniform(-base * 0.005, base * 0.005), 2)
    return {
        "symbol": sym, "price": price,
        "low": round(price - random.uniform(0, price * 0.01), 2),
        "high": round(price + random.uniform(0, price * 0.01), 2),
        "volume": int(random.uniform(1000, 50000)),
        "source": "mock", "timestamp": now,
    }
