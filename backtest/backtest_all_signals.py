#!/usr/bin/env python3
"""
Comprehensive signal backtest on Deriv synthetic indices.

Each signal is self-contained — compares its prediction to actual outcome
and reports: accuracy, signals-per-minute, confidence profile.

Usage:  python backtest_all_signals.py [R_75|R_100|BOOM500|CRASH500] [count]
"""

import sys, json, time, statistics, math, threading
from collections import Counter, defaultdict

try:
    import websocket
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websocket-client"])
    import websocket

DERIV_WS = "wss://ws.binaryws.com/websockets/v3?app_id=49941"
REQUEST_TIMEOUT = 30

def last_digit(price):
    s = f"{abs(float(price)):.4f}"
    trimmed = "".join(c for c in s if c.isdigit())
    return int(trimmed[-1]) if trimmed else 0

def fetch_ticks(symbol, count=5000):
    print(f"  Connecting to Deriv WS, requesting {count} ticks for {symbol}...")
    prices = []; error = [None]; sent = [False]
    def on_open(ws):
        ws.send(json.dumps({"ticks_history": symbol, "end": "latest", "count": count,
                             "style": "ticks", "adjust_start_time": 1}))
        sent[0] = True
    def on_msg(ws, msg):
        data = json.loads(msg)
        if "error" in data:
            error[0] = data["error"]["message"]; ws.close(); return
        if data.get("msg_type") == "history" and "history" in data:
            prices.extend(data["history"]["prices"]); ws.close()
    def on_err(ws, err): error[0] = str(err)
    ws = websocket.WebSocketApp(DERIV_WS, on_open=on_open, on_message=on_msg, on_error=on_err)
    t = threading.Thread(target=ws.run_forever, daemon=True); t.start()
    deadline = time.time() + REQUEST_TIMEOUT
    while not prices and not error[0] and time.time() < deadline: time.sleep(0.1)
    if error[0]: raise RuntimeError(f"WS: {error[0]}")
    if not prices: raise RuntimeError("No data received (timeout)")
    print(f"  Received {len(prices)} ticks")
    return [float(p) for p in prices]


# ─── FEATURE EXTRACTOR ───

class TickFeatures:
    """Pre-computed features for easy access by signals."""
    def __init__(self, prices):
        self.prices = prices
        self.digits = [last_digit(p) for p in prices]
        self.steps = [prices[i] - prices[i-1] for i in range(1, len(prices))]
        self.abs_steps = [abs(s) for s in self.steps]
        self.dirs = ["up" if s > 0 else "down" if s < 0 else "flat" for s in self.steps]
        self.median_abs = statistics.median(self.abs_steps) if self.abs_steps else 1.0
        self.mean_abs = statistics.mean(self.abs_steps) if self.abs_steps else 1.0


# ─── SIGNAL: Step Size Persistence (volatility clustering) ───

def test_step_size(f, window, step_dir):
    """Predict if next step > median by checking if recent steps are biased large/small."""
    median_abs = f.median_abs
    if len(f.abs_steps) < window + 1: return 0, 0, 0
    correct = total = skipped = 0
    for i in range(window, len(f.steps)):
        recent = f.abs_steps[i-window:i]
        frac_large = sum(1 for a in recent if a > median_abs) / window
        bias = abs(frac_large - 0.5)
        if bias < step_dir:  # skip when not directional enough
            skipped += 1; continue
        pred = "large" if frac_large > 0.5 else "small"
        actual = f.abs_steps[i]
        outcome = "large" if actual > median_abs else "small"
        if pred == outcome: correct += 1
        total += 1
    return correct, total, skipped


# ─── SIGNAL: Parity Momentum (odd/even persistence) ───

