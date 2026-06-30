const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const providerService = require('../services/providerService');
const logger = require('../utils/logger');

router.use(requireAuth);

/** GET /api/providers — stored conversation providers for the workspace (Settings list). */
router.get('/', async (req, res) => {
  const providers = await providerService.listProviders(req.auth.locationId);
  res.json({ success: true, providers });
});

/** POST /api/providers/sync — re-fetch providers from GHL and store them (admin only). */
router.post('/sync', requireAdmin, async (req, res) => {
  try {
    const providers = await providerService.syncProviders(req.auth.locationId);
    res.json({ success: true, count: providers.length, providers });
  } catch (error) {
    logger.error('provider sync failed', { message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
