const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Ticket = require('../models/Ticket');
const Comment = require('../models/Comment');
const Workspace = require('../models/Workspace');
const OAuthToken = require('../models/OAuthToken');

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

function renderTicketsHtml({ brandName, accent, contact, tickets, timeZone }) {
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
    // Render in the LOCATION's timezone, not the server's. This HTML is built server-side, so a bare
    // toLocaleString would use whatever zone the deployed box runs in (usually UTC). We pass the GHL
    // location's own timezone so the whole support team sees consistent, correct local times.
    const dateOpts = { dateStyle: 'medium', timeStyle: 'short' };
    if (timeZone) dateOpts.timeZone = timeZone;
    let when = '';
    let whenFull = ''; // hover tooltip: full date + time + timezone, so the zone is never ambiguous
    if (t.createdAt) {
      const d = new Date(t.createdAt);
      try {
        when = d.toLocaleString('en-US', dateOpts);
        // e.g. "Nov 6, 2026, 6:58 PM GMT+5:30 (Asia/Kolkata)"
        const withZone = d.toLocaleString('en-US', { ...dateOpts, timeZoneName: 'short' });
        whenFull = timeZone ? `${withZone} (${timeZone})` : withZone;
      } catch {
        when = d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); // bad tz → server zone
        whenFull = d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' });
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

    // Editable status dropdown (only editable control). Wired by the script via data-ticket.
    const statusOpts = STATUSES.map((s) =>
      `<option value="${s}"${s === t.status ? ' selected' : ''}>${e(STATUS_LABELS[s] || s)}</option>`).join('');

    return `<div style="border:1px solid #e9ecf2;border-radius:16px;padding:18px;margin-bottom:14px;background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.05)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <span style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;font-weight:600;color:#98a2b3;background:#f4f5f8;padding:2px 7px;border-radius:5px">${e(t.ref || '')}</span>
          <span style="margin-left:auto;font-size:11.5px;color:#8a94a6">${origin}${when ? ' · <span title="' + e(whenFull) + '" style="cursor:help;border-bottom:1px dotted #cbd2dd">' + e(when) + '</span>' : ''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
          <h4 style="margin:0;font-size:17px;font-weight:700;color:#101828;letter-spacing:-.01em;flex:1;min-width:0">${e(t.subject || '(no subject)')}</h4>
          <select class="hd-status" data-ticket="${e(t._id)}" data-prev="${e(t.status || '')}"
            style="flex:none;font-size:12.5px;font-weight:600;color:#101828;border:1px solid #d0d5dd;border-radius:8px;padding:7px 10px;background:#fff;cursor:pointer;outline:none;appearance:auto">
            ${statusOpts}
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

    // Brand name so the modal is white-labeled (shows the agency's name, never "HelmDesk").
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

    // Render the whole ticket list to HTML HERE, server-side. The custom JS just injects it — so any
    // future form field type (date, file, number, …) renders correctly without touching the script.
    const html = renderTicketsHtml({ brandName, accent, contact, tickets: withOpening, timeZone });

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
