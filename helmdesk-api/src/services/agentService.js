const logger = require('../utils/logger');
const Agent = require('../models/Agent');
const OAuthToken = require('../models/OAuthToken');
const CompanyLocation = require('../models/CompanyLocation');
const ghlService = require('./ghlService');

/**
 * Resolve the companyId for a location. GHL's GET /users/search needs it, but the auth session
 * doesn't always carry it (e.g. a location-level install, or the dev locationId fallback). Look it
 * up from the stored token, then the company↔location map.
 */
async function resolveCompanyId(locationId, companyId) {
  if (companyId) return companyId;
  const token = await OAuthToken.findOne({ locationId, isActive: true });
  if (token?.companyId) return token.companyId;
  const map = await CompanyLocation.findCompanyByLocation(locationId);
  return map?.companyId || null;
}

/**
 * Syncs the agent roster for a workspace from GHL's user list. Idempotent — safe to call on
 * setup, on demand from the Team screen, and after installs. New users are added as active agents;
 * existing ones get name/email refreshed without clobbering their active flag or load count.
 */
async function syncAgents(locationId, companyId) {
  const resolvedCompanyId = await resolveCompanyId(locationId, companyId);
  if (!resolvedCompanyId) {
    logger.warn('syncAgents: no companyId resolvable — /users/search needs one', { locationId });
  }
  const users = await ghlService.searchUsers(locationId, { companyId: resolvedCompanyId });
  const synced = [];
  for (const u of users) {
    const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || 'Agent';
    const doc = await Agent.findOneAndUpdate(
      { locationId, ghlUserId: u.id },
      {
        $set: { name, email: u.email || null, role: u.roles?.role === 'admin' ? 'admin' : 'agent' },
        $setOnInsert: { active: true, openTicketCount: 0 }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    synced.push(doc);
  }
  logger.info('👥 Agents synced', { locationId, count: synced.length });
  return synced;
}

module.exports = { syncAgents };
