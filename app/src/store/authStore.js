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

  /**
   * Step 1 of registration: request an OTP to be sent to the email.
   * If the server cannot send email (SMTP unavailable), it falls back to
   * creating the account immediately and returns user + accessToken. In
   * that case we sign the user in and return { skipped: true } so the UI
   * can bypass the OTP step.
   */
  requestOtp: async (email, password, full_name) => {
    set({ error: null });
    try {
      const resp = await api.post('/api/auth/register/request-otp', { email, password, full_name });
      if (resp && resp.verification_skipped && resp.accessToken) {
        setAccessToken(resp.accessToken);
        set({ user: resp.user, isAuthenticated: true, isLoading: false });
        return { skipped: true };
      }
      return { skipped: false };
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  /**
   * Step 2 of registration: verify OTP → creates account → issues tokens.
   */
  verifyOtp: async (email, otp) => {
    set({ error: null });
    try {
      const { user, accessToken } = await api.post('/api/auth/register/verify-otp', { email, otp });
      setAccessToken(accessToken);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  /**
   * Resend OTP for a pending registration.
   */
  resendOtp: async (email) => {
    set({ error: null });
    try {
      await api.post('/api/auth/register/resend-otp', { email });
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  requestPasswordResetOtp: async (email) => {
    set({ error: null });
    try {
      await api.post('/api/auth/forgot-password/request-otp', { email });
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  resetPasswordWithOtp: async (email, otp, newPassword) => {
    set({ error: null });
    try {
      await api.post('/api/auth/forgot-password/verify-otp', {
        email,
        otp,
        new_password: newPassword,
      });
    } catch (err) {
      set({ error: err.message });
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

  changePassword: async (currentPassword, newPassword) => {
    try {
      await api.put('/api/auth/me/password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
