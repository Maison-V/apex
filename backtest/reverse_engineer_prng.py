#!/usr/bin/env python3
"""Attempt to reverse-engineer the Deriv synthetic index PRNG from raw tick data."""

import argparse
import json
import os
import struct
import sys

import h5py
import numpy as np
from scipy import stats
from collections import Counter

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORED_DIR = os.path.join(BASE_DIR, "stored")


def load_ticks(path):
    with h5py.File(path, "r") as f:
        prices = f["prices"][:]
        digits = f["digits"][:]
        ts = f["timestamps"][:]
    return prices, digits, ts


def analyze_steps(prices):
    steps = np.diff(prices)
    print(f"\n{'='*60}")
    print(f"  STEP ANALYSIS")
    print(f"{'='*60}")
    print(f"  Steps: {len(steps)}")
    print(f"  Min step: {steps.min():.6f}")
    print(f"  Max step: {steps.max():.6f}")
    print(f"  Mean step: {steps.mean():.6f}")
    print(f"  Std step: {steps.std():.6f}")
    print(f"  Skewness: {stats.skew(steps):.4f}")
    print(f"  Kurtosis: {stats.kurtosis(steps):.4f}")

    # Test for normality
    _, p_norm = stats.normaltest(steps[:10000])
    print(f"  Normality test p-value (first 10K): {p_norm:.6e}")

    # KS test vs normal with same mean/std
    ks_stat, ks_p = stats.kstest(
        (steps - steps.mean()) / steps.std(),
        "norm"
    )
    print(f"  KS test vs N(0,1): stat={ks_stat:.4f}, p={ks_p:.6e}")

    # Check step quantization (are steps multiples of some unit?)
    rounded = np.round(steps, decimals=6)
    unique_steps = len(np.unique(rounded[:10000]))
    print(f"  Unique step values (first 10K): {unique_steps}")

    # Distribution of steps scaled by price (relative step)
    rel_steps = steps / prices[:-1]
    print(f"  Relative step: mean={rel_steps.mean():.6e}, std={rel_steps.std():.6e}")

    return steps, rel_steps


def extract_random_stream(steps):
    """Attempt to recover the underlying uniform random values from steps.
    
    Hypothesis: steps = f^-1(U) where U ~ Uniform(0,1)
    If steps are Gaussian (normal), then U = Phi(steps_norm) where Phi is CDF
    """
    # Standardize steps
    steps_std = (steps - steps.mean()) / steps.std()
    
    # If steps = inverse_normal(U), then U = normal_cdf(steps_std)
    U = stats.norm.cdf(steps_std)
    
    print(f"\n{'='*60}")
    print(f"  RECOVERED UNIFORM STREAM")
    print(f"{'='*60}")
    print(f"  Recovered U values: {len(U)}")
    print(f"  U mean: {U.mean():.6f} (expected 0.5)")
    print(f"  U std:  {U.std():.6f} (expected 0.2887)")
    
    # Chi-squared test on U (bucket into 100 bins)
    bins = 100
    counts, _ = np.histogram(U, bins=bins, range=(0, 1))
    expected = np.full(bins, len(U) / bins)
    chi2, p = stats.chisquare(counts, expected)
    print(f"  Uniformity chi2 ({bins} bins): {chi2:.4f}, p={p:.6e}")
    
    return U


