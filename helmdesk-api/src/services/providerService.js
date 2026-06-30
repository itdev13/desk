const logger = require('../utils/logger');
const ghlService = require('./ghlService');
const Provider = require('../models/Provider');

/**
 * Conversation providers for a workspace.
 *
 * Strategy (per the user's design): fetch from GHL's conversation-channels API at INSTALL and on
 * demand (Settings → Re-sync), STORE them, and read from the DB everywhere else. GHL has no public
 * API to list custom providers — this captures native + type-bound (Twilio/Mailgun/etc.) under the
 * SMS/Email channel lists. Custom-provider ids seen on inbound messages won't have a stored row and
 * fall back to the raw id at the call site.
 */

/** Fetch SMS + Email providers from GHL and upsert them into the Provider collection. */
async function syncProviders(locationId) {
  let fetched = [];
  try {
    const [sms, email] = await Promise.all([
      ghlService.getConversationChannels(locationId, 'SMS'),
      ghlService.getConversationChannels(locationId, 'Email')
    ]);
    // getConversationChannels already stamps `channel` (the endpoint type) on each provider.
    fetched = [...sms, ...email];
  } catch (err) {
    logger.warn('syncProviders: GHL fetch failed', { locationId, message: err.message });
  }

  const now = new Date();
  for (const p of fetched) {
    await Provider.findOneAndUpdate(
      { locationId, providerId: p.id, channel: p.channel },
      // Re-appearing un-deletes it.
      { $set: { name: p.name || null, isDefault: !!p.default, deleted: false, deletedAt: null, lastSyncedAt: now } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
  // Soft-delete providers that disappeared from GHL (removed integrations) — keep the row + name,
  // flag deleted so Settings can badge "Deleted in CRM". Only when the fetch actually returned
  // something, so a transient API failure never flags everything as deleted.
  if (fetched.length) {
    const keepIds = fetched.map((p) => p.id);
    await Provider.updateMany(
      { locationId, providerId: { $nin: keepIds }, deleted: { $ne: true } },
      { $set: { deleted: true, deletedAt: now } }
    );
  }

  const stored = await Provider.find({ locationId }).sort({ deleted: 1, channel: 1, name: 1 }).lean();
  logger.info('🔌 Providers synced', { locationId, fetched: fetched.length, stored: stored.length });
  return stored;
}

/** All stored providers for a workspace (for the Settings list). */
async function listProviders(locationId) {
  return Provider.find({ locationId }).sort({ deleted: 1, channel: 1, name: 1 }).lean();
}

/** id → name map from the stored providers (no GHL call). */
async function getProviderMap(locationId) {
  const rows = await Provider.find({ locationId }).select('providerId name').lean();
  const map = {};
  for (const r of rows) if (r.name) map[r.providerId] = r.name;
  return map;
}

/** Resolve one provider id to a stored name, or null. */
async function nameFor(locationId, providerId) {
  if (!providerId) return null;
  const row = await Provider.findOne({ locationId, providerId }).select('name').lean();
  return row?.name || null;
}

module.exports = { syncProviders, listProviders, getProviderMap, nameFor };
