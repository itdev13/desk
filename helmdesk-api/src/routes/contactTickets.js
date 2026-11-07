const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Ticket = require('../models/Ticket');
const Comment = require('../models/Comment');
const Workspace = require('../models/Workspace');
const OAuthToken = require('../models/OAuthToken');
const Agent = require('../models/Agent');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Render the ticket list to self-contained HTML (inline styles so the custom JS needs no CSS of its
 * own). The SERVER owns this markup — the agency's form is fully customizable, so any field type the
 * builder ever supports renders here by iterating `customFields` as plain label/value pairs; the
 * contact-page script never has to change.
 */
const STATUSES = ['new', 'open', 'pending', 'on_hold', 'resolved', 'closed'];
const STATUS_LABELS = { new: 'New', open: 'Open', pending: 'Waiting', on_hold: 'On hold', resolved: 'Resolved', closed: 'Closed' };

// One read-only "form field": a label above a filled, non-editable value box — looks like the form.
function roField(label, value) {
  if (value == null || String(value).trim() === '') return '';
  const multiline = String(value).length > 60 || String(value).indexOf('\n') > -1;
  return `<div style="margin-bottom:14px">
    <div style="font-size:12px;font-weight:600;color:#475467;margin-bottom:5px">${esc(label)}</div>
    <div style="font-size:14px;color:#101828;background:#f9fafb;border:1px solid #e9ecf2;border-radius:9px;
      padding:${multiline ? '11px 13px' : '10px 13px'};white-space:pre-wrap;word-break:break-word;line-height:1.5">${esc(value)}</div>
  </div>`;
}

// Assignee <option> list: "Unassigned" + each active agent shown as "Name (email)". `selectedId`
// marks the current assignee (null → Unassigned selected). Deleted agents are excluded from the list,
// but if the ticket is still assigned to a now-deleted user we keep that option so it shows correctly.
function assigneeOptions(agents, selectedId, selectedName) {
  const e = esc;
  let opts = `<option value=""${!selectedId ? ' selected' : ''}>Unassigned</option>`;
  const seen = {};
  (agents || []).forEach((a) => {
    seen[a.ghlUserId] = true;
    const label = a.email ? `${a.name || 'Agent'} (${a.email})` : (a.name || 'Agent');
    opts += `<option value="${e(a.ghlUserId)}"${a.ghlUserId === selectedId ? ' selected' : ''}>${e(label)}</option>`;
  });
  if (selectedId && !seen[selectedId]) {
    opts += `<option value="${e(selectedId)}" selected>${e(selectedName || 'Assigned agent')} (removed)</option>`;
  }
  return opts;
}

