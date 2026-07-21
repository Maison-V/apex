#!/usr/bin/env python3
"""
Pattern-specific reverse engineering of Deriv R_75.

Instead of predicting every tick, find specific PRNG-state "signatures"
that correlate with a specific future digit. Only trade when a signature
matches. Skip all other ticks.
"""

import os
import sys
from collections import defaultdict

import h5py
import numpy as np
from scipy import stats

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORED_DIR = os.path.join(BASE_DIR, "stored")


def load_and_recover(path):
    """Load ticks and recover the underlying PRNG uniform stream."""
    with h5py.File(path, "r") as f:
        prices = f["prices"][:]
        digits = f["digits"][:]
        ts = f["timestamps"][:]

    steps = np.diff(prices)

    # Remove outliers for clean distribution estimation
    median = np.median(steps)
    mad = np.median(np.abs(steps - median))
    clean = steps[np.abs(steps - median) < 5 * mad]
    mu = clean.mean()
    sigma = clean.std()

    # Recover U = Phi(standardized_step)
    Z = (steps - mu) / sigma
    U = stats.norm.cdf(Z)

    # Also map digits
    # U values are the PRNG outputs that generated each step
    # The digit is the last digit of the resulting price
    # U[n] → step[n] → price[n+1] → digit[n+1]

    return prices, digits, ts, U, steps


def discretize_U(U, n_bins=32):
    """Discretize the uniform stream into bins for pattern matching."""
    bins = np.clip(np.floor(U * n_bins).astype(np.int32), 0, n_bins - 1)
    return bins, n_bins


def find_predictive_patterns(bins, digits, max_pattern_len=6, min_occurrences=5):
    """
    Exhaustive search: for each pattern length 1..max_pattern_len,
    find all patterns in the discretized PRNG stream that predict
    a specific digit with high confidence.

    Only consider patterns that appear at least min_occurrences times.

    Returns a list of (pattern_tuple, predicted_digit, confidence, count) sorted.
    """
    N = len(bins)
    results = []

    for plen in range(1, max_pattern_len + 1):
        if plen > N // 2:
            break
        # Use stride-1 sliding window over the bin stream
        # pattern at positions [i-plen:i] → predicts digits[i]
        pattern_nexts = defaultdict(lambda: np.zeros(10, dtype=np.int64))

        for i in range(plen, N):
            pattern = tuple(bins[i - plen : i])
            next_digit = int(digits[i])  # digit corresponding to price at step i
            pattern_nexts[pattern][next_digit] += 1

        # For each pattern, find if any digit is predicted with high confidence
        for pattern, counts in pattern_nexts.items():
            total = int(counts.sum())
            if total < min_occurrences:
                continue

            best_digit = int(np.argmax(counts))
            best_count = int(counts[best_digit])
            confidence = best_count / total if total > 0 else 0

            # Expected confidence for random: 0.10
            # Only keep if confidence is meaningfully above 0.10
            # Using Wilson score lower bound for statistical significance
            z = 1.96  # 95% CI
            p_hat = confidence
            if total > 0:
                wilson_lower = (p_hat + z * z / (2 * total) - z * np.sqrt(
                    (p_hat * (1 - p_hat) + z * z / (4 * total)) / total
                )) / (1 + z * z / total)
            else:
                wilson_lower = 0

            # Also find the BEST digit for Differs (lowest count)
            worst_digit = int(np.argmin(counts))
            worst_count = int(counts[worst_digit])
            worst_conf = worst_count / total if total > 0 else 0
            differs_wr = 1 - worst_conf

            if worst_count > 0:
                worst_wilson_lower = (worst_conf + z * z / (2 * total) - z * np.sqrt(
                    (worst_conf * (1 - worst_conf) + z * z / (4 * total)) / total
                )) / (1 + z * z / total)
                differs_wilson_inv = 1 - worst_wilson_lower
            else:
                differs_wilson_inv = 1.0

            results.append({
                "pattern_len": plen,
                "pattern": pattern,
                "best_digit": best_digit,
                "match_confidence": round(confidence, 4),
                "match_count": best_count,
                "total": total,
                "wilson_lower": round(wilson_lower, 4),
                "differs_digit": worst_digit,
                "differs_wr": round(differs_wr, 4),
                "worst_count": worst_count,
                "differs_wilson_lower": round(differs_wilson_inv, 4),
            })

    return results


def main():
    path = os.path.join(STORED_DIR, "ticks_R_75.h5")
    print(f"Loading {path}...")
    prices, digits, ts, U, steps = load_and_recover(path)
    N = len(digits)

    print(f"Loaded {N} ticks, recovered {len(U)} PRNG outputs")

    # Try different binning granularities
    for n_bins in [16, 32, 64]:
        print(f"\n{'='*70}")
        print(f"  PATTERN SEARCH — {n_bins} bins")
        print(f"{'='*70}")

        bins, _ = discretize_U(U[:N], n_bins)
        print(f"  Discretized U into {n_bins} bins, {len(bins)} values")
        print(f"  Searching patterns length 1-5...")

        results = find_predictive_patterns(bins, digits, max_pattern_len=5,
                                           min_occurrences=5)

        # Sort by Differs Wilson lower bound (best edge)
        results.sort(key=lambda r: -r["differs_wilson_lower"])

        print(f"\n  Top 20 patterns for DIFFERS (Win Rate, Wilson Lower Bound):")
        print(f"  {'Pat':>6s} {'Pattern':>20s} → {'Avo':>4s} | {'Cnt':>4s} "
              f"{'Tot':>4s} | {'WR':>5s} {'Wil90':>5s} | {'Hit':>5s} {'Cnt':>4s}")
        print(f"  {'-'*5} {'-'*20} {'-'*4} | {'-'*4} {'-'*4} | {'-'*5} "
              f"{'-'*5} | {'-'*5} {'-'*4}")
        for r in results[:20]:
            pat_str = "-".join(str(x) for x in r["pattern"][:6])
            print(f"  {r['pattern_len']:>3d}  {pat_str:>20s} → {r['differs_digit']:>3d} "
                  f"| {r['worst_count']:>4d} {r['total']:>4d} | "
                  f"{r['differs_wr']:.3f} {r['differs_wilson_lower']:.3f} | "
                  f"{r['match_confidence']:.3f} {r['match_count']:>4d}")

        # Sort by Match confidence (best direct prediction)
        results.sort(key=lambda r: -r["wilson_lower"])

        print(f"\n  Top 20 patterns for MATCH (Predict exact digit, Wilson lower bound):")
        print(f"  {'Pat':>6s} {'Pattern':>20s} → {'Dig':>4s} | {'Cnt':>4s} "
              f"{'Tot':>4s} | {'Conf':>5s} {'WilLo':>5s}")
        print(f"  {'-'*5} {'-'*20} {'-'*4} | {'-'*4} {'-'*4} | {'-'*5} {'-'*5}")
        top_match = [r for r in results if r["match_confidence"] > 0.12][:20]
        for r in top_match:
            pat_str = "-".join(str(x) for x in r["pattern"][:6])
            print(f"  {r['pattern_len']:>3d}  {pat_str:>20s} → {r['best_digit']:>3d} "
                  f"| {r['match_count']:>4d} {r['total']:>4d} | "
                  f"{r['match_confidence']:.3f} {r['wilson_lower']:.3f}")

        if not top_match:
            print(f"  (none found — no pattern exceeds 12% confidence)")


if __name__ == "__main__":
    main()
