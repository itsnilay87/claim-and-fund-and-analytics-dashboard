/**
 * FundParameters model — queries against the `fund_parameters` table.
 * Every read query is scoped by user_id for data isolation.
 */
const { query } = require('../pool');

const FundParameters = {
  async create(userId, { name, description, parameters, isDefault }) {
    const { rows } = await query(
      `INSERT INTO fund_parameters
         (user_id, name, description, parameters, is_default)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        userId,
        name || 'Default Parameters',
        description || '',
        JSON.stringify(parameters || {}),
        isDefault || false,
      ]
    );
    return rows[0];
  },

  async findById(id, userId) {
    const { rows } = await query(
      'SELECT * FROM fund_parameters WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return rows[0] || null;
  },

  async findAllByUser(userId) {
    const { rows } = await query(
      'SELECT * FROM fund_parameters WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return rows;
  },

  async update(id, userId, { name, description, parameters, isDefault }) {
    const setClauses = [];
    const params = [];
    let idx = 1;

    if (name !== undefined) { setClauses.push(`name = $${idx}`); params.push(name); idx++; }
    if (description !== undefined) { setClauses.push(`description = $${idx}`); params.push(description); idx++; }
    if (parameters !== undefined) { setClauses.push(`parameters = $${idx}`); params.push(JSON.stringify(parameters)); idx++; }
    if (isDefault !== undefined) { setClauses.push(`is_default = $${idx}`); params.push(isDefault); idx++; }

    if (setClauses.length === 0) return this.findById(id, userId);

    params.push(id, userId);
    const { rows } = await query(
      `UPDATE fund_parameters
       SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND user_id = $${idx + 1}
       RETURNING *`,
      params
    );
    return rows[0] || null;
  },

  async delete(id, userId) {
    const { rowCount } = await query(
      'DELETE FROM fund_parameters WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return rowCount > 0;
  },
};

module.exports = FundParameters;
