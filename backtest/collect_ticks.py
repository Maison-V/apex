#!/usr/bin/env python3
"""Phase 1: Collect historical ticks from Deriv into HDF5."""

import argparse
import json
import os
import sys
import time
import threading
from collections import Counter

import numpy as np
import h5py
from tqdm import tqdm

DERIV_WS = "wss://ws.binaryws.com/websockets/v3?app_id=49941"
BATCH_SIZE = 5000
REQUEST_DELAY = 0.5
REQUEST_TIMEOUT = 30
RECONNECT_DELAY = 2
MAX_RECONNECT_ATTEMPTS = 5


def last_digit(price):
    s = f"{abs(float(price)):.4f}"
    trimmed = "".join(c for c in s if c.isdigit())
    if not trimmed:
        return 0
    return int(trimmed[-1])


def fetch_batch(symbol, end):
    """Fetch one batch of ticks via WebSocket. Returns (prices, times) or None."""
    prices = []
    times = []
    error = [None]
    received = threading.Event()
    ws_ref = [None]

    def on_open(ws):
        payload = {
            "ticks_history": symbol,
            "end": end,
            "count": BATCH_SIZE,
            "style": "ticks",
        }
        ws.send(json.dumps(payload))

    def on_message(ws, message):
        data = json.loads(message)
        if "error" in data:
            error[0] = data["error"]["message"]
            received.set()
            ws.close()
            return
        if data.get("msg_type") == "history":
            history = data.get("history", {})
            prices.extend(history.get("prices", []))
            times.extend(history.get("times", []))
            received.set()
            ws.close()

    def on_error(ws, err):
        if error[0] is None:
            error[0] = str(err)
        received.set()

    def on_close(ws, status_code, msg):
        received.set()

    import websocket

    ws = websocket.WebSocketApp(
        DERIV_WS,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )
    ws_ref[0] = ws

    t = threading.Thread(target=ws.run_forever, daemon=True, name="ws-batch")
    t.start()

    if not received.wait(timeout=REQUEST_TIMEOUT):
        ws.close()
        return None

    if error[0]:
        return None

    if not prices or not times:
        return None

    return (prices, times)


def safe_fetch_batch(symbol, end, max_attempts=MAX_RECONNECT_ATTEMPTS):
    """Fetch with retry on failure."""
    for attempt in range(max_attempts):
        try:
            result = fetch_batch(symbol, end)
            if result is not None:
                return result
        except Exception:
            pass
        if attempt < max_attempts - 1:
            time.sleep(RECONNECT_DELAY * (attempt + 1))
    return None


def save_batch(h5file, prices, times):
    """Append batch data to HDF5 datasets."""
    n = len(prices)
    digits = np.array([last_digit(p) for p in prices], dtype=np.uint8)
    p_arr = np.array(prices, dtype=np.float32)
    t_arr = np.array(times, dtype=np.int64)

    ds_p = h5file["prices"]
    ds_d = h5file["digits"]
    ds_t = h5file["timestamps"]

    current = ds_p.shape[0]
    new_size = current + n

    ds_p.resize((new_size,))
    ds_d.resize((new_size,))
    ds_t.resize((new_size,))

    ds_p[current:new_size] = p_arr
    ds_d[current:new_size] = digits
    ds_t[current:new_size] = t_arr


def create_h5(filepath, init_prices, init_times):
    """Create new HDF5 file with initial data."""
    n = len(init_prices)
    digits = np.array([last_digit(p) for p in init_prices], dtype=np.uint8)
    p_arr = np.array(init_prices, dtype=np.float32)
    t_arr = np.array(init_times, dtype=np.int64)

    with h5py.File(filepath, "w") as f:
        f.create_dataset("prices", data=p_arr, maxshape=(None,),
                         compression="gzip", shuffle=True)
        f.create_dataset("digits", data=digits, maxshape=(None,),
                         compression="gzip", shuffle=True)
        f.create_dataset("timestamps", data=t_arr, maxshape=(None,),
                         compression="gzip", shuffle=True)


