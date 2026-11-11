const logger = require('../utils/logger');
const database = require('../config/database');

const Installation = require('../models/Installation');
const Workspace = require('../models/Workspace');
const Agent = require('../models/Agent');
const Ticket = require('../models/Ticket');
const Comment = require('../models/Comment');
const TicketEvent = require('../models/TicketEvent');
const Counter = require('../models/Counter');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const OnboardingCharge = require('../models/OnboardingCharge');
const Subscription = require('../models/Subscription');
const OAuthToken = require('../models/OAuthToken');
const PortalForm = require('../models/PortalForm');
const WorkflowSubscription = require('../models/WorkflowSubscription');
const CompanyLocation = require('../models/CompanyLocation');

/**
 * Post-uninstall data purge with a grace period.
 *
 * UNINSTALL marks the install `uninstalled` (+ uninstalledAt) and revokes tokens, but KEEPS tenant
 * data so a reinstall within the window restores everything. This job hard-deletes all data for a
 * location once it's been uninstalled longer than ANALYTICS-independent grace window
 * (UNINSTALL_PURGE_DAYS, default 7). Privacy-friendly: nothing is retained past the window.
 *
 * Reinstall clears the pending purge by flipping the install back to `active` (see INSTALL handler),
 * so a location that's active again is never purged.
 *
 * Agency (company-level) uninstalls are recorded on an Installation with NO locationId. Those are
 * expanded to the agency's sub-accounts (Workspace.companyId + CompanyLocation) and each is purged —
 * except any sub-account that still has an active install or is inside its own grace window.
 */

const PURGE_DAYS = Number(process.env.UNINSTALL_PURGE_DAYS || 7);
const INTERVAL_MS = Number(process.env.UNINSTALL_CLEANUP_INTERVAL_MS || 6 * 60 * 60 * 1000); // every 6h

/** Delete every tenant-scoped collection for one location. Returns a per-collection count. */
async function purgeLocation(locationId, companyId) {
  const q = { locationId };
  const [tickets, comments, events, agents, analytics, charges, counters, workspaces, subs, forms, wfSubs] = await Promise.all([
    Ticket.deleteMany(q),
    Comment.deleteMany(q),
    TicketEvent.deleteMany(q),
    Agent.deleteMany(q),
    AnalyticsEvent.deleteMany(q),
    OnboardingCharge.deleteMany(q),
    Counter.deleteMany({ key: new RegExp(`^${locationId}:`) }), // counters keyed `${locationId}:${name}`
    Workspace.deleteMany(q),
    Subscription.deleteMany(q),
    PortalForm.deleteMany(q),          // public portal forms (their links stop resolving)
    WorkflowSubscription.deleteMany(q) // workflow trigger subscriptions — nothing left to fire them
  ]);
  // Tokens were already removed at uninstall, but sweep any location-scoped stragglers (never the
  // company token — other locations may still use it).
  await OAuthToken.deleteMany({ locationId });

  // Finally drop the Installation record itself (it's served its purpose as the grace anchor).
  await Installation.deleteMany({ locationId, status: 'uninstalled' });

  // NOTE: TrialLedger is intentionally NOT purged here. It's the permanent record that this location
  // already used its free trial, so a reinstall doesn't grant a second one. Never add it above.

  const summary = {
    tickets: tickets.deletedCount, comments: comments.deletedCount, events: events.deletedCount,
    agents: agents.deletedCount, analytics: analytics.deletedCount, charges: charges.deletedCount,
    counters: counters.deletedCount, workspaces: workspaces.deletedCount, subscriptions: subs.deletedCount,
    portalForms: forms.deletedCount, workflowSubscriptions: wfSubs.deletedCount
  };
  logger.warn('🧹 Purged uninstalled tenant data', { locationId, companyId, ...summary });
  return summary;
}

/**
 * Purge every sub-account of an agency whose company-level install has been uninstalled past the
 * window. A sub-account is SKIPPED if it has an active install of its own, or a location-level
 * uninstall that is still inside its grace window (it'll be purged on its own schedule).
 */
async function purgeCompany(inst, cutoff) {
  const { companyId } = inst;
  const [wsIds, map] = await Promise.all([
    Workspace.distinct('locationId', { companyId }),
    CompanyLocation.findOne({ companyId }).lean()
  ]);
  const locationIds = [...new Set([...(wsIds || []), ...((map && map.locationIds) || [])].filter(Boolean))];

  let purged = 0;
  let skipped = 0;
  for (const locationId of locationIds) {
    const keep = await Installation.exists({
      locationId,
      $or: [{ status: 'active' }, { status: 'uninstalled', uninstalledAt: { $gte: cutoff } }]
    });
    if (keep) { skipped++; continue; }
    await purgeLocation(locationId, companyId)
      .then(() => { purged++; })
      .catch((e) => { skipped++; logger.error('purge failed', { locationId, companyId, message: e.message }); });
  }

  // Company-scoped leftovers. Keep the agency→locations map while any sub-account survives, since
  // token minting for those still relies on it.
  await Subscription.deleteMany({ companyId, locationId: null });
  if (!skipped) await CompanyLocation.deleteMany({ companyId });
  await Installation.deleteOne({ _id: inst._id }); // the grace anchor has served its purpose

  logger.warn('🧹 Purged uninstalled agency data', { companyId, locations: locationIds.length, purged, skipped });
}

async function tick() {
  if (!database.isConnected()) return;
  try {
    const cutoff = new Date(Date.now() - PURGE_DAYS * 24 * 60 * 60 * 1000);
    const due = await Installation.find({
      status: 'uninstalled',
      uninstalledAt: { $lt: cutoff },
      locationId: { $ne: null }
    }).select('locationId companyId').limit(100);

    // No early return — the agency pass below must still run when no single location is due.
    if (due.length) logger.info(`🧹 Uninstall cleanup: ${due.length} location(s) past the ${PURGE_DAYS}-day window`);
    for (const inst of due) {
      await purgeLocation(inst.locationId, inst.companyId).catch((e) =>
        logger.error('purge failed', { locationId: inst.locationId, message: e.message }));
    }
  } catch (err) {
    logger.error('uninstall cleanup pass failed', { message: err.message });
  }

  // Agency-level uninstalls (Installation with no locationId).
  try {
    const cutoff = new Date(Date.now() - PURGE_DAYS * 24 * 60 * 60 * 1000);
    const dueCompanies = await Installation.find({
      status: 'uninstalled',
      uninstalledAt: { $lt: cutoff },
      locationId: null,
      companyId: { $ne: null }
    }).select('companyId').limit(50);
    if (dueCompanies.length) {
      logger.info(`🧹 Uninstall cleanup: ${dueCompanies.length} agency install(s) past the ${PURGE_DAYS}-day window`);
    }
    for (const inst of dueCompanies) {
      await purgeCompany(inst, cutoff).catch((e) =>
        logger.error('agency purge failed', { companyId: inst.companyId, message: e.message }));
    }
  } catch (err) {
    logger.error('agency uninstall cleanup pass failed', { message: err.message });
  }
}

let timer = null;
function start() {
  if (timer) return;
  logger.info(`🧹 Uninstall cleanup started (purge after ${PURGE_DAYS}d, scan every ${Math.round(INTERVAL_MS / 3600000)}h)`);
  timer = setInterval(tick, INTERVAL_MS);
  setTimeout(tick, 30000); // first pass 30s after boot
}
function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { start, stop, tick, purgeLocation, purgeCompany };
