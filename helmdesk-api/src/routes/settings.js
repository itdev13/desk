const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const Workspace = require('../models/Workspace');
const logger = require('../utils/logger');

router.use(requireAuth);

/** Fields the agency may set via the wizard / settings screen. */
const ALLOWED = [
  'supportChannels',
  'acceptConversationProviders',
  'ignoreAutomatedReplies',
  'ignoreShortMessages',
  'skipKeywords',
  'createKeywords',
  'assignmentMode',
  'defaultAssigneeId',
  'slaTargets',
  'autoCloseResolvedDays',
  'reopenWindowDays',
  'autoReplyEnabled',
  'autoReplyMessage',
  'ticketNumberPrefix',
  'rules',
  'brand',
  'portalEnabled'
];

/**
 * Mint a stable public portal slug the first time intake is enabled. Derived from the locationId
 * so it's stable across re-saves, and base64url so it's not a guessable sequential id.
 * Called from BOTH the settings update and the wizard so enabling the portal anywhere works.
 */
function ensurePortalSlug(update, current, locationId) {
  if (update.portalEnabled && !current?.portalSlug && !update.portalSlug) {
    update.portalSlug = `p-${Buffer.from(locationId).toString('base64url').slice(0, 12)}`;
  }
}

/** GET /api/settings — full workspace configuration. */
router.get('/', async (req, res) => {
  const ws = await Workspace.findOne({ locationId: req.auth.locationId });
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found' });
  res.json({ success: true, workspace: ws });
});

/** PUT /api/settings — patch any allowed fields (used by the settings screen). */
router.put('/', requireAdmin, async (req, res) => {
  try {
    const update = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const current = await Workspace.findOne({ locationId: req.auth.locationId });
    if (!current) return res.status(404).json({ success: false, error: 'Workspace not found' });
    ensurePortalSlug(update, current, req.auth.locationId);
    const ws = await Workspace.findOneAndUpdate({ locationId: req.auth.locationId }, { $set: update }, { new: true });
    res.json({ success: true, workspace: ws });
  } catch (error) {
    logger.error('update settings failed', { message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/settings/complete-setup
 * Finalizes the wizard: saves the four steps and flips setupComplete=true so the engine goes live.
 * Generates a portal slug if portal intake was enabled.
 */
router.post('/complete-setup', requireAdmin, async (req, res) => {
  try {
    const update = { setupComplete: true };
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const current = await Workspace.findOne({ locationId: req.auth.locationId });
    ensurePortalSlug(update, current, req.auth.locationId);
    // The user who completes setup is the owner/admin. This is the reliable signal — their SSO
    // userId is in-hand and it sidesteps company-install / id-mismatch issues. Only set if unset.
    if (!current?.installerUserId && req.auth.userId) update.installerUserId = req.auth.userId;
    const ws = await Workspace.findOneAndUpdate({ locationId: req.auth.locationId }, { $set: update }, { new: true });
    logger.info('✅ Setup completed — engine live', { locationId: req.auth.locationId, channels: ws.supportChannels });
    res.json({ success: true, workspace: ws });
  } catch (error) {
    logger.error('complete-setup failed', { message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
