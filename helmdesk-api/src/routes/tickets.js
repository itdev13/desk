const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const Ticket = require('../models/Ticket');
const Comment = require('../models/Comment');
const TicketEvent = require('../models/TicketEvent');
const Workspace = require('../models/Workspace');
const Agent = require('../models/Agent');
const ticketService = require('../services/ticketService');
const logger = require('../utils/logger');

router.use(requireAuth);

/** Shared helper: load a ticket scoped to the caller's workspace, or 404. */
async function loadTicket(req, res) {
  const ticket = await Ticket.findOne({ _id: req.params.id, locationId: req.auth.locationId });
  if (!ticket) {
    res.status(404).json({ success: false, error: 'Ticket not found' });
    return null;
  }
  return ticket;
}

/** The current agent context for audit attribution. */
function actor(req) {
  return { id: req.auth.userId, name: req.auth.name };
}

/**
 * GET /api/tickets
 * Filterable, paginated queue. Query: view (mine|unassigned|open|overdue|all), status, priority,
 * assigneeId, q (subject/contact search), page, limit.
 */
router.get('/', async (req, res) => {
  try {
    const { locationId } = req.auth;
    const { view, status, priority, assigneeId, q } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

    const query = { locationId };

    if (view === 'mine') query.assigneeId = req.auth.userId;
    else if (view === 'unassigned') query.assigneeId = null;
    else if (view === 'open') query.status = { $in: Ticket.OPEN_STATUSES };
    else if (view === 'overdue') {
      query.status = { $in: Ticket.OPEN_STATUSES };
      query.breached = true;
    }

    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (assigneeId) query.assigneeId = assigneeId === 'none' ? null : assigneeId;
    if (q) {
      query.$or = [
        { subject: { $regex: q, $options: 'i' } },
        { contactName: { $regex: q, $options: 'i' } },
        { ref: { $regex: q, $options: 'i' } }
      ];
    }

    const [tickets, total] = await Promise.all([
      Ticket.find(query).sort({ lastActivityAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Ticket.countDocuments(query)
    ]);

    res.json({ success: true, tickets, total, page, limit });
  } catch (error) {
    logger.error('list tickets failed', { message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tickets/board
 * Kanban grouping — returns tickets bucketed by status column for the board view.
 */
router.get('/board', async (req, res) => {
  try {
    const { locationId } = req.auth;
    const columns = ['new', 'open', 'pending', 'resolved'];
    const result = {};
    await Promise.all(
      columns.map(async (status) => {
        result[status] = await Ticket.find({ locationId, status })
          .sort({ lastActivityAt: -1 })
          .limit(50)
          .lean();
      })
    );
    res.json({ success: true, columns, board: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/tickets/:id — full ticket with its comment thread and event log. */
router.get('/:id', async (req, res) => {
  const ticket = await loadTicket(req, res);
  if (!ticket) return;
  const [comments, events, assignee] = await Promise.all([
    Comment.find({ ticketId: ticket._id }).sort({ createdAt: 1 }).lean(),
    TicketEvent.find({ ticketId: ticket._id }).sort({ createdAt: 1 }).lean(),
    ticket.assigneeId
      ? Agent.findOne({ locationId: req.auth.locationId, ghlUserId: ticket.assigneeId }).lean()
      : null
  ]);
  // Flag when the assigned agent was deleted in the CRM so the UI can prompt a reassignment.
  const assigneeDeleted = !!(ticket.assigneeId && assignee?.deleted);
  res.json({ success: true, ticket, comments, events, assigneeDeleted });
});

/** POST /api/tickets — manual ticket creation by an agent. */
router.post('/', async (req, res) => {
  try {
    const workspace = await Workspace.findOne({ locationId: req.auth.locationId });
    if (!workspace) return res.status(400).json({ success: false, error: 'Workspace not configured' });

    const { subject, contactId, contactName, contactEmail, channel, priority, firstMessage } = req.body;
    const ticket = await ticketService.createTicket(workspace, {
      subject: subject || ticketServiceSubject(firstMessage),
      contactId: contactId || null,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      channel: channel || null,
      source: 'manual',
      firstMessage: firstMessage || null,
      createdByAgent: actor(req)
    });
    if (priority && priority !== ticket.priority) {
      await ticketService.changePriority(workspace, ticket, priority, { agent: actor(req) });
    }
    res.json({ success: true, ticket });
  } catch (error) {
    logger.error('create ticket failed', { message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

function ticketServiceSubject(body) {
  if (!body) return '(no subject)';
  return body.length > 80 ? `${body.slice(0, 77)}…` : body;
}

/** POST /api/tickets/:id/reply — agent reply sent to the customer via GHL. */
router.post('/:id/reply', async (req, res) => {
  const ticket = await loadTicket(req, res);
  if (!ticket) return;
  try {
    const workspace = await Workspace.findOne({ locationId: req.auth.locationId });
    const { body, html, subject } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ success: false, error: 'Reply body required' });
    const updated = await ticketService.replyToCustomer(workspace, ticket, { body, html, subject, agent: actor(req) });
    res.json({ success: true, ticket: updated });
  } catch (error) {
    logger.error('reply failed', { message: error.message });
    res.status(500).json({ success: false, error: `Failed to send reply: ${error.message}` });
  }
});

/** POST /api/tickets/:id/note — internal note with optional @mentions. */
router.post('/:id/note', async (req, res) => {
  const ticket = await loadTicket(req, res);
  if (!ticket) return;
  const { body, mentions } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ success: false, error: 'Note body required' });
  const updated = await ticketService.addNote(ticket, { body, mentions: mentions || [], agent: actor(req) });
  res.json({ success: true, ticket: updated });
});

/** PATCH /api/tickets/:id/status */
router.patch('/:id/status', async (req, res) => {
  const ticket = await loadTicket(req, res);
  if (!ticket) return;
  const { status } = req.body;
  if (!Ticket.STATUSES.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
  const updated = await ticketService.changeStatus(ticket, status, { agent: actor(req) });
  res.json({ success: true, ticket: updated });
});

/** PATCH /api/tickets/:id/assign */
router.patch('/:id/assign', async (req, res) => {
  const ticket = await loadTicket(req, res);
  if (!ticket) return;
  const { assigneeId } = req.body;
  let assigneeName = null;
  if (assigneeId) {
    const agent = await Agent.findOne({ locationId: req.auth.locationId, ghlUserId: assigneeId });
    assigneeName = agent?.name || null;
  }
  const updated = await ticketService.assign(ticket, { assigneeId: assigneeId || null, assigneeName, agent: actor(req) });
  res.json({ success: true, ticket: updated });
});

/** PATCH /api/tickets/:id/priority */
router.patch('/:id/priority', async (req, res) => {
  const ticket = await loadTicket(req, res);
  if (!ticket) return;
  const { priority } = req.body;
  if (!Ticket.PRIORITIES.includes(priority)) return res.status(400).json({ success: false, error: 'Invalid priority' });
  const workspace = await Workspace.findOne({ locationId: req.auth.locationId });
  const updated = await ticketService.changePriority(workspace, ticket, priority, { agent: actor(req) });
  res.json({ success: true, ticket: updated });
});

module.exports = router;
