CREATE TABLE IF NOT EXISTS deployment_gate_state (
  environment TEXT PRIMARY KEY CHECK (environment IN ('prod', 'staging')),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  reason TEXT,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deployment_runs (
  id BIGSERIAL PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('prod', 'staging')),
  provider TEXT,
  external_deploy_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'triggered', 'succeeded', 'failed', 'untracked')),
  requested_by TEXT,
  failure_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deployment_runs_one_active_environment
  ON deployment_runs (environment)
  WHERE status IN ('reserved', 'triggered');

CREATE INDEX IF NOT EXISTS idx_deployment_runs_recent
  ON deployment_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS calypso_audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  environment TEXT,
  actor_user_id TEXT,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calypso_audit_events_recent
  ON calypso_audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_calypso_audit_events_environment_recent
  ON calypso_audit_events (environment, created_at DESC);

CREATE TABLE IF NOT EXISTS deployment_confirmations (
  token TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('prod', 'staging')),
  requested_by TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deployment_confirmations_expiry
  ON deployment_confirmations (expires_at);
