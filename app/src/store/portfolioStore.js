/**
 * @module portfolioStore
 * @description Zustand store for portfolio CRUD operations (server API-backed).
 *
 * Manages portfolio lifecycle — create, update, delete — including claim
 * selection, structure configuration, and simulation settings.
 *
 * State: { portfolios, activePortfolio, isLoading }
 * Actions: loadPortfolios, createPortfolio, updatePortfolio, deletePortfolio
 */
import { create } from 'zustand';
import { api } from '../services/api';

export const usePortfolioStore = create((set, get) => ({
  portfolios: [],
  activePortfolio: null,
  isLoading: false,

  /** Load portfolios for a workspace from server */
  loadPortfolios: async (wsId) => {
    set({ isLoading: true });
    try {
      const { portfolios } = await api.get(`/api/portfolios?workspace_id=${encodeURIComponent(wsId)}`);
      set({ portfolios: portfolios || [], isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  /** Get portfolios from current in-memory state (synchronous, for selectors) */
  getPortfoliosByWorkspace: (_wsId) => get().portfolios,

  /** Create a new portfolio */
  createPortfolio: async (wsId, name) => {
    const portfolioData = {
      workspace_id: wsId,
      name: name || 'Untitled Portfolio',
      claim_ids: [],
      structure: null,
      structure_config: {},
      simulation_config: {
        n_paths: 10000,
        seed: 42,
        discount_rate: 0.12,
        risk_free_rate: 0.07,
        start_date: '2026-04-30',
      },
      status: 'draft',
    };

    const { portfolio } = await api.post('/api/portfolios', portfolioData);
    set((state) => ({
      portfolios: [...state.portfolios, portfolio],
      activePortfolio: portfolio,
    }));
    return portfolio;
  },

  /** Update a portfolio */
  updatePortfolio: async (id, updates) => {
    const { portfolio } = await api.put(`/api/portfolios/${encodeURIComponent(id)}`, updates);
    set((state) => ({
      portfolios: state.portfolios.map((p) => p.id === id ? portfolio : p),
      activePortfolio: state.activePortfolio?.id === id ? portfolio : state.activePortfolio,
    }));
    return portfolio;
  },

  /** Delete a portfolio */
  deletePortfolio: async (id) => {
    await api.delete(`/api/portfolios/${encodeURIComponent(id)}`);
    set((state) => ({
      portfolios: state.portfolios.filter((p) => p.id !== id),
      activePortfolio: state.activePortfolio?.id === id ? null : state.activePortfolio,
    }));
  },

  /** Add a claim to a portfolio */
  addClaim: async (portfolioId, claimId) => {
    const portfolio = get().portfolios.find((p) => p.id === portfolioId);
    if (!portfolio || portfolio.claim_ids?.includes(claimId)) return;
    const updatedIds = [...(portfolio.claim_ids || []), claimId];
    return get().updatePortfolio(portfolioId, { claim_ids: updatedIds });
  },

  /** Remove a claim from a portfolio */
  removeClaim: async (portfolioId, claimId) => {
    const portfolio = get().portfolios.find((p) => p.id === portfolioId);
    if (!portfolio) return;
    const updatedIds = (portfolio.claim_ids || []).filter((c) => c !== claimId);
    return get().updatePortfolio(portfolioId, { claim_ids: updatedIds });
  },

  /** Set structure type for a portfolio */
  setStructure: async (portfolioId, structure) => {
    return get().updatePortfolio(portfolioId, { structure });
  },

  /** Set active portfolio for editing */
  setActivePortfolio: (id) => {
    set((state) => ({
      activePortfolio: id ? state.portfolios.find((p) => p.id === id) || null : null,
    }));
  },

  /** Clear all portfolio state (on logout) */
  reset: () => set({ portfolios: [], activePortfolio: null, isLoading: false }),
}));
