const logger = require('../utils/logger');
const Ticket = require('../models/Ticket');
const Comment = require('../models/Comment');
const TicketEvent = require('../models/TicketEvent');
const Agent = require('../models/Agent');
const Workspace = require('../models/Workspace');
const Counter = require('../models/Counter');
const ghlService = require('./ghlService');

/**
 * The ticket engine — the actual product. Pure logic over our own DB:
 *  - decide whether an inbound message should become a ticket (filter)
 *  - collapse a conversation into a single ticket (dedup)
 *  - create with number / SLA / routing
 *  - drive the status lifecycle, replies (out via GHL), notes, assignment
 *
 * Zero variable cost: nothing here calls a metered service. Outbound replies go through the
 * agency's own GHL channels.
 */

const OPEN_STATUSES = Ticket.OPEN_STATUSES;
const SHORT_MESSAGE_WORDS = 2; // "ok", "thanks 👍" → ignored when ignoreShortMessages is on

/** Record an audit event (best-effort; never blocks the main flow). */
async function recordEvent(ticket, type, { actorType = 'system', actorId = null, actorName = null, meta = {} } = {}) {
  try {
    await TicketEvent.create({
      locationId: ticket.locationId,
      ticketId: ticket._id,
      type,
      actorType,
      actorId,
      actorName,
      meta
    });
  } catch (err) {
    logger.warn('recordEvent failed (non-fatal)', { type, message: err.message });
  }
}

/** Compute SLA due dates from the workspace policy and a creation time. */
function computeSla(workspace, priority, from = new Date()) {
  const policy = workspace.slaFor(priority);
  return {
    slaFirstResponseDueAt: new Date(from.getTime() + policy.firstResponseMins * 60 * 1000),
    slaResolveDueAt: new Date(from.getTime() + policy.resolveMins * 60 * 1000)
  };
}

/**
 * Decide the assignee for a new ticket based on the workspace's assignment mode.
 * Returns { assigneeId, assigneeName } or nulls.
 */
async function pickAssignee(workspace) {
  if (workspace.assignmentMode === 'unassigned') return { assigneeId: null, assigneeName: null };

  if (workspace.assignmentMode === 'specific' && workspace.defaultAssigneeId) {
    const agent = await Agent.findOne({ locationId: workspace.locationId, ghlUserId: workspace.defaultAssigneeId });
    // If the configured default agent was deleted in the CRM, fall through to leaving it unassigned
    // rather than assigning to a non-existent user.
    if (agent && !agent.deleted) return { assigneeId: agent.ghlUserId, assigneeName: agent.name };
    return { assigneeId: null, assigneeName: null };
  }

  // round_robin — rotate across active, non-deleted agents using the workspace cursor.
  const agents = await Agent.find({ locationId: workspace.locationId, active: true, deleted: { $ne: true } }).sort({ ghlUserId: 1 });
  if (!agents.length) return { assigneeId: null, assigneeName: null };
  const idx = workspace.roundRobinCursor % agents.length;
  const chosen = agents[idx];
  workspace.roundRobinCursor = (idx + 1) % agents.length;
  await workspace.save();
  return { assigneeId: chosen.ghlUserId, assigneeName: chosen.name };
}

/**
 * Apply the workspace's auto-triage rules to a draft. Mutates and returns { priority, assigneeId, assigneeName }.
 * First matching rule wins per action; intentionally simple (channel/keyword → priority/assignee).
 */
function applyRules(workspace, { channel, body }) {
  let priority = null;
  let assignAgentId = null;
  for (const rule of workspace.rules || []) {
    if (!rule.enabled) continue;
    const channelOk = !rule.matchChannel || rule.matchChannel === channel;
    const keywordOk = !rule.matchKeyword || (body || '').toLowerCase().includes(rule.matchKeyword.toLowerCase());
    if (channelOk && keywordOk) {
      if (rule.setPriority && !priority) priority = rule.setPriority;
      if (rule.assignAgentId && !assignAgentId) assignAgentId = rule.assignAgentId;
    }
  }
  return { priority, assignAgentId };
}

