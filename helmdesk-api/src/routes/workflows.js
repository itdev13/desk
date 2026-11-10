const express = require('express');
const router = express.Router();
const workflowsService = require('../workflows/workflowsService');
const logger = require('../utils/logger');

/**
 * Provider endpoints for HelpDesk's custom workflow TRIGGERS.
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

/**
 * POST /api/workflows/actions/create-ticket — "Create HelpDesk ticket" workflow ACTION.
 * Registered in Marketplace → app → Workflow Actions with this URL. Returns the new ticket's id/ref so
 * later workflow steps can use them.
 */
router.post('/actions/create-ticket', async (req, res) => {
  const p = req.body || {};
  logger.info('[action:create-ticket]', { locationId: p.extras?.locationId, contactId: p.extras?.contactId, workflowId: p.extras?.workflowId });
  try {
    const result = await workflowsService.executeCreateTicket(p);
    res.json({ success: true, data: result, ...result });
  } catch (error) {
    logger.warn('workflow action create-ticket failed', { message: error.message });
    res.status(400).json({ success: false, message: error.message, error: error.message });
  }
});

module.exports = router;
