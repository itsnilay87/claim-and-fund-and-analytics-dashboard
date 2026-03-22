/**
 * @module claimStore
 * @description Zustand store for claim CRUD operations (localStorage-persisted per workspace).
 *
 * Manages the lifecycle of individual claims within a workspace — create,
 * read, update, delete.  Claims are stored as JSON arrays keyed by workspace ID.
 *
 * State: { claims, activeClaim }
 * Actions: loadClaims, createClaim, updateClaim, deleteClaim, setActiveClaim
 * Persistence: localStorage key `cap_ws_{wsId}_claims`
 */
import { create } from 'zustand';
import { generateUUID } from '../utils/uuid';

const STORAGE_PREFIX = 'cap_ws_';

function loadWsClaims(wsId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + wsId + '_claims');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function persistWsClaims(wsId, claims) {
  localStorage.setItem(STORAGE_PREFIX + wsId + '_claims', JSON.stringify(claims));
}

export const useClaimStore = create((set, get) => ({
  claims: [],
  activeClaim: null,

  /** Load claims for a workspace */
  loadClaims: (wsId) => {
    const claims = loadWsClaims(wsId);
    set({ claims });
  },

  /** Get claims filtered by workspace */
  getClaimsByWorkspace: (wsId) => loadWsClaims(wsId),
  getClaims: (wsId) => loadWsClaims(wsId),

  /** Create a new claim with jurisdiction defaults */
  createClaim: (wsId, jurisdiction, defaults = {}) => {
    const id = generateUUID();
    const claim = {
      id,
      workspace_id: wsId,
      name: '',
      claimant: '',
      respondent: '',
      jurisdiction,
      claim_type: 'prolongation',
      soc_value_cr: defaults.soc_value_cr ?? 1000,
      currency: defaults.currency ?? (jurisdiction === 'siac_singapore' ? 'SGD' : 'INR'),
      claimant_share_pct: defaults.claimant_share_pct ?? 1.0,
      current_stage: 'dab',
      perspective: 'claimant',
      description: '',
      status: 'draft',
      arbitration: defaults.arbitration ?? { win_probability: 0.70, re_arb_win_probability: 0.70 },
      quantum: defaults.quantum ?? { bands: [{ low: 0.80, high: 1.0, probability: 1.0 }] },
      challenge_tree: defaults.challenge_tree ?? { scenario_a: {}, scenario_b: {} },
      timeline: defaults.timeline ?? { pre_arb_stages: [], payment_delay_months: 6, max_horizon_months: 96 },
      legal_costs: defaults.legal_costs ?? {
        one_time_tribunal_cr: 6,
        one_time_expert_cr: 2,
        per_stage_costs: {},
        overrun_alpha: 2,
        overrun_beta: 5,
        overrun_low: -0.10,
        overrun_high: 0.60,
      },
      interest: defaults.interest ?? { enabled: false, rate: 0.09, compounding: 'simple' },
      no_restart_mode: false,
      simulation_seed: 42,
      n_simulations: 10000,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    set((state) => {
      const next = [...state.claims, claim];
      persistWsClaims(wsId, next);
      return { claims: next, activeClaim: claim };
    });
    return claim;
  },

  /** Update an existing claim */
  updateClaim: (id, updates) => {
    set((state) => {
      const claims = state.claims.map((c) => {
        if (c.id !== id) return c;
        const wasSimulated = c.status === 'simulated';
        const merged = { ...c, ...updates, updated_at: new Date().toISOString() };
        // If config changed on a simulated claim → stale
        if (wasSimulated && updates.status === undefined) {
          merged.status = 'stale';
        }
        return merged;
      });
      const wsId = claims.find((c) => c.id === id)?.workspace_id;
      if (wsId) persistWsClaims(wsId, claims);
      const activeClaim = state.activeClaim?.id === id
        ? claims.find((c) => c.id === id)
        : state.activeClaim;
      return { claims, activeClaim };
    });
  },

  /** Delete a claim */
  deleteClaim: (id) => {
    set((state) => {
      const claim = state.claims.find((c) => c.id === id);
      const claims = state.claims.filter((c) => c.id !== id);
      if (claim?.workspace_id) persistWsClaims(claim.workspace_id, claims);
      return {
        claims,
        activeClaim: state.activeClaim?.id === id ? null : state.activeClaim,
      };
    });
  },

  /** Compat: removeClaim(wsId, claimId) */
  removeClaim: (_wsId, claimId) => get().deleteClaim(claimId),

  /** Set active claim for editing */
  setActiveClaim: (id) => {
    set((state) => ({
      activeClaim: id ? state.claims.find((c) => c.id === id) || null : null,
    }));
  },
}));
