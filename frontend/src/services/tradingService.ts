const DERIV_APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID || "1089";
const WS_APP_ID = process.env.NEXT_PUBLIC_DERIV_WS_APP_ID || "1089";

export interface Balance {
  balance: number;
  currency: string;
  loginid?: string;
  account_type?: string;
  email?: string;
  fullname?: string;
}

interface Contract {
  id?: number;
  transactionId?: number;
  balanceAfter?: number;
  buyPrice?: number;
  longcode?: string;
  startTime?: number;
  status?: string;
  profit?: number;
  buy_price?: number;
  sell_price?: number;
  contract_id?: number;
}

type TradingEvent = Record<string, unknown> & {
  type: string;
  message?: string;
  code?: string;
  echo_req?: unknown;
  balance?: number;
};

type TradingListener = (data: TradingEvent) => void;

class TradingService {
  private ws: WebSocket | null = null;
  private _pat: string | null = null;
  private _appId: string | null = null;
  private _accountId: string | null = null;
  private _accountType = "demo";
  private connected = false;
  private balances: Balance = { balance: 0, currency: "USD" };
  private proposals = new Map<string, unknown>();
  private contracts: Contract[] = [];
  private listeners = new Set<TradingListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _intentionalClose = false;
  private _reconnectAttempts = 0;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private _pendingContractIds = new Set<number>();
  private _authorizing = false;
  private _isOAuth = false;
  private _wsGen = 0;

  private _reset() {
    this.ws = null;
    this._accountId = null;
    this.connected = false;
    this._authorizing = false;
    this._stopHeartbeat();
  }