def analyze_bits(U_or_steps, label="stream"):
    """Analyze the bit patterns of the recovered random stream.
    
    For IEEE 754 floats, extract the mantissa bits to look for LCG patterns.
    """
    # If U is in [0,1), convert to a 53-bit integer representation
    if U_or_steps.min() >= 0 and U_or_steps.max() <= 1:
        # Extract bits by scaling
        scaled = np.floor(U_or_steps * (2**53)).astype(np.uint64)
    else:
        scaled = np.floor((U_or_steps - U_or_steps.min()) / 
                          (U_or_steps.max() - U_or_steps.min() + 1e-300) * (2**53)).astype(np.uint64)
    
    print(f"\n{'='*60}")
    print(f"  BIT ANALYSIS — {label}")
    print(f"{'='*60}")
    
    # Check low-order bits for LCG patterns
    for bit in range(8):
        bit_val = (scaled >> bit) & 1
        runs = 1 + np.sum(bit_val[1:] != bit_val[:-1])
        n1 = bit_val.sum()
        n0 = len(bit_val) - n1
        e_runs = 2 * n0 * n1 / (n0 + n1) + 1
        if n0 > 0 and n1 > 0:
            var_runs = 2 * n0 * n1 * (2 * n0 * n1 - n0 - n1) / ((n0 + n1)**2 * (n0 + n1 - 1))
            if var_runs > 0:
                z = (runs - e_runs) / np.sqrt(var_runs)
                p = 2 * (1 - stats.norm.cdf(abs(z)))
            else:
                z, p = 0, 1
        else:
            z, p = 0, 1
        zeros = (bit_val == 0).sum()
        ones = (bit_val == 1).sum()
        print(f"  Bit {bit}: zeros={zeros:>6} ones={ones:>6} "
              f"runs={runs:>6} z={z:+.3f} p={p:.4f}")
    
    # Auto-correlation of low-order bits (LCG signature)
    print(f"\n  Low-bit autocorrelation (LCG detection):")
    for bit in [0, 1, 7]:
        bits = ((scaled >> bit) & 1).astype(np.float64)
        for lag in [1, 2, 3, 5, 10]:
            acf = np.corrcoef(bits[:-lag], bits[lag:])[0, 1] if len(bits) > lag else 0
            if np.isnan(acf):
                acf = 0
            print(f"    Bit {bit}, lag {lag:>2}: ACF = {acf:.6f}")


