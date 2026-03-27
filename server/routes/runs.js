/**
 * Run History Routes
 *
 * All routes require authenticateToken middleware (applied at the router level in server.js).
 *
 * GET    /api/runs          — List user's simulation runs (paginated)
 * GET    /api/runs/compare  — Compare two runs side by side
 * GET    /api/runs/:id      — Get a single run with output file list
 * DELETE /api/runs/:id      — Delete a run (DB + filesystem)
 * POST   /api/runs/:id/save — Mark a run as saved
 * POST   /api/runs/:id/discard — Discard a run (delete DB + filesystem)
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const SimulationRun = require('../db/models/SimulationRun');
const { listRunFiles } = require('../services/simulationRunner');

// UUID v4 format validation regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUUID(str) {
  return UUID_RE.test(str);
}

/**
 * GET /api/runs
 * Returns paginated list of the authenticated user's simulation runs.
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const status = req.query.status || undefined;
    const structureType = req.query.structure_type || undefined;

    const { runs, total } = await SimulationRun.findAllByUser(req.user.id, {
      limit,
      offset,
      status,
      structureType,
    });

    res.json({ runs, total, limit, offset });
  } catch (err) {
    console.error('[GET /api/runs]', err.message);
    res.status(500).json({ error: 'Failed to fetch runs' });
  }
});

/**
 * GET /api/runs/compare
 * Compare two runs side by side. Query: ?ids=uuid1,uuid2
 */
router.get('/compare', async (req, res) => {
  try {
    const idsParam = req.query.ids;
    if (!idsParam) {
      return res.status(400).json({ error: 'ids query parameter is required (comma-separated UUIDs)' });
    }

    const ids = idsParam.split(',').map(s => s.trim());
    if (ids.length !== 2) {
      return res.status(400).json({ error: 'Exactly two run IDs are required' });
    }

    if (!ids.every(isValidUUID)) {
      return res.status(400).json({ error: 'Invalid UUID format' });
    }

    const { run1, run2 } = await SimulationRun.compare(ids[0], ids[1], req.user.id);
    res.json({ runs: [run1, run2] });
  } catch (err) {
    console.error('[GET /api/runs/compare]', err.message);
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to compare runs' });
  }
});

/**
 * GET /api/runs/:id
 * Returns a single run with full metadata and list of available output files.
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid run ID format' });
    }

    const run = await SimulationRun.findById(id, req.user.id);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    // List output files from filesystem
    const files = listRunFiles(id);

    res.json({ run, files });
  } catch (err) {
    console.error('[GET /api/runs/:id]', err.message);
    res.status(500).json({ error: 'Failed to fetch run' });
  }
});

/**
 * DELETE /api/runs/:id
 * Hard delete: removes DB record and filesystem outputs.
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid run ID format' });
    }

    const deleted = await SimulationRun.delete(id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Run not found' });
    }

    // Also remove the run directory (DB delete already handles results_path cleanup)
    const RUNS_DIR = path.resolve(__dirname, '..', 'runs');
    const runDir = path.join(RUNS_DIR, id);
    try {
      if (fs.existsSync(runDir)) {
        fs.rmSync(runDir, { recursive: true, force: true });
      }
    } catch { /* best-effort */ }

    res.json({ deleted: true });
  } catch (err) {
    console.error('[DELETE /api/runs/:id]', err.message);
    res.status(500).json({ error: 'Failed to delete run' });
  }
});

/**
 * POST /api/runs/:id/save
 * Marks a run as saved (exempt from auto-cleanup). Optionally set a custom name.
 * Body: { name?: string }
 */
router.post('/:id/save', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid run ID format' });
    }

    const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 255) : null;
    const run = await SimulationRun.markSaved(id, req.user.id, name);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    res.json({ run });
  } catch (err) {
    console.error('[POST /api/runs/:id/save]', err.message);
    res.status(500).json({ error: 'Failed to save run' });
  }
});

/**
 * POST /api/runs/:id/discard
 * Explicitly discard a run — deletes DB record and filesystem outputs.
 */
router.post('/:id/discard', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid run ID format' });
    }

    const deleted = await SimulationRun.delete(id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Run not found' });
    }

    // Also remove the full run directory
    const RUNS_DIR = path.resolve(__dirname, '..', 'runs');
    const runDir = path.join(RUNS_DIR, id);
    try {
      if (fs.existsSync(runDir)) {
        fs.rmSync(runDir, { recursive: true, force: true });
      }
    } catch { /* best-effort */ }

    res.json({ deleted: true });
  } catch (err) {
    console.error('[POST /api/runs/:id/discard]', err.message);
    res.status(500).json({ error: 'Failed to discard run' });
  }
});

module.exports = router;
