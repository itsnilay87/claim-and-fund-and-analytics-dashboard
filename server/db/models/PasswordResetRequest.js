/**
 * PasswordResetRequest model — queries against `password_reset_requests`.
 */
const { query } = require('../pool');

const PasswordResetRequest = {
  async upsert({ email, user_id, otp_hash, expires_at }) {
    const { rows } = await query(
      `INSERT INTO password_reset_requests (email, user_id, otp_hash, attempts, expires_at)
       VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (email) DO UPDATE
         SET user_id    = EXCLUDED.user_id,
             otp_hash   = EXCLUDED.otp_hash,
             attempts   = 0,
             expires_at = EXCLUDED.expires_at,
             created_at = NOW()
       RETURNING id, email, user_id, attempts, expires_at, created_at`,
      [email, user_id, otp_hash, expires_at]
    );
    return rows[0];
  },

  async findByEmail(email) {
    const { rows } = await query(
      `SELECT id, email, user_id, otp_hash, attempts, expires_at, created_at
       FROM password_reset_requests
       WHERE email = $1`,
      [email]
    );
    return rows[0] || null;
  },

  async incrementAttempts(email) {
    const { rows } = await query(
      `UPDATE password_reset_requests
       SET attempts = attempts + 1
       WHERE email = $1
       RETURNING id, email, user_id, attempts, expires_at`,
      [email]
    );
    return rows[0] || null;
  },

  async deleteByEmail(email) {
    await query('DELETE FROM password_reset_requests WHERE email = $1', [email]);
  },

  async deleteExpired() {
    const { rowCount } = await query(
      'DELETE FROM password_reset_requests WHERE expires_at < NOW()'
    );
    return rowCount;
  },
};

module.exports = PasswordResetRequest;
