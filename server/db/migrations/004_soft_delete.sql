-- Soft-delete support: add deleted_at column to all user-data tables
-- Records are marked as deleted instead of permanently removed
-- To permanently purge: DELETE FROM <table> WHERE deleted_at < NOW() - INTERVAL '90 days'

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Partial indexes: speed up queries that filter out soft-deleted rows
CREATE INDEX IF NOT EXISTS idx_workspaces_active ON workspaces (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_claims_active ON claims (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portfolios_active ON portfolios (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_simulation_runs_active ON simulation_runs (user_id) WHERE deleted_at IS NULL;
