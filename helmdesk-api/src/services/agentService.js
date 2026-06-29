const logger = require('../utils/logger');
const Agent = require('../models/Agent');
const ghlService = require('./ghlService');

/**
 * Syncs the agent roster for a workspace from GHL's user list. Idempotent — safe to call on
 * setup, on demand from the Team screen, and after installs. New users are added as active agents;
 * existing ones get name/email refreshed without clobbering their active flag or load count.
 */
async function syncAgents(locationId, companyId) {
  const users = await ghlService.searchUsers(locationId, { companyId });
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
