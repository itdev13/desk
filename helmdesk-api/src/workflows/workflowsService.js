const axios = require('axios');
const WorkflowSubscription = require('../models/WorkflowSubscription');
const ghlService = require('../services/ghlService');
const logger = require('../utils/logger');

/**
 * HelpDesk custom workflow triggers — subscription handling + firing.
 * Ported from the telegram app's proven GHL custom-trigger pattern.
 *
 * Flow:
 *   1. GHL calls handleSubscription() when an agency adds/updates/removes a HelpDesk trigger in a
 *      workflow. We upsert (or soft-delete) a WorkflowSubscription keyed on {workflowId, triggerKey}.
 *   2. When that ticket event happens, fireTrigger() POSTs the event payload to every active
 *      subscription's targetUrl, which starts the agency's workflow.
 */

const API_VERSION = process.env.GHL_API_VERSION || '2021-07-28';

/**
 * Handle the subscribe/update/delete webhook from GHL.
 * Body shape: { triggerData: { eventType, targetUrl, filters }, extras: { locationId, workflowId, companyId }, meta: { key, ... } }
 * eventType ∈ CREATED | UPDATED | DELETED.
 */
async function handleSubscription(body = {}) {
  const { triggerData = {}, extras = {}, meta = {} } = body;
  const { eventType, targetUrl, filters } = triggerData;
  const { locationId, workflowId, companyId } = extras;
  const triggerKey = meta.key;

  if (!workflowId || !triggerKey) {
    throw new Error('Missing workflowId or trigger key in subscription payload');
  }

  if (eventType === 'DELETED') {
    await WorkflowSubscription.findOneAndUpdate(
      { workflowId, triggerKey },
      { status: 'deleted' }
    );
    logger.info('🔌 Workflow trigger unsubscribed', { triggerKey, workflowId });
    return { success: true };
  }

  // CREATED or UPDATED → upsert an active subscription.
  await WorkflowSubscription.findOneAndUpdate(
    { workflowId, triggerKey },
    { locationId, companyId: companyId || null, workflowId, triggerKey, targetUrl, filters: filters || {}, extras, meta, status: 'active' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  logger.info('🔗 Workflow trigger subscribed', { triggerKey, workflowId, locationId });
  return { success: true };
}

/** A 200 body (or an error) from GHL can still mean the trigger is gone — detect so we stop firing it. */
function isTriggerDead(status, bodyText) {
  const t = String(bodyText || '').toLowerCase();
  if (t.includes('trigger is deleted') || t.includes('is inactive') || t.includes('skipping execution')) return true;
  if (status === 404) return true;
  return false;
}

async function markSubscriptionDeleted(subId) {
  try {
    await WorkflowSubscription.findByIdAndUpdate(subId, { status: 'deleted' });
  } catch (e) {
    logger.warn('could not soft-delete dead workflow subscription', { subId, message: e.message });
  }
}

/**
 * Fire a trigger: POST `eventData` to every active subscription for this location + trigger key.
 * Fire-and-forget by callers; never throws into the ticket flow.
 */
async function fireTrigger(triggerKey, locationId, eventData) {
  const subs = await WorkflowSubscription.find({ locationId, triggerKey, status: 'active' });
  if (!subs.length) return;

  let accessToken = null;
  try {
    accessToken = await ghlService.getValidToken(locationId);
  } catch (e) {
    logger.warn('workflow fire: no token (firing without auth header)', { triggerKey, locationId, message: e.message });
  }

  const headers = { 'Content-Type': 'application/json', Version: API_VERSION };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        const resp = await axios.post(sub.targetUrl, eventData, { headers, timeout: 10000 });
        const bodyText = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data || '');
        if (isTriggerDead(resp.status, bodyText)) {
          await markSubscriptionDeleted(sub._id);
        }
      } catch (err) {
        const status = err.response?.status;
        const bodyText = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        if (isTriggerDead(status, bodyText)) {
          await markSubscriptionDeleted(sub._id);
        } else {
          logger.warn('workflow fire failed', { triggerKey, workflowId: sub.workflowId, status, message: err.message });
        }
      }
    })
  );
}

/* ───────────────────────── Workflow ACTIONS ───────────────────────── */

const ACTION_PRIORITIES = ['urgent', 'high', 'normal', 'low'];

/** GHL sends action inputs under `data` (older payloads used `inputData`). Values may be non-strings. */
function str(v) { return v == null ? '' : String(v).trim(); }
function truthy(v) { return ['true', 'yes', '1', 'on'].includes(str(v).toLowerCase()); }

