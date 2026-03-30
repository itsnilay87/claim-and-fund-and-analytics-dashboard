/**
 * PendingRegistration model — queries against the `pending_registrations` table.
 */
const { query } = require('../pool');

const PendingRegistration = {
  /**
   * Create or replace a pending registration (upsert by email).
   * If the same email requests a new OTP, the old row is replaced.
   */
  async upsert({ email, password_hash, full_name, otp_hash, expires_at }) {
    const { rows } = await query(
      `INSERT INTO pending_registrations (email, password_hash, full_name, otp_hash, attempts, expires_at)
       VALUES ($1, $2, $3, $4, 0, $5)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             full_name     = EXCLUDED.full_name,
             otp_hash      = EXCLUDED.otp_hash,
             attempts      = 0,
             expires_at    = EXCLUDED.expires_at,
             created_at    = NOW()
       RETURNING id, email, expires_at, created_at`,
      [email, password_hash, full_name, otp_hash, expires_at]
    );
    return rows[0];
  },

  /**
   * Find a pending registration by email.
   */
  async findByEmail(email) {
    const { rows } = await query(
      `SELECT id, email, password_hash, full_name, otp_hash, attempts, expires_at, created_at
       FROM pending_registrations WHERE email = $1`,
      [email]
    );
    return rows[0] || null;
  },

  /**
   * Increment the attempt counter and return the updated row.
   */
  async incrementAttempts(email) {
    const { rows } = await query(
      `UPDATE pending_registrations SET attempts = attempts + 1 WHERE email = $1
       RETURNING id, email, attempts, expires_at`,
      [email]
    );
    return rows[0] || null;
  },

  /**
   * Delete a pending registration by email (after successful verification).
   */
  async deleteByEmail(email) {
    await query('DELETE FROM pending_registrations WHERE email = $1', [email]);
  },

  /**
   * Delete all expired pending registrations (housekeeping).
   */
  async deleteExpired() {
    const { rowCount } = await query(
      'DELETE FROM pending_registrations WHERE expires_at < NOW()'
    );
    return rowCount;
  },
};

module.exports = PendingRegistration;
