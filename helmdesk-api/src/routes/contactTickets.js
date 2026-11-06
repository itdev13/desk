const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Ticket = require('../models/Ticket');
const Comment = require('../models/Comment');
const Workspace = require('../models/Workspace');

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

function renderTicketsHtml({ brandName, accent, contact, tickets }) {
  const e = esc;
  if (!tickets.length) {
    return `<div style="text-align:center;color:#8a94a6;padding:40px 16px">
      <div style="font-size:34px;margin-bottom:8px">🎫</div>
      <div style="font-size:14px;font-weight:600;color:#475467">No tickets yet</div>
      <div style="font-size:12.5px;margin-top:2px">${e(contact?.name || 'This contact')} hasn’t submitted anything yet.</div>
    </div>`;
  }
  return tickets.map((t) => {
    const isPortal = t.source === 'portal';
    const origin = isPortal ? `Form · ${e(t.formName || 'Support form')}` : e(t.channel || t.source || '');
    const when = t.createdAt ? new Date(t.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

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

    // Editable status dropdown (only editable control). Wired by the script via data-ticket.
    const statusOpts = STATUSES.map((s) =>
      `<option value="${s}"${s === t.status ? ' selected' : ''}>${e(STATUS_LABELS[s] || s)}</option>`).join('');

    return `<div style="border:1px solid #e9ecf2;border-radius:16px;padding:18px;margin-bottom:14px;background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.05)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <span style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;font-weight:600;color:#98a2b3;background:#f4f5f8;padding:2px 7px;border-radius:5px">${e(t.ref || '')}</span>
          <span style="margin-left:auto;font-size:11.5px;color:#8a94a6">${origin}${when ? ' · ' + e(when) : ''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
          <h4 style="margin:0;font-size:17px;font-weight:700;color:#101828;letter-spacing:-.01em;flex:1;min-width:0">${e(t.subject || '(no subject)')}</h4>
          <select class="hd-status" data-ticket="${e(t._id)}" data-prev="${e(t.status || '')}"
            style="flex:none;font-size:12.5px;font-weight:600;color:#101828;border:1px solid #d0d5dd;border-radius:8px;padding:7px 10px;background:#fff;cursor:pointer;outline:none;appearance:auto">
            ${statusOpts}
          </select>
        </div>
        ${formFields || '<div style="color:#8a94a6;font-size:13px">No fields captured.</div>'}
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
 * that genuinely lives in a location HelmDesk is installed on (which the agent is already viewing).
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

    // Brand name so the modal is white-labeled (shows the agency's name, never "HelmDesk").
    const ws = await Workspace.findOne({ locationId }).select('brand.name brand.primaryColor').lean();
    const brandName = ws?.brand?.name || 'Support';
    const accent = ws?.brand?.primaryColor || '#E0A24A';

    // Render the whole ticket list to HTML HERE, server-side. The custom JS just injects it — so any
    // future form field type (date, file, number, …) renders correctly without touching the script.
    const html = renderTicketsHtml({ brandName, accent, contact, tickets: withOpening });

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

module.exports = router;
