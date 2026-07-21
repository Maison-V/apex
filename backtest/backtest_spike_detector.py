#!/usr/bin/env python3
"""
Spike Detector Backtest — Boom500 & Crash500 Z-Score Strategy

Simulates a $10 account trading spike reversals (mean reversion) on
Deriv synthetic indices. Goal: flip the account ($10 → $20+).

Usage:
    python backtest_spike_detector.py BOOM500 10000
    python backtest_spike_detector.py CRASH500 10000
    python backtest_spike_detector.py both 5000
"""

import sys, json, time, math, statistics, threading, os
from collections import defaultdict

try:
    import websocket
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websocket-client"])
    import websocket

DERIV_WS = "wss://ws.binaryws.com/websockets/v3?app_id=49941"
REQUEST_TIMEOUT = 30

DEFAULT_PARAMS = {
    "lookback": 50,
    "z_threshold": 3.0,
    "exit_z": 0.5,
    "sl_mult": 2.0,
    "tp1_mult": 0.5,
    "tp2_mult": 1.0,
    "tp3_mult": 1.5,
    "max_hold_ticks": 20,
}


def fetch_ticks(symbol, count=5000):
    print(f"  Connecting to Deriv WS, requesting {count} ticks for {symbol}...")
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
    prices = [float(p) for p in prices]
    print(f"  Received {len(prices)} ticks")
    return prices


def compute_z_score(prices, lookback):
    recent = prices[-lookback:]
    mean = sum(recent) / lookback
    var = sum((p - mean) ** 2 for p in recent) / lookback
    std = math.sqrt(var) if var > 0 else 1e-10
    z = (prices[-1] - mean) / std
    return z, mean, std


def simulate_trade(prices, idx, direction, entry, sl, tp1, tp2, tp3, max_hold):
    for j in range(1, min(max_hold, len(prices) - idx - 1) + 1):
        p = prices[idx + j]
        if direction == "sell":
            if p >= sl: return "sl", sl, j
            if p <= tp1: return "tp1", tp1, j
            if p <= tp2: return "tp2", tp2, j
            if p <= tp3: return "tp3", tp3, j
        else:
            if p <= sl: return "sl", sl, j
            if p >= tp1: return "tp1", tp1, j
            if p >= tp2: return "tp2", tp2, j
            if p >= tp3: return "tp3", tp3, j
    return "expired", prices[idx + min(max_hold, len(prices) - idx - 1)], max_hold


