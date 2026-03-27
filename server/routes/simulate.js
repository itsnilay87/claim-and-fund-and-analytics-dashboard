/**
 * Simulation Routes
 *
 * POST /api/simulate           — Legacy TATA v2 format (claim-analytics backward-compat)
 * POST /api/simulate/claim     — Run single-claim simulation
 * POST /api/simulate/portfolio  — Run portfolio simulation
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { startRun, startLegacyRun } = require('../services/simulationRunner');
const { mergeConfig, getDefaults, loadDefaults, validateConfig } = require('../services/configService');
const { authenticateToken } = require('../middleware/auth');
const SimulationRun = require('../db/models/SimulationRun');
const fs = require('fs');
const path = require('path');

const JURISDICTIONS_DIR = path.resolve(__dirname, '..', '..', 'engine', 'jurisdictions');

// Rate limiter for simulation endpoints — 10 per minute per IP
const simulateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many simulation requests. Please try again later.' },
});

/**
 * Load jurisdiction template and merge defaults into claim_config.
 * Fills in challenge_tree, timeline, legal_costs, etc. when missing/empty.
 */
function enrichClaimConfig(claim) {
  const jurisdiction = claim.jurisdiction || 'indian_domestic';

  // Load full jurisdiction template
  const templatePath = path.join(JURISDICTIONS_DIR, `${jurisdiction}.json`);
  let template = null;
  if (fs.existsSync(templatePath)) {
    template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
  }

  // Load server defaults
  const jurisdictionDefaults = loadDefaults(jurisdiction);

  // Merge challenge_tree from template if missing/empty
  if (template && template.default_challenge_tree) {
    if (!claim.challenge_tree ||
        !claim.challenge_tree.scenario_a?.root ||
        !claim.challenge_tree.scenario_b?.root) {
      claim.challenge_tree = template.default_challenge_tree;
    }
  }

  // Map UI timeline.stages → engine timeline.pre_arb_stages
  if (claim.timeline && Array.isArray(claim.timeline.stages) && !claim.timeline.pre_arb_stages) {
    claim.timeline.pre_arb_stages = claim.timeline.stages;
  }

  // Merge other defaults from jurisdiction
  if (jurisdictionDefaults) {
    if (!claim.timeline || !claim.timeline.pre_arb_stages?.length) {
      claim.timeline = jurisdictionDefaults.timeline;
    }
    if (!claim.legal_costs) {
      claim.legal_costs = jurisdictionDefaults.legal_costs;
    }
    if (!claim.arbitration) {
      claim.arbitration = jurisdictionDefaults.arbitration;
    }
    if (!claim.quantum || !claim.quantum.bands?.length) {
      claim.quantum = jurisdictionDefaults.quantum;
    }
    if (!claim.interest) {
      claim.interest = jurisdictionDefaults.interest;
    }
  }

  // Map UI field names to engine field names
  if (claim.statementOfClaim != null && claim.soc_value_cr == null) {
    claim.soc_value_cr = claim.statementOfClaim;
  }
  if (claim.archetype && !claim.claim_type) {
    claim.claim_type = claim.archetype;
  }

  // Ensure required scalar fields have defaults
  if (!claim.claim_type) claim.claim_type = 'prolongation';
  if (!claim.currency) claim.currency = 'INR';
  if (claim.claimant_share_pct == null) claim.claimant_share_pct = 1.0;
  if (!claim.perspective) claim.perspective = 'claimant';

  // Normalize interest rates: UI and defaults store as % (e.g. 9), engine expects fraction (e.g. 0.09)
  if (claim.interest) {
    if (claim.interest.rate != null && claim.interest.rate > 1) {
      claim.interest.rate = claim.interest.rate / 100;
    }
    if (Array.isArray(claim.interest.rate_bands)) {
      for (const band of claim.interest.rate_bands) {
        if (band.rate != null && band.rate > 1) {
          band.rate = band.rate / 100;
        }
      }
    }
  }

  // Normalize timeline stage names to lowercase for the Python adapter
  if (claim.timeline && Array.isArray(claim.timeline.pre_arb_stages)) {
    for (const stage of claim.timeline.pre_arb_stages) {
      if (stage.name) {
        stage.name = stage.name.toLowerCase();
      }
    }
  }

  return claim;
}

/**
 * Build DB status-update callbacks for a simulation run.
 */
