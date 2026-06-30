const logger = require('../utils/logger');
const ghlService = require('./ghlService');

/**
 * Best-effort resolver: conversation-provider id → friendly name, per location.
 *
 * GHL has no public API that lists custom providers, but GET /conversation-channels/{SMS|Email}
 * surfaces native + type-bound providers. We fetch both, build an id→name map, and CACHE it
 * (provider lists change rarely; refetching on every dashboard load would waste calls / hit rate
 * limits). Ids we can't resolve (pure custom providers) fall back to the raw id at the call site.
 */

const TTL_MS = Number(process.env.PROVIDER_CACHE_TTL_MS || 30 * 60 * 1000); // 30 min
const cache = new Map(); // locationId -> { at: epochMs, map: { [providerId]: name } }

/** Build (or reuse cached) provider id→name map for a location. Never throws. */
async function getProviderMap(locationId) {
  const hit = cache.get(locationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;

  const map = {};
  try {
    const [sms, email] = await Promise.all([
      ghlService.getConversationChannels(locationId, 'SMS'),
      ghlService.getConversationChannels(locationId, 'Email')
    ]);
    for (const p of [...sms, ...email]) {
      if (p.id && p.name) map[p.id] = p.name;
    }
  } catch (err) {
    logger.warn('getProviderMap failed (using empty map)', { locationId, message: err.message });
  }
  cache.set(locationId, { at: Date.now(), map });
  return map;
}

/** Resolve one provider id to a name, or null if unknown. */
async function nameFor(locationId, providerId) {
  if (!providerId) return null;
  const map = await getProviderMap(locationId);
  return map[providerId] || null;
}

/** Drop the cache for a location (e.g. after a provider config change). */
function invalidate(locationId) {
  cache.delete(locationId);
}

module.exports = { getProviderMap, nameFor, invalidate };
