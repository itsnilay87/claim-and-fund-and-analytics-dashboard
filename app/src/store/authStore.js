/**
 * @module authStore
 * @description Zustand store for authentication state (localStorage-persisted).
 *
 * Provides mock JWT auth for the prototype — login generates a client-side
 * token, logout clears localStorage.  Exports `useAuthStore` hook.
 *
 * State: { user, token, isAuthenticated }
 * Actions: login(email, password), logout()
 * Persistence: localStorage key `cap_auth`
 */
import { create } from 'zustand';
import { generateUUID } from '../utils/uuid';

const STORAGE_KEY = 'cap_auth';

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.token && data.user) return data;
    }
  } catch { /* ignore */ }
  return null;
}

function generateMockJwt(user) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub: user.id, email: user.email, iat: Date.now() }));
  const sig = btoa(String(Date.now()));
  return `${header}.${payload}.${sig}`;
}

const persisted = loadPersisted();

export const useAuthStore = create((set) => ({
  user: persisted?.user ?? null,
  token: persisted?.token ?? null,
  isAuthenticated: !!(persisted?.token),

  login: (email, password) => {
    const user = {
      id: generateUUID(),
      name: email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      email,
    };
    const token = generateMockJwt(user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, token }));
    set({ user, token, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ user: null, token: null, isAuthenticated: false });
  },

  updateUser: (updates) => {
    set((state) => {
      const user = { ...state.user, ...updates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, token: state.token }));
      return { user };
    });
  },
}));
