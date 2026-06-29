const express = require('express');
const router = express.Router();
const Workspace = require('../models/Workspace');
const ticketService = require('../services/ticketService');
const ghlService = require('../services/ghlService');
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');

/**
 * Public client-portal intake. NO session auth — this is the customer-facing "Submit a request"
 * endpoint an agency embeds on a website/portal. Identified by the workspace's public portalSlug.
 *
 * Rate-limited per IP to prevent abuse since it's unauthenticated and creates tickets + contacts.
 */
const intakeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please wait a moment and try again.' }
});

/** GET /portal/:slug — branding for rendering a themed intake form. */
router.get('/:slug', async (req, res) => {
  const ws = await Workspace.findOne({ portalSlug: req.params.slug, portalEnabled: true });
  if (!ws) return res.status(404).json({ success: false, error: 'Portal not found' });
  res.json({
    success: true,
    brand: ws.brand,
    locationName: ws.locationName
  });
});

/**
 * POST /portal/:slug/submit
 * Body: { name, email, phone, subject, message }
 * Creates/merges the GHL contact, then creates a portal-sourced ticket.
 */
router.post('/:slug/submit', intakeLimiter, async (req, res) => {
  try {
    const ws = await Workspace.findOne({ portalSlug: req.params.slug, portalEnabled: true });
    if (!ws) return res.status(404).json({ success: false, error: 'Portal not found' });

    const { name, email, phone, subject, message } = req.body;
    if (!subject && !message) return res.status(400).json({ success: false, error: 'Please describe your request.' });
    if (!email && !phone) return res.status(400).json({ success: false, error: 'Please provide an email or phone so we can reply.' });

    // Upsert the contact in GHL so the ticket links to a real person.
    let contact = { id: null, name: name || email || phone };
    try {
      const upserted = await ghlService.upsertContact(ws.locationId, {
        firstName: (name || '').split(' ')[0] || undefined,
        lastName: (name || '').split(' ').slice(1).join(' ') || undefined,
        email: email || undefined,
        phone: phone || undefined
      });
      contact = { id: upserted.id || upserted.contact?.id, name: name || email || phone };
    } catch (e) {
      logger.warn('portal contact upsert failed (continuing without contactId)', { message: e.message });
    }

    const ticket = await ticketService.createTicket(ws, {
      subject: subject || (message || '').slice(0, 80),
      contactId: contact.id,
      contactName: contact.name,
      contactEmail: email || null,
      channel: 'portal',
      source: 'portal',
      firstMessage: message || subject
    });

    res.json({ success: true, ref: ticket.ref, message: 'Your request has been submitted. We will be in touch shortly.' });
  } catch (error) {
    logger.error('portal submit failed', { message: error.message });
    res.status(500).json({ success: false, error: 'Could not submit your request. Please try again.' });
  }
});

module.exports = router;
