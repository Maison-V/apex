import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

from market_data import WATCHLIST, get_quote, _to_yahoo

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
TICKS_FILE = DATA_DIR / "ticks.json"

SCRAPE_INTERVAL = 1.0

class ScraperService:
    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._ticks: dict = {}
        self._running = False
        self._last_run: Optional[str] = None
        self._total_scrapes = 0
        self._errors = 0

    @property
    def running(self) -> bool:
        return self._running

    @property
    def status(self) -> dict:
        return {
            "running": self._running,
            "interval_sec": SCRAPE_INTERVAL,
            "total_scrapes": self._total_scrapes,
            "errors": self._errors,
            "symbols_tracked": sum(len(v) for v in WATCHLIST.values()),
            "last_run": self._last_run,
        }

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None

    async def _loop(self):
        while self._running:
            try:
                await self._scrape_all()
                self._total_scrapes += 1
                self._last_run = datetime.now(timezone.utc).isoformat()
            except Exception:
                self._errors += 1
            await asyncio.sleep(SCRAPE_INTERVAL)

    async def _scrape_all(self):
        results = {}
        async with httpx.AsyncClient(timeout=5.0) as client:
            for category, symbols in WATCHLIST.items():
                for symbol in symbols:
                    try:
                        quote = await get_quote(symbol)
                        if quote:
                            results[symbol] = quote
                        else:
                            fallback = await self._scrape_fallback(client, symbol)
                            if fallback:
                                results[symbol] = fallback
                    except Exception:
                        self._errors += 1

        if results:
            self._ticks = results
            try:
                TICKS_FILE.write_text(json.dumps(results, indent=2, default=str))
            except OSError:
                pass

    async def _scrape_fallback(self, client: httpx.AsyncClient, symbol: str) -> Optional[dict]:
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

    def get_ticks(self) -> dict:
        return dict(self._ticks)


scraper = ScraperService()