/**
 * The filter gate: should this inbound message create/append a ticket at all?
 * Returns { accept: boolean, reason?: string }. Driven entirely by the agency's wizard settings.
 */
function shouldAccept(workspace, { channel, body, isAutomated }) {
  if (!workspace.setupComplete) return { accept: false, reason: 'setup_incomplete' };

  // 1. Channel gate — always applies. The message must be on a designated support channel.
  if (!workspace.supportChannels.length) {
    return { accept: false, reason: 'no_support_channels_configured' };
  }
  if (channel && !workspace.supportChannels.includes(channel)) {
    return { accept: false, reason: 'channel_not_support' };
  }

  const text = (body || '').toLowerCase();

  // 2. Skip keywords WIN over everything. A message containing one never becomes a ticket
  //    (e.g. "unsubscribe", "stop") — even if it would otherwise match a create keyword.
  if (matchesKeyword(text, workspace.skipKeywords)) {
    return { accept: false, reason: 'skip_keyword' };
  }

  // 3. Create keywords FORCE a ticket, overriding the soft filters below
  //    (automation / short-message). Channel gate above still had to pass.
  const forced = matchesKeyword(text, workspace.createKeywords);
  if (forced) return { accept: true, forced: true };

  // 4. Soft filters (skippable by a create keyword).
  if (workspace.ignoreAutomatedReplies && isAutomated) {
    return { accept: false, reason: 'automated_reply' };
  }
  if (workspace.ignoreShortMessages && body) {
    const words = body.trim().split(/\s+/).filter(Boolean);
    if (words.length <= SHORT_MESSAGE_WORDS && body.trim().length < 16) {
      return { accept: false, reason: 'short_message' };
    }
  }

  return { accept: true };
}

/** Case-insensitive substring match: does `text` contain any of the keywords? */
function matchesKeyword(text, keywords) {
  if (!keywords || !keywords.length || !text) return false;
  return keywords.some((kw) => {
    const k = String(kw).trim().toLowerCase();
    return k && text.includes(k);
  });
}

// A customer reply within this window after resolve/close reopens the SAME ticket instead of
// spawning a new one. Beyond it, a reply is treated as a fresh issue. Configurable per deploy.
const REOPEN_WINDOW_DAYS = Number(process.env.REOPEN_WINDOW_DAYS || 14);

/**
 * Find the ticket an inbound message belongs to (the dedup key). Matches the contact's most recent
 * OPEN ticket; if none, matches a recently resolved/closed one inside the reopen window so a
 * follow-up reply reopens it rather than creating a duplicate.
 */
