/**
 * Templates Routes
 *
 * GET /api/templates         — List available claim templates
 * GET /api/templates/:id     — Get full template config
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', 'engine', 'templates');

/**
 * Load all template metadata from engine/templates/*.json
 */
function loadTemplateList() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];

  const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));
  const templates = [];

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8'));
      templates.push({
        id: raw.id,
        name: raw.name,
        description: raw.description,
        jurisdiction: raw.jurisdiction,
        claim_type: raw.claim_type,
        soc_value_cr: raw.soc_value_cr,
        currency: raw.currency,
      });
    } catch (err) {
      console.error(`[templates] Failed to parse ${file}:`, err.message);
    }
  }

  return templates;
}

/**
 * GET /api/templates — returns list of available templates
 */
router.get('/', (_req, res) => {
  try {
    const templates = loadTemplateList();
    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/templates/:id — returns full template config
 */
router.get('/:id', (req, res) => {
  try {
    const templateId = req.params.id;
    // Prevent directory traversal
    if (templateId.includes('..') || templateId.includes('/') || templateId.includes('\\')) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }

    const filePath = path.join(TEMPLATES_DIR, `${templateId}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Template '${templateId}' not found` });
    }

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json(raw);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
