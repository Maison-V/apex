#!/usr/bin/env python3
"""Phase 3+4: ML training and trade backtesting on digit data from Deriv synthetic indices."""

import argparse
import json
import math
import os
import sys
import warnings
from collections import Counter, defaultdict
from copy import deepcopy

import h5py
import joblib
import numpy as np
import pandas as pd
from scipy import stats as sp_stats
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
)
from sklearn.model_selection import TimeSeriesSplit
from sklearn.preprocessing import StandardScaler
from tqdm import tqdm, trange
import xgboost as xgb

warnings.filterwarnings("ignore")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORED_DIR = os.path.join(BASE_DIR, "stored")

PAYOUT_MATCH = 0.92
PAYOUT_DIFFERS = 0.92
INITIAL_CAPITAL = 1000.0
BET_SIZE = 10.0
RISK_PER_TRADE = 0.02
WILSON_Z = 1.96
MONTE_CARLO_RUNS = 1000

RANDOM_SEED = 42
np.random.seed(RANDOM_SEED)


# =========================================================================
# DATA LOADING
# =========================================================================

def load_h5_data(symbol, max_samples=None):
    filepath = os.path.join(STORED_DIR, f"ticks_{symbol}.h5")
    if not os.path.exists(filepath):
        return None, None, None
    with h5py.File(filepath, "r") as f:
        prices = f["prices"][:]
        digits = f["digits"][:]
        timestamps = f["timestamps"][:]
    if max_samples is not None and len(digits) > max_samples:
        prices = prices[-max_samples:]
        digits = digits[-max_samples:]
        timestamps = timestamps[-max_samples:]
    return prices, digits, timestamps


# =========================================================================
# FEATURE ENGINEERING
# =========================================================================

def transition_matrix_from_window(win):
    m = np.zeros((10, 10), dtype=np.float64)
    for j in range(1, len(win)):
        m[win[j - 1], win[j]] += 1.0
    return m


def trigram_counts_from_window(win):
    tc = defaultdict(lambda: np.zeros(10, dtype=np.float64))
    for j in range(2, len(win)):
        key = (int(win[j - 2]), int(win[j - 1]))
        tc[key][int(win[j])] += 1.0
    return tc


