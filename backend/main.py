import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from models import SwarmConfig, Workflow, WorkflowStep, Alert
from market_data import (
    WATCHLIST, get_price, get_quote, get_time_series,
    get_rsi, get_macd, get_sma, get_bbands, get_technicals,
    get_fundamentals, get_market_movers, scan_all,
)
from fastforex import (
    fetch_all, fetch_one, fetch_multi, convert, historical,
    time_series as ff_time_series, currencies, fx_quote, fx_quotes_all,
    MAJOR_PAIRS, FX_PAIRS,
)
from supabase_client import (
    SUPABASE_ENABLED, insert as sb_insert, select as sb_select,
    delete as sb_delete, log_market_snapshot, log_forex_snapshot,
    upsert_tick, get_all_ticks,
)
from scraper_service import scraper

app = FastAPI(title="APEX Dashboard", version="1.2.0")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

try:
    DATA_DIR = Path("data")
    DATA_DIR.mkdir(exist_ok=True)
except OSError:
    DATA_DIR = Path("/tmp") / "apex_data"
    DATA_DIR.mkdir(exist_ok=True)

SWARM_FILE = DATA_DIR / "swarms.json"
WORKFLOW_FILE = DATA_DIR / "workflows.json"
ALERTS_FILE = DATA_DIR / "alerts.json"
HISTORY_FILE = DATA_DIR / "history.json"
TICKS_FILE = DATA_DIR / "ticks.json"

def _load_json(path):
    if path.exists():
        return json.loads(path.read_text())
    return {}

def _save_json(path, data):
    path.write_text(json.dumps(data, indent=2, default=str))

# ─── Scraper Routes ───

@app.get("/api/scraper/status")
async def scraper_status():
    return scraper.status

@app.post("/api/scraper/refresh")
async def scraper_refresh():
    ticks = await scraper._fetch_all()
    return {"ok": True, "symbols": len(ticks)}

# ─── Twelve Data Market Routes ───

@app.get("/api/market/prices")
async def market_prices():
    results = await scraper.get_ticks()
    snapshot = {"timestamp": datetime.now(timezone.utc).isoformat(), "prices": results}
    if SUPABASE_ENABLED:
        await log_market_snapshot(results, [])
    return snapshot

@app.get("/api/market/price/{symbol:path}")
async def market_price(symbol: str):
    q = await get_quote(symbol)
    if not q:
        raise HTTPException(404, "Symbol not found")
    return q

@app.get("/api/market/technicals/{symbol:path}")
async def market_technicals(symbol: str, interval: str = "1h"):
    return await get_technicals(symbol, interval)

@app.get("/api/market/time-series/{symbol:path}")
async def market_time_series(symbol: str, interval: str = "1h", outputsize: int = 100):
    return await get_time_series(symbol, interval, outputsize)

@app.get("/api/market/fundamentals/{symbol:path}")
async def market_fundamentals(symbol: str):
    f = await get_fundamentals(symbol)
    if not f:
        raise HTTPException(404, "Fundamentals not found")
    return f

@app.get("/api/market/scan")
async def market_scan():
    return await scan_all()

@app.get("/api/market/movers")
async def market_movers():
    return await get_market_movers()

@app.get("/api/market/watchlist")
async def market_watchlist():
    return WATCHLIST

# ─── FastForex Routes ───

@app.get("/api/forex/rates")
async def forex_all(from_: str = Query("USD", alias="from")):
    data = await fetch_all(from_)
    if not data:
        raise HTTPException(502, "Failed to fetch forex rates")
    if SUPABASE_ENABLED:
        await log_forex_snapshot(data)
    return data

@app.get("/api/forex/rate")
async def forex_rate(from_: str = Query("USD"), to: str = Query("EUR")):
    data = await fetch_one(from_, to)
    if not data:
        raise HTTPException(502, "Failed to fetch forex rate")
    return data

