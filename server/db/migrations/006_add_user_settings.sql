-- =====================================================
--  006_add_user_settings.sql
--  Per-user preference table (currently: auto-save portfolio runs).
-- =====================================================

CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    auto_save_portfolio_runs BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_user_settings_updated ON user_settings;
CREATE TRIGGER trg_user_settings_updated
    BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