def run_backtest(symbol, prices, params, initial_balance=10.0):
    p = params
    lookback = p["lookback"]
    z_thresh = p["z_threshold"]
    exit_z = p["exit_z"]
    sl_mult = p["sl_mult"]
    tp_mults = [p["tp1_mult"], p["tp2_mult"], p["tp3_mult"]]

    balance = initial_balance
    peak = initial_balance
    equity_history = [initial_balance]
    trades = []
    in_position = False
    entry_idx = None
    entry_price = None
    direction = None
    sl_price = None
    tp_prices = []
    z_history = []
    z_window = []

    spike_count = 0
    wins = 0
    losses = 0
    max_drawdown = 0.0
    total_fees = 0.0
    flipped = False
    flip_tick = None
    busted = False
    bust_tick = None

    for i in range(lookback, len(prices)):
        price = prices[i]

        recent = prices[i - lookback:i + 1]
        mean = sum(recent) / len(recent)
        var = sum((p - mean) ** 2 for p in recent) / len(recent)
        std = math.sqrt(var) if var > 0 else 1e-10
        z = (price - mean) / std
        z_history.append(z)
        z_window.append(z)
        if len(z_window) > 10: z_window.pop(0)

        if not in_position:
            is_boom = symbol == "BOOM500"
            is_crash = symbol == "CRASH500"

            spike = False
            if is_boom and z > z_thresh:
                spike = True
                bias = "spike-up"
            elif is_crash and z < -z_thresh:
                spike = True
                bias = "spike-down"

            if spike:
                spike_count += 1
                z_momentum = z_window[-1] - z_window[0] if len(z_window) >= 3 else 0
                mom_thresh = p.get("momentum_threshold", 0.5)

                if is_boom:
                    direction = "sell"
                else:
                    direction = "buy"

                entry_price = price
                entry_idx = i
                spike_size = std * z_thresh
                sl_price = entry_price + spike_size * sl_mult if direction == "sell" else entry_price - spike_size * sl_mult
                tp_prices = []
                for m in tp_mults:
                    tp = entry_price - spike_size * m if direction == "sell" else entry_price + spike_size * m
                    tp_prices.append(tp)

                in_position = True
        else:
            outcome, exit_price, hold = simulate_trade(
                prices, entry_idx, direction, entry_price,
                sl_price, tp_prices[0], tp_prices[1], tp_prices[2],
                p["max_hold_ticks"]
            )

            if outcome:
                if direction == "sell":
                    pnl = entry_price - exit_price
                else:
                    pnl = exit_price - entry_price

                fee = abs(pnl) * 0.001
                total_fees += fee
                pnl_net = pnl - fee
                balance += pnl_net
                if balance <= 0:
                    balance = 0
                    busted = True
                    bust_tick = i

                if balance > peak:
                    peak = balance
                dd = (peak - balance) / peak * 100
                if dd > max_drawdown: max_drawdown = dd

                win = pnl_net > 0
                if win: wins += 1
                else: losses += 1

                trades.append({
                    "idx": entry_idx, "exit_idx": i + hold,
                    "direction": direction, "entry": entry_price,
                    "exit": exit_price, "pnl": round(pnl_net, 2),
                    "outcome": outcome, "hold": hold,
                    "win": win, "balance": round(balance, 2),
                    "z_at_entry": round(z_history[-1], 2),
                })

                equity_history.append(balance)

                if balance >= initial_balance * 2 and not flipped:
                    flipped = True
                    flip_tick = i

                in_position = False
                entry_price = None
                direction = None
                sl_price = None
                tp_prices = []

                if busted:
                    break

    return {
        "trades": trades,
        "equity_history": equity_history,
        "spike_count": spike_count,
        "total_trades": len(trades),
        "wins": wins, "losses": losses,
        "balance": round(balance, 2),
        "peak": round(peak, 2),
        "max_drawdown_pct": round(max_drawdown, 2),
        "total_fees": round(total_fees, 2),
        "flipped": flipped,
        "flip_tick": flip_tick,
        "busted": busted,
        "bust_tick": bust_tick,
        "z_history": z_history,
    }


def print_results(symbol, res, ticks_count, initial_balance):
    trades = res["trades"]
    win_rate = res["wins"] / res["total_trades"] * 100 if res["total_trades"] else 0

    print(f"\n{'='*60}")
    print(f"  SPIKE DETECTOR BACKTEST — {symbol}")
    print(f"  {ticks_count} ticks analyzed")
    print(f"{'='*60}")

    print(f"\n  ── ACCOUNT ──")
    print(f"  Starting balance: ${initial_balance:.2f}")
    print(f"  Final balance:    ${res['balance']:.2f}")
    print(f"  Peak balance:     ${res['peak']:.2f}")
    print(f"  P&L:              ${res['balance'] - initial_balance:.2f} "
          f"({'✅ FLIPPED!' if res['flipped'] else '❌ Not flipped'})")
    print(f"  Max drawdown:     {res['max_drawdown_pct']:.1f}%")
    print(f"  Total fees:       ${res['total_fees']:.2f}")

    print(f"\n  ── TRADES ──")
    print(f"  Total trades:     {res['total_trades']}")
    print(f"  Wins:             {res['wins']}")
    print(f"  Losses:           {res['losses']}")
    print(f"  Win rate:         {win_rate:.1f}%")
    print(f"  Spikes detected:  {res['spike_count']}")
    print(f"  Signals used:     {res['total_trades']}/{res['spike_count']}")
    print(f"  Signal usage:     {res['total_trades']/res['spike_count']*100:.0f}%" if res['spike_count'] else "  N/A")

    if trades:
        avg_win = sum(t["pnl"] for t in trades if t["win"]) / res["wins"] if res["wins"] else 0
        avg_loss = sum(t["pnl"] for t in trades if not t["win"]) / res["losses"] if res["losses"] else 0
        print(f"\n  Avg win:          ${avg_win:.2f}")
        print(f"  Avg loss:         ${avg_loss:.2f}")
        if avg_loss != 0: print(f"  Profit factor:    {abs(avg_win / avg_loss):.2f}")
        print(f"  Avg hold (ticks): {sum(t['hold'] for t in trades)/len(trades):.0f}")

        is_boom = "BOOM" in symbol
        fades = [t for t in trades if (t["direction"] == "sell" and is_boom) or (t["direction"] == "buy" and not is_boom)]
        follows = [t for t in trades if (t["direction"] == "buy" and is_boom) or (t["direction"] == "sell" and not is_boom)]
        print(f"\n  ── DIRECTION BREAKDOWN ──")
        print(f"  Mean reversion (fade): {len(fades)} trades — "
              f"{sum(1 for t in fades if t['win'])/len(fades)*100:.0f}% win rate" if fades else "  No fade trades")
        print(f"  Momentum (follow):     {len(follows)} trades — "
              f"{sum(1 for t in follows if t['win'])/len(follows)*100:.0f}% win rate" if follows else "  No follow trades")

        print(f"\n  ── TOP 10 TRADES ──")
        print(f"  {'#':<4} {'Dir':<6} {'Entry':>10} {'Exit':>10} {'P&L':>8} {'Hold':>5} {'Outcome':<10}")
        print(f"  {'-'*55}")
        for idx, t in enumerate(trades[:10]):
            print(f"  {idx+1:<4} {t['direction']:<6} {t['entry']:>10.2f} {t['exit']:>10.2f} "
                  f"{t['pnl']:>7.2f} {t['hold']:>4} {t['outcome']:<10}")
        if len(trades) > 10:
            print(f"  ... ({len(trades) - 10} more)")

    if res["flipped"]:
        pct = res["flip_tick"] / ticks_count * 100
        print(f"\n  ★ ACCOUNT FLIPPED at tick {res['flip_tick']} ({pct:.0f}% through data)")
    if res["busted"]:
        pct = res["bust_tick"] / ticks_count * 100 if ticks_count else 0
        print(f"  💀 ACCOUNT BUSTED at tick {res['bust_tick']} ({pct:.0f}% through data)")


