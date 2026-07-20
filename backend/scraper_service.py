import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

from market_data import WATCHLIST, get_quote, _to_yahoo

CACHE_TTL = 1.0

class ScraperService:
    def __init__(self):
        self._cache: dict = {}
        self._last_fetch: float = 0
        self._total_fetches = 0
        self._errors = 0

    @property
    def status(self) -> dict:
        return {
            "mode": "on-demand",
            "cache_ttl_sec": CACHE_TTL,
            "total_fetches": self._total_fetches,
            "errors": self._errors,
            "symbols_tracked": sum(len(v) for v in WATCHLIST.values()),
            "cached_since": datetime.fromtimestamp(self._last_fetch, tz=timezone.utc).isoformat() if self._last_fetch > 0 else None,
        }

    async def get_ticks(self) -> dict:
        now = time.monotonic()
        if now - self._last_fetch < CACHE_TTL and self._cache:
            return dict(self._cache)
        return await self._fetch_all()

    async def _fetch_all(self) -> dict:
        results = {}
        async with httpx.AsyncClient(timeout=5.0) as client:
            for category, symbols in WATCHLIST.items():
                for symbol in symbols:
                    try:
                        quote = await get_quote(symbol)
                        if quote:
                            results[symbol] = quote
                        else:
                            fallback = await self._scrape_yahoo(client, symbol)
                            if fallback:
                                results[symbol] = fallback
                    except Exception:
                        self._errors += 1

        if results:
            self._cache = results
            self._last_fetch = time.monotonic()
            self._total_fetches += 1
        return dict(results)

    async def _scrape_yahoo(self, client: httpx.AsyncClient, symbol: str) -> Optional[dict]:
        yahoo_sym = _to_yahoo(symbol)
        try:
            resp = await client.get(
                "https://query1.finance.yahoo.com/v8/finance/chart/" + yahoo_sym,
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
            if not price or not quotes:
                return None
            opens = quotes.get("open", [])
            highs = quotes.get("high", [])
            lows = quotes.get("low", [])
            closes = quotes.get("close", [])
            volumes = quotes.get("volume", [])
            valid = [(o, h, l, c, v) for o, h, l, c, v in zip(opens, highs, lows, closes, volumes) if c is not None]
            if not valid:
                return None
            prev = meta.get("chartPreviousClose") or meta.get("previousClose") or price
            change = float(price) - float(prev)
            change_pct = (change / float(prev)) * 100 if float(prev) else 0
            all_highs = [h for h in highs if h is not None]
            all_lows = [l for l in lows if l is not None]
            return {
                "symbol": symbol,
                "price": float(price),
                "high": max(all_highs) if all_highs else float(price),
                "low": min(all_lows) if all_lows else float(price),
                "volume": int(sum(v for v in volumes if v is not None)) if any(volumes) else 0,
                "change": round(float(change), 4),
                "change_pct": round(float(change_pct), 4),
                "source": "scraper",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except Exception:
            return None


scraper = ScraperService()
