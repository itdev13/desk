const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const subscriptionService = require('../services/subscriptionService');

router.use(requireAuth);

/** GET /api/subscription/status — plan, entitlement, seat limit for the current workspace. */
router.get('/status', async (req, res) => {
  try {
    const status = await subscriptionService.getStatus(req.auth.locationId);
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/subscription/plans — all tiers for the pricing page, with the current one flagged. */
router.get('/plans', async (req, res) => {
  try {
    const data = await subscriptionService.listPlans(req.auth.locationId);
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
