import { getToken } from './api.js';

/**
 * Lightweight product-analytics client. Buffers events and flushes them to the API in batches —
 * never blocks the UI, never throws into app code.
 *
 * Enabled only when BOTH are true:
 *   - VITE_ANALYTICS_ENABLED !== 'false'  (build-time UI switch)
 *   - the server said analytics is on for this location (init({enabled}))  — respects the API's
 *     ANALYTICS_ENABLED flag and excluded-location list.
 *
 * Delivery: flush every FLUSH_MS, when the buffer hits MAX_BUFFER, and on page-hide via
 * navigator.sendBeacon (survives tab close). The session token rides in the request body so a
 * beacon (which can't set headers) still authenticates.
 */

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const BUILD_ENABLED = String(import.meta.env.VITE_ANALYTICS_ENABLED ?? 'true').toLowerCase() !== 'false';
const FLUSH_MS = 5000;
const MAX_BUFFER = 20;

let serverEnabled = false;
let buffer = [];
let timer = null;
let sessionId = null;
let currentPath = null;

function newSessionId() {
  // Per-tab id to group a visit. Random-ish without needing crypto/uuid.
  return 'a' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function enabled() {
  return BUILD_ENABLED && serverEnabled && !!getToken();
}

/** Call once after auth resolves, with the server's analytics config. */
export function initAnalytics({ enabled: srvEnabled } = {}) {
  serverEnabled = !!srvEnabled;
  if (!BUILD_ENABLED || !serverEnabled) return;
  if (!sessionId) sessionId = newSessionId();

  // Flush on tab hide / close — this is when we'd otherwise lose the tail of a session.
  const onHide = () => { if (document.visibilityState === 'hidden') flush(true); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', () => flush(true));
}

/** Record an event. Fire-and-forget; safe to call anywhere. */
export function track(name, props = {}) {
  if (!enabled() || !name) return;
  buffer.push({ name, props, path: currentPath, sessionId, ts: new Date().toISOString() });
  if (buffer.length >= MAX_BUFFER) flush();
  else scheduleFlush();
}

/** Convenience: record a page/tab view and remember the path for later events. */
export function trackPageView(path, props = {}) {
  currentPath = path;
  track('page_view', { view: path, ...props });
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, FLUSH_MS);
}

/**
 * Send buffered events. `useBeacon` picks navigator.sendBeacon (for page-hide) so the request
 * survives the tab closing; otherwise a normal keepalive fetch.
 */
function flush(useBeacon = false) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!enabled() || buffer.length === 0) return;

  const events = buffer;
  buffer = [];
  const payload = JSON.stringify({ token: getToken(), events });
  const url = `${BASE}/api/analytics/batch`;

  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true })
        .catch(() => { /* analytics must never surface an error */ });
    }
  } catch { /* ignore */ }
}
