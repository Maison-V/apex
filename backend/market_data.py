import asyncio
import httpx
from datetime import datetime, timezone
from config import settings

TD_BASE = "https://api.twelvedata.com"

WATCHLIST = {
    "crypto": ["BTC/USD", "ETH/USD", "SOL/USD", "BNB/USD"],
    "forex": ["EUR/USD", "GBP/USD", "XAU/USD"],
    "stocks": ["AAPL", "MSFT", "TSLA", "NVDA", "SPY"],
}

async def get_price(symbol: str) -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{TD_BASE}/price", params={"symbol": symbol, "apikey": settings.twelve_data_api_key})
        if r.status_code == 200:
            data = r.json()
            if "price" in data:
                return {"symbol": symbol, "price": float(data["price"]), "source": "twelvedata", "timestamp": datetime.now(timezone.utc).isoformat()}
    return None

async def get_quote(symbol: str) -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{TD_BASE}/quote", params={"symbol": symbol, "apikey": settings.twelve_data_api_key})
        if r.status_code == 200:
            data = r.json()
            return {
                "symbol": symbol,
                "price": float(data.get("close", 0)),
                "high": float(data.get("high", 0)),
                "low": float(data.get("low", 0)),
                "volume": float(data.get("volume", 0)),
                "change": float(data.get("change", 0)),
                "change_pct": float(data.get("percent_change", 0)),
                "source": "twelvedata",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
    return None

async def get_time_series(symbol: str, interval: str = "1h", outputsize: int = 100) -> list:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{TD_BASE}/time_series", params={"symbol": symbol, "interval": interval, "outputsize": outputsize, "apikey": settings.twelve_data_api_key})
        if r.status_code == 200:
            data = r.json()
            return data.get("values", [])
    return []

async def get_rsi(symbol: str, interval: str = "1h") -> float | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{TD_BASE}/rsi", params={"symbol": symbol, "interval": interval, "apikey": settings.twelve_data_api_key})
        if r.status_code == 200:
            data = r.json()
            if "values" in data and data["values"]:
                return float(data["values"][0]["rsi"])
    return None

async def get_macd(symbol: str, interval: str = "1h") -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{TD_BASE}/macd", params={"symbol": symbol, "interval": interval, "apikey": settings.twelve_data_api_key})
        if r.status_code == 200:
            data = r.json()
            if "values" in data and data["values"]:
                return data["values"][0]
    return None

async def get_sma(symbol: str, interval: str = "1h", period: int = 20) -> float | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{TD_BASE}/sma", params={"symbol": symbol, "interval": interval, "period": period, "apikey": settings.twelve_data_api_key})
        if r.status_code == 200:
            data = r.json()
            if "values" in data and data["values"]:
                return float(data["values"][0]["sma"])
    return None

async def get_bbands(symbol: str, interval: str = "1h") -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{TD_BASE}/bbands", params={"symbol": symbol, "interval": interval, "apikey": settings.twelve_data_api_key})
        if r.status_code == 200:
            data = r.json()
            if "values" in data and data["values"]:
                return data["values"][0]
    return None

def _normalize_macd(raw: dict | None) -> dict | None:
    if not raw:
        return None
    return {
        "macd": float(raw.get("macd", 0)),
        "macd_signal": float(raw.get("macd_signal", raw.get("signal", 0))),
        "macd_hist": float(raw.get("macd_histogram", raw.get("histogram", raw.get("macd_hist", 0)))),
    }

def _normalize_bbands(raw: dict | None) -> dict | None:
    if not raw:
        return None
    return {
        "upper_band": float(raw.get("upper_band", raw.get("upper", 0))),
        "middle_band": float(raw.get("middle_band", raw.get("mid", raw.get("middle", 0)))),
        "lower_band": float(raw.get("lower_band", raw.get("lower", 0))),
    }

async def get_technicals(symbol: str, interval: str = "1h") -> dict:
    rsi, macd, sma20, sma50, bbands = await asyncio.gather(
        get_rsi(symbol, interval),
        get_macd(symbol, interval),
        get_sma(symbol, interval, 20),
        get_sma(symbol, interval, 50),
        get_bbands(symbol, interval),
    )
    return {
        "symbol": symbol,
        "rsi": rsi,
        "macd": _normalize_macd(macd),
        "sma_20": sma20,
        "sma_50": sma50,
        "bbands": _normalize_bbands(bbands),
    }

async def get_fundamentals(symbol: str) -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{TD_BASE}/fundamentals", params={"symbol": symbol, "apikey": settings.twelve_data_api_key})
        if r.status_code == 200:
            return r.json()
    return None

async def get_market_movers() -> dict:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{TD_BASE}/market_movers", params={"apikey": settings.twelve_data_api_key})
        if r.status_code == 200:
            return r.json()
    return {}

async def scan_all() -> dict:
    results = {"prices": {}, "technicals": {}, "movers": {}}
    movers = await get_market_movers()
    if movers:
        results["movers"] = movers
    for category, symbols in WATCHLIST.items():
        for sym in symbols:
            quote = await get_quote(sym)
            if quote:
                results["prices"][sym] = quote
    return results
