import asyncio
import hashlib
import hmac
import json
import os
import random
import time
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

app = FastAPI(title="APEX Dashboard API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── CEO approval flow config ───
# All of these are environment variables you set in Vercel (Project → Settings → Environment Variables).
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM = os.environ.get("RESEND_FROM", "APEX <onboarding@resend.dev>")
CEO_EMAIL = os.environ.get("CEO_EMAIL", "")
SIGNUP_WEBHOOK_SECRET = os.environ.get("SIGNUP_WEBHOOK_SECRET", "")
SIGNUP_ACTION_SECRET = os.environ.get("SIGNUP_ACTION_SECRET", "")
ACTION_LINK_MAX_AGE_SECONDS = 14 * 24 * 3600  # 14 days

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


@app.post("/api/auth/deriv/token")
async def deriv_oauth_token(body: dict):
    code = body.get("code")
    code_verifier = body.get("code_verifier")
    if not code or not code_verifier:
        return {"error": "Missing code or code_verifier"}
    app_id = os.environ.get("DERIV_APP_ID", "1089")
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://oauth.deriv.com/oauth2/token",
            data={
                "grant_type": "authorization_code",
                "client_id": app_id,
                "code": code,
                "redirect_uri": body.get("redirect_uri", ""),
                "code_verifier": code_verifier,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if resp.status_code != 200:
            return {"error": f"Token exchange failed ({resp.status_code}): {resp.text}"}
        data = resp.json()
        return data


_VOLATILITY_CACHE = None
_VOLATILITY_CACHE_TIME = 0


@app.get("/api/deriv/symbols")
async def deriv_symbols():
    global _VOLATILITY_CACHE, _VOLATILITY_CACHE_TIME
    now = datetime.now(timezone.utc).timestamp()
    if _VOLATILITY_CACHE and now - _VOLATILITY_CACHE_TIME < 300:
        return _VOLATILITY_CACHE

    try:
        import websockets
        async with websockets.connect(
            "wss://ws.binaryws.com/websockets/v3?app_id=1089", max_size=2**20, close_timeout=10
        ) as ws:
            await ws.send(json.dumps({"active_symbols": "brief", "product_type": "basic"}))
            resp = await asyncio.wait_for(ws.recv(), timeout=15)
            data = json.loads(resp)
            symbols = data.get("active_symbols", [])
    except Exception:
        symbols = []

    if symbols:
        vol = []
        seen = set()
        for s in symbols:
            sym = s.get("symbol", "")
            if not sym: continue
            display = s.get("display_name", sym)
            market = s.get("market", "")
            submarket = s.get("submarket", "")
            is_vol = (
                sym.startswith("R_") or sym.startswith("BOOM") or sym.startswith("CRASH")
            ) and "volatility" in (submarket or "").lower()
            if is_vol and sym not in seen:
                seen.add(sym)
                vol.append({"symbol": sym, "display": display, "market": market, "submarket": submarket})
        vol.sort(key=lambda x: x["symbol"])
        result = {"symbols": vol, "count": len(vol), "source": "deriv"}
    else:
        fallback = _volatility_fallback()
        result = {"symbols": fallback, "count": len(fallback), "source": "fallback"}

    _VOLATILITY_CACHE = result
    _VOLATILITY_CACHE_TIME = now
    return result


def _volatility_fallback():
    return [
        {"symbol": "R_10", "display": "Volatility 10 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_25", "display": "Volatility 25 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_50", "display": "Volatility 50 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_75", "display": "Volatility 75 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_100", "display": "Volatility 100 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_150", "display": "Volatility 150 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_200", "display": "Volatility 200 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_250", "display": "Volatility 250 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_300", "display": "Volatility 300 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_10_1S", "display": "Volatility 10 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_25_1S", "display": "Volatility 25 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_50_1S", "display": "Volatility 50 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_75_1S", "display": "Volatility 75 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_100_1S", "display": "Volatility 100 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_150_1S", "display": "Volatility 150 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_200_1S", "display": "Volatility 200 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_250_1S", "display": "Volatility 250 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "R_300_1S", "display": "Volatility 300 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "BOOM300", "display": "Boom 300 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "BOOM500", "display": "Boom 500 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "BOOM1000", "display": "Boom 1000 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "BOOM300_1S", "display": "Boom 300 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "BOOM500_1S", "display": "Boom 500 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "BOOM1000_1S", "display": "Boom 1000 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "CRASH300", "display": "Crash 300 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "CRASH500", "display": "Crash 500 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "CRASH1000", "display": "Crash 1000 Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "CRASH300_1S", "display": "Crash 300 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "CRASH500_1S", "display": "Crash 500 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
        {"symbol": "CRASH1000_1S", "display": "Crash 1000 (1s) Index", "market": "synthetic_index", "submarket": "volatility"},
    ]


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


# ─── CEO signup-approval flow ───
# These three pieces work together:
#   1. Supabase fires a DB trigger on every new signup → POSTs to /api/notify-signup
#   2. That endpoint emails the CEO with the applicant's name + one-click Approve/Reject links
#   3. Clicking a link hits /api/admin-action, which verifies a signed token and updates
#      the account's status directly (via the Supabase service-role key, bypassing RLS,
#      because the signed token IS the authorization check here).

def _sign_action(profile_id: str, action: str, ts: int) -> str:
    msg = f"{profile_id}:{action}:{ts}".encode()
    return hmac.new(SIGNUP_ACTION_SECRET.encode(), msg, hashlib.sha256).hexdigest()


def _verify_action(profile_id: str, action: str, ts: int, sig: str) -> bool:
    if not SIGNUP_ACTION_SECRET:
        return False
    expected = _sign_action(profile_id, action, ts)
    if not hmac.compare_digest(expected, sig):
        return False
    if time.time() - ts > ACTION_LINK_MAX_AGE_SECONDS:
        return False
    return True


async def _send_email(to_email: str, subject: str, html: str) -> bool:
    if not RESEND_API_KEY or not to_email:
        print("[notify-signup] RESEND_API_KEY or CEO_EMAIL not configured; skipping send")
        return False
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"from": RESEND_FROM, "to": [to_email], "subject": subject, "html": html},
        )
        if r.status_code >= 300:
            print(f"[notify-signup] Resend send failed: {r.status_code} {r.text}")
        return r.status_code < 300


@app.post("/api/notify-signup")
async def notify_signup(request: Request):
    """Called by the Supabase DB trigger whenever a new profile row is created."""
    if not SIGNUP_WEBHOOK_SECRET or request.headers.get("x-webhook-secret") != SIGNUP_WEBHOOK_SECRET:
        raise HTTPException(403, "Forbidden")

    payload = await request.json()
    record = payload.get("record", payload)
    profile_id = record.get("id")
    email = record.get("email", "")
    full_name = (record.get("full_name") or "").strip() or "(no name given)"

    if not profile_id:
        raise HTTPException(400, "Missing profile id")

    base_url = str(request.base_url).rstrip("/")
    ts = int(time.time())
    approve_url = f"{base_url}/api/admin-action?id={profile_id}&action=approved&ts={ts}&sig={_sign_action(profile_id, 'approved', ts)}"
    reject_url = f"{base_url}/api/admin-action?id={profile_id}&action=rejected&ts={ts}&sig={_sign_action(profile_id, 'rejected', ts)}"
    dashboard_url = f"{base_url}/admin"

    html = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="margin-bottom:4px;">New APEX account request</h2>
      <p style="color:#555;">Someone has requested access to APEX. Only you can approve it.</p>
      <table style="width:100%; margin: 16px 0; border-collapse: collapse;">
        <tr><td style="padding:4px 0; color:#888;">Name</td><td style="padding:4px 0; font-weight:600;">{full_name}</td></tr>
        <tr><td style="padding:4px 0; color:#888;">Email</td><td style="padding:4px 0; font-weight:600;">{email}</td></tr>
      </table>
      <div style="margin: 20px 0;">
        <a href="{approve_url}" style="background:#00e5ff; color:#000; padding:12px 22px; text-decoration:none; font-weight:700; border-radius:4px; margin-right:10px;">Approve</a>
        <a href="{reject_url}" style="background:#ff3d00; color:#fff; padding:12px 22px; text-decoration:none; font-weight:700; border-radius:4px;">Reject</a>
      </div>
      <p style="color:#888; font-size:13px;">Or review every account, including who's currently online, in the <a href="{dashboard_url}">admin dashboard</a>.</p>
      <p style="color:#bbb; font-size:12px;">This link expires in 14 days.</p>
    </div>
    """
    await _send_email(CEO_EMAIL, f"APEX access request — {full_name}", html)
    return {"ok": True}


@app.get("/api/admin-action")
async def admin_action(id: str, action: str, ts: int, sig: str):
    """Handles a click on an Approve/Reject link from the CEO notification email."""
    if action not in ("approved", "rejected"):
        raise HTTPException(400, "Invalid action")
    if not _verify_action(id, action, ts, sig):
        raise HTTPException(403, "This link is invalid or has expired. Please use the admin dashboard instead.")
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        raise HTTPException(500, "Server is not configured for this action yet")

    update_body = {"status": action}
    if action == "approved":
        update_body["approved_at"] = datetime.now(timezone.utc).isoformat()

    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.patch(
            f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{id}&role=neq.ceo",
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            json=update_body,
        )

    ok = r.status_code < 300
    return RedirectResponse(url=f"/admin?result={'ok' if ok else 'error'}&action={action}")
