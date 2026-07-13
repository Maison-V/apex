-- APEX Dashboard — Supabase Schema
-- Run this in your Supabase SQL Editor

-- Market snapshots from Twelve Data
CREATE TABLE IF NOT EXISTS market_snapshots (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  timestamp TIMESTAMPTZ NOT NULL,
  prices JSONB NOT NULL DEFAULT '{}',
  alerts JSONB DEFAULT '[]',
  source TEXT DEFAULT 'twelvedata'
);

CREATE INDEX idx_market_snapshots_ts ON market_snapshots (timestamp DESC);

-- Forex snapshots from FastForex
CREATE TABLE IF NOT EXISTS forex_snapshots (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  timestamp TIMESTAMPTZ NOT NULL,
  rates JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_forex_snapshots_ts ON forex_snapshots (timestamp DESC);

-- Swarms
CREATE TABLE IF NOT EXISTS swarms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  topology TEXT NOT NULL DEFAULT 'hierarchical',
  max_agents INT DEFAULT 4,
  goal TEXT,
  status TEXT DEFAULT 'created',
  agents JSONB DEFAULT '[]',
  tasks_completed INT DEFAULT 0,
  tasks_pending INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_swarms_status ON swarms (status);

-- Workflows
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  steps JSONB DEFAULT '[]',
  status TEXT DEFAULT 'created',
  current_step INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workflows_status ON workflows (status);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  condition TEXT NOT NULL,
  threshold FLOAT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  triggered BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_symbol ON alerts (symbol);
CREATE INDEX idx_alerts_active ON alerts (active);

-- Live ticks from MetaTrader
CREATE TABLE IF NOT EXISTS live_ticks (
  symbol TEXT PRIMARY KEY,
  bid DOUBLE PRECISION,
  ask DOUBLE PRECISION,
  last DOUBLE PRECISION,
  price DOUBLE PRECISION,
  volume DOUBLE PRECISION,
  high DOUBLE PRECISION,
  low DOUBLE PRECISION,
  change DOUBLE PRECISION,
  change_pct DOUBLE PRECISION,
  source TEXT DEFAULT 'metatrader',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_live_ticks_updated ON live_ticks (updated_at DESC);

-- Enable Row Level Security (recommended)
ALTER TABLE market_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE forex_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE swarms ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_ticks ENABLE ROW LEVEL SECURITY;

-- Allow all operations for anon key (since this is a dashboard with API-key auth)
CREATE POLICY "Allow all on market_snapshots" ON market_snapshots FOR ALL USING (true);
CREATE POLICY "Allow all on forex_snapshots" ON forex_snapshots FOR ALL USING (true);
CREATE POLICY "Allow all on swarms" ON swarms FOR ALL USING (true);
CREATE POLICY "Allow all on workflows" ON workflows FOR ALL USING (true);
CREATE POLICY "Allow all on alerts" ON alerts FOR ALL USING (true);
CREATE POLICY "Allow all on live_ticks" ON live_ticks FOR ALL USING (true);
