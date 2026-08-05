export interface TradingEvent {
  type: string;
  message?: string;
  code?: string;
  echo_req?: unknown;
  balance?: number;
  currency?: string;
  proposal?: unknown;
  contract?: unknown;
  [key: string]: unknown;
}

export interface Balance {
  balance: number;
  currency: string;
  loginid?: string;
  account_type?: string;
  email?: string;
  fullname?: string;
}

export interface ContractEvent {
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