def test_parity_momentum(f, window, min_bias):
    """Predict odd/even based on recent parity imbalance."""
    if len(f.digits) < window + 1: return 0, 0, 0
    correct = total = skipped = 0
    for i in range(window, len(f.digits)):
        parity = [d % 2 for d in f.digits[i-window:i]]
        frac_odd = sum(parity) / window
        bias = abs(frac_odd - 0.5)
        if bias < min_bias: skipped += 1; continue
        pred = "odd" if frac_odd > 0.5 else "even"
        actual = "odd" if f.digits[i] % 2 == 1 else "even"
        if pred == actual: correct += 1
        total += 1
    return correct, total, skipped


# ─── SIGNAL: Direction Momentum ───

def test_direction_momentum(f, window, min_bias):
    """Predict up/down based on recent direction bias."""
    if len(f.dirs) < window + 1: return 0, 0, 0
    correct = total = skipped = 0
    for i in range(window, len(f.dirs)):
        win = f.dirs[i-window:i]
        ups = sum(1 for d in win if d == "up")
        downs = sum(1 for d in win if d == "down")
        n = ups + downs
        if n == 0: skipped += 1; continue
        frac = ups / n
        bias = abs(frac - 0.5)
        if bias < min_bias: skipped += 1; continue
        pred = "up" if frac > 0.5 else "down"
        if pred == f.dirs[i]: correct += 1
        total += 1
    return correct, total, skipped


# ─── SIGNAL: Direction Reversal (after streaks) ───

def test_direction_reversal(f, min_streak):
    """Predict reversal after consecutive same-direction ticks."""
    if len(f.dirs) < min_streak + 1: return 0, 0, 0
    correct = total = skipped = 0
    for i in range(1, len(f.dirs) - 1):
        streak = 1
        for j in range(i-1, 0, -1):
            if f.dirs[j] == f.dirs[i]: streak += 1
            else: break
        if streak < min_streak: skipped += 1; continue
        pred = "down" if f.dirs[i] == "up" else "up"
        if pred == f.dirs[i+1]: correct += 1
        total += 1
    return correct, total, skipped


# ─── SIGNAL: Digit 0-9 Momentum ───

def test_digit_momentum(f, window):
    """Predict exact digit using momentum model."""
    if len(f.digits) < window + 1: return 0, 0, 0
    correct = total = skipped = 0
    for i in range(window, len(f.digits)):
        recent = f.digits[i-window:i]
        recent5 = recent[-5:] if len(recent) >= 5 else recent
        direction = recent5[-1] - recent5[0]
        probs = [0.02]*10
        if abs(direction) <= 2:
            center = recent5[-1]
            for d in range(max(0, center-1), min(10, center+2)): probs[d] = 0.15
        elif direction > 0:
            for d in range(5, 10): probs[d] = 0.12
            for d in range(5): probs[d] = 0.08
        else:
            for d in range(5): probs[d] = 0.12
            for d in range(5, 10): probs[d] = 0.08
        pred = probs.index(max(probs))
        if pred == f.digits[i]: correct += 1
        total += 1
    return correct, total, skipped


# ─── SIGNAL: Digit Delta (|digit[i] - digit[i-1]|) ───

def test_digit_delta(f, window):
    """Predict if |digit_delta| is 'small' (0-4) or 'large' (5-9)."""
    if len(f.digits) < window + 1: return 0, 0, 0
    correct = total = skipped = 0
    for i in range(window, len(f.digits)):
        deltas = [abs(f.digits[j] - f.digits[j-1]) for j in range(i-window+1, i)]
        if not deltas: skipped += 1; continue
        small_rate = sum(1 for d in deltas if d <= 4) / len(deltas)
        expected = 0.70
        bias = abs(small_rate - expected)
        if bias < 0.03: skipped += 1; continue
        pred = "small" if small_rate > expected else "large"
        actual_delta = abs(f.digits[i] - f.digits[i-1])
        outcome = "small" if actual_delta <= 4 else "large"
        if pred == outcome: correct += 1
        total += 1
    return correct, total, skipped


# ─── SIGNAL: Digit Repeat ───

