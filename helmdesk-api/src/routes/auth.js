const express = require('express');
const router = express.Router();
const CryptoJS = require('crypto-js');
const OAuthToken = require('../models/OAuthToken');
const Workspace = require('../models/Workspace');
const CompanyLocation = require('../models/CompanyLocation');
const { signSession } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * Session bootstrap for the embedded UI.
 *
 * GHL renders our app in an iframe and posts an encrypted user-context blob (via the
 * Custom Page SSO mechanism). We decrypt it with the app's Shared Secret, confirm the location
 * is connected, and mint a short-lived session JWT the SPA uses for all subsequent calls.
 */

/** Decrypt the GHL SSO payload → { userId, companyId, activeLocation, ... }. */
function decryptSSO(encrypted) {
  const bytes = CryptoJS.AES.decrypt(encrypted, process.env.GHL_SSO_KEY);
  const text = bytes.toString(CryptoJS.enc.Utf8);
  return JSON.parse(text);
}

/**
 * POST /api/auth/verify
 * Body: { encryptedData } (preferred, from GHL SSO) OR { locationId } (dev fallback).
 * Returns a session token + the workspace's setup state so the UI can route to the wizard.
 */
router.post('/verify', async (req, res) => {
  try {
    let locationId = null;
    let companyId = null;
    let userId = null;
    let name = null;
    let email = null;

    if (req.body.encryptedData && process.env.GHL_SSO_KEY) {
      try {
        const ctx = decryptSSO(req.body.encryptedData);
        locationId = ctx.activeLocation || ctx.locationId || null;
        companyId = ctx.companyId || null;
        userId = ctx.userId || null;
        name = ctx.userName || [ctx.firstName, ctx.lastName].filter(Boolean).join(' ') || null;
        email = ctx.email || null;
      } catch (e) {
        logger.warn('SSO decrypt failed', { message: e.message });
      }
    }

    // Dev / explicit fallback.
    if (!locationId && req.body.locationId) {
      locationId = req.body.locationId;
    }

    if (!locationId) {
      return res.status(400).json({ success: false, error: 'Could not resolve workspace (locationId).' });
    }

    // Confirm the location is connected (location token, or company token that can mint one).
    let token = await OAuthToken.findActiveToken(locationId);
    if (!token) {
      const companyLoc = await CompanyLocation.findCompanyByLocation(locationId);
      if (!companyLoc) {
        return res.status(403).json({ success: false, error: 'Workspace not connected. Please install HelmDesk.', connected: false });
      }
      companyId = companyId || companyLoc.companyId;
    } else {
      companyId = companyId || token.companyId;
    }

    let workspace = await Workspace.findOne({ locationId });

    // Determine the owner. Priority:
    //   1. workspace.installerUserId (if already set)
    //   2. the INSTALL webhook's Installation.userId — authoritative, GHL tells us who installed
    //   3. self-heal: the first verifying user claims ownership
    let ownerUserId = workspace?.installerUserId || null;
    if (!ownerUserId) {
      const Installation = require('../models/Installation');
      const install = await Installation.findOne({ locationId, status: 'active' }).sort({ installedAt: -1 });
      ownerUserId = install?.userId || install?.rawWebhookData?.userId || null;
      if (!ownerUserId && userId) ownerUserId = userId; // last resort: first opener
      if (workspace && ownerUserId) {
        workspace = await Workspace.findOneAndUpdate(
          { locationId, installerUserId: { $in: [null, undefined] } },
          { $set: { installerUserId: ownerUserId } },
          { new: true }
        ) || workspace;
        logger.info('[auth/verify] backfilled workspace owner', { locationId, ownerUserId, from: install?.userId ? 'installation' : 'first-opener' });
      }
    }

    // Resolve this user's role for permission gating. Admin if ANY of:
    //   - they're the installer/owner of this workspace (can never be locked out)
    //   - they're in the workspace's adminUserIds (owner-promoted)
    //   - their synced Agent record has role 'admin'
    //   - setup isn't complete yet (so the first configurer isn't blocked)
    // Otherwise: agent (least privilege).
    let role = 'agent';
    const isInstaller = userId && ownerUserId && ownerUserId === userId;
    const isPromoted = userId && (workspace?.adminUserIds || []).includes(userId);
    if (isInstaller || isPromoted || !workspace?.setupComplete) {
      role = 'admin';
    } else if (userId) {
      const Agent = require('../models/Agent');
      const agent = await Agent.findOne({ locationId, ghlUserId: userId });
      if (agent?.role === 'admin') role = 'admin';
    }
    logger.info('[auth/verify] role resolved', {
      locationId, userId, role, isInstaller, isPromoted,
      setupComplete: workspace?.setupComplete, ownerUserId
    });

    const sessionToken = signSession({ locationId, companyId, userId, name, email, role });
    const analyticsService = require('../services/analyticsService');
    res.json({
      success: true,
      token: sessionToken,
      workspace: {
        locationId,
        locationName: workspace?.locationName || token?.locationName || null,
        setupComplete: workspace?.setupComplete || false,
        brand: workspace?.brand || { name: 'HelmDesk', primaryColor: '#E0A24A' }
      },
      user: { userId, name, email, role },
      // Tells the UI whether to send clickstream events (respects ANALYTICS_ENABLED + excluded ids).
      analytics: analyticsService.clientConfig(locationId)
    });
  } catch (error) {
    logger.error('auth/verify error', { message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
