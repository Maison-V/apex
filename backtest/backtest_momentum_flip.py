#!/usr/bin/env python3
"""
Momentum Flip Backtest

Strategy: $10 deposit, 80% margin per trade, direction = last 5 ticks all same
direction (momentum), hold 1 tick, Deriv Rise/Fall (92% payout).

Usage:
    python backtest/momentum_flip.py          # default: BOOM500, 20000 ticks
    python backtest/momentum_flip.py BOOM500 10000
    python backtest/momentum_flip.py R_75 5000
    python backtest/momentum_flip.py CRASH500 10000
    python backtest/momentum_flip.py all 5000  # run on all vol indices
"""

import sys, json, math, time, threading, os

try:
    import websocket
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websocket-client"])
    import websocket

DERIV_WS = "wss://ws.binaryws.com/websockets/v3?app_id=49941"
REQUEST_TIMEOUT = 30

PAYOUT = 0.92
MOMENTUM_LOOKBACK = 5
INITIAL_BALANCE = 10.0
MARGIN_RATIO = 0.80
MIN_STAKE = 0.50
MIN_TICKS_NEEDED = MOMENTUM_LOOKBACK + 2


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


def compute_momentum(prices, lookback):
    if len(prices) < lookback + 1:
        return None
    chunk = prices[-(lookback + 1):]
    rises = all(chunk[i] <= chunk[i + 1] for i in range(lookback))
    falls = all(chunk[i] >= chunk[i + 1] for i in range(lookback))
    if rises:
        return "CALL"
    if falls:
        return "PUT"
    return None


def run_backtest(symbol, prices):
    balance = INITIAL_BALANCE
    peak = INITIAL_BALANCE
    equity = [INITIAL_BALANCE]
    trades = []
    wins = 0
    losses = 0
    overflow = False

    for i in range(MIN_TICKS_NEEDED, len(prices) - 1):
        context = prices[:i + 1]
        direction = compute_momentum(context, MOMENTUM_LOOKBACK)
        if direction is None:
            continue

        stake = balance * MARGIN_RATIO
        if stake < MIN_STAKE:
            break

        if stake > 1e12:
            overflow = True
            break

        entry = prices[i]
        exit_price = prices[i + 1]

        if direction == "CALL":
            won = exit_price >= entry
        else:
            won = exit_price <= entry

        if won:
            profit = stake * PAYOUT
            balance = balance + profit
            wins += 1
        else:
            balance = balance - stake
            losses += 1

        peak = max(peak, balance)
        equity.append(balance)

        trades.append({
            "i": i, "direction": direction,
            "entry": round(entry, 2), "exit": round(exit_price, 2),
            "stake": round(stake, 2), "profit": round(profit if won else -stake, 2),
            "won": won, "balance": round(balance, 2),
        })

        if balance <= 0:
            break

    return {
        "symbol": symbol,
        "ticks": len(prices),
        "trades": len(trades),
        "wins": wins,
        "losses": losses,
        "win_rate": round(wins / max(wins + losses, 1) * 100, 2) if wins + losses > 0 else 0,
        "final_balance": balance if not overflow else None,
        "peak": peak if not overflow else None,
        "return_pct": None if overflow else round((balance - INITIAL_BALANCE) / INITIAL_BALANCE * 100, 2),
        "flipped": balance >= INITIAL_BALANCE * 2 if not overflow else True,
        "busted": balance <= 0 if not overflow else False,
        "overflow": overflow,
        "overflow_at_trade": len(trades) if overflow else None,
        "equity": equity,
        "trades_detail": trades[-20:] if trades else [],
    }


def main():
    symbols_to_test = []
    if len(sys.argv) > 1 and sys.argv[1] == "all":
        symbols_to_test = [
            "R_10", "R_25", "R_50", "R_75", "R_100",
            "R_10_1S", "R_25_1S", "R_50_1S", "R_75_1S", "R_100_1S",
            "BOOM300", "BOOM500", "BOOM1000",
            "BOOM300_1S", "BOOM500_1S", "BOOM1000_1S",
            "CRASH300", "CRASH500", "CRASH1000",
            "CRASH300_1S", "CRASH500_1S", "CRASH1000_1S",
        ]
        tick_count = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
    else:
        symbol = sys.argv[1] if len(sys.argv) > 1 else "BOOM500"
        tick_count = int(sys.argv[2]) if len(sys.argv) > 2 else 20000
        symbols_to_test = [symbol]

    results = []
    for sym in symbols_to_test:
        print(f"\n{'='*60}")
        print(f"  {sym} — ${INITIAL_BALANCE} start, {MARGIN_RATIO*100:.0f}% margin, momentum({MOMENTUM_LOOKBACK}), 1-tick hold")
        print(f"{'='*60}")
        try:
            prices = fetch_ticks(sym, tick_count)
            result = run_backtest(sym, prices)
            results.append(result)
            _print_result(result)
        except Exception as e:
            print(f"  ERROR: {e}")
            results.append({"symbol": sym, "error": str(e)})

    if len(results) > 1:
        print(f"\n{'='*60}")
        print(f"  SUMMARY — All Symbols")
        print(f"{'='*60}")
        for r in results:
            if "error" in r:
                print(f"  {r['symbol']:20s} ❌ {r['error']}")
            else:
                flag = "✅ FLIPPED" if r["flipped"] else ("💥 BUST" if r["busted"] else "")
                print(f"  {r['symbol']:20s} ${r['final_balance']:<8.2f}  {r['trades']:4d} trades  {r['win_rate']:5.1f}% WR  {flag}")


def _print_result(r):
    dd = r.get("max_drawdown_pct", 0)
    flag = ""
    if r["flipped"]: flag = " ✅ ACCOUNT FLIPPED!"
    if r["busted"]: flag = " 💥 BUST"
    print(f"  Trades:    {r['trades']}")
    print(f"  Wins:      {r['wins']} / Losses: {r['losses']}")
    print(f"  Win Rate:  {r['win_rate']}%")
    print(f"  Final:     ${r['final_balance']:.2f}{flag}")
    print(f"  Peak:      ${r['peak']:.2f}")
    print(f"  Return:    {r['return_pct']}%")
    if r["trades_detail"]:
        print(f"  Last {len(r['trades_detail'])} trades:")
        for t in r["trades_detail"]:
            w = "W" if t["won"] else "L"
            print(f"    #{t['i']:5d} {t['direction']:4s} entry={t['entry']:>8.2f} exit={t['exit']:>8.2f} "
                  f"stake=${t['stake']:<5.2f} pnl=${t['profit']:<+6.2f} bal=${t['balance']:<7.2f} [{w}]")


if __name__ == "__main__":
    main()
