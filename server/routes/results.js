/**
 * Results Routes
 *
 * GET /api/status/:runId        — Poll run status
 * GET /api/results/:runId/files — List available output files
 * GET /api/results/:runId/*     — Serve output files
 *
 * Security: authenticateToken is applied to all routes. The run must belong
 * to the authenticated user (IDOR prevention via fail-closed ownership check).
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getStatus, listRunFiles, getResultFilePath, getLegacyResultFilePath, listRuns } = require('../services/simulationRunner');
const SimulationRun = require('../db/models/SimulationRun');
const { authenticateToken } = require('../middleware/auth');

// UUID v4 format validation regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RUNS_DIR = path.resolve(__dirname, '..', 'runs');

// Per-request ownership cache (attached to req object)
async function verifyRunOwnership(req, runId) {
  // Auth is required — reject if no user
  if (!req.user) return false;

  // Check in-request cache
  if (!req._runOwnershipCache) req._runOwnershipCache = {};
  if (runId in req._runOwnershipCache) return req._runOwnershipCache[runId];

  // Strategy 1: DB lookup (preferred — survives server restart)
  try {
    const dbRun = await SimulationRun.findById(runId, req.user.id);
    if (dbRun) {
      req._runOwnershipCache[runId] = true;
      return true;
    }
  } catch {
    // DB unavailable — fall through to filesystem check
  }

  // Strategy 2: Filesystem — runs are stored at runs/{userId}/{runId}/
  // This covers the case where DB was unavailable when the run was created
  // but the simulation still ran successfully via the in-memory runner.
  const userRunDir = path.join(RUNS_DIR, req.user.id, runId);
  const owned = fs.existsSync(userRunDir);
  req._runOwnershipCache[runId] = owned;
  return owned;
}

/**
 * GET /api/status/:runId
 * Returns current run status with progress info.
 * Falls back to DB lookup if not found in-memory (survives server restarts).
 */
router.get('/status/:runId', authenticateToken, async (req, res) => {
  const { runId } = req.params;
  if (!UUID_RE.test(runId)) return res.status(400).json({ error: 'Invalid run ID format' });

  // Verify ownership before returning any data
  const owned = await verifyRunOwnership(req, runId);
  if (!owned) return res.status(404).json({ error: 'Run not found' });

  // Try in-memory first (fast path for active runs)
  const status = getStatus(runId, req.user.id);

  if (status) {
    return res.json({
      runId: status.runId,
      status: status.status,
      progress: status.progress,
      stage: status.stage || null,
      mode: status.mode || 'portfolio',
      startedAt: status.startedAt,
      completedAt: status.completedAt,
      error: status.error,
      portfolios: status.portfolios || null,
      completedPortfolios: status.completedPortfolios || null,
    });
  }

  // Fall back to DB lookup (survives server restarts)
  try {
    const dbRun = await SimulationRun.findById(runId, req.user.id);

    if (dbRun) {
      return res.json({
        runId: dbRun.id,
        status: dbRun.status,
        progress: dbRun.progress || 0,
        stage: dbRun.stage || null,
        mode: dbRun.mode || 'portfolio',
        startedAt: dbRun.started_at,
        completedAt: dbRun.completed_at,
        error: dbRun.error_message,
      });
    }
  } catch (dbErr) {
    // DB unavailable — don't fail, just report not found
    console.warn('[GET /api/status] DB fallback failed:', dbErr.message);
  }

  return res.status(404).json({ error: `Run '${runId}' not found` });
});

/**
 * GET /api/results/:runId/files
 * Lists available output files with categories.
 */
router.get('/results/:runId/files', authenticateToken, async (req, res) => {
  const { runId } = req.params;
  if (!UUID_RE.test(runId)) return res.status(400).json({ error: 'Invalid run ID format' });

  const owned = await verifyRunOwnership(req, runId);
  if (!owned) return res.status(404).json({ error: 'Run not found' });

  const status = getStatus(runId, req.user.id);

  if (!status) {
    return res.status(404).json({ error: `Run '${runId}' not found` });
  }

  const files = listRunFiles(runId, req.user.id);

  const excel = files.filter(f => f.type === 'excel');
  const pdf = files.filter(f => f.type === 'pdf');
  const data = files.filter(f => f.type === 'data');
  const charts = files.filter(f => f.type === 'chart');
  const logs = files.filter(f => f.type === 'log');

  res.json({
    runId,
    totalFiles: files.length,
    categories: { excel, pdf, data, charts, logs },
    all: files,
  });
});

/**
 * GET /api/results/:runId/dashboard_data.json
 * Serves dashboard data JSON with proper Content-Type.
 */
