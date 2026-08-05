export type StrategyId = "consecutive_counter";

export interface EngineConfig {
  symbol: string;
  riskPercent: number;
  duration: number;
  durationUnit: string;
  lookback: number;
  strategyId?: string;
}

interface EngineState {
  upCounter: number;
  downCounter: number;
  lastPrice: number | null;
  currentPrice: number | null;
  prevPrice: number | null;
}

interface EngineStats {
  wins: number;
  losses: number;
  totalTrades: number;
  totalProfit: number;
  startBalance: number;
  peakBalance: number;
}

export interface TradeLogEntry {
  timestamp: string;
  symbol: string;
  direction: string;
  stake: number;
  entryTick: number | null;
  exitTick: number | null;
  profit: number;
  balanceAfter: number;
  status: string;
  contractId?: number;
  transactionId?: number;
}

interface StrategyImpl {
  name: string;
  lookback: number;
  onTick: (
    tick: number,
    state: EngineState,
    config: EngineConfig
  ) => { action: string; reason: string } | null;
}

interface EngineEvent {
  type: string;
  config?: EngineConfig;
  state?: EngineState;
  message?: string;
  direction?: string;
  stake?: number;
  balance?: number;
  result?: unknown;
  stats?: EngineStats;
  log?: TradeLogEntry;
}

type EngineListener = (data: EngineEvent) => void;

interface DerivServiceLike {
  subscribeSymbol(sym: string): void;
  subscribe(fn: (sym: string, price: number, ts: string) => void): () => void;
}

interface TradingServiceLike {
  isConnected(): boolean;
  getBalance(): { balance: number; currency?: string };
  placeTrade(args: {
    contract_type: string;
    symbol: string;
    amount: number;
    duration: number;
    duration_unit: string;
  }): Promise<{
    status?: string;
    profit?: number;
    balanceAfter?: number;
    contractId?: number;
    transactionId?: number;
  } | null>;
}

class TradingEngine {
  private derivService: DerivServiceLike | null = null;
  private tradingService: TradingServiceLike | null = null;
  private strategies = new Map<string, StrategyImpl>();
  private activeStrategyId: string | null = null;
  private running = false;
  private pendingTrade = false;
  private listeners = new Set<EngineListener>();
  private _unsubTick: (() => void) | null = null;

  private config: EngineConfig = {
    symbol: "BOOM500",
    riskPercent: 80,
    duration: 1,
    durationUnit: "t",
    lookback: 5,
  };

  private state: EngineState = {
    upCounter: 0,
    downCounter: 0,
    lastPrice: null,
    currentPrice: null,
    prevPrice: null,
  };

  private stats: EngineStats = {
    wins: 0,
    losses: 0,
    totalTrades: 0,
    totalProfit: 0,
    startBalance: 0,
    peakBalance: 0,
  };

  private tradeLog: TradeLogEntry[] = [];
  private currentContract: unknown = null;

  constructor() {
    this.registerStrategy("consecutive_counter", {
      name: "Consecutive Counter",
      lookback: 5,
      onTick(tick, state, config) {
        if (state.lastPrice === null) return null;
        if (tick > state.lastPrice) {
          state.upCounter++;
          state.downCounter = 0;
        } else if (tick < state.lastPrice) {
          state.downCounter++;
          state.upCounter = 0;
        }
        const lb = config.lookback || 5;
        if (state.upCounter >= lb) {
          state.upCounter = 0;
          state.downCounter = 0;
          return { action: "CALL", reason: `${lb} consecutive up ticks` };
        }
        if (state.downCounter >= lb) {
          state.downCounter = 0;
          state.upCounter = 0;
          return { action: "PUT", reason: `${lb} consecutive down ticks` };
        }
        return null;
      },
    });
  }

  init(derivService: DerivServiceLike, tradingService: TradingServiceLike) {
    this.derivService = derivService;
    this.tradingService = tradingService;
  }

  registerStrategy(id: string, impl: StrategyImpl) {
    this.strategies.set(id, impl);
  }

  getStrategies(): Record<string, { name: string; lookback: number }> {
    const result: Record<string, { name: string; lookback: number }> = {};
    this.strategies.forEach((impl, id) => {
      result[id] = { name: impl.name, lookback: impl.lookback };
    });
    return result;
  }

  async start(config: Partial<EngineConfig>) {
    if (this.running) return;
    if (!this.derivService || !this.tradingService) {
      this.notify({ type: "error", message: "Engine not initialized" });
      return;
    }
    if (!this.tradingService.isConnected()) {
      this.notify({ type: "error", message: "Trading service not connected" });
      return;
    }

    this.config = { ...this.config, ...config };
    this.activeStrategyId = this.config.strategyId || "consecutive_counter";
    this.running = true;
    this.pendingTrade = false;
    this.currentContract = null;
    this.resetState();

    const bal = this.tradingService.getBalance();
    this.stats.startBalance = bal.balance || 0;
    this.stats.peakBalance = bal.balance || 0;

    const symbol = this.config.symbol;
    this.derivService.subscribeSymbol(symbol);

    this._unsubTick = this.derivService.subscribe((sym, price) => {
      if (!this.running || sym !== symbol) return;
      this.processTick(price);
    });

    this.notify({ type: "started", config: this.config });
  }

