/**
 * @module claimStore
 * @description Zustand store for claim CRUD operations (server API-backed).
 *
 * Manages the lifecycle of individual claims within a workspace — create,
 * read, update, delete.  All operations go through the centralized API client.
 *
 * State: { claims, activeClaim, isLoading }
 * Actions: loadClaims, createClaim, updateClaim, deleteClaim, setActiveClaim
 */
import { create } from 'zustand';
import { api } from '../services/api';

export const useClaimStore = create((set, get) => ({
  claims: [],
  activeClaim: null,
  isLoading: false,

  /** Load claims for a workspace from server */
  loadClaims: async (wsId) => {
    set({ isLoading: true });
    try {
      const { claims } = await api.get(`/api/claims?workspace_id=${encodeURIComponent(wsId)}`);
      set({ claims: claims || [], isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  /** Get claims from current in-memory state (synchronous, for selectors) */
  getClaimsByWorkspace: (_wsId) => get().claims,
  getClaims: (_wsId) => get().claims,

  /** Create a new claim with jurisdiction defaults */
  createClaim: async (wsId, jurisdiction, defaults = {}) => {
    const claimData = {
      workspace_id: wsId,
      name: '',
      claimant: '',
      respondent: '',
      jurisdiction,
      claim_type: 'prolongation',
      soc_value_cr: defaults.soc_value_cr ?? 1000,
      currency: defaults.currency ?? (jurisdiction === 'siac_singapore' ? 'SGD' : jurisdiction === 'hkiac_hongkong' ? 'HKD' : 'INR'),
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
    };

    const { claim } = await api.post('/api/claims', claimData);
    set((state) => ({
      claims: [...state.claims, claim],
      activeClaim: claim,
    }));
    return claim;
  },

  /** Update an existing claim */
  updateClaim: async (id, updates) => {
    const { claim } = await api.put(`/api/claims/${encodeURIComponent(id)}`, updates);
    set((state) => ({
      claims: state.claims.map((c) => c.id === id ? claim : c),
      activeClaim: state.activeClaim?.id === id ? claim : state.activeClaim,
    }));
    return claim;
  },

  /** Delete a claim */
  deleteClaim: async (id) => {
    await api.delete(`/api/claims/${encodeURIComponent(id)}`);
    set((state) => ({
      claims: state.claims.filter((c) => c.id !== id),
      activeClaim: state.activeClaim?.id === id ? null : state.activeClaim,
    }));
  },

  /** Compat: removeClaim(wsId, claimId) */
  removeClaim: (_wsId, claimId) => get().deleteClaim(claimId),

  /** Set active claim for editing */
  setActiveClaim: (id) => {
    set((state) => ({
      activeClaim: id ? state.claims.find((c) => c.id === id) || null : null,
    }));
  },

  /** Clear all claim state (on logout) */
  reset: () => set({ claims: [], activeClaim: null, isLoading: false }),
}));
