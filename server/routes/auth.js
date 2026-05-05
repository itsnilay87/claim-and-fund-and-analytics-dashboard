/**
 * Auth routes — register (OTP-verified), login, refresh, logout, profile.
 */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const User = require('../db/models/User');
const UserSettings = require('../db/models/UserSettings');
const RefreshToken = require('../db/models/RefreshToken');
const PendingRegistration = require('../db/models/PendingRegistration');
const PasswordResetRequest = require('../db/models/PasswordResetRequest');
const { generateAccessToken, generateRefreshToken, hashToken } = require('../utils/jwt');
const { authenticateToken } = require('../middleware/auth');
const { sendOtpEmail } = require('../services/email');

const router = express.Router();

// ── Rate limiters ──

const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts. Please try again later.' },
});

// ── Constants ──

const BCRYPT_SALT_ROUNDS = 12;
const REFRESH_TOKEN_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

// Emergency bypass for environments where SMTP is intentionally unavailable.
// Keep this false in production to enforce OTP-based verification.
const SKIP_EMAIL_VERIFICATION = process.env.SKIP_EMAIL_VERIFICATION === 'true';

// Cookie secure flag: only true if COOKIE_SECURE=true or if HTTPS is detected
// Default to false for plain HTTP deployments (e.g. http://178.104.35.208)
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

/**
 * Generate a cryptographically random 6-digit OTP.
 */
function generateOtp() {
  // crypto.randomInt gives a uniform integer in [0, 900000) → add 100000 → [100000, 999999]
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Set the refresh token as an HttpOnly cookie.
 */
function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
  });
}

/**
 * Clear the refresh token cookie.
 */
function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/api/auth',
  });
}

/**
 * Generate tokens for a user, store refresh hash in DB, set cookie.
 * Enforces max 5 refresh tokens per user (prevents token accumulation).
 * @returns {{ accessToken: string }}
 */
async function issueTokens(res, user) {
  const accessToken = generateAccessToken(user);
  const rawRefresh = generateRefreshToken();
  const refreshHash = hashToken(rawRefresh);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  await RefreshToken.create(user.id, refreshHash, expiresAt);

  // Enforce max 5 refresh tokens per user — delete oldest beyond limit
  await RefreshToken.enforceMaxPerUser(user.id, 5);

  setRefreshCookie(res, rawRefresh);

  return accessToken;
}

// ── POST /api/auth/register/request-otp ──
// Step 1: Validate input, hash password + OTP, store in pending_registrations, send OTP email.

