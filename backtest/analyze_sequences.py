#!/usr/bin/env python3
"""Phase 2: Exhaustive statistical analysis of digit sequences."""

import argparse
import json
import os
from collections import defaultdict

import h5py
import numpy as np
import pandas as pd
from scipy.stats import chi2_contingency, chisquare, norm
from tqdm import tqdm


def load_digits(path):
    meta = {}
    with h5py.File(path, "r") as f:
        digits = f["digits"][:]
    with h5py.File(path, "r") as f:
        if "timestamps" in f:
            ts = f["timestamps"][:]
            if len(ts) > 0:
                import datetime as dt

                start = dt.datetime.utcfromtimestamp(int(ts[0])).strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
                end = dt.datetime.utcfromtimestamp(int(ts[-1])).strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
                meta["date_range"] = [start, end]
    return digits, meta


def analyze_length1(digits):
    counts = np.zeros(10, dtype=np.int64)
    for d in digits:
        counts[d] += 1
    expected = np.full(10, len(digits) / 10)
    chi2_stat, p_val = chisquare(counts, expected)
    return float(chi2_stat), float(p_val), counts


def analyze_length2(digits):
    trans = np.zeros((10, 10), dtype=np.int64)
    for i in range(len(digits) - 1):
        trans[digits[i], digits[i + 1]] += 1
    row_sums = trans.sum(axis=1, keepdims=True)
    mask = row_sums[:, 0] > 0
    observed = []
    expected = []
    for i in range(10):
        if mask[i]:
            for j in range(10):
                observed.append(trans[i, j])
                expected.append(row_sums[i, 0] / 10)
    chi2_stat, p_val = chisquare(observed, expected)
    return float(chi2_stat), float(p_val), trans


def extract_ngrams(digits, n):
    state_counts = defaultdict(lambda: np.zeros(10, dtype=np.int64))
    windows = np.lib.stride_tricks.sliding_window_view(digits, n)
    for w in windows:
        state = tuple(w[: n - 1])
        state_counts[state][w[-1]] += 1
    return dict(state_counts)


def rank_sequences(state_counts, bonferroni_alpha):
    records = []
    for state, counts in state_counts.items():
        total = int(counts.sum())
        if total == 0:
            continue
        for d in range(10):
            cnt = int(counts[d])
            if cnt == 0:
                continue
            obs_p = cnt / total
            exp_p = 0.1
            edge = (obs_p - exp_p) / exp_p
            denom = np.sqrt(exp_p * (1.0 - exp_p) / total)
            if denom > 0:
                z = (obs_p - exp_p) / denom
                p = 2.0 * (1.0 - norm.cdf(abs(z)))
            else:
                z = 0.0
                p = 1.0
            records.append(
                {
                    "sequence": "-".join(str(x) for x in state + (d,)),
                    "state": "-".join(str(x) for x in state),
                    "next_digit": int(d),
                    "count": cnt,
                    "total_in_state": total,
                    "observed_p": round(obs_p, 6),
                    "expected_p": round(exp_p, 6),
                    "edge": round(edge, 6),
                    "z_score": round(z, 6),
                    "p_value": round(p, 6),
                    "pass_bonferroni": bool(p < bonferroni_alpha),
                }
            )
    return records