function _buildDbCallbacks(userId) {
  return {
    async onComplete(runId, outputDir, summary) {
      try {
        await SimulationRun.updateStatus(runId, {
          status: 'completed',
          progress: 100,
          completed_at: new Date().toISOString(),
          results_path: outputDir,
          summary,
        });
        // Auto-cleanup: keep last 10 unsaved runs
        await SimulationRun.deleteOldUnsavedRuns(userId, 10);
      } catch (err) {
        console.error(`[simulate] DB onComplete error for ${runId}:`, err.message);
      }
    },
    async onFail(runId, errorText) {
      try {
        await SimulationRun.updateStatus(runId, {
          status: 'failed',
          error_message: errorText,
          completed_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error(`[simulate] DB onFail error for ${runId}:`, err.message);
      }
    },
  };
}

/**
 * POST /api/simulate/claim
 * Body: { claim_config: ClaimConfig, simulation: SimulationConfig, workspace_id?, claim_id? }
 * Runs single-claim mode (no investment grid). Requires auth.
 */
router.post('/claim', authenticateToken, simulateLimiter, async (req, res) => {
  try {
    const { claim_config, simulation } = req.body;

    if (!claim_config) {
      return res.status(400).json({ error: 'claim_config is required' });
    }

    // Enrich claim with jurisdiction defaults (challenge_tree, timeline, etc.)
    const enrichedClaim = enrichClaimConfig({ ...claim_config });

    // Build a minimal config with the single claim
    const defaults = getDefaults();
    const simConfig = simulation
      ? mergeConfig(simulation, defaults.simulation)
      : defaults.simulation;

    // Validate V2-specific fields
    const simErrors = _validateV2SimConfig(simConfig);
    const claimErrors = _validateV2ClaimFields(enrichedClaim);
    const allErrors = [...simErrors, ...claimErrors];
    if (allErrors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: allErrors });
    }

    const config = {
      id: `claim_run_${Date.now()}`,
      name: enrichedClaim.name || 'Single Claim Run',
      claim_ids: [enrichedClaim.id || 'claim_1'],
      structure: {
        type: 'litigation_funding',
        params: {
          cost_multiple_range: { min: 1.0, max: 5.0, step: 0.5 },
          award_ratio_range: { min: 0.10, max: 0.50, step: 0.05 },
          waterfall_type: 'min',
        },
      },
      simulation: simConfig,
      claims: [enrichedClaim],
    };

    // Create DB record first to get the UUID
    let dbRunId = null;
    try {
      const dbRun = await SimulationRun.create(req.user.id, {
        workspaceId: req.body.workspace_id || null,
        portfolioId: null,
        claimId: req.body.claim_id || null,
        mode: 'claim',
        structureType: config.structure?.type,
        config: config,
      });
      dbRunId = dbRun.id;
    } catch (dbErr) {
      console.error('[POST /api/simulate/claim] DB create failed (continuing without DB):', dbErr.message);
    }

    const callbacks = dbRunId ? _buildDbCallbacks(req.user.id) : null;
    const { runId } = startRun(config, 'claim', dbRunId, callbacks, req.user.id);
    res.status(202).json({ runId, status: 'queued' });
  } catch (err) {
    console.error('[POST /api/simulate/claim]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/simulate/portfolio
 * Body: { portfolio_config: PortfolioConfig, claims: ClaimConfig[], workspace_id?, portfolio_id? }
 * Requires auth.
 */
router.post('/portfolio', authenticateToken, simulateLimiter, async (req, res) => {
  try {
    const { portfolio_config, claims } = req.body;

    if (!portfolio_config) {
      return res.status(400).json({ error: 'portfolio_config is required' });
    }
    if (!claims || !Array.isArray(claims) || claims.length === 0) {
      return res.status(400).json({ error: 'claims array is required and must not be empty' });
    }

    // Enrich each claim with jurisdiction defaults (challenge_tree, timeline, etc.)
    const enrichedClaims = claims.map(c => enrichClaimConfig({ ...c }));

    // Build full config for engine
    const defaults = getDefaults();
    const simConfig = portfolio_config.simulation
      ? mergeConfig(portfolio_config.simulation, defaults.simulation)
      : defaults.simulation;

    // Ensure structure_type is passed through to the engine config
    const structureType = portfolio_config.structure?.type || 'monetisation_upfront_tail';

    const config = {
      ...portfolio_config,
      simulation: simConfig,
      structure: { type: structureType, ...(portfolio_config.structure || {}) },
      claims: enrichedClaims,
    };

    const { valid, errors } = validateConfig(config);
    if (!valid) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    // Validate V2-specific fields
    const v2Errors = _validateV2SimConfig(simConfig);
    for (const claim of enrichedClaims) {
      v2Errors.push(..._validateV2ClaimFields(claim));
    }
    if (v2Errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: v2Errors });
    }

    // Create DB record first to get the UUID
    let dbRunId = null;
    try {
      const dbRun = await SimulationRun.create(req.user.id, {
        workspaceId: req.body.workspace_id || null,
        portfolioId: req.body.portfolio_id || null,
        claimId: null,
        mode: 'portfolio',
        structureType: config.structure?.type,
        config: config,
      });
      dbRunId = dbRun.id;
    } catch (dbErr) {
      console.error('[POST /api/simulate/portfolio] DB create failed (continuing without DB):', dbErr.message);
    }

    const callbacks = dbRunId ? _buildDbCallbacks(req.user.id) : null;
    const { runId } = startRun(config, 'portfolio', dbRunId, callbacks, req.user.id);
    res.status(202).json({ runId, status: 'queued' });
  } catch (err) {
    console.error('[POST /api/simulate/portfolio]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── V2 Config Validation Helpers ──

/**
 * Validate V2-specific simulation config fields.
 */
function _validateV2SimConfig(simConfig) {
  const errors = [];

  if (simConfig.sims_per_combo != null) {
    if (simConfig.sims_per_combo < 100 || simConfig.sims_per_combo > 50000) {
      errors.push('simulation.sims_per_combo must be between 100 and 50000');
    }
  }

  if (simConfig.pricing_surface) {
    const ps = simConfig.pricing_surface;
    if (ps.upfront_min != null && ps.upfront_max != null && ps.upfront_min >= ps.upfront_max) {
      errors.push('pricing_surface.upfront_min must be < upfront_max');
    }
    if (ps.tail_min != null && ps.tail_max != null && ps.tail_min >= ps.tail_max) {
      errors.push('pricing_surface.tail_min must be < tail_max');
    }
    if (ps.step != null && (ps.step <= 0 || ps.step > 20)) {
      errors.push('pricing_surface.step must be between 0 and 20');
    }
  }

  return errors;
}

/**
 * Validate V2-specific claim fields (interest rate_bands, payment_delays, etc.).
 */
function _validateV2ClaimFields(claim) {
  const errors = [];

  // Validate interest rate_bands
  if (claim.interest?.rate_bands && Array.isArray(claim.interest.rate_bands)) {
    const bands = claim.interest.rate_bands;
    const probSum = bands.reduce((s, b) => s + (b.probability || 0), 0);
    if (Math.abs(probSum - 1.0) > 0.01) {
      errors.push(`interest.rate_bands probabilities sum to ${probSum.toFixed(4)}, expected 1.0`);
    }
    for (const band of bands) {
      if (band.rate != null && (band.rate < 0 || band.rate > 100)) {
        errors.push(`interest.rate_bands: rate ${band.rate} out of range [0, 100]`);
      }
      if (band.type && !['simple', 'compound'].includes(band.type)) {
        errors.push(`interest.rate_bands: type must be 'simple' or 'compound'`);
      }
    }
  }

  // Validate interest start_basis
  if (claim.interest?.start_basis && !['award_date', 'dab_commencement'].includes(claim.interest.start_basis)) {
    errors.push("interest.start_basis must be 'award_date' or 'dab_commencement'");
  }

  // Validate payment_delays
  if (claim.payment_delays) {
    for (const key of ['domestic', 'siac', 're_arb']) {
      if (claim.payment_delays[key] != null && (claim.payment_delays[key] < 0 || claim.payment_delays[key] > 60)) {
        errors.push(`payment_delays.${key} must be between 0 and 60`);
      }
    }
  }

  return errors;
}

/**
 * POST /api/simulate  (legacy — backward-compatible with claim-analytics old app)
 *
 * Accepts the old TATA v2 flat format:
 *   Body: { config: { simulation, arbitration, quantum_bands, ... }, portfolios: ['all'] }
 * Returns: { runId, status: 'queued', portfolios }
 *
 * This endpoint runs python -m TATA_code_v2.v2_run using the simulation-server runner.
 * Requires authentication. A DB record is created for audit/ownership tracking.
 */
router.post('/', authenticateToken, simulateLimiter, async (req, res) => {
  try {
    const { config: overrides = {}, portfolios = ['all'] } = req.body;

    const validPortfolios = ['all', 'siac', 'domestic', 'hkiac', 'compare'];
    for (const p of portfolios) {
      if (!validPortfolios.includes(p)) {
        return res.status(400).json({ error: `Invalid portfolio: '${p}'. Must be one of: ${validPortfolios.join(', ')}` });
      }
    }

    // Create DB record for legacy runs
    let dbRunId = null;
    try {
      const dbRun = await SimulationRun.create(req.user.id, {
        workspaceId: null,
        portfolioId: null,
        claimId: null,
        mode: 'legacy',
        structureType: 'legacy_tata_v2',
        config: overrides,
      });
      dbRunId = dbRun.id;
    } catch (dbErr) {
      console.error('[POST /api/simulate (legacy)] DB create failed:', dbErr.message);
    }

    const { runId } = startLegacyRun(overrides, portfolios, req.user.id);
    res.status(202).json({ runId, status: 'queued', portfolios, message: 'Simulation queued' });
  } catch (err) {
    console.error('[POST /api/simulate (legacy)]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
