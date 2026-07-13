import asyncio
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timezone

# Cache of Ticker objects
_ticker_cache: dict[str, yf.Ticker] = {}

WATCHLIST = {
    "crypto": ["BTC/USD", "ETH/USD", "SOL/USD", "BNB/USD"],
    "forex": ["EUR/USD", "GBP/USD", "XAU/USD"],
    "stocks": ["AAPL", "MSFT", "TSLA", "NVDA", "SPY"],
}

def _to_yahoo(symbol: str) -> str:
    if "/" in symbol:
        parts = symbol.split("/")
        base = parts[0].upper()
        quote = parts[1].upper()
        if base == "XAU":
            return "GC=F"
        if base in ("BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOT"):
            return f"{base}-{quote}"
        return f"{base}{quote}=X"
    return symbol

def _get_ticker(symbol: str) -> yf.Ticker:
    yahoo_sym = _to_yahoo(symbol)
    if yahoo_sym not in _ticker_cache:
        _ticker_cache[yahoo_sym] = yf.Ticker(yahoo_sym)
    return _ticker_cache[yahoo_sym]

def _run(coro):
    return asyncio.get_event_loop().run_in_executor(None, coro)

def _get_price(info: dict) -> float | None:
    for key in ("regularMarketPrice", "price", "lastPrice", "open"):
        v = info.get(key)
        if v is not None and v != 0:
            return float(v)
    return None

async def get_price(symbol: str) -> dict | None:
    try:
        t = _get_ticker(symbol)
        info = await _run(lambda: t.fast_info)
        price = _get_price(info)
        if price is not None:
            return {"symbol": symbol, "price": price, "source": "yfinance", "timestamp": datetime.now(timezone.utc).isoformat()}
    except Exception:
        pass
    return None

async def get_quote(symbol: str) -> dict | None:
    try:
        t = _get_ticker(symbol)
        info = await _run(lambda: t.fast_info)
        price = _get_price(info)
        if price is None:
            return None
        prev = info.get("previousClose") or info.get("regularMarketPreviousClose") or price
        change = price - float(prev)
        change_pct = (change / float(prev)) * 100 if prev else 0
        return {
            "symbol": symbol,
            "price": price,
            "high": float(info.get("dayHigh", 0) or 0),
            "low": float(info.get("dayLow", 0) or 0),
            "volume": float(info.get("lastVolume", 0) or 0),
            "change": round(change, 4),
            "change_pct": round(change_pct, 4),
            "source": "yfinance",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception:
        return None

async def get_time_series(symbol: str, interval: str = "1h", outputsize: int = 100) -> list:
    interval_map = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "60m", "4h": "1d", "1d": "1d"}
    period_map = {"1m": "1d", "5m": "5d", "15m": "1mo", "30m": "1mo", "1h": "1mo", "4h": "3mo", "1d": "1y"}
    yf_interval = interval_map.get(interval, "60m")
    yf_period = period_map.get(interval, "1mo")
    try:
        t = _get_ticker(symbol)
        df = await _run(lambda: t.history(period=yf_period, interval=yf_interval))
        if df is None or df.empty:
            return []
        df = df.tail(outputsize)
        records = []
        for idx, row in df.iterrows():
            records.append({
                "datetime": idx.isoformat() if hasattr(idx, 'isoformat') else str(idx),
                "open": float(row.get("Open", 0)),
                "high": float(row.get("High", 0)),
                "low": float(row.get("Low", 0)),
                "close": float(row.get("Close", 0)),
                "volume": float(row.get("Volume", 0)),
            })
        return records
    except Exception:
        return []

async def get_rsi(symbol: str, interval: str = "1h") -> float | None:
    interval_map = {"1h": "60m", "4h": "1d", "1d": "1d", "1w": "1wk"}
    period_map = {"1h": "1mo", "4h": "3mo", "1d": "6mo", "1w": "1y"}
    yf_interval = interval_map.get(interval, "60m")
    yf_period = period_map.get(interval, "1mo")
    try:
        t = _get_ticker(symbol)
        df = await _run(lambda: t.history(period=yf_period, interval=yf_interval))
        if df is None or df.empty or len(df) < 15:
            return None
        closes = df["Close"].values
        deltas = np.diff(closes)
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        avg_gain = np.mean(gains[-14:])
        avg_loss = np.mean(losses[-14:])
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return round(100.0 - (100.0 / (1.0 + rs)), 2)
    except Exception:
        return None

