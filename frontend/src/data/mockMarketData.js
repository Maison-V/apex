// Mock data shaped to exactly match what your Python `twelvedata` service module
// returns (get_quote, get_technicals, get_market_movers, get_fundamentals) so that
// swapping marketService.js over to real endpoints requires no changes to any
// component below — only the fetch calls in services/marketService.js.

export const WATCHLIST = {
  indices: ['^DJI', '^NDX'],
  forex: ['EUR/USD', 'GBP/USD'],
  commodities: ['GC=F'],
  synthetic: [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'R_150', 'R_200', 'R_250', 'R_300',
    'R_10_1S', 'R_25_1S', 'R_50_1S', 'R_75_1S', 'R_100_1S', 'R_150_1S', 'R_200_1S', 'R_250_1S', 'R_300_1S',
    'BOOM300', 'BOOM500', 'BOOM1000',
    'BOOM300_1S', 'BOOM500_1S', 'BOOM1000_1S',
    'CRASH300', 'CRASH500', 'CRASH1000',
    'CRASH300_1S', 'CRASH500_1S', 'CRASH1000_1S',
  ],
  crypto: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD'],
  stocks: ['AAPL', 'MSFT', 'TSLA', 'NVDA', 'SPY'],
}

const now = () => new Date().toISOString()

// mirrors get_quote()
const quote = (symbol, price, high, low, volume, change, changePct) => ({
  symbol,
  price,
  high,
  low,
  volume,
  change,
  change_pct: changePct,
  source: 'twelvedata',
  timestamp: now(),
})

export const MOCK_QUOTES = {
  'BTC/USD': quote('BTC/USD', 64821.4, 65210.0, 63590.2, 28450, 812.6, 1.27),
  'ETH/USD': quote('ETH/USD', 3412.85, 3468.0, 3355.1, 152300, -24.15, -0.7),
  'SOL/USD': quote('SOL/USD', 168.32, 172.4, 161.9, 981200, 6.88, 4.26),
  'BNB/USD': quote('BNB/USD', 612.4, 618.9, 601.2, 44210, 3.1, 0.51),
  'EUR/USD': quote('EUR/USD', 1.0842, 1.0861, 1.0819, 0, 0.0012, 0.11),
  'GBP/USD': quote('GBP/USD', 1.2718, 1.2745, 1.2688, 0, -0.0021, -0.16),
  'GC=F': quote('GC=F', 4073.8, 4088.4, 4003.3, 0, 12.4, 0.52),
  'R_75': quote('R_75', 158234.5, 158900.0, 157800.0, 0, 345.2, 0.22),
  'R_100': quote('R_100', 229876.1, 230500.0, 229100.0, 0, 512.8, 0.22),
  'BOOM500': quote('BOOM500', 4862.3, 4890.0, 4830.0, 0, 18.5, 0.38),
  'CRASH500': quote('CRASH500', 16421.8, 16500.0, 16350.0, 0, -42.1, -0.26),
  AAPL: quote('AAPL', 221.34, 223.8, 218.9, 51230000, 1.86, 0.85),
  MSFT: quote('MSFT', 448.72, 452.1, 444.3, 21850000, -2.14, -0.47),
  TSLA: quote('TSLA', 261.09, 268.4, 255.2, 88410000, 8.92, 3.54),
  NVDA: quote('NVDA', 132.58, 135.9, 129.1, 210300000, 3.41, 2.64),
  SPY: quote('SPY', 561.28, 563.4, 557.9, 68120000, 1.02, 0.18),
}

// mirrors get_technicals()
const technicals = (symbol, rsi, macd, sma20, sma50, bbands) => ({
  symbol,
  rsi,
  macd,
  sma_20: sma20,
  sma_50: sma50,
  bbands,
})

const macd = (m, s, h) => ({ macd: m, macd_signal: s, macd_hist: h })
const bb = (u, mid, l) => ({ upper_band: u, middle_band: mid, lower_band: l })

