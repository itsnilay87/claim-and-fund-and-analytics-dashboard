/**
 * Claim model — queries against the `claims` table.
 *
 * Indexed columns (stored as top-level DB columns):
 *   name, claimant, respondent, jurisdiction, claim_type, soc_value_cr, currency, status
 *
 * Everything else is stored in the `data` JSONB column.
 * Read methods merge indexed columns back into the JSONB blob so callers
 * see a single flat claim object (matching the localStorage-era shape).
 */
const { query } = require('../pool');

/** Columns that are promoted to their own indexed DB columns. */
const INDEXED_FIELDS = [
  'name', 'claimant', 'respondent', 'jurisdiction',
  'claim_type', 'soc_value_cr', 'currency', 'status',
];

/**
 * Split an incoming claim object into { indexed, data }.
 * @param {object} obj - full claim blob
 * @returns {{ indexed: object, data: object }}
 */
function splitFields(obj) {
  const indexed = {};
  const data = {};
  for (const [key, value] of Object.entries(obj)) {
    if (INDEXED_FIELDS.includes(key)) {
      indexed[key] = value;
    } else {
      data[key] = value;
    }
  }
  return { indexed, data };
}

/**
 * Merge a DB row back into a flat claim object.
 * Indexed columns override same-named keys that might exist in data JSONB.
 * @param {object} row - database row
 * @returns {object} flat claim
 */
function mergeRow(row) {
  const { data, ...rest } = row;
  // pg returns DECIMAL columns as strings — cast numeric fields
  if (rest.soc_value_cr != null) rest.soc_value_cr = parseFloat(rest.soc_value_cr);
  return { ...data, ...rest };
}

const Claim = {
  /**
   * List all claims in a workspace (user-scoped).
   * @param {string} workspaceId - UUID
   * @param {string} userId - UUID
   * @returns {Promise<object[]>} flat claim objects
   */
  async findAllByWorkspace(workspaceId, userId) {
    const { rows } = await query(
      `SELECT id, workspace_id, user_id, name, claimant, respondent,
              jurisdiction, claim_type, soc_value_cr, currency, status,
              data, created_at, updated_at
       FROM claims
       WHERE workspace_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [workspaceId, userId]
    );
    return rows.map(mergeRow);
  },

  /**
   * Get a single claim by ID (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @returns {Promise<object|null>} flat claim object or null
   */
  async findById(id, userId) {
    const { rows } = await query(
      `SELECT id, workspace_id, user_id, name, claimant, respondent,
              jurisdiction, claim_type, soc_value_cr, currency, status,
              data, created_at, updated_at
       FROM claims
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return rows[0] ? mergeRow(rows[0]) : null;
  },

  /**
   * Create a new claim.
   * @param {string} userId - UUID
   * @param {string} workspaceId - UUID
   * @param {object} claimData - full claim blob
   * @returns {Promise<object>} created flat claim
   */
  async create(userId, workspaceId, claimData) {
    const { indexed, data } = splitFields(claimData);
    const { rows } = await query(
      `INSERT INTO claims
         (user_id, workspace_id, name, claimant, respondent, jurisdiction,
          claim_type, soc_value_cr, currency, status, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, workspace_id, user_id, name, claimant, respondent,
                 jurisdiction, claim_type, soc_value_cr, currency, status,
                 data, created_at, updated_at`,
      [
        userId,
        workspaceId,
        indexed.name       || '',
        indexed.claimant   || '',
        indexed.respondent || '',
        indexed.jurisdiction || 'indian_domestic',
        indexed.claim_type   || 'prolongation',
        indexed.soc_value_cr ?? 1000,
        indexed.currency     || 'INR',
        indexed.status       || 'draft',
        JSON.stringify(data),
      ]
    );
    return mergeRow(rows[0]);
  },

  /**
   * Update an existing claim (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @param {object} updates - partial claim blob
   * @returns {Promise<object>} updated flat claim
   */
  async update(id, userId, updates) {
    const { indexed, data } = splitFields(updates);

    // Build SET clause dynamically for indexed fields that are present
    const setClauses = [];
    const params = [];
    let idx = 1;

    for (const field of INDEXED_FIELDS) {
      if (field in indexed) {
        setClauses.push(`${field} = $${idx}`);
        params.push(indexed[field]);
        idx++;
      }
    }

    // If there are JSONB data keys, merge them into existing data
    if (Object.keys(data).length > 0) {
      setClauses.push(`data = data || $${idx}`);
      params.push(JSON.stringify(data));
      idx++;
    }

    if (setClauses.length === 0) {
      // Nothing to update — just return current state
      return this.findById(id, userId);
    }

    params.push(id, userId);
    const idIdx = idx;

    const { rows } = await query(
      `UPDATE claims
       SET ${setClauses.join(', ')}
       WHERE id = $${idIdx} AND user_id = $${idIdx + 1}
       RETURNING id, workspace_id, user_id, name, claimant, respondent,
                 jurisdiction, claim_type, soc_value_cr, currency, status,
                 data, created_at, updated_at`,
      params
    );
    if (!rows[0]) throw new Error('Claim not found');
    return mergeRow(rows[0]);
  },

  /**
   * Delete a claim (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @returns {Promise<boolean>} true if deleted
   */
  async delete(id, userId) {
    const { rowCount } = await query(
      'DELETE FROM claims WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return rowCount > 0;
  },

  /**
   * Update only the status of a claim (user-scoped).
   * @param {string} id - UUID
   * @param {string} userId - UUID
   * @param {string} status - new status value
   * @returns {Promise<object>} updated flat claim
   */
  async updateStatus(id, userId, status) {
    const { rows } = await query(
      `UPDATE claims SET status = $1
       WHERE id = $2 AND user_id = $3
       RETURNING id, workspace_id, user_id, name, claimant, respondent,
                 jurisdiction, claim_type, soc_value_cr, currency, status,
                 data, created_at, updated_at`,
      [status, id, userId]
    );
    if (!rows[0]) throw new Error('Claim not found');
    return mergeRow(rows[0]);
  },
};

module.exports = Claim;