def scan_parameters(symbol, prices):
    print(f"\n{'='*60}")
    print(f"  PARAMETER SCAN — {symbol}")
    print(f"{'='*60}")

    best = {"profit": -999, "params": None, "res": None}
    lookbacks = [20, 30, 50]
    thresholds = [2.0, 2.5, 3.0]
    sl_mults = [1.5, 2.0, 2.5]
    mom_thresholds = [0.3, 0.5, 0.8]

    total_runs = len(lookbacks) * len(thresholds) * len(sl_mults) * len(mom_thresholds)
    run = 0

    for lb in lookbacks:
        for zt in thresholds:
            for slm in sl_mults:
                for mt in mom_thresholds:
                    run += 1
                    params = DEFAULT_PARAMS.copy()
                    params["lookback"] = lb
                    params["z_threshold"] = zt
                    params["sl_mult"] = slm
                    params["momentum_threshold"] = mt
                    res = run_backtest(symbol, prices, params, initial_balance=10.0)
                    profit = res["balance"] - 10.0

                    marker = " ◀" if profit > best["profit"] else ""
                    print(f"  [{run}/{total_runs}] lb={lb:2d} zt={zt:.1f} sl={slm:.1f} mt={mt:.1f}  "
                          f"balance=${res['balance']:>6.2f}  profit=${profit:>+6.2f}  "
                          f"trades={res['total_trades']:2d}  wr={res['wins']/(res['total_trades'] or 1)*100:>5.1f}%"
                          f"{' ★ FLIP' if res['flipped'] else ''}{marker}")

                if profit > best["profit"]:
                    best["profit"] = profit
                    best["params"] = params
                    best["res"] = res

    return best


