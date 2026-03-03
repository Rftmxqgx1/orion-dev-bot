-- Orion Database Initialization
CREATE DATABASE IF NOT EXISTS orion;

\c orion;

-- Create tables (these will also be created by the Context Memory Service)
-- This file is for initial setup if needed

-- Signals table
CREATE TABLE IF NOT EXISTS structured_signals (
  id VARCHAR(255) PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  severity VARCHAR(50) NOT NULL,
  confidence DECIMAL(3,2),
  source VARCHAR(255),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Snapshots table
CREATE TABLE IF NOT EXISTS world_snapshots (
  id VARCHAR(255) PRIMARY KEY,
  risk_level VARCHAR(50),
  confidence DECIMAL(3,2),
  summary TEXT,
  drivers JSONB,
  recommendations JSONB,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Decisions table
CREATE TABLE IF NOT EXISTS decision_history (
  id VARCHAR(255) PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  trigger VARCHAR(255),
  action TEXT,
  rationale TEXT,
  executed BOOLEAN DEFAULT FALSE,
  result TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_signals_type ON structured_signals(type);
CREATE INDEX IF NOT EXISTS idx_signals_severity ON structured_signals(severity);
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON structured_signals(timestamp);
CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON world_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON decision_history(type);