  stop() {
    this.running = false;
    this.pendingTrade = false;
    this.currentContract = null;
    if (this._unsubTick) {
      this._unsubTick();
      this._unsubTick = null;
    }
    this.notify({ type: "stopped" });
  }

  emergencyStop() {
    this.stop();
  }

  private processTick(price: number) {
    const previousTickPrice = this.state.currentPrice;

    this.state.prevPrice = this.state.lastPrice;
    this.state.lastPrice = previousTickPrice;
    this.state.currentPrice = price;

    if (previousTickPrice === null) {
      this.notify({ type: "state_update", state: { ...this.state } });
      return;
    }

    const strategy = this.strategies.get(this.activeStrategyId!);
    if (strategy) {
      const signal = strategy.onTick(price, this.state, this.config);
      if (signal && !this.pendingTrade) {
        this.executeTrade(signal.action);
      }
    }

    this.notify({ type: "state_update", state: { ...this.state } });
  }

  private async executeTrade(direction: string) {
    if (this.pendingTrade || !this.running) return;
    this.pendingTrade = true;
    this.notify({ type: "trade_start", direction });

    try {
      const bal = this.tradingService!.getBalance();
      const balance = bal.balance;
      if (!balance || balance < 1) {
        this.notify({ type: "error", message: `Insufficient balance: ${balance}` });
        this.pendingTrade = false;
        this.stop();
        return;
      }

      const stake = Math.max(Math.round((balance * this.config.riskPercent) / 100 * 100) / 100, 1);
      if (stake > balance) {
        this.notify({ type: "error", message: `Stake $${stake} exceeds balance $${balance}` });
        this.pendingTrade = false;
        this.stop();
        return;
      }

      this.notify({ type: "stake_calculated", stake, balance });

      const result = await this.tradingService!.placeTrade({
        contract_type: direction,
        symbol: this.config.symbol,
        amount: stake,
        duration: this.config.duration,
        duration_unit: this.config.durationUnit,
      });

      if (result) {
        this.stats.totalTrades++;
        if (result.status === "won") this.stats.wins++;
        else if (result.status === "lost") this.stats.losses++;
        this.stats.totalProfit += result.profit || 0;

        const newBal = result.balanceAfter || balance + (result.profit || 0);
        if (newBal > this.stats.peakBalance) this.stats.peakBalance = newBal;

        const logEntry: TradeLogEntry = {
          timestamp: new Date().toISOString(),
          symbol: this.config.symbol,
          direction,
          stake,
          entryTick: this.state.prevPrice,
          exitTick: this.state.currentPrice,
          profit: result.profit || 0,
          balanceAfter: newBal,
          status: result.status || "pending",
          contractId: result.contractId,
          transactionId: result.transactionId,
        };
        this.tradeLog.push(logEntry);
        this.currentContract = null;

        this.notify({
          type: "trade_complete",
          result,
          stats: { ...this.stats },
          log: logEntry,
        });
      } else {
        this.notify({ type: "error", message: "Trade failed - no result from broker" });
      }
    } catch (err) {
      this.notify({ type: "error", message: `Trade error: ${(err as Error).message}` });
    }

    this.pendingTrade = false;
  }

  getState() {
    return {
      config: { ...this.config },
      state: { ...this.state },
      stats: { ...this.stats },
      running: this.running,
      pendingTrade: this.pendingTrade,
      tradeCount: this.tradeLog.length,
    };
  }

  getTradeLog(): TradeLogEntry[] {
    return [...this.tradeLog];
  }

  exportCsv(): string {
    const headers = [
      "Timestamp", "Symbol", "Direction", "Stake", "Entry Tick",
      "Exit Tick", "Profit/Loss", "Balance After", "Status",
      "Contract ID", "Transaction ID",
    ];
    const rows = this.tradeLog.map((t) => [
      t.timestamp, t.symbol, t.direction, t.stake.toFixed(2),
      t.entryTick, t.exitTick, t.profit.toFixed(2),
      t.balanceAfter.toFixed(2), t.status, t.contractId, t.transactionId,
    ]);
    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  private resetState() {
    this.state = { upCounter: 0, downCounter: 0, lastPrice: null, currentPrice: null, prevPrice: null };
    this.stats = { wins: 0, losses: 0, totalTrades: 0, totalProfit: 0, startBalance: 0, peakBalance: 0 };
  }

  resetStats() {
    this.resetState();
    this.tradeLog = [];
    const bal = this.tradingService?.getBalance();
    this.stats.startBalance = bal?.balance || 0;
    this.stats.peakBalance = bal?.balance || 0;
  }

  subscribe(fn: EngineListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(data: EngineEvent) {
    this.listeners.forEach((fn) => fn(data));
  }
}

export const tradingEngine = new TradingEngine();