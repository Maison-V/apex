#!/usr/bin/env python3
"""
Backtest LDP prediction models on Deriv synthetic index historical ticks.

Fetches ticks via Deriv WebSocket API, runs all models, reports accuracy.

Usage:
    python backtest_ldp.py [symbol] [count]
    python backtest_ldp.py R_75 5000
    python backtest_ldp.py R_100 10000
    python backtest_ldp.py BOOM500 3000
"""

import sys
import json
import time
import statistics
import argparse
from collections import Counter, defaultdict

try:
    import websocket
except ImportError:
    print("Installing websocket-client...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websocket-client"])
    import websocket

DERIV_WS = "wss://ws.binaryws.com/websockets/v3?app_id=49941"
REQUEST_TIMEOUT = 30


# ─── Model Implementations (mirrors frontend ldpModels.js) ───

def last_digit(price):
    s = f"{abs(float(price)):.4f}"
    trimmed = "".join(c for c in s if c.isdigit())
    if not trimmed:
        return 0
    return int(trimmed[-1])


def digit_distribution(digits):
    dist = [0] * 10
    for d in digits:
        dist[d] += 1
    return dist


def frequency_model(digits):
    dist = digit_distribution(digits)
    total = sum(dist) or 1
    return [c / total for c in dist]


def build_transition_matrix(digits):
    m = [[0] * 10 for _ in range(10)]
    for i in range(1, len(digits)):
        m[digits[i - 1]][digits[i]] += 1
    return m


def markov_model(digits):
    if len(digits) < 2:
        return [0.1] * 10
    last = digits[-1]
    m = build_transition_matrix(digits)
    row = m[last]
    s = sum(row)
    if s == 0:
        return [0.1] * 10
    return [c / s for c in row]


def build_trigram_matrix(digits):
    m = {}
    for i in range(2, len(digits)):
        key = (digits[i - 2], digits[i - 1])
        if key not in m:
            m[key] = [0] * 10
        m[key][digits[i]] += 1
    return m


def trigram_model(digits):
    if len(digits) < 3:
        return [0.1] * 10
    last_two = (digits[-2], digits[-1])
    m = build_trigram_matrix(digits)
    row = m.get(last_two)
    if row is None:
        return [0.1] * 10
    s = sum(row)
    if s == 0:
        return [0.1] * 10
    return [c / s for c in row]


def gap_model(digits):
    probs = [0.0] * 10
    last_pos = {}
    for i, d in enumerate(digits):
        last_pos[d] = i
    if len(last_pos) < 10:
        return [0.1] * 10
    current = len(digits) - 1
    total_gap = 0
    gaps = []
    for d in range(10):
        gap = current - last_pos.get(d, 0)
        gaps.append(gap)
        total_gap += gap
    if total_gap == 0:
        return [0.1] * 10
    for d in range(10):
        probs[d] = gaps[d] / total_gap
    return probs


def odd_even_model(digits):
    if not digits:
        return {"odd": 0.5, "even": 0.5}
    odd = sum(1 for d in digits if d % 2 == 1)
    return {"odd": odd / len(digits), "even": 1 - (odd / len(digits))}


def high_low_model(digits):
    if not digits:
        return {"high": 0.5, "low": 0.5}
    high = sum(1 for d in digits if d >= 5)
    return {"high": high / len(digits), "low": 1 - (high / len(digits))}


def range_model(digits):
    ranges = [
        ("0-2", 0, 2),
        ("3-6", 3, 6),
        ("7-9", 7, 9),
    ]
    dist = digit_distribution(digits)
    total = sum(dist) or 1
    best_range, best_score = None, -1
    for name, lo, hi in ranges:
        score = sum(dist[lo:hi + 1]) / total
        if score > best_score:
            best_score = score
            best_range = (lo, hi)
    if best_range is None:
        return [0.1] * 10
    lo, hi = best_range
    probs = [0.0] * 10
    prob_per_digit = 1.0 / (hi - lo + 1)
    for d in range(lo, hi + 1):
        probs[d] = prob_per_digit * best_score
    return probs


def momentum_model(digits):
    if len(digits) < 5:
        return [0.1] * 10
    recent = digits[-5:]
    direction = recent[-1] - recent[0]
    probs = [0.02] * 10
    if abs(direction) <= 2:
        center = recent[-1]
        for d in range(max(0, center - 1), min(10, center + 2)):
            probs[d] = 0.15
    elif direction > 0:
        for d in range(5, 10):
            probs[d] = 0.12
        for d in range(5):
            probs[d] = 0.08
    else:
        for d in range(5):
            probs[d] = 0.12
        for d in range(5, 10):
            probs[d] = 0.08
    return probs


def ensemble_model(digits):
    models = [
        ("frequency", frequency_model(digits), 0.15),
        ("markov", markov_model(digits), 0.15),
        ("trigram", trigram_model(digits), 0.10),
        ("gap", gap_model(digits), 0.15),
        ("range", range_model(digits), 0.15),
        ("momentum", momentum_model(digits), 0.10),
    ]
    oe = odd_even_model(digits)
    hl = high_low_model(digits)

    probs = [0.0] * 10
    for name, p, w in models:
        for d in range(10):
            probs[d] += p[d] * w

    for d in range(10):
        probs[d] += (oe["odd"] if d % 2 == 1 else oe["even"]) * 0.10
        probs[d] += (hl["high"] if d >= 5 else hl["low"]) * 0.10

    return probs


