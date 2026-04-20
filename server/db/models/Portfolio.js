/**
 * Portfolio model — queries against the `portfolios` table.
 * Every query is scoped by user_id for data isolation.
 */
const { query } = require('../pool');

/**
 * Normalize a DB portfolio row to match the frontend-expected field names.
 * DB uses structure_type / simulation_config; frontend expects structure / simulation.
 */
function normalizePortfolio(row) {
  if (!row) return null;
  return {
    ...row,
    structure: row.structure_type,
    simulation: row.simulation_config,
  };
}

const Portfolio = {
  /**
   * List all portfolios in a workspace (user-scoped).
   * @param {string} workspaceId - UUID
   * @param {string} userId - UUID
   * @returns {Promise<object[]>} portfolio rows
   */
  async findAllByWorkspace(workspaceId, userId) {
    const { rows } = await query(
      `SELECT id, workspace_id, user_id, name, claim_ids,
              structure_type, structure_config, simulation_config,
              status, run_id, created_at, updated_at
       FROM portfolios
       WHERE workspace_id = $1 AND user_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [workspaceId, userId]
    );
    return rows.map(normalizePortfolio);
  },

  /**
   * Find a single portfolio by ID (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @returns {Promise<object|null>} portfolio or null
   */
  async findById(id, userId) {
    const { rows } = await query(
      `SELECT id, workspace_id, user_id, name, claim_ids,
              structure_type, structure_config, simulation_config,
              status, run_id, created_at, updated_at
       FROM portfolios
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [id, userId]
    );
    return normalizePortfolio(rows[0]) || null;
  },

  /**
   * Create a new portfolio.
   * @param {string} userId - UUID
   * @param {string} workspaceId - UUID
   * @param {object} data - portfolio data
   * @returns {Promise<object>} created portfolio
   */
  async create(userId, workspaceId, data) {
    const { rows } = await query(
      `INSERT INTO portfolios
         (user_id, workspace_id, name, claim_ids, structure_type,
          structure_config, simulation_config, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, workspace_id, user_id, name, claim_ids,
                 structure_type, structure_config, simulation_config,
                 status, run_id, created_at, updated_at`,
      [
        userId,
        workspaceId,
        data.name || 'Untitled Portfolio',
        data.claim_ids || [],
        data.structure_type || null,
        JSON.stringify(data.structure_config || {}),
        JSON.stringify(data.simulation_config || {}),
        data.status || 'draft',
      ]
    );
    return normalizePortfolio(rows[0]);
  },

  /**
   * Update a portfolio (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @param {object} updates - partial portfolio fields
   * @returns {Promise<object>} updated portfolio
   */
  async update(id, userId, updates) {
    const setClauses = [];
    const params = [];
    let idx = 1;

    const fieldMap = {
      name:              (v) => v,
      claim_ids:         (v) => v,
      structure_type:    (v) => v,
      structure_config:  (v) => JSON.stringify(v),
      simulation_config: (v) => JSON.stringify(v),
      status:            (v) => v,
      run_id:            (v) => v,
    };

    for (const [field, transform] of Object.entries(fieldMap)) {
      if (field in updates) {
        setClauses.push(`${field} = $${idx}`);
        params.push(transform(updates[field]));
        idx++;
      }
    }

    if (setClauses.length === 0) {
      return this.findById(id, userId);
    }

    params.push(id, userId);
    const idIdx = idx;

    const { rows } = await query(
      `UPDATE portfolios
       SET ${setClauses.join(', ')}
       WHERE id = $${idIdx} AND user_id = $${idIdx + 1}
       RETURNING id, workspace_id, user_id, name, claim_ids,
                 structure_type, structure_config, simulation_config,
                 status, run_id, created_at, updated_at`,
      params
    );
    if (!rows[0]) throw new Error('Portfolio not found');
    return normalizePortfolio(rows[0]);
  },

  /**
   * Delete a portfolio (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @returns {Promise<boolean>} true if deleted
   */
  async delete(id, userId) {
    const { rowCount } = await query(
      'UPDATE portfolios SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, userId]
    );
    return rowCount > 0;
  },

  /**
   * Set the current simulation run ID on a portfolio.
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @param {string|null} runId - UUID of the simulation run
   * @returns {Promise<object>} updated portfolio
   */
  async updateRunId(id, userId, runId) {
    const { rows } = await query(
      `UPDATE portfolios SET run_id = $1
       WHERE id = $2 AND user_id = $3
       RETURNING id, workspace_id, user_id, name, claim_ids,
                 structure_type, structure_config, simulation_config,
                 status, run_id, created_at, updated_at`,
      [runId, id, userId]
    );
    if (!rows[0]) throw new Error('Portfolio not found');
    return normalizePortfolio(rows[0]);
  },

  /**
   * Update only the status of a portfolio (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @param {string} status - new status value
   * @returns {Promise<object>} updated portfolio
   */
  async updateStatus(id, userId, status) {
    const { rows } = await query(
      `UPDATE portfolios SET status = $1
       WHERE id = $2 AND user_id = $3
       RETURNING id, workspace_id, user_id, name, claim_ids,
                 structure_type, structure_config, simulation_config,
                 status, run_id, created_at, updated_at`,
      [status, id, userId]
    );
    if (!rows[0]) throw new Error('Portfolio not found');
    return normalizePortfolio(rows[0]);
  },
};

module.exports = Portfolio;
