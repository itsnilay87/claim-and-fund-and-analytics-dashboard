/**
 * Auth routes — register, login, refresh, logout, profile.
 */
const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const User = require('../db/models/User');
const RefreshToken = require('../db/models/RefreshToken');
const { generateAccessToken, generateRefreshToken, hashToken } = require('../utils/jwt');
const { authenticateToken } = require('../middleware/auth');

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

/**
 * Set the refresh token as an HttpOnly cookie.
 */
function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
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
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
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

// ── POST /api/auth/register ──

router.post('/register', authLimiter, async (req, res) => {
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

    // Check if email already exists
    const existing = await User.findByEmail(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password and create user
    const password_hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const user = await User.create({
      email: email.toLowerCase(),
      password_hash,
      full_name: full_name.trim(),
    });

    // Issue tokens
    const accessToken = await issueTokens(res, user);

    res.status(201).json({
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      accessToken,
    });
  } catch (err) {
    console.error('[AUTH] Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
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
    res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('[AUTH] Profile fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
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
