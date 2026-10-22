const logger = require('../utils/logger');
const Ticket = require('../models/Ticket');
const Comment = require('../models/Comment');
const TicketEvent = require('../models/TicketEvent');
const Agent = require('../models/Agent');
const Workspace = require('../models/Workspace');
const Counter = require('../models/Counter');
const ghlService = require('./ghlService');
const { fireTrigger } = require('../workflows/workflowsService');
const { TRIGGERS } = require('../workflows/triggerKeys');

/**
 * Build the payload a workflow trigger carries. These field names are what the agency references as
 * {{trigger.<field>}} in their workflow, so they must match the trigger's fields in the GHL dashboard.
 * `extra` adds event-specific fields (e.g. newStatus, breachType).
 */
function buildTriggerPayload(ticket, extra = {}) {
  // Custom portal answers (e.g. the "Do the contact details match?" dropdown) are stored on the ticket
  // as [{label, value}]. Expose them to workflows two ways: the raw array, and a flat {label: value}
  // map so a workflow condition can branch on a single answer without iterating.
  const cf = Array.isArray(ticket.customFields) ? ticket.customFields : [];
  const customFieldMap = {};
  for (const f of cf) {
    if (f && f.label != null) customFieldMap[String(f.label)] = f.value ?? '';
  }

  return {
    locationId: ticket.locationId,
    ticketRef: ticket.ref,
    ticketId: String(ticket._id),
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    channel: ticket.channel,
    contactId: ticket.contactId || null,
    contactName: ticket.contactName || null,
    contactEmail: ticket.contactEmail || null,
    assigneeId: ticket.assigneeId || null,
    assigneeName: ticket.assigneeName || null,
    source: ticket.source || 'inbound', // 'portal' | 'inbound' | 'manual' — where the ticket came from
    formName: ticket.formName || null,  // portal form name (only set when source='portal')
    customFields: cf,                   // [{ label, value }] — custom portal question answers
    customFieldMap,                     // { "<question label>": "<answer>" } for easy workflow branching
    createdAt: ticket.createdAt,
    ...extra
  };
}

/** Fire a workflow trigger without ever blocking or breaking the ticket flow. */
function safeFire(triggerKey, ticket, extra = {}) {
  try {
    fireTrigger(triggerKey, ticket.locationId, buildTriggerPayload(ticket, extra)).catch((e) =>
      logger.warn('fireTrigger rejected', { triggerKey, message: e.message })
    );
  } catch (e) {
    logger.warn('fireTrigger threw', { triggerKey, message: e.message });
  }
}

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

/**
 * Resolve a display name for an agent. Prefer the name passed from the session; if missing, look it
 * up from the synced Agent record by GHL userId. Falls back to 'Agent' only if truly unknown.
 * This is why the userId matters — it links a reply to the real user's name.
 */
