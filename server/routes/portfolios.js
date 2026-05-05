/**
 * Portfolios CRUD Routes — PostgreSQL-backed
 *
 * All routes require authenticateToken middleware (applied at router-mount level in server.js).
 * Every query is scoped by user_id for data isolation.
 */

const express = require('express');
const router = express.Router();
const { Portfolio, Workspace, Claim } = require('../db/models');
const SimulationRun = require('../db/models/SimulationRun');

// UUID v4 format validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valid portfolio status values
const VALID_STATUSES = new Set(['draft', 'ready', 'running', 'completed', 'failed']);

/**
 * Trim string values in an object (shallow, top-level only).
 */
function trimStrings(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = typeof value === 'string' ? value.trim() : value;
  }
  return result;
}

// ────────────────────────────────────────────────────────────────
// GET /api/portfolios?workspace_id=UUID
// ────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    if (!workspace_id) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'workspace_id', message: 'workspace_id query param is required' }] });
    }
    if (!UUID_RE.test(workspace_id)) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'workspace_id', message: 'workspace_id must be a valid UUID' }] });
    }

    const portfolios = await Portfolio.findAllByWorkspace(workspace_id, req.user.id);
    res.json({ portfolios, total: portfolios.length });
  } catch (err) {
    console.error('[GET /api/portfolios]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// GET /api/portfolios/:id
// ────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid portfolio ID format' });
    }

    const portfolio = await Portfolio.findById(req.params.id, req.user.id);
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    res.json({ portfolio });
  } catch (err) {
    console.error('[GET /api/portfolios/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// POST /api/portfolios
// ────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const body = trimStrings(req.body);
    const { workspace_id } = body;

    // Validate workspace_id
    if (!workspace_id) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'workspace_id', message: 'workspace_id is required' }] });
    }
    if (!UUID_RE.test(workspace_id)) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'workspace_id', message: 'workspace_id must be a valid UUID' }] });
    }

    // Verify workspace belongs to user
    const workspace = await Workspace.findById(workspace_id, req.user.id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Default status to draft
    if (!body.status) body.status = 'draft';

    // Validate status
    if (!VALID_STATUSES.has(body.status)) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'status', message: `status must be one of: ${[...VALID_STATUSES].join(', ')}` }] });
    }

    // Validate claim_ids is an array (if provided)
    if (body.claim_ids !== undefined && !Array.isArray(body.claim_ids)) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'claim_ids', message: 'claim_ids must be an array' }] });
    }

    // Validate each claim_id is a UUID
    if (body.claim_ids && body.claim_ids.length > 0) {
      for (const cid of body.claim_ids) {
        if (!UUID_RE.test(cid)) {
          return res.status(400).json({ error: 'Validation failed', details: [{ field: 'claim_ids', message: `Invalid claim ID: ${cid}` }] });
        }
      }
    }

    // Build portfolio data object
    const portfolioData = {
      name: body.name || 'Untitled Portfolio',
      claim_ids: body.claim_ids || [],
      structure_type: body.structure_type || body.structure || null,
      structure_config: body.structure_config || {},
      simulation_config: body.simulation_config || body.simulation || {},
      status: body.status,
    };

    const portfolio = await Portfolio.create(req.user.id, workspace_id, portfolioData);
    res.status(201).json({ portfolio });
  } catch (err) {
    console.error('[POST /api/portfolios]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// PUT /api/portfolios/:id
// ────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid portfolio ID format' });
    }

    const body = trimStrings(req.body);

    // Don't allow changing immutable fields
    delete body.id;
    delete body.workspace_id;
    delete body.user_id;
    delete body.created_at;

    // Validate status if provided
    if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'status', message: `status must be one of: ${[...VALID_STATUSES].join(', ')}` }] });
    }

    // Validate claim_ids if provided
    if (body.claim_ids !== undefined) {
      if (!Array.isArray(body.claim_ids)) {
        return res.status(400).json({ error: 'Validation failed', details: [{ field: 'claim_ids', message: 'claim_ids must be an array' }] });
      }
      for (const cid of body.claim_ids) {
        if (!UUID_RE.test(cid)) {
          return res.status(400).json({ error: 'Validation failed', details: [{ field: 'claim_ids', message: `Invalid claim ID: ${cid}` }] });
        }
      }
    }

    // Map frontend field names to DB column names
    const updates = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.claim_ids !== undefined) updates.claim_ids = body.claim_ids;
    if (body.structure_type !== undefined) updates.structure_type = body.structure_type;
    if (body.structure !== undefined && body.structure_type === undefined) updates.structure_type = body.structure;
    if (body.structure_config !== undefined) updates.structure_config = body.structure_config;
    if (body.simulation_config !== undefined) updates.simulation_config = body.simulation_config;
    if (body.simulation !== undefined && body.simulation_config === undefined) updates.simulation_config = body.simulation;
    if (body.status !== undefined) updates.status = body.status;
    if (body.run_id !== undefined) updates.run_id = body.run_id;

    const portfolio = await Portfolio.update(req.params.id, req.user.id, updates);
    res.json({ portfolio });
  } catch (err) {
    if (err.message === 'Portfolio not found') {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    console.error('[PUT /api/portfolios/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// DELETE /api/portfolios/:id
// ────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid portfolio ID format' });
    }

    const deleted = await Portfolio.delete(req.params.id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('[DELETE /api/portfolios/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// PUT /api/portfolios/:id/claims
// Replace the entire claim list for a portfolio
// ────────────────────────────────────────────────────────────────
router.put('/:id/claims', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid portfolio ID format' });
    }

    const { claim_ids } = req.body;

    if (!Array.isArray(claim_ids)) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'claim_ids', message: 'claim_ids must be an array' }] });
    }

    // Validate each claim_id is a UUID
    for (const cid of claim_ids) {
      if (!UUID_RE.test(cid)) {
        return res.status(400).json({ error: 'Validation failed', details: [{ field: 'claim_ids', message: `Invalid claim ID: ${cid}` }] });
      }
    }

    // Verify all claims belong to the user
    for (const cid of claim_ids) {
      const claim = await Claim.findById(cid, req.user.id);
      if (!claim) {
        return res.status(400).json({ error: 'Validation failed', details: [{ field: 'claim_ids', message: `Claim not found or not owned: ${cid}` }] });
      }
    }

    const portfolio = await Portfolio.update(req.params.id, req.user.id, { claim_ids });
    res.json({ portfolio });
  } catch (err) {
    if (err.message === 'Portfolio not found') {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    console.error('[PUT /api/portfolios/:id/claims]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// PUT /api/portfolios/:id/structure
// Update structure type and config for a portfolio
// ────────────────────────────────────────────────────────────────
router.put('/:id/structure', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid portfolio ID format' });
    }

    const { structure_type, structure_config } = req.body;

    if (structure_type !== undefined && typeof structure_type !== 'string') {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'structure_type', message: 'structure_type must be a string' }] });
    }

    if (structure_config !== undefined && (typeof structure_config !== 'object' || Array.isArray(structure_config))) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'structure_config', message: 'structure_config must be an object' }] });
    }

    const updates = {};
    if (structure_type !== undefined) updates.structure_type = structure_type;
    if (structure_config !== undefined) updates.structure_config = structure_config;

    const portfolio = await Portfolio.update(req.params.id, req.user.id, updates);
    res.json({ portfolio });
  } catch (err) {
    if (err.message === 'Portfolio not found') {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    console.error('[PUT /api/portfolios/:id/structure]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// GET /api/portfolios/:portfolioId/runs
// List all simulation runs for a portfolio (user-scoped).
// ────────────────────────────────────────────────────────────────
router.get('/:portfolioId/runs', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.portfolioId)) {
      return res.status(400).json({ error: 'Invalid portfolio ID format' });
    }

    const runs = await SimulationRun.findByPortfolio(req.params.portfolioId, req.user.id);
    res.json({ runs });
  } catch (err) {
    console.error('[GET /api/portfolios/:portfolioId/runs]', err.message);
    res.status(500).json({ error: 'Failed to fetch portfolio runs' });
  }
});

module.exports = router;
