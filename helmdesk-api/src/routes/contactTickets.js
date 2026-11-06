const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Ticket = require('../models/Ticket');
const Comment = require('../models/Comment');
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

    res.json({ success: true, contact, tickets: withOpening });
  } catch (error) {
    logger.error('[contact-tickets] failed', { message: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Could not load tickets.', detail: error.message });
  }
});

module.exports = router;