def autocorrelation_test(digits, max_lag=100):
    n = len(digits)
    d = np.asarray(digits, dtype=np.float64)
    d_centered = d - d.mean()
    var = d_centered.var()
    if var == 0:
        return [], 0, []
    results = []
    max_possible = min(max_lag, n // 2 - 1)
    for lag in range(1, max_possible + 1):
        acf = np.corrcoef(d[:-lag], d[lag:])[0, 1]
        if np.isnan(acf):
            continue
        z = acf * np.sqrt(n)
        p = 2.0 * (1.0 - norm.cdf(abs(z)))
        results.append(
            {
                "lag": lag,
                "acf": round(acf, 6),
                "z_score": round(z, 6),
                "p_value": round(p, 6),
            }
        )
    threshold = 0.05 / len(results) if results else 0.05
    sig = [r["lag"] for r in results if r["p_value"] < threshold]
    max_sig = max(sig) if sig else 0
    return sig, max_sig, results


def runs_test(digits):
    n = len(digits)
    unique, counts_u = np.unique(digits, return_counts=True)
    n_i = np.asarray(counts_u, dtype=np.float64)
    runs = 1 + int(np.sum(digits[1:] != digits[:-1]))
    sum_ni2 = np.sum(n_i**2)
    sum_ni3 = np.sum(n_i**3)
    e_r = n - sum_ni2 / n + 1.0
    var_r = (
        sum_ni2 * (sum_ni2 + n * (n + 1)) - 2 * n * sum_ni3 - n**3
    ) / (n**2 * (n - 1))
    if var_r <= 0:
        return 0.0, 1.0
    z = (runs - e_r) / np.sqrt(var_r)
    p = 2.0 * (1.0 - norm.cdf(abs(z)))
    return round(z, 6), round(p, 6)


def main():
    parser = argparse.ArgumentParser(
        description="Exhaustive statistical analysis of digit sequences."
    )
    parser.add_argument(
        "--input",
        default="stored/ticks_R_75.h5",
        help="Path to HDF5 file containing digits dataset",
    )
    parser.add_argument(
        "--max-sequences",
        type=int,
        default=5,
        help="Maximum n-gram length to analyze (default: 5)",
    )
    args = parser.parse_args()

    print(f"Loading digits from {args.input}...")
    digits, meta = load_digits(args.input)
    total_ticks = len(digits)
    basename = os.path.splitext(os.path.basename(args.input))[0]
    symbol = basename.replace("ticks_", "")
    date_range = meta.get("date_range", [])

    print(f"Loaded {total_ticks} digits, symbol={symbol}")
    print(f"Digit distribution: {dict(zip(*np.unique(digits, return_counts=True)))}")

    counts_1 = np.zeros(10, dtype=np.int64)
    for d in digits:
        counts_1[d] += 1

    total_tests = 10
    total_tests += 100

    for n in range(3, args.max_sequences + 1):
        observed_states = 0
        windows = np.lib.stride_tricks.sliding_window_view(digits, n)
        seen = set()
        for w in windows:
            key = tuple(w)
            if key not in seen:
                seen.add(key)
                observed_states += 1
        total_tests += observed_states * 10

    bonferroni_alpha = 0.05 / total_tests if total_tests > 0 else 0.05
    print(f"\nTotal statistical tests: {total_tests}")
    print(f"Bonferroni alpha: {bonferroni_alpha:.8f}")

    h5_basename = os.path.splitext(os.path.basename(args.input))[0]

    results = {
        "parameters": {
            "symbol": symbol,
            "total_ticks": total_ticks,
            "date_range": date_range,
        },
        "bonferroni_alpha": bonferroni_alpha,
    }

    # ---- Length 1 ----
    print("\n=== Length 1 (digit frequencies) ===")
    chi2_1, p1, counts_1_arr = analyze_length1(digits)
    uniform_1 = p1 > bonferroni_alpha
    print(f"  Chi-squared = {chi2_1:.4f}, p = {p1:.6e}")
    print(f"  Uniform (after Bonferroni): {uniform_1}")
    for d in range(10):
        pct = counts_1_arr[d] / total_ticks * 100
        print(f"    {d}: {counts_1_arr[d]:>8} ({pct:5.2f}%)")

    sc_1 = {(): counts_1_arr}
    ranked_1 = rank_sequences(sc_1, bonferroni_alpha)
    ranked_1_sorted = sorted(ranked_1, key=lambda x: abs(x["edge"]), reverse=True)

    results["length1"] = {
        "chi_sq": round(chi2_1, 6),
        "p_value": round(p1, 6),
        "uniform": bool(uniform_1),
        "frequencies": [int(counts_1_arr[d]) for d in range(10)],
        "top_edges": ranked_1_sorted[:20],
    }

    # ---- Length 2 ----
    print("\n=== Length 2 (bigram transitions) ===")
    chi2_2, p2, trans_2 = analyze_length2(digits)
    uniform_2 = p2 > bonferroni_alpha
    print(f"  Chi-squared = {chi2_2:.4f}, p = {p2:.6e}")
    print(f"  Uniform (after Bonferroni): {uniform_2}")

    sc_2 = {}
    for i in range(10):
        row = trans_2[i]
        if row.sum() > 0:
            sc_2[(i,)] = row
    ranked_2 = rank_sequences(sc_2, bonferroni_alpha)
    ranked_2_sorted = sorted(ranked_2, key=lambda x: abs(x["edge"]), reverse=True)

    results["length2"] = {
        "chi_sq": round(chi2_2, 6),
        "p_value": round(p2, 6),
        "transitions": trans_2.tolist(),
        "top_edges": ranked_2_sorted[:20],
    }

    # ---- Length 3+ ----
    sc_N = {}
    for n in range(3, args.max_sequences + 1):
        print(f"\n=== Length {n} ({n}-gram transitions) ===")
        sc = extract_ngrams(digits, n)
        sc_N[n] = sc
        total_trans = sum(int(c.sum()) for c in sc.values())
        unique_states = len(sc)
        print(f"  Unique states: {unique_states}, total transitions: {total_trans}")

        ranked = rank_sequences(sc, bonferroni_alpha)
        ranked_sorted = sorted(ranked, key=lambda x: abs(x["edge"]), reverse=True)

        entry = {"top_edges": ranked_sorted[:20]}

        if n == 3:
            obs_list = []
            exp_list = []
            for state, counts in sc.items():
                total = int(counts.sum())
                if total > 0:
                    for d_ in range(10):
                        obs_list.append(int(counts[d_]))
                        exp_list.append(total / 10)
            if obs_list:
                chi2_3, p3 = chisquare(obs_list, exp_list)
                entry["chi_sq"] = round(float(chi2_3), 6)
                entry["p_value"] = round(float(p3), 6)
                unif_3 = p3 > bonferroni_alpha
                entry["uniform"] = bool(unif_3)
                print(f"  Chi-squared = {chi2_3:.4f}, p = {p3:.6e}")
                print(f"  Uniform (after Bonferroni): {unif_3}")

        results[f"length{n}"] = entry

    # ---- Autocorrelation ----
    print("\n=== Autocorrelation ===")
    sig_lags, max_lag_sig, acf_all = autocorrelation_test(digits, max_lag=100)
    print(f"  Significant lags (Bonferroni-corrected): {len(sig_lags)}")
    if sig_lags:
        print(f"  Max significant lag: {max_lag_sig}")
        print(f"  First 10 significant lags: {sig_lags[:10]}")
    else:
        print(f"  No significant lags found")
    results["autocorrelation"] = {
        "significant_lags": sig_lags,
        "max_lag_sig": max_lag_sig,
    }

    # ---- Runs test ----
    print("\n=== Runs Test (Wald-Wolfowitz) ===")
    z_run, p_run = runs_test(digits)
    sig_run = p_run < bonferroni_alpha
    print(f"  Z-score: {z_run:.4f}")
    print(f"  P-value: {p_run:.6e}")
    print(f"  Significant (after Bonferroni): {sig_run}")
    results["runs_test"] = {"z_score": z_run, "p_value": p_run}

    # ---- Overall significance ----
    any_sig = False
    length_keys = [k for k in results if k.startswith("length")]
    for lk in length_keys:
        if "p_value" in results[lk] and results[lk]["p_value"] < bonferroni_alpha:
            any_sig = True
    if results["runs_test"]["p_value"] < bonferroni_alpha:
        any_sig = True
    results["any_significant"] = any_sig
    print(f"\nOverall: any significant deviation = {any_sig}")

    # ---- Save JSON ----
    out_dir = os.path.join(os.path.dirname(os.path.abspath(args.input)))
    os.makedirs(out_dir, exist_ok=True)
    json_path = os.path.join(out_dir, "analysis_results.json")
    with open(json_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved {json_path}")

    # ---- Save CSV ----
    all_rows = []
    for n in range(1, args.max_sequences + 1):
        key = f"length{n}"
        if key in results and "top_edges" in results[key]:
            for r in results[key]["top_edges"]:
                row = dict(r)
                row["model"] = key
                all_rows.append(row)
    df = pd.DataFrame(all_rows)
    csv_path = os.path.join(out_dir, "sequence_edges.csv")
    df.to_csv(csv_path, index=False)
    print(f"Saved {csv_path}")

    # ---- Summary ----
    print(f"\n{'=' * 60}")
    print(f"  ANALYSIS SUMMARY — {symbol}")
    print(f"{'=' * 60}")
    print(f"  Total ticks:       {total_ticks}")
    print(f"  Date range:        {date_range[0] if date_range else 'N/A'} – "
          f"{date_range[1] if date_range else 'N/A'}")
    print(f"  Bonferroni alpha:  {bonferroni_alpha:.8f}")
    print(f"  Any significant:   {any_sig}")
    print()
    print(f"  Length-1 χ² = {chi2_1:.4f} (p={p1:.6e}) uniform={uniform_1}")
    print(f"  Length-2 χ² = {chi2_2:.4f} (p={p2:.6e}) uniform={uniform_2}")
    if "length3" in results and "chi_sq" in results["length3"]:
        print(f"  Length-3 χ² = {results['length3']['chi_sq']:.4f} "
              f"(p={results['length3']['p_value']:.6e}) "
              f"uniform={results['length3'].get('uniform', 'N/A')}")
    print(f"  Runs test:  z={z_run:.4f} (p={p_run:.6e})")
    print(f"  Autocorr:   {len(sig_lags)} significant lags "
          f"(max={max_lag_sig})")
    print()

    for n in range(1, min(args.max_sequences + 1, 3)):
        key = f"length{n}"
        ranked_key = locals().get(f"ranked_{n}_sorted")
        if ranked_key is None:
            continue
        pos = [r for r in ranked_key if r["edge"] > 0][:5]
        neg = [r for r in ranked_key if r["edge"] < 0][:5]
        if pos:
            print(f"  Top +{n}-gram edges:")
            for r in pos:
                print(f"    {r['sequence']:>12s}  edge={r['edge']:+.4f}  "
                      f"obs={r['observed_p']:.4f}  count={r['count']}")
        if neg:
            print(f"  Top -{n}-gram edges:")
            for r in neg:
                print(f"    {r['sequence']:>12s}  edge={r['edge']:+.4f}  "
                      f"obs={r['observed_p']:.4f}  count={r['count']}")

    print(f"\n  All results saved to:")
    print(f"    {json_path}")
    print(f"    {csv_path}")


if __name__ == "__main__":
    main()
