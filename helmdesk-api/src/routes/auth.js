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
 * Decide whether this location should be prompted to reconnect, and keep the workspace flag in sync.
 *
 * Runs on every app load. The source of truth is the VersionConfig table: you seed one row per
 * release that added a new OAuth scope (e.g. contacts), as { versionId, forceReconnect:true, reason }.
 *
 * The check:
 *   1. Read this install's current versionId (set at INSTALL, bumped by the UPDATE webhook).
 *   2. Look for a VersionConfig row that is forceReconnect:true AND whose versionId is NOT the one
 *      this install is on. That means there's a newer flagged version the install hasn't caught up
 *      to — the user hasn't re-authorized for its new scope yet → show the banner.
 *   3. Once the UPDATE webhook bumps the install's versionId to that flagged version (or the user
 *      reconnects), the install IS on the flagged version, no mismatch remains → banner clears.
 *
 * No "current version" env var: the VersionConfig rows themselves say which versions need a reconnect.
 *
 * Returns { needsReconnect, needsReconnectReason }.
 */
async function resolveReconnect(locationId, workspace) {
  const Installation = require('../models/Installation');
  const install = await Installation.findOne({ locationId, status: 'active' })
    .select('versionId rawWebhookData.versionId')
    .sort({ installedAt: -1 })
    .lean();
  const installedVersion = install?.versionId || install?.rawWebhookData?.versionId || null;

  // Is there a version that requires a reconnect which this install is NOT yet on? If the install is
  // already on it (versionId matches), there's nothing to prompt. Most recent flagged row wins.
  const VersionConfig = require('../models/VersionConfig');
  const cfg = await VersionConfig.findOne({
    forceReconnect: true,
    versionId: { $ne: installedVersion }
  }).sort({ createdAt: -1 }).lean();

  const needsReconnect = !!cfg;
  const needsReconnectReason = cfg ? (cfg.reason || 'New features need you to reconnect.') : null;

  // Keep the workspace flag consistent with the computed state (only write when it changed, so we
  // don't touch the DB on every load). This also self-heals a stale flag once the user reconnects
  // and the UPDATE webhook bumps their install version to the flagged one.
  if (workspace &&
      (!!workspace.needsReconnect !== needsReconnect ||
       (workspace.needsReconnectReason || null) !== needsReconnectReason)) {
    await Workspace.updateOne(
      { locationId },
      { $set: { needsReconnect, needsReconnectReason } }
    );
  }

  return { needsReconnect, needsReconnectReason };
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

    // Dev-only fallback: accept a raw locationId with NO SSO proof. This is a session-granting bypass
    // (locationIds are public — they appear in every CRM URL), so it is gated behind an explicit env
    // flag and MUST never be enabled in production. Without the flag, only a decrypted SSO blob works.
    if (!locationId && req.body.locationId) {
      if (String(process.env.ALLOW_DEV_LOGIN || '').toLowerCase() !== 'true') {
        return res.status(401).json({ success: false, error: 'SSO required.' });
      }
      locationId = req.body.locationId;
      logger.warn('⚠️ DEV LOGIN used (ALLOW_DEV_LOGIN=true) — must be off in production', { locationId });
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
    const Agent = require('../models/Agent');
    const agentRecord = userId ? await Agent.findOne({ locationId, ghlUserId: userId }) : null;
    if (isInstaller || isPromoted || !workspace?.setupComplete) {
      role = 'admin';
    } else if (agentRecord?.role === 'admin') {
      role = 'admin';
    }

    // HelmDesk access gate. Admins (and the installer) always have access. For a non-admin agent,
    // access is on unless an admin has turned off their accessEnabled flag. A user with no synced
    // Agent record yet (e.g. before the first Team sync) defaults to having access.
    const hasAccess = role === 'admin' || agentRecord == null || agentRecord.accessEnabled !== false;

    logger.info('[auth/verify] role resolved', {
      locationId, userId, role, isInstaller, isPromoted, hasAccess,
      setupComplete: workspace?.setupComplete, ownerUserId
    });

    // Reconcile the reconnect prompt from the installed version vs the version we're serving. Only
    // admins can re-authorize, so there's no point computing/showing it for agents.
    const { needsReconnect, needsReconnectReason } =
      role === 'admin'
        ? await resolveReconnect(locationId, workspace)
        : { needsReconnect: false, needsReconnectReason: null };

    const sessionToken = signSession({ locationId, companyId, userId, name, email, role });
    const analyticsService = require('../services/analyticsService');
    res.json({
      success: true,
      token: sessionToken,
      workspace: {
        locationId,
        locationName: workspace?.locationName || token?.locationName || null,
        setupComplete: workspace?.setupComplete || false,
        needsReconnect,
        needsReconnectReason,
        brand: workspace?.brand || { name: 'HelmDesk', primaryColor: '#E0A24A' }
      },
      user: { userId, name, email, role, hasAccess },
      // Tells the UI whether to send clickstream events (respects ANALYTICS_ENABLED + excluded ids).
      analytics: analyticsService.clientConfig(locationId)
    });
  } catch (error) {
    logger.error('auth/verify error', { message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
