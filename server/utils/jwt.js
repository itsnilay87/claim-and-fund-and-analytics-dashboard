/**
 * JWT utility — token generation and verification.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('[AUTH WARNING] JWT_SECRET not set — using insecure dev-only fallback. DO NOT use in production.');
  return 'dev-only-insecure-jwt-secret-do-not-use-in-production-12345678';
})();

const ACCESS_TOKEN_EXPIRY = '15m';

/**
 * Generate a short-lived access token (JWT).
 * @param {{ id: string, email: string, role: string }} user
 * @returns {string} signed JWT
 */
function generateAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

/**
 * Generate an opaque refresh token (random 64-byte hex string, NOT a JWT).
 * @returns {string} 128-char hex string
 */
function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Hash a refresh token with SHA-256 for DB storage.
 * @param {string} token - raw refresh token
 * @returns {string} hex-encoded hash
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verify and decode an access token.
 * @param {string} token
 * @returns {{ sub: string, email: string, role: string, iat: number, exp: number }}
 * @throws {jwt.JsonWebTokenError|jwt.TokenExpiredError}
 */
function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  verifyAccessToken,
};
