#!/usr/bin/env python3
"""
Deep reverse engineering of Deriv R_75 PRNG.
Strategy: instead of predicting WHICH digit (10% hit), find conditionally
underrepresented digits and bet DIFFERS (targeting 90%+ accuracy).
"""

import os
import sys

import h5py
import numpy as np
from scipy import stats
from collections import Counter

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORED_DIR = os.path.join(BASE_DIR, "stored")


def main():
    path = os.path.join(STORED_DIR, "ticks_R_75.h5")
    print(f"Loading {path}...")
    with h5py.File(path, "r") as f:
        prices = f["prices"][:]
        digits = f["digits"][:]
        ts = f["timestamps"][:]

    N = len(prices)
    print(f"Loaded {N} ticks")
    print(f"Price range: {prices.min():.2f} - {prices.max():.2f}")

    steps = np.diff(prices)
    step_digits = digits[1:]  # digits corresponding to each step

    # =====================================================================
    # PHASE 1: Recover underlying PRNG uniform stream from step distribution
    # =====================================================================
    print(f"\n{'='*70}")
    print(f"  PHASE 1: PRNG STREAM RECOVERY")
    print(f"{'='*70}")

    # Remove outliers (> 3*MAD from median) for clean distribution
    median = np.median(steps)
    mad = np.median(np.abs(steps - median))
    outlier_mask = np.abs(steps - median) > 5 * mad
    clean_steps = steps[~outlier_mask]
    print(f"Outliers removed: {outlier_mask.sum()} / {len(steps)} "
          f"({100*outlier_mask.sum()/len(steps):.3f}%)")
    print(f"Clean steps: {len(clean_steps)}, std={clean_steps.std():.4f}")

    # Step ~ N(0, sigma). Standardize.
    step_mean = clean_steps.mean()
    step_std = clean_steps.std()
    print(f"Step distribution: mean={step_mean:.6f}, std={step_std:.6f}")

    # Recover Z = (step - mean) / std  (standard normal)
    Z_all = (steps - step_mean) / step_std

    # Recover U = Phi(Z) where Phi = standard normal CDF
    U_all = stats.norm.cdf(Z_all)

    print(f"Recovered U stream: {len(U_all)} values")
    print(f"  U mean = {U_all.mean():.6f} (expect 0.5)")
    print(f"  U std  = {U_all.std():.6f} (expect 0.2887)")

    # Bucket into 256 bins and check uniformity
    U_bins = np.clip(np.floor(U_all * 256).astype(np.int32), 0, 255)
    U_counts = np.bincount(U_bins, minlength=256)
    chi2, p = stats.chisquare(U_counts)
    print(f"  Chi2 uniformity (256 bins): {chi2:.2f}, p = {p:.6e}")
    print(f"  Uniform: {p > 0.05}")

    # =====================================================================
    # PHASE 2: PRNG DETECTION
    # =====================================================================
    print(f"\n{'='*70}")
    print(f"  PHASE 2: PRNG ALGORITHM DETECTION")
    print(f"{'='*70}")

    # Convert U to 32-bit integers (assuming U = X / 2^32)
    X = np.round(U_all * (2**32)).astype(np.uint64) % (2**32)
    
    # ---- LCG tests ----
    print(f"\n  --- LCG Tests ---")
    lcg_params = [
        ("Numerical Recipes", 1664525, 1013904223, 2**32),
        ("glibc", 1103515245, 12345, 2**31),
        ("Java", 25214903917, 11, 2**48),
        ("randu", 65539, 0, 2**31),
        ("minstd", 48271, 0, 2**31 - 1),
        ("C++ minstd_rand0", 16807, 0, 2**31 - 1),
        ("Borland", 22695477, 1, 2**32),
        ("Microsoft VC", 214013, 2531011, 2**31),
        ("MMIX", 6364136223846793005, 1442695040888963407, 2**64),
    ]

    best_lcg = None
    best_lcg_rate = 0
    for name, a, c, m in lcg_params:
        if m > 2**53:
            continue
        X_m = X.copy() % m
        pred = (X_m[:-1].astype(np.int64) * a + c) % m
        matches = (pred == X_m[1:].astype(np.int64)).sum()
        rate = matches / len(pred)
        if rate > 0.01:
            print(f"  {name}: match rate = {rate:.4f} ({matches}/{len(pred)})")
        if rate > best_lcg_rate:
            best_lcg_rate = rate
            best_lcg = name

    if best_lcg_rate < 0.01:
        print(f"  No LCG detected (best match: {best_lcg} rate={best_lcg_rate:.6f})")

    # ---- MT19937 detection ----
    print(f"\n  --- MT19937 Tests ---")
    X32 = X.astype(np.uint32)
    
    # Check correlation at MT-state lags
    for lag in [397, 624, 1021, 227]:
        if len(X32) > lag * 2:
            acf = np.corrcoef(
                X32[:len(X32)-lag].astype(np.float64),
                X32[lag:].astype(np.float64)
            )[0, 1]
            print(f"  Lag {lag:5d}: correlation = {acf:.6f}")

    # ---- Recovered U bits ----
    print(f"\n  --- Bit Analysis ---")
    for bit in range(8):
        bits = (X >> bit) & 1
        run_changes = (bits[1:] != bits[:-1]).sum()
        runs = 1 + run_changes
        n1 = bits.sum()
        n0 = len(bits) - n1
        print(f"  Bit {bit}: 0={n0:>6} 1={n1:>6} runs={runs:>6} ratio={n1/len(bits):.4f}")

    # =====================================================================
    # PHASE 3: DIFFERS STRATEGY — find conditionally under-represented digits
    # =====================================================================
    print(f"\n{'='*70}")
    print(f"  PHASE 3: DIFFERS STRATEGY")
    print(f"{'='*70}")
    print(f"  Strategy: identify states where specific digits appear below 10%")
    print(f"  then bet DIFFERS on those digits.")

    # Test all 1-gram conditions (last digit → next digit)
    print(f"\n  --- 1-gram (last digit → next) ---")
    bigram = np.zeros((10, 10), dtype=np.int64)
    for i in range(len(digits) - 1):
        bigram[digits[i], digits[i + 1]] += 1

    all_cond_edges = []
    for prev in range(10):
        total = bigram[prev].sum()
        for next_d in range(10):
            cnt = bigram[prev, next_d]
            obs_p = cnt / total
            edge = (obs_p - 0.10) / 0.10
            all_cond_edges.append({
                'cond': f'prev={prev}',
                'digit': next_d,
                'count': cnt,
                'total': total,
                'obs_p': obs_p,
                'edge': edge,
                'differs_win': 1 - obs_p,
            })

    # Rank by highest Differs win rate
    all_cond_edges.sort(key=lambda x: x['differs_win'], reverse=True)
    print(f"  Top conditions for DIFFERS bet:")
    print(f"  {'Condition':>12s} | {'Digit':>5s} | {'Count':>5s} | {'P(digit)':>9s} | "
          f"{'Edge':>8s} | {'Differs Win':>11s}")
    print(f"  {'-'*12} | {'-'*5} | {'-'*5} | {'-'*9} | {'-'*8} | {'-'*11}")
    for r in all_cond_edges[:15]:
        print(f"  {r['cond']:>12s} | {r['digit']:>5d} | {r['count']:>5d} | "
              f"{r['obs_p']:.4f}   | {r['edge']:+.4f} | {r['differs_win']:.4f}")

    # =====================================================================
    # PHASE 4: OUT-OF-SAMPLE WALK-FORWARD DIFFERS BACKTEST
    # =====================================================================
    print(f"\n{'='*70}")
    print(f"  PHASE 4: WALK-FORWARD DIFFERS BACKTEST")
    print(f"{'='*70}")
    print(f"  Using last-digit conditional probabilities, betting DIFFERS")
    print(f"  on the digit with the LOWEST conditional probability.")
    print(f"  Assumption: Deriv payout for Differs = 0.92 (as in simulation)")

    # Walk-forward: use expanding window to estimate conditional probs
    # For each step i >= 100:
    #   - compute P(next|prev) from data [:i]
    #   - pick digit with MIN probability for current prev digit
    #   - bet $10 DIFFERS on that digit
    #   - record outcome

    capital = 1000.0
    bet_size = 10.0
    payout = 0.92
    wins = 0
    losses = 0
    equity = [capital]
    trades_log = []

    for i in range(100, len(digits) - 1):
        # Expanding window: data up to i
        prev = digits[i]
        actual = digits[i + 1]
        
        # Compute conditional probabilities
        gram = np.zeros((10, 10), dtype=np.int64)
        for j in range(i):
            gram[digits[j], digits[j + 1]] += 1
        
        row = gram[prev]
        total = row.sum()
        if total == 0:
            continue
        
        probs = row / total
        
        # Pick digit with LOWEST probability → bet DIFFERS on it
        # But if the lowest prob digit is the same as prev digit,
        # there might be a "same digit bias" → skip or handle separately
        avoid_digit = np.argmin(probs)
        
        # Bet DIFFERS on avoid_digit
        actual_differs = (actual != avoid_digit)
        
        if actual_differs:
            wins += 1
            capital += bet_size * payout
        else:
            losses += 1
            capital -= bet_size
        
        equity.append(capital)
        
        if i < 110 or i % 5000 == 0:
            trades_log.append({
                'idx': i,
                'prev': int(prev),
                'avoid': int(avoid_digit),
                'actual': int(actual),
                'won': bool(actual_differs),
                'capital': round(capital, 2),
            })

    equity = np.array(equity)
    total_trades = wins + losses
    win_rate = wins / total_trades
    peak = np.maximum.accumulate(equity)
    drawdown = (peak - equity) / peak
    max_dd = drawdown.max()
    total_profit = capital - 1000.0
    profit_factor = (wins * bet_size * payout) / (losses * bet_size) if losses > 0 else float('inf')

    # Stats
    avg_win = bet_size * payout
    avg_loss = bet_size
    ev_per_trade = win_rate * avg_win - (1 - win_rate) * avg_loss
    sharpe = ev_per_trade / np.std([avg_win]*wins + [-avg_loss]*losses) if wins+losses > 0 else 0

    print(f"\n  Results:")
    print(f"  Trades: {total_trades}")
    print(f"  Win rate: {win_rate:.4f} ({wins}/{total_trades})")
    print(f"  EV per trade: ${ev_per_trade:.2f}")
    print(f"  Total P&L: ${total_profit:.2f}")
    print(f"  Max drawdown: {max_dd:.4f} ({100*max_dd:.2f}%)")
    print(f"  Profit factor: {profit_factor:.4f}")
    print(f"  Sharpe: {sharpe:.4f}")
    print(f"\n  Sample trades:")
    for t in trades_log[:10]:
        print(f"    idx={t['idx']:>5d} prev={t['prev']} avoid={t['avoid']} "
              f"actual={t['actual']} won={t['won']} capital=${t['capital']:>8.2f}")

    # ---- Compare: always bet Differs on digit 0 ----
    capital_0 = 1000.0
    wins_0 = 0
    for i in range(100, len(digits) - 1):
        actual = digits[i + 1]
        if actual != 0:
            wins_0 += 1
            capital_0 += bet_size * payout
        else:
            capital_0 -= bet_size
    total_0 = len(digits) - 100 - 1
    wr_0 = wins_0 / total_0
    print(f"\n  Baseline (Always Differs 0):")
    print(f"  Win rate: {wr_0:.4f} ({wins_0}/{total_0})")
    print(f"  Final capital: ${capital_0:.2f}")

    # ---- Also try: always Differs on last digit ----
    capital_same = 1000.0
    wins_same = 0
    for i in range(100, len(digits) - 1):
        prev = digits[i]
        actual = digits[i + 1]
        if actual != prev:
            wins_same += 1
            capital_same += bet_size * payout
        else:
            capital_same -= bet_size
    total_same = len(digits) - 100 - 1
    wr_same = wins_same / total_same
    print(f"\n  Baseline (Always Differs on last digit):")
    print(f"  Win rate: {wr_same:.4f} ({wins_same}/{total_same})")
    print(f"  Final capital: ${capital_same:.2f}")

    print(f"\n{'='*70}")
    print(f"  CONCLUSION")
    print(f"{'='*70}")
    edge = (win_rate - 0.90) / 0.90 * 100
    print(f"  Differs strategy:     {win_rate*100:.2f}% win rate")
    print(f"  Always Differs 0:     {wr_0*100:.2f}% win rate")
    print(f"  Always Differs last:  {wr_same*100:.2f}% win rate")
    print(f"  Improvement over 90%: {edge:+.2f}%")
    print(f"  PRNG detected:        {'YES - ' + (best_lcg or 'MT?') if best_lcg_rate > 0.01 else 'NO'}")


if __name__ == "__main__":
    main()