def test_digit_repeat(f, window):
    """Predict if next digit repeats the last one."""
    if len(f.digits) < window + 1: return 0, 0, 0
    correct = total = skipped = 0
    for i in range(window, len(f.digits)):
        repeats = sum(1 for j in range(i-window+1, i) if f.digits[j] == f.digits[j-1])
        repeat_rate = repeats / (window - 1) if window > 1 else 0.1
        bias = abs(repeat_rate - 0.1)
        if bias < 0.02: skipped += 1; continue
        pred = True if repeat_rate > 0.1 else False
        actual = f.digits[i] == f.digits[i-1]
        if pred == actual: correct += 1
        total += 1
    return correct, total, skipped


# ─── SIGNAL: High/Low (0-4 vs 5-9) persistence ───

def test_highlow_momentum(f, window, min_bias):
    """Predict if next digit is 0-4 (low) or 5-9 (high) based on recent bias."""
    if len(f.digits) < window + 1: return 0, 0, 0
    correct = total = skipped = 0
    for i in range(window, len(f.digits)):
        win = f.digits[i-window:i]
        frac_high = sum(1 for d in win if d >= 5) / window
        bias = abs(frac_high - 0.5)
        if bias < min_bias: skipped += 1; continue
        pred = "high" if frac_high > 0.5 else "low"
        actual = "high" if f.digits[i] >= 5 else "low"
        if pred == actual: correct += 1
        total += 1
    return correct, total, skipped


# ─── SIGNAL: Gap Analysis (overdue digit) ───

def test_gap_prediction(f, window):
    """Predict the digit that has gone longest without appearing."""
    if len(f.digits) < window + 1: return 0, 0, 0
    correct = total = skipped = 0
    for i in range(window, len(f.digits)):
        win = f.digits[i-window:i]
        last_pos = {}
        for j, d in enumerate(win): last_pos[d] = j
        if len(last_pos) < 10: skipped += 1; continue
        max_gap = -1; pred = 0
        for d in range(10):
            gap = (window - 1) - last_pos.get(d, 0)
            if gap > max_gap: max_gap = gap; pred = d
        if pred == f.digits[i]: correct += 1
        total += 1
    return correct, total, skipped


# ─── RUNNER ───

