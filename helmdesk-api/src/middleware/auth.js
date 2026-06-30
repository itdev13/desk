const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Session auth for the embedded UI. After the GHL iframe resolves the user context
 * (via /api/auth/verify), the frontend holds a short-lived JWT carrying { locationId, companyId,
 * userId, name }. Every /api ticket/settings call must present it.
 *
 * The token's locationId is the tenant boundary: routes read req.auth.locationId and never trust
 * a locationId from the request body/query for data access.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Missing session token' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = {
      locationId: decoded.locationId,
      companyId: decoded.companyId || null,
      userId: decoded.userId || null,
      name: decoded.name || null,
      email: decoded.email || null,
      role: decoded.role || 'agent'
    };
    if (!req.auth.locationId) {
      return res.status(401).json({ success: false, error: 'Invalid session: no locationId' });
    }
    return next();
  } catch (err) {
    logger.warn('JWT verification failed', { message: err.message });
    return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  }
}

/** Gate a route to admins only. Use after requireAuth. */
function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required', code: 'ADMIN_ONLY' });
  }
  return next();
}

/** Mint a session token for a resolved user context. */
function signSession({ locationId, companyId, userId, name, email, role }) {
  return jwt.sign(
    { locationId, companyId, userId, name, email, role: role || 'agent' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.SESSION_TTL || '12h' }
  );
}

module.exports = { requireAuth, requireAdmin, signSession };
