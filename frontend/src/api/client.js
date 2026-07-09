const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function fetchJSON(url) {
  const res = await fetch(`${API}${url}`);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

async function postJSON(url, body) {
  const res = await fetch(`${API}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
  return res.json();
}

async function del(url) {
  const res = await fetch(`${API}${url}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${url} failed: ${res.status}`);
  return res.json();
}

export const api = {
  // Market data
  getPrices: () => fetchJSON('/api/market/prices'),
  getPrice: (s) => fetchJSON(`/api/market/price/${s}`),
  getTechnicals: (s, i = '1h') => fetchJSON(`/api/market/technicals/${s}?interval=${i}`),
  getTimeSeries: (s, i = '1h', o = 100) => fetchJSON(`/api/market/time-series/${s}?interval=${i}&outputsize=${o}`),
  getFundamentals: (s) => fetchJSON(`/api/market/fundamentals/${s}`),
  getScan: () => fetchJSON('/api/market/scan'),
  getMovers: () => fetchJSON('/api/market/movers'),
  getWatchlist: () => fetchJSON('/api/market/watchlist'),

  // Swarms
  getSwarms: () => fetchJSON('/api/swarms'),
  createSwarm: (cfg) => postJSON('/api/swarms', cfg),
  getSwarm: (id) => fetchJSON(`/api/swarms/${id}`),
  deleteSwarm: (id) => del(`/api/swarms/${id}`),

  // Workflows
  getWorkflows: () => fetchJSON('/api/workflows'),
  createWorkflow: (wf) => postJSON('/api/workflows', wf),
  getWorkflow: (id) => fetchJSON(`/api/workflows/${id}`),
  runWorkflow: (id) => postJSON(`/api/workflows/${id}/run`),
  pauseWorkflow: (id) => postJSON(`/api/workflows/${id}/pause`),
  deleteWorkflow: (id) => del(`/api/workflows/${id}`),

  // Alerts
  getAlerts: () => fetchJSON('/api/alerts'),
  createAlert: (a) => postJSON('/api/alerts', a),
  deleteAlert: (id) => del(`/api/alerts/${id}`),

  // Forex (FastForex)
  getForexRates: (from = 'USD') => fetchJSON(`/api/forex/rates?from=${from}`),
  getForexRate: (from = 'USD', to = 'EUR') => fetchJSON(`/api/forex/rate?from=${from}&to=${to}`),
  getForexMulti: (from = 'USD', to = 'EUR,GBP,JPY') => fetchJSON(`/api/forex/multi?from=${from}&to=${to}`),
  forexConvert: (amount = 1, from = 'USD', to = 'EUR') => fetchJSON(`/api/forex/convert?amount=${amount}&from=${from}&to=${to}`),
  getForexCurrencies: () => fetchJSON('/api/forex/currencies'),
  getForexPairs: () => fetchJSON('/api/forex/pairs'),
  getFxQuotes: () => fetchJSON('/api/forex/fx-quotes'),
  getFxQuote: (pair) => fetchJSON(`/api/forex/fx-quote/${pair}`),
};