/**
 * "Create HelpDesk ticket" action — lets an agency open a ticket from any workflow, e.g.
 * Trigger: Pipeline Stage Changed → Action: Create HelpDesk ticket.
 *
 * Payload: { data: { subject, message, priority, assignee, skipIfOpen }, extras: { locationId, contactId, workflowId } }
 *   - subject   (required) — merge fields like {{contact.name}} are resolved by GHL before we get it.
 *   - priority  urgent | high | normal | low (anything else → normal, so a typo never fails the step).
 *   - assignee  GHL user id OR email of a HelpDesk agent in this location; blank → normal auto-routing.
 *   - skipIfOpen "yes" → don't create a duplicate when this contact already has an open ticket with the
 *                same subject. Pipeline stages flip back and forth; without this each flip opens a ticket.
 *
 * Throws with a human message on bad input — the router turns that into a 400 that GHL shows in the
 * workflow's execution history.
 */
async function executeCreateTicket(payload = {}) {
  const data = payload.data || payload.inputData || {};
  const extras = payload.extras || {};
  const locationId = str(extras.locationId);
  const contactId = str(extras.contactId || data.contactId);
  const subject = str(data.subject);
  const message = str(data.message);
  const priority = ACTION_PRIORITIES.includes(str(data.priority).toLowerCase()) ? str(data.priority).toLowerCase() : 'normal';

  if (!locationId) throw new Error('Missing location — re-save the workflow.');
  if (!contactId) throw new Error('This workflow has no contact. Use a contact-based trigger (e.g. Pipeline Stage Changed).');
  if (!subject) throw new Error('Ticket subject is required.');

  // Lazy requires: ticketService requires this module (to fire triggers), so a top-level require would
  // be circular.
  const Workspace = require('../models/Workspace');
  const Ticket = require('../models/Ticket');
  const Agent = require('../models/Agent');
  const ticketService = require('../services/ticketService');

  const workspace = await Workspace.findOne({ locationId });
  if (!workspace) throw new Error('HelpDesk is not set up for this sub-account. Open HelpDesk once to finish setup.');

  // Fetch the contact with THIS location's token — proves the contact belongs to the location (a forged
  // request can't attach a ticket to someone else's contact) and gives us name/email for the ticket.
  let contact;
  try {
    const raw = await ghlService.apiRequest('GET', `/contacts/${encodeURIComponent(contactId)}`, locationId);
    const c = raw.contact || raw;
    if (!c || !(c.id || c._id)) throw new Error('not found');
    contact = {
      id: c.id || c._id,
      name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || 'Contact',
      email: c.email || null
    };
  } catch (e) {
    throw new Error('Contact not found in this sub-account.');
  }

  if (truthy(data.skipIfOpen)) {
    const existing = await Ticket.findOne({
      locationId, contactId: contact.id, subject, status: { $in: Ticket.OPEN_STATUSES }
    }).select('_id ref').lean();
    if (existing) {
      logger.info('⏭️ Workflow create-ticket skipped (open duplicate)', { locationId, contactId: contact.id, ref: existing.ref });
      return { ticketId: String(existing._id), ticketRef: existing.ref, created: false };
    }
  }

  const ticket = await ticketService.createTicket(workspace, {
    subject,
    contactId: contact.id,
    contactName: contact.name,
    contactEmail: contact.email,
    source: 'workflow',
    channel: 'Internal',
    priority,
    firstMessage: message || null
  });

  // Optional explicit assignee — must be an agent of THIS location (id or email), else ignored-with-error
  // so the agency notices the misconfiguration instead of tickets silently landing unassigned.
  const who = str(data.assignee);
  if (who) {
    const agent = await Agent.findOne({
      locationId,
      deleted: { $ne: true },
      $or: [{ ghlUserId: who }, { email: who.toLowerCase() }, { email: who }]
    }).lean();
    if (!agent) {
      logger.warn('Workflow create-ticket: assignee not found', { locationId, who });
    } else {
      await ticketService.assign(ticket, { assigneeId: agent.ghlUserId, assigneeName: agent.name || null });
    }
  }

  logger.info('🎫 Ticket created from workflow', { locationId, ref: ticket.ref, workflowId: extras.workflowId });
  return { ticketId: String(ticket._id), ticketRef: ticket.ref, created: true };
}

module.exports = { handleSubscription, fireTrigger, executeCreateTicket };
