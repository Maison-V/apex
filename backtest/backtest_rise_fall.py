#!/usr/bin/env python3
"""
Comprehensive Rise/Fall strategy backtest on Deriv synthetic indices.

Tests: MA Crossover, Bollinger Bands, RSI, Momentum, Volatility Breakout,
       Range Breakout, Mean Reversion, Combined signals.
"""

import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field

import h5py
import numpy as np
from scipy import stats


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORED_DIR = os.path.join(BASE_DIR, "stored")


@dataclass
class Trade:
    idx: int
    direction: int  # 1 = Rise, -1 = Fall
    entry_price: float
    exit_price: float
    won: bool
    payout: float


@dataclass
class BacktestResult:
    name: str
    trades: list = field(default_factory=list)
    
    @property
    def n_trades(self):
        return len(self.trades)
    
    @property
    def win_rate(self):
        if not self.trades:
            return 0
        return sum(1 for t in self.trades if t.won) / len(self.trades)
    
    @property
    def wins(self):
        return sum(1 for t in self.trades if t.won)
    
    @property
    def losses(self):
        return sum(1 for t in self.trades if not t.won)
    
    def stats(self, payout=0.92, stake=10.0):
        if not self.trades:
            return {}
        wr = self.win_rate
        ev = wr * payout - (1 - wr)  # per $1
        
        capital = 1000.0
        equity = [capital]
        for t in self.trades:
            if t.won:
                capital += stake * payout
            else:
                capital -= stake
            equity.append(capital)
        
        equity = np.array(equity)
        peak = np.maximum.accumulate(equity)
        dd = (peak - equity) / peak
        max_dd = dd.max()
        
        profit = capital - 1000.0
        pf = (self.wins * stake * payout) / (self.losses * stake) if self.losses > 0 else float('inf')
        
        # Sharpe
        returns = np.diff(equity)
        sharpe = returns.mean() / returns.std() * np.sqrt(252 * 24 * 60) if returns.std() > 0 else 0
        
        # Wilson CI for win rate
        z = 1.96
        n = self.n_trades
        p = wr
        wilson_lower = (p + z*z/(2*n) - z*np.sqrt((p*(1-p) + z*z/(4*n))/n)) / (1 + z*z/n)
        wilson_upper = (p + z*z/(2*n) + z*np.sqrt((p*(1-p) + z*z/(4*n))/n)) / (1 + z*z/n)
        
        breakeven = 1 / (1 + payout)
        
        return {
            "strategy": self.name,
            "trades": self.n_trades,
            "wins": self.wins,
            "losses": self.losses,
            "win_rate": round(wr, 4),
            "wilson_ci_95": (round(wilson_lower, 4), round(wilson_upper, 4)),
            "breakeven_wr": round(breakeven, 4),
            "profitable": wr > breakeven and wilson_lower > breakeven,
            "ev_per_dollar": round(ev, 4),
            "total_profit": round(profit, 2),
            "max_drawdown_pct": round(max_dd * 100, 2),
            "profit_factor": round(pf, 4),
            "sharpe": round(sharpe, 4),
            "final_capital": round(capital, 2),
        }


def load_data(path):
    with h5py.File(path, "r") as f:
        prices = f["prices"][:]
        digits = f["digits"][:]
        ts = f["timestamps"][:]
    return prices, digits, ts


