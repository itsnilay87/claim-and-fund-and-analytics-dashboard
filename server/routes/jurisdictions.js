/**
 * Jurisdictions Routes
 *
 * GET /api/jurisdictions          — List available jurisdiction templates
 * GET /api/jurisdictions/:id      — Full template for a jurisdiction
 * GET /api/jurisdictions/:id/defaults — Default ClaimConfig for a jurisdiction
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { loadDefaults } = require('../services/configService');

const JURISDICTIONS_DIR = path.resolve(__dirname, '..', '..', 'engine', 'jurisdictions');

/**
 * GET /api/jurisdictions
 * Returns list of available jurisdiction templates.
 */
router.get('/', (_req, res) => {
  try {
    const jurisdictions = _listJurisdictions();
    res.json({ jurisdictions });
  } catch (err) {
    console.error('[GET /api/jurisdictions]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jurisdictions/:id
 * Returns the full template for a specific jurisdiction.
 */
router.get('/:id', (req, res) => {
  try {
    const template = _loadTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: `Jurisdiction '${req.params.id}' not found` });
    }
    res.json(template);
  } catch (err) {
    console.error('[GET /api/jurisdictions/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jurisdictions/:id/defaults
 * Returns default ClaimConfig for a jurisdiction.
 */
router.get('/:id/defaults', (req, res) => {
  try {
    const defaults = loadDefaults(req.params.id);
    if (!defaults) {
      return res.status(404).json({ error: `Jurisdiction '${req.params.id}' not found` });
    }
    res.json(defaults);
  } catch (err) {
    console.error('[GET /api/jurisdictions/:id/defaults]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Internal helpers ──

function _listJurisdictions() {
  if (!fs.existsSync(JURISDICTIONS_DIR)) return [];

  return fs.readdirSync(JURISDICTIONS_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .map(f => {
      const filePath = path.join(JURISDICTIONS_DIR, f);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return {
          id: data.id || path.basename(f, '.json'),
          name: data.name || data.id,
          description: data.description || '',
          country: data.country || '',
          institution: data.institution || '',
          supports_restart: data.supports_restart || false,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function _loadTemplate(jurisdictionId) {
  const filePath = path.join(JURISDICTIONS_DIR, `${jurisdictionId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

module.exports = router;
