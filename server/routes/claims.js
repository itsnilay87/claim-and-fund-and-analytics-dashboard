/**
 * Claims CRUD Routes — PostgreSQL-backed
 *
 * All routes require authenticateToken middleware (applied at router-mount level in server.js).
 * Every query is scoped by user_id for data isolation.
 */

const express = require('express');
const router = express.Router();
const { Claim, Workspace } = require('../db/models');

// UUID v4 format validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fields that trigger stale marking when changed on a simulated claim
const CALC_FIELDS = new Set([
  'soc_value_cr', 'jurisdiction', 'claim_type', 'current_stage',
  'claimant_share_pct', 'quantum', 'arbitration', 'interest',
  'timeline', 'legal_costs', 'probability_tree', 'dab',
]);

// Valid claim status values
const VALID_STATUSES = new Set(['draft', 'ready', 'simulated', 'stale']);

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

/**
 * Validate required fields for 'ready' status.
 * Returns array of { field, message } or empty array.
 */
function validateForReady(claim) {
  const errors = [];
  if (!claim.workspace_id) errors.push({ field: 'workspace_id', message: 'workspace_id is required' });
  if (!claim.jurisdiction) errors.push({ field: 'jurisdiction', message: 'jurisdiction is required' });
  if (claim.soc_value_cr == null || isNaN(Number(claim.soc_value_cr))) {
    errors.push({ field: 'soc_value_cr', message: 'soc_value_cr must be a number' });
  }
  return errors;
}

// ────────────────────────────────────────────────────────────────
// GET /api/claims?workspace_id=UUID
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

    const claims = await Claim.findAllByWorkspace(workspace_id, req.user.id);
    res.json({ claims, total: claims.length });
  } catch (err) {
    console.error('[GET /api/claims]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// GET /api/claims/:id
// ────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid claim ID format' });
    }

    const claim = await Claim.findById(req.params.id, req.user.id);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    res.json({ claim });
  } catch (err) {
    console.error('[GET /api/claims/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// POST /api/claims
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

    // Validate status value
    if (!VALID_STATUSES.has(body.status)) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'status', message: `status must be one of: ${[...VALID_STATUSES].join(', ')}` }] });
    }

    // If status is 'ready', validate required simulation fields
    if (body.status === 'ready') {
      const errors = validateForReady(body);
      if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
      }
    }

    // Validate numeric fields if present
    if (body.soc_value_cr != null && isNaN(Number(body.soc_value_cr))) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'soc_value_cr', message: 'soc_value_cr must be a number' }] });
    }

    // Strip workspace_id and id from claimData (handled separately)
    const { workspace_id: _ws, id: _id, user_id: _uid, ...claimData } = body;

    const claim = await Claim.create(req.user.id, workspace_id, claimData);
    res.status(201).json({ claim });
  } catch (err) {
    console.error('[POST /api/claims]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// PUT /api/claims/:id
// ────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid claim ID format' });
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

    // Validate numeric fields if present
    if (body.soc_value_cr != null && isNaN(Number(body.soc_value_cr))) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'soc_value_cr', message: 'soc_value_cr must be a number' }] });
    }

    // If transitioning to 'ready', validate required fields
    if (body.status === 'ready') {
      const existing = await Claim.findById(req.params.id, req.user.id);
      if (!existing) return res.status(404).json({ error: 'Claim not found' });
      const merged = { ...existing, ...body };
      const errors = validateForReady(merged);
      if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
      }
    }

    // Auto-stale: if calc-relevant fields changed and status was 'simulated'
    if (body.status === undefined) {
      const hasCalcChange = Object.keys(body).some((k) => CALC_FIELDS.has(k));
      if (hasCalcChange) {
        const existing = await Claim.findById(req.params.id, req.user.id);
        if (!existing) return res.status(404).json({ error: 'Claim not found' });
        if (existing.status === 'simulated') {
          body.status = 'stale';
        }
      }
    }

    const claim = await Claim.update(req.params.id, req.user.id, body);
    res.json({ claim });
  } catch (err) {
    if (err.message === 'Claim not found') {
      return res.status(404).json({ error: 'Claim not found' });
    }
    console.error('[PUT /api/claims/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// DELETE /api/claims/:id
// ────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid claim ID format' });
    }

    const deleted = await Claim.delete(req.params.id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('[DELETE /api/claims/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// PUT /api/claims/:id/status
// ────────────────────────────────────────────────────────────────
router.put('/:id/status', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid claim ID format' });
    }

    const { status } = req.body;
    if (!status || !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'status', message: `status must be one of: ${[...VALID_STATUSES].join(', ')}` }] });
    }

    // If transitioning to 'ready', validate required fields
    if (status === 'ready') {
      const existing = await Claim.findById(req.params.id, req.user.id);
      if (!existing) return res.status(404).json({ error: 'Claim not found' });
      const errors = validateForReady(existing);
      if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
      }
    }

    const claim = await Claim.updateStatus(req.params.id, req.user.id, status);
    res.json({ claim });
  } catch (err) {
    if (err.message === 'Claim not found') {
      return res.status(404).json({ error: 'Claim not found' });
    }
    console.error('[PUT /api/claims/:id/status]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
