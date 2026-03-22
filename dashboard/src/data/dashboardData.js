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
        // Fetch dashboard data from simulation API
        const dashUrl = `${apiBase}/api/results/${runId}/${mode}/dashboard_data.json`;
        const dashRes = await fetch(dashUrl);
        if (!dashRes.ok) {
          throw new Error(`Failed to load results: ${dashRes.status}`);
        }
        const mainData = await dashRes.json();

        // Fetch stochastic data from API
        let stochData = mainData.stochastic_pricing || null;
        if (!stochData) {
          try {
            const stochUrl = `${apiBase}/api/results/${runId}/${mode}/stochastic_pricing.json`;
            const stochRes = await fetch(stochUrl);
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
          const surfaceUrl = `${apiBase}/api/results/${runId}/${mode}/pricing_surface.json`;
          const surfaceRes = await fetch(surfaceUrl);
          if (surfaceRes.ok) {
            surfaceData = await surfaceRes.json();
          }
        } catch {
          // Pricing surface data is optional
        }

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

    // Normalize grid keys and cache
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

  return {
    data,
    stochasticData,
    pricingSurfaceData,
    loading,
    error,
    structureType: data?.structure_type || data?.simulation_meta?.structure_type || 'monetisation_upfront_tail',
    mcDistributions: data?.mc_distributions || null,
    portfolioMode,
    setPortfolioMode,
    availablePortfolios,
    retry: () => loadPortfolio(portfolioMode),
  };
}
