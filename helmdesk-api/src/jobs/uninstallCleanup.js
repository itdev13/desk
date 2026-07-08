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
 */

const PURGE_DAYS = Number(process.env.UNINSTALL_PURGE_DAYS || 7);
const INTERVAL_MS = Number(process.env.UNINSTALL_CLEANUP_INTERVAL_MS || 6 * 60 * 60 * 1000); // every 6h

/** Delete every tenant-scoped collection for one location. Returns a per-collection count. */
async function purgeLocation(locationId, companyId) {
  const q = { locationId };
  const [tickets, comments, events, agents, analytics, charges, counters, workspaces, subs] = await Promise.all([
    Ticket.deleteMany(q),
    Comment.deleteMany(q),
    TicketEvent.deleteMany(q),
    Agent.deleteMany(q),
    AnalyticsEvent.deleteMany(q),
    OnboardingCharge.deleteMany(q),
    Counter.deleteMany({ key: new RegExp(`^${locationId}:`) }), // counters keyed `${locationId}:${name}`
    Workspace.deleteMany(q),
    Subscription.deleteMany(q)
  ]);
  // Tokens were already removed at uninstall, but sweep any location-scoped stragglers (never the
  // company token — other locations may still use it).
  await OAuthToken.deleteMany({ locationId });

  // Finally drop the Installation record itself (it's served its purpose as the grace anchor).
  await Installation.deleteMany({ locationId, status: 'uninstalled' });

  const summary = {
    tickets: tickets.deletedCount, comments: comments.deletedCount, events: events.deletedCount,
    agents: agents.deletedCount, analytics: analytics.deletedCount, charges: charges.deletedCount,
    counters: counters.deletedCount, workspaces: workspaces.deletedCount, subscriptions: subs.deletedCount
  };
  logger.warn('🧹 Purged uninstalled tenant data', { locationId, companyId, ...summary });
  return summary;
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

    if (due.length === 0) return;
    logger.info(`🧹 Uninstall cleanup: ${due.length} location(s) past the ${PURGE_DAYS}-day window`);
    for (const inst of due) {
      await purgeLocation(inst.locationId, inst.companyId).catch((e) =>
        logger.error('purge failed', { locationId: inst.locationId, message: e.message }));
    }
  } catch (err) {
    logger.error('uninstall cleanup pass failed', { message: err.message });
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

module.exports = { start, stop, tick, purgeLocation };
