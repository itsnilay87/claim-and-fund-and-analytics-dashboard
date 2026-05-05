/**
 * UserSettings model — per-user preferences stored in `user_settings`.
 */
const { query } = require('../pool');

const DEFAULTS = {
  auto_save_portfolio_runs: false,
};

const UserSettings = {
  /**
   * Return the user's settings row merged with defaults. Never returns null.
   * @param {string} userId - UUID
   * @returns {Promise<{ auto_save_portfolio_runs: boolean }>}
   */
  async getByUserId(userId) {
    const { rows } = await query(
      'SELECT auto_save_portfolio_runs FROM user_settings WHERE user_id = $1',
      [userId]
    );
    if (!rows[0]) return { ...DEFAULTS };
    return { ...DEFAULTS, ...rows[0] };
  },

  /**
   * Upsert a settings row for the user.
   * @param {string} userId - UUID
   * @param {{ auto_save_portfolio_runs?: boolean }} fields
   * @returns {Promise<{ auto_save_portfolio_runs: boolean }>}
   */
  async upsert(userId, fields) {
    const autoSave = fields.auto_save_portfolio_runs;
    const { rows } = await query(
      `INSERT INTO user_settings (user_id, auto_save_portfolio_runs)
       VALUES ($1, COALESCE($2, FALSE))
       ON CONFLICT (user_id) DO UPDATE
         SET auto_save_portfolio_runs = COALESCE($2, user_settings.auto_save_portfolio_runs)
       RETURNING auto_save_portfolio_runs`,
      [userId, autoSave === undefined ? null : autoSave]
    );
    return { ...DEFAULTS, ...rows[0] };
  },
};

module.exports = UserSettings;
