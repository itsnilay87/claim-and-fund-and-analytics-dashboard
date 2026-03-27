/**
 * Workspaces CRUD Routes — PostgreSQL-backed
 *
 * All routes require authenticateToken middleware (applied at router-mount level in server.js).
 * Every query is scoped by user_id for data isolation.
 */

const express = require('express');
const router = express.Router();
const { Workspace } = require('../db/models');

// UUID v4 format validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ────────────────────────────────────────────────────────────────
// GET /api/workspaces
// ────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const workspaces = await Workspace.findAllByUser(req.user.id);
    res.json({ workspaces });
  } catch (err) {
    console.error('[GET /api/workspaces]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// POST /api/workspaces
// ────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'name', message: 'name is required and must be a non-empty string' }] });
    }

    const workspace = await Workspace.create(req.user.id, {
      name: name.trim(),
      description: typeof description === 'string' ? description.trim() : '',
    });

    res.status(201).json({ workspace });
  } catch (err) {
    console.error('[POST /api/workspaces]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// PUT /api/workspaces/:id
// ────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    const { name, description } = req.body;

    // At least one field must be provided
    if (name === undefined && description === undefined) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'name', message: 'At least one of name or description must be provided' }] });
    }

    // Validate name if provided
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'name', message: 'name must be a non-empty string' }] });
    }

    const workspace = await Workspace.update(req.params.id, req.user.id, {
      name: name !== undefined ? name.trim() : undefined,
      description: description !== undefined ? (typeof description === 'string' ? description.trim() : description) : undefined,
    });

    res.json({ workspace });
  } catch (err) {
    if (err.message === 'Workspace not found') {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    console.error('[PUT /api/workspaces/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────
// DELETE /api/workspaces/:id
// Cascades to claims and portfolios via ON DELETE CASCADE in DB
// ────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    const deleted = await Workspace.delete(req.params.id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('[DELETE /api/workspaces/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
