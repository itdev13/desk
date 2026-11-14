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
  'autoCreateInbound',
  'supportChannels',
  'acceptConversationProviders',
  'ignoreAutomatedReplies',
  'ignoreShortMessages',
  'skipKeywords',
  'createKeywords',
  'assignmentMode',
  'defaultAssigneeId',
  'roundRobinPerPriority',
  'slaEnabled',
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
  const MAPS = ['name', 'email', 'phone', 'subject', 'message', 'priority'];
  return fields.slice(0, 40).map((f, i) => {
    const type = TYPES.includes(f.type) ? f.type : 'text';
    const isChoice = ['select', 'radio', 'checkbox'].includes(type);
    return {
      key: String(f.key || `field_${i}`).slice(0, 60),
      type,
      label: String(f.label || 'Field').slice(0, 120),
      placeholder: String(f.placeholder || '').slice(0, 160),
      helpText: String(f.helpText || '').slice(0, 240),
      required: !!f.required,
      maxLength: f.maxLength ? Math.min(Math.max(parseInt(f.maxLength, 10) || 0, 1), 10000) : null,
      options: isChoice ? (Array.isArray(f.options) ? f.options.map((o) => String(o).slice(0, 120)).filter(Boolean).slice(0, 30) : []) : [],
      maps: MAPS.includes(f.maps) ? f.maps : null
    };
  });
}

/**
 * Sanitize routing rules from the Settings screen: bound sizes, drop rules with no condition or no
 * action (a condition-less rule would match every ticket), normalize enums.
 */
const RULE_PRIORITIES = ['urgent', 'high', 'normal', 'low'];
function sanitizeRules(rules) {
  if (!Array.isArray(rules)) return undefined;
  const clip = (v, n) => { const t = String(v == null ? '' : v).trim(); return t ? t.slice(0, n) : null; };
  return rules.slice(0, 50).map((r, i) => {
    const matchOp = r.matchOp === 'contains' ? 'contains' : 'is';
    const matchValues = Array.isArray(r.matchValues)
      ? r.matchValues.map((v) => clip(v, 120)).filter(Boolean).slice(0, 30) : [];
    return {
      name: clip(r.name, 80) || `Rule ${i + 1}`,
      enabled: r.enabled !== false,
      matchChannel: clip(r.matchChannel, 40),
      matchKeyword: clip(r.matchKeyword, 120),
      matchFormId: clip(r.matchFormId, 64),
      matchField: clip(r.matchField, 120),
      matchOp,
      matchValues: matchOp === 'is' ? matchValues : [],
      matchValue: matchOp === 'contains' ? clip(r.matchValue, 200) : (matchValues.length ? null : clip(r.matchValue, 120)),
      setPriority: RULE_PRIORITIES.includes(r.setPriority) ? r.setPriority : null,
      assignAgentId: clip(r.assignAgentId, 64)
    };
  }).filter((r) => {
    const formCond = !!r.matchFormId || !!(r.matchField && (r.matchValues.length || r.matchValue));
    const incompleteQuestion = r.matchField && !(r.matchValues.length || r.matchValue);
    return !incompleteQuestion && (r.matchChannel || r.matchKeyword || formCond) && (r.setPriority || r.assignAgentId);
  });
}

/**
 * Mint a public portal slug the first time intake is enabled. It's RANDOM (not derived from the
 * locationId — that's public, so a derived slug would be guessable). Minted once and stored, so it's
 * stable across re-saves. Called from BOTH the settings update and the wizard.
 */
function ensurePortalSlug(update, current, locationId) {
  if (update.portalEnabled && !current?.portalSlug && !update.portalSlug) {
    update.portalSlug = `p-${require('crypto').randomBytes(9).toString('base64url')}`;
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
    if ('rules' in update) update.rules = sanitizeRules(update.rules);

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
    if ('rules' in update) update.rules = sanitizeRules(update.rules);

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
// Reused by the forms route so multi-form fields are sanitized identically to the legacy portal fields.
module.exports.sanitizePortalFields = sanitizePortalFields;
