const logger = require('../utils/logger');
const database = require('../config/database');
const AnalyticsEvent = require('../models/AnalyticsEvent');

/**
 * Product analytics ingestion. Captures clickstream/action events from the UI into one collection,
 * asynchronously. Two guards, both enforced server-side (defense in depth — the UI also honors
 * them, but a client can't bypass these):
 *   - ANALYTICS_ENABLED=false                → tracking off entirely.
 *   - ANALYTICS_EXCLUDED_LOCATION_IDS=a,b,c  → drop events from these locations (internal/test).
 */

function isEnabled() {
  return String(process.env.ANALYTICS_ENABLED ?? 'true').toLowerCase() !== 'false';
}

let _excluded = null;
function excludedLocationIds() {
  if (_excluded) return _excluded;
  _excluded = new Set(
    String(process.env.ANALYTICS_EXCLUDED_LOCATION_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return _excluded;
}

function isExcluded(locationId) {
  return excludedLocationIds().has(locationId);
}

const MAX_EVENTS_PER_BATCH = 50;
const MAX_NAME_LEN = 80;
const MAX_PROPS_BYTES = 4000;

/** Trim an event to safe bounds so a bad/oversized client payload can't bloat the collection. */
function sanitizeEvent(e, ctx) {
  const name = String(e?.name || '').slice(0, MAX_NAME_LEN);
  if (!name) return null;
  let props = e?.props && typeof e.props === 'object' ? e.props : {};
  try {
    if (JSON.stringify(props).length > MAX_PROPS_BYTES) props = { _truncated: true };
  } catch { props = {}; }
  const ts = e?.ts ? new Date(e.ts) : null;
  return {
    locationId: ctx.locationId,
    companyId: ctx.companyId || null,
    userId: ctx.userId || null,
    role: ctx.role || null,
    name,
    props,
    path: e?.path ? String(e.path).slice(0, 200) : null,
    sessionId: e?.sessionId ? String(e.sessionId).slice(0, 60) : null,
    ts: ts && !isNaN(ts.getTime()) ? ts : null,
    ua: ctx.ua ? String(ctx.ua).slice(0, 300) : null
  };
}

/**
 * Ingest a batch of events for one authenticated tenant. Returns { accepted, skipped, reason }.
 * Never throws to the caller — analytics must never break a user flow.
 */
async function ingest(events, ctx) {
  if (!isEnabled()) return { accepted: 0, skipped: 0, reason: 'disabled' };
  if (isExcluded(ctx.locationId)) return { accepted: 0, skipped: 0, reason: 'excluded' };
  if (!database.isConnected()) return { accepted: 0, skipped: 0, reason: 'db_down' };
  if (!Array.isArray(events) || events.length === 0) return { accepted: 0, skipped: 0 };

  const docs = events
    .slice(0, MAX_EVENTS_PER_BATCH)
    .map((e) => sanitizeEvent(e, ctx))
    .filter(Boolean);

  if (docs.length === 0) return { accepted: 0, skipped: events.length };

  try {
    await AnalyticsEvent.insertMany(docs, { ordered: false });
    return { accepted: docs.length, skipped: events.length - docs.length };
  } catch (err) {
    // insertMany with ordered:false still writes the good docs; log and move on.
    logger.warn('analytics insert partial/failed', { message: err.message, attempted: docs.length });
    return { accepted: 0, skipped: events.length, reason: 'insert_error' };
  }
}

/** Config the UI needs to know (whether to bother sending). */
function clientConfig(locationId) {
  return { enabled: isEnabled() && !isExcluded(locationId) };
}

module.exports = { ingest, isEnabled, isExcluded, clientConfig };
