const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

let sessionToken = null;
export function setToken(t) { sessionToken = t; }
export function getToken() { return sessionToken; }

/**
 * Public portal URL for a slug. The /portal route is served by the API, so this must point at the
 * API origin (VITE_API_URL) — NOT the app's own origin (window.location), which is the SPA host
 * and has no /portal route. Falls back to current origin only in local single-origin dev.
 */
export function portalUrl(slug) {
  const base = BASE || window.location.origin;
  return `${base}/portal/${slug}`;
}

async function request(path, { method = 'GET', body, params, auth = true } = {}) {
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
  board: () => request('/api/tickets/board'),
  getTicket: (id) => request(`/api/tickets/${id}`),
  createTicket: (body) => request('/api/tickets', { method: 'POST', body }),
  reply: (id, body) => request(`/api/tickets/${id}/reply`, { method: 'POST', body }),
  note: (id, body) => request(`/api/tickets/${id}/note`, { method: 'POST', body }),
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

  // Support
  supportConfig: () => request('/api/support/config'),
  supportContact: (body) => request('/api/support/contact', { method: 'POST', body }),
  bookOnboardingCall: () => request('/api/support/onboarding-call', { method: 'POST' })
};