@app.get("/api/forex/multi")
async def forex_multi(from_: str = Query("USD"), to: str = Query("EUR,GBP,JPY")):
    targets = [t.strip() for t in to.split(",")]
    data = await fetch_multi(from_, targets)
    if not data:
        raise HTTPException(502, "Failed to fetch forex rates")
    return data

@app.get("/api/forex/convert")
async def forex_convert(amount: float = Query(1.0), from_: str = Query("USD", alias="from"), to: str = Query("EUR")):
    data = await convert(amount, from_, to)
    if not data:
        raise HTTPException(502, "Conversion failed")
    return data

@app.get("/api/forex/historical")
async def forex_historical(date: str, from_: str = Query("USD"), to: str = Query("EUR")):
    data = await historical(date, from_, to)
    if not data:
        raise HTTPException(502, "Failed to fetch historical rate")
    return data

@app.get("/api/forex/time-series")
async def forex_time_series(from_: str = Query("USD"), to: str = Query("EUR"), start: str = Query("2026-01-01"), end: str = Query("2026-07-01")):
    data = await ff_time_series(from_, to, start, end)
    if not data:
        raise HTTPException(502, "Failed to fetch time series")
    return data

@app.get("/api/forex/currencies")
async def forex_currencies():
    data = await currencies()
    if not data:
        raise HTTPException(502, "Failed to fetch currencies")
    return data

@app.get("/api/forex/fx-quotes")
async def forex_fx_quotes():
    data = await fx_quotes_all()
    return {"pairs": FX_PAIRS, "quotes": data}

@app.get("/api/forex/fx-quote/{pair}")
async def forex_fx_quote(pair: str):
    data = await fx_quote(pair.upper())
    if not data:
        raise HTTPException(502, "Failed to fetch FX quote")
    return data

@app.get("/api/forex/pairs")
async def forex_pairs():
    return {"major": MAJOR_PAIRS, "fx": FX_PAIRS}

# ─── Swarm Routes ───

@app.get("/api/swarms")
async def list_swarms():
    if SUPABASE_ENABLED:
        rows = await sb_select("swarms", order="created_at.desc")
        return {r["id"]: r for r in rows}
    return _load_json(SWARM_FILE)

