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
// Per-status accent colors for the pill.
const STATUS_COLORS = {
  new: ['#eef2ff', '#3538cd'], open: ['#fff4e5', '#b45309'], pending: ['#fef9c3', '#854d0e'],
  on_hold: ['#f1f5f9', '#475569'], resolved: ['#dcfce7', '#15803d'], closed: ['#f1f5f9', '#475569']
};
const PRIORITY_COLORS = {
  urgent: '#dc2626', high: '#ea580c', normal: '#2563eb', low: '#64748b'
};

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
    const [pillBg, pillFg] = STATUS_COLORS[t.status] || ['#f1f5f9', '#475569'];
    const prColor = PRIORITY_COLORS[(t.priority || 'normal')] || '#64748b';

    // The opening message may contain a trailing "— Form details —" block (we also add it to the
    // ticket body). Strip it here so we don't show the same answers twice — the structured grid below
    // is the canonical view.
    let body = String(t.firstMessage || '').replace(/\n*—\s*Form details\s*—[\s\S]*$/i, '').trim();
    const msg = body
      ? `<div style="font-size:13px;line-height:1.55;color:#344054;white-space:pre-wrap;margin:10px 0 0">${e(body)}</div>`
      : '';

    const cf = (Array.isArray(t.customFields) ? t.customFields : [])
      .filter((f) => f && f.value != null && String(f.value).trim() !== '');
    const fieldRows = cf.map((f, i) => `
      <div style="display:flex;gap:12px;padding:9px 12px;${i ? 'border-top:1px solid #f1f3f7;' : ''}">
        <span style="flex:none;width:150px;font-size:12px;font-weight:600;color:#667085">${e(f.label)}</span>
        <span style="flex:1;min-width:0;font-size:13px;color:#101828;word-break:break-word">${e(f.value)}</span>
      </div>`).join('');
    const fieldsBlock = fieldRows
      ? `<div style="margin-top:12px">
           <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#98a2b3;margin:0 0 6px 2px">Form submission</div>
           <div style="background:#fafbfc;border:1px solid #eef0f4;border-radius:10px;overflow:hidden">${fieldRows}</div>
         </div>`
      : '';

    return `<div style="border:1px solid #e9ecf2;border-radius:14px;padding:16px;margin-bottom:12px;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.04)">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;font-weight:600;color:#98a2b3;background:#f4f5f8;padding:1px 7px;border-radius:5px">${e(t.ref || '')}</span>
              <span style="font-weight:700;color:#101828;font-size:15px;letter-spacing:-.01em">${e(t.subject || '(no subject)')}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:7px;font-size:11.5px;color:#8a94a6">
              <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:6px;height:6px;border-radius:50%;background:${prColor};display:inline-block"></span>${e((t.priority || 'normal'))}</span>
              <span style="color:#d0d5dd">·</span><span>${origin}</span>
              ${when ? `<span style="color:#d0d5dd">·</span><span>${e(when)}</span>` : ''}
            </div>
          </div>
          <span style="flex:none;font-size:11px;font-weight:700;text-transform:capitalize;padding:3px 10px;border-radius:999px;background:${pillBg};color:${pillFg}">${e((t.status || '').replace('_', ' '))}</span>
        </div>
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