router.post('/register/request-otp', authLimiter, async (req, res) => {
  try {
    const { email, password, full_name } = req.body;

    // Validation
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    const normEmail = email.toLowerCase();

    // Check if email already has a verified account
    const existing = await User.findByEmail(normEmail);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password and OTP
    const password_hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    // ── Fast-path: skip email verification when explicitly configured ──
    // Used in deployments where SMTP is unavailable. Creates the user
    // account immediately and issues tokens, just like a verified login.
    if (SKIP_EMAIL_VERIFICATION) {
      const user = await User.create({
        email: normEmail,
        password_hash,
        full_name: full_name.trim(),
      });
      await User.markEmailVerified(user.id);
      const accessToken = await issueTokens(res, user);
      return res.status(201).json({
        user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
        accessToken,
        verification_skipped: true,
      });
    }

    const otp = generateOtp();
    const otp_hash = await bcrypt.hash(otp, BCRYPT_SALT_ROUNDS);
    const expires_at = new Date(Date.now() + OTP_EXPIRY_MS);

    // Upsert into pending_registrations (replaces any previous pending for same email)
    await PendingRegistration.upsert({
      email: normEmail,
      password_hash,
      full_name: full_name.trim(),
      otp_hash,
      expires_at,
    });

    // Opportunistic cleanup of expired rows
    PendingRegistration.deleteExpired().catch(() => {});

    // Send OTP email
    const sent = await sendOtpEmail(normEmail, otp);
    if (!sent) {
      return res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
    }

    res.status(200).json({ message: 'Verification code sent', email: normEmail });
  } catch (err) {
    console.error('[AUTH] Request OTP error:', err.message);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// ── POST /api/auth/register/verify-otp ──
// Step 2: Verify OTP → create user account → issue tokens.

router.post('/register/verify-otp', authLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }

    const normEmail = email.toLowerCase();

    const pending = await PendingRegistration.findByEmail(normEmail);
    if (!pending) {
      return res.status(400).json({ error: 'No pending registration found. Please request a new code.' });
    }

    // Check expiry
    if (new Date(pending.expires_at) < new Date()) {
      await PendingRegistration.deleteByEmail(normEmail);
      return res.status(410).json({ error: 'Verification code expired. Please request a new one.' });
    }

    // Check attempt limit
    if (pending.attempts >= MAX_OTP_ATTEMPTS) {
      await PendingRegistration.deleteByEmail(normEmail);
      return res.status(429).json({ error: 'Too many failed attempts. Please request a new code.' });
    }

    // Verify OTP
    const valid = await bcrypt.compare(String(otp), pending.otp_hash);
    if (!valid) {
      await PendingRegistration.incrementAttempts(normEmail);
      const remaining = MAX_OTP_ATTEMPTS - pending.attempts - 1;
      return res.status(401).json({
        error: `Invalid verification code. ${remaining > 0 ? remaining + ' attempts remaining.' : 'Please request a new code.'}`,
      });
    }

    // OTP is valid — create the real user account
    // Double-check email isn't taken (race condition guard)
    const existingUser = await User.findByEmail(normEmail);
    if (existingUser) {
      await PendingRegistration.deleteByEmail(normEmail);
      return res.status(409).json({ error: 'Email already registered' });
    }

    const user = await User.create({
      email: normEmail,
      password_hash: pending.password_hash,
      full_name: pending.full_name,
    });

    // Mark email as verified
    await User.markEmailVerified(user.id);

    // Clean up pending row
    await PendingRegistration.deleteByEmail(normEmail);

    // Issue tokens
    const accessToken = await issueTokens(res, user);

    res.status(201).json({
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      accessToken,
    });
  } catch (err) {
    console.error('[AUTH] Verify OTP error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── POST /api/auth/register/resend-otp ──
// Resend a new OTP for an existing pending registration.

router.post('/register/resend-otp', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normEmail = email.toLowerCase();

    const pending = await PendingRegistration.findByEmail(normEmail);
    if (!pending) {
      return res.status(400).json({ error: 'No pending registration found. Please sign up again.' });
    }

    // Generate new OTP and update the row
    const otp = generateOtp();
    const otp_hash = await bcrypt.hash(otp, BCRYPT_SALT_ROUNDS);
    const expires_at = new Date(Date.now() + OTP_EXPIRY_MS);

    await PendingRegistration.upsert({
      email: normEmail,
      password_hash: pending.password_hash,
      full_name: pending.full_name,
      otp_hash,
      expires_at,
    });

    const sent = await sendOtpEmail(normEmail, otp);
    if (!sent) {
      return res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
    }

    res.status(200).json({ message: 'New verification code sent' });
  } catch (err) {
    console.error('[AUTH] Resend OTP error:', err.message);
    res.status(500).json({ error: 'Failed to resend verification code' });
  }
});

// ── POST /api/auth/forgot-password/request-otp ──
// Request a reset code by email.

router.post('/forgot-password/request-otp', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const normEmail = email.toLowerCase();
    const user = await User.findByEmail(normEmail);

    // Never disclose whether an account exists.
    if (!user) {
      return res.status(200).json({ message: 'If the account exists, a verification code has been sent.' });
    }

    const otp = generateOtp();
    const otp_hash = await bcrypt.hash(otp, BCRYPT_SALT_ROUNDS);
    const expires_at = new Date(Date.now() + OTP_EXPIRY_MS);

    await PasswordResetRequest.upsert({
      email: normEmail,
      user_id: user.id,
      otp_hash,
      expires_at,
    });

    PasswordResetRequest.deleteExpired().catch(() => {});

    const sent = await sendOtpEmail(normEmail, otp);
    if (!sent) {
      return res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
    }

    return res.status(200).json({ message: 'Verification code sent' });
  } catch (err) {
    console.error('[AUTH] Forgot password request OTP error:', err.message);
    return res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// ── POST /api/auth/forgot-password/verify-otp ──
// Verify reset OTP and set a new password.

router.post('/forgot-password/verify-otp', authLimiter, async (req, res) => {
  try {
    const { email, otp, new_password } = req.body;

    if (!email || !otp || !new_password) {
      return res.status(400).json({ error: 'Email, verification code, and new password are required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const normEmail = email.toLowerCase();
    const reset = await PasswordResetRequest.findByEmail(normEmail);
    if (!reset) {
      return res.status(400).json({ error: 'No pending password reset found. Please request a new code.' });
    }

    if (new Date(reset.expires_at) < new Date()) {
      await PasswordResetRequest.deleteByEmail(normEmail);
      return res.status(410).json({ error: 'Verification code expired. Please request a new one.' });
    }

    if (reset.attempts >= MAX_OTP_ATTEMPTS) {
      await PasswordResetRequest.deleteByEmail(normEmail);
      return res.status(429).json({ error: 'Too many failed attempts. Please request a new code.' });
    }

    const valid = await bcrypt.compare(String(otp), reset.otp_hash);
    if (!valid) {
      await PasswordResetRequest.incrementAttempts(normEmail);
      const remaining = MAX_OTP_ATTEMPTS - reset.attempts - 1;
      return res.status(401).json({
        error: `Invalid verification code. ${remaining > 0 ? remaining + ' attempts remaining.' : 'Please request a new code.'}`,
      });
    }

    const user = await User.findByEmail(normEmail);
    if (!user) {
      await PasswordResetRequest.deleteByEmail(normEmail);
      return res.status(404).json({ error: 'User not found' });
    }

    const newHash = await bcrypt.hash(new_password, BCRYPT_SALT_ROUNDS);
    await User.updatePassword(user.id, newHash);

    // Force logout from all devices after password reset.
    await RefreshToken.deleteAllForUser(user.id);
    await PasswordResetRequest.deleteByEmail(normEmail);

    return res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('[AUTH] Forgot password verify OTP error:', err.message);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ── POST /api/auth/login ──

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findByEmail(email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const accessToken = await issueTokens(res, user);

    res.json({
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      accessToken,
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /api/auth/refresh ──

router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const rawToken = req.cookies && req.cookies.refreshToken;
    if (!rawToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const tokenHash = hashToken(rawToken);
    const stored = await RefreshToken.findByHash(tokenHash);

    if (!stored) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Check expiry
    if (new Date(stored.expires_at) < new Date()) {
      await RefreshToken.deleteByHash(tokenHash);
      clearRefreshCookie(res);
      // Opportunistic cleanup: purge other expired tokens
      RefreshToken.deleteExpired().catch(() => {});
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    // Rotate: delete old, issue new
    await RefreshToken.deleteByHash(tokenHash);

    const user = await User.findById(stored.user_id);
    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'User not found' });
    }

    const accessToken = await issueTokens(res, user);

    res.json({ accessToken });
  } catch (err) {
    console.error('[AUTH] Refresh error:', err.message);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// ── POST /api/auth/logout ──

router.post('/logout', async (req, res) => {
  try {
    const rawToken = req.cookies && req.cookies.refreshToken;
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      await RefreshToken.deleteByHash(tokenHash);
    }
    clearRefreshCookie(res);
    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('[AUTH] Logout error:', err.message);
    // Still clear cookie even if DB delete fails
    clearRefreshCookie(res);
    res.json({ message: 'Logged out' });
  }
});

// ── GET /api/auth/me ──

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const settings = await UserSettings.getByUserId(req.user.id);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        created_at: user.created_at,
        settings,
      },
    });
  } catch (err) {
    console.error('[AUTH] Profile fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ── GET /api/auth/me/settings ──

router.get('/me/settings', authenticateToken, async (req, res) => {
  try {
    const settings = await UserSettings.getByUserId(req.user.id);
    res.json({ settings });
  } catch (err) {
    console.error('[AUTH] Settings fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// ── PUT /api/auth/me/settings ──

router.put('/me/settings', authenticateToken, async (req, res) => {
  try {
    const { auto_save_portfolio_runs } = req.body || {};
    if (
      auto_save_portfolio_runs !== undefined
      && typeof auto_save_portfolio_runs !== 'boolean'
    ) {
      return res.status(400).json({ error: 'auto_save_portfolio_runs must be boolean' });
    }
    const settings = await UserSettings.upsert(req.user.id, { auto_save_portfolio_runs });
    res.json({ settings });
  } catch (err) {
    console.error('[AUTH] Settings update error:', err.message);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ── PUT /api/auth/me/password ──

router.put('/me/password', authenticateToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    if (current_password === new_password) {
      return res.status(400).json({ error: 'New password must differ from current password' });
    }

    const hash = await User.getPasswordHash(req.user.id);
    if (!hash) {
      return res.status(404).json({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(current_password, hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(new_password, BCRYPT_SALT_ROUNDS);
    await User.updatePassword(req.user.id, newHash);

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('[AUTH] Password change error:', err.message);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// ── PUT /api/auth/me ──

router.put('/me', authenticateToken, async (req, res) => {
  try {
    const { full_name, email } = req.body;

    if (email !== undefined && !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const updated = await User.updateProfile(req.user.id, {
      full_name: full_name !== undefined ? full_name.trim() : undefined,
      email: email !== undefined ? email.toLowerCase() : undefined,
    });

    res.json({ user: updated });
  } catch (err) {
    console.error('[AUTH] Profile update error:', err.message);
    if (err.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    // Handle unique constraint violation on email
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
