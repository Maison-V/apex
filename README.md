# APEX Dashboard

Real-time market awareness, swarm orchestration, and autonomous workflow management.

## Architecture

```
frontend/  →  React + Vite  →  served via FastAPI static mount
backend/   →  FastAPI       →  Twelve Data API + data persistence
```

## Quick Start

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env  # add your Twelve Data API key
python main.py &

# Frontend (dev mode)
cd frontend
npm install
npm run dev
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/market/prices` | All watched asset prices |
| `GET /api/market/price/{symbol}` | Single asset quote |
| `GET /api/market/technicals/{symbol}` | RSI, MACD, SMA, BBands |
| `GET /api/market/time-series/{symbol}` | OHLCV history |
| `GET /api/market/fundamentals/{symbol}` | Earnings, ratios, profile |
| `GET /api/market/scan` | Full market sweep |
| `GET /api/market/movers` | Top gainers/losers |
| `GET /api/swarms` | List deployed swarms |
| `POST /api/swarms` | Deploy a swarm |
| `GET /api/workflows` | List workflows |
| `POST /api/workflows` | Create a workflow |
| `GET /api/alerts` | List alerts |
| `POST /api/alerts` | Create an alert |

## Data Sources

- **Twelve Data** — real-time prices, 60+ technical indicators, fundamentals
- **TradingView** — crypto/stocks scans, top movers, volume breakouts (via opencode)
- **MetaTrader 5** — forex/metals tick data (via opencode)