def compute_indicators(prices):
    """Compute technical indicators for a price series."""
    n = len(prices)
    
    # Moving averages
    ma5 = np.full(n, np.nan)
    ma10 = np.full(n, np.nan)
    ma20 = np.full(n, np.nan)
    ma50 = np.full(n, np.nan)
    for i in range(n):
        if i >= 4: ma5[i] = np.mean(prices[max(0,i-4):i+1])
        if i >= 9: ma10[i] = np.mean(prices[max(0,i-9):i+1])
        if i >= 19: ma20[i] = np.mean(prices[max(0,i-19):i+1])
        if i >= 49: ma50[i] = np.mean(prices[max(0,i-49):i+1])
    
    # Bollinger Bands (20,2)
    bb_upper = np.full(n, np.nan)
    bb_lower = np.full(n, np.nan)
    bb_mid = np.full(n, np.nan)
    for i in range(19, n):
        window = prices[i-19:i+1]
        m = np.mean(window)
        s = np.std(window)
        bb_mid[i] = m
        bb_upper[i] = m + 2 * s
        bb_lower[i] = m - 2 * s
    
    # RSI (14)
    rsi = np.full(n, np.nan)
    for i in range(14, n):
        gains = 0
        losses = 0
        for j in range(i-13, i+1):
            diff = prices[j] - prices[j-1]
            if diff > 0:
                gains += diff
            else:
                losses -= diff
        if losses == 0:
            rsi[i] = 100
        else:
            rs = gains / losses / 14
            rsi[i] = 100 - 100 / (1 + rs)
    
    # Stochastic (14,3)
    stoch_k = np.full(n, np.nan)
    for i in range(13, n):
        low14 = np.min(prices[i-13:i+1])
        high14 = np.max(prices[i-13:i+1])
        if high14 > low14:
            stoch_k[i] = (prices[i] - low14) / (high14 - low14) * 100
    
    # ATR (14)
    atr = np.full(n, np.nan)
    for i in range(14, n):
        tr = 0
        for j in range(i-13, i+1):
            hl = prices[j] - prices[j-1]
            tr += abs(hl)
        atr[i] = tr / 14
    
    # MACD
    macd = np.full(n, np.nan)
    signal = np.full(n, np.nan)
    ema12 = np.full(n, np.nan)
    ema26 = np.full(n, np.nan)
    # Simple EMA calculation
    for i in range(n):
        if i == 0:
            ema12[i] = prices[i]
            ema26[i] = prices[i]
        else:
            ema12[i] = prices[i] * (2/13) + ema12[i-1] * (11/13)
            ema26[i] = prices[i] * (2/27) + ema26[i-1] * (25/27)
        macd[i] = ema12[i] - ema26[i]
    for i in range(8, n):
        if i == 8:
            signal[i] = np.mean(macd[i-8:i+1])
        else:
            signal[i] = macd[i] * (2/10) + signal[i-1] * (8/10)
    
    return {
        "ma5": ma5, "ma10": ma10, "ma20": ma20, "ma50": ma50,
        "bb_upper": bb_upper, "bb_lower": bb_lower, "bb_mid": bb_mid,
        "rsi": rsi, "stoch_k": stoch_k, "atr": atr,
        "macd": macd, "macd_signal": signal,
    }


