#!/usr/bin/env python3
"""
Parameter scanner for the momentum flip strategy.

Usage:
    python backtest/scan_momentum_params.py BOOM500 20000
    python backtest/scan_momentum_params.py BOOM500 5000 5 0.8 1  # single run
"""

import sys, json, math, time, threading, os
from itertools import product

try:
    import websocket
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websocket-client"])
    import websocket

DERIV_WS = "wss://ws.binaryws.com/websockets/v3?app_id=49941"
REQUEST_TIMEOUT = 30
PAYOUT = 0.92
INITIAL_BALANCE = 10.0
MIN_STAKE = 0.50


def fetch_ticks(symbol, count=5000):
    print(f"  Fetching {count} ticks for {symbol}...")
    prices = []; error = [None]
    def on_open(ws):
        ws.send(json.dumps({"ticks_history": symbol, "end": "latest",
                             "count": count, "style": "ticks",
                             "adjust_start_time": 1}))
    def on_msg(ws, msg):
        data = json.loads(msg)
        if "error" in data: error[0] = data["error"]["message"]; ws.close(); return
        if data.get("msg_type") == "history" and "history" in data:
            prices.extend(data["history"]["prices"]); ws.close()
    def on_err(ws, err): error[0] = str(err)
    ws = websocket.WebSocketApp(DERIV_WS, on_open=on_open, on_message=on_msg, on_error=on_err)
    t = threading.Thread(target=ws.run_forever, daemon=True); t.start()
    deadline = time.time() + REQUEST_TIMEOUT
    while not prices and not error[0] and time.time() < deadline: time.sleep(0.1)
    if error[0]: raise RuntimeError(f"WS: {error[0]}")
    if not prices: raise RuntimeError("No data received (timeout)")
    return [float(p) for p in prices]


def compute_momentum(prices, lookback):
    if len(prices) < lookback + 1:
        return None
    chunk = prices[-(lookback + 1):]
    rises = all(chunk[i] <= chunk[i + 1] for i in range(lookback))
    falls = all(chunk[i] >= chunk[i + 1] for i in range(lookback))
    if rises: return "CALL"
    if falls: return "PUT"
    return None


def run(prices, lookback, margin, duration):
    balance = INITIAL_BALANCE
    peak = INITIAL_BALANCE
    dd_from_peak = 0
    trades = []
    wins = 0
    losses = 0

    max_i = len(prices) - duration - 1
    for i in range(lookback + 1, max_i):
        context = prices[:i + 1]
        direction = compute_momentum(context, lookback)
        if direction is None:
            continue

        stake = balance * margin
        if stake < MIN_STAKE:
            break
        if stake > 1e12:
            break

        entry = prices[i]
        exit_price = prices[i + duration]

        if direction == "CALL":
            won = exit_price >= entry
        else:
            won = exit_price <= entry

        if won:
            profit = stake * PAYOUT
            balance += profit
            wins += 1
        else:
            balance -= stake
            losses += 1

        peak = max(peak, balance)
        dd_from_peak = max(dd_from_peak, (peak - balance) / peak * 100)

        trades.append({"won": won, "balance": balance})
        if balance <= 0:
            break

    total = wins + losses
    if total == 0:
        return None

    return {
        "wins": wins, "losses": losses,
        "win_rate": round(wins / total * 100, 2),
        "final": round(balance, 2),
        "peak": round(peak, 2),
        "max_dd": round(dd_from_peak, 2),
        "trades": total,
        "flipped": balance >= 20.0,
        "busted": balance <= 0,
        "overflow": stake > 1e12,
        "kelly_pct": round((wins / total - (1 - wins / total) / (PAYOUT / margin)) * 100, 2) if total > 10 else 0,
    }


