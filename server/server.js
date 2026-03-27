/**
 * Claim Analytics Platform — Express API Server
 *
 * Endpoints:
 *   GET    /api/health                — Health check
 *   POST   /api/simulate/claim        — Launch single-claim simulation
 *   POST   /api/simulate/portfolio    — Launch portfolio simulation
 *   GET    /api/status/:runId         — Poll run status
 *   GET    /api/results/:runId/files  — List output files
 *   GET    /api/results/:runId/*      — Serve output files
 *   GET    /api/jurisdictions         — List jurisdiction templates
 *   GET    /api/jurisdictions/:id     — Get jurisdiction template
 *   GET    /api/jurisdictions/:id/defaults — Get defaults for jurisdiction
 *   GET    /api/claims                — List stored claims
 *   POST   /api/claims                — Store a claim
 *   GET    /api/defaults              — Return server defaults
 *   POST   /api/auth/register         — User registration
 *   POST   /api/auth/login            — User login
 *   POST   /api/auth/refresh          — Refresh access token
 *   POST   /api/auth/logout           — User logout
 *   GET    /api/auth/me               — Current user profile
 *   PUT    /api/auth/me               — Update user profile
 *   GET    /api/runs                  — User's run history (auth) or legacy run list (no auth)
 *   GET    /api/runs/:id              — Single run detail (auth)
 *   DELETE /api/runs/:id              — Delete run (auth)
 *   POST   /api/runs/:id/save         — Save/bookmark a run (auth)
 *   POST   /api/runs/:id/discard      — Discard a run (auth)
 *   GET    /api/runs/compare          — Compare two runs (auth)
 *
 * Port: 3001 (or PORT env var)
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const simulateRouter = require('./routes/simulate');
const resultsRouter = require('./routes/results');
const jurisdictionsRouter = require('./routes/jurisdictions');
const claimsRouter = require('./routes/claims');
const portfoliosRouter = require('./routes/portfolios');
const workspacesRouter = require('./routes/workspaces');
const templatesRouter = require('./routes/templates');
const authRouter = require('./routes/auth');
const runsRouter = require('./routes/runs');
const { authenticateToken } = require('./middleware/auth');
const { getDefaults } = require('./services/configService');
const { listRuns } = require('./services/simulationRunner');
const { pool } = require('./db/pool');
const { runMigrations } = require('./db/migrate');
const RefreshToken = require('./db/models/RefreshToken');

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ── Security: Helmet with configured CSP ──
app.use(helmet({
  contentSecurityPolicy: IS_PRODUCTION ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // Tailwind/inline styles
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  } : false, // Disable CSP in dev (Vite HMR needs eval/inline)
  crossOriginEmbedderPolicy: false, // Needed for cross-origin font loading
  xFrameOptions: { action: 'deny' },
}));

// ── CORS ──
app.use(cors({
  origin: (origin, callback) => {
    // No origin = same-origin or server-to-server (allow)
    if (!origin) return callback(null, true);
    // Dev: allow any localhost port
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    // Production: allow configured origin
    if (process.env.ALLOWED_ORIGIN && origin === process.env.ALLOWED_ORIGIN) return callback(null, true);
    // Behind Nginx reverse proxy — origin matches server domain (Nginx handles external access)
    if (IS_PRODUCTION) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

// ── Global API rate limiter — 100 requests/min per IP ──
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skip: (req) => req.path === '/api/health', // Don't rate-limit health checks
});
app.use('/api', globalApiLimiter);

// ── Routes (order matters — specific before wildcard) ──
// Legacy runs list BEFORE the authenticated /api/runs router
app.get('/api/runs/legacy', (_req, res) => {
  try {
    const runs = listRuns();
    res.json({ runs });
  } catch (err) {
    console.error('[GET /api/runs/legacy]', err.message);
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/simulate', simulateRouter);
app.use('/api/jurisdictions', jurisdictionsRouter);
app.use('/api/workspaces', authenticateToken, workspacesRouter);
app.use('/api/claims', authenticateToken, claimsRouter);
app.use('/api/portfolios', authenticateToken, portfoliosRouter);
app.use('/api/runs', authenticateToken, runsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api', resultsRouter);

// ── Serve dashboard static build ──
const dashboardDist = path.resolve(__dirname, '..', 'dashboard', 'dist');
app.use('/dashboard', express.static(dashboardDist));
app.get('/dashboard/*', (_req, res) => {
  res.sendFile(path.join(dashboardDist, 'index.html'));
});

// ── Defaults endpoint ──
app.get('/api/defaults', (_req, res) => {
  try {
    res.json(getDefaults());
  } catch (err) {
    console.error('[GET /api/defaults]', err.message);
    res.status(500).json({ error: 'Failed to load defaults' });
  }
});

// ── Health check ──
app.get('/api/health', async (_req, res) => {
  const checks = { server: 'ok' };
  try {
    await pool.query('SELECT 1');
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }
  res.json({
    status: checks.database === 'ok' ? 'ok' : 'degraded',
    ...checks,
    timestamp: new Date().toISOString(),
  });
});

// ── 404 handler — always return JSON, never HTML ──
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handling middleware — never expose stack traces in production ──
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.stack || err.message);
  if (IS_PRODUCTION) {
    res.status(500).json({ error: 'Internal server error' });
  } else {
    res.status(500).json({ error: err.message });
  }
});

// ── Start server ──
app.listen(PORT, () => {
  console.log(`[Claim Analytics Server] Running on http://localhost:${PORT}`);
  console.log(`[Claim Analytics Server] Engine dir: ${path.resolve(__dirname, '..', 'engine')}`);
  console.log(`[Claim Analytics Server] Runs dir:   ${path.resolve(__dirname, 'runs')}`);

  // Non-blocking DB connectivity check + auto-migration
  pool.query('SELECT 1')
    .then(async () => {
      console.log('[Claim Analytics Server] Database connected ✓');
      try {
        await runMigrations();
        console.log('[Claim Analytics Server] Migrations applied ✓');
      } catch (err) {
        console.error('[Claim Analytics Server] Migration failed:', err.message);
      }
    })
    .catch((err) => console.warn('[Claim Analytics Server] Database unavailable — running without DB:', err.message));

  // Periodic refresh token cleanup — purge expired tokens every hour
  setInterval(async () => {
    try {
      const count = await RefreshToken.deleteExpired();
      if (count > 0) console.log(`[Cleanup] Purged ${count} expired refresh tokens`);
    } catch (err) {
      console.warn('[Cleanup] Failed to purge expired tokens:', err.message);
    }
  }, 60 * 60 * 1000);
});

// ── Unhandled rejection / exception safety net ──
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  // Give time for logs to flush, then exit
  setTimeout(() => process.exit(1), 1000);
});

module.exports = app;