def run_until_flip(symbol, params, initial_balance=10.0, max_batches=10):
    """Fetch data in batches until account flips or max_batches reached."""
    balance = initial_balance
    all_trades = []
    batch_num = 0

    print(f"\n  {'='*50}")
    print(f"  FLIP SIMULATION — {symbol}")
    print(f"  Target: ${initial_balance*2:.2f} (${initial_balance:.2f} → ${initial_balance*2:.2f})")
    print(f"  {'='*50}")

    while balance < initial_balance * 2 and balance > 0 and batch_num < max_batches:
        batch_num += 1
        print(f"\n  Batch {batch_num}/{max_batches} — fetching {5000} ticks...")
        prices = fetch_ticks(symbol, 5000)

        if "prices_prev" in dir():
            prices = prices_prev + prices
        else:
            prices_prev = []

        res = run_backtest(symbol, prices, params, initial_balance=balance)
        balance = res["balance"]
        all_trades.extend(res["trades"])

        # Carry over last N prices for continuity
        prices_prev = prices[-params["lookback"]:] if len(prices) >= params["lookback"] else prices

        wr = res["wins"] / max(res["total_trades"], 1) * 100
        print(f"    → Balance: ${balance:.2f}  |  Batch trades: {res['total_trades']}  "
              f"wr: {wr:.0f}%  |  Total trades: {len(all_trades)}")

        if res["flipped"]:
            print(f"\n  ★★★ FLIPPED! ${initial_balance:.2f} → ${balance:.2f} ★★★")
            return balance, all_trades, batch_num
        if res["busted"]:
            print(f"\n  💀 BUSTED at ${balance:.2f}")
            return balance, all_trades, batch_num

    if balance >= initial_balance * 2:
        print(f"\n  ★★★ FLIPPED! ${initial_balance:.2f} → ${balance:.2f} ★★★")
    elif balance <= 0:
        print(f"\n  💀 BUSTED")
    else:
        print(f"\n  Stopped after {max_batches} batches. Balance: ${balance:.2f}")

    return balance, all_trades, batch_num


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Spike Detector Backtest")
    parser.add_argument("symbol", nargs="?", default="BOOM500",
                        help="BOOM500, CRASH500, or both")
    parser.add_argument("count", nargs="?", type=int, default=5000,
                        help="Ticks per symbol")
    parser.add_argument("--scan", action="store_true",
                        help="Run parameter scan")
    parser.add_argument("--flip", action="store_true",
                        help="Run flip simulation (auto-fetch until flipped/busted)")
    parser.add_argument("--max-batches", type=int, default=10,
                        help="Max batches for flip simulation")
    args = parser.parse_args()

    symbols = []
    if args.symbol.lower() == "both":
        symbols = ["BOOM500", "CRASH500"]
    elif args.symbol.lower() in ("boom", "boom500"):
        symbols = ["BOOM500"]
    elif args.symbol.lower() in ("crash", "crash500"):
        symbols = ["CRASH500"]
    else:
        symbols = [args.symbol.upper()]

    all_results = {}

    if args.flip:
        for sym in symbols:
            final_balance, trades, batches = run_until_flip(sym, DEFAULT_PARAMS, 10.0, args.max_batches)
            all_results[sym] = {"balance": final_balance, "trades": len(trades), "batches": batches}
        return

    if "both" in args.symbol.lower() or len(symbols) > 1:
        for sym in symbols:
            print(f"\n{'#'*60}")
            print(f"  FETCHING {sym} — {args.count} ticks")
            print(f"{'#'*60}")
            prices = fetch_ticks(sym, args.count)

            if args.scan:
                best = scan_parameters(sym, prices)
                print(f"\n  ★ BEST: {best['params']}")
                print(f"     Profit: ${best['profit']:.2f}")
                print(f"     Balance: ${best['res']['balance']:.2f}")
                print(f"     Trades:  {best['res']['total_trades']}")
                res = best["res"]
            else:
                res = run_backtest(sym, prices, DEFAULT_PARAMS, initial_balance=10.0)

            print_results(sym, res, len(prices), 10.0)
            all_results[sym] = {"result": res, "ticks": len(prices)}

            if res["flipped"]:
                print(f"\n  ★★★ {sym} CAN FLIP $10 ACCOUNT! ★★★")
            else:
                print(f"\n  {sym} did not flip $10 account with default params.")

    if not args.scan and "both" not in args.symbol.lower() and len(symbols) == 1:
        print(f"\n{'='*60}")
        print(f"  SUMMARY")
        print(f"{'='*60}")
        for sym, data in all_results.items():
            r = data["result"]
            wr = r["wins"] / r["total_trades"] * 100 if r["total_trades"] else 0
            status = "✅ FLIPPED" if r["flipped"] else "❌ NOT FLIPPED" if r["busted"] else "⏸️  SURVIVED"
            print(f"  {sym:<10}  ${r['balance']:>7.2f}  wr={wr:>5.1f}%  "
                  f"trades={r['total_trades']:>3d}  dd={r['max_drawdown_pct']:>5.1f}%  {status}")


if __name__ == "__main__":
    main()