def extract_features_single(digits_win, last_step=None, steps_win=None,
                            median_abs_step=None, window=50):
    f = {}
    w = len(digits_win)
    dw = digits_win

    for j in range(w):
        f[f"raw_{j}"] = int(dw[j])

    for ws in [10, 25, 50]:
        sub = dw[-ws:] if ws <= w else dw
        total = len(sub)
        for d in range(10):
            f[f"freq_{ws}_{d}"] = float(np.sum(sub == d) / total)

    last_d = int(dw[-1])
    tm = transition_matrix_from_window(dw)
    row = tm[last_d]
    row_sum = row.sum()
    for d in range(10):
        f[f"trans_{d}"] = float(row[d] / row_sum) if row_sum > 0 else 0.1

    if w >= 3:
        last_two = (int(dw[-2]), int(dw[-1]))
        tc = trigram_counts_from_window(dw)
        tri_row = tc.get(last_two, np.ones(10, dtype=np.float64))
        tri_sum = tri_row.sum()
        for d in range(10):
            f[f"trigram_{d}"] = float(tri_row[d] / tri_sum) if tri_sum > 0 else 0.1
    else:
        for d in range(10):
            f[f"trigram_{d}"] = 0.1

    for d in range(10):
        gap = w
        for j in range(w - 1, -1, -1):
            if int(dw[j]) == d:
                gap = (w - 1) - j
                break
        f[f"gap_{d}"] = gap

    for ws in [10, 25, 50]:
        sub = dw[-ws:] if ws <= w else dw
        n_odd = float(np.sum(sub % 2 == 1))
        n_total = float(len(sub))
        f[f"odd_{ws}"] = n_odd / n_total
        f[f"even_{ws}"] = 1.0 - n_odd / n_total

    for ws in [10, 25, 50]:
        sub = dw[-ws:] if ws <= w else dw
        n_high = float(np.sum(sub >= 5))
        n_total = float(len(sub))
        f[f"high_{ws}"] = n_high / n_total
        f[f"low_{ws}"] = 1.0 - n_high / n_total

    last_val = int(dw[-1])
    streak = 1
    for j in range(w - 2, -1, -1):
        if int(dw[j]) == last_val:
            streak += 1
        else:
            break
    f["digit_streak"] = streak

    last_parity = int(dw[-1] % 2)
    parity_streak = 1
    for j in range(w - 2, -1, -1):
        if int(dw[j] % 2) == last_parity:
            parity_streak += 1
        else:
            break
    f["parity_streak"] = parity_streak

    if last_step is not None:
        f["last_step"] = float(last_step)
        f["last_step_abs"] = float(abs(last_step))
        f["last_step_dir"] = 1.0 if last_step > 0 else (-1.0 if last_step < 0 else 0.0)

    if steps_win is not None:
        for n in [5, 10]:
            if len(steps_win) >= n:
                recent = steps_win[-n:]
                f[f"avg_step_{n}"] = float(np.mean(np.abs(recent)))
            else:
                f[f"avg_step_{n}"] = 0.0

        if median_abs_step is not None and len(steps_win) >= 1:
            f["step_above_median"] = 1.0 if abs(steps_win[-1]) > median_abs_step else 0.0
        else:
            f["step_above_median"] = 0.0

        for n in [5, 10]:
            if len(steps_win) >= n:
                recent = steps_win[-n:]
                f[f"up_pct_{n}"] = float(np.mean(recent > 0))
            else:
                f[f"up_pct_{n}"] = 0.5

    expected = w / 10.0
    obs_counts = np.array([float(np.sum(dw == d)) for d in range(10)])

    chi_sq = float(np.sum((obs_counts - expected) ** 2 / expected)) if expected > 0 else 0.0
    f["chi_sq"] = chi_sq

    probs = obs_counts / w
    entropy = float(-np.sum([p * math.log(p) if p > 0 else 0.0 for p in probs]))
    f["entropy"] = entropy

    for d in range(10):
        f[f"dev_{d}"] = float(obs_counts[d] - expected)

    return f


def build_feature_matrix(digits, prices=None, window=50, verbose=True):
    N = len(digits)
    n_samples = N - window
    if n_samples <= 0:
        raise ValueError(f"Need > {window} digits, got {N}")

    steps = None
    median_abs_step = None
    if prices is not None and len(prices) == N:
        steps = np.diff(prices)
        median_abs_step = float(np.median(np.abs(steps)))

    feature_list = []
    y_list = []

    iterator = trange(window, N, desc="Features", disable=not verbose)
    for i in iterator:
        win_digits = digits[i - window:i]

        last_step_val = None
        steps_win_val = None
        if steps is not None:
            if i >= 2 and i - 1 <= len(steps):
                last_step_val = float(steps[i - 2])
            if i >= window + 1:
                steps_win_val = steps[i - window - 1:i - 1]
            elif i > 0:
                steps_win_val = steps[:i - 1]

        feats = extract_features_single(
            win_digits,
            last_step=last_step_val,
            steps_win=steps_win_val,
            median_abs_step=median_abs_step,
            window=window,
        )

        y_list.append(int(digits[i]))
        feature_list.append(feats)

    feature_names = list(feature_list[0].keys())
    X = np.zeros((len(feature_list), len(feature_names)), dtype=np.float32)
    for j, feats in enumerate(feature_list):
        for k, name in enumerate(feature_names):
            X[j, k] = feats[name]

    y = np.array(y_list, dtype=np.int64)
    return X, y, feature_names


# =========================================================================
# MODEL TRAINING & EVALUATION
# =========================================================================

