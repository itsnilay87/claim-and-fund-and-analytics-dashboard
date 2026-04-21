/**
 * User model — queries against the `users` table.
 */
const { query } = require('../pool');

const User = {
  /**
   * Find a user by email (includes password_hash for auth verification).
   * @param {string} email
   * @returns {Promise<object|null>} user row or null
   */
  async findByEmail(email) {
    const { rows } = await query(
      'SELECT id, email, password_hash, full_name, role, created_at, updated_at FROM users WHERE email = $1',
      [email]
    );
    return rows[0] || null;
  },

  /**
   * Find a user by ID (excludes password_hash).
   * @param {string} id - UUID
   * @returns {Promise<object|null>} user row (no password_hash) or null
   */
  async findById(id) {
    const { rows } = await query(
      'SELECT id, email, full_name, role, created_at, updated_at FROM users WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  },

  /**
   * Create a new user.
   * @param {{ email: string, password_hash: string, full_name: string }} data
   * @returns {Promise<object>} created user (no password_hash)
   */
  async create({ email, password_hash, full_name }) {
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, full_name, role, email_verified, created_at, updated_at`,
      [email, password_hash, full_name]
    );
    return rows[0];
  },

  /**
   * Set email_verified = TRUE for a user.
   * @param {string} id - UUID
   */
  async markEmailVerified(id) {
    await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [id]);
  },

  /**
   * Fetch only the password_hash for a user (for password verification).
   * @param {string} id - UUID
   * @returns {Promise<string|null>} password_hash or null
   */
  async getPasswordHash(id) {
    const { rows } = await query(
      'SELECT password_hash FROM users WHERE id = $1',
      [id]
    );
    return rows[0]?.password_hash || null;
  },

  /**
   * Update a user's password hash.
   * @param {string} id - UUID
   * @param {string} password_hash - new bcrypt hash
   */
  async updatePassword(id, password_hash) {
    const { rowCount } = await query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [password_hash, id]
    );
    if (rowCount === 0) throw new Error('User not found');
  },

  /**
   * Update a user's profile fields.
   * @param {string} id - UUID
   * @param {{ full_name?: string, email?: string }} fields
   * @returns {Promise<object>} updated user (no password_hash)
   */
  async updateProfile(id, { full_name, email }) {
    const { rows } = await query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           email     = COALESCE($2, email)
       WHERE id = $3
       RETURNING id, email, full_name, role, created_at, updated_at`,
      [full_name, email, id]
    );
    if (!rows[0]) throw new Error('User not found');
    return rows[0];
  },
};

module.exports = User;