def test_lcg(U):
    """Test if recovered uniform stream follows a Linear Congruential Generator.
    
    LCG: X_{n+1} = (a * X_n + c) mod m
    For floating point: U_n = X_n / m
    
    If LCG with m = 2^32, 2^48, or 2^64:
    U_{n+1} = (a * U_n + c/m) mod 1
    OR: U_{n+1} - a*U_n should be constant (c/m) modulo 1
    """
    print(f"\n{'='*60}")
    print(f"  LCG DETECTION")
    print(f"{'='*60}")
    
    U_f64 = np.asarray(U, dtype=np.float64)
    
    # Test: pick k and check if U_{n+k} - a*U_n is constant
    # For LCG with modulus m: X_{n+k} = a^k * X_n + c * (a^k - 1)/(a - 1) mod m
    # This means U_{n+k} = a^k * U_n + c*(a^k - 1)/(m*(a-1)) mod 1
    
    # Try common LCG multipliers
    common_lcgs = [
        ("glibc (31 bits)", 1103515245, 12345, 2**31),
        ("Numerical Recipes", 1664525, 1013904223, 2**32),
        ("Borland C/C++", 22695477, 1, 2**32),
        ("glibc (64 bits)", 6364136223846793005, 1442695040888963407, 2**64),
        ("MMIX", 6364136223846793005, 1442695040888963407, 2**64),
        ("Java", 25214903917, 11, 2**48),
        ("randu", 65539, 0, 2**31),
        ("minstd_rand0", 16807, 0, 2**31 - 1),
        ("minstd_rand", 48271, 0, 2**31 - 1),
        ("Microsoft VC++", 214013, 2531011, 2**31),
    ]
    
    # Try to detect LCG: check if (U[n+1] - U[n]) mod 1 follows pattern
    # For simple LCG with m = 2^k, we can look at the floating point representation directly
    
    # Better: check if consecutive pairs (U_n, U_{n+1}) form parallel lines
    # For LCG with modulus 2^k: the high bits are more random than low bits
    # Spectral test: look at the lattice structure
    
    # Plot points: (U_n, U_{n+1}) - LCG produces parallel lines in 2D
    u0 = U_f64[:-1:100]  # subsample for speed
    u1 = U_f64[1::100]
    
    # Check for linear congruence: U_{n+1} = (a * U_n) mod 1
    # This should produce a lattice structure
    # Test by checking if pairs satisfy certain differences
    
    # For each candidate LCG, compute X_n = U_n * m (approximately)
    for name, a, c, m in common_lcgs:
        if m > 2**53:
            continue  # can't represent in float64
        # Convert U to integers
        X = np.round(U_f64 * m).astype(np.int64)
        X = X % m
        # Check LCG recurrence for first 1000 values
        X_next_pred = (a * X[:-1] + c) % m
        matches = (X_next_pred == X[1:]).sum()
        match_rate = matches / len(X_next_pred)
        
        # Check increment pattern
        diffs = np.diff(X)
        expected_diffs = (a * X[:-1] + c - X[:-1]) % m
        
        if match_rate > 0.01:
            print(f"  [{name}] a={a} c={c} m={m}")
            print(f"    Match rate: {match_rate:.6f} ({matches}/{len(X_next_pred)})")
            
            # If high match rate, test more thoroughly
            if match_rate > 0.50:
                # Convert U to double and check exact recurrence
                print(f"    *** HIGH MATCH — possible LCG! ***")
    
    # Check for simple patterns in U
    print(f"\n  Testing for increment patterns:")
    diffs = np.diff(U_f64)
    # Check if diffs modulo 1 has structure
    diffs_mod1 = diffs % 1.0
    
    # Unique diff values
    rounded_diffs = np.round(diffs_mod1 * 1e9).astype(np.int64)
    unique_vals = len(set(rounded_diffs[:5000]))
    print(f"  Unique diff values (first 5K, scaled 1e9): {unique_vals}")
    
    if unique_vals < 100:
        print(f"  *** FEW UNIQUE DIFFS — POSSIBLE LCG ***")
        diff_counts = Counter(rounded_diffs[:5000])
        print(f"  Top diff values:")
        for val, cnt in diff_counts.most_common(10):
            print(f"    {val}: {cnt}")


def test_mt19937(U):
    """Test if the stream matches Mersenne Twister output.
    
    MT19937 generates 32-bit integers. We can check if consecutive
    groups of 2 values fit the characteristic MT distribution.
    """
    print(f"\n{'='*60}")
    print(f"  MT19937 DETECTION")
    print(f"{'='*60}")
    
    U_f64 = np.asarray(U, dtype=np.float64)
    
    # MT19937 generates 32-bit integers: X / 2^32 = U
    X = np.round(U_f64 * (2**32)).astype(np.int64) % (2**32)
    
    # Check for MT tempering patterns
    # The tempering transform is invertible, so if this IS MT output,
    # we could recover the internal state
    # MT has 624-word state; need 624 consecutive 32-bit outputs
    
    # Test: check if the bits follow MT's characteristic distribution
    # For true MT, each bit should be independent
    
    # Try to find the MT state by checking for the characteristic
    # recurrence: x_{i+624} = x_{i+397} XOR f(x_i)
    # where f(x) = (x >> 1) XOR (0x9908b0df if x odd else 0)
    
    # Check correlation at lag 624 and 397
    X_arr = np.asarray(X, dtype=np.uint32)
    for lag in [397, 624, 624+397]:
        if len(X_arr) > lag * 2:
            # Compute correlation of XOR'd values
            xor_acf = np.corrcoef(
                X_arr[:len(X_arr)-lag].astype(np.float64),
                X_arr[lag:].astype(np.float64)
            )[0, 1]
            print(f"  Correlation at lag {lag}: {xor_acf:.6f}")
    
    # Check if we can find tempering matrix
    # For MT, the output is: y = x XOR (x >> 11)
    #   y = y XOR ((y << 7) & 0x9D2C5680)
    #   y = y XOR ((y << 15) & 0xEFC60000)
    #   y = y XOR (y >> 18)
    # We can untemper to recover the internal state
    
    # Untemper a few values
    print(f"\n  MT tempering test (first 10 values):")
    print(f"    Raw U: {U_f64[:10]}")
    print(f"    As uint32: {X[:10]}")
    
    # Check tempering properties
    # MSB of X should be fairly random (for LCG, MSB is most random)
    # For MT, all bits should be equally random
    
    return X