def train_and_evaluate_models(X, y, feature_names, verbose=True):
    N = len(X)
    split_idx = int(N * 0.7)

    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]

    if verbose:
        print(f"\n  Train samples: {len(X_train):,}")
        print(f"  Test samples:  {len(X_test):,}")

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    baseline_acc = 0.10

    models = {
        "random_forest": RandomForestClassifier(
            n_estimators=100, max_depth=20, random_state=RANDOM_SEED,
            n_jobs=-1, verbose=0,
        ),
        "xgboost": xgb.XGBClassifier(
            n_estimators=100, learning_rate=0.1, max_depth=6,
            objective="multi:softprob", num_class=10,
            random_state=RANDOM_SEED, verbosity=0,
        ),
        "logistic_regression": LogisticRegression(
            max_iter=2000, random_state=RANDOM_SEED,
            C=1.0, solver="lbfgs",
        ),
        "dummy": DummyClassifier(strategy="most_frequent", random_state=RANDOM_SEED),
    }

    results = {}
    trained = {}
    preds_cache = {}

    for name in ["dummy", "logistic_regression", "random_forest", "xgboost"]:
        clf = models[name]
        if verbose:
            print(f"\n  Training {name} ...", end=" ", flush=True)

        if name == "logistic_regression":
            clf.fit(X_train_scaled, y_train)
            y_pred = clf.predict(X_test_scaled)
            y_proba = clf.predict_proba(X_test_scaled)
        elif name == "dummy":
            clf.fit(X_train, y_train)
            y_pred = clf.predict(X_test)
            y_proba = clf.predict_proba(X_test)
        else:
            clf.fit(X_train, y_train)
            y_pred = clf.predict(X_test)
            y_proba = clf.predict_proba(X_test)

        acc = accuracy_score(y_test, y_pred)
        cm = confusion_matrix(y_test, y_pred).tolist()
        cr = classification_report(y_test, y_pred, digits=4, output_dict=False)

        if verbose:
            print(f"accuracy = {acc:.4f}")

        model_result = {
            "accuracy": round(acc, 6),
            "baseline_random": baseline_acc,
            "classification_report": cr,
            "confusion_matrix": cm,
        }

        if name in ("random_forest", "xgboost"):
            if name == "random_forest":
                imp = clf.feature_importances_
            else:
                imp = clf.feature_importances_
            ranked = sorted(
                zip(feature_names, imp), key=lambda x: -x[1]
            )
            model_result["feature_importance"] = {
                fn: float(v) for fn, v in ranked
            }
            model_result["top_20_features"] = [
                {"name": fn, "importance": float(v)}
                for fn, v in ranked[:20]
            ]

        results[name] = model_result
        trained[name] = clf
        preds_cache[name] = {"y_pred": y_pred, "y_proba": y_proba}

    tscv = TimeSeriesSplit(n_splits=3)
    tscv_results = []
    for fold, (train_idx, test_idx) in enumerate(tscv.split(X)):
        Xf_train, Xf_test = X[train_idx], X[test_idx]
        yf_train, yf_test = y[train_idx], y[test_idx]
        scaler_f = StandardScaler()
        Xf_train_s = scaler_f.fit_transform(Xf_train)
        Xf_test_s = scaler_f.transform(Xf_test)

        fold_accs = {}
        for name in ["dummy", "logistic_regression", "random_forest", "xgboost"]:
            clf = deepcopy(models[name])
            if name == "logistic_regression":
                clf.fit(Xf_train_s, yf_train)
                yf_pred = clf.predict(Xf_test_s)
            elif name == "dummy":
                clf.fit(Xf_train, yf_train)
                yf_pred = clf.predict(Xf_test)
            else:
                clf.fit(Xf_train, yf_train)
                yf_pred = clf.predict(Xf_test)
            fold_accs[name] = round(accuracy_score(yf_test, yf_pred), 6)
        tscv_results.append({
            f"fold_{fold}": fold_accs,
            "train_size": int(len(train_idx)),
            "test_size": int(len(test_idx)),
        })

    results["_timeseries_cv"] = tscv_results
    results["_test_indices"] = {
        "split_idx": int(split_idx),
        "test_start_in_digits": int(split_idx + 50),
    }

    best_name = max(results, key=lambda n: results[n]["accuracy"]
                    if n not in ("_timeseries_cv", "_test_indices") else -1)
    results["_best_model"] = best_name

    trained["_scaler"] = scaler

    return results, trained, preds_cache, X_test, y_test


