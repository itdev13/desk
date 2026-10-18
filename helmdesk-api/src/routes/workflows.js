const express = require('express');
const router = express.Router();
const workflowsService = require('../workflows/workflowsService');
const logger = require('../utils/logger');

/**
 * Provider endpoints for HelmDesk's custom workflow TRIGGERS.
 * GoHighLevel calls these; they are registered against this app in the Marketplace dashboard.
 *
 * GHL expects 200 {success:true} on success and 400 {success:false} on failure (the message is
 * surfaced in the workflow's execution history). Never return 500 here.
 */

router.get('/health', (req, res) => res.json({ status: 'ok', module: 'workflows' }));

/**
 * POST /api/workflows/triggers/subscriptions
 * GHL sends subscribe / update / delete here; discriminated by triggerData.eventType.
 */
router.post('/triggers/subscriptions', async (req, res) => {
  try {
    const result = await workflowsService.handleSubscription(req.body);
    res.json(result);
  } catch (error) {
    logger.warn('workflow subscription failed', { message: error.message });
    res.status(400).json({ success: false, message: error.message, error: error.message });
  }
});

module.exports = router;
