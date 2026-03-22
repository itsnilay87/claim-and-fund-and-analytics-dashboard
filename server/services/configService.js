/**
 * Config Service
 *
 * Loads default configuration, merges with user overrides,
 * and performs basic validation (full Pydantic validation is in Python).
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS_PATH = path.resolve(__dirname, '..', 'config', 'defaults.json');
const JURISDICTIONS_DIR = path.resolve(__dirname, '..', '..', 'engine', 'jurisdictions');

let _defaults = null;

/**
 * Load defaults from disk (cached after first call).
 */
function getDefaults() {
  if (!_defaults) {
    _defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf-8'));
  }
  return JSON.parse(JSON.stringify(_defaults));
}

/**
 * Load a jurisdiction template and build a default ClaimConfig from it.
 * @param {string} jurisdiction - e.g. "indian_domestic", "siac_singapore"
 * @returns {object} Default claim config for that jurisdiction
 */
function loadDefaults(jurisdiction) {
  const template = _loadJurisdictionTemplate(jurisdiction);
  if (!template) return null;

  const base = getDefaults();
  return {
    jurisdiction: template.id,
    claim_type: base.claim_defaults.claim_type,
    soc_value_cr: base.claim_defaults.soc_value_cr,
    currency: base.claim_defaults.currency,
    claimant_share_pct: base.claim_defaults.claimant_share_pct,
    perspective: base.claim_defaults.perspective,
    arbitration: base.arbitration,
    quantum: base.quantum,
    timeline: template.default_timeline || base.timeline,
    legal_costs: template.default_legal_costs || base.legal_costs,
    interest: base.interest,
  };
}

/**
 * Deep merge overrides into defaults.
 * @param {object} overrides - User-provided overrides
 * @param {object} defaults - Base defaults
 * @returns {object} Merged config
 */
function mergeConfig(overrides, defaults) {
  return _deepMerge(JSON.parse(JSON.stringify(defaults)), overrides);
}

/**
 * Basic config validation (server-side checks before dispatching to Python).
 * Returns { valid: boolean, errors: string[] }
 */
function validateConfig(config) {
  const errors = [];

  // Simulation config
  if (config.simulation) {
    if (config.simulation.n_paths != null && config.simulation.n_paths < 100) {
      errors.push('simulation.n_paths must be >= 100');
    }
    if (config.simulation.discount_rate != null &&
        (config.simulation.discount_rate < 0 || config.simulation.discount_rate > 1)) {
      errors.push('simulation.discount_rate must be between 0 and 1');
    }
  }

  // Quantum bands
  if (config.quantum && config.quantum.bands) {
    const sum = config.quantum.bands.reduce((s, b) => s + b.probability, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      errors.push(`Quantum band probabilities sum to ${sum.toFixed(6)}, expected 1.0`);
    }
    for (const band of config.quantum.bands) {
      if (band.low >= band.high) {
        errors.push(`Quantum band: low (${band.low}) must be < high (${band.high})`);
      }
    }
  }

  // Arbitration
  if (config.arbitration) {
    if (config.arbitration.win_probability != null &&
        (config.arbitration.win_probability < 0 || config.arbitration.win_probability > 1)) {
      errors.push('arbitration.win_probability must be between 0 and 1');
    }
  }

  // Legal costs overrun
  if (config.legal_costs && config.legal_costs.overrun_low != null) {
    if (config.legal_costs.overrun_low >= config.legal_costs.overrun_high) {
      errors.push('legal_costs.overrun_low must be < overrun_high');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Internal helpers ──

function _loadJurisdictionTemplate(jurisdictionId) {
  const filePath = path.join(JURISDICTIONS_DIR, `${jurisdictionId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function _deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      _deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

module.exports = { getDefaults, loadDefaults, mergeConfig, validateConfig };
