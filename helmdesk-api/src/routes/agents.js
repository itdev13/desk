const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const Agent = require('../models/Agent');
const agentService = require('../services/agentService');
const subscriptionService = require('../services/subscriptionService');
const logger = require('../utils/logger');

router.use(requireAuth);

/**
 * GET /api/agents — the workspace's agent roster (with open-ticket load).
 * ?assignable=1 → only agents that can take new tickets (active, not deleted in the CRM).
 *   Used by assignee dropdowns. Without it (Team page) deleted agents are included so they can
 *   be shown with a "Deleted in CRM" badge.
 */
router.get('/', async (req, res) => {
  const query = { locationId: req.auth.locationId };
  if (req.query.assignable === '1') {
    query.active = true;
    query.deleted = { $ne: true };
  }
  const agents = await Agent.find(query).sort({ name: 1 }).lean();
  res.json({ success: true, agents });
});

/** POST /api/agents/sync — pull the latest user list from GHL. */
router.post('/sync', async (req, res) => {
  try {
    logger.info('[agents/sync] request', { locationId: req.auth.locationId, companyId: req.auth.companyId || null, userId: req.auth.userId || null });
    const { agents, diagnostics } = await agentService.syncAgents(req.auth.locationId, req.auth.companyId);
    // diagnostics explains an empty result: companyIdResolved / usersFromGhl / saved.
    res.json({ success: true, count: agents.length, agents, diagnostics });
  } catch (error) {
    logger.error('agent sync failed', { message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/** PATCH /api/agents/:ghlUserId — toggle active / change role. */
router.patch('/:ghlUserId', requireAdmin, async (req, res) => {
  try {
    const update = {};
    if (req.body.active !== undefined) update.active = req.body.active;
    if (req.body.role) update.role = req.body.role;

    // Seat limit: block turning an agent ACTIVE past the plan's seat allowance.
    if (update.active === true) {
      const { seatLimit, planName } = await subscriptionService.planFeatures(req.auth.locationId);
      if (seatLimit < 9999) {
        const alreadyActive = await Agent.countDocuments({
          locationId: req.auth.locationId, active: true, deleted: { $ne: true },
          ghlUserId: { $ne: req.params.ghlUserId }
        });
        if (alreadyActive >= seatLimit) {
          return res.status(402).json({
            success: false,
            code: 'SEAT_LIMIT',
            error: `Your ${planName || 'current'} plan allows ${seatLimit} active agent${seatLimit === 1 ? '' : 's'}. Upgrade your plan to add more.`
          });
        }
      }
    }

    const agent = await Agent.findOneAndUpdate(
      { locationId: req.auth.locationId, ghlUserId: req.params.ghlUserId },
      { $set: update },
      { new: true }
    );
    if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
    res.json({ success: true, agent });
  } catch (error) {
    logger.error('agent update failed', { message: error.message });
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

module.exports = router;