def predict_digit(digits, model_fn):
    probs = model_fn(digits)
    predicted = probs.index(max(probs))
    confidence = max(probs) / sum(probs) if sum(probs) > 0 else 0
    return predicted, confidence, probs


def predict_odd_even(digits):
    oe = odd_even_model(digits)
    pred = "odd" if oe["odd"] > oe["even"] else "even"
    conf = max(oe["odd"], oe["even"])
    return pred, conf


def predict_high_low(digits):
    hl = high_low_model(digits)
    pred = "high" if hl["high"] > hl["low"] else "low"
    conf = max(hl["high"], hl["low"])
    return pred, conf


# ─── Backtest Runner ───

def backtest(digits, model_name, model_fn, windows):
    """
    Walk-forward backtest: for each tick (starting after window size),
    predict using previous `window` digits, compare to actual, track accuracy.
    Returns accuracy at each window size.
    """
    results = {}
    for w in windows:
        correct = 0
        total = 0
        for i in range(w, len(digits) - 1):
            window = digits[i - w: i]
            pred, conf, _ = predict_digit(window, model_fn)
            actual = digits[i]
            if pred == actual:
                correct += 1
            total += 1
        pct = (correct / total) * 100 if total > 0 else 0
        results[w] = {
            "correct": correct,
            "total": total,
            "accuracy_pct": round(pct, 2),
        }
    return results


def backtest_grouped(digits, windows):
    """Backtest odd/even and high/low predictions."""
    results = {}
    for w in windows:
        oe_correct = 0
        hl_correct = 0
        total = 0
        for i in range(w, len(digits) - 1):
            window = digits[i - w: i]
            oe_pred, _ = predict_odd_even(window)
            hl_pred, _ = predict_high_low(window)
            actual = digits[i]
            if (oe_pred == "odd" and actual % 2 == 1) or (oe_pred == "even" and actual % 2 == 0):
                oe_correct += 1
            if (hl_pred == "high" and actual >= 5) or (hl_pred == "low" and actual < 5):
                hl_correct += 1
            total += 1
        results[w] = {
            "odd_even_pct": round((oe_correct / total) * 100, 2) if total else 0,
            "high_low_pct": round((hl_correct / total) * 100, 2) if total else 0,
            "total": total,
        }
    return results


def backtest_with_confidence_filter(digits, model_fn, window, thresholds):
    """Test accuracy when only predicting on ticks above confidence threshold."""
    results = {}
    for thresh in thresholds:
        correct = 0
        total = 0
        skipped = 0
        for i in range(window, len(digits) - 1):
            w = digits[i - window: i]
            pred, conf, _ = predict_digit(w, model_fn)
            if conf < thresh:
                skipped += 1
                continue
            actual = digits[i]
            if pred == actual:
                correct += 1
            total += 1
        pct = (correct / total) * 100 if total > 0 else 0
        results[f"conf>={thresh:.2f}"] = {
            "correct": correct,
            "total": total,
            "skipped": skipped,
            "accuracy_pct": round(pct, 2),
            "pct_of_all": round(total / (len(digits) - window - 1) * 100, 1),
        }
    return results


# ─── Data Fetching ───

def fetch_ticks(symbol, count=5000):
    """Fetch historical ticks from Deriv via WebSocket."""
    print(f"  Connecting to Deriv WS, requesting {count} ticks for {symbol}...")
    prices = []
    error = [None]

    def on_message(ws, message):
        nonlocal prices
        data = json.loads(message)
        if "error" in data:
            error[0] = data["error"]["message"]
            ws.close()
            return
        if data.get("msg_type") == "history":
            if "history" in data and "prices" in data["history"]:
                prices = data["history"]["prices"]
            ws.close()

    def on_error(ws, err):
        error[0] = str(err)

    ws = websocket.WebSocketApp(
        DERIV_WS,
        on_message=on_message,
        on_error=on_error,
    )

    import threading
    t = threading.Thread(target=ws.run_forever, daemon=True)
    t.start()

    time.sleep(1)

    if error[0]:
        raise RuntimeError(f"WebSocket error: {error[0]}")

    ws.send(json.dumps({
        "ticks_history": symbol,
        "end": "latest",
        "count": count,
        "style": "ticks",
        "adjust_start_time": 1,
    }))

    deadline = time.time() + REQUEST_TIMEOUT
    while not prices and not error[0] and time.time() < deadline:
        time.sleep(0.1)

    if error[0]:
        raise RuntimeError(f"Deriv API error: {error[0]}")
    if not prices:
        raise RuntimeError("No data received (timeout)")

    print(f"  Received {len(prices)} ticks")
    return [last_digit(p) for p in prices]


# ─── Main ───

