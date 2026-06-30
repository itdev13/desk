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

    const workspace = await Workspace.findOne({ locationId });

    // Resolve this user's role for permission gating. Source of truth is the synced Agent record.
    // Fallbacks: if setup isn't complete yet (no agents synced), treat the user as admin so they
    // can configure the workspace; otherwise default to agent (least privilege).
    let role = 'agent';
    if (userId) {
      const Agent = require('../models/Agent');
      const agent = await Agent.findOne({ locationId, ghlUserId: userId });
      if (agent) role = agent.role === 'admin' ? 'admin' : 'agent';
      else if (!workspace?.setupComplete) role = 'admin';
    } else if (!workspace?.setupComplete) {
      role = 'admin';
    }

    const sessionToken = signSession({ locationId, companyId, userId, name, email, role });
    res.json({
      success: true,
      token: sessionToken,
      workspace: {
        locationId,
        locationName: workspace?.locationName || token?.locationName || null,
        setupComplete: workspace?.setupComplete || false,
        brand: workspace?.brand || { name: 'HelmDesk', primaryColor: '#E0A24A' }
      },
      user: { userId, name, email, role }
    });
  } catch (error) {
    logger.error('auth/verify error', { message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