def check_crypto_prng(U):
    """Check if the stream looks like CSPRNG output.
    
    CSPRNG (ChaCha20, AES-CTR) should be indistinguishable from true random.
    """
    print(f"\n{'='*60}")
    print(f"  CSPRNG VERIFICATION")
    print(f"{'='*60}")
    
    U_f64 = np.asarray(U, dtype=np.float64)
    
    # NIST-like SP800-22 tests (simplified)
    # 1. Frequency test (monobit)
    n = len(U_f64)
    mean = U_f64.mean()
    print(f"  Mean: {mean:.6f} (expect 0.5)")
    s = 2 * (U_f64 > 0.5).astype(np.int8) - 1
    S = s.sum()
    s_obs = abs(S) / np.sqrt(n)
    p_freq = stats.norm.cdf(s_obs)
    print(f"  Frequency test: S={S}, s_obs={s_obs:.4f}, p={1-p_freq:.4f}")
    
    # 2. Runs test on bits
    bits = (U_f64 > 0.5).astype(np.int8)
    runs = 1 + np.sum(bits[1:] != bits[:-1])
    n0 = (bits == 0).sum()
    n1 = (bits == 1).sum()
    e_runs = 2 * n0 * n1 / n + 1
    if n0 * n1 > 0:
        var_runs = (e_runs - 1) * (e_runs - 2) / (n - 1)
        z_runs = (runs - e_runs) / np.sqrt(max(var_runs, 1))
        p_runs = 2 * (1 - stats.norm.cdf(abs(z_runs)))
    else:
        z_runs, p_runs = 0, 1
    print(f"  Runs test: runs={runs}, e_runs={e_runs:.1f}, z={z_runs:.4f}, p={p_runs:.4f}")
    
    # 3. Longest run of ones test
    max_run = 0
    current = 0
    for b in bits:
        if b == 1:
            current += 1
            max_run = max(max_run, current)
        else:
            current = 0
    print(f"  Longest run of 1s: {max_run} (expect ~log2(n)={np.log2(n):.0f})")
    
    # 4. Serial test (2-bit overlap)
    pairs = np.array([bits[0::2], bits[1::2]]).T
    pairs = pairs[:len(pairs)-1]
    cnt = Counter(tuple(p) for p in pairs)
    expected_pairs = len(pairs) / 4
    chi2_serial = sum((c - expected_pairs)**2 / expected_pairs for c in cnt.values())
    chi2_serial += (4 - len(cnt)) * expected_pairs  # absent pairs
    p_serial = 1 - stats.chi2.cdf(chi2_serial, 3)
    print(f"  Serial test (2-bit): chi2={chi2_serial:.4f}, p={p_serial:.4f}")
    
    # 5. Spectral test - check for periodic features using FFT
    from numpy.fft import fft
    bits_f = bits.astype(np.float64) * 2 - 1
    spectrum = np.abs(fft(bits_f))
    # Remove DC
    spectrum[0] = 0
    peak = spectrum.max()
    threshold = np.sqrt(np.log(1 / 0.05) * n)
    peaks_above_thresh = (spectrum > threshold).sum()
    print(f"  Spectral test: peak={peak:.1f}, threshold={threshold:.1f}, "
          f"peaks above={peaks_above_thresh}")
    
    # Summary
    failures = 0
    if 1 - p_freq < 0.01: failures += 1
    if p_runs < 0.01: failures += 1
    if p_serial < 0.01: failures += 1
    
    print(f"\n  CSPRNG assessment: {failures}/5 tests failed")
    if failures == 0:
        print(f"  -> Consistent with CSPRNG output")
    else:
        print(f"  -> Some deviations found")


