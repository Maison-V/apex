import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from models import SwarmConfig, Workflow, WorkflowStep, Alert
from market_data import (
    WATCHLIST, get_price, get_quote, get_time_series,
    get_rsi, get_macd, get_sma, get_bbands, get_technicals,
    get_fundamentals, get_market_movers, scan_all,
)

app = FastAPI(title="APEX Dashboard", version="1.0.0")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DATA_DIR = Path("data")
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

# --- Market Data Routes ---

@app.get("/api/market/prices")
async def market_prices():
    results = {}
    for category, symbols in WATCHLIST.items():
        for sym in symbols:
            q = await get_quote(sym)
            if q:
                results[sym] = q
    return {"timestamp": datetime.now(timezone.utc).isoformat(), "prices": results}

@app.get("/api/market/price/{symbol}")
async def market_price(symbol: str):
    q = await get_quote(symbol)
    if not q:
        raise HTTPException(404, "Symbol not found")
    return q

@app.get("/api/market/technicals/{symbol}")
async def market_technicals(symbol: str, interval: str = "1h"):
    return await get_technicals(symbol, interval)

@app.get("/api/market/time-series/{symbol}")
async def market_time_series(symbol: str, interval: str = "1h", outputsize: int = 100):
    return await get_time_series(symbol, interval, outputsize)

@app.get("/api/market/fundamentals/{symbol}")
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

# --- Swarm Routes ---

@app.get("/api/swarms")
async def list_swarms():
    return _load_json(SWARM_FILE)

@app.post("/api/swarms")
async def create_swarm(cfg: SwarmConfig):
    swarms = _load_json(SWARM_FILE)
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
    swarms[swarm["id"]] = swarm
    _save_json(SWARM_FILE, swarms)
    return swarm

@app.get("/api/swarms/{swarm_id}")
async def get_swarm(swarm_id: str):
    swarms = _load_json(SWARM_FILE)
    s = swarms.get(swarm_id)
    if not s:
        raise HTTPException(404, "Swarm not found")
    return s

@app.delete("/api/swarms/{swarm_id}")
async def delete_swarm(swarm_id: str):
    swarms = _load_json(SWARM_FILE)
    if swarm_id not in swarms:
        raise HTTPException(404, "Swarm not found")
    del swarms[swarm_id]
    _save_json(SWARM_FILE, swarms)
    return {"ok": True}

# --- Workflow Routes ---

@app.get("/api/workflows")
async def list_workflows():
    return _load_json(WORKFLOW_FILE)

@app.post("/api/workflows")
async def create_workflow(wf: Workflow):
    workflows = _load_json(WORKFLOW_FILE)
    record = {
        "id": str(uuid.uuid4())[:8],
        "name": wf.name,
        "description": wf.description,
        "steps": [s.model_dump() for s in wf.steps],
        "status": "created",
        "current_step": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    workflows[record["id"]] = record
    _save_json(WORKFLOW_FILE, workflows)
    return record

@app.get("/api/workflows/{wf_id}")
async def get_workflow(wf_id: str):
    workflows = _load_json(WORKFLOW_FILE)
    wf = workflows.get(wf_id)
    if not wf:
        raise HTTPException(404, "Workflow not found")
    return wf

@app.post("/api/workflows/{wf_id}/run")
async def run_workflow(wf_id: str):
    workflows = _load_json(WORKFLOW_FILE)
    wf = workflows.get(wf_id)
    if not wf:
        raise HTTPException(404, "Workflow not found")
    wf["status"] = "running"
    _save_json(WORKFLOW_FILE, workflows)
    return wf

@app.post("/api/workflows/{wf_id}/pause")
async def pause_workflow(wf_id: str):
    workflows = _load_json(WORKFLOW_FILE)
    wf = workflows.get(wf_id)
    if not wf:
        raise HTTPException(404, "Workflow not found")
    wf["status"] = "paused"
    _save_json(WORKFLOW_FILE, workflows)
    return wf

@app.delete("/api/workflows/{wf_id}")
async def delete_workflow(wf_id: str):
    workflows = _load_json(WORKFLOW_FILE)
    if wf_id not in workflows:
        raise HTTPException(404, "Workflow not found")
    del workflows[wf_id]
    _save_json(WORKFLOW_FILE, workflows)
    return {"ok": True}

# --- Alerts Routes ---

@app.get("/api/alerts")
async def list_alerts():
    return list(_load_json(ALERTS_FILE).values())

@app.post("/api/alerts")
async def create_alert(alert: Alert):
    alerts = _load_json(ALERTS_FILE)
    a = alert.model_dump()
    a["id"] = str(uuid.uuid4())[:8]
    a["created_at"] = datetime.now(timezone.utc).isoformat()
    alerts[a["id"]] = a
    _save_json(ALERTS_FILE, alerts)
    return a

@app.delete("/api/alerts/{alert_id}")
async def delete_alert(alert_id: str):
    alerts = _load_json(ALERTS_FILE)
    if alert_id not in alerts:
        raise HTTPException(404, "Alert not found")
    del alerts[alert_id]
    _save_json(ALERTS_FILE, alerts)
    return {"ok": True}

if __name__ == "__main__":
    # In production, serve built frontend
    frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
    if frontend_dist.exists():
        app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
    import uvicorn
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=settings.debug)
