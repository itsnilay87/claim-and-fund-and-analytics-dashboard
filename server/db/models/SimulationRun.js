/**
 * SimulationRun model — queries against the `simulation_runs` table.
 * Every read query is scoped by user_id for data isolation.
 */
const { query } = require('../pool');
const fs = require('fs');
const path = require('path');

const SimulationRun = {
  /**
   * Create a new simulation run record.
   * @param {string} userId - UUID
   * @param {{ workspaceId?: string, portfolioId?: string, claimId?: string, mode: string, structureType?: string, config?: object, name?: string }} data
   * @returns {Promise<object>} created run record
   */
  async create(userId, { workspaceId, portfolioId, claimId, mode, structureType, config, name }) {
    const { rows } = await query(
      `INSERT INTO simulation_runs
         (user_id, workspace_id, portfolio_id, claim_id, mode, structure_type, config, name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        workspaceId || null,
        portfolioId || null,
        claimId || null,
        mode,
        structureType || null,
        JSON.stringify(config || {}),
        name || null,
      ]
    );
    return rows[0];
  },

  /**
   * Update run status and progress fields.
   * @param {string} id - UUID
   * @param {{ status?: string, progress?: number, stage?: string, error_message?: string, completed_at?: Date|string, results_path?: string, summary?: object }} fields
   * @returns {Promise<object>} updated run
   */
  async updateStatus(id, fields) {
    const setClauses = [];
    const params = [];
    let idx = 1;

    const simple = ['status', 'progress', 'stage', 'error_message', 'completed_at', 'results_path'];
    for (const field of simple) {
      if (field in fields) {
        setClauses.push(`${field} = $${idx}`);
        params.push(fields[field]);
        idx++;
      }
    }
    if ('summary' in fields) {
      // `summary` is a JSONB column — accepts arbitrary keys without schema
      // changes. Extended fields (portfolio_name, structure_params,
      // run_duration_seconds, n_portfolios, etc.) are stored as-is.
      setClauses.push(`summary = $${idx}`);
      params.push(JSON.stringify(fields.summary || {}));
      idx++;
    }

    if (setClauses.length === 0) return this.findByIdInternal(id);

    params.push(id);
    const { rows } = await query(
      `UPDATE simulation_runs
       SET ${setClauses.join(', ')}
       WHERE id = $${idx}
       RETURNING *`,
      params
    );
    if (!rows[0]) throw new Error('Simulation run not found');
    return rows[0];
  },

  /**
   * Find a run by ID (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @returns {Promise<object|null>} run or null
   */
  async findById(id, userId) {
    const { rows } = await query(
      'SELECT * FROM simulation_runs WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, userId]
    );
    return rows[0] || null;
  },

  /**
   * Internal: find by ID without user scope (used by updateStatus).
   * @param {string} id - UUID
   * @returns {Promise<object|null>}
   */
  async findByIdInternal(id) {
    const { rows } = await query(
      'SELECT * FROM simulation_runs WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  },

  /**
   * List runs for a user with pagination and optional filters.
   * @param {string} userId - UUID
   * @param {{ limit?: number, offset?: number, status?: string, structureType?: string }} opts
   * @returns {Promise<{ runs: object[], total: number }>}
   */
  async findAllByUser(userId, { limit = 20, offset = 0, status, structureType } = {}) {
    const conditions = ['user_id = $1', 'deleted_at IS NULL'];
    const params = [userId];
    let idx = 2;

    if (status) {
      conditions.push(`status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (structureType) {
      conditions.push(`structure_type = $${idx}`);
      params.push(structureType);
      idx++;
    }

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM simulation_runs WHERE ${where}`,
      params
    );

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT * FROM simulation_runs
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return { runs: rows, total: countResult.rows[0].total };
  },

  /**
   * List runs for a specific portfolio (user-scoped).
   * @param {string} portfolioId - UUID
   * @param {string} userId - UUID
   * @returns {Promise<object[]>} runs
   */
  async findByPortfolio(portfolioId, userId) {
    const { rows } = await query(
      `SELECT * FROM simulation_runs
       WHERE portfolio_id = $1 AND user_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [portfolioId, userId]
    );
    return rows;
  },

  /**
   * Delete old unsaved runs for a user, keeping the newest N unsaved.
   * Saved/bookmarked runs are exempt from auto-cleanup.
   * Also removes the results directory from the filesystem.
   * @param {string} userId - UUID
   * @param {number} [keepCount=10] - number of newest unsaved runs to keep
   * @returns {Promise<number>} count of deleted runs
   */
  async deleteOldUnsavedRuns(userId, keepCount = 10) {
    // Find unsaved runs to delete (everything beyond the newest keepCount)
    const { rows: toDelete } = await query(
      `SELECT id, results_path FROM simulation_runs
       WHERE user_id = $1 AND (saved IS NULL OR saved = FALSE)
       ORDER BY created_at DESC
       OFFSET $2`,
      [userId, keepCount]
    );

    if (toDelete.length === 0) return 0;

    const ids = toDelete.map((r) => r.id);

    // Delete from DB
    const { rowCount } = await query(
      `DELETE FROM simulation_runs WHERE id = ANY($1) AND user_id = $2`,
      [ids, userId]
    );

    // Clean up filesystem directories
    for (const run of toDelete) {
      if (run.results_path) {
        try {
          fs.rmSync(path.resolve(run.results_path), { recursive: true, force: true });
        } catch {
          // Best-effort cleanup — don't fail the operation
        }
      }
    }

    return rowCount;
  },

  /**
   * Delete old runs for a user, keeping the newest N.
   * Also removes the results directory from the filesystem.
   * @param {string} userId - UUID
   * @param {number} [keepCount=10] - number of newest runs to keep
   * @returns {Promise<number>} count of deleted runs
   */
  async deleteOldRuns(userId, keepCount = 10) {
    // Find runs to delete (everything beyond the newest keepCount)
    const { rows: toDelete } = await query(
      `SELECT id, results_path FROM simulation_runs
       WHERE user_id = $1
       ORDER BY created_at DESC
       OFFSET $2`,
      [userId, keepCount]
    );

    if (toDelete.length === 0) return 0;

    const ids = toDelete.map((r) => r.id);

    // Delete from DB
    const { rowCount } = await query(
      `DELETE FROM simulation_runs WHERE id = ANY($1) AND user_id = $2`,
      [ids, userId]
    );

    // Clean up filesystem directories
    for (const run of toDelete) {
      if (run.results_path) {
        try {
          fs.rmSync(path.resolve(run.results_path), { recursive: true, force: true });
        } catch {
          // Best-effort cleanup — don't fail the operation
        }
      }
    }

    return rowCount;
  },

  /**
   * Delete a single run (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @returns {Promise<boolean>} true if deleted
   */
  async delete(id, userId) {
    const run = await this.findById(id, userId);
    if (!run) return false;

    const { rowCount } = await query(
      'UPDATE simulation_runs SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, userId]
    );

    // Soft-delete: keep files on disk for recovery. Files are purged
    // only when permanently deleted (see purgeDeleted below).

    return rowCount > 0;
  },

  /**
   * Mark a run as saved (exempt from auto-cleanup) with optional name.
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @param {string|null} name - Optional custom name
   * @returns {Promise<object|null>} updated run or null
   */
  async markSaved(id, userId, name = null) {
    const setClauses = ['saved = TRUE'];
    const params = [];
    let idx = 1;

    if (name != null) {
      setClauses.push(`name = $${idx}`);
      params.push(name);
      idx++;
    }

    params.push(id, userId);
    const { rows } = await query(
      `UPDATE simulation_runs
       SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND user_id = $${idx + 1}
       RETURNING *`,
      params
    );
    return rows[0] || null;
  },

  /**
   * Fetch two runs for comparison (both must belong to the same user).
   * @param {string} id1 - UUID
   * @param {string} id2 - UUID
   * @param {string} userId - UUID
   * @returns {Promise<{ run1: object, run2: object }>}
   */
  async compare(id1, id2, userId) {
    const { rows } = await query(
      'SELECT * FROM simulation_runs WHERE id = ANY($1) AND user_id = $2',
      [[id1, id2], userId]
    );

    const run1 = rows.find((r) => r.id === id1);
    const run2 = rows.find((r) => r.id === id2);

    if (!run1) throw new Error(`Run ${id1} not found for this user`);
    if (!run2) throw new Error(`Run ${id2} not found for this user`);

    return { run1, run2 };
  },
};

module.exports = SimulationRun;
