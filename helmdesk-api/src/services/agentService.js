const logger = require('../utils/logger');
const Agent = require('../models/Agent');
const OAuthToken = require('../models/OAuthToken');
const CompanyLocation = require('../models/CompanyLocation');
const ghlService = require('./ghlService');

/**
 * Map a GHL user object to our role. GHL exposes the role inconsistently across endpoints —
 * sometimes `roles.role`, sometimes a top-level `role` — and uses values like 'admin'/'account'.
 * Treat 'admin' or 'account' (agency-level) as admin; everything else is an agent.
 */
function parseRole(u = {}) {
  const r = (u.roles?.role || u.role || '').toString().toLowerCase();
  return r === 'admin' || r === 'account' ? 'admin' : 'agent';
}

/**
 * Resolve the companyId for a location. GHL's GET /users/search needs it, but the auth session
 * doesn't always carry it (e.g. a location-level install, or the dev locationId fallback). Look it
 * up from the stored token, then the company↔location map.
 */
async function resolveCompanyId(locationId, companyId) {
  if (companyId) {
    logger.info('[agentSync] companyId from auth session', { locationId, companyId });
    return companyId;
  }
  const token = await OAuthToken.findOne({ locationId, isActive: true });
  if (token?.companyId) {
    logger.info('[agentSync] companyId from OAuthToken', { locationId, companyId: token.companyId, tokenType: token.tokenType });
    return token.companyId;
  }
  const map = await CompanyLocation.findCompanyByLocation(locationId);
  if (map?.companyId) {
    logger.info('[agentSync] companyId from CompanyLocation map', { locationId, companyId: map.companyId });
    return map.companyId;
  }
  logger.warn('[agentSync] companyId NOT resolvable', {
    locationId,
    tokenFound: !!token,
    tokenHasCompanyId: !!token?.companyId,
    mapFound: !!map
  });
  return null;
}

/**
 * Syncs the agent roster for a workspace from GHL's user list. Idempotent — safe to call on
 * setup, on demand from the Team screen, and after installs. Existing agents get name/email/role
 * refreshed without clobbering their `active` flag or load count. New users are added active only
 * up to the plan's seat limit; any beyond that come in INACTIVE, so an admin picks which to enable
 * (rather than silently exceeding the plan).
 */
async function syncAgents(locationId, companyId) {
  logger.info('[agentSync] START', { locationId, companyIdFromAuth: companyId || null });
  const resolvedCompanyId = await resolveCompanyId(locationId, companyId);

  const users = await ghlService.searchUsers(locationId, { companyId: resolvedCompanyId });
  logger.info('[agentSync] searchUsers returned', { locationId, userCount: users.length });

  // How many active seats the plan allows, and how many are already used — so new inserts past
  // the cap default to inactive. Resolved lazily to avoid a hard dependency cycle.
  const subscriptionService = require('./subscriptionService');
  const { seatLimit } = await subscriptionService.planFeatures(locationId).catch(() => ({ seatLimit: 9999 }));
  let activeCount = await Agent.countDocuments({ locationId, active: true, deleted: { $ne: true } });

  const synced = [];
  let capped = 0;
  for (const u of users) {
    const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || 'Agent';
    const existing = await Agent.findOne({ locationId, ghlUserId: u.id }).select('active').lean();
    // A brand-new agent becomes active only if there's a free seat.
    const activateOnInsert = !existing && (seatLimit >= 9999 || activeCount < seatLimit);
    if (!existing && !activateOnInsert) capped += 1;

    const doc = await Agent.findOneAndUpdate(
      { locationId, ghlUserId: u.id },
      {
        $set: { name, email: u.email || null, role: parseRole(u) },
        $setOnInsert: { active: activateOnInsert, openTicketCount: 0 }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!existing && activateOnInsert) activeCount += 1;
    synced.push(doc);
  }
  logger.info('👥 Agents synced', { locationId, count: synced.length, seatLimit, cappedInactive: capped, companyIdResolved: !!resolvedCompanyId });

  // Return diagnostics alongside the agents so the API can explain an empty result.
  return {
    agents: synced,
    diagnostics: { companyIdResolved: !!resolvedCompanyId, usersFromGhl: users.length, saved: synced.length, seatLimit, cappedInactive: capped }
  };
}

/**
 * Upsert a single agent from a User webhook (UserCreate / UserUpdate). Idempotent; preserves the
 * HelmDesk-only `active` flag and load count on update, sets them only on insert.
 */
async function upsertAgentForLocation(locationId, user) {
  const name = user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Agent';
  return Agent.findOneAndUpdate(
    { locationId, ghlUserId: user.id },
    {
      // un-delete if the user is re-created in the CRM
      $set: { name, email: user.email || null, role: parseRole(user), deleted: false, deletedAt: null },
      $setOnInsert: { active: true, openTicketCount: 0 }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/**
 * Soft-delete an agent (UserDelete). We KEEP the row so existing ticket assignments still resolve
 * to a name and the UI can warn "deleted in CRM" — we just flag it and stop assigning new work.
 */
async function removeAgentForLocation(locationId, ghlUserId) {
  await Agent.updateOne(
    { locationId, ghlUserId },
    { $set: { deleted: true, deletedAt: new Date(), active: false } }
  );
}

/**
 * Resolve which of OUR workspaces a user webhook applies to.
 * - Sub-account user: payload has `locationId` → just that one (if we have a workspace for it).
 * - Agency user: payload has `companyId` + `locations[]` → every location in that list we manage.
 * Filters to locations that actually have a HelmDesk Workspace so we don't create stray Agent rows.
 */
async function locationsForUserWebhook(data) {
  const Workspace = require('../models/Workspace');
  let candidateIds = [];
  if (data.locationId) candidateIds = [data.locationId];
  else if (Array.isArray(data.locations) && data.locations.length) candidateIds = data.locations;
  else if (data.companyId) {
    const map = await CompanyLocation.findOne({ companyId: data.companyId });
    candidateIds = map?.locationIds || [];
  }
  if (!candidateIds.length) return [];
  const existing = await Workspace.find({ locationId: { $in: candidateIds } }).select('locationId').lean();
  return existing.map((w) => w.locationId);
}

/** Handle UserCreate / UserUpdate — upsert the agent into every relevant workspace. */
async function handleUserUpsert(data) {
  if (!data?.id) return 0;
  const locationIds = await locationsForUserWebhook(data);
  for (const locationId of locationIds) await upsertAgentForLocation(locationId, data);
  logger.info('👤 User upserted from webhook', { ghlUserId: data.id, locations: locationIds.length });
  return locationIds.length;
}

/** Handle UserDelete — remove the agent from every relevant workspace. */
async function handleUserDelete(data) {
  if (!data?.id) return 0;
  const locationIds = await locationsForUserWebhook(data);
  for (const locationId of locationIds) await removeAgentForLocation(locationId, data.id);
  logger.info('👤 User removed from webhook', { ghlUserId: data.id, locations: locationIds.length });
  return locationIds.length;
}

module.exports = {
  syncAgents,
  resolveCompanyId,
  handleUserUpsert,
  handleUserDelete
};
