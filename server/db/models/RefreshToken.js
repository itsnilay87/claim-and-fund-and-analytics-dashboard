/**
 * RefreshToken model — queries against the `refresh_tokens` table.
 */
const { query } = require('../pool');

const RefreshToken = {
  /**
   * Store a new refresh token hash.
   * @param {string} userId - UUID
   * @param {string} tokenHash - hashed token
   * @param {Date|string} expiresAt - expiration timestamp
   * @returns {Promise<object>} created token record
   */
  async create(userId, tokenHash, expiresAt) {
    const { rows } = await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, token_hash, expires_at, created_at`,
      [userId, tokenHash, expiresAt]
    );
    return rows[0];
  },

  /**
   * Look up a refresh token by its hash.
   * @param {string} tokenHash
   * @returns {Promise<object|null>} token record (with user_id) or null
   */
  async findByHash(tokenHash) {
    const { rows } = await query(
      'SELECT id, user_id, token_hash, expires_at, created_at FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash]
    );
    return rows[0] || null;
  },

  /**
   * Delete a single refresh token by its hash.
   * @param {string} tokenHash
   * @returns {Promise<void>}
   */
  async deleteByHash(tokenHash) {
    await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  },

  /**
   * Delete all refresh tokens for a user (logout from all devices).
   * @param {string} userId - UUID
   * @returns {Promise<void>}
   */
  async deleteAllForUser(userId) {
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
  },

  /**
   * Purge expired tokens.
   * @returns {Promise<number>} count of deleted tokens
   */
  async deleteExpired() {
    const { rowCount } = await query(
      'DELETE FROM refresh_tokens WHERE expires_at < NOW()'
    );
    return rowCount;
  },
};

module.exports = RefreshToken;
