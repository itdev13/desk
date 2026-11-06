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
function renderTicketsHtml({ brandName, accent, contact, tickets }) {
  const esc2 = esc;
  if (!tickets.length) {
    return `<div style="text-align:center;color:#667085;padding:28px 10px;font-size:14px">No tickets for ${esc2(contact?.name || 'this contact')} yet.</div>`;
  }
  return tickets.map((t) => {
    const origin = t.source === 'portal' ? `Form: ${esc2(t.formName || 'Support form')}` : esc2(t.channel || t.source || '');
    const when = t.createdAt ? new Date(t.createdAt).toLocaleString() : '';
    const msg = t.firstMessage
      ? `<div style="font-size:13px;color:#344054;white-space:pre-wrap;background:#f9fafb;border:1px solid #eef0f4;border-radius:7px;padding:9px 11px;margin-bottom:8px">${esc2(t.firstMessage)}</div>`
      : '';
    const cf = Array.isArray(t.customFields) ? t.customFields : [];
    const fieldRows = cf
      .filter((f) => f && (f.value != null && String(f.value).trim() !== ''))
      .map((f) => `<div style="display:flex;gap:10px;font-size:12.5px;padding:2px 0"><b style="color:#475467;font-weight:600;min-width:140px;flex:none">${esc2(f.label)}</b><span style="color:#101828">${esc2(f.value)}</span></div>`)
      .join('');
    const fieldsBlock = fieldRows
      ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#98a2b3;margin:4px 0 6px">Form details</div><div style="background:#f9fafb;border:1px solid #eef0f4;border-radius:7px;padding:10px">${fieldRows}</div>`
      : '';
    return `<div style="border:1px solid #eef0f4;border-radius:10px;padding:14px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-family:ui-monospace,monospace;font-size:11.5px;color:#667085">${esc2(t.ref || '')}</span>
          <span style="font-weight:700;color:#101828;font-size:14px">${esc2(t.subject || '(no subject)')}</span>
          <span style="margin-left:auto;font-size:11px;font-weight:700;text-transform:capitalize;padding:2px 9px;border-radius:999px;background:${accent}22;color:${accent}">${esc2(t.status || '')}</span>
        </div>
        <div style="font-size:12px;color:#667085;margin-bottom:8px">${origin}${when ? ' &middot; ' + esc2(when) : ''} &middot; ${esc2(t.priority || 'normal')} priority</div>
        ${msg}${fieldsBlock}
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
      .select('ref subject status priority channel source formName customFields createdAt lastActivityAt')
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

module.exports = router;