def run_strategies(prices):
    """Run all Rise/Fall strategies and return results."""
    n = len(prices)
    ind = compute_indicators(prices)
    
    strategies = {}
    
    # 1. MA Crossover (5/20)
    trades = []
    position = 0  # 1 = long (bet Rise), -1 = short (bet Fall)
    for i in range(50, n - 2):
        if not np.isnan(ind["ma5"][i]) and not np.isnan(ind["ma20"][i]):
            if ind["ma5"][i] > ind["ma20"][i] and ind["ma5"][i-1] <= ind["ma20"][i-1]:
                direction = 1  # Rise
                entry = prices[i]
                exit_p = prices[i+1]
                won = exit_p > entry
                trades.append(Trade(idx=i, direction=direction, entry_price=entry, exit_price=exit_p, won=won, payout=0.92))
            elif ind["ma5"][i] < ind["ma20"][i] and ind["ma5"][i-1] >= ind["ma20"][i-1]:
                direction = -1  # Fall
                entry = prices[i]
                exit_p = prices[i+1]
                won = exit_p < entry
                trades.append(Trade(idx=i, direction=direction, entry_price=entry, exit_price=exit_p, won=won, payout=0.92))
    strategies["MA Crossover (5/20)"] = trades
    
    # 2. Bollinger Bounce
    trades = []
    for i in range(50, n - 2):
        bb_lower = ind["bb_lower"][i]
        bb_upper = ind["bb_upper"][i]
        if np.isnan(bb_lower):
            continue
        price = prices[i]
        if price <= bb_lower:
            # Oversold - bet Rise
            won = prices[i+1] > price
            trades.append(Trade(idx=i, direction=1, entry_price=price, exit_price=prices[i+1], won=won, payout=0.92))
        elif price >= bb_upper:
            # Overbought - bet Fall
            won = prices[i+1] < price
            trades.append(Trade(idx=i, direction=-1, entry_price=price, exit_price=prices[i+1], won=won, payout=0.92))
    strategies["Bollinger Bounce"] = trades
    
    # 3. RSI Mean Reversion
    trades = []
    for i in range(50, n - 2):
        r = ind["rsi"][i]
        if np.isnan(r):
            continue
        if r < 25:
            # Oversold - bet Rise
            won = prices[i+1] > prices[i]
            trades.append(Trade(idx=i, direction=1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
        elif r > 75:
            # Overbought - bet Fall
            won = prices[i+1] < prices[i]
            trades.append(Trade(idx=i, direction=-1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
    strategies["RSI <25/>75"] = trades
    
    # 4. RSI 30/70
    trades = []
    for i in range(50, n - 2):
        r = ind["rsi"][i]
        if np.isnan(r):
            continue
        if r < 30:
            won = prices[i+1] > prices[i]
            trades.append(Trade(idx=i, direction=1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
        elif r > 70:
            won = prices[i+1] < prices[i]
            trades.append(Trade(idx=i, direction=-1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
    strategies["RSI <30/>70"] = trades
    
    # 5. Momentum (price > MA20 = Rise, < MA20 = Fall)
    trades = []
    for i in range(50, n - 2):
        ma = ind["ma20"][i]
        if np.isnan(ma):
            continue
        if prices[i] > ma:
            won = prices[i+1] > prices[i]
            trades.append(Trade(idx=i, direction=1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
        elif prices[i] < ma:
            won = prices[i+1] < prices[i]
            trades.append(Trade(idx=i, direction=-1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
    strategies["Momentum (price vs MA20)"] = trades
    
    # 6. Volatility Breakout (step > 2*avg_step = momentum continues)
    trades = []
    steps = np.diff(prices)
    for i in range(60, n - 2):
        recent_steps = steps[i-20:i]
        avg_step = np.mean(np.abs(recent_steps))
        last_step = steps[i-1]
        if abs(last_step) > 1.5 * avg_step and avg_step > 0:
            if last_step > 0:
                # Big up step - bet Rise (momentum continues)
                won = prices[i+1] > prices[i]
                trades.append(Trade(idx=i, direction=1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
            else:
                # Big down step - bet Fall
                won = prices[i+1] < prices[i]
                trades.append(Trade(idx=i, direction=-1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
    strategies["Volatility Breakout"] = trades
    
    # 7. Range Breakout (price breaks 20-tick high/low)
    trades = []
    for i in range(50, n - 2):
        recent_high = np.max(prices[i-20:i])
        recent_low = np.min(prices[i-20:i])
        if prices[i] > recent_high:
            # Breakout up - bet Rise
            won = prices[i+1] > prices[i]
            trades.append(Trade(idx=i, direction=1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
        elif prices[i] < recent_low:
            # Breakout down - bet Fall
            won = prices[i+1] < prices[i]
            trades.append(Trade(idx=i, direction=-1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
    strategies["Range Breakout (20)"] = trades
    
    # 8. Consecutive candle strategy (2 same direction = reversal)
    trades = []
    for i in range(50, n - 2):
        if prices[i] > prices[i-1] and prices[i-1] > prices[i-2]:
            # 2 consecutive up ticks - bet reversal (Fall)
            won = prices[i+1] < prices[i]
            trades.append(Trade(idx=i, direction=-1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
        elif prices[i] < prices[i-1] and prices[i-1] < prices[i-2]:
            # 2 consecutive down ticks - bet reversal (Rise)
            won = prices[i+1] > prices[i]
            trades.append(Trade(idx=i, direction=1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
    strategies["2-Tick Reversal"] = trades
    
    # 9. MACD Crossover
    trades = []
    for i in range(50, n - 2):
        m = ind["macd"][i]
        s = ind["macd_signal"][i]
        if np.isnan(m) or np.isnan(s):
            continue
        m_prev = ind["macd"][i-1]
        s_prev = ind["macd_signal"][i-1]
        if not np.isnan(m_prev) and not np.isnan(s_prev):
            if m > s and m_prev <= s_prev:
                won = prices[i+1] > prices[i]
                trades.append(Trade(idx=i, direction=1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
            elif m < s and m_prev >= s_prev:
                won = prices[i+1] < prices[i]
                trades.append(Trade(idx=i, direction=-1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
    strategies["MACD Crossover"] = trades
    
    # 10. Stochastic Oversold/Overbought
    trades = []
    for i in range(50, n - 2):
        k = ind["stoch_k"][i]
        if np.isnan(k):
            continue
        if k < 20:
            won = prices[i+1] > prices[i]
            trades.append(Trade(idx=i, direction=1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
        elif k > 80:
            won = prices[i+1] < prices[i]
            trades.append(Trade(idx=i, direction=-1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
    strategies["Stochastic <20/>80"] = trades
    
    # 11. Step size + direction combined (our earlier signal)
    trades = []
    for i in range(60, n - 2):
        recent_steps = steps[i-15:i]
        if len(recent_steps) == 0:
            continue
        avg_step_size = np.mean(np.abs(recent_steps))
        last_step = steps[i-1]
        if avg_step_size > 0 and abs(last_step) > avg_step_size:
            # Large step - momentum continues
            direction = 1 if last_step > 0 else -1
            won = (prices[i+1] > prices[i]) if direction == 1 else (prices[i+1] < prices[i])
            trades.append(Trade(idx=i, direction=direction, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
    strategies["Step Momentum"] = trades
    
    
    # 12. Baseline: Always Rise
    trades = []
    for i in range(50, n - 2):
        won = prices[i+1] > prices[i]
        trades.append(Trade(idx=i, direction=1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
    strategies["Always Rise"] = trades
    
    # 13. Baseline: Always Fall
    trades = []
    for i in range(50, n - 2):
        won = prices[i+1] < prices[i]
        trades.append(Trade(idx=i, direction=-1, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
    strategies["Always Fall"] = trades
    
    # 14. Baseline: Alternate (Rise, Fall, Rise, Fall...)
    trades = []
    for i in range(50, n - 2):
        direction = 1 if i % 2 == 0 else -1
        won = (prices[i+1] > prices[i]) if direction == 1 else (prices[i+1] < prices[i])
        trades.append(Trade(idx=i, direction=direction, entry_price=prices[i], exit_price=prices[i+1], won=won, payout=0.92))
    strategies["Alternate"] = trades
    
    return strategies


def main():
    path = os.path.join(STORED_DIR, "ticks_R_75.h5")
    print(f"Loading {path}...")
    prices, digits, ts = load_data(path)
    print(f"Loaded {len(prices)} ticks")
    
    print(f"\n{'='*70}")
    print(f"  RISK/FALL STRATEGY BACKTEST — R_75")
    print(f"{'='*70}")
    print(f"  Period: {len(prices)} ticks")
    print(f"  Payout: 92% (breakeven WR = 52.08%)")
    print(f"  Stake: $10 per trade")
    
    results = run_strategies(prices)
    
    stats_list = []
    for name, trades in results.items():
        bt = BacktestResult(name=name, trades=trades)
        s = bt.stats(payout=0.92, stake=10.0)
        stats_list.append(s)
    
    stats_list.sort(key=lambda x: -x["win_rate"])
    
    print(f"\n{'='*120}")
    print(f"  {'Strategy':>30s} | {'Trades':>6s} | {'WR':>6s} | "
          f"{'EV/$':>6s} | {'Profit':>10s} | {'DD%':>6s} | {'PF':>6s} | "
          f"{'Sharpe':>7s} | {'Profitable?':>10s}")
    print(f"{'='*120}")
    
    for s in stats_list:
        prof_flag = "*** PROFIT ***" if s["profitable"] else (
            "WILSON>" if s["win_rate"] > s["breakeven_wr"] else ""
        )
        print(f"  {s['strategy']:>30s} | {s['trades']:>6d} | "
              f"{s['win_rate']:.4f} | {s['ev_per_dollar']:+.4f} | "
              f"${s['total_profit']:>+8.2f} | {s['max_drawdown_pct']:>5.1f}% | "
              f"{s['profit_factor']:>6.3f} | {s['sharpe']:>7.4f} | {prof_flag:>10s}")
    
    # Save results
    out = {
        "symbol": "R_75",
        "ticks": len(prices),
        "payout": 0.92,
        "breakeven_wr": 1/(1+0.92),
        "strategies": stats_list,
    }
    out_path = os.path.join(STORED_DIR, "rise_fall_backtest.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nSaved to {out_path}")
    
    # Best strategy summary
    best = stats_list[0]
    profitable = [s for s in stats_list if s["profitable"]]
    print(f"\n{'='*70}")
    print(f"  BEST STRATEGY: {best['strategy']}")
    print(f"  Win rate: {best['win_rate']:.4f} (need {best['breakeven_wr']:.4f})")
    print(f"  Wilson 95% CI: ({best['wilson_ci_95'][0]:.4f}, {best['wilson_ci_95'][1]:.4f})")
    print(f"  Trades: {best['trades']}")
    print(f"  Profit: ${best['total_profit']}")
    print(f"  Profitable at 95% confidence: {best['profitable']}")
    print()
    
    if profitable:
        best_p = profitable[0]
        print(f"  MOST PROFITABLE (stat sig): {best_p['strategy']}")
        print(f"  WR={best_p['win_rate']:.4f} CI=({best_p['wilson_ci_95'][0]:.4f},{best_p['wilson_ci_95'][1]:.4f})")
    else:
        print(f"  NO strategy is profitable at 95% confidence.")
        # Find the one closest to breakeven
        closest = min(stats_list, key=lambda x: abs(x["win_rate"] - x["breakeven_wr"]))
        print(f"  Closest: {closest['strategy']} WR={closest['win_rate']:.4f} "
              f"(need {closest['breakeven_wr']:.4f})")


if __name__ == "__main__":
    main()