MODELS = {
    "frequency": frequency_model,
    "markov": markov_model,
    "trigram": trigram_model,
    "gap": gap_model,
    "range": range_model,
    "momentum": momentum_model,
    "ensemble": ensemble_model,
}

def main():
    parser = argparse.ArgumentParser(description="Backtest LDP prediction models on Deriv ticks")
    parser.add_argument("symbol", nargs="?", default="R_75", help="Symbol (R_75, R_100, BOOM500, CRASH500)")
    parser.add_argument("count", nargs="?", type=int, default=5000, help="Number of ticks to fetch")
    parser.add_argument("--no-fetch", action="store_true", help="Skip fetch, use cached digits.json")
    args = parser.parse_args()

    if args.no_fetch:
        print(f"Loading cached digits from digits.json...")
        with open("digits.json") as f:
            digits = json.load(f)
    else:
        print(f"\n{'='*60}")
        print(f"  LDP Backtest: {args.symbol} ({args.count} ticks)")
        print(f"{'='*60}\n")
        digits = fetch_ticks(args.symbol, args.count)
        with open("digits.json", "w") as f:
            json.dump(digits, f)
        print(f"  Saved to digits.json\n")

    print(f"  Total digits collected: {len(digits)}")
    dist = digit_distribution(digits)
    print(f"  Digit distribution: {dict(zip(range(10), dist))}")
    expected = len(digits) / 10
    chi_sq = sum((d - expected) ** 2 / expected for d in dist) if expected > 0 else 0
    print(f"  Chi-squared vs uniform: {chi_sq:.2f} (critical value for 9df @ 0.05 = 16.92)")
    if chi_sq < 16.92:
        print(f"  ✓ Distribution is consistent with uniform (p > 0.05)")
    else:
        print(f"  ⚠ Distribution differs from uniform (p < 0.05)")

    windows = [10, 25, 50, 100, 200, 500]

    # ── Run model backtests ──
    print(f"\n{'─'*60}")
    print(f"  MODEL ACCURACY COMPARISON")
    print(f"{'─'*60}")
    print(f"  {'Model':<15} {'Win=10':>8} {'Win=25':>8} {'Win=50':>8} {'Win=100':>9} {'Win=200':>9} {'Win=500':>9}")
    print(f"  {'─'*60}")

    all_results = {}
    for name, fn in MODELS.items():
        results = backtest(digits, name, fn, windows)
        all_results[name] = results
        row = f"  {name:<15}"
        for w in windows:
            row += f" {results[w]['accuracy_pct']:>7.2f}%"
        print(row)

    # ── Grouped predictions ──
    print(f"\n{'─'*60}")
    print(f"  GROUPED PREDICTIONS")
    print(f"{'─'*60}")
    grouped = backtest_grouped(digits, windows)
    print(f"  {'Measure':<15} {'Win=10':>8} {'Win=25':>8} {'Win=50':>8} {'Win=100':>9} {'Win=200':>9} {'Win=500':>9}")
    print(f"  {'─'*60}")
    for measure in ["odd_even_pct", "high_low_pct"]:
        label = "Odd/Even" if measure == "odd_even_pct" else "High/Low"
        row = f"  {label:<15}"
        for w in windows:
            row += f" {grouped[w][measure]:>7.2f}%"
        print(row)

    # ── Confidence filtering ──
    print(f"\n{'─'*60}")
    print(f"  CONFIDENCE THRESHOLD ANALYSIS (Ensemble, Window=100)")
    print(f"{'─'*60}")
    thresholds = [0.10, 0.12, 0.14, 0.16, 0.18, 0.20, 0.25, 0.30]
    filtered = backtest_with_confidence_filter(digits, ensemble_model, 100, thresholds)
    print(f"  {'Threshold':<12} {'Accuracy':>9} {'Predictions':>11} {'Skipped':>8} {'% of All':>9}")
    print(f"  {'─'*50}")
    for thresh, data in filtered.items():
        print(f"  {thresh:<12} {data['accuracy_pct']:>7.2f}%  {data['total']:>6}/{data['total']+data['skipped']:<4}  {data['skipped']:>6}  {data['pct_of_all']:>7.1f}%")

    # ── Best model recommendation ──
    print(f"\n{'─'*60}")
    print(f"  SUMMARY")
    print(f"{'─'*60}")
    # Find best model at window=100
    best_model = max(all_results, key=lambda n: all_results[n][100]["accuracy_pct"])
    best_acc = all_results[best_model][100]["accuracy_pct"]
    print(f"  Best digit model: {best_model} ({best_acc}% at window=100)")
    print(f"  Best odd/even:    {max(grouped[w]['odd_even_pct'] for w in windows)}%")
    print(f"  Best high/low:    {max(grouped[w]['high_low_pct'] for w in windows)}%")

    # Best confidence filter
    best_filter = max(filtered.values(), key=lambda x: x["accuracy_pct"])
    print(f"  Best filtered:    Thresh >= {thresholds[list(filtered.values()).index(best_filter)]:.2f} -> {best_filter['accuracy_pct']}% (on {best_filter['total']} predictions)")
    print()


if __name__ == "__main__":
    main()