TESTS = [
    ("digit_momentum",    "Exact digit (momentum model)",        test_digit_momentum,    [10, 25, 50], {}),
    ("parity_momentum",   "Odd/Even momentum",                   test_parity_momentum,   [10, 25, 50], {"min_bias": 0.10}),
    ("highlow_momentum",  "High/Low (0-4 vs 5-9) momentum",     test_highlow_momentum,  [10, 25, 50], {"min_bias": 0.10}),
    ("direction_momentum","Up/Down direction momentum",          test_direction_momentum,[10, 25, 50], {"min_bias": 0.10}),
    ("direction_reversal","Direction reversal after streak",     test_direction_reversal,[],           {"min_streak": 3}),
    ("step_size",         "Step > median volatility clustering", test_step_size,         [10, 25, 50], {"step_dir": 0.15}),
    ("digit_delta",       "|digit_delta| small (0-4) vs large",  test_digit_delta,       [10, 25, 50], {}),
    ("digit_repeat",      "Digit repeats last",                  test_digit_repeat,      [10, 25, 50], {}),
    ("gap_prediction",    "Most overdue digit (gap analysis)",   test_gap_prediction,    [10, 25, 50], {}),
]


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("symbol", nargs="?", default="R_75")
    parser.add_argument("count", nargs="?", type=int, default=10000)
    parser.add_argument("--no-fetch", action="store_true")
    args = parser.parse_args()

    if args.no_fetch:
        print("Loading cached prices.json...")
        with open("prices.json") as f: prices = json.load(f)
    else:
        print(f"\n{'='*65}")
        print(f"  Signal Backtest: {args.symbol} ({args.count} ticks)")
        print(f"{'='*65}\n")
        prices = fetch_ticks(args.symbol, args.count)
        with open("prices.json", "w") as f: json.dump(prices, f)

    f = TickFeatures(prices)
    ticks_per_min = len(f.prices) / 30  # R_75 ≈ 2s tick, 30/min
    print(f"\n  Ticks: {len(f.prices)}, Steps: {len(f.steps)}")
    print(f"  Median step: {f.median_abs:.2f}, Mean step: {f.mean_abs:.2f}")
    print(f"  Digit dist: {dict(sorted(Counter(f.digits).items()))}")
    print(f"  Est. ticks/min: ~{30}\n")

    print(f"{'='*65}")
    print(f"  RESULTS")
    print(f"{'='*65}")

    all_best = []

    for idx, (name, desc, fn, windows, params) in enumerate(TESTS):
        windows_to_use = windows if windows else [0]
        best_acc = -1; best = {}

        print(f"\n  [{idx}] ── {name} ── {desc}")

        for w in windows_to_use:
            if windows and (w == 0 or w > len(f.digits) // 2):
                continue
            try:
                if windows:
                    result = fn(f, w, **params)
                else:
                    result = fn(f, **params)
            except Exception as e:
                print(f"    w={w:3d}  ERROR: {name}: {e}")
                continue
            if result is None:
                continue
            correct, total, skipped = result
            if total == 0:
                continue
            acc = correct / total * 100
            spm = total / (len(f.digits) / 30)
            w_label = f"w={w:3d}" if windows else "n/a"
            marker = " ◀" if acc > best_acc else ""
            print(f"    {w_label}  acc={acc:>5.1f}%  {correct:>5d}/{total:<5d}  "
                  f"skip={skipped:>5d}  spm={spm:>4.1f}{marker}")
            if acc > best_acc:
                best_acc = acc
                best = {"name": name, "window": w if windows else 0, "acc": round(acc, 1),
                        "correct": correct, "total": total, "skipped": skipped,
                        "spm": round(spm, 1)}

        if best:
            if best["acc"] > 50:
                print(f"    ★ {best['name']} w={best['window']}  {best['acc']}%  "
                      f"({best['correct']}/{best['total']})  spm={best['spm']}")
            all_best.append(best)

    print(f"\n{'='*65}")
    print(f"  SIGNALS WITH EDGE (>50%)")
    print(f"{'='*65}")
    winners = sorted([b for b in all_best if b["acc"] > 50], key=lambda x: -x["acc"])
    if winners:
        for b in winners:
            q = "★" if b["acc"] > 60 else "·"
            print(f"  {q} {b['name']:<25s}  {b['acc']:>5.1f}%  "
                  f"w={b['window']} t={b['total']} spm={b['spm']}")
    else:
        print("  No signal > 50% found. (Pure CSPRNG confirmed.)")

    # Signals/min analyis: show which signals give >= 1/min
    print(f"\n{'─'*65}")
    print(f"  SIGNALS WITH ≥1 PROFITABLE SIGNAL PER MINUTE")
    print(f"{'─'*65}")
    viable = [b for b in winners if b["spm"] >= 1 and b["acc"] > 50]
    if viable:
        for b in sorted(viable, key=lambda x: -x["acc"]):
            print(f"  ✓ {b['name']:<25s}  acc={b['acc']:>5.1f}%  "
                  f"{b['spm']:>4.1f} sig/min  window={b['window']}")
    else:
        print("  None. Try on BOOM500/CRASH500 (mean-reverting).")
    print()

    # Direction momentum breakdown with thresholds
    if args.symbol in ("BOOM500", "CRASH500"):
        print(f"\n  Direction breakdown for {args.symbol}:")
        for min_bias in [0, 0.1, 0.2, 0.3]:
            c, t, s = test_direction_momentum(f, 20, min_bias)
            if t > 0:
                print(f"    min_bias={min_bias:.1f}: {c/t*100:.1f}%  ({c}/{t})  skip={s}  spm={t/ (len(f.digits)/30):.1f}")


if __name__ == "__main__":
    main()
