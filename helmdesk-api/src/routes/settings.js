const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const Workspace = require('../models/Workspace');
const subscriptionService = require('../services/subscriptionService');
const logger = require('../utils/logger');

// Fields that require the white-label (top) tier. Non-entitled plans can't change these.
const WHITE_LABEL_FIELDS = ['brand', 'portalEnabled', 'portalFields'];

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
  'portalEnabled',
  'portalFields'
];

/** Sanitize the portal form-builder field list before saving (bound sizes, clean options). */
function sanitizePortalFields(fields) {
  if (!Array.isArray(fields)) return undefined;
  const TYPES = ['text', 'textarea', 'select', 'radio', 'checkbox'];
  const MAPS = ['name', 'email', 'phone', 'subject', 'message'];
  return fields.slice(0, 40).map((f, i) => {
    const type = TYPES.includes(f.type) ? f.type : 'text';
    const isChoice = ['select', 'radio', 'checkbox'].includes(type);
    return {
      key: String(f.key || `field_${i}`).slice(0, 60),
      type,
      label: String(f.label || 'Field').slice(0, 120),
      placeholder: String(f.placeholder || '').slice(0, 160),
      required: !!f.required,
      maxLength: f.maxLength ? Math.min(Math.max(parseInt(f.maxLength, 10) || 0, 1), 10000) : null,
      options: isChoice ? (Array.isArray(f.options) ? f.options.map((o) => String(o).slice(0, 120)).filter(Boolean).slice(0, 30) : []) : [],
      maps: MAPS.includes(f.maps) ? f.maps : null
    };
  });
}

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
    if ('portalFields' in update) update.portalFields = sanitizePortalFields(update.portalFields);

    // Plan-gated features: check once, then guard each affected field.
    const touchesWhiteLabel = WHITE_LABEL_FIELDS.some((k) => k in update);
    const wantsRoundRobin = update.assignmentMode === 'round_robin';
    if (touchesWhiteLabel || wantsRoundRobin) {
      const { whiteLabel, routing, planName } = await subscriptionService.planFeatures(req.auth.locationId);
      if (touchesWhiteLabel && !whiteLabel) {
        return res.status(402).json({
          success: false,
          code: 'PLAN_UPGRADE_REQUIRED',
          error: `White-label branding and the client portal are available on the Agency plan. Upgrade from ${planName || 'your current plan'} to customize these.`
        });
      }
      if (wantsRoundRobin && !routing) {
        return res.status(402).json({
          success: false,
          code: 'PLAN_UPGRADE_REQUIRED',
          error: `Round-robin auto-assignment is available on the Team plan and above. Upgrade from ${planName || 'your current plan'} to enable it.`
        });
      }
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

    // Plan gating for the wizard: rather than blocking onboarding with a 402, silently coerce
    // gated choices to the plan-allowed fallback. Round-robin (Team+) → unassigned; white-label
    // (Agency) branding/portal → dropped. The UI also hides these, so this is just a safety net.
    const { whiteLabel, routing } = await subscriptionService.planFeatures(req.auth.locationId);
    if (update.assignmentMode === 'round_robin' && !routing) {
      update.assignmentMode = 'unassigned';
      logger.info('complete-setup: round_robin not allowed on plan → unassigned', { locationId: req.auth.locationId });
    }
    if (!whiteLabel) {
      delete update.brand;
      delete update.portalEnabled;
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