# =========================================================================
# BACKTESTING HELPERS
# =========================================================================

def wilson_interval(wins, total, z=WILSON_Z):
    if total == 0:
        return {"lower": 0.0, "center": 0.0, "upper": 0.0}
    p = wins / total
    denom = 1 + z ** 2 / total
    center = (p + z ** 2 / (2 * total)) / denom
    margin = z * math.sqrt(p * (1 - p) / total + z ** 2 / (4 * total ** 2)) / denom
    return {
        "lower": round(center - margin, 6),
        "center": round(center, 6),
        "upper": round(center + margin, 6),
    }


def compute_drawdown(equity_curve):
    arr = np.array(equity_curve, dtype=np.float64)
    peak = np.maximum.accumulate(arr)
    dd = (arr - peak) / peak
    return float(np.min(dd))


def compute_sharpe(equity_curve, rf=0.0):
    if len(equity_curve) < 2:
        return 0.0
    arr = np.array(equity_curve, dtype=np.float64)
    returns = np.diff(arr) / arr[:-1]
    if len(returns) == 0 or np.std(returns) < 1e-12:
        return 0.0
    return float((np.mean(returns) - rf) / np.std(returns))


def monte_carlo_simulation(win_rate, n_trades, n_runs=MONTE_CARLO_RUNS,
                           initial_capital=INITIAL_CAPITAL,
                           bet_size=BET_SIZE, payout=PAYOUT_MATCH):
    finals = []
    for _ in range(n_runs):
        capital = initial_capital
        for _ in range(n_trades):
            if np.random.random() < win_rate:
                capital += bet_size * payout
            else:
                capital -= bet_size
        finals.append(capital)
    arr = np.array(finals)
    return {
        "p5": round(float(np.percentile(arr, 5)), 2),
        "p50": round(float(np.percentile(arr, 50)), 2),
        "p95": round(float(np.percentile(arr, 95)), 2),
        "mean": round(float(np.mean(arr)), 2),
        "std": round(float(np.std(arr)), 2),
    }


def compute_trade_metrics(trades, initial_capital=INITIAL_CAPITAL,
                          bet_size=BET_SIZE):
    n = len(trades)
    if n == 0:
        return {"total_trades": 0, "win_rate": 0.0, "ev_per_dollar": 0.0,
                "total_profit": 0.0, "final_capital": initial_capital,
                "max_drawdown_pct": 0.0, "profit_factor": 0.0,
                "sharpe_ratio": 0.0}

    wins = sum(1 for t in trades if t["win"])
    losses = n - wins
    win_rate = wins / n

    gross_profit = sum(t["profit"] for t in trades if t["profit"] > 0)
    gross_loss = abs(sum(t["profit"] for t in trades if t["profit"] < 0))

    equity = [initial_capital]
    for t in trades:
        equity.append(equity[-1] + t["profit"])
    total_profit = equity[-1] - initial_capital

    ev = (win_rate * bet_size * 0.92) - ((1 - win_rate) * bet_size)
    ev_per_dollar = ev / bet_size

    max_dd = compute_drawdown(equity)
    sharpe = compute_sharpe(equity)
    pf = (gross_profit / gross_loss) if gross_loss > 0 else float("inf")

    wc = wilson_interval(wins, n)
    mc = monte_carlo_simulation(win_rate, n)

    return {
        "total_trades": n,
        "wins": wins,
        "losses": losses,
        "win_rate": round(win_rate, 6),
        "ev_per_dollar": round(ev_per_dollar, 6),
        "total_profit": round(total_profit, 2),
        "final_capital": round(equity[-1], 2),
        "max_drawdown_pct": round(max_dd, 6),
        "profit_factor": round(pf, 6) if pf != float("inf") else "inf",
        "sharpe_ratio": round(sharpe, 6),
        "wilson_95pct_ci": wc,
        "monte_carlo": mc,
    }


# =========================================================================
# BACKTESTING STRATEGIES
# =========================================================================

