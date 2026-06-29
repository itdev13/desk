const logger = require('../utils/logger');
const database = require('../config/database');
const Ticket = require('../models/Ticket');
const Workspace = require('../models/Workspace');
const ticketService = require('../services/ticketService');

/**
 * Background SLA monitor. Runs on an interval (no external scheduler needed for a single instance;
 * for multi-instance deploys, gate this with a leader lock or move to a dedicated worker).
 *
 * Two passes, both pure DB work (zero variable cost):
 *  1. Breach detection — flag open, non-paused tickets whose first-response or resolve SLA has
 *     passed. Sets `breached=true` and records an event so the dashboard turns them red.
 *  2. Auto-close — close resolved tickets that have sat untouched past the workspace's
 *     autoCloseResolvedDays window.
 */

const INTERVAL_MS = Number(process.env.SLA_INTERVAL_MS || 60 * 1000); // default: every minute

async function detectBreaches() {
  const now = new Date();
  // Open, not-paused tickets that are not yet flagged, whose first-response OR resolve due time passed.
  const candidates = await Ticket.find({
    status: { $in: Ticket.OPEN_STATUSES },
    slaPaused: false,
    breached: false,
    $or: [
      { firstResponseAt: null, slaFirstResponseDueAt: { $lt: now } },
      { slaResolveDueAt: { $lt: now } }
    ]
  }).limit(500);

  for (const ticket of candidates) {
    ticket.breached = true;
    await ticket.save();
    await ticketService.recordEvent(ticket, 'sla_breached', {
      actorType: 'system',
      meta: {
        firstResponseOverdue: !ticket.firstResponseAt && ticket.slaFirstResponseDueAt < now,
        resolveOverdue: ticket.slaResolveDueAt < now
      }
    });
    logger.warn('⏰ SLA breach', { ref: ticket.ref, locationId: ticket.locationId });
    // Hook point: notify the assignee/manager here (in-app notification, email, or a GHL message).
  }
  return candidates.length;
}

async function autoCloseResolved() {
  // Group by workspace because the window is per-workspace.
  const workspaces = await Workspace.find({ autoCloseResolvedDays: { $gt: 0 } }).select('locationId autoCloseResolvedDays');
  let closed = 0;
  for (const ws of workspaces) {
    const cutoff = new Date(Date.now() - ws.autoCloseResolvedDays * 24 * 60 * 60 * 1000);
    const stale = await Ticket.find({ locationId: ws.locationId, status: 'resolved', resolvedAt: { $lt: cutoff } }).limit(200);
    for (const ticket of stale) {
      ticket.status = 'closed';
      ticket.closedAt = new Date();
      await ticket.save();
      await ticketService.recordEvent(ticket, 'auto_closed', { actorType: 'system', meta: { afterDays: ws.autoCloseResolvedDays } });
      closed += 1;
    }
  }
  return closed;
}

async function tick() {
  if (!database.isConnected()) return;
  try {
    const breached = await detectBreaches();
    const closed = await autoCloseResolved();
    if (breached || closed) logger.info('SLA monitor pass', { breached, closed });
  } catch (err) {
    logger.error('SLA monitor pass failed', { message: err.message });
  }
}

let timer = null;
function start() {
  if (timer) return;
  logger.info(`🕒 SLA monitor started (every ${Math.round(INTERVAL_MS / 1000)}s)`);
  timer = setInterval(tick, INTERVAL_MS);
  // Run one pass shortly after boot.
  setTimeout(tick, 5000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, detectBreaches, autoCloseResolved };