  private _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      try {
        this.ws?.send(JSON.stringify({ ping: 1 }));
      } catch {
        /* ignore */
      }
    }, 30000);
  }

  private _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  setPat(pat: string) {
    this._pat = pat;
  }

  setAppId(id: string) {
    this._appId = id;
  }

  setAccountType(type: string) {
    this._accountType = type || "demo";
  }

  isConnected() {
    return this.connected;
  }

  getBalance(): Balance {
    return this.balances;
  }

  private _fail(message: string) {
    if (this._connectTimeout) clearTimeout(this._connectTimeout);
    this._stopHeartbeat();
    this.connected = false;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.notify({ type: "error", message });
  }

  async #fetchAccounts(): Promise<{ account_id: string; balance: string | number; currency?: string; account_type: string }[]> {
    const appId = this._appId || DERIV_APP_ID;
    const res = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      headers: {
        Authorization: `Bearer ${this._pat}`,
        "Deriv-App-ID": appId,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data || [];
  }

  async #getOTP(accountId: string): Promise<string> {
    const appId = this._appId || DERIV_APP_ID;
    const res = await fetch(
      `https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this._pat}`,
          "Deriv-App-ID": appId,
          "Content-Type": "application/json",
        },
        body: "{}",
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data?.url || "";
  }

  connectWithOAuth(token: string, accountType = "demo"): Promise<boolean> {
    this._pat = token;
    this._accountType = accountType;
    this._intentionalClose = false;
    this._isOAuth = true;
    this._authorizing = true;

    if (this.ws) {
      const oldWs = this.ws;
      oldWs.onclose = null;
      oldWs.onerror = null;
      oldWs.onmessage = null;
      oldWs.close();
      this.ws = null;
    }

    this.notify({ type: "status", message: "Authorizing with Deriv..." });

    const wsUrl = `wss://ws.binaryws.com/websockets/v3?app_id=${WS_APP_ID}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    this._wsGen += 1;
    const gen = this._wsGen;

    return new Promise((resolve) => {
      const onConnected = () => {
        unsub();
        resolve(true);
      };
      const onError = (d: TradingEvent) => {
        unsub();
        this._fail(d.message || "Authorization failed");
        resolve(false);
      };
      const unsub = this.subscribe((d) => {
        if (gen !== this._wsGen) return;
        if (d.type === "connected") onConnected();
        else if (d.type === "error") onError(d);
      });
      this._connectTimeout = setTimeout(() => {
        unsub();
        this._fail("Connection timed out — check Deriv app_id and network");
        resolve(false);
      }, 20000);

      ws.onopen = () => {
        ws.send(JSON.stringify({ authorize: token }));
      };

      ws.onclose = (e) => {
        if (gen !== this._wsGen) return;
        console.warn("[tradingService] WS closed:", e.code, e.reason);
        this.connected = false;
        this.ws = null;
        this._stopHeartbeat();
        if (!this._intentionalClose) {
          if (this._authorizing) {
            this.notify({ type: "error", message: `WebSocket closed during auth: ${e.reason || "unknown"}` });
          } else {
            this.notify({ type: "disconnected" });
            this.scheduleReconnect();
          }
        }
        this._authorizing = false;
      };

      ws.onerror = (err) => {
        if (gen !== this._wsGen) return;
        console.error("[tradingService] WS error:", err);
        this._authorizing = false;
        this.notify({ type: "error", message: "WebSocket connection failed" });
        ws.close();
      };

      ws.onmessage = (event) => {
        if (gen !== this._wsGen) return;
        try {
          const data = JSON.parse(event.data as string);
          if (data.error) {
            console.error("[tradingService] API error:", data.error);
            this._authorizing = false;
            this.notify({
              type: "error",
              message: data.error.message || "Deriv API error",
              code: data.error.code,
              echo_req: data.echo_req,
            });
            return;
          }
          if (data.msg_type === "authorize") {
            if (this._connectTimeout) clearTimeout(this._connectTimeout);
            this._authorizing = false;
            const auth = data.authorize;
            this._accountId = auth.loginid;
            this.balances = {
              balance: parseFloat(auth.balance) || 0,
              currency: auth.currency || "USD",
              loginid: auth.loginid,
              account_type: auth.account_type,
              email: auth.email,
              fullname: auth.fullname,
            };
            this.connected = true;
            this._reconnectAttempts = 0;
            this._startHeartbeat();
            this.notify({ type: "connected", ...this.balances });
          } else if (data.msg_type === "buy") {
            if (data.buy?.balance_after != null) {
              this.balances.balance = data.buy.balance_after;
            }
            const contract: Contract = {
              id: data.buy?.contract_id,
              transactionId: data.buy?.transaction_id,
              balanceAfter: data.buy?.balance_after,
              buyPrice: data.buy?.buy_price,
              longcode: data.buy?.longcode,
              startTime: data.buy?.start_time,
            };
            this.contracts.push(contract);
            this.notify({ type: "contract_opened", ...contract });
          } else if (data.msg_type === "proposal") {
            const id = data.proposal?.id;
            if (id) {
              this.proposals.set(id, data.proposal);
              this.notify({ type: "proposal", id, proposal: data.proposal });
            }
          } else if (data.msg_type === "proposal_open_contract") {
            const contract = data.proposal_open_contract;
            this.notify({ type: "contract_update", contract });
          }
        } catch {
          /* ignore */
        }
      };
    });
  }

  async connect(accountType?: string) {
    if (this.ws) return;
    if (!this._pat) return;
    this._intentionalClose = false;
    if (accountType) this._accountType = accountType;

    this.notify({ type: "status", message: "Fetching accounts..." });

    try {
      const accounts = await this.#fetchAccounts();
      const targetType = this._accountType === "demo" ? "demo" : "real";
      const acct = accounts.find((a) => a.account_type === targetType) || accounts[0];

      if (!acct) {
        this._fail("No Deriv account found");
        return;
      }

      this._accountId = acct.account_id;
      this.balances = {
        balance: parseFloat(String(acct.balance)) || 0,
        currency: acct.currency || "USD",
        loginid: acct.account_id,
        account_type: acct.account_type,
      };

      this.notify({ type: "status", message: "Connecting..." });
      const wsUrl = await this.#getOTP(this._accountId);

      this.ws = new WebSocket(wsUrl);

      this._connectTimeout = setTimeout(() => {
        if (!this.connected) {
          this._fail("Connection timed out");
          this.scheduleReconnect();
        }
      }, 30000);

      this.ws.onopen = () => {
        if (this._connectTimeout) clearTimeout(this._connectTimeout);
        this._reconnectAttempts = 0;
        this.connected = true;
        this._startHeartbeat();
        this.notify({ type: "connected", ...this.balances });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.error) {
            this.notify({
              type: "error",
              message: data.error.message || "Deriv API error",
              code: data.error.code,
              echo_req: data.echo_req,
            });
            return;
          }

          if (data.msg_type === "buy") {
            if (data.buy?.balance_after != null) {
              this.balances.balance = data.buy.balance_after;
            }
            const contract: Contract = {
              id: data.buy?.contract_id,
              transactionId: data.buy?.transaction_id,
              balanceAfter: data.buy?.balance_after,
              buyPrice: data.buy?.buy_price,
              longcode: data.buy?.longcode,
              startTime: data.buy?.start_time,
            };
            this.contracts.push(contract);
            this.notify({ type: "contract_opened", ...contract });
          } else if (data.msg_type === "proposal") {
            const id = data.proposal?.id;
            if (id) {
              this.proposals.set(id, data.proposal);
              this.notify({ type: "proposal", id, proposal: data.proposal });
            }
          } else if (data.msg_type === "proposal_open_contract") {
            const contract = data.proposal_open_contract;
            this.notify({ type: "contract_update", contract });
          }
        } catch {
          /* ignore */
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.ws = null;
        this._stopHeartbeat();
        if (!this._intentionalClose) {
          this.notify({ type: "disconnected" });
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch (err) {
      this._fail((err as Error).message || "Connection failed");
    }
  }

  disconnect() {
    this._intentionalClose = true;
    this._isOAuth = false;
    this._reconnectAttempts = 0;
    if (this._connectTimeout) clearTimeout(this._connectTimeout);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this._stopHeartbeat();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.connected = false;
    this.notify({ type: "disconnected" });
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const attempt = this._reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 30000);
    this.notify({ type: "status", message: `Reconnecting in ${Math.round(delay / 1000)}s...` });
    this.reconnectTimer = setTimeout(() => {
      if (this._pat && !this._intentionalClose) {
        if (this._isOAuth) {
          this.connectWithOAuth(this._pat, this._accountType);
        } else {
          this.connect();
        }
      }
    }, delay);
  }

  async getProposal(args: {
    contract_type: string;
    symbol: string;
    amount: number;
    duration: number;
    duration_unit: string;
    barrier?: number;
    currency?: string;
  }): Promise<unknown | null> {
    if (!this.connected || !this.ws) return null;
    const { contract_type, symbol, amount, duration, duration_unit, barrier, currency = "USD" } = args;
    return new Promise((resolve) => {
      const handler = (data: TradingEvent) => {
        if (data.type === "proposal") {
          this.listeners.delete(handler);
          resolve(data.proposal);
        } else if (data.type === "error") {
          this.listeners.delete(handler);
          resolve(null);
        }
      };
      this.listeners.add(handler);
      this.ws?.send(
        JSON.stringify({
          proposal: 1,
          amount,
          basis: "stake",
          contract_type,
          currency,
          duration,
          duration_unit,
          underlying_symbol: symbol,
          ...(barrier != null ? { barrier } : {}),
        })
      );
      setTimeout(() => {
        this.listeners.delete(handler);
        resolve(null);
      }, 5000);
    });
  }

  async buyContract(proposalId: string, price: number): Promise<Contract | null> {
    if (!this.connected || !this.ws) return null;
    return new Promise((resolve) => {
      const handler = (data: TradingEvent) => {
        if (data.type === "contract_opened") {
          if (data.id || data.transactionId) {
            this.listeners.delete(handler);
            resolve(data as Contract);
          }
        } else if (data.type === "error") {
          this.listeners.delete(handler);
          resolve(null);
        }
      };
      this.listeners.add(handler);
      this.ws?.send(JSON.stringify({ buy: proposalId, price }));
      setTimeout(() => {
        this.listeners.delete(handler);
        resolve(null);
      }, 10000);
    });
  }

  async #refreshBalance() {
    try {
      const appId = this._appId || "1089";
      const res = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
        headers: {
          Authorization: `Bearer ${this._pat}`,
          "Deriv-App-ID": appId,
        },
      });
      if (res.ok) {
        const json = await res.json();
        const accts = json.data || [];
        const acct = accts.find((a: { account_id?: string }) => a.account_id === this._accountId);
        if (acct) {
          this.balances.balance = parseFloat(String(acct.balance)) || 0;
        }
      }
    } catch {
      /* ignore */
    }
  }

  async placeTrade(args: {
    contract_type: string;
    symbol: string;
    amount: number;
    duration: number;
    duration_unit: string;
    currency?: string;
  }): Promise<{
    contractId?: number;
    transactionId?: number;
    status?: string;
    profit?: number;
    buyPrice?: number;
    sellPrice?: number;
    balanceAfter?: number;
  } | null> {
    if (!this.connected || !this.ws) return null;
    const { contract_type, symbol, amount, duration, duration_unit, currency = "USD" } = args;

    const proposal = await this.getProposal({ contract_type, symbol, amount, duration, duration_unit, currency });
    if (!proposal || !(proposal as { id?: string }).id) return null;

    const buyResult = await this.buyContract((proposal as { id: string }).id, amount);
    if (!buyResult) return null;

    const contractId = buyResult.id;
    const transactionId = buyResult.transactionId;

    if (contractId != null) this._pendingContractIds.add(contractId);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.listeners.delete(handler);
        if (contractId != null) this._pendingContractIds.delete(contractId);
        this.#refreshBalance();
        resolve({
          contractId,
          transactionId,
          status: "timeout",
          profit: 0,
          balanceAfter: this.balances.balance,
        });
      }, 120000);

      const handler = (data: TradingEvent) => {
        if (data.type === "contract_update") {
          const c = data.contract as Contract;
          if (c && c.contract_id === contractId) {
            if (c.status === "won" || c.status === "lost") {
              clearTimeout(timeout);
              this.listeners.delete(handler);
              if (contractId != null) this._pendingContractIds.delete(contractId);
              this.#refreshBalance();
              resolve({
                contractId: c.contract_id,
                transactionId,
                status: c.status,
                profit: c.profit || 0,
                buyPrice: c.buy_price,
                sellPrice: c.sell_price,
                balanceAfter: this.balances.balance,
              });
            }
          }
        }
      };
      this.listeners.add(handler);
    });
  }

  async sellContract(contractId: number, price: number): Promise<unknown> {
    if (!this.connected || !this.ws) return null;
    return new Promise((resolve) => {
      const handler = (data: TradingEvent) => {
        if (data.type === "contract_update") {
          this.listeners.delete(handler);
          resolve(data);
        }
      };
      this.listeners.add(handler);
      this.ws?.send(JSON.stringify({ sell: contractId, price }));
      setTimeout(() => {
        this.listeners.delete(handler);
        resolve(null);
      }, 5000);
    });
  }

  subscribe(fn: TradingListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(data: TradingEvent) {
    this.listeners.forEach((fn) => fn(data));
  }
}

export const tradingService = new TradingService();