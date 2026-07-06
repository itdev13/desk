const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const analyticsService = require('../services/analyticsService');
const logger = require('../utils/logger');

/**
 * Analytics ingestion. Deliberately NOT behind requireAuth/requireEntitled:
 *   - navigator.sendBeacon (used on page-hide) can't set an Authorization header, so the session
 *     token is accepted from the request BODY (`token`) as well as the header.
 *   - we still want events from lapsed/canceled subscriptions, so no entitlement gate.
 * The token is verified here; locationId/userId/role come from it, never from client-supplied
 * fields — so tenancy can't be spoofed.
 */
function resolveAuth(req) {
  const header = req.headers.authorization || '';
  const token = (header.startsWith('Bearer ') ? header.slice(7) : null) || req.body?.token;
  if (!token) return null;
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET);
    if (!d.locationId) return null;
    return { locationId: d.locationId, companyId: d.companyId || null, userId: d.userId || null, role: d.role || 'agent' };
  } catch {
    return null;
  }
}

/**
 * POST /api/analytics/batch
 * Body: { token?, events: [{ name, props?, path?, sessionId?, ts? }, ...] }
 * Always returns 200 quickly — analytics must never surface an error to the user. Writing happens
 * without blocking the response.
 */
router.post('/batch', (req, res) => {
  const auth = resolveAuth(req);
  if (!auth) return res.status(204).end(); // silently ignore unauthenticated beacons

  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  const ctx = { ...auth, ua: req.headers['user-agent'] || null };

  // Respond immediately; ingest in the background.
  res.status(202).json({ success: true });
  analyticsService.ingest(events, ctx).catch((e) => logger.warn('analytics ingest error', { message: e.message }));
});

module.exports = router;
