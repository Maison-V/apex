#!/usr/bin/env bash
set -e

echo "=== APEX Dashboard ==="
echo ""

# Backend
echo "[1/2] Starting backend..."
cd "$(dirname "$0")/backend"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
.venv/bin/python main.py &
BACKEND_PID=$!
echo "  Backend running (PID: $BACKEND_PID)"

# Frontend
echo "[2/2] Starting frontend..."
cd "$(dirname "$0")/frontend"
if [ ! -d "node_modules" ]; then
  npm install -q
fi
npm run dev &
FRONTEND_PID=$!
echo "  Frontend running (PID: $FRONTEND_PID)"

echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
