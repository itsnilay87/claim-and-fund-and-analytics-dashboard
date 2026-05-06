/**
 * Workspace model — queries against the `workspaces` table.
 * Every query is scoped by user_id for data isolation.
 */
const { query } = require('../pool');

const Workspace = {
  /**
   * List all workspaces for a user, newest first.
   * @param {string} userId - UUID
   * @returns {Promise<object[]>} workspace rows
   */
  async findAllByUser(userId) {
    const { rows } = await query(
      `SELECT w.id, w.user_id, w.name, w.description, w.created_at, w.updated_at,
              (SELECT COUNT(*)::int FROM claims c
                 WHERE c.workspace_id = w.id AND c.deleted_at IS NULL) AS claim_count,
              (SELECT COUNT(*)::int FROM portfolios p
                 WHERE p.workspace_id = w.id AND p.deleted_at IS NULL) AS portfolio_count
         FROM workspaces w
        WHERE w.user_id = $1 AND w.deleted_at IS NULL
        ORDER BY w.created_at DESC`,
      [userId]
    );
    return rows;
  },

  /**
   * Find a single workspace by ID (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @returns {Promise<object|null>} workspace or null
   */
  async findById(id, userId) {
    const { rows } = await query(
      'SELECT id, user_id, name, description, created_at, updated_at FROM workspaces WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, userId]
    );
    return rows[0] || null;
  },

  /**
   * Create a new workspace.
   * @param {string} userId - UUID
   * @param {{ name: string, description?: string }} data
   * @returns {Promise<object>} created workspace
   */
  async create(userId, { name, description = '' }) {
    const { rows } = await query(
      `INSERT INTO workspaces (user_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, name, description, created_at, updated_at`,
      [userId, name, description]
    );
    return rows[0];
  },

  /**
   * Update a workspace (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @param {{ name?: string, description?: string }} fields
   * @returns {Promise<object>} updated workspace
   */
  async update(id, userId, { name, description }) {
    const { rows } = await query(
      `UPDATE workspaces
       SET name        = COALESCE($1, name),
           description = COALESCE($2, description)
       WHERE id = $3 AND user_id = $4
       RETURNING id, user_id, name, description, created_at, updated_at`,
      [name, description, id, userId]
    );
    if (!rows[0]) throw new Error('Workspace not found');
    return rows[0];
  },

  /**
   * Delete a workspace (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @returns {Promise<boolean>} true if deleted
   */
  async delete(id, userId) {
    const { rowCount } = await query(
      'UPDATE workspaces SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, userId]
    );
    return rowCount > 0;
  },
};

module.exports = Workspace;
