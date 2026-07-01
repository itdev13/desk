const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const { requireAuth } = require('../middleware/auth');
const ghlService = require('../services/ghlService');
const OnboardingCharge = require('../models/OnboardingCharge');
const CompanyLocation = require('../models/CompanyLocation');
const logger = require('../utils/logger');

router.use(requireAuth);

const SUPPORT_TO = process.env.SUPPORT_EMAIL_TO || 'support@vaultsuite.store';
const SCHEDULING_URL = process.env.ONBOARDING_CALENDAR_URL || '';
const ONBOARDING_PRICE_USD = Number(process.env.ONBOARDING_CALL_PRICE_USD || 2);
const ONBOARDING_MINS = Number(process.env.ONBOARDING_CALL_MINS || 30);
const ONBOARDING_METER_ID = process.env.GHL_ONBOARDING_METER_ID || '';

// Lazily-built mailer. Missing SMTP config is non-fatal — the form just returns a clear error.
let transporter = null;
function mailer() {
  if (transporter) return transporter;
  if (!process.env.SUPPORT_EMAIL_USER || !process.env.SUPPORT_EMAIL_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SUPPORT_EMAIL_USER, pass: process.env.SUPPORT_EMAIL_PASSWORD },
    tls: { rejectUnauthorized: false }
  });
  return transporter;
}

const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isValidEmail = (e = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Resolve the agency companyId for a location (JWT may omit it).
async function resolveCompanyId(req) {
  if (req.auth.companyId) return req.auth.companyId;
  const cl = await CompanyLocation.findCompanyByLocation(req.auth.locationId);
  return cl?.companyId || null;
}

/**
 * GET /api/support/config
 * Static bits the Support tab needs to render: price, whether paid booking is available.
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    onboarding: {
      priceUsd: ONBOARDING_PRICE_USD,
      durationMins: ONBOARDING_MINS,
      // Paid booking is only offered if a meter is configured; otherwise the tab hides it.
      available: !!ONBOARDING_METER_ID && !!SCHEDULING_URL
    },
    supportEmail: SUPPORT_TO
  });
});

/**
 * POST /api/support/contact  { subject, message, name?, email? }
 * Emails the support inbox. Sender defaults to the signed-in user's context.
 */
router.post('/contact', async (req, res) => {
  try {
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    const name = String(req.body.name || req.auth.name || '').trim();
    const email = String(req.body.email || req.auth.email || '').trim();

    if (!subject || !message) {
      return res.status(400).json({ success: false, error: 'Subject and message are required.' });
    }
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'That email address looks invalid.' });
    }

    const tx = mailer();
    if (!tx) {
      logger.warn('Support contact received but email is not configured', { locationId: req.auth.locationId, subject });
      return res.status(503).json({ success: false, error: 'Support email is not configured yet. Please try again later.' });
    }

    const html = `
      <h2>New support message</h2>
      <p><strong>From:</strong> ${escapeHtml(name || 'Not provided')} &lt;${escapeHtml(email || 'no email')}&gt;</p>
      <p><strong>Location:</strong> ${escapeHtml(req.auth.locationId)}</p>
      <p><strong>User:</strong> ${escapeHtml(req.auth.userId || '—')} (${escapeHtml(req.auth.role)})</p>
      <hr/>
      <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
      <h3>Message</h3>
      <p>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>`;

    await tx.sendMail({
      from: process.env.SUPPORT_EMAIL_USER,
      replyTo: email || undefined,
      to: SUPPORT_TO,
      subject: `[Support] ${subject}`,
      html
    });

    logger.info('Support contact sent', { locationId: req.auth.locationId, subject });
    res.json({ success: true, message: 'Message sent. Our team will reply by email soon.' });
  } catch (error) {
    logger.error('Support contact failed', { message: error.message });
    res.status(500).json({ success: false, error: 'Could not send your message. Please try again.' });
  }
});

/**
 * POST /api/support/onboarding-call
 * Charge the agency's GHL wallet a one-time fee for a 30-min onboarding call, then return the
 * scheduling link. Records every attempt in the OnboardingCharge ledger (its _id is the GHL
 * idempotency eventId, so a retry never double-charges).
 */
router.post('/onboarding-call', async (req, res) => {
  if (!ONBOARDING_METER_ID || !SCHEDULING_URL) {
    return res.status(503).json({ success: false, error: 'Paid onboarding calls are not enabled for this app.' });
  }
  let charge;
  try {
    const companyId = await resolveCompanyId(req);
    if (!companyId) {
      return res.status(409).json({ success: false, error: 'Could not resolve your agency. Please reconnect the app.' });
    }

    charge = await OnboardingCharge.create({
      locationId: req.auth.locationId,
      companyId,
      userId: req.auth.userId,
      requestedByName: req.auth.name,
      requestedByEmail: req.auth.email,
      amountUsd: ONBOARDING_PRICE_USD,
      durationMins: ONBOARDING_MINS,
      status: 'pending'
    });

    const { chargeId } = await ghlService.chargeWallet({
      companyId,
      locationId: req.auth.locationId,
      meterId: ONBOARDING_METER_ID,
      amountUsd: ONBOARDING_PRICE_USD,
      units: 1,
      eventId: charge._id.toString(),
      description: `HelmDesk onboarding call — ${ONBOARDING_MINS} min`
    });

    charge.status = 'charged';
    charge.ghlChargeId = chargeId;
    charge.schedulingUrl = SCHEDULING_URL;
    await charge.save();

    res.json({
      success: true,
      chargeId,
      amountUsd: ONBOARDING_PRICE_USD,
      schedulingUrl: SCHEDULING_URL,
      message: `Charged $${ONBOARDING_PRICE_USD.toFixed(2)}. Pick a time below.`
    });
  } catch (error) {
    if (charge) {
      charge.status = 'failed';
      charge.failureReason = error.message;
      charge.insufficientFunds = !!error.insufficientFunds;
      await charge.save().catch(() => {});
    }
    const status = error.status || 500;
    const payload = { success: false, error: error.message || 'Charge failed.' };
    if (error.insufficientFunds) {
      payload.code = 'INSUFFICIENT_FUNDS';
      payload.error = `Your ${error.walletScope || 'agency'} wallet has insufficient funds. Please top up your wallet and try again.`;
    }
    res.status(status).json(payload);
  }
});

module.exports = router;