// The "New ticket" action bar + the (hidden) create form. The custom JS toggles the form and wires
// the submit to POST /api/contact-tickets/create. Rendered server-side so the script stays dumb.
function renderCreateUi({ accent, agents }) {
  const prOpts = ['normal', 'low', 'high', 'urgent']
    .map((p) => `<option value="${p}"${p === 'normal' ? ' selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('');
  const asOpts = assigneeOptions(agents, null, null);
  return `<div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:14px">
      <button type="button" class="hd-new-btn"
        style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:#fff;background:${accent};border:1px solid ${accent};border-radius:9px;padding:8px 14px;cursor:pointer">
        + New ticket
      </button>
    </div>
    <form class="hd-new-form" style="display:none;border:1px solid #e9ecf2;border-radius:16px;padding:18px;margin-bottom:16px;background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.05)">
      <div style="font-size:14px;font-weight:700;color:#101828;margin-bottom:14px">New ticket</div>
      <div style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:600;color:#475467;margin-bottom:5px">Subject</div>
        <input class="hd-f-subject" type="text" required placeholder="Brief summary"
          style="width:100%;box-sizing:border-box;font-size:14px;color:#101828;background:#fff;border:1px solid #d0d5dd;border-radius:9px;padding:10px 13px;outline:none"/>
      </div>
      <div style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:600;color:#475467;margin-bottom:5px">Message</div>
        <textarea class="hd-f-message" rows="4" placeholder="What does the customer need?"
          style="width:100%;box-sizing:border-box;font-size:14px;color:#101828;background:#fff;border:1px solid #d0d5dd;border-radius:9px;padding:10px 13px;outline:none;resize:vertical;font-family:inherit"></textarea>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <div style="flex:1;min-width:140px">
          <div style="font-size:12px;font-weight:600;color:#475467;margin-bottom:5px">Priority</div>
          <select class="hd-f-priority" style="width:100%;box-sizing:border-box;font-size:14px;color:#101828;background:#fff;border:1px solid #d0d5dd;border-radius:9px;padding:10px 13px;outline:none;cursor:pointer;appearance:auto">${prOpts}</select>
        </div>
        <div style="flex:2;min-width:180px">
          <div style="font-size:12px;font-weight:600;color:#475467;margin-bottom:5px">Assignee</div>
          <select class="hd-f-assignee" style="width:100%;box-sizing:border-box;font-size:14px;color:#101828;background:#fff;border:1px solid #d0d5dd;border-radius:9px;padding:10px 13px;outline:none;cursor:pointer;appearance:auto">${asOpts}</select>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px">
        <button type="button" class="hd-new-cancel"
          style="font-size:12.5px;font-weight:600;color:#475467;background:#f7f8fa;border:1px solid #e4e7ec;border-radius:9px;padding:8px 14px;cursor:pointer">Cancel</button>
        <button type="submit" class="hd-new-submit"
          style="font-size:12.5px;font-weight:600;color:#fff;background:${accent};border:1px solid ${accent};border-radius:9px;padding:8px 16px;cursor:pointer">Create ticket</button>
      </div>
    </form>`;
}

function renderTicketsHtml({ brandName, accent, contact, tickets, timeZone, agents }) {
  const e = esc;
  const createUi = renderCreateUi({ accent, agents });
  if (!tickets.length) {
    return createUi + `<div style="text-align:center;color:#8a94a6;padding:32px 16px">
      <div style="font-size:34px;margin-bottom:8px">🎫</div>
      <div style="font-size:14px;font-weight:600;color:#475467">No tickets yet</div>
      <div style="font-size:12.5px;margin-top:2px">Create the first ticket for ${e(contact?.name || 'this contact')} above.</div>
    </div>`;
  }
  return createUi + tickets.map((t) => {
    const isPortal = t.source === 'portal';
    const origin = isPortal ? `Form · ${e(t.formName || 'Support form')}` : e(t.channel || t.source || '');
    // Render in the LOCATION's timezone, not the server's. This HTML is built server-side, so a bare
    // toLocaleString would use whatever zone the deployed box runs in (usually UTC). We pass the GHL
    // location's own timezone so the whole support team sees consistent, correct local times.
    const dateOpts = { dateStyle: 'medium', timeStyle: 'short' };
    if (timeZone) dateOpts.timeZone = timeZone;
    // Tooltip uses explicit COMPONENTS, not dateStyle/timeStyle — those cannot be combined with
    // timeZoneName (doing so throws TypeError and silently drops us to the UTC catch below).
    const fullOpts = { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
    if (timeZone) fullOpts.timeZone = timeZone;
    let when = '';
    let whenFull = ''; // hover tooltip: full date + time + timezone, so the zone is never ambiguous
    if (t.createdAt) {
      const d = new Date(t.createdAt);
      try {
        when = d.toLocaleString('en-US', dateOpts);
        // e.g. "Nov 6, 2026, 12:00 PM PST (America/Tijuana)"
        const withZone = d.toLocaleString('en-US', fullOpts);
        whenFull = timeZone ? `${withZone} (${timeZone})` : withZone;
      } catch {
        when = d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); // bad tz → server zone
        whenFull = d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      }
    }

    // Strip the trailing "— Form details —" block from the message (it duplicates the fields below).
    const message = String(t.firstMessage || '').replace(/\n*—\s*Form details\s*—[\s\S]*$/i, '').trim();

    // Render the submission exactly like the form: core fields (what the form collects) then every
    // custom answer, each as a read-only labeled field. All read-only — only the status is editable.
    const cf = (Array.isArray(t.customFields) ? t.customFields : [])
      .filter((f) => f && f.value != null && String(f.value).trim() !== '');
    const formFields = [
      roField('Name', t.contactName),
      roField('Email', t.contactEmail),
      roField('Subject', t.subject),
      roField('Message', message),
      roField('Priority', (t.priority || '').charAt(0).toUpperCase() + (t.priority || '').slice(1)),
      ...cf.map((f) => roField(f.label, f.value))
    ].filter(Boolean).join('');

    // Editable status dropdown. Wired by the script via data-ticket.
    const statusOpts = STATUSES.map((s) =>
      `<option value="${s}"${s === t.status ? ' selected' : ''}>${e(STATUS_LABELS[s] || s)}</option>`).join('');
    // Editable assignee dropdown — shows the current owner (or Unassigned) and lets the agent reassign.
    const asgOpts = assigneeOptions(agents, t.assigneeId || null, t.assigneeName || null);

    return `<div style="border:1px solid #e9ecf2;border-radius:16px;padding:18px;margin-bottom:14px;background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.05)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <span style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;font-weight:600;color:#98a2b3;background:#f4f5f8;padding:2px 7px;border-radius:5px">${e(t.ref || '')}</span>
          <span style="margin-left:auto;font-size:11.5px;color:#8a94a6">${origin}${when ? ' · <span title="' + e(whenFull) + '" style="cursor:help;border-bottom:1px dotted #cbd2dd">' + e(when) + '</span>' : ''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <h4 style="margin:0;font-size:17px;font-weight:700;color:#101828;letter-spacing:-.01em;flex:1;min-width:0">${e(t.subject || '(no subject)')}</h4>
          <select class="hd-status" data-ticket="${e(t._id)}" data-prev="${e(t.status || '')}"
            style="flex:none;font-size:12.5px;font-weight:600;color:#101828;border:1px solid #d0d5dd;border-radius:8px;padding:7px 10px;background:#fff;cursor:pointer;outline:none;appearance:auto">
            ${statusOpts}
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <span style="font-size:12px;font-weight:600;color:#475467;flex:none">Assignee</span>
          <select class="hd-assignee" data-ticket="${e(t._id)}" data-prev="${e(t.assigneeId || '')}"
            style="flex:1;min-width:0;font-size:12.5px;color:#101828;border:1px solid #d0d5dd;border-radius:8px;padding:7px 10px;background:#fff;cursor:pointer;outline:none;appearance:auto">
            ${asgOpts}
          </select>
        </div>
        ${formFields || '<div style="color:#8a94a6;font-size:13px">No fields captured.</div>'}
        <div style="display:flex;justify-content:flex-end;margin-top:14px">
          <button type="button" class="hd-open" data-open-ticket="${e(t._id)}"
            style="display:none;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:#1d4ed8;background:#eff4ff;border:1px solid #c7d7fe;border-radius:9px;padding:8px 14px;cursor:pointer;transition:background .12s,border-color .12s,color .12s"
            onmouseover="this.style.background='#1d4ed8';this.style.borderColor='#1d4ed8';this.style.color='#fff'"
            onmouseout="this.style.background='#eff4ff';this.style.borderColor='#c7d7fe';this.style.color='#1d4ed8'">
            Open full ticket →
          </button>
        </div>
      </div>`;
  }).join('');
}
const ghlService = require('../services/ghlService');
const logger = require('../utils/logger');

/**
 * Public-ish endpoint for the GHL contact-detail page script.
 *
 * The custom-menu JavaScript runs on app.gohighlevel.com (NOT inside our app iframe), so it has no
 * session JWT. Instead of a shared key, we VERIFY OWNERSHIP against GHL: we fetch the contact using
 * THIS location's OAuth token. The token is location-scoped, so a contact that doesn't belong to the
 * location returns 404 from GHL → we reject. This means a caller can only read tickets for a contact
 * that genuinely lives in a location HelpDesk is installed on (which the agent is already viewing).
 *
 * Rate-limited per IP as a second guard.
 *
 * GET /api/contact-tickets?locationId=...&contactId=...
 *   → { success, contact, tickets: [{ ref, subject, status, priority, source, formName, customFields,
 *        createdAt, firstMessage }] }
 */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please wait a moment.' }
});

// Never cache these responses. Without this, Express sets an ETag on res.json(); the browser then
// sends If-None-Match and gets a 304 Not Modified, serving the STALE cached body — so status changes
// and server-side re-renders (timezone, button, etc.) never reach the modal. Force fresh every time.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  // Drop the conditional-request header so Express's res.json() never computes a 304 Not Modified.
  // Without this the browser sends If-None-Match, matches the ETag of a stale body, and gets a 304 —
  // serving the OLD cached modal (wrong timezone, old button) and skipping our render entirely.
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  next();
});

router.get('/', limiter, async (req, res) => {
  const locationId = String(req.query.locationId || '').trim();
  const contactId = String(req.query.contactId || '').trim();
  if (!locationId || !contactId) {
    return res.status(400).json({ success: false, error: 'locationId and contactId are required.' });
  }

  try {
    // OWNERSHIP CHECK — fetch the contact with this location's token. Throws if the location isn't
    // connected or the contact isn't in it. We use the raw apiRequest (getContact swallows errors).
    let contact;
    try {
      const raw = await ghlService.apiRequest('GET', `/contacts/${encodeURIComponent(contactId)}`, locationId);
      const c = raw.contact || raw;
      if (!c || !(c.id || c._id)) throw new Error('not found');
      contact = {
        id: c.id || c._id,
        name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || 'Contact',
        email: c.email || null,
        phone: c.phone || null
      };
    } catch (e) {
      logger.info('[contact-tickets] ownership check failed', { locationId, contactId, message: e.message });
      return res.status(403).json({ success: false, error: 'Not authorized for this contact.' });
    }

    // Fetch this contact's tickets (newest first), excluding deleted. Archived are included so the
    // agent sees the full history for the contact.
    const tickets = await Ticket.find({ locationId, contactId, deleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('ref subject status priority channel source formName customFields contactName contactEmail createdAt lastActivityAt')
      .lean();

    // Pull the opening message of each ticket so the modal can show what the contact actually wrote.
    const withOpening = await Promise.all(
      tickets.map(async (t) => {
        const first = await Comment.findOne({ ticketId: t._id, kind: 'customer' })
          .sort({ createdAt: 1 })
          .select('body')
          .lean();
        return { ...t, firstMessage: first?.body || null };
      })
    );

    // Brand name so the modal is white-labeled (shows the agency's name, never "HelpDesk").
    const ws = await Workspace.findOne({ locationId }).select('brand.name brand.primaryColor').lean();
    const brandName = ws?.brand?.name || 'Support';
    const accent = ws?.brand?.primaryColor || '#E0A24A';

    // The GHL location's timezone (fetched at install, stored on the token) so dates render in the
    // location's zone instead of the server's. Older installs predate this field — if it's missing,
    // lazily fetch it from GHL once and persist it, so the fallback-to-UTC only ever happens once.
    const tok = await OAuthToken.findOne({ locationId }).select('locationTimezone').lean();
    let timeZone = tok?.locationTimezone || null;
    logger.info('[contact-tickets][TZ] stored timezone on token', { locationId, stored: timeZone });
    if (!timeZone) {
      try {
        const details = await ghlService.getLocationDetails(locationId);
        logger.info('[contact-tickets][TZ] getLocationDetails result', { locationId, details });
        if (details.locationTimezone) {
          timeZone = details.locationTimezone;
          await OAuthToken.updateOne({ locationId }, { $set: { locationTimezone: timeZone } });
          logger.info('[contact-tickets][TZ] backfilled + saved timezone', { locationId, timeZone });
        } else {
          logger.warn('[contact-tickets][TZ] GHL returned NO timezone for location', { locationId });
        }
      } catch (e) {
        logger.warn('[contact-tickets][TZ] getLocationDetails FAILED', { locationId, status: e.response?.status, message: e.message });
      }
    }
    logger.info('[contact-tickets][TZ] final timezone used for render', { locationId, timeZone: timeZone || '(none → UTC/server)' });

    // Assignable agents (active, not deleted) so the modal can show/change the owner of each ticket
    // and set one on a new ticket. Shown as "Name (email)".
    const agents = await Agent.find({ locationId, deleted: { $ne: true }, active: { $ne: false } })
      .select('ghlUserId name email')
      .sort({ name: 1 })
      .lean();

    // Render the whole ticket list to HTML HERE, server-side. The custom JS just injects it — so any
    // future form field type (date, file, number, …) renders correctly without touching the script.
    const html = renderTicketsHtml({ brandName, accent, contact, tickets: withOpening, timeZone, agents });

    res.json({ success: true, brandName, accent, contact, tickets: withOpening, html });
  } catch (error) {
    logger.error('[contact-tickets] failed', { message: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Could not load tickets.', detail: error.message });
  }
});

/**
 * POST /api/contact-tickets/status  — update one ticket's status from the contact-page modal.
 * Body: { locationId, contactId, ticketId, status }. Same GHL ownership check as the GET. Status is
 * the ONLY thing this endpoint can change (everything else in the modal is read-only).
 */
router.post('/status', limiter, async (req, res) => {
  const locationId = String(req.body.locationId || '').trim();
  const contactId = String(req.body.contactId || '').trim();
  const ticketId = String(req.body.ticketId || '').trim();
  const status = String(req.body.status || '').trim();
  if (!locationId || !contactId || !ticketId) return res.status(400).json({ success: false, error: 'Missing fields.' });
  if (!STATUSES.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status.' });

  try {
    // Ownership: the contact must belong to this location (same gate as GET).
    try {
      const raw = await ghlService.apiRequest('GET', `/contacts/${encodeURIComponent(contactId)}`, locationId);
      const c = raw.contact || raw;
      if (!c || !(c.id || c._id)) throw new Error('not found');
    } catch (e) {
      return res.status(403).json({ success: false, error: 'Not authorized for this contact.' });
    }

    // The ticket must belong to this location AND this contact (can't touch others').
    const ticket = await Ticket.findOne({ _id: ticketId, locationId, contactId, deleted: { $ne: true } });
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found.' });

    const ticketService = require('../services/ticketService');
    await ticketService.changeStatus(ticket, status);
    res.json({ success: true, status: ticket.status });
  } catch (error) {
    logger.error('[contact-tickets] status update failed', { message: error.message });
    res.status(500).json({ success: false, error: 'Could not update status.' });
  }
});

/**
 * POST /api/contact-tickets/create — create a NEW ticket for this contact straight from the contact
 * page ("New ticket" in the modal). Same GHL ownership gate as the GET: the contact must belong to
 * this location, verified with the location's own OAuth token (no app session on this page).
 * Body: { locationId, contactId, subject, message, priority? }.
 */
const CREATE_PRIORITIES = ['urgent', 'high', 'normal', 'low'];
router.post('/create', limiter, async (req, res) => {
  const locationId = String(req.body.locationId || '').trim();
  const contactId = String(req.body.contactId || '').trim();
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();
  const priority = CREATE_PRIORITIES.includes(String(req.body.priority).toLowerCase())
    ? String(req.body.priority).toLowerCase() : 'normal';
  if (!locationId || !contactId) return res.status(400).json({ success: false, error: 'Missing fields.' });
  if (!subject) return res.status(400).json({ success: false, error: 'Subject is required.' });

  try {
    // Ownership gate — fetch the contact with this location's token; also gives us the name/email to
    // stamp on the ticket so the new record is properly linked to the contact.
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
      return res.status(403).json({ success: false, error: 'Not authorized for this contact.' });
    }

    const workspace = await Workspace.findOne({ locationId });
    if (!workspace) return res.status(404).json({ success: false, error: 'Workspace not found.' });

    const ticketService = require('../services/ticketService');
    const ticket = await ticketService.createTicket(workspace, {
      subject,
      contactId: contact.id,
      contactName: contact.name,
      contactEmail: contact.email,
      source: 'manual',          // created by a team member, not an inbound channel
      channel: 'Internal',
      priority,
      firstMessage: message || null
    });

    // If the agent picked an assignee in the form, apply it (createTicket's own routing may have left
    // it unassigned). Validate the agent belongs to this location so a crafted id can't be injected.
    const assigneeId = String(req.body.assigneeId || '').trim();
    if (assigneeId) {
      const agent = await Agent.findOne({ locationId, ghlUserId: assigneeId, deleted: { $ne: true } }).lean();
      if (agent) await ticketService.assign(ticket, { assigneeId: agent.ghlUserId, assigneeName: agent.name || null });
    }

    res.json({ success: true, ticketId: String(ticket._id), ref: ticket.ref });
  } catch (error) {
    logger.error('[contact-tickets] create failed', { message: error.message });
    res.status(500).json({ success: false, error: 'Could not create ticket.' });
  }
});

/**
 * POST /api/contact-tickets/assignee — change who a ticket is assigned to, from the contact modal.
 * Body: { locationId, contactId, ticketId, assigneeId }. Empty assigneeId → Unassigned. Same ownership
 * gate as the others; the agent (if any) must belong to this location.
 */
router.post('/assignee', limiter, async (req, res) => {
  const locationId = String(req.body.locationId || '').trim();
  const contactId = String(req.body.contactId || '').trim();
  const ticketId = String(req.body.ticketId || '').trim();
  const assigneeId = String(req.body.assigneeId || '').trim(); // '' → unassign
  if (!locationId || !contactId || !ticketId) return res.status(400).json({ success: false, error: 'Missing fields.' });

  try {
    // Ownership: the contact must belong to this location.
    try {
      const raw = await ghlService.apiRequest('GET', `/contacts/${encodeURIComponent(contactId)}`, locationId);
      const c = raw.contact || raw;
      if (!c || !(c.id || c._id)) throw new Error('not found');
    } catch (e) {
      return res.status(403).json({ success: false, error: 'Not authorized for this contact.' });
    }

    const ticket = await Ticket.findOne({ _id: ticketId, locationId, contactId, deleted: { $ne: true } });
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found.' });

    let assigneeName = null;
    if (assigneeId) {
      const agent = await Agent.findOne({ locationId, ghlUserId: assigneeId, deleted: { $ne: true } }).lean();
      if (!agent) return res.status(400).json({ success: false, error: 'Unknown agent.' });
      assigneeName = agent.name || null;
    }

    const ticketService = require('../services/ticketService');
    await ticketService.assign(ticket, { assigneeId: assigneeId || null, assigneeName });
    res.json({ success: true, assigneeId: assigneeId || null, assigneeName });
  } catch (error) {
    logger.error('[contact-tickets] assignee update failed', { message: error.message });
    res.status(500).json({ success: false, error: 'Could not update assignee.' });
  }
});

module.exports = router;
