/**
 * @module workspaceStore
 * @description Zustand store for workspace management (localStorage-persisted).
 *
 * Workspaces are the top-level organizational unit — each contains claims
 * and portfolios.  Provides create, rename, delete, and activation.
 *
 * State: { workspaces, activeWorkspaceId }
 * Actions: createWorkspace, deleteWorkspace, setActiveWorkspace
 * Persistence: localStorage key `cap_workspaces`
 */
import { create } from 'zustand';
import { generateUUID } from '../utils/uuid';

const STORAGE_KEY = 'cap_workspaces';

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { workspaces: [], activeWorkspaceId: null };
}

function persist(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
  }));
}

const initial = loadPersisted();

export const useWorkspaceStore = create((set, get) => ({
  workspaces: initial.workspaces,
  activeWorkspaceId: initial.activeWorkspaceId,

  createWorkspace: (name, description = '') => {
    const ws = {
      id: generateUUID(),
      name,
      description,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    set((state) => {
      const next = { ...state, workspaces: [...state.workspaces, ws] };
      persist(next);
      return next;
    });
    return ws;
  },

  deleteWorkspace: (id) => {
    set((state) => {
      const next = {
        ...state,
        workspaces: state.workspaces.filter((w) => w.id !== id),
        activeWorkspaceId: state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
      };
      persist(next);
      return next;
    });
  },

  setActive: (id) => {
    set((state) => {
      const next = { ...state, activeWorkspaceId: id };
      persist(next);
      return next;
    });
  },

  getActive: () => {
    const { workspaces, activeWorkspaceId } = get();
    return workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  },
}));