router.get('/results/:runId/dashboard_data.json', authenticateToken, async (req, res) => {
  const { runId } = req.params;
  if (!UUID_RE.test(runId)) return res.status(400).json({ error: 'Invalid run ID format' });
  const owned = await verifyRunOwnership(req, runId);
  if (!owned) return res.status(404).json({ error: 'Not found' });
  const absPath = getResultFilePath(runId, 'dashboard_data.json', req.user.id);
  if (!absPath) return res.status(404).json({ error: 'dashboard_data.json not found' });
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(absPath);
});

/**
 * GET /api/results/:runId/stochastic_pricing.json
 * Serves stochastic pricing grid results with proper Content-Type.
 */
router.get('/results/:runId/stochastic_pricing.json', authenticateToken, async (req, res) => {
  const { runId } = req.params;
  if (!UUID_RE.test(runId)) return res.status(400).json({ error: 'Invalid run ID format' });
  const owned = await verifyRunOwnership(req, runId);
  if (!owned) return res.status(404).json({ error: 'Not found' });
  const absPath = getResultFilePath(runId, 'stochastic_pricing.json', req.user.id);
  if (!absPath) return res.status(404).json({ error: 'stochastic_pricing.json not found' });
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(absPath);
});

/**
 * GET /api/results/:runId/pricing_surface.json
 * Serves pricing surface data with proper Content-Type.
 */
router.get('/results/:runId/pricing_surface.json', authenticateToken, async (req, res) => {
  const { runId } = req.params;
  if (!UUID_RE.test(runId)) return res.status(400).json({ error: 'Invalid run ID format' });
  const owned = await verifyRunOwnership(req, runId);
  if (!owned) return res.status(404).json({ error: 'Not found' });
  const absPath = getResultFilePath(runId, 'pricing_surface.json', req.user.id);
  if (!absPath) return res.status(404).json({ error: 'pricing_surface.json not found' });
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(absPath);
});

/**
 * GET /api/results/:runId/charts.zip
 * Creates and serves a zip archive of all chart PNG files.
 */
router.get('/results/:runId/charts.zip', authenticateToken, async (req, res) => {
  const { runId } = req.params;
  if (!UUID_RE.test(runId)) return res.status(400).json({ error: 'Invalid run ID format' });
  const owned = await verifyRunOwnership(req, runId);
  if (!owned) return res.status(404).json({ error: 'Not found' });
  const status = getStatus(runId, req.user.id);
  if (!status) return res.status(404).json({ error: `Run '${runId}' not found` });

  const chartsDir = getResultFilePath(runId, 'charts', req.user.id);
  if (!chartsDir || !fs.existsSync(chartsDir) || !fs.statSync(chartsDir).isDirectory()) {
    return res.status(404).json({ error: 'No charts directory found for this run' });
  }

  try {
    const archiver = require('archiver');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="charts_${runId.slice(0, 8)}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => res.status(500).json({ error: err.message }));
    archive.pipe(res);
    archive.directory(chartsDir, 'charts');
    await archive.finalize();
  } catch (err) {
    // archiver not installed — fall back to listing files
    if (err.code === 'MODULE_NOT_FOUND') {
      return res.status(501).json({
        error: 'Zip generation not available. Install archiver: npm install archiver',
        charts: fs.readdirSync(chartsDir).filter(f => f.endsWith('.png')),
      });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/results/:runId/*
 * Serves individual output files.
 */
router.get('/results/:runId/*', authenticateToken, async (req, res) => {
  const { runId } = req.params;
  if (!UUID_RE.test(runId)) return res.status(400).json({ error: 'Invalid run ID format' });
  const owned = await verifyRunOwnership(req, runId);
  if (!owned) return res.status(404).json({ error: 'Not found' });

  const filePath = req.params[0];

  if (!filePath) {
    return res.status(400).json({ error: 'File path required' });
  }

  const status = getStatus(runId, req.user.id);
  if (!status) {
    return res.status(404).json({ error: `Run '${runId}' not found` });
  }

  let absPath = getResultFilePath(runId, filePath, req.user.id);

  // Fallback 1: strip portfolio-mode prefix (e.g. "all/dashboard_data.json" → "dashboard_data.json")
  // Single-claim runs output files at root level, but the dashboard requests with mode prefix.
  if (!absPath) {
    const segments = filePath.split('/');
    if (segments.length > 1) {
      const stripped = segments.slice(1).join('/');
      absPath = getResultFilePath(runId, stripped, req.user.id);
    }
  }

  // Fallback 2: legacy TATA v2 runs store files at runs/:runId/:portfolio/
  if (!absPath) {
    const segments = filePath.split('/');
    if (segments.length > 1) {
      absPath = getLegacyResultFilePath(runId, segments[0], segments.slice(1).join('/'), req.user.id);
    }
  }

  if (!absPath) {
    return res.status(404).json({ error: `File not found: ${filePath}` });
  }

  // Set content type
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.json': 'application/json',
    '.png': 'image/png',
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
  };
  res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');

  if (req.query.download === '1' || ['.xlsx', '.pdf'].includes(ext)) {
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
  }

  res.sendFile(absPath);
});

module.exports = router;
