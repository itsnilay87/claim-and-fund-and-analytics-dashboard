/**
 * @module api
 * @description Centralized API client for the Claim Analytics Platform.
 *
 * - Base URL from env: VITE_API_URL (default: empty string for same-origin)
 * - Access token stored in memory (module-level variable, NOT localStorage)
 * - Automatic Authorization header attachment
 * - 401 interceptor that attempts token refresh, then retries the request once
 * - credentials: 'include' for all requests (to send HttpOnly cookies)
 * - JSON content type by default
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

let accessToken = null;
let refreshPromise = null;

export function setAccessToken(token) { accessToken = token; }
export function getAccessToken() { return accessToken; }
export function clearAccessToken() { accessToken = null; }

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function refreshToken() {
  // Deduplicate concurrent refresh attempts
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) {
        clearAccessToken();
        return false;
      }
      const data = await res.json();
      if (data.accessToken) {
        setAccessToken(data.accessToken);
        return true;
      }
      return false;
    } catch {
      clearAccessToken();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { ...options.headers };

  // Only set Content-Type for requests with a body
  if (options.body) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  let res = await fetch(url, { ...options, headers, credentials: 'include' });

  // If 401 and we have a token, try refresh
  if (res.status === 401 && accessToken) {
    const refreshed = await refreshToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(url, { ...options, headers, credentials: 'include' });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || `Request failed (${res.status})`, body.details);
  }

  // Handle 204 No Content
  if (res.status === 204) return {};

  return res.json();
}

export const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => apiFetch(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),
};