export const MOCK_TECHNICALS = {
  'BTC/USD': technicals('BTC/USD', 58.4, macd(210.5, 180.2, 30.3), 63980.1, 61250.7, bb(65900, 63980, 62060)),
  'ETH/USD': technicals('ETH/USD', 44.1, macd(-12.8, -4.2, -8.6), 3450.2, 3510.9, bb(3560, 3450, 3340)),
  'SOL/USD': technicals('SOL/USD', 71.2, macd(5.4, 3.1, 2.3), 158.4, 149.7, bb(178, 158, 138)),
  'BNB/USD': technicals('BNB/USD', 52.9, macd(1.2, 0.9, 0.3), 605.1, 598.4, bb(624, 605, 586)),
  'EUR/USD': technicals('EUR/USD', 49.6, macd(0.0008, 0.0006, 0.0002), 1.083, 1.081, bb(1.089, 1.083, 1.077)),
  'GBP/USD': technicals('GBP/USD', 38.7, macd(-0.0011, -0.0005, -0.0006), 1.276, 1.279, bb(1.284, 1.276, 1.268)),
  'GC=F': technicals('GC=F', 63.5, macd(9.8, 7.2, 2.6), 4050.4, 3998.6, bb(4110, 4050, 3990)),
  'R_75': technicals('R_75', 52.4, macd(120.5, 95.2, 25.3), 157900, 156800, bb(159200, 157900, 156600)),
  'R_100': technicals('R_100', 54.8, macd(180.3, 142.1, 38.2), 229500, 228100, bb(231000, 229500, 228000)),
  'BOOM500': technicals('BOOM500', 58.2, macd(8.5, 6.2, 2.3), 4850, 4820, bb(4890, 4850, 4810)),
  'CRASH500': technicals('CRASH500', 42.6, macd(-12.4, -5.8, -6.6), 16480, 16550, bb(16600, 16480, 16360)),
  AAPL: technicals('AAPL', 55.8, macd(1.9, 1.4, 0.5), 217.6, 211.3, bb(226, 217.6, 209.2)),
  MSFT: technicals('MSFT', 47.3, macd(-0.8, -0.3, -0.5), 451.2, 446.8, bb(459, 451.2, 443.4)),
  TSLA: technicals('TSLA', 66.9, macd(4.6, 2.8, 1.8), 248.9, 232.1, bb(272, 248.9, 225.8)),
  NVDA: technicals('NVDA', 61.2, macd(2.1, 1.6, 0.5), 126.4, 118.7, bb(138, 126.4, 114.8)),
  SPY: technicals('SPY', 52.6, macd(0.6, 0.5, 0.1), 556.9, 548.2, bb(566, 556.9, 547.8)),
}

// mirrors get_market_movers()
export const MOCK_MOVERS = {
  gainers: [
    { symbol: 'SOL/USD', percent_change: 4.26 },
    { symbol: 'TSLA', percent_change: 3.54 },
    { symbol: 'NVDA', percent_change: 2.64 },
  ],
  losers: [
    { symbol: 'ETH/USD', percent_change: -0.7 },
    { symbol: 'GBP/USD', percent_change: -0.16 },
    { symbol: 'MSFT', percent_change: -0.47 },
  ],
  most_active: [
    { symbol: 'NVDA', volume: 210300000 },
    { symbol: 'TSLA', volume: 88410000 },
    { symbol: 'SPY', volume: 68120000 },
  ],
}

// mirrors get_fundamentals()
export const MOCK_FUNDAMENTALS = {
  AAPL: {
    name: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    market_cap: 3420000000000,
    pe_ratio: 33.8,
    eps: 6.55,
    dividend_yield: 0.44,
    week_52_high: 237.23,
    week_52_low: 164.08,
  },
  MSFT: {
    name: 'Microsoft Corporation',
    sector: 'Technology',
    industry: 'Software - Infrastructure',
    market_cap: 3330000000000,
    pe_ratio: 35.1,
    eps: 12.78,
    dividend_yield: 0.72,
    week_52_high: 468.35,
    week_52_low: 385.58,
  },
  TSLA: {
    name: 'Tesla, Inc.',
    sector: 'Consumer Cyclical',
    industry: 'Auto Manufacturers',
    market_cap: 832000000000,
    pe_ratio: 68.4,
    eps: 3.82,
    dividend_yield: 0,
    week_52_high: 299.29,
    week_52_low: 138.8,
  },
  NVDA: {
    name: 'NVIDIA Corporation',
    sector: 'Technology',
    industry: 'Semiconductors',
    market_cap: 3260000000000,
    pe_ratio: 46.9,
    eps: 2.82,
    dividend_yield: 0.03,
    week_52_high: 153.13,
    week_52_low: 75.61,
  },
  SPY: {
    name: 'SPDR S&P 500 ETF Trust',
    sector: 'Fund',
    industry: 'ETF',
    market_cap: null,
    pe_ratio: 26.4,
    eps: null,
    dividend_yield: 1.24,
    week_52_high: 564.71,
    week_52_low: 481.8,
  },
}