def single_run(symbol, prices, lookback, margin, duration):
    print(f"\n{'='*60}")
    print(f"  {symbol} — lookback={lookback}, margin={margin:.0%}, duration={duration}t")
    print(f"{'='*60}")
    r = run(prices, lookback, margin, duration)
    if not r:
        print("  No trades generated")
        return
    flag = ""
    if r["flipped"] and not r["overflow"]: flag = " ✅ FLIPPED"
    if r["busted"]: flag = " 💥 BUST"
    if r["overflow"]: flag = " ∞ OVERFLOW (huge profits)"
    print(f"  Trades: {r['trades']}  Wins: {r['wins']}  Losses: {r['losses']}")
    print(f"  Win Rate: {r['win_rate']}%")
    print(f"  Final: ${r['final']}{flag}")
    print(f"  Peak: ${r['peak']}  Max DD: {r['max_dd']}%")


def scan(symbol, prices, lookbacks, margins, durations):
    print(f"\nParameter scan for {symbol} ({len(prices)} ticks)")
    print(f"{'='*70}")
    print(f"{'Lookback':>8} {'Margin':>7} {'Dur':>4} {'Trades':>7} {'Win%':>7} {'Final':>10} {'Peak':>10} {'MaxDD':>7} {'Result':>12}")
    print(f"{'-'*70}")

    results = []
    for lookback, margin, duration in product(lookbacks, margins, durations):
        r = run(prices, lookback, margin, duration)
        if r is None:
            continue
        label = ""
        if r["overflow"]: label = "∞ OVERFLOW"
        elif r["flipped"] and r["max_dd"] < 50: label = "✅ FLIP"
        elif r["flipped"]: label = "flip+dd"
        elif r["busted"]: label = "💥 BUST"
        elif r["final"] > INITIAL_BALANCE: label = "up"
        else: label = "down"
        results.append((lookback, margin, duration, r, label))

    results.sort(key=lambda x: -x[3]["final"] if x[3]["final"] else 0)

    for lookback, margin, duration, r, label in results:
        final_str = f"${r['final']:<7.2f}" if r["final"] < 1e12 else "∞"
        print(f"{lookback:>8} {margin:>6.0%} {duration:>4}t {r['trades']:>7} {r['win_rate']:>6.2f}% {final_str:>10} ${r['peak']:<7.2f} {r['max_dd']:>6.2f}% {label:>12}")

    # Best overall
    best = results[0] if results else None
    if best:
        print(f"\n{'='*70}")
        print(f"  BEST: lookback={best[0]}, margin={best[1]:.0%}, duration={best[2]}t")
        print(f"        {best[3]['trades']} trades, {best[3]['win_rate']}% WR, final=${best[3]['final']}, peak=${best[3]['peak']}, maxDD={best[3]['max_dd']}%")

        # Best that flipped with low drawdown
        safe = [r for r in results if r[3]["flipped"] and r[3]["max_dd"] < 50 and not r[3]["overflow"]]
        if safe:
            best_safe = safe[0]
            print(f"  BEST SAFE: lookback={best_safe[0]}, margin={best_safe[1]:.0%}, duration={best_safe[2]}t")
            print(f"             {best_safe[3]['trades']} trades, {best_safe[3]['win_rate']}% WR, final=${best_safe[3]['final']}, peak=${best_safe[3]['peak']}, maxDD={best_safe[3]['max_dd']}%")


def main():
    symbols = sys.argv[1] if len(sys.argv) > 1 else "BOOM500"
    tick_count = int(sys.argv[2]) if len(sys.argv) > 2 else 20000

    # Single run mode
    if len(sys.argv) > 3:
        lookback = int(sys.argv[3])
        margin = float(sys.argv[4])
        duration = int(sys.argv[5]) if len(sys.argv) > 5 else 1
        prices = fetch_ticks(symbols, tick_count)
        single_run(symbols, prices, lookback, margin, duration)
        return

    prices = fetch_ticks(symbols, tick_count)

    # Scan
    lookbacks = [3, 4, 5, 6, 7, 8, 10]
    margins = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    durations = [1, 2, 3, 5]
    scan(symbols, prices, lookbacks, margins, durations)


if __name__ == "__main__":
    main()