async function agentNameFor(locationId, userId, fallbackName) {
  if (fallbackName) return fallbackName;
  if (userId) {
    const a = await Agent.findOne({ locationId, ghlUserId: userId }).select('name').lean();
    if (a?.name) return a.name;
  }
  return 'Agent';
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
 * `priority` is used only when round-robin is configured to balance per-priority.
 * Returns { assigneeId, assigneeName } or nulls.
 */
async function pickAssignee(workspace, priority = 'normal') {
  if (workspace.assignmentMode === 'unassigned') return { assigneeId: null, assigneeName: null };

  // Round-robin is a Team+ feature. If the plan doesn't allow it (e.g. after a downgrade, or legacy
  // config), fall back to leaving new tickets unassigned rather than silently using a gated feature.
  if (workspace.assignmentMode === 'round_robin') {
    const subscriptionService = require('./subscriptionService');
    const { routing } = await subscriptionService.planFeatures(workspace.locationId).catch(() => ({ routing: true }));
    if (!routing) return { assigneeId: null, assigneeName: null };
  }

  if (workspace.assignmentMode === 'specific' && workspace.defaultAssigneeId) {
    const agent = await Agent.findOne({ locationId: workspace.locationId, ghlUserId: workspace.defaultAssigneeId });
    // If the configured default agent was deleted in the CRM, fall through to leaving it unassigned
    // rather than assigning to a non-existent user.
    if (agent && !agent.deleted) return { assigneeId: agent.ghlUserId, assigneeName: agent.name };
    return { assigneeId: null, assigneeName: null };
  }

  // round_robin — rotate across active, non-deleted agents.
  const agents = await Agent.find({ locationId: workspace.locationId, active: true, deleted: { $ne: true } }).sort({ ghlUserId: 1 });
  if (!agents.length) return { assigneeId: null, assigneeName: null };

  let idx;
  if (workspace.roundRobinPerPriority) {
    // Keep a separate rotation per priority so each agent gets an equal share WITHIN each priority
    // level (an equal share of urgents, of highs, etc.) rather than only of the total.
    const cursors = workspace.roundRobinCursorByPriority || new Map();
    const key = priority || 'normal';
    const cur = (typeof cursors.get === 'function' ? cursors.get(key) : cursors[key]) || 0;
    idx = cur % agents.length;
    if (typeof cursors.set === 'function') cursors.set(key, (idx + 1) % agents.length);
    else cursors[key] = (idx + 1) % agents.length;
    workspace.roundRobinCursorByPriority = cursors;
    workspace.markModified('roundRobinCursorByPriority');
  } else {
    // Global rotation: balance the total number of tickets across agents.
    idx = workspace.roundRobinCursor % agents.length;
    workspace.roundRobinCursor = (idx + 1) % agents.length;
  }
  const chosen = agents[idx];
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
  //    Custom-conversation-provider messages (Custom / CustomSMS / CustomEmail) are accepted when
  //    the single "accept conversation providers" toggle is on, without listing them as channels.
  const isCustomProvider = channel === 'Custom' || channel === 'CustomSMS' || channel === 'CustomEmail';
  const channelAllowed =
    (channel && workspace.supportChannels.includes(channel)) ||
    (isCustomProvider && workspace.acceptConversationProviders);

  if (!workspace.supportChannels.length && !(isCustomProvider && workspace.acceptConversationProviders)) {
    return { accept: false, reason: 'no_support_channels_configured' };
  }
  if (channel && !channelAllowed) {
    return { accept: false, reason: 'channel_not_support' };
  }

  const text = (body || '').toLowerCase();

  // 2. Skip keywords WIN over everything. A message containing one never becomes a ticket
  //    (e.g. "unsubscribe", "stop") — this is the blacklist.
  if (matchesKeyword(text, workspace.skipKeywords)) {
    return { accept: false, reason: 'skip_keyword' };
  }

  // 3. Create keywords act as a WHITELIST when configured: if the list is non-empty, a message must
  //    contain one of them to become a ticket — anything else is skipped. (When the list is empty we
  //    keep the default "every message becomes a ticket" behavior, so existing setups aren't changed.)
  const hasCreateKeywords = Array.isArray(workspace.createKeywords) && workspace.createKeywords.length > 0;
  if (hasCreateKeywords) {
    if (matchesKeyword(text, workspace.createKeywords)) {
      return { accept: true, forced: true }; // matched the whitelist → create (also overrides soft filters)
    }
    return { accept: false, reason: 'no_create_keyword' }; // whitelist on, no match → skip
  }

  // 4. No whitelist configured → default accept, but soft filters can still skip noise.
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

// Default reopen window (days) if a workspace hasn't set one. Default 0 = always create a new
// ticket (never reopen a resolved one). Env override sets a different global default.
const DEFAULT_REOPEN_WINDOW_DAYS = Number(process.env.REOPEN_WINDOW_DAYS ?? 0);

/**
 * Find the ticket an inbound message belongs to (the dedup key). Matches the contact's most recent
 * OPEN ticket; if none, matches a recently resolved/closed one inside the reopen window so a
 * follow-up reply reopens it rather than creating a duplicate.
 * `reopenWindowDays`: per-workspace. 0 → never reopen (only match still-open tickets).
 */
function findDedupTicket(locationId, { contactId, conversationId }, reopenWindowDays = DEFAULT_REOPEN_WINDOW_DAYS) {
  const base = {};
  if (conversationId) base.conversationId = conversationId;
  else if (contactId) base.contactId = contactId;
  else return null;

  const windowDays = Number.isFinite(reopenWindowDays) ? reopenWindowDays : DEFAULT_REOPEN_WINDOW_DAYS;
  const orClauses = [{ status: { $in: OPEN_STATUSES } }];
  if (windowDays > 0) {
    // recently resolved/closed → eligible to reopen
    const reopenCutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    orClauses.push({ status: { $in: ['resolved', 'closed'] }, lastActivityAt: { $gte: reopenCutoff } });
  }
  return Ticket.findOne({ locationId, ...base, $or: orClauses }).sort({ lastActivityAt: -1 });
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

  // Idempotency: GHL retries webhooks, so the SAME message can arrive more than once. If we've already
  // stored a comment with this ghlMessageId, skip it — otherwise a retry double-adds the message (and
  // two concurrent retries could even create two tickets).
  if (ghlMessageId) {
    const seen = await Comment.findOne({ locationId: workspace.locationId, ghlMessageId }).select('_id').lean();
    if (seen) {
      logger.info('Inbound skipped — duplicate ghlMessageId (webhook retry)', { locationId: workspace.locationId, ghlMessageId });
      return { action: 'duplicate', ghlMessageId };
    }
  }

  const gate = shouldAccept(workspace, { channel, body, isAutomated });
  if (!gate.accept) {
    logger.info('Inbound ignored', { locationId: workspace.locationId, reason: gate.reason, channel });
    return { action: 'ignored', reason: gate.reason };
  }

  // Dedup: append to the contact's open ticket — or reopen a recently resolved/closed one.
  const existing = await findDedupTicket(workspace.locationId, { contactId, conversationId }, workspace.reopenWindowDays);
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
  const ticket = await findDedupTicket(workspace.locationId, { contactId, conversationId }, workspace.reopenWindowDays);
  if (!ticket) return { action: 'ignored', reason: 'no_open_ticket' };

  // 3. Record the external reply, attributed to the sending GHL user (resolved from the roster).
  const authorName = await agentNameFor(workspace.locationId, userId, null);
  await Comment.create({
    locationId: workspace.locationId,
    ticketId: ticket._id,
    kind: 'reply',
    body,
    authorType: 'agent',
    authorId: userId,
    authorName,
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
    formName = null, // portal form name (source='portal')
    priority: requestedPriority = null, // explicit priority (e.g. customer-chosen on the portal form)
    firstMessage = null,
    ghlMessageId = null,
    createdByAgent = null, // { id, name } for manual creation
    customFields = [], // [{ label, value }] answers to custom portal questions
    at = new Date()
  } = opts;

  // Priority precedence: an auto-triage RULE wins, then an explicitly requested priority (portal /
  // manual), then the default. Rules stay authoritative so an agency's routing can't be overridden by
  // a customer's self-selected priority.
  const ruled = applyRules(workspace, { channel, body: firstMessage });
  const priority = ruled.priority || requestedPriority || 'normal';

  let assignee;
  if (ruled.assignAgentId) {
    const agent = await Agent.findOne({ locationId: workspace.locationId, ghlUserId: ruled.assignAgentId });
    assignee = { assigneeId: ruled.assignAgentId, assigneeName: agent?.name || null };
  } else {
    assignee = await pickAssignee(workspace, priority);
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
    customFields: Array.isArray(customFields) ? customFields : [],
    channel,
    conversationProviderId,
    source,
    formName,
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

  // Workflow trigger: a new ticket was created (and, if auto-assigned, it was assigned too).
  safeFire(TRIGGERS.TICKET_CREATED, ticket);
  if (assignee.assigneeId) safeFire(TRIGGERS.TICKET_ASSIGNED, ticket);
  // Portal-only trigger: lets a workflow filter by `formName` and branch on the custom answers (both
  // already in the payload). Fired in addition to TICKET_CREATED so agencies can target portal forms
  // specifically without inspecting `source` on the generic trigger.
  if (ticket.source === 'portal') safeFire(TRIGGERS.PORTAL_SUBMITTED, ticket);

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
  const wasClosed = ticket.status === 'resolved' || ticket.status === 'closed';
  const wasInOpenSet = Ticket.OPEN_STATUSES.includes(ticket.status);
  if (wasClosed) {
    ticket.status = 'open';
    ticket.resolvedAt = null;
    ticket.closedAt = null;
    // Reopening restarts the SLA clock from now (fresh future due dates), so the breach flag clears.
    const sla = computeSla(workspace, ticket.priority, at);
    ticket.slaFirstResponseDueAt = sla.slaFirstResponseDueAt;
    ticket.slaResolveDueAt = sla.slaResolveDueAt;
    ticket.firstResponseAt = null;
    recomputeBreached(ticket, at); // future dates → false; consistent with the other reopen paths
    await recordEvent(ticket, 'reopened', { actorType: 'contact', actorId: ticket.contactId, meta: { reason: 'customer_replied' } });
  } else if (ticket.status === 'pending' || ticket.status === 'on_hold') {
    // Resume from pause: credit the paused time back onto the due dates, then go back to open.
    if (ticket.slaPaused && ticket.slaPausedAt) {
      extendSlaDue(ticket, at.getTime() - new Date(ticket.slaPausedAt).getTime());
    }
    ticket.status = 'open';
    recomputeBreached(ticket, at); // breach stays set if a credited due date is still in the past
  }
  ticket.slaPaused = false;
  ticket.slaPausedAt = null;
  // Agent load: a closed ticket coming back into the open set should re-increment its assignee's count.
  if (ticket.assigneeId && !wasInOpenSet && Ticket.OPEN_STATUSES.includes(ticket.status)) {
    await bumpAgentLoad(ticket.locationId, ticket.assigneeId, +1);
  }
  await recordEvent(ticket, 'customer_replied', { actorType: 'contact', actorId: ticket.contactId });
  await ticket.save();
  safeFire(TRIGGERS.CUSTOMER_REPLIED, ticket); // workflow trigger: customer replied on an existing ticket
  logger.info('💬 Customer message appended', { ref: ticket.ref, reopened: wasClosed });
  return ticket;
}

/** Send the configured auto-reply to the customer, and record it as a SYSTEM reply (not "Agent"). */
async function sendAutoReply(workspace, ticket) {
  const payload = buildSendPayload(ticket, workspace.autoReplyMessage);
  if (!payload) return;
  const res = await ghlService.sendMessage(workspace.locationId, payload);
  const ghlMessageId = res?.messageId || res?.id || null;
  // Record it ourselves as a system message. Storing the ghlMessageId means the OutboundMessage
  // webhook that echoes this send will dedup against it (not re-record it as an "Agent" reply).
  await Comment.create({
    locationId: workspace.locationId,
    ticketId: ticket._id,
    kind: 'reply',
    body: workspace.autoReplyMessage,
    authorType: 'system',
    authorId: null,
    authorName: 'Auto-reply',
    channel: ticket.channel,
    ghlMessageId
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
 * Build the GHL send-message payload for a ticket reply.
 *
 * CRITICAL (verified live): when a ticket came in through a CUSTOM conversation provider, GHL
 * requires the outbound `type` to be 'Custom' WITH the conversationProviderId — sending the
 * underlying channel type (e.g. 'SMS') fails with CONVERSATION_PROVIDER_MISMATCH. So if the ticket
 * carries a conversationProviderId, we send type:'Custom' + that providerId. Otherwise we map the
 * channel to its native send type. Returns null if the channel can't be replied on (Call/portal).
 */
function buildSendPayload(ticket, message, { html, subject } = {}) {
  if (!ticket.contactId) return null;

  if (ticket.conversationProviderId) {
    return {
      type: 'Custom',
      contactId: ticket.contactId,
      conversationProviderId: ticket.conversationProviderId,
      message
    };
  }

  const type = mapChannelToSendType(ticket.channel);
  if (!type) return null;
  const payload = { type, contactId: ticket.contactId, message };
  if (type === 'Email') {
    payload.subject = subject || `Re: ${ticket.subject}`;
    // Escape the message before wrapping in HTML (prevents broken markup / injection from the agent's
    // text) and preserve line breaks. A caller-supplied `html` is trusted and used as-is.
    const escaped = String(message)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\r\n|\r|\n/g, '<br>');
    payload.html = html || `<p>${escaped}</p>`;
  }
  return payload;
}

/**
 * Can an agent send an outbound reply on this ticket's channel? False for receive-only sources
 * (Call, portal) or a ticket with no contact. The UI uses this to disable the Reply tab and steer
 * the agent to an internal note instead.
 */
function canReplyOnChannel(ticket) {
  if (!ticket.contactId) return false;
  if (ticket.conversationProviderId) return true; // custom provider → type:Custom works
  return !!mapChannelToSendType(ticket.channel);
}

/**
 * Agent replies to the customer. Sends through GHL on the original channel, stamps first-response,
 * stops the first-response SLA clock, and moves a new ticket to 'open'.
 */
async function replyToCustomer(workspace, ticket, { body, agent, html, subject }) {
  const payload = buildSendPayload(ticket, body, { html, subject });
  if (!payload) {
    // No outbound text channel for this ticket (e.g. Call, portal, or missing contact). Do NOT
    // fake-record a reply that never went out — surface a clear error so the UI can steer the
    // agent to an internal note instead.
    const err = new Error(`Can't send a reply on this ticket's channel (${ticket.channel || 'unknown'}). Use an internal note, or reply via your CRM.`);
    err.status = 422;
    err.code = 'CHANNEL_NOT_REPLYABLE';
    throw err;
  }

  let ghlMessageId = null;
  const res = await ghlService.sendMessage(workspace.locationId, payload);
  ghlMessageId = res?.messageId || res?.id || null;

  const authorName = await agentNameFor(ticket.locationId, agent?.id, agent?.name);
  await Comment.create({
    locationId: ticket.locationId,
    ticketId: ticket._id,
    kind: 'reply',
    body,
    authorType: 'agent',
    authorId: agent?.id,
    authorName,
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
  const authorName = await agentNameFor(ticket.locationId, agent?.id, agent?.name);
  await Comment.create({
    locationId: ticket.locationId,
    ticketId: ticket._id,
    kind: 'note',
    body,
    authorType: 'agent',
    authorId: agent?.id,
    authorName,
    mentions
  });
  ticket.lastActivityAt = new Date();
  await recordEvent(ticket, 'note_added', { actorType: 'agent', actorId: agent?.id, actorName: authorName, meta: { mentions } });
  await ticket.save();
  return ticket;
}

/**
 * Recompute the `breached` flag from the ticket's CURRENT due dates, instead of blindly clearing it.
 * A breach is still active if a due date is already in the past (first-response due passed and no reply
 * yet, OR resolve due passed). This prevents flapping: clearing breached while a due date is still in
 * the past would let the SLA monitor re-flag the ticket on its next pass and re-fire the escalation
 * trigger. Call AFTER any due-date change (reopen credit, priority recompute, reopen restart).
 */
function recomputeBreached(ticket, at = new Date()) {
  const now = at.getTime();
  const firstBreached = !ticket.firstResponseAt && ticket.slaFirstResponseDueAt && new Date(ticket.slaFirstResponseDueAt).getTime() < now;
  const resolveBreached = ticket.slaResolveDueAt && new Date(ticket.slaResolveDueAt).getTime() < now;
  ticket.breached = !!(firstBreached || resolveBreached);
}

/** Push both SLA due dates forward by `ms` (used to credit back time a ticket spent paused). */
function extendSlaDue(ticket, ms) {
  if (!ms || ms <= 0) return;
  if (ticket.slaFirstResponseDueAt && !ticket.firstResponseAt) {
    ticket.slaFirstResponseDueAt = new Date(ticket.slaFirstResponseDueAt.getTime() + ms);
  }
  if (ticket.slaResolveDueAt) {
    ticket.slaResolveDueAt = new Date(ticket.slaResolveDueAt.getTime() + ms);
  }
}

/** Change status with lifecycle side-effects (resolve stamps, reopen events, pause/resume SLA). */
async function changeStatus(ticket, newStatus, { agent } = {}) {
  const from = ticket.status;
  if (from === newStatus) return ticket;

  const OPEN = Ticket.OPEN_STATUSES;
  const wasOpen = OPEN.includes(from);
  const nowOpen = OPEN.includes(newStatus);
  const wasResolvedOrClosed = from === 'resolved' || from === 'closed';
  const now = new Date();

  // Resuming from a pause: credit the paused time back onto the due dates so the clock effectively
  // paused (rather than running in the background). Fixes false breaches right after the customer replies.
  if (ticket.slaPaused && ticket.slaPausedAt && (newStatus === 'open' || newStatus === 'new')) {
    extendSlaDue(ticket, now.getTime() - new Date(ticket.slaPausedAt).getTime());
  }

  ticket.status = newStatus;

  if (newStatus === 'resolved') {
    ticket.resolvedAt = now;
    ticket.slaPaused = true;
    ticket.slaPausedAt = ticket.slaPausedAt || now;
  } else if (newStatus === 'closed') {
    ticket.closedAt = now;
    ticket.slaPaused = true;
    ticket.slaPausedAt = ticket.slaPausedAt || now;
  } else if (newStatus === 'pending' || newStatus === 'on_hold') {
    ticket.slaPaused = true; // waiting — start (or keep) the pause clock
    ticket.slaPausedAt = ticket.slaPausedAt || now;
  } else if (newStatus === 'open' || newStatus === 'new') {
    ticket.slaPaused = false;
    ticket.slaPausedAt = null;
    // Recompute the breach flag against the (credited) due dates rather than blindly clearing it.
    // Clearing it while a due date is still in the past would make the SLA monitor re-flag the ticket
    // and re-fire the escalation trigger on its next pass (flapping) — and briefly miscount it as in-SLA.
    recomputeBreached(ticket, now);
    if (wasResolvedOrClosed) {
      ticket.resolvedAt = null;
      ticket.closedAt = null;
      await recordEvent(ticket, 'reopened', { actorType: agent ? 'agent' : 'system', actorId: agent?.id });
    }
  }

  // Keep the denormalized agent load in sync: a ticket leaving the open set should decrement its
  // assignee's count; coming back into the open set should increment it again.
  if (ticket.assigneeId) {
    if (wasOpen && !nowOpen) await bumpAgentLoad(ticket.locationId, ticket.assigneeId, -1);
    else if (!wasOpen && nowOpen) await bumpAgentLoad(ticket.locationId, ticket.assigneeId, +1);
  }

  ticket.lastActivityAt = now;
  await recordEvent(ticket, 'status_changed', { actorType: agent ? 'agent' : 'system', actorId: agent?.id, actorName: agent?.name, meta: { from, to: newStatus } });
  await ticket.save();
  safeFire(TRIGGERS.STATUS_CHANGED, ticket, { previousStatus: from, newStatus }); // workflow trigger
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
  if (assigneeId) safeFire(TRIGGERS.TICKET_ASSIGNED, ticket); // workflow trigger: (re)assigned to an agent
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
  // Recompute breach against the NEW due dates. If the new (e.g. de-escalated) targets are still in the
  // past the ticket stays breached; if the new targets are now in the future it clears. Recomputing
  // (vs. blindly clearing) stops the SLA monitor from re-flagging + re-firing the escalation trigger.
  recomputeBreached(ticket);
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
  shouldAccept,
  canReplyOnChannel,
  bumpAgentLoad
};