def load_existing(filepath):
    """Load existing HDF5 data. Returns (prices, timestamps) or None."""
    if not os.path.exists(filepath):
        return None
    try:
        with h5py.File(filepath, "r") as f:
            prices = f["prices"][:]
            timestamps = f["timestamps"][:]
        return (prices, timestamps)
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser(
        description="Collect historical ticks from Deriv into HDF5")
    parser.add_argument("symbol", nargs="?", default="R_75",
                        help="Deriv symbol (default: R_75)")
    parser.add_argument("target_count", nargs="?", type=int, default=500000,
                        help="Target tick count (default: 500000)")
    args = parser.parse_args()

    symbol = args.symbol
    target_count = args.target_count

    stored_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stored")
    os.makedirs(stored_dir, exist_ok=True)
    filepath = os.path.join(stored_dir, f"ticks_{symbol}.h5")

    all_prices = []
    all_times = []
    existing_count = 0

    existing = load_existing(filepath)
    if existing is not None:
        existing_prices, existing_times = existing
        existing_count = len(existing_prices)
        all_prices = existing_prices.tolist()
        all_times = existing_times.tolist()
        print(f"Resumed: loaded {existing_count} existing ticks from {filepath}")
    else:
        print(f"Starting fresh collection for {symbol}")

    collected = len(all_prices)
    remaining = target_count - collected

    if remaining <= 0:
        print(f"Already have {collected} ticks >= target {target_count}. Nothing to do.")
        return

    # Determine starting end parameter
    if all_times:
        end = int(all_times[0]) - 1
        print(f"Resuming from timestamp {end} (earliest existing: {all_times[0]})")
    else:
        end = "latest"

    pbar = tqdm(total=target_count, unit="ticks", initial=collected,
                desc=f"Collecting {symbol}")
    pbar.update(0)

    empty_batch_count = 0
    consecutive_failures = 0
    start_wall = time.time()

    while collected < target_count:
        result = safe_fetch_batch(symbol, end)
        if result is None:
            consecutive_failures += 1
            pbar.write(f"No data received (attempt {consecutive_failures})")
            if consecutive_failures >= 3:
                pbar.write("Too many consecutive failures, stopping.")
                break
            time.sleep(RECONNECT_DELAY)
            continue

        consecutive_failures = 0
        batch_prices, batch_times = result

        if len(batch_prices) == 0:
            empty_batch_count += 1
            if empty_batch_count >= 2:
                pbar.write("Empty batches received, no more historical data.")
                break
            time.sleep(REQUEST_DELAY)
            continue

        empty_batch_count = 0

        # Deduplicate against existing + new data using timestamps
        existing_set = set(all_times)
        new_prices = []
        new_times = []
        for p, t in zip(batch_prices, batch_times):
            ts = int(t)
            if ts not in existing_set:
                existing_set.add(ts)
                new_prices.append(float(p))
                new_times.append(ts)

        if not new_prices:
            pbar.write(f"All {len(batch_prices)} ticks in batch are duplicates, adjusting end.")
            earliest_ts = int(batch_times[0])
            end = earliest_ts - 1
            time.sleep(REQUEST_DELAY)
            continue

        all_prices.extend(new_prices)
        all_times.extend(new_times)

        # Save to HDF5
        if existing_count == 0 and not os.path.exists(filepath):
            create_h5(filepath, new_prices, new_times)
        else:
            with h5py.File(filepath, "a") as f:
                save_batch(f, new_prices, new_times)

        existing_count += len(new_prices)
        collected += len(new_prices)

        # Update end to earliest timestamp - 1 for pagination
        earliest_ts = min(int(t) for t in new_times)
        end = earliest_ts - 1

        pbar.update(len(new_prices))
        pbar.set_postfix({"end_ts": earliest_ts})

        # Early termination: if we hit very old data (before 2022), stop
        if earliest_ts < 1640995200:  # 2022-01-01
            pbar.write("Reached data before 2022, stopping.")
            break

        time.sleep(REQUEST_DELAY)

    pbar.close()

    elapsed = time.time() - start_wall
    final_count = len(all_prices)

    if final_count == 0:
        print("No ticks collected.")
        return

    rate = final_count / elapsed if elapsed > 0 else 0
    digits_arr = np.array([last_digit(p) for p in all_prices], dtype=np.uint8)
    dist = Counter(digits_arr.tolist())

    print(f"\n{'='*50}")
    print(f"Collection complete for {symbol}")
    print(f"{'='*50}")
    print(f"  Total ticks:  {final_count}")
    print(f"  Date range:   {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(all_times[0]))}"
          f" to {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(all_times[-1]))}")
    print(f"  Elapsed:      {elapsed:.1f}s")
    print(f"  Avg rate:     {rate:.0f} ticks/sec")
    print(f"  File:         {filepath}")
    print(f"  Digit distribution:")
    for d in range(10):
        pct = dist.get(d, 0) / final_count * 100
        bar = "#" * int(pct / 2)
        print(f"    {d}: {dist.get(d, 0):>8} ({pct:5.2f}%) {bar}")


if __name__ == "__main__":
    main()
