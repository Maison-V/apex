from pydantic import BaseModel
from typing import Optional, Any

class PriceSnapshot(BaseModel):
    symbol: str
    price: float
    change: float
    change_pct: float
    volume: Optional[float] = None
    source: str
    timestamp: str

class TechnicalIndicators(BaseModel):
    symbol: str
    rsi: Optional[float] = None
    macd: Optional[dict] = None
    sma_20: Optional[float] = None
    sma_50: Optional[float] = None
    bb_upper: Optional[float] = None
    bb_lower: Optional[float] = None
    atr: Optional[float] = None

class MarketSnapshot(BaseModel):
    timestamp: str
    prices: list[PriceSnapshot]
    technicals: dict[str, TechnicalIndicators]
    alerts: list[dict]
    scanners: dict[str, Any]

class SwarmConfig(BaseModel):
    name: str
    topology: str = "hierarchical"
    max_agents: int = 4
    goal: Optional[str] = None

class SwarmStatus(BaseModel):
    name: str
    topology: str
    agents: int
    status: str
    tasks_completed: int
    tasks_pending: int
    created_at: str

class WorkflowStep(BaseModel):
    id: str
    name: str
    type: str
    status: str = "pending"
    agent: Optional[str] = None

class Workflow(BaseModel):
    name: str
    description: Optional[str] = None
    steps: list[WorkflowStep]
    status: str = "created"
    current_step: int = 0

class Alert(BaseModel):
    id: Optional[str] = None
    symbol: str
    condition: str
    threshold: float
    active: bool = True
    triggered: bool = False
