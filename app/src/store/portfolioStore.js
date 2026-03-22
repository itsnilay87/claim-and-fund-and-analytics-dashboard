/**
 * @module portfolioStore
 * @description Zustand store for portfolio CRUD operations (localStorage-persisted per workspace).
 *
 * Manages portfolio lifecycle — create, update, delete — including claim
 * selection, structure configuration, and simulation settings.
 *
 * State: { portfolios, activePortfolio }
 * Actions: loadPortfolios, createPortfolio, updatePortfolio, deletePortfolio
 * Persistence: localStorage key `cap_ws_{wsId}_portfolios`
 */
import { create } from 'zustand';
import { generateUUID } from '../utils/uuid';

const STORAGE_PREFIX = 'cap_ws_';

function loadWsPortfolios(wsId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + wsId + '_portfolios');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function persistWsPortfolios(wsId, portfolios) {
  localStorage.setItem(STORAGE_PREFIX + wsId + '_portfolios', JSON.stringify(portfolios));
}

export const usePortfolioStore = create((set, get) => ({
  portfolios: [],
  activePortfolio: null,

  /** Load portfolios for a workspace */
  loadPortfolios: (wsId) => {
    const portfolios = loadWsPortfolios(wsId);
    set({ portfolios });
  },

  /** Get portfolios for workspace (direct read) */
  getPortfoliosByWorkspace: (wsId) => loadWsPortfolios(wsId),

  /** Create a new portfolio */
  createPortfolio: (wsId, name) => {
    const portfolio = {
      id: generateUUID(),
      workspace_id: wsId,
      name: name || 'Untitled Portfolio',
      claim_ids: [],
      structure: null,
      structure_config: {},
      simulation: {
        n_paths: 10000,
        seed: 42,
        discount_rate: 0.12,
        risk_free_rate: 0.07,
        start_date: '2026-04-30',
      },
      status: 'draft',
      run_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    set((state) => {
      const next = [...state.portfolios, portfolio];
      persistWsPortfolios(wsId, next);
      return { portfolios: next, activePortfolio: portfolio };
    });
    return portfolio;
  },

  /** Update a portfolio */
  updatePortfolio: (id, updates) => {
    set((state) => {
      const portfolios = state.portfolios.map((p) => {
        if (p.id !== id) return p;
        return { ...p, ...updates, updated_at: new Date().toISOString() };
      });
      const wsId = portfolios.find((p) => p.id === id)?.workspace_id;
      if (wsId) persistWsPortfolios(wsId, portfolios);
      const activePortfolio = state.activePortfolio?.id === id
        ? portfolios.find((p) => p.id === id)
        : state.activePortfolio;
      return { portfolios, activePortfolio };
    });
  },

  /** Delete a portfolio */
  deletePortfolio: (id) => {
    set((state) => {
      const portfolio = state.portfolios.find((p) => p.id === id);
      const portfolios = state.portfolios.filter((p) => p.id !== id);
      if (portfolio?.workspace_id) persistWsPortfolios(portfolio.workspace_id, portfolios);
      return {
        portfolios,
        activePortfolio: state.activePortfolio?.id === id ? null : state.activePortfolio,
      };
    });
  },

  /** Add a claim to a portfolio */
  addClaim: (portfolioId, claimId) => {
    set((state) => {
      const portfolios = state.portfolios.map((p) => {
        if (p.id !== portfolioId) return p;
        if (p.claim_ids.includes(claimId)) return p;
        return { ...p, claim_ids: [...p.claim_ids, claimId], updated_at: new Date().toISOString() };
      });
      const wsId = portfolios.find((p) => p.id === portfolioId)?.workspace_id;
      if (wsId) persistWsPortfolios(wsId, portfolios);
      const activePortfolio = state.activePortfolio?.id === portfolioId
        ? portfolios.find((p) => p.id === portfolioId)
        : state.activePortfolio;
      return { portfolios, activePortfolio };
    });
  },

  /** Remove a claim from a portfolio */
  removeClaim: (portfolioId, claimId) => {
    set((state) => {
      const portfolios = state.portfolios.map((p) => {
        if (p.id !== portfolioId) return p;
        return { ...p, claim_ids: p.claim_ids.filter((c) => c !== claimId), updated_at: new Date().toISOString() };
      });
      const wsId = portfolios.find((p) => p.id === portfolioId)?.workspace_id;
      if (wsId) persistWsPortfolios(wsId, portfolios);
      const activePortfolio = state.activePortfolio?.id === portfolioId
        ? portfolios.find((p) => p.id === portfolioId)
        : state.activePortfolio;
      return { portfolios, activePortfolio };
    });
  },

  /** Set structure type for a portfolio */
  setStructure: (portfolioId, structure) => {
    set((state) => {
      const portfolios = state.portfolios.map((p) => {
        if (p.id !== portfolioId) return p;
        return { ...p, structure, updated_at: new Date().toISOString() };
      });
      const wsId = portfolios.find((p) => p.id === portfolioId)?.workspace_id;
      if (wsId) persistWsPortfolios(wsId, portfolios);
      const activePortfolio = state.activePortfolio?.id === portfolioId
        ? portfolios.find((p) => p.id === portfolioId)
        : state.activePortfolio;
      return { portfolios, activePortfolio };
    });
  },

  /** Set active portfolio for editing */
  setActivePortfolio: (id) => {
    set((state) => ({
      activePortfolio: id ? state.portfolios.find((p) => p.id === id) || null : null,
    }));
  },
}));
