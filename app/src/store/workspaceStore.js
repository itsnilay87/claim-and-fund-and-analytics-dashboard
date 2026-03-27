/**
 * @module workspaceStore
 * @description Zustand store for workspace management (server API-backed).
 *
 * Workspaces are the top-level organizational unit — each contains claims
 * and portfolios.  Provides create, rename, delete, and activation.
 *
 * State: { workspaces, activeWorkspaceId, isLoading }
 * Actions: fetchWorkspaces, createWorkspace, updateWorkspace, deleteWorkspace, setActive, getActive
 * Persistence: activeWorkspaceId only in localStorage (UI preference)
 */
import { create } from 'zustand';
import { api } from '../services/api';

const ACTIVE_WS_KEY = 'cap_active_workspace_id';

function loadActiveId() {
  try { return localStorage.getItem(ACTIVE_WS_KEY); } catch { return null; }
}

function persistActiveId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_WS_KEY, id);
    else localStorage.removeItem(ACTIVE_WS_KEY);
  } catch { /* ignore */ }
}

export const useWorkspaceStore = create((set, get) => ({
  workspaces: [],
  activeWorkspaceId: loadActiveId(),
  isLoading: false,

  fetchWorkspaces: async () => {
    set({ isLoading: true });
    try {
      const { workspaces } = await api.get('/api/workspaces');
      set({ workspaces: workspaces || [], isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  createWorkspace: async (name, description = '') => {
    const { workspace } = await api.post('/api/workspaces', { name, description });
    set((state) => ({ workspaces: [...state.workspaces, workspace] }));
    return workspace;
  },

  updateWorkspace: async (id, updates) => {
    const { workspace } = await api.put(`/api/workspaces/${encodeURIComponent(id)}`, updates);
    set((state) => ({
      workspaces: state.workspaces.map((w) => w.id === id ? workspace : w),
    }));
    return workspace;
  },

  deleteWorkspace: async (id) => {
    await api.delete(`/api/workspaces/${encodeURIComponent(id)}`);
    set((state) => ({
      workspaces: state.workspaces.filter((w) => w.id !== id),
      activeWorkspaceId: state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
    }));
  },

  setActive: (id) => {
    persistActiveId(id);
    set({ activeWorkspaceId: id });
  },

  getActive: () => {
    const { workspaces, activeWorkspaceId } = get();
    return workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  },

  /** Clear all workspace state (on logout) */
  reset: () => {
    persistActiveId(null);
    set({ workspaces: [], activeWorkspaceId: null, isLoading: false });
  },
}));
