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
 *
 * Port: 3001 (or PORT env var)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const simulateRouter = require('./routes/simulate');
const resultsRouter = require('./routes/results');
const jurisdictionsRouter = require('./routes/jurisdictions');
const claimsRouter = require('./routes/claims');
const templatesRouter = require('./routes/templates');
const { getDefaults } = require('./services/configService');
const { listRuns } = require('./services/simulationRunner');
const { pool } = require('./db/pool');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──
app.use(cors({
  origin: (origin, callback) => {
    // In production behind Nginx, origin is same-host (no origin header) or the server's own domain.
    // In development, allow any localhost port.
    if (!origin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      callback(null, true);
    } else if (process.env.ALLOWED_ORIGIN && origin === process.env.ALLOWED_ORIGIN) {
      callback(null, true);
    } else if (process.env.NODE_ENV === 'production') {
      // Behind Nginx reverse proxy — allow all origins (Nginx handles external access)
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({ limit: '10mb' }));

// ── Routes (order matters — specific before wildcard) ──
app.use('/api/simulate', simulateRouter);
app.use('/api/jurisdictions', jurisdictionsRouter);
app.use('/api/claims', claimsRouter);
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
    res.status(500).json({ error: err.message });
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

// ── Legacy runs list (backward-compat with claim-analytics old app) ──
app.get('/api/runs', (_req, res) => {
  try {
    const runs = listRuns();
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 404 handler — always return JSON, never HTML ──
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handling middleware ──
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message });
});

// ── Start server ──
app.listen(PORT, () => {
  console.log(`[Claim Analytics Server] Running on http://localhost:${PORT}`);
  console.log(`[Claim Analytics Server] Engine dir: ${path.resolve(__dirname, '..', 'engine')}`);
  console.log(`[Claim Analytics Server] Runs dir:   ${path.resolve(__dirname, 'runs')}`);

  // Non-blocking DB connectivity check — server works without DB
  pool.query('SELECT 1')
    .then(() => console.log('[Claim Analytics Server] Database connected ✓'))
    .catch((err) => console.warn('[Claim Analytics Server] Database unavailable — running without DB:', err.message));
});

module.exports = app;
