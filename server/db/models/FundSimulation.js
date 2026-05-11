/**
 * FundSimulation model — queries against the `fund_simulations` table.
 * Every read query is scoped by user_id for data isolation.
 */
const { query } = require('../pool');

const FundSimulation = {
  async create(userId, { parametersId, name, mode, config, scenarios, sensitivity, numSimulations, fundingProfile }) {
    const { rows } = await query(
      `INSERT INTO fund_simulations
         (user_id, parameters_id, name, mode, config, scenarios, sensitivity, num_simulations, funding_profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId,
        parametersId || null,
        name || '',
        mode || 'fund',
        JSON.stringify(config || {}),
        scenarios || [],
        sensitivity || false,
        numSimulations || null,
        fundingProfile || 'UF',
      ]
    );
    return rows[0];
  },

  async updateCeleryTaskId(id, celeryTaskId) {
    const { rows } = await query(
      'UPDATE fund_simulations SET celery_task_id = $1 WHERE id = $2 RETURNING *',
      [celeryTaskId, id]
    );
    return rows[0] || null;
  },

  async updateStatus(id, { status, progress, stage, errorMessage, completedAt, resultsPath, resultsSummary }) {
    const setClauses = [];
    const params = [];
    let idx = 1;

    const simple = { status, progress, stage, error_message: errorMessage, completed_at: completedAt, results_path: resultsPath };
    for (const [col, val] of Object.entries(simple)) {
      if (val !== undefined) {
        setClauses.push(`${col} = $${idx}`);
        params.push(val);
        idx++;
      }
    }
    if (resultsSummary !== undefined) {
      setClauses.push(`results_summary = $${idx}`);
      params.push(JSON.stringify(resultsSummary));
      idx++;
    }

    if (setClauses.length === 0) return null;

    params.push(id);
    const { rows } = await query(
      `UPDATE fund_simulations SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    return rows[0] || null;
  },

  async findById(id, userId) {
    const { rows } = await query(
      'SELECT * FROM fund_simulations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, userId]
    );
    return rows[0] || null;
  },

  async findByCeleryTaskId(celeryTaskId) {
    const { rows } = await query(
      'SELECT * FROM fund_simulations WHERE celery_task_id = $1',
      [celeryTaskId]
    );
    return rows[0] || null;
  },

  async findAllByUser(userId, { limit = 20, offset = 0, status, mode } = {}) {
    const conditions = ['user_id = $1', 'deleted_at IS NULL'];
    const params = [userId];
    let idx = 2;

    if (status) { conditions.push(`status = $${idx}`); params.push(status); idx++; }
    if (mode) { conditions.push(`mode = $${idx}`); params.push(mode); idx++; }

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM fund_simulations WHERE ${where}`,
      params
    );

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT * FROM fund_simulations
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return { runs: rows, total: countResult.rows[0].total };
  },

  async delete(id, userId) {
    const { rowCount } = await query(
      'UPDATE fund_simulations SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, userId]
    );
    return rowCount > 0;
  },

  async markSaved(id, userId, name = null) {
    const setClauses = ['saved = TRUE'];
    const params = [];
    let idx = 1;

    if (name != null) { setClauses.push(`name = $${idx}`); params.push(name); idx++; }

    params.push(id, userId);
    const { rows } = await query(
      `UPDATE fund_simulations SET ${setClauses.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
      params
    );
    return rows[0] || null;
  },
};

module.exports = FundSimulation;
