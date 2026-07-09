import httpx
from datetime import datetime, timezone

FF_KEY = "2bd5526505-9deaf4f271-thw3uf"
BASE = "https://api.fastforex.io"

MAJOR_PAIRS = [
    "EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF",
    "AUD/USD", "USD/CAD", "NZD/USD",
]

FX_PAIRS = [
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF",
    "AUDUSD", "USDCAD", "NZDUSD",
    "EURJPY", "GBPJPY", "EURGBP",
]

async def fetch_all(from_currency: str = "USD") -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{BASE}/fetch-all", params={"from": from_currency, "api_key": FF_KEY})
        if r.status_code == 200:
            return r.json()
    return None

async def fetch_one(from_: str, to: str) -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{BASE}/fetch-one", params={"from": from_, "to": to, "api_key": FF_KEY})
        if r.status_code == 200:
            return r.json()
    return None

async def fetch_multi(from_: str, targets: list[str]) -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{BASE}/fetch-multi", params={"from": from_, "to": ",".join(targets), "api_key": FF_KEY})
        if r.status_code == 200:
            return r.json()
    return None

async def convert(amount: float, from_: str, to: str) -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{BASE}/convert", params={"amount": amount, "from": from_, "to": to, "api_key": FF_KEY})
        if r.status_code == 200:
            return r.json()
    return None

async def historical(date: str, from_: str, to: str) -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{BASE}/historical", params={"date": date, "from": from_, "to": to, "api_key": FF_KEY})
        if r.status_code == 200:
            return r.json()
    return None

async def time_series(from_: str, to: str, start: str, end: str) -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{BASE}/time-series", params={"from": from_, "to": to, "start": start, "end": end, "api_key": FF_KEY})
        if r.status_code == 200:
            return r.json()
    return None

async def currencies() -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{BASE}/currencies", params={"api_key": FF_KEY})
        if r.status_code == 200:
            return r.json()
    return None

async def fx_quote(pair: str) -> dict | None:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{BASE}/fx/quote", params={"pair": pair, "api_key": FF_KEY})
        if r.status_code == 200:
            return r.json()
    return None

async def fx_quotes_all() -> list[dict]:
    results = []
    async with httpx.AsyncClient() as c:
        tasks = [c.get(f"{BASE}/fx/quote", params={"pair": p, "api_key": FF_KEY}) for p in FX_PAIRS]
        responses = await asyncio.gather(*tasks)
        for r in responses:
            if r.status_code == 200:
                results.append(r.json())
    return results

import asyncio

__all__ = [
    "fetch_all", "fetch_one", "fetch_multi", "convert", "historical",
    "time_series", "currencies", "fx_quote", "fx_quotes_all",
]