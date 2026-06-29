const express = require('express');
const router = express.Router();
const ghlService = require('../services/ghlService');
const OAuthToken = require('../models/OAuthToken');
const CompanyLocation = require('../models/CompanyLocation');
const Workspace = require('../models/Workspace');
const logger = require('../utils/logger');

/**
 * HelmDesk OAuth.
 *
 * Scopes are messaging-centric: we need to read inbound, send replies, read contacts (for the
 * ticket's contact card) and users (for the agent roster). charges.* lets GHL bill the monthly
 * subscription. No write scopes beyond conversations/contacts.
 */
const SCOPES = [
  'conversations.readonly',
  'conversations.write',
  'conversations/message.readonly',
  'conversations/message.write',
  'contacts.readonly',
  'contacts.write',
  'locations.readonly',
  'users.readonly',
  'oauth.readonly',
  'charges.readonly',
  'charges.write',
  'marketplace-installer-details.readonly'
].join(' ');

/** Start the OAuth flow. */
router.get('/authorize', (req, res) => {
  const authUrl =
    `https://marketplace.gohighlevel.com/v2/oauth/chooselocation?` +
    `response_type=code&` +
    `client_id=${process.env.GHL_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(process.env.GHL_REDIRECT_URI)}&` +
    `scope=${encodeURIComponent(SCOPES)}`;
  res.redirect(authUrl);
});

/** OAuth callback — exchange code, store token(s), bootstrap the workspace. */
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Authorization code not provided');

  try {
    const tokenData = await ghlService.getAccessToken(code);
    const isLocationLevel = !!tokenData.locationId;

    if (isLocationLevel) {
      await OAuthToken.findOneAndUpdate(
        { locationId: tokenData.locationId },
        {
          locationId: tokenData.locationId,
          companyId: tokenData.companyId,
          tokenType: 'location',
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000),
          isActive: true
        },
        { upsert: true, new: true }
      );

      const details = await ghlService.getLocationDetails(tokenData.locationId);
      await OAuthToken.findOneAndUpdate({ locationId: tokenData.locationId }, { ...details });

      // Ensure a Workspace exists (setup wizard will complete it).
      await Workspace.findOneAndUpdate(
        { locationId: tokenData.locationId },
        {
          $setOnInsert: { locationId: tokenData.locationId },
          $set: { companyId: tokenData.companyId, locationName: details.locationName }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Capture installer email for support/win-back (non-blocking).
      if (tokenData.userId) {
        ghlService
          .getUserWithToken(tokenData.userId, tokenData.accessToken)
          .then((installer) => {
            if (installer?.email) {
              return OAuthToken.findOneAndUpdate(
                { locationId: tokenData.locationId },
                { installerUserId: installer.id, installerEmail: installer.email, installerName: installer.name }
              );
            }
          })
          .catch((e) => logger.warn('installer capture failed (non-blocking)', { message: e.message }));
      }

      logger.info('✅ HelmDesk connected (location)', { locationId: tokenData.locationId });
    } else {
      // Company-level (agency) install.
      await OAuthToken.findOneAndUpdate(
        { companyId: tokenData.companyId, tokenType: 'company' },
        {
          companyId: tokenData.companyId,
          tokenType: 'company',
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000),
          isActive: true
        },
        { upsert: true, new: true }
      );

      const locations = await ghlService.getCompanyLocations(tokenData.companyId, tokenData.accessToken);
      await CompanyLocation.findOneAndUpdate(
        { companyId: tokenData.companyId },
        { companyId: tokenData.companyId, locationIds: locations.map((l) => l.locationId) },
        { upsert: true, new: true }
      );
      logger.info('✅ HelmDesk connected (company)', { companyId: tokenData.companyId, locations: locations.length });
    }

    res.send(renderSuccessPage());
  } catch (error) {
    const isCodeReused =
      error.response?.data?.error === 'invalid_grant' &&
      error.response?.data?.error_description?.includes('authorization code');
    if (isCodeReused) return res.send(renderSuccessPage(true));
    logger.error('OAuth callback error', { message: error.message, data: error.response?.data });
    res.status(500).send(renderErrorPage(error.message));
  }
});

/** Lightweight connection check for the UI. */
router.get('/status', async (req, res) => {
  const { locationId } = req.query;
  if (!locationId) return res.status(400).json({ success: false, error: 'locationId required' });
  try {
    const token = await OAuthToken.findActiveToken(locationId);
    res.json({ success: true, connected: !!token, locationId, locationName: token?.locationName || null });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// HelmDesk icon mark (matches helmdesk-ui/public/icon.svg and the marketplace listing).
const LOGO_SVG = `<svg width="56" height="56" viewBox="0 0 112 112" aria-label="HelmDesk" style="display:block;margin:0 auto 20px">
  <defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ECB45F"/><stop offset="1" stop-color="#D4912F"/></linearGradient></defs>
  <rect x="4" y="4" width="104" height="104" rx="26" fill="url(#a)"/>
  <g fill="#0F1729"><rect x="34" y="32" width="12" height="48" rx="3"/><rect x="66" y="32" width="12" height="48" rx="3"/><rect x="40" y="50" width="32" height="11" rx="3"/></g>
  <circle cx="56" cy="55.5" r="5.2" fill="#0F1729"/><circle cx="56" cy="55.5" r="2.2" fill="#D4912F"/>
</svg>`;

function renderSuccessPage(already = false) {
  return `<!DOCTYPE html><html><head><title>HelmDesk Connected</title>
  <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0F1729;color:#fff}
  .c{text-align:center;background:#131C2E;padding:48px;border-radius:16px;max-width:440px;border:1px solid #232E45;border-top:3px solid #E0A24A}
  h1{margin:0 0 8px;font-size:24px}p{color:#C3CCDB;line-height:1.6}
  .s{display:inline-block;margin-top:8px;padding:10px 16px;background:#E4F4EC;color:#14492f;border-radius:8px;font-size:14px;font-weight:600}</style></head>
  <body><div class="c">${LOGO_SVG}<h1>HelmDesk ${already ? 'already ' : ''}connected</h1>
  <p>Open your sub-account and find <strong style="color:#E0A24A">HelmDesk</strong> in the left menu to finish setup.</p>
  <div class="s">✓ Installation complete — you can close this window.</div></div></body></html>`;
}

function renderErrorPage(message) {
  return `<!DOCTYPE html><html><head><title>HelmDesk — Connection Failed</title>
  <style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0F1729;color:#fff}
  .c{text-align:center;background:#131C2E;padding:48px;border-radius:16px;max-width:440px;border-top:3px solid #D64545}
  h1{color:#fff}.e{background:#FBE6E6;color:#991B1B;padding:12px;border-radius:8px;font-size:13px;margin-top:16px}</style></head>
  <body><div class="c">${LOGO_SVG}<h1>Connection failed</h1><p style="color:#C3CCDB">We couldn't connect HelmDesk.</p>
  <div class="e">${message}</div></div></body></html>`;
}

module.exports = router;
