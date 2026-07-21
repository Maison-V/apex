from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="APEX Dashboard API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

WATCHLIST = {
    "crypto": ["BTC/USD", "ETH/USD", "SOL/USD", "BNB/USD"],
    "forex": ["EUR/USD", "GBP/USD", "XAU/USD"],
    "stocks": ["AAPL", "MSFT", "TSLA", "NVDA", "SPY"],
}

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.3.0", "message": "APEX API running"}

@app.get("/api/market/watchlist")
async def watchlist():
    return WATCHLIST

@app.get("/api/scraper/status")
async def scraper_status():
    return {
        "mode": "standalone",
        "symbols_tracked": sum(len(v) for v in WATCHLIST.values()),
        "status": "ok",
    }

@app.get("/api/market/prices")
async def market_prices():
    from datetime import datetime, timezone
    import random
    now = datetime.now(timezone.utc).isoformat()
    prices = {}
    for cat, syms in WATCHLIST.items():
        for sym in syms:
            base = {"BTC/USD": 68000, "ETH/USD": 3500, "SOL/USD": 145, "BNB/USD": 580,
                     "EUR/USD": 1.09, "GBP/USD": 1.27, "XAU/USD": 2350,
                     "AAPL": 210, "MSFT": 430, "TSLA": 260, "NVDA": 820, "SPY": 550}.get(sym, 100)
            price = round(base + random.uniform(-base*0.01, base*0.01), 2)
            low = round(price - random.uniform(0, price*0.02), 2)
            high = round(price + random.uniform(0, price*0.02), 2)
            prices[sym] = {
                "symbol": sym, "price": price, "low": low, "high": high,
                "change": round(random.uniform(-3, 3), 2),
                "change_pct": round(random.uniform(-1.5, 1.5), 2),
                "source": "api", "timestamp": now,
            }
    return {"timestamp": now, "prices": prices}

@app.get("/api/market/ticks/live")
async def get_live_ticks():
    from datetime import datetime, timezone
    import random
    now = datetime.now(timezone.utc).isoformat()
    ticks = {}
    for cat, syms in WATCHLIST.items():
        for sym in syms:
            base = {"BTC/USD": 68000, "ETH/USD": 3500, "SOL/USD": 145, "BNB/USD": 580,
                     "EUR/USD": 1.09, "GBP/USD": 1.27, "XAU/USD": 2350,
                     "AAPL": 210, "MSFT": 430, "TSLA": 260, "NVDA": 820, "SPY": 550}.get(sym, 100)
            price = round(base + random.uniform(-base*0.005, base*0.005), 2)
            ticks[sym] = {
                "symbol": sym, "price": price,
                "low": round(price - random.uniform(0, price*0.01), 2),
                "high": round(price + random.uniform(0, price*0.01), 2),
                "volume": int(random.uniform(1000, 50000)),
                "source": "api", "timestamp": now,
            }
    return {"ticks": ticks, "source": "api", "timestamp": now}

@app.get("/api/market/price/{symbol:path}")
async def market_price(symbol: str):
    import random
    base = 100
    return {"symbol": symbol, "price": round(base + random.uniform(-5, 5), 2), "source": "api"}

@app.get("/api/market/scan")
async def market_scan():
    from datetime import datetime, timezone
    import random
    now = datetime.now(timezone.utc).isoformat()
    prices = {}
    for cat, syms in WATCHLIST.items():
        for sym in syms:
            base = {"BTC/USD": 68000, "ETH/USD": 3500, "SOL/USD": 145, "BNB/USD": 580,
                     "EUR/USD": 1.09, "GBP/USD": 1.27, "XAU/USD": 2350,
                     "AAPL": 210, "MSFT": 430, "TSLA": 260, "NVDA": 820, "SPY": 550}.get(sym, 100)
            price = round(base + random.uniform(-base*0.01, base*0.01), 2)
            prices[sym] = {
                "symbol": sym, "price": price,
                "low": round(price - random.uniform(0, price*0.02), 2),
                "high": round(price + random.uniform(0, price*0.02), 2),
                "change": round(random.uniform(-3, 3), 2),
                "change_pct": round(random.uniform(-1.5, 1.5), 2),
                "volume": int(random.uniform(1000, 50000)), "source": "api", "timestamp": now,
            }
    return {"prices": prices, "movers": {}, "timestamp": now}

@app.get("/api/market/movers")
async def market_movers():
    import random
    gainers = ["SOL/USD", "NVDA", "TSLA", "BTC/USD", "SPY"]
    losers = ["ETH/USD", "MSFT", "GBP/USD", "BNB/USD", "EUR/USD"]
    return {
        "gainers": [{"symbol": s, "percent_change": round(random.uniform(1, 5), 2)} for s in gainers],
        "losers": [{"symbol": s, "percent_change": round(random.uniform(-5, -1), 2)} for s in losers],
        "most_active": [{"symbol": s, "volume": int(random.uniform(10000, 100000))} for s in ["NVDA", "TSLA", "SPY", "AAPL", "MSFT"]],
    }
