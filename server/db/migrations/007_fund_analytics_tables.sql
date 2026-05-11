-- =====================================================
--  007_fund_analytics_tables.sql
--  Fund analytics — top-level section, not workspace-scoped
-- =====================================================

-- Saved fund parameter configurations
CREATE TABLE fund_parameters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL DEFAULT 'Default Parameters',
    description TEXT DEFAULT '',
    parameters JSONB NOT NULL DEFAULT '{}',
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_fund_params_user ON fund_parameters(user_id);
CREATE TRIGGER trg_fund_params_updated
    BEFORE UPDATE ON fund_parameters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Fund simulation runs (parallel to simulation_runs but for fund analytics)
CREATE TABLE fund_simulations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parameters_id UUID REFERENCES fund_parameters(id) ON DELETE SET NULL,
    name VARCHAR(255) DEFAULT '',
    mode VARCHAR(30) NOT NULL DEFAULT 'fund'
        CHECK (mode IN ('fund', 'case', 'scenario')),
    status VARCHAR(20) DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    celery_task_id VARCHAR(255),
    config JSONB DEFAULT '{}',
    results_summary JSONB DEFAULT '{}',
    results_path VARCHAR(500),
    error_message TEXT,
    progress INTEGER DEFAULT 0,
    stage VARCHAR(255),
    scenarios TEXT[] DEFAULT '{}',
    sensitivity BOOLEAN DEFAULT FALSE,
    num_simulations INTEGER,
    funding_profile VARCHAR(10) DEFAULT 'UF',
    saved BOOLEAN DEFAULT FALSE,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_fund_sims_user ON fund_simulations(user_id);
CREATE INDEX idx_fund_sims_status ON fund_simulations(status);
CREATE INDEX idx_fund_sims_created ON fund_simulations(created_at DESC);
CREATE INDEX idx_fund_sims_celery ON fund_simulations(celery_task_id);
