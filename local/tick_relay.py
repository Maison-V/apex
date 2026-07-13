#!/usr/bin/env python3
"""
Local relay that reads MetaTrader 5 live ticks (from mcp_tick.json)
and POSTs them to the APEX backend for real-time display on the site.

Usage:
  python3 local/tick_relay.py

Reads /api/market/ticks/live from the backend to discover which symbols
are watched, then reads the local tick file and pushes updates.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

MT5_FILES_DIR = os.path.expanduser(
    "~/Library/Application Support/net.metaquotes.wine.metatrader5"
    "/drive_c/Program Files/MetaTrader 5/MQL5/Files"
)
TICK_FILE = os.path.join(MT5_FILES_DIR, "mcp_tick.json")

API_BASE = os.environ.get("APEX_API_BASE", "https://apex.vercel.app")

POLL_MS = int(os.environ.get("TICK_POLL_MS", "100"))

SYMBOL_MAP = {
    "XAUUSD": "XAU/USD",
    "XAUUSDc": "XAU/USD",
    "EURUSD": "EUR/USD",
    "GBPUSD": "GBP/USD",
    "BTCUSD": "BTC/USD",
    "ETHUSD": "ETH/USD",
    "SOLUSD": "SOL/USD",
    "BNBUSD": "BNB/USD",
    "US30": "US30",
    "SP500": "SP500",
    "NAS100": "NAS100",
}

MT5_SYMBOL = os.environ.get("MT5_SYMBOL", "XAUUSDc")


def api_post(path, data):
    url = f"{API_BASE}{path}"
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"[relay] HTTP {e.code} on {path}: {e.read().decode()[:200]}")
        return None
    except Exception as e:
        print(f"[relay] Error on {path}: {e}")
        return None


def read_tick_file():
    try:
        if not os.path.exists(TICK_FILE):
            return None
        with open(TICK_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"[relay] Error reading tick file: {e}")
        return None


def build_tick_payload(raw_tick):
    mapped_symbol = SYMBOL_MAP.get(MT5_SYMBOL, MT5_SYMBOL)
    bid = raw_tick.get("bid")
    ask = raw_tick.get("ask")
    last = raw_tick.get("last", bid)
    volume = raw_tick.get("volume", 0)
    ts = raw_tick.get("time", int(time.time() * 1000))
    return {
        "symbol": mapped_symbol,
        "bid": bid,
        "ask": ask,
        "last": last,
        "price": last or bid,
        "volume": volume,
        "timestamp_ms": ts,
        "source": "metatrader",
    }


def main():
    print(f"[relay] Starting MT5 tick relay for {MT5_SYMBOL}")
    print(f"[relay] Watching: {TICK_FILE}")
    print(f"[relay] Posting to: {API_BASE}/api/market/tick")
    print(f"[relay] Poll interval: {POLL_MS}ms")

    last_tick_time = 0
    last_payload = None

    while True:
        raw = read_tick_file()
        if raw:
            tick_time = raw.get("time", 0)
            if tick_time != last_tick_time:
                payload = build_tick_payload(raw)
                if payload != last_payload:
                    result = api_post("/api/market/tick", payload)
                    if result:
                        print(f"[relay] TICK {MT5_SYMBOL} bid={payload['bid']} ask={payload['ask']}")
                    last_payload = payload
                    last_tick_time = tick_time

        time.sleep(POLL_MS / 1000.0)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[relay] Stopped")
        sys.exit(0)
