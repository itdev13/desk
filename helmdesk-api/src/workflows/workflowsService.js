const axios = require('axios');
const WorkflowSubscription = require('../models/WorkflowSubscription');
const ghlService = require('../services/ghlService');
const logger = require('../utils/logger');

/**
 * HelmDesk custom workflow triggers — subscription handling + firing.
 * Ported from the telegram app's proven GHL custom-trigger pattern.
 *
 * Flow:
 *   1. GHL calls handleSubscription() when an agency adds/updates/removes a HelmDesk trigger in a
 *      workflow. We upsert (or soft-delete) a WorkflowSubscription keyed on {workflowId, triggerKey}.
 *   2. When that ticket event happens, fireTrigger() POSTs the event payload to every active
 *      subscription's targetUrl, which starts the agency's workflow.
 */

const API_VERSION = process.env.GHL_API_VERSION || '2021-07-28';

/**
 * Handle the subscribe/update/delete webhook from GHL.
 * Body shape: { triggerData: { eventType, targetUrl, filters }, extras: { locationId, workflowId, companyId }, meta: { key, ... } }
 * eventType ∈ CREATED | UPDATED | DELETED.
 */
async function handleSubscription(body = {}) {
  const { triggerData = {}, extras = {}, meta = {} } = body;
  const { eventType, targetUrl, filters } = triggerData;
  const { locationId, workflowId, companyId } = extras;
  const triggerKey = meta.key;

  if (!workflowId || !triggerKey) {
    throw new Error('Missing workflowId or trigger key in subscription payload');
  }

  if (eventType === 'DELETED') {
    await WorkflowSubscription.findOneAndUpdate(
      { workflowId, triggerKey },
      { status: 'deleted' }
    );
    logger.info('🔌 Workflow trigger unsubscribed', { triggerKey, workflowId });
    return { success: true };
  }

  // CREATED or UPDATED → upsert an active subscription.
  await WorkflowSubscription.findOneAndUpdate(
    { workflowId, triggerKey },
    { locationId, companyId: companyId || null, workflowId, triggerKey, targetUrl, filters: filters || {}, extras, meta, status: 'active' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  logger.info('🔗 Workflow trigger subscribed', { triggerKey, workflowId, locationId });
  return { success: true };
}

/** A 200 body (or an error) from GHL can still mean the trigger is gone — detect so we stop firing it. */
function isTriggerDead(status, bodyText) {
  const t = String(bodyText || '').toLowerCase();
  if (t.includes('trigger is deleted') || t.includes('is inactive') || t.includes('skipping execution')) return true;
  if (status === 404) return true;
  return false;
}

async function markSubscriptionDeleted(subId) {
  try {
    await WorkflowSubscription.findByIdAndUpdate(subId, { status: 'deleted' });
  } catch (e) {
    logger.warn('could not soft-delete dead workflow subscription', { subId, message: e.message });
  }
}

/**
 * Fire a trigger: POST `eventData` to every active subscription for this location + trigger key.
 * Fire-and-forget by callers; never throws into the ticket flow.
 */
async function fireTrigger(triggerKey, locationId, eventData) {
  const subs = await WorkflowSubscription.find({ locationId, triggerKey, status: 'active' });
  if (!subs.length) return;

  let accessToken = null;
  try {
    accessToken = await ghlService.getValidToken(locationId);
  } catch (e) {
    logger.warn('workflow fire: no token (firing without auth header)', { triggerKey, locationId, message: e.message });
  }

  const headers = { 'Content-Type': 'application/json', Version: API_VERSION };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        const resp = await axios.post(sub.targetUrl, eventData, { headers, timeout: 10000 });
        const bodyText = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data || '');
        if (isTriggerDead(resp.status, bodyText)) {
          await markSubscriptionDeleted(sub._id);
        }
      } catch (err) {
        const status = err.response?.status;
        const bodyText = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        if (isTriggerDead(status, bodyText)) {
          await markSubscriptionDeleted(sub._id);
        } else {
          logger.warn('workflow fire failed', { triggerKey, workflowId: sub.workflowId, status, message: err.message });
        }
      }
    })
  );
}

module.exports = { handleSubscription, fireTrigger };