def backtest_always_match(digits, window, start_pos):
    trades = []
    for i in range(start_pos, len(digits)):
        if i < window:
            continue
        win = digits[i - window:i]
        counts = Counter(win)
        pred = counts.most_common(1)[0][0]
        actual = int(digits[i])
        trades.append({
            "position": int(i),
            "predicted": pred,
            "actual": actual,
            "type": "match",
            "confidence": float(counts[pred]) / len(win),
            "win": bool(pred == actual),
            "profit": BET_SIZE * PAYOUT_MATCH if pred == actual else -BET_SIZE,
        })
    return trades


def backtest_always_differ(digits, window, start_pos):
    trades = []
    for i in range(start_pos, len(digits)):
        if i < window:
            continue
        win = digits[i - window:i]
        counts = Counter(win)
        pred = min(range(10), key=lambda d: counts.get(d, 0))
        actual = int(digits[i])
        win_trade = actual != pred
        trades.append({
            "position": int(i),
            "predicted": pred,
            "actual": actual,
            "type": "differs",
            "confidence": 1.0 - float(counts.get(pred, 0)) / len(win),
            "win": bool(win_trade),
            "profit": BET_SIZE * PAYOUT_DIFFERS if win_trade else -BET_SIZE,
        })
    return trades


def backtest_markov_match(digits, window, start_pos):
    trades = []
    for i in range(start_pos, len(digits)):
        if i < window:
            continue
        win = digits[i - window:i]
        tm = transition_matrix_from_window(win)
        last = int(win[-1])
        row = tm[last]
        row_sum = row.sum()
        if row_sum == 0:
            probs = np.ones(10) * 0.1
        else:
            probs = row / row_sum
        pred = int(np.argmax(probs))
        actual = int(digits[i])
        trades.append({
            "position": int(i),
            "predicted": pred,
            "actual": actual,
            "type": "match",
            "confidence": float(probs[pred]),
            "win": bool(pred == actual),
            "profit": BET_SIZE * PAYOUT_MATCH if pred == actual else -BET_SIZE,
        })
    return trades


def backtest_trigram_match(digits, window, start_pos):
    trades = []
    for i in range(start_pos, len(digits)):
        if i < max(window, 3):
            continue
        win = digits[i - window:i]
        tc = trigram_counts_from_window(win)
        last_two = (int(win[-2]), int(win[-1]))
        tri_row = tc.get(last_two, np.ones(10, dtype=np.float64))
        tri_sum = tri_row.sum()
        probs = tri_row / tri_sum if tri_sum > 0 else np.ones(10) * 0.1
        pred = int(np.argmax(probs))
        actual = int(digits[i])
        trades.append({
            "position": int(i),
            "predicted": pred,
            "actual": actual,
            "type": "match",
            "confidence": float(probs[pred]),
            "win": bool(pred == actual),
            "profit": BET_SIZE * PAYOUT_MATCH if pred == actual else -BET_SIZE,
        })
    return trades


def backtest_ml_match(model, scaler, X_test, y_test, feature_fn=None,
                      digits=None, window=50, start_pos=0):
    trades = []
    n_test = len(X_test)
    y_proba = model.predict_proba(X_test)
    y_pred = model.predict(X_test)

    for idx in range(n_test):
        pred = int(y_pred[idx])
        actual = int(y_test[idx])
        conf = float(np.max(y_proba[idx]))
        trades.append({
            "position": int(start_pos + idx),
            "predicted": pred,
            "actual": actual,
            "type": "match",
            "confidence": conf,
            "win": bool(pred == actual),
            "profit": BET_SIZE * PAYOUT_MATCH if pred == actual else -BET_SIZE,
        })
    return trades


def backtest_high_confidence(model, scaler, X_test, y_test, threshold,
                             start_pos=0):
    trades = []
    n_test = len(X_test)
    y_proba = model.predict_proba(X_test)
    y_pred = model.predict(X_test)

    for idx in range(n_test):
        conf = float(np.max(y_proba[idx]))
        if conf < threshold:
            continue
        pred = int(y_pred[idx])
        actual = int(y_test[idx])
        trades.append({
            "position": int(start_pos + idx),
            "predicted": pred,
            "actual": actual,
            "type": "match",
            "confidence": conf,
            "win": bool(pred == actual),
            "profit": BET_SIZE * PAYOUT_MATCH if pred == actual else -BET_SIZE,
        })
    return trades


