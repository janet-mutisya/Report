/**
 * api.js — shared fetch wrapper
 *
 * Automatically injects the Bearer token from localStorage on every request.
 * On a 401 response it clears auth state and redirects to /login so the user
 * never gets stuck on a broken page after a token expiry.
 *
 * Usage:
 *   import { apiFetch } from '@/api';
 *
 *   const data = await apiFetch('/clients');
 *   const data = await apiFetch('/reports', { method: 'POST', body: JSON.stringify(payload) });
 */

const BASE = '/api';   // should be exactly this, nothing else
/**
 * Core fetch wrapper.
 * @param {string} path   - API path, e.g. '/clients'  (leading slash required)
 * @param {RequestInit} options - Standard fetch options (method, body, headers…)
 * @returns {Promise<any>} Parsed JSON response body
 * @throws {Error} On non-ok HTTP status (message = server's message field if present)
 */
export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('token');

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      // Attach token when present — covers the 401-after-refresh bug
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // Allow callers to override/extend headers
      ...(options.headers || {}),
    },
  });

  // Token expired or invalid — clear storage and kick back to login
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    // Only redirect if we're not already on the login page (avoids redirect loops)
    if (!window.location.pathname.startsWith('/login')) {
      window.location.replace('/login');
    }
    throw new Error('Session expired. Please log in again.');
  }

  // Try to parse JSON regardless of ok status so we can surface the server message
  let data;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return null;
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }

  return data;
}

/**
 * Convenience wrappers so call-sites don't need to spell out method/body every time.
 */
export const api = {
  get:    (path, opts = {})    => apiFetch(path, { ...opts, method: 'GET' }),
  post:   (path, body, opts = {}) => apiFetch(path, { ...opts, method: 'POST',   body: JSON.stringify(body) }),
  put:    (path, body, opts = {}) => apiFetch(path, { ...opts, method: 'PUT',    body: JSON.stringify(body) }),
  patch:  (path, body, opts = {}) => apiFetch(path, { ...opts, method: 'PATCH',  body: JSON.stringify(body) }),
  delete: (path, opts = {})    => apiFetch(path, { ...opts, method: 'DELETE' }),
};

export default api;