async def get_macd(symbol: str, interval: str = "1h") -> dict | None:
    interval_map = {"1h": "60m", "4h": "1d", "1d": "1d"}
    period_map = {"1h": "2mo", "4h": "6mo", "1d": "1y"}
    yf_interval = interval_map.get(interval, "60m")
    yf_period = period_map.get(interval, "2mo")
    try:
        t = _get_ticker(symbol)
        df = await _run(lambda: t.history(period=yf_period, interval=yf_interval))
        if df is None or df.empty or len(df) < 26:
            return None
        closes = df["Close"].values
        ema12 = pd.Series(closes).ewm(span=12, adjust=False).mean().values
        ema26 = pd.Series(closes).ewm(span=26, adjust=False).mean().values
        macd_values = ema12 - ema26
        macd_line = float(macd_values[-1])
        signal_values = pd.Series(macd_values).ewm(span=9, adjust=False).mean().values
        signal_line = float(signal_values[-1])
        hist = macd_line - signal_line
        return {"macd": round(macd_line, 6), "macd_signal": round(signal_line, 6), "macd_hist": round(hist, 6)}
    except Exception:
        return None

async def get_sma(symbol: str, interval: str = "1h", period: int = 20) -> float | None:
    yf_interval = {"1h": "60m", "4h": "1d", "1d": "1d"}.get(interval, "60m")
    yf_period = {"1h": "1mo", "4h": "3mo", "1d": "6mo"}.get(interval, "1mo")
    try:
        t = _get_ticker(symbol)
        df = await _run(lambda: t.history(period=yf_period, interval=yf_interval))
        if df is None or df.empty or len(df) < period:
            return None
        return round(float(df["Close"].tail(period).mean()), 6)
    except Exception:
        return None

async def get_bbands(symbol: str, interval: str = "1h") -> dict | None:
    yf_interval = {"1h": "60m", "4h": "1d", "1d": "1d"}.get(interval, "60m")
    yf_period = {"1h": "1mo", "4h": "3mo", "1d": "6mo"}.get(interval, "1mo")
    try:
        t = _get_ticker(symbol)
        df = await _run(lambda: t.history(period=yf_period, interval=yf_interval))
        if df is None or df.empty or len(df) < 20:
            return None
        closes = df["Close"].tail(20)
        sma = closes.mean()
        std = closes.std()
        return {
            "upper_band": round(float(sma + 2 * std), 6),
            "middle_band": round(float(sma), 6),
            "lower_band": round(float(sma - 2 * std), 6),
        }
    except Exception:
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
    rsi, macd_res, sma20, sma50, bbands = await asyncio.gather(
        get_rsi(symbol, interval),
        get_macd(symbol, interval),
        get_sma(symbol, interval, 20),
        get_sma(symbol, interval, 50),
        get_bbands(symbol, interval),
    )
    return {
        "symbol": symbol,
        "rsi": rsi,
        "macd": _normalize_macd(macd_res),
        "sma_20": sma20,
        "sma_50": sma50,
        "bbands": _normalize_bbands(bbands),
    }

async def get_fundamentals(symbol: str) -> dict | None:
    try:
        t = _get_ticker(symbol)
        info = await _run(lambda: t.info)
        if not info:
            return None
        return {
            "name": info.get("longName", info.get("shortName", symbol)),
            "sector": info.get("sector", ""),
            "industry": info.get("industry", ""),
            "market_cap": info.get("marketCap", 0),
            "pe_ratio": info.get("trailingPE", info.get("forwardPE")),
            "eps": info.get("trailingEps"),
            "dividend_yield": (info.get("dividendYield", 0) or 0) * 100 if info.get("dividendYield") else 0,
            "week_52_high": info.get("fiftyTwoWeekHigh"),
            "week_52_low": info.get("fiftyTwoWeekLow"),
        }
    except Exception:
        return None

async def get_market_movers() -> dict:
    top_gainers = ["SOL/USD", "NVDA", "TSLA", "BTC/USD", "SPY"]
    top_losers = ["ETH/USD", "MSFT", "GBP/USD", "BNB/USD", "EUR/USD"]
    gainers_data = []
    losers_data = []
    for s in top_gainers:
        q = await get_quote(s)
        if q:
            gainers_data.append({"symbol": s, "percent_change": q.get("change_pct", 0)})
    for s in top_losers:
        q = await get_quote(s)
        if q:
            losers_data.append({"symbol": s, "percent_change": q.get("change_pct", 0)})
    gainers_data.sort(key=lambda x: x["percent_change"], reverse=True)
    losers_data.sort(key=lambda x: x["percent_change"])
    most_active = []
    for s in ["NVDA", "TSLA", "SPY", "AAPL", "MSFT"]:
        q = await get_quote(s)
        if q:
            most_active.append({"symbol": s, "volume": q.get("volume", 0)})
    most_active.sort(key=lambda x: x["volume"], reverse=True)
    return {"gainers": gainers_data[:5], "losers": losers_data[:5], "most_active": most_active[:5]}

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