# =========================================================================
# MAIN
# =========================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Phase 3+4: ML training and trade backtesting on digit data"
    )
    parser.add_argument("--symbol", default="R_75",
                        help="Deriv symbol (default: R_75)")
    parser.add_argument("--window", type=int, default=50,
                        help="Feature window size (default: 50)")
    parser.add_argument("--backtest-window", type=int, default=50,
                        help="Backtest strategy window (default: 50)")
    parser.add_argument("--max-samples", type=int, default=0,
                        help="Max data points (0 = all)")
    parser.add_argument("--seed", type=int, default=RANDOM_SEED,
                        help="Random seed")
    parser.add_argument("--output-dir", default=STORED_DIR,
                        help=f"Output directory (default: {STORED_DIR})")
    parser.add_argument("--retrain", action="store_true",
                        help="Force retrain even if cached results exist")
    parser.add_argument("--no-price-features", action="store_true",
                        help="Disable price/step features")
    args = parser.parse_args()

    seed = args.seed
    np.random.seed(seed)

    os.makedirs(args.output_dir, exist_ok=True)

    print("=" * 65)
    print("  Phase 3+4: ML Training & Trade Backtesting")
    print("=" * 65)
    print(f"  Symbol:        {args.symbol}")
    print(f"  ML window:     {args.window}")
    print(f"  BT window:     {args.backtest_window}")
    print(f"  Max samples:   {args.max_samples or 'all'}")

    print(f"\n{'─'*65}")
    print(f"  Loading data ...")
    prices, digits, timestamps = load_h5_data(args.symbol, args.max_samples)
    if digits is None:
        print(f"  ERROR: No HDF5 file found for {args.symbol}.")
        print(f"  Run collect_ticks.py first or check stored/ directory.")
        sys.exit(1)

    N = len(digits)
    print(f"  Loaded {N:,} digits, {len(prices):,} prices")

    dist = Counter(digits.tolist())
    total_d = float(N)
    print(f"  Digit distribution:")
    for d in range(10):
        pct = dist.get(d, 0) / total_d * 100
        print(f"    {d}: {dist.get(d, 0):>8} ({pct:5.2f}%)")
    expected = total_d / 10
    chi_sq = sum((dist.get(d, 0) - expected) ** 2 / expected for d in range(10))
    print(f"  Chi-squared vs uniform: {chi_sq:.2f} (9df, crit=16.92)")

    # ── Phase 3: Feature Engineering ──
    print(f"\n{'─'*65}")
    print(f"  Phase 3: Feature Engineering")
    print(f"{'─'*65}")
    print(f"  Window: {args.window} ticks")

    use_prices = prices is not None and not args.no_price_features
    X, y, feature_names = build_feature_matrix(
        digits, prices if use_prices else None,
        window=args.window, verbose=True,
    )
    print(f"  Feature matrix: {X.shape[0]:,} samples x {X.shape[1]} features")

    # ── Phase 3: Model Training ──
    print(f"\n{'─'*65}")
    print(f"  Phase 3: Model Training")
    print(f"{'─'*65}")

    results, trained, preds_cache, X_test, y_test = train_and_evaluate_models(
        X, y, feature_names, verbose=True,
    )

    print(f"\n  Best model: {results['_best_model']} "
          f"(accuracy = {results[results['_best_model']]['accuracy']:.4f})")

    print(f"\n  TimeSeries CV results:")
    for fold_data in results["_timeseries_cv"]:
        for k, v in fold_data.items():
            if k.startswith("fold_"):
                print(f"    {k}: {v}")

    # ── Phase 4: Backtesting ──
    print(f"\n{'─'*65}")
    print(f"  Phase 4: Trade Backtesting (Match/Differs Simulation)")
    print(f"{'─'*65}")

    split_idx = results["_test_indices"]["split_idx"]
    test_start_digit = split_idx + args.window
    print(f"  Test period starts at digit index: {test_start_digit}")
    print(f"  Test samples available: {len(X_test):,}")
    print(f"  Backtest strategy window: {args.backtest_window}")
    print(f"  Bet size: ${BET_SIZE:.2f}")
    print(f"  Start capital: ${INITIAL_CAPITAL:.2f}")
    print(f"  Payout (Match): {PAYOUT_MATCH*100:.0f}%")
    print(f"  Payout (Differs): {PAYOUT_DIFFERS*100:.0f}%")

    best_model_name = results["_best_model"]
    best_model = trained[best_model_name]
    scaler = trained["_scaler"]

    strategy_results = {}

    # 1. Always Match
    print(f"\n  [1/6] Always Match ...", end=" ", flush=True)
    trades = backtest_always_match(digits, args.backtest_window, test_start_digit)
    strategy_results["always_match"] = compute_trade_metrics(trades)
    print(f"wr={strategy_results['always_match']['win_rate']:.4f}  "
          f"profit=${strategy_results['always_match']['total_profit']:.2f}  "
          f"trades={strategy_results['always_match']['total_trades']}")

    # 2. Always Differ
    print(f"  [2/6] Always Differ ...", end=" ", flush=True)
    trades = backtest_always_differ(digits, args.backtest_window, test_start_digit)
    strategy_results["always_differ"] = compute_trade_metrics(trades)
    print(f"wr={strategy_results['always_differ']['win_rate']:.4f}  "
          f"profit=${strategy_results['always_differ']['total_profit']:.2f}  "
          f"trades={strategy_results['always_differ']['total_trades']}")

    # 3. Markov Match
    print(f"  [3/6] Markov Match ...", end=" ", flush=True)
    trades = backtest_markov_match(digits, args.backtest_window, test_start_digit)
    strategy_results["markov_match"] = compute_trade_metrics(trades)
    print(f"wr={strategy_results['markov_match']['win_rate']:.4f}  "
          f"profit=${strategy_results['markov_match']['total_profit']:.2f}  "
          f"trades={strategy_results['markov_match']['total_trades']}")

    # 4. ML Match
    print(f"  [4/6] ML Match ({best_model_name}) ...", end=" ", flush=True)
    trades = backtest_ml_match(
        best_model, scaler, X_test, y_test,
        start_pos=test_start_digit,
    )
    strategy_results["ml_match"] = compute_trade_metrics(trades)
    print(f"wr={strategy_results['ml_match']['win_rate']:.4f}  "
          f"profit=${strategy_results['ml_match']['total_profit']:.2f}  "
          f"trades={strategy_results['ml_match']['total_trades']}")

    # 5. High Confidence Only (multiple thresholds)
    thresholds = [0.15, 0.20, 0.25, 0.30]
    print(f"  [5/6] High Confidence Only ...")
    for thresh in thresholds:
        trades = backtest_high_confidence(
            best_model, scaler, X_test, y_test, thresh,
            start_pos=test_start_digit,
        )
        key = f"high_conf_{thresh:.2f}"
        strategy_results[key] = compute_trade_metrics(trades)
        n_trades = strategy_results[key]["total_trades"]
        wr = strategy_results[key]["win_rate"]
        profit = strategy_results[key]["total_profit"]
        print(f"    thresh={thresh:.2f}  trades={n_trades:>6d}  "
              f"wr={wr:.4f}  profit=${profit:.2f}")

    # 6. Sequence Match (trigram)
    print(f"  [6/6] Sequence Match (Trigram) ...", end=" ", flush=True)
    trades = backtest_trigram_match(digits, args.backtest_window, test_start_digit)
    strategy_results["sequence_match"] = compute_trade_metrics(trades)
    print(f"wr={strategy_results['sequence_match']['win_rate']:.4f}  "
          f"profit=${strategy_results['sequence_match']['total_profit']:.2f}  "
          f"trades={strategy_results['sequence_match']['total_trades']}")

    # ── Save Results ──
    ml_path = os.path.join(args.output_dir, "ml_results.json")
    bt_path = os.path.join(args.output_dir, "backtest_results.json")

    ml_output = {
        "data_info": {
            "symbol": args.symbol,
            "total_digits": int(N),
            "n_samples": int(X.shape[0]),
            "n_features": int(X.shape[1]),
            "window": args.window,
            "feature_names": feature_names,
        },
        "models": {k: v for k, v in results.items()
                   if not k.startswith("_")},
        "timeseries_cv": results["_timeseries_cv"],
        "best_model": results["_best_model"],
        "baseline_random": 0.10,
    }
    with open(ml_path, "w") as f:
        json.dump(ml_output, f, indent=2, default=str)
    print(f"\n  ML results saved to: {ml_path}")

    bt_output = {
        "config": {
            "symbol": args.symbol,
            "backtest_window": args.backtest_window,
            "ml_window": args.window,
            "initial_capital": INITIAL_CAPITAL,
            "bet_size": BET_SIZE,
            "payout_match": PAYOUT_MATCH,
            "payout_differs": PAYOUT_DIFFERS,
        },
        "strategies": strategy_results,
    }
    with open(bt_path, "w") as f:
        json.dump(bt_output, f, indent=2, default=str)
    print(f"  Backtest results saved to: {bt_path}")

    # ── Print Summary Table ──
    print(f"\n{'='*80}")
    print(f"  STRATEGY COMPARISON SUMMARY")
    print(f"{'='*80}")
    header = f"  {'Strategy':<25s} {'Trades':>8s} {'WinRate':>8s} {'EV/$':>8s} "
    header += f"{'Profit':>10s} {'Drawdown':>9s} {'PF':>8s} {'Sharpe':>8s}"
    print(header)
    print(f"  {'─'*25} {'─'*8} {'─'*8} {'─'*8} {'─'*10} {'─'*9} {'─'*8} {'─'*8}")

    results_order = [
        "always_match", "always_differ", "markov_match",
        "ml_match", "sequence_match",
    ] + [f"high_conf_{t:.2f}" for t in thresholds]

    for sk in results_order:
        if sk not in strategy_results:
            continue
        r = strategy_results[sk]
        label = sk.replace("_", " ").title()
        row = f"  {label:<25s} {r['total_trades']:>8d} {r['win_rate']:>7.2%} "
        row += f"{r['ev_per_dollar']:>8.4f} ${r['total_profit']:>+8.2f} "
        row += f"{r['max_drawdown_pct']:>7.2%} "
        pf = r["profit_factor"]
        row += f"{pf:>8.2f}" if isinstance(pf, float) else f"{pf:>8s}"
        row += f" {r['sharpe_ratio']:>8.4f}"
        print(row)

    print(f"\n  Monte Carlo 95% ranges (final capital after all trades):")
    for sk in results_order:
        if sk not in strategy_results:
            continue
        mc = strategy_results[sk]["monte_carlo"]
        label = sk.replace("_", " ").title()
        print(f"    {label:<25s} 5%=${mc['p5']:<8.2f}  "
              f"50%=${mc['p50']:<8.2f}  95%=${mc['p95']:<8.2f}")

    # Feature importance summary
    print(f"\n{'─'*65}")
    print(f"  TOP-5 FEATURES (Random Forest)")
    print(f"{'─'*65}")
    if "random_forest" in results:
        top5 = results["random_forest"]["top_20_features"][:5]
        for rank, feat in enumerate(top5, 1):
            print(f"    {rank}. {feat['name']:25s}  {feat['importance']:.6f}")

    print(f"\n{'─'*65}")
    print(f"  TOP-5 FEATURES (XGBoost)")
    print(f"{'─'*65}")
    if "xgboost" in results:
        top5 = results["xgboost"]["top_20_features"][:5]
        for rank, feat in enumerate(top5, 1):
            print(f"    {rank}. {feat['name']:25s}  {feat['importance']:.6f}")

    print(f"\n  Done. Results saved to {args.output_dir}/")
    print()


if __name__ == "__main__":
    main()
