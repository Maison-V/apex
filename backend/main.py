import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

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
)

app = FastAPI(title="APEX Dashboard", version="1.1.0")

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

def _load_json(path):
    if path.exists():
        return json.loads(path.read_text())
    return {}

def _save_json(path, data):
    path.write_text(json.dumps(data, indent=2, default=str))

# ─── Twelve Data Market Routes ───

@app.get("/api/market/prices")
async def market_prices():
    results = {}
    for category, symbols in WATCHLIST.items():
        for sym in symbols:
            q = await get_quote(sym)
            if q:
                results[sym] = q
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

# ─── Health ───

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": "1.1.0",
        "supabase": SUPABASE_ENABLED,
        "sources": ["yfinance", "fastforex"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

if __name__ == "__main__":
    frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
    if frontend_dist.exists():
        app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
    import uvicorn
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=settings.debug)