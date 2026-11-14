const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

let sessionToken = null;
// Guarded: never overwrite a good token with a falsy/garbage value. A malformed verify response must
// NOT wipe the working session (that would strand the user and could surface a reconnect prompt).
export function setToken(t) { if (t && typeof t === 'string') sessionToken = t; }
export function getToken() { return sessionToken; }

/**
 * Session auto-recovery — deliberately conservative, because a botched re-auth is worse than a plain
 * failed request: it could strand the user or surface a reconnect/reinstall prompt. So this ONLY ever
 * re-runs the existing SSO handshake (which only READS install state and signs a token — it never
 * mutates or deletes the OAuth install), and it is bounded hard:
 *   • only when a session token already existed (an EXPIRED session, not an unauthenticated one)
 *   • only once per request (_retried guard in request())
 *   • concurrent 401s collapse into one handshake (refreshInFlight)
 *   • a short cooldown so a pathological 401 stream can't loop the handshake
 *   • any failure → return false and let the original 401 surface normally (no escalation, no reconnect)
 */
let refreshHandler = null;
let refreshInFlight = null;
let lastRefreshAt = 0;
const REFRESH_COOLDOWN_MS = 5000;
export function setRefreshHandler(fn) { refreshHandler = fn; }
function refreshSession() {
  if (!refreshHandler) return Promise.resolve(false);
  if (Date.now() - lastRefreshAt < REFRESH_COOLDOWN_MS && !refreshInFlight) return Promise.resolve(false);
  if (!refreshInFlight) {
    lastRefreshAt = Date.now();
    refreshInFlight = Promise.resolve()
      .then(() => refreshHandler())
      .then((ok) => ok === true) // only a strict true counts as a successful re-mint
      .catch(() => false)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/**
 * Public portal URL for a slug. The /portal route is served by the API, so this must point at the
 * API origin (VITE_API_URL) — NOT the app's own origin (window.location), which is the SPA host
 * and has no /portal route. Falls back to current origin only in local single-origin dev.
 */
export function portalUrl(slug) {
  const base = BASE || window.location.origin;
  return `${base}/portal/${slug}`;
}

async function request(path, { method = 'GET', body, params, auth = true, _retried = false } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => v != null && v !== '' && url.searchParams.set(k, v));

  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && sessionToken) headers.Authorization = `Bearer ${sessionToken}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  // Session expired → re-auth once via the registered refresher, then retry with the fresh token.
  // Conditions, all required: a 401, an authed request, we HAD a token (so this is an expired session,
  // not an unauthenticated/connect state), not already retried, and not /api/auth/verify itself (that
  // IS the refresher — retrying it would loop). On success we retry once; on failure the original 401
  // falls through and surfaces normally — we never escalate to a reconnect.
  if (res.status === 401 && auth && sessionToken && !_retried && path !== '/api/auth/verify') {
    const ok = await refreshSession();
    if (ok) return request(path, { method, body, params, auth, _retried: true });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

export const api = {
  // Auth / session
  verify: (payload) => request('/api/auth/verify', { method: 'POST', body: payload, auth: false }),
  authorizeUrl: () => `${BASE}/oauth/authorize`,

  // Settings / wizard
  getSettings: () => request('/api/settings'),
  updateSettings: (body) => request('/api/settings', { method: 'PUT', body }),
  completeSetup: (body) => request('/api/settings/complete-setup', { method: 'POST', body }),

  // Tickets
  listTickets: (params) => request('/api/tickets', { params }),
  board: (params) => request('/api/tickets/board', { params }),
  getTicket: (id) => request(`/api/tickets/${id}`),
  createTicket: (body) => request('/api/tickets', { method: 'POST', body }),
  searchContacts: (q) => request('/api/tickets/contact-search', { params: { q } }),
  reply: (id, body) => request(`/api/tickets/${id}/reply`, { method: 'POST', body }),
  note: (id, body) => request(`/api/tickets/${id}/note`, { method: 'POST', body }),
  bulkDeleteTickets: (ids) => request('/api/tickets/bulk-delete', { method: 'POST', body: { ids } }),
  bulkArchiveTickets: (ids) => request('/api/tickets/bulk-archive', { method: 'POST', body: { ids } }),
  bulkUnarchiveTickets: (ids, status) => request('/api/tickets/bulk-unarchive', { method: 'POST', body: { ids, status } }),
  // Multiple intake forms (admin)
  forms: () => request('/api/forms'),
  createForm: (body) => request('/api/forms', { method: 'POST', body }),
  updateForm: (id, body) => request(`/api/forms/${id}`, { method: 'PUT', body }),
  deleteForm: (id) => request(`/api/forms/${id}`, { method: 'DELETE' }),
  setStatus: (id, status) => request(`/api/tickets/${id}/status`, { method: 'PATCH', body: { status } }),
  setAssignee: (id, assigneeId) => request(`/api/tickets/${id}/assign`, { method: 'PATCH', body: { assigneeId } }),
  setPriority: (id, priority) => request(`/api/tickets/${id}/priority`, { method: 'PATCH', body: { priority } }),

  // Agents
  agents: () => request('/api/agents'),
  assignableAgents: () => request('/api/agents', { params: { assignable: '1' } }),

  syncAgents: () => request('/api/agents/sync', { method: 'POST' }),
  updateAgent: (ghlUserId, body) => request(`/api/agents/${ghlUserId}`, { method: 'PATCH', body }),

  // Dashboard
  dashboard: () => request('/api/dashboard'),
  trend: (days = 14) => request('/api/dashboard/trend', { params: { days } }),

  // Subscription
  subscription: () => request('/api/subscription/status'),
  plans: () => request('/api/subscription/plans'),

  // Support
  supportConfig: () => request('/api/support/config'),
  supportContact: (body) => request('/api/support/contact', { method: 'POST', body }),
  bookOnboardingCall: () => request('/api/support/onboarding-call', { method: 'POST' })
};
