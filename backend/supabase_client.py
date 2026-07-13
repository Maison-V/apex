"""
Supabase client for APEX.
Set SUPABASE_URL and SUPABASE_KEY env vars to enable.
Otherwise falls back to file-based storage in main.py.
"""
import os
import json
from datetime import datetime, timezone
import httpx

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
SUPABASE_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)

_http_client: httpx.AsyncClient | None = None

async def _get_client():
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            base_url=f"{SUPABASE_URL}/rest/v1",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Prefer": "return=representation",
            },
        )
    return _http_client

async def insert(table: str, data: dict) -> list | None:
    if not SUPABASE_ENABLED:
        return None
    c = await _get_client()
    r = await c.post(f"/{table}", json=data)
    if r.status_code in (200, 201):
        return r.json()
    print(f"[SUPABASE] insert {table} failed: {r.status_code} {r.text}")
    return None

async def upsert(table: str, data: dict, on_conflict: str = "id") -> list | None:
    if not SUPABASE_ENABLED:
        return None
    c = await _get_client()
    r = await c.post(f"/{table}?on_conflict={on_conflict}", json=data)
    if r.status_code in (200, 201):
        return r.json()
    return None

async def select(table: str, filters: dict | None = None, order: str | None = None, limit: int = 100) -> list:
    if not SUPABASE_ENABLED:
        return []
    c = await _get_client()
    params = {"limit": limit}
    if order:
        params["order"] = order
    if filters:
        for k, v in filters.items():
            params[f"{k}=eq.{v}"] = ""
    r = await c.get(f"/{table}", params=params)
    if r.status_code == 200:
        return r.json()
    return []

async def delete(table: str, field: str, value: str) -> bool:
    if not SUPABASE_ENABLED:
        return False
    c = await _get_client()
    r = await c.delete(f"/{table}?{field}=eq.{value}")
    return r.status_code in (200, 204)

async def log_market_snapshot(prices: dict, alerts: list) -> dict | None:
    return await insert("market_snapshots", {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "prices": prices,
        "alerts": alerts,
        "source": "twelvedata",
    })

async def log_forex_snapshot(rates: dict) -> dict | None:
    return await insert("forex_snapshots", {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "rates": rates,
    })

async def upsert_tick(symbol: str, bid: float, ask: float, last: float | None = None,
                      price: float | None = None, volume: float = 0) -> dict | None:
    return await upsert("live_ticks", {
        "symbol": symbol,
        "bid": bid,
        "ask": ask,
        "last": last or bid,
        "price": price or last or bid,
        "volume": volume,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="symbol")

async def get_all_ticks() -> dict:
    if not SUPABASE_ENABLED:
        return {}
    rows = await select("live_ticks", limit=100)
    return {r["symbol"]: r for r in rows}