function findDedupTicket(locationId, { contactId, conversationId }) {
  const base = {};
  if (conversationId) base.conversationId = conversationId;
  else if (contactId) base.contactId = contactId;
  else return null;

  const reopenCutoff = new Date(Date.now() - REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return Ticket.findOne({
    locationId,
    ...base,
    $or: [
      { status: { $in: OPEN_STATUSES } },
      // recently resolved/closed → eligible to reopen
      { status: { $in: ['resolved', 'closed'] }, lastActivityAt: { $gte: reopenCutoff } }
    ]
  }).sort({ lastActivityAt: -1 });
}

/**
 * Core entry point for an inbound customer message (called by the InboundMessage webhook).
 * Runs filter → dedup → (append | create). Returns { action, ticket } or { action: 'ignored', reason }.
 */
async function handleInbound(workspace, payload) {
  const {
    contactId,
    conversationId,
    channel,
    conversationProviderId = null,
    body = '',
    subject = null,
    isAutomated = false,
    contactName = null,
    contactEmail = null,
    ghlMessageId = null,
    at = new Date()
  } = payload;

  const gate = shouldAccept(workspace, { channel, body, isAutomated });
  if (!gate.accept) {
    logger.info('Inbound ignored', { locationId: workspace.locationId, reason: gate.reason, channel });
    return { action: 'ignored', reason: gate.reason };
  }

  // Dedup: append to the contact's open ticket — or reopen a recently resolved/closed one.
  const existing = await findDedupTicket(workspace.locationId, { contactId, conversationId });
  if (existing) {
    const wasClosed = existing.status === 'resolved' || existing.status === 'closed';
    await appendCustomerMessage(workspace, existing, { body, channel, ghlMessageId, contactName, at });
    return { action: wasClosed ? 'reopened' : 'appended', ticket: existing };
  }

  // Otherwise create a new ticket. Prefer an email subject line; fall back to the body's first line.
  const ticket = await createTicket(workspace, {
    subject: subject || deriveSubject(body),
    contactId,
    conversationId,
    contactName,
    contactEmail,
    channel,
    conversationProviderId,
    source: 'inbound',
    firstMessage: body,
    ghlMessageId,
    at
  });
  return { action: 'created', ticket };
}

/**
 * Handle an OutboundMessage (a reply SENT to the contact). The job is to capture replies made
 * OUTSIDE HelmDesk (native GHL inbox / workflow) so the ticket reflects reality — while NOT
 * double-recording replies we sent ourselves.
 *
 * Dedup: when we send a reply we store its ghlMessageId on the reply Comment. If a comment with
 * this ghlMessageId already exists, this outbound is our own send → skip. Otherwise it's external →
 * append it as a reply, stamp first-response, and stop the SLA clock.
 */
async function handleOutbound(workspace, { contactId, conversationId, channel, body = '', ghlMessageId = null, userId = null, at = new Date() }) {
  // 1. Dedup against our own sends.
  if (ghlMessageId) {
    const mine = await Comment.findOne({ locationId: workspace.locationId, ghlMessageId });
    if (mine) return { action: 'skipped_own_send' };
  }

  // 2. Find the contact's open ticket. If there's none, an outbound with no ticket is just a
  //    proactive/outbound-only message — we don't create a ticket from it.
  const ticket = await findDedupTicket(workspace.locationId, { contactId, conversationId });
  if (!ticket) return { action: 'ignored', reason: 'no_open_ticket' };

  // 3. Record the external reply.
  await Comment.create({
    locationId: workspace.locationId,
    ticketId: ticket._id,
    kind: 'reply',
    body,
    authorType: 'agent',
    authorId: userId,
    authorName: null, // we don't resolve the GHL user name here; the queue still shows the ticket
    channel: channel || ticket.channel,
    ghlMessageId
  });

  const now = at || new Date();
  if (!ticket.firstResponseAt) ticket.firstResponseAt = now; // stop first-response SLA
  if (ticket.status === 'new') ticket.status = 'open';
  ticket.lastAgentMessageAt = now;
  ticket.lastActivityAt = now;
  ticket.messageCount += 1;
  await recordEvent(ticket, 'replied', { actorType: 'agent', actorId: userId, meta: { via: 'external' } });
  await ticket.save();
  logger.info('↩️ External reply captured', { ref: ticket.ref });
  return { action: 'external_reply', ticket };
}

/** Turn the first line of a message into a short subject. */
function deriveSubject(body) {
  if (!body) return '(no subject)';
  const firstLine = body.trim().split('\n')[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine || '(no subject)';
}

/**
 * Create a ticket (used by inbound, portal, and manual paths). Assigns number, SLA, routing,
 * writes the opening customer message (if any), records the audit event, and fires the auto-reply.
 */
async function createTicket(workspace, opts) {
  const {
    subject,
    contactId = null,
    conversationId = null,
    contactName = null,
    contactEmail = null,
    channel = null,
    conversationProviderId = null,
    source = 'manual',
    firstMessage = null,
    ghlMessageId = null,
    createdByAgent = null, // { id, name } for manual creation
    at = new Date()
  } = opts;

  // Rules → starting priority + assignment overrides.
  const ruled = applyRules(workspace, { channel, body: firstMessage });
  const priority = ruled.priority || 'normal';

  let assignee;
  if (ruled.assignAgentId) {
    const agent = await Agent.findOne({ locationId: workspace.locationId, ghlUserId: ruled.assignAgentId });
    assignee = { assigneeId: ruled.assignAgentId, assigneeName: agent?.name || null };
  } else {
    assignee = await pickAssignee(workspace);
  }

  const number = await Counter.next(workspace.locationId, 'ticket');
  const ref = `${workspace.ticketNumberPrefix || 'HD-'}${number}`;
  const sla = computeSla(workspace, priority, at);

  const ticket = await Ticket.create({
    locationId: workspace.locationId,
    companyId: workspace.companyId,
    number,
    ref,
    subject,
    status: 'new',
    priority,
    contactId,
    conversationId,
    contactName,
    contactEmail,
    channel,
    conversationProviderId,
    source,
    assigneeId: assignee.assigneeId,
    assigneeName: assignee.assigneeName,
    ...sla,
    lastCustomerMessageAt: firstMessage ? at : null,
    lastActivityAt: at,
    messageCount: firstMessage ? 1 : 0
  });

  await recordEvent(ticket, 'created', {
    actorType: createdByAgent ? 'agent' : source === 'portal' ? 'contact' : 'system',
    actorId: createdByAgent?.id || contactId,
    actorName: createdByAgent?.name || contactName,
    meta: { source, channel, ref }
  });
  if (assignee.assigneeId) {
    await recordEvent(ticket, 'assigned', { meta: { to: assignee.assigneeId, via: ruled.assignAgentId ? 'rule' : workspace.assignmentMode } });
    await bumpAgentLoad(workspace.locationId, assignee.assigneeId, +1);
  }

  // Store the opening customer message.
  if (firstMessage) {
    await Comment.create({
      locationId: workspace.locationId,
      ticketId: ticket._id,
      kind: 'customer',
      body: firstMessage,
      authorType: 'contact',
      authorId: contactId,
      authorName: contactName,
      channel,
      ghlMessageId
    });
  }

  // Fire-and-forget auto-reply on the customer's channel.
  if (workspace.autoReplyEnabled && contactId && channel && source !== 'manual') {
    sendAutoReply(workspace, ticket).catch((err) =>
      logger.warn('auto-reply failed (non-fatal)', { ref, message: err.message })
    );
  }

  logger.info('🎫 Ticket created', { locationId: workspace.locationId, ref, priority, assignee: assignee.assigneeId });
  return ticket;
}

/** Append an inbound customer message to an existing ticket; reopen if it was resolved/closed. */
async function appendCustomerMessage(workspace, ticket, { body, channel, ghlMessageId, contactName, at = new Date() }) {
  await Comment.create({
    locationId: ticket.locationId,
    ticketId: ticket._id,
    kind: 'customer',
    body,
    authorType: 'contact',
    authorId: ticket.contactId,
    authorName: contactName || ticket.contactName,
    channel: channel || ticket.channel,
    ghlMessageId
  });

  ticket.messageCount += 1;
  ticket.lastCustomerMessageAt = at;
  ticket.lastActivityAt = at;
  // A customer reply un-pauses the SLA. If the ticket was resolved/closed, reopen it; if it was
  // waiting on the customer (pending/on_hold), move it back to open.
  ticket.slaPaused = false;
  const wasClosed = ticket.status === 'resolved' || ticket.status === 'closed';
  if (wasClosed) {
    ticket.status = 'open';
    ticket.resolvedAt = null;
    ticket.closedAt = null;
    // Reopening restarts the SLA clock from now, and clears any prior breach flag.
    const sla = computeSla(workspace, ticket.priority, at);
    ticket.slaFirstResponseDueAt = sla.slaFirstResponseDueAt;
    ticket.slaResolveDueAt = sla.slaResolveDueAt;
    ticket.firstResponseAt = null;
    ticket.breached = false;
    await recordEvent(ticket, 'reopened', { actorType: 'contact', actorId: ticket.contactId, meta: { reason: 'customer_replied' } });
  } else if (ticket.status === 'pending' || ticket.status === 'on_hold') {
    ticket.status = 'open';
  }
  await recordEvent(ticket, 'customer_replied', { actorType: 'contact', actorId: ticket.contactId });
  await ticket.save();
  logger.info('💬 Customer message appended', { ref: ticket.ref, reopened: wasClosed });
  return ticket;
}

/** Send the configured auto-reply to the customer. */
async function sendAutoReply(workspace, ticket) {
  const type = mapChannelToSendType(ticket.channel);
  if (!type) return;
  await ghlService.sendMessage(workspace.locationId, {
    type,
    contactId: ticket.contactId,
    message: workspace.autoReplyMessage,
    ...(type === 'Email' ? { subject: `Re: ${ticket.subject}`, html: `<p>${workspace.autoReplyMessage}</p>` } : {})
  });
}

/**
 * Map our stored channel to the GHL send-message `type` enum.
 * Verified against the official message-type enum:
 *   SMS, RCS, Email, WhatsApp, GMB, IG, FB, Custom, WebChat, Live_Chat, Call, ...
 * We can't send on Call/portal, so those return null (no outbound reply on that channel).
 */
function mapChannelToSendType(channel) {
  if (!channel) return null;
  const map = {
    SMS: 'SMS',
    RCS: 'RCS',
    Email: 'Email',
    WhatsApp: 'WhatsApp',
    FB: 'FB',
    IG: 'IG',
    GMB: 'GMB',
    Live_Chat: 'Live_Chat',
    WebChat: 'WebChat',
    Custom: 'Custom'
  };
  return map[channel] || null;
}

/**
 * Agent replies to the customer. Sends through GHL on the original channel, stamps first-response,
 * stops the first-response SLA clock, and moves a new ticket to 'open'.
 */
async function replyToCustomer(workspace, ticket, { body, agent, html, subject }) {
  const type = mapChannelToSendType(ticket.channel);
  let ghlMessageId = null;

  if (type && ticket.contactId) {
    const payload = { type, contactId: ticket.contactId, message: body };
    if (type === 'Email') {
      payload.subject = subject || `Re: ${ticket.subject}`;
      payload.html = html || `<p>${body}</p>`;
    }
    const res = await ghlService.sendMessage(workspace.locationId, payload);
    ghlMessageId = res?.messageId || res?.id || null;
  }

  await Comment.create({
    locationId: ticket.locationId,
    ticketId: ticket._id,
    kind: 'reply',
    body,
    authorType: 'agent',
    authorId: agent?.id,
    authorName: agent?.name,
    channel: ticket.channel,
    ghlMessageId
  });

  const now = new Date();
  if (!ticket.firstResponseAt) ticket.firstResponseAt = now;
  if (ticket.status === 'new') ticket.status = 'open';
  ticket.lastAgentMessageAt = now;
  ticket.lastActivityAt = now;
  ticket.messageCount += 1;
  await recordEvent(ticket, 'replied', { actorType: 'agent', actorId: agent?.id, actorName: agent?.name });
  await ticket.save();
  return ticket;
}

/** Add an internal note (never sent to the customer). Supports @mentions. */
async function addNote(ticket, { body, agent, mentions = [] }) {
  await Comment.create({
    locationId: ticket.locationId,
    ticketId: ticket._id,
    kind: 'note',
    body,
    authorType: 'agent',
    authorId: agent?.id,
    authorName: agent?.name,
    mentions
  });
  ticket.lastActivityAt = new Date();
  await recordEvent(ticket, 'note_added', { actorType: 'agent', actorId: agent?.id, actorName: agent?.name, meta: { mentions } });
  await ticket.save();
  return ticket;
}

/** Change status with lifecycle side-effects (resolve stamps, reopen events, pause SLA). */
async function changeStatus(ticket, newStatus, { agent } = {}) {
  const from = ticket.status;
  if (from === newStatus) return ticket;

  const wasResolvedOrClosed = from === 'resolved' || from === 'closed';
  ticket.status = newStatus;
  const now = new Date();

  if (newStatus === 'resolved') {
    ticket.resolvedAt = now;
    ticket.slaPaused = true;
  } else if (newStatus === 'closed') {
    ticket.closedAt = now;
    ticket.slaPaused = true;
  } else if (newStatus === 'pending' || newStatus === 'on_hold') {
    ticket.slaPaused = true; // waiting on customer — clock paused
  } else if (newStatus === 'open' || newStatus === 'new') {
    ticket.slaPaused = false;
    if (wasResolvedOrClosed) {
      ticket.resolvedAt = null;
      ticket.closedAt = null;
      await recordEvent(ticket, 'reopened', { actorType: agent ? 'agent' : 'system', actorId: agent?.id });
    }
  }

  ticket.lastActivityAt = now;
  await recordEvent(ticket, 'status_changed', { actorType: agent ? 'agent' : 'system', actorId: agent?.id, actorName: agent?.name, meta: { from, to: newStatus } });
  await ticket.save();
  return ticket;
}

/** Reassign a ticket to another agent, keeping denormalized load counts in sync. */
async function assign(ticket, { assigneeId, assigneeName, agent }) {
  const prev = ticket.assigneeId;
  if (prev === assigneeId) return ticket;
  ticket.assigneeId = assigneeId;
  ticket.assigneeName = assigneeName;
  ticket.lastActivityAt = new Date();
  await recordEvent(ticket, 'assigned', { actorType: agent ? 'agent' : 'system', actorId: agent?.id, meta: { from: prev, to: assigneeId } });
  await ticket.save();
  if (prev && Ticket.OPEN_STATUSES.includes(ticket.status)) await bumpAgentLoad(ticket.locationId, prev, -1);
  if (assigneeId && Ticket.OPEN_STATUSES.includes(ticket.status)) await bumpAgentLoad(ticket.locationId, assigneeId, +1);
  return ticket;
}

/** Change priority and recompute SLA due dates from now. */
async function changePriority(workspace, ticket, newPriority, { agent } = {}) {
  const from = ticket.priority;
  if (from === newPriority) return ticket;
  ticket.priority = newPriority;
  const sla = computeSla(workspace, newPriority, ticket.createdAt || new Date());
  ticket.slaFirstResponseDueAt = sla.slaFirstResponseDueAt;
  ticket.slaResolveDueAt = sla.slaResolveDueAt;
  ticket.lastActivityAt = new Date();
  await recordEvent(ticket, 'priority_changed', { actorType: agent ? 'agent' : 'system', actorId: agent?.id, meta: { from, to: newPriority } });
  await ticket.save();
  return ticket;
}

/** Keep an agent's open-ticket counter roughly in sync (best-effort; non-fatal). */
async function bumpAgentLoad(locationId, ghlUserId, delta) {
  try {
    await Agent.updateOne({ locationId, ghlUserId }, { $inc: { openTicketCount: delta } });
  } catch (err) {
    logger.warn('bumpAgentLoad failed (non-fatal)', { message: err.message });
  }
}

module.exports = {
  handleInbound,
  handleOutbound,
  createTicket,
  appendCustomerMessage,
  replyToCustomer,
  addNote,
  changeStatus,
  assign,
  changePriority,
  recordEvent,
  computeSla,
  shouldAccept
};
