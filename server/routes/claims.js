/**
 * Claims Routes (localStorage backup / future DB migration)
 *
 * GET  /api/claims  — List claims (returns empty for now)
 * POST /api/claims  — Create claim (stores to file for now)
 *
 * Actual CRUD is in localStorage on the client — this route structure
 * is set up for future migration to a real data layer.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CLAIMS_DIR = path.resolve(__dirname, '..', 'data', 'claims');

/**
 * GET /api/claims
 * Returns list of server-side stored claims (empty initially).
 */
router.get('/', (_req, res) => {
  try {
    if (!fs.existsSync(CLAIMS_DIR)) {
      return res.json({ claims: [], total: 0 });
    }

    const files = fs.readdirSync(CLAIMS_DIR).filter(f => f.endsWith('.json'));
    const claims = files.map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(CLAIMS_DIR, f), 'utf-8'));
      } catch { return null; }
    }).filter(Boolean);

    res.json({ claims, total: claims.length });
  } catch (err) {
    console.error('[GET /api/claims]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/claims
 * Stores a claim config to disk (for backup / future migration).
 * Body: ClaimConfig object
 */
router.post('/', (req, res) => {
  try {
    const claim = req.body;

    if (!claim || !claim.id) {
      return res.status(400).json({ error: 'Claim must have an id' });
    }

    // Sanitize filename — only allow alphanumerics, dashes, underscores
    const safeId = claim.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    fs.mkdirSync(CLAIMS_DIR, { recursive: true });

    const filePath = path.join(CLAIMS_DIR, `${safeId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(claim, null, 2), 'utf-8');

    res.status(201).json({ id: claim.id, stored: true });
  } catch (err) {
    console.error('[POST /api/claims]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
