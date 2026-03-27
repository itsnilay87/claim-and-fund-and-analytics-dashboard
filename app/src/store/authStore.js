/**
 * @module authStore
 * @description Zustand store for authentication state (server-backed).
 *
 * Provides real JWT auth via the server API. Access token is stored in
 * memory (via api.js module variable), refresh token is an HttpOnly cookie.
 *
 * State: { user, isAuthenticated, isLoading, error }
 * Actions: login, register, logout, initAuth, updateUser
 */
import { create } from 'zustand';
import { api, setAccessToken, clearAccessToken } from '../services/api';
import { useWorkspaceStore } from './workspaceStore';
import { useClaimStore } from './claimStore';
import { usePortfolioStore } from './portfolioStore';

export const useAuthStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, // true until initAuth completes
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { user, accessToken } = await api.post('/api/auth/login', { email, password });
      setAccessToken(accessToken);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  register: async (email, password, full_name) => {
    set({ isLoading: true, error: null });
    try {
      const { user, accessToken } = await api.post('/api/auth/register', { email, password, full_name });
      setAccessToken(accessToken);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
    clearAccessToken();
    // Clear all store state to prevent stale data leaks
    useWorkspaceStore.getState().reset();
    useClaimStore.getState().reset();
    usePortfolioStore.getState().reset();
    set({ user: null, isAuthenticated: false, error: null });
  },

  /**
   * On app startup: try to restore session via refresh token cookie.
   * If the cookie is valid, the server returns a new access token.
   */
  initAuth: async () => {
    set({ isLoading: true });
    try {
      const { accessToken } = await api.post('/api/auth/refresh');
      setAccessToken(accessToken);
      const { user } = await api.get('/api/auth/me');
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ isLoading: false }); // Not logged in, that's ok
    }
  },

  updateUser: async (updates) => {
    try {
      const { user } = await api.put('/api/auth/me', updates);
      set({ user });
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