def check_prng_seed_reuse(U):
    """Check if the same PRNG state repeats (seed cycling)."""
    print(f"\n{'='*60}")
    print(f"  SEED REUSE / PERIOD DETECTION")
    print(f"{'='*60}")
    
    U_f64 = np.asarray(U, dtype=np.float64)
    
    # Bucket into 1000 bins and check for repeated patterns
    bin_idx = np.floor(U_f64 * 1000).astype(np.int32)
    
    # Check for repeated subsequences of length 10
    seq_len = 10
    hashes = {}
    found_dup = False
    for i in range(len(bin_idx) - seq_len):
        h = hash(tuple(bin_idx[i:i+seq_len]))
        if h in hashes:
            if i - hashes[h] > seq_len:
                print(f"  Repeated sequence of {seq_len} at idx {hashes[h]} and {i}")
                found_dup = True
                break
        else:
            hashes[h] = i
    
    if not found_dup:
        # Check with shorter sequences
        for sl in [5, 6, 8]:
            hashes = {}
            for i in range(len(bin_idx) - sl):
                h = hash(tuple(bin_idx[i:i+sl]))
                if h in hashes:
                    if i - hashes[h] > sl:
                        print(f"  Repeated sequence of {sl} at idx {hashes[h]} and {i}")
                        found_dup = True
                        break
                else:
                    hashes[h] = i
            if found_dup:
                break
    
    if not found_dup:
        # Partial match with tolerance
        print(f"  No exact repeats found (searching {len(bin_idx)} values)")


def main():
    parser = argparse.ArgumentParser(
        description="Reverse-engineer Deriv synthetic index PRNG"
    )
    parser.add_argument(
        "--input",
        default="stored/ticks_R_75.h5",
        help="Path to HDF5 file",
    )
    parser.add_argument(
        "--max-samples",
        type=int,
        default=0,
        help="Max samples to analyze (0 = all)",
    )
    args = parser.parse_args()
    
    path = os.path.join(BASE_DIR, args.input) if not os.path.isabs(args.input) else args.input
    print(f"Loading {path}...")
    prices, digits, ts = load_ticks(path)
    
    if args.max_samples > 0:
        prices = prices[:args.max_samples]
        digits = digits[:args.max_samples]
        ts = ts[:args.max_samples]
    
    print(f"Loaded {len(prices)} ticks")
    print(f"Symbol: R_75")
    print(f"Price range: {prices.min():.4f} - {prices.max():.4f}")
    print(f"Price dtype: {prices.dtype}")
    
    # Step 1: Analyze step distribution
    steps, rel_steps = analyze_steps(prices)
    
    # Step 2: Recover uniform random stream from steps
    U = extract_random_stream(steps)
    
    # Step 3: Bit-level analysis
    analyze_bits(U, "recovered_U")
    
    # Step 4: LCG detection
    test_lcg(U)
    
    # Step 5: MT19937 detection
    X = test_mt19937(U)
    
    # Step 6: CSPRNG verification
    check_crypto_prng(U)
    
    # Step 7: Seed reuse check
    check_prng_seed_reuse(U)
    
    print(f"\n{'='*60}")
    print(f"  REVERSE ENGINEERING COMPLETE")
    print(f"{'='*60}")
    print(f"\nNOTE: If no LCG/MT pattern found, try:")
    print(f"  1. Collect more data (Deriv may reseed periodically)")
    print(f"  2. Look for non-uniformity in float exponent bits")
    print(f"  3. Check if steps use Box-Muller transform instead of inverse CDF")
    print(f"  4. Try different data mappings (e.g. prices may use multiple PRNG calls)")


if __name__ == "__main__":
    main()
