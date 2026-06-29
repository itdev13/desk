const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const Agent = require('../models/Agent');
const agentService = require('../services/agentService');
const logger = require('../utils/logger');

router.use(requireAuth);

/** GET /api/agents — the workspace's agent roster (with open-ticket load). */
router.get('/', async (req, res) => {
  const agents = await Agent.find({ locationId: req.auth.locationId }).sort({ name: 1 }).lean();
  res.json({ success: true, agents });
});

/** POST /api/agents/sync — pull the latest user list from GHL. */
router.post('/sync', async (req, res) => {
  try {
    const agents = await agentService.syncAgents(req.auth.locationId, req.auth.companyId);
    res.json({ success: true, count: agents.length, agents });
  } catch (error) {
    logger.error('agent sync failed', { message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/** PATCH /api/agents/:ghlUserId — toggle active / change role. */
router.patch('/:ghlUserId', async (req, res) => {
  const update = {};
  if (req.body.active !== undefined) update.active = req.body.active;
  if (req.body.role) update.role = req.body.role;
  const agent = await Agent.findOneAndUpdate(
    { locationId: req.auth.locationId, ghlUserId: req.params.ghlUserId },
    { $set: update },
    { new: true }
  );
  if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
  res.json({ success: true, agent });
});

module.exports = router;
