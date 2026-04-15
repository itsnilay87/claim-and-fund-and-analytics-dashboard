/**
 * dashboardData.js — Load dashboard_data.json + stochastic_pricing.json via fetch.
 *
 * Supports portfolio modes: all (default), siac, domestic.
 * Portfolio-specific data lives in subdirectories (e.g. /data/siac/dashboard_data.json).
 *
 * In dev mode, Vite proxies /data/ to the outputs directory.
 * For production build, copy both JSON files into dist/data/.
 *
 * Usage:
 *   import { useDashboardData } from './data/dashboardData';
 *   const { data, stochasticData, loading, error, portfolioMode, setPortfolioMode, availablePortfolios } = useDashboardData();
 */

import { useState, useEffect, useCallback } from 'react';

// Cache per portfolio mode
const cache = {};

// --- Auth helper: obtain access token via refresh cookie (same-origin) ---
let _accessToken = null;
let _tokenPromise = null;

/**
 * Refresh the access token by calling the refresh endpoint.
 * The HttpOnly refresh-token cookie is sent automatically (same origin).
 */
async function _refreshAccessToken(apiBase = '') {
  try {
    const res = await fetch(`${apiBase}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = await res.json();
    _accessToken = data.accessToken || null;
    return _accessToken;
  } catch {
    return null;
  }
}

/**
 * Get a valid access token, refreshing if needed.
 * Result is cached until a 401 triggers clearAccessToken().
 */
async function getAccessToken(apiBase = '') {
  if (_accessToken) return _accessToken;
  if (_tokenPromise) return _tokenPromise;
  _tokenPromise = _refreshAccessToken(apiBase);
  const token = await _tokenPromise;
  _tokenPromise = null;
  return token;
}

/** Clear cached token so next authFetch triggers a refresh. */
export function clearAccessToken() {
  _accessToken = null;
  _tokenPromise = null;
}

/** Authenticated fetch: attaches Bearer token + credentials.
 *  Automatically retries once on 401 by refreshing the token. */
export async function authFetch(url, apiBase = '') {
  const token = await getAccessToken(apiBase);
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: 'include' });
  if (res.status === 401 && token) {
    // Token may have expired — refresh and retry once
    clearAccessToken();
    const newToken = await getAccessToken(apiBase);
    if (newToken) {
      return fetch(url, {
        headers: { 'Authorization': `Bearer ${newToken}` },
        credentials: 'include',
      });
    }
  }
  return res;
}

/** Portfolio mode definitions */
export const PORTFOLIO_MODES = [
  { id: 'all',      label: 'Full Portfolio (6 Claims)', color: '#2E75B6' },
  { id: 'siac',     label: 'SIAC Portfolio (3 Claims)',  color: '#7030A0' },
  { id: 'domestic', label: 'Domestic Portfolio (3 Claims)', color: '#548235' },
];

/**
 * Check URL search params for simulation run context.
 * When present, data is fetched from the simulation API.
 *   ?runId=<uuid>&portfolio=<mode>
 */
function getSimulationContext() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const runId = params.get('runId');
  const portfolio = params.get('portfolio');
  if (runId) {
    return {
      runId,
      portfolio: portfolio || 'all',
      apiBase: params.get('apiBase') || import.meta.env.VITE_API_BASE || '',
    };
  }
  return null;
}

function getDataPaths(mode) {
  const prefix = mode === 'all' ? '' : `${mode}/`;
  return {
    dashPaths: [
      `/data/${prefix}dashboard_data.json`,
      `./${prefix}dashboard_data.json`,
      `../outputs/${prefix}dashboard_data.json`,
    ],
    stochPaths: [
      `/data/${prefix}stochastic_pricing.json`,
      `./${prefix}stochastic_pricing.json`,
      `../outputs/${prefix}stochastic_pricing.json`,
    ],
    surfacePaths: [
      `/data/${prefix}pricing_surface.json`,
      `./${prefix}pricing_surface.json`,
      `../outputs/${prefix}pricing_surface.json`,
    ],
  };
}

/**
 * Normalize stochastic pricing grid keys.
 * Python may output keys like "5.0_10.0" but JS template literals produce "5_10".
 * This normalizes all keys to strip trailing ".0" from integer values.
 */
function normalizeGridKeys(obj) {
  if (!obj) return obj;
  // Normalize embedded stochastic_pricing in dashboard data
  if (obj.stochastic_pricing?.grid) {
    obj.stochastic_pricing.grid = _rekey(obj.stochastic_pricing.grid);
  }
  // Normalize V2 investment grids
  if (obj.investment_grid) {
    obj.investment_grid = _rekey(obj.investment_grid);
  }
  if (obj.investment_grid_soc) {
    obj.investment_grid_soc = _rekey(obj.investment_grid_soc);
  }
  // Normalize per-claim grid keys
  if (obj.per_claim_grid) {
    obj.per_claim_grid = _rekey(obj.per_claim_grid);
  }
  // Normalize pricing surface grid
  if (obj.pricing_surface?.grid) {
    obj.pricing_surface.grid = _rekey(obj.pricing_surface.grid);
  }
  // Normalize waterfall grid (litigation funding)
  if (obj.waterfall_grid) {
    obj.waterfall_grid = _rekey(obj.waterfall_grid);
  }
  // Normalize purchase sensitivity
  if (obj.purchase_sensitivity && typeof obj.purchase_sensitivity === 'object' && !Array.isArray(obj.purchase_sensitivity)) {
    obj.purchase_sensitivity = _rekey(obj.purchase_sensitivity);
  }
  return obj;
}

function normalizeStochasticData(stoch) {
  if (!stoch?.grid) return stoch;
  stoch.grid = _rekey(stoch.grid);
  return stoch;
}

function _rekey(grid) {
  if (!grid || typeof grid !== 'object' || Array.isArray(grid)) return grid;
  const out = {};
  for (const [key, value] of Object.entries(grid)) {
    const norm = key.split('_').map(p => {
      const n = parseFloat(p);
      return n % 1 === 0 ? String(Math.round(n)) : String(n);
    }).join('_');
    out[norm] = value;
  }
  return out;
}

/**
 * Normalize V2 engine output to platform dashboard format.
 * V2 outputs investment_grid_soc as a flat list; dashboard expects a dict keyed by "up_tail".
 * V2 also lacks a top-level risk section and structure_type.
 */
function normalizeV2Data(obj) {
  if (!obj) return obj;

  // Convert investment_grid_soc list → investment_grid dict
  if (!obj.investment_grid && Array.isArray(obj.investment_grid_soc)) {
    const grid = {};
    for (const row of obj.investment_grid_soc) {
      const up = Math.round((row.upfront_pct || 0) * 100);
      const tail = Math.round((row.tata_tail_pct || 0) * 100);
      grid[`${up}_${tail}`] = row;
    }
    obj.investment_grid = grid;
  }

  // Also convert investment_grid_eq if present
  if (!obj.investment_grid_eq_dict && Array.isArray(obj.investment_grid_eq)) {
    const grid = {};
    for (const row of obj.investment_grid_eq) {
      const up = Math.round((row.upfront_pct || 0) * 100);
      const tail = Math.round((row.tata_tail_pct || 0) * 100);
      grid[`${up}_${tail}`] = row;
    }
    obj.investment_grid_eq_dict = grid;
  }

  // Build risk section from grid data if missing
  if (!obj.risk && obj.investment_grid && typeof obj.investment_grid === 'object') {
    const cells = Object.values(obj.investment_grid);
    if (cells.length > 0) {
      const moics = cells.map(c => c.mean_moic).filter(v => v != null).sort((a, b) => a - b);
      const xirrs = cells.map(c => c.mean_xirr).filter(v => v != null).sort((a, b) => a - b);
      const pLosses = cells.map(c => c.p_loss).filter(v => v != null);
      const pctile = (arr, p) => arr.length > 0 ? arr[Math.min(Math.floor(p * arr.length), arr.length - 1)] : 0;
      obj.risk = {
        moic_distribution: {
          p5: pctile(moics, 0.05),
          p25: pctile(moics, 0.25),
          p50: pctile(moics, 0.50),
          p75: pctile(moics, 0.75),
          p95: pctile(moics, 0.95),
          mean: moics.length > 0 ? moics.reduce((a, b) => a + b, 0) / moics.length : 0,
        },
        irr_distribution: {
          p5: pctile(xirrs, 0.05),
          p25: pctile(xirrs, 0.25),
          p50: pctile(xirrs, 0.50),
          p75: pctile(xirrs, 0.75),
          p95: pctile(xirrs, 0.95),
          mean: xirrs.length > 0 ? xirrs.reduce((a, b) => a + b, 0) / xirrs.length : 0,
        },
        concentration: {
          mean_p_loss: pLosses.length > 0 ? pLosses.reduce((a, b) => a + b, 0) / pLosses.length : 0,
        },
      };
    }
  }

  // Add structure_type if missing
  if (!obj.structure_type) {
    obj.structure_type = obj.simulation_meta?.structure_type
      || obj.simulation_meta?.portfolio_mode
      || 'monetisation_upfront_tail';
  }

  return obj;
}

export function useDashboardData() {
  // Check if we're in simulation results context (embedded from simulation dashboard)
  const simContext = getSimulationContext();

  const [portfolioMode, setPortfolioMode] = useState(simContext?.portfolio || 'all');
  const [data, setData] = useState(cache['all']?.data || null);
  const [stochasticData, setStochasticData] = useState(cache['all']?.stochastic || null);
  const [pricingSurfaceData, setPricingSurfaceData] = useState(cache['all']?.surface || null);
  const [loading, setLoading] = useState(!cache['all']?.data);
  const [error, setError] = useState(null);
  const [availablePortfolios, setAvailablePortfolios] = useState(['all']);

  const loadPortfolio = useCallback(async (mode) => {
    // Check cache first (but not for simulation context — always fetch fresh)
    if (!simContext && cache[mode]?.data) {
      setData(cache[mode].data);
      setStochasticData(cache[mode].stochastic);
      setPricingSurfaceData(cache[mode].surface || null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // If we have simulation context, fetch from API instead of local paths
    if (simContext) {
      const { runId, apiBase } = simContext;
      try {
        // Fetch dashboard data from simulation API (authenticated via refresh cookie)
        const dashUrl = `${apiBase}/api/results/${runId}/dashboard_data.json`;
        const dashRes = await authFetch(dashUrl, apiBase);
        if (!dashRes.ok) {
          throw new Error(`Failed to load results: ${dashRes.status}`);
        }
        const mainData = await dashRes.json();

        // Fetch stochastic data from API
        let stochData = mainData.stochastic_pricing || null;
        if (!stochData) {
          try {
            const stochUrl = `${apiBase}/api/results/${runId}/stochastic_pricing.json`;
            const stochRes = await authFetch(stochUrl, apiBase);
            if (stochRes.ok) {
              stochData = await stochRes.json();
            }
          } catch {
            // Stochastic data is optional
          }
        }

        // Fetch pricing surface data from API (optional)
        let surfaceData = null;
        try {
          const surfaceUrl = `${apiBase}/api/results/${runId}/pricing_surface.json`;
          const surfaceRes = await authFetch(surfaceUrl, apiBase);
          if (surfaceRes.ok) {
            surfaceData = await surfaceRes.json();
          }
        } catch {
          // Pricing surface data is optional
        }

        normalizeV2Data(mainData);
        normalizeGridKeys(mainData);
        normalizeStochasticData(stochData);
        if (surfaceData?.grid) surfaceData.grid = _rekey(surfaceData.grid);
        setData(mainData);
        setStochasticData(stochData);
        setPricingSurfaceData(surfaceData);
        setLoading(false);
        return;
      } catch (err) {
        setError(`Failed to load simulation results: ${err.message}`);
        setLoading(false);
        return;
      }
    }

    // Standard local file loading (non-simulation mode)
    const { dashPaths, stochPaths, surfacePaths } = getDataPaths(mode);

    // Load main dashboard data
    let mainData = null;
    for (const p of dashPaths) {
      try {
        const res = await fetch(p);
        if (res.ok) {
          mainData = await res.json();
          break;
        }
      } catch {
        // try next path
      }
    }

    if (!mainData) {
      if (mode === 'all') {
        setError('Could not load dashboard_data.json. Run: python -m TATA_code_v2.v2_run --n 10000 --seed 42');
      } else {
        setError(`No data for ${mode} portfolio. Run: python -m TATA_code_v2.v2_run --n 10000 --seed 42 --portfolio ${mode}`);
      }
      setLoading(false);
      return;
    }

    // Load stochastic pricing data
    let stochData = mainData.stochastic_pricing || null;
    if (!stochData) {
      for (const p of stochPaths) {
        try {
          const res = await fetch(p);
          if (res.ok) {
            stochData = await res.json();
            break;
          }
        } catch {
          // try next path
        }
      }
    }

    // Load pricing surface data (optional)
    let surfaceData = null;
    for (const p of surfacePaths) {
      try {
        const res = await fetch(p);
        if (res.ok) {
          surfaceData = await res.json();
          break;
        }
      } catch {
        // Pricing surface is optional
      }
    }

    // Normalize V2 data format and grid keys, then cache
    normalizeV2Data(mainData);
    normalizeGridKeys(mainData);
    normalizeStochasticData(stochData);
    if (surfaceData?.grid) surfaceData.grid = _rekey(surfaceData.grid);
    cache[mode] = { data: mainData, stochastic: stochData, surface: surfaceData };
    setData(mainData);
    setStochasticData(stochData);
    setPricingSurfaceData(surfaceData);
    setLoading(false);
  }, []);

  // Probe which portfolio modes have data (skip in simulation context)
  useEffect(() => {
    // In simulation context, we only have the single portfolio mode from URL
    if (simContext) {
      setAvailablePortfolios([simContext.portfolio]);
      return;
    }
    async function probeAvailable() {
      const available = [];
      for (const { id } of PORTFOLIO_MODES) {
        const { dashPaths } = getDataPaths(id);
        for (const p of dashPaths) {
          try {
            const res = await fetch(p, { method: 'HEAD' });
            if (res.ok) {
              available.push(id);
              break;
            }
          } catch {
            // try next
          }
        }
      }
      if (available.length > 0) {
        setAvailablePortfolios(available);
      }
    }
    probeAvailable();
  }, [simContext]);

  // Load data when portfolio mode changes
  useEffect(() => {
    loadPortfolio(portfolioMode);
  }, [portfolioMode, loadPortfolio]);

  const nClaims = data?.simulation_meta?.n_claims;
  const claimMode = nClaims === 1;

  return {
    data,
    stochasticData,
    pricingSurfaceData,
    loading,
    error,
    structureType: data?.structure_type || data?.simulation_meta?.structure_type || 'monetisation_upfront_tail',
    claimMode,
    mcDistributions: data?.mc_distributions || null,
    portfolioMode,
    setPortfolioMode,
    availablePortfolios,
    retry: () => loadPortfolio(portfolioMode),
  };
}