@app.post("/api/swarms")
async def create_swarm(cfg: SwarmConfig):
    swarm = {
        "id": str(uuid.uuid4())[:8],
        "name": cfg.name,
        "topology": cfg.topology,
        "max_agents": cfg.max_agents,
        "goal": cfg.goal,
        "status": "created",
        "agents": [],
        "tasks_completed": 0,
        "tasks_pending": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if SUPABASE_ENABLED:
        await sb_insert("swarms", swarm)
    else:
        swarms = _load_json(SWARM_FILE)
        swarms[swarm["id"]] = swarm
        _save_json(SWARM_FILE, swarms)
    return swarm

@app.get("/api/swarms/{swarm_id}")
async def get_swarm(swarm_id: str):
    if SUPABASE_ENABLED:
        rows = await sb_select("swarms", {"id": swarm_id})
        if rows:
            return rows[0]
        raise HTTPException(404, "Swarm not found")
    swarms = _load_json(SWARM_FILE)
    s = swarms.get(swarm_id)
    if not s:
        raise HTTPException(404, "Swarm not found")
    return s

@app.delete("/api/swarms/{swarm_id}")
async def delete_swarm(swarm_id: str):
    if SUPABASE_ENABLED:
        ok = await sb_delete("swarms", "id", swarm_id)
        if not ok:
            raise HTTPException(404, "Swarm not found")
    else:
        swarms = _load_json(SWARM_FILE)
        if swarm_id not in swarms:
            raise HTTPException(404, "Swarm not found")
        del swarms[swarm_id]
        _save_json(SWARM_FILE, swarms)
    return {"ok": True}

# ─── Workflow Routes ───

@app.get("/api/workflows")
async def list_workflows():
    if SUPABASE_ENABLED:
        rows = await sb_select("workflows", order="created_at.desc")
        return {r["id"]: r for r in rows}
    return _load_json(WORKFLOW_FILE)

@app.post("/api/workflows")
async def create_workflow(wf: Workflow):
    record = {
        "id": str(uuid.uuid4())[:8],
        "name": wf.name,
        "description": wf.description,
        "steps": [s.model_dump() for s in wf.steps],
        "status": "created",
        "current_step": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if SUPABASE_ENABLED:
        await sb_insert("workflows", {**record, "steps": json.dumps(record["steps"])})
    else:
        workflows = _load_json(WORKFLOW_FILE)
        workflows[record["id"]] = record
        _save_json(WORKFLOW_FILE, workflows)
    return record

@app.get("/api/workflows/{wf_id}")
async def get_workflow(wf_id: str):
    if SUPABASE_ENABLED:
        rows = await sb_select("workflows", {"id": wf_id})
        if rows:
            return rows[0]
        raise HTTPException(404, "Workflow not found")
    workflows = _load_json(WORKFLOW_FILE)
    wf = workflows.get(wf_id)
    if not wf:
        raise HTTPException(404, "Workflow not found")
    return wf

@app.post("/api/workflows/{wf_id}/run")
async def run_workflow(wf_id: str):
    if SUPABASE_ENABLED:
        rows = await sb_select("workflows", {"id": wf_id})
        if not rows:
            raise HTTPException(404, "Workflow not found")
        await sb_insert("workflows", {**rows[0], "status": "running"})
    else:
        workflows = _load_json(WORKFLOW_FILE)
        wf = workflows.get(wf_id)
        if not wf:
            raise HTTPException(404, "Workflow not found")
        wf["status"] = "running"
        _save_json(WORKFLOW_FILE, workflows)
    return {"ok": True}

@app.post("/api/workflows/{wf_id}/pause")
async def pause_workflow(wf_id: str):
    if SUPABASE_ENABLED:
        rows = await sb_select("workflows", {"id": wf_id})
        if not rows:
            raise HTTPException(404, "Workflow not found")
        await sb_insert("workflows", {**rows[0], "status": "paused"})
    else:
        workflows = _load_json(WORKFLOW_FILE)
        wf = workflows.get(wf_id)
        if not wf:
            raise HTTPException(404, "Workflow not found")
        wf["status"] = "paused"
        _save_json(WORKFLOW_FILE, workflows)
    return {"ok": True}

@app.delete("/api/workflows/{wf_id}")
async def delete_workflow(wf_id: str):
    if SUPABASE_ENABLED:
        ok = await sb_delete("workflows", "id", wf_id)
        if not ok:
            raise HTTPException(404, "Workflow not found")
    else:
        workflows = _load_json(WORKFLOW_FILE)
        if wf_id not in workflows:
            raise HTTPException(404, "Workflow not found")
        del workflows[wf_id]
        _save_json(WORKFLOW_FILE, workflows)
    return {"ok": True}

# ─── Alerts Routes ───

@app.get("/api/alerts")
async def list_alerts():
    if SUPABASE_ENABLED:
        return await sb_select("alerts", order="created_at.desc")
    return list(_load_json(ALERTS_FILE).values())

@app.post("/api/alerts")
async def create_alert(alert: Alert):
    a = alert.model_dump()
    a["id"] = str(uuid.uuid4())[:8]
    a["created_at"] = datetime.now(timezone.utc).isoformat()
    if SUPABASE_ENABLED:
        await sb_insert("alerts", a)
    else:
        alerts = _load_json(ALERTS_FILE)
        alerts[a["id"]] = a
        _save_json(ALERTS_FILE, alerts)
    return a

@app.delete("/api/alerts/{alert_id}")
async def delete_alert(alert_id: str):
    if SUPABASE_ENABLED:
        ok = await sb_delete("alerts", "id", alert_id)
        if not ok:
            raise HTTPException(404, "Alert not found")
    else:
        alerts = _load_json(ALERTS_FILE)
        if alert_id not in alerts:
            raise HTTPException(404, "Alert not found")
        del alerts[alert_id]
        _save_json(ALERTS_FILE, alerts)
    return {"ok": True}

# ─── Live Tick Routes ───

@app.post("/api/market/tick")
async def receive_tick(data: dict):
    symbol = data.get("symbol", "XAU/USD")
    bid = data.get("bid")
    ask = data.get("ask")
    last = data.get("last", bid)
    price = data.get("price", last or bid)
    volume = data.get("volume", 0)
    tick = {
        "symbol": symbol,
        "bid": bid,
        "ask": ask,
        "last": last,
        "price": price,
        "volume": volume,
        "source": data.get("source", "metatrader"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    ticks = _load_json(TICKS_FILE)
    ticks[symbol] = tick
    _save_json(TICKS_FILE, ticks)
    if SUPABASE_ENABLED:
        await upsert_tick(symbol, bid, ask, last, price, volume)
    return {"ok": True, "symbol": symbol, "price": price}

@app.get("/api/market/ticks/live")
async def get_live_ticks():
    ticks = await scraper.get_ticks()
    return {"ticks": ticks, "source": "scraper", "timestamp": datetime.now(timezone.utc).isoformat()}

@app.get("/api/market/tick/{symbol:path}")
async def get_tick(symbol: str):
    ticks = await scraper.get_ticks()
    t = ticks.get(symbol)
    if not t:
        raise HTTPException(404, "No tick data for symbol")
    return t

# ─── Deriv OAuth ───

@app.post("/api/auth/deriv/token")
async def deriv_oauth_token(body: dict):
    code = body.get("code")
    code_verifier = body.get("code_verifier")
    if not code or not code_verifier:
        raise HTTPException(400, "Missing code or code_verifier")
    app_id = settings.deriv_app_id or "1089"
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
            raise HTTPException(resp.status_code, resp.text)
        data = resp.json()
        return data

# ─── Health ───

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": "1.2.0",
        "supabase": SUPABASE_ENABLED,
        "scraper": scraper.status,
        "sources": ["yfinance", "fastforex", "scraper"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

# ─── CEO signup-approval flow (mirrors api/index.py for local dev) ───
import hashlib
import hmac
import time
from fastapi import Request
from fastapi.responses import RedirectResponse

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM = os.environ.get("RESEND_FROM", "APEX <onboarding@resend.dev>")
CEO_EMAIL = os.environ.get("CEO_EMAIL", "")
SIGNUP_WEBHOOK_SECRET = os.environ.get("SIGNUP_WEBHOOK_SECRET", "")
SIGNUP_ACTION_SECRET = os.environ.get("SIGNUP_ACTION_SECRET", "")
ACTION_LINK_MAX_AGE_SECONDS = 14 * 24 * 3600


def _sign_action(profile_id: str, action: str, ts: int) -> str:
    msg = f"{profile_id}:{action}:{ts}".encode()
    return hmac.new(SIGNUP_ACTION_SECRET.encode(), msg, hashlib.sha256).hexdigest()


def _verify_action(profile_id: str, action: str, ts: int, sig: str) -> bool:
    if not SIGNUP_ACTION_SECRET:
        return False
    expected = _sign_action(profile_id, action, ts)
    if not hmac.compare_digest(expected, sig):
        return False
    return time.time() - ts <= ACTION_LINK_MAX_AGE_SECONDS


async def _send_email(to_email: str, subject: str, html: str) -> bool:
    if not RESEND_API_KEY or not to_email:
        print("[notify-signup] RESEND_API_KEY or CEO_EMAIL not configured; skipping send")
        return False
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
            json={"from": RESEND_FROM, "to": [to_email], "subject": subject, "html": html},
        )
        return r.status_code < 300


@app.post("/api/notify-signup")
async def notify_signup(request: Request):
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


frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=settings.debug)
