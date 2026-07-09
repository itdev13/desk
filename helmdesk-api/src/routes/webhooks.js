const express = require('express');
const router = express.Router();
const Installation = require('../models/Installation');
const OAuthToken = require('../models/OAuthToken');
const Workspace = require('../models/Workspace');
const SubscriptionTransaction = require('../models/SubscriptionTransaction');
const Subscription = require('../models/Subscription');
const subscriptionService = require('../services/subscriptionService');
const ticketService = require('../services/ticketService');
const agentService = require('../services/agentService');
const ghlService = require('../services/ghlService');
const database = require('../config/database');
const logger = require('../utils/logger');
const ThrottleQueue = require('../utils/throttleQueue');

const tokenGenQueue = new ThrottleQueue({ name: 'proactive-token-gen', delayMs: 350 });

/** Record a subscription lifecycle row (non-fatal). */
async function recordSubscriptionTx(payload) {
  try {
    const p = subscriptionService.planForId(payload.planId);
    await SubscriptionTransaction.create({
      ...payload,
      planName: p.name,
      priceUsd: p.priceUsd
    });
  } catch (e) {
    logger.warn('recordSubscriptionTx failed (non-fatal)', { message: e.message });
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * App lifecycle webhooks — POST /api/webhooks/helmdesk
 *   INSTALL / UNINSTALL / APP_UPDATE / PLAN_CHANGE / InvoicePaid
 * ════════════════════════════════════════════════════════════════════════════ */
router.post('/helmdesk', async (req, res) => {
  const data = req.body || {};
  const { type, appId, companyId, locationId } = data;

  logger.info('📥 Lifecycle webhook', { type, appId, companyId, locationId });
  logger.info('📦 Webhook payload', { type, payload: JSON.stringify(data).slice(0, 2000) });

  if (!type) {
    return res.status(400).json({ success: false, error: 'Missing required field: type' });
  }
  if (!database.isConnected()) {
    return res.status(200).json({ success: true, persisted: false });
  }

  // GHL delivers ALL events to this single webhook URL, dispatched by `type`. Message events
  // (InboundMessage / OutboundMessage) and User roster events carry no `appId`, so handle them
  // here before the appId guard below.
  //
  // IMPORTANT: these are account-level events GHL fires for the whole location regardless of
  // whether OUR app is installed. Only process them if the location has an ACTIVE install — else
  // we'd keep creating tickets/agents for a workspace that has uninstalled us.
  if (type === 'InboundMessage' || type === 'OutboundMessage' ||
      type === 'UserCreate' || type === 'UserUpdate' || type === 'UserDelete') {
    if (data.locationId && !(await isLocationActive(data.locationId))) {
      logger.info('⏭️  Ignoring event for non-installed location', { type, locationId: data.locationId });
      return res.status(200).json({ success: true, ignored: 'not_installed' });
    }
  }

  if (type === 'InboundMessage' || type === 'OutboundMessage') {
    try {
      const result = type === 'InboundMessage' ? await processInbound(data) : await processOutbound(data);
      return res.status(200).json({ success: true, type, ...result });
    } catch (err) {
      logger.error('Message webhook error', { message: err.message, type });
      return res.status(200).json({ success: false, error: err.message }); // 200 so GHL doesn't retry-storm
    }
  }

  // User roster events (UserCreate / UserUpdate / UserDelete) keep the synced Agent collection
  // live without polling. They carry `type` + `id` but NO `appId`, so handle them before the
  // appId guard below. (Initial roster comes from syncAgents at install; these keep it fresh.)
  if (type === 'UserCreate' || type === 'UserUpdate' || type === 'UserDelete') {
    try {
      const n = type === 'UserDelete'
        ? await agentService.handleUserDelete(data)
        : await agentService.handleUserUpsert(data);
      return res.status(200).json({ success: true, type, affectedWorkspaces: n });
    } catch (err) {
      logger.error('User webhook error', { message: err.message, type });
      return res.status(200).json({ success: false, error: err.message });
    }
  }

  // App lifecycle events below require appId.
  if (!appId) {
    return res.status(400).json({ success: false, error: 'Missing required field: appId' });
  }

  try {
    switch (type) {
      case 'INSTALL': {
        await Installation.findOneAndUpdate(
          locationId ? { appId, locationId } : { appId, companyId },
          {
            appId, companyId, locationId, userId: data.userId, companyName: data.companyName,
            planId: data.planId, trial: data.trial || {},
            // White-label domain (if the installing agency is white-labeled) → used to build the
            // plan/upgrade link on their own domain rather than app.gohighlevel.com.
            isWhitelabelCompany: !!data.isWhitelabelCompany,
            whitelabelDetails: {
              domain: data.whitelabelDetails?.domain || null,
              logoUrl: data.whitelabelDetails?.logoUrl || null
            },
            status: 'active', installedAt: new Date(), rawWebhookData: data
          },
          { upsert: true, new: true }
        );

        const sub = await subscriptionService.activate({ locationId, companyId, appId, planId: data.planId, trial: data.trial, raw: data });
        await recordSubscriptionTx({
          event: sub?.canceledAt ? 'reactivation' : 'new_subscription',
          locationId, companyId, appId, planId: data.planId,
          periodStart: sub?.currentPeriodStart, periodEnd: sub?.currentPeriodEnd, webhookType: type, rawData: data
        });

        // Ensure a Workspace shell exists so the setup wizard has somewhere to write.
        // Capture the installer as owner/admin here too — the INSTALL webhook and the OAuth
        // callback race to create the workspace; whichever wins must record installerUserId.
        if (locationId) {
          await Workspace.findOneAndUpdate(
            { locationId },
            { $setOnInsert: { locationId, installerUserId: data.userId || null }, $set: { companyId } },
            { upsert: true, setDefaultsOnInsert: true }
          );

          // Proactively mint a location token so the UI shows "connected" immediately.
          if (companyId) {
            tokenGenQueue.push(async () => {
              const existing = await OAuthToken.findOne({ locationId, tokenType: 'location', isActive: true });
              if (existing) return;
              const companyToken = await OAuthToken.findOne({ companyId, tokenType: 'company', isActive: true });
              if (!companyToken) return;
              const minted = await ghlService.getLocationTokenFromCompany(companyId, locationId);
              await OAuthToken.findOneAndUpdate(
                { locationId, tokenType: 'location' },
                { locationId, companyId, tokenType: 'location', accessToken: minted.accessToken, refreshToken: minted.refreshToken, expiresAt: new Date(Date.now() + minted.expiresIn * 1000), isActive: true },
                { upsert: true, new: true }
              );
              // Best-effort agent sync once the token exists.
              agentService.syncAgents(locationId, companyId).catch(() => {});
            });
          }
        }
        logger.info('✅ Installed — subscription active', { locationId, planId: data.planId });
        break;
      }

      case 'UNINSTALL': {
        // GHL sends a reason on payment-driven uninstalls (e.g. 'PAYMENT_FAILURE') vs a manual one.
        const uninstallReason = data.reason || data.uninstallReason || data.cancelReason || null;
        const isPaymentFailure = /payment/i.test(String(uninstallReason || ''));
        await Installation.findOneAndUpdate(
          locationId ? { appId, locationId } : { appId, companyId },
          { status: 'uninstalled', uninstalledAt: new Date(), uninstallReason }
        );
        await subscriptionService.setStatus({ locationId, companyId }, 'canceled', data);
        await OAuthToken.deleteMany(locationId ? { locationId } : { companyId });
        // Keep the workspace config + tickets (so reinstall restores everything), but flip
        // setupComplete=false so a reinstall re-runs the wizard pre-filled with prior values —
        // a confirm-and-go-live step. Settings/SLA/branding/keywords are all preserved.
        if (locationId) {
          await Workspace.updateOne({ locationId }, { $set: { setupComplete: false } });
        }
        await recordSubscriptionTx({ event: 'cancellation', locationId, companyId, appId, webhookType: type, rawData: data });
        logger.info('🗑️ Uninstalled — tokens removed, config kept (wizard will re-run on reinstall)', { locationId, companyId, uninstallReason, isPaymentFailure });
        break;
      }

      case 'APP_UPDATE':
        logger.info('🔄 App version updated', { appId, version: data.version });
        break;

      case 'PLAN_CHANGE': {
        const newPlanId = data.newPlanId;
        const oldPlanId = data.currentPlanId || data.oldPlanId || data.previousPlanId || null;
        const sub = await subscriptionService.activate({ locationId, companyId, appId, planId: newPlanId, status: 'active', raw: data });
        const newP = subscriptionService.planForId(newPlanId);
        const oldP = oldPlanId ? subscriptionService.planForId(oldPlanId) : null;
        await recordSubscriptionTx({
          event: oldP && newP.priceUsd < oldP.priceUsd ? 'downgrade' : 'upgrade',
          locationId, companyId, appId, planId: newPlanId, previousPlanId: oldPlanId,
          periodStart: sub?.currentPeriodStart, periodEnd: sub?.currentPeriodEnd, webhookType: type, rawData: data
        });
        logger.info('🔁 Plan changed', { locationId, newPlanId, oldPlanId });
        // Reconcile active agents to the new plan's seat limit (down: deactivate overflow; up:
        // reactivate previously-capped agents). Non-blocking — a failure here never fails the webhook.
        if (locationId) {
          agentService.reconcileSeats(locationId)
            .then((r) => logger.info('🔧 Seats reconciled after plan change', { locationId, ...r }))
            .catch((e) => logger.warn('Seat reconcile failed (non-fatal)', { locationId, message: e.message }));
        }
        break;
      }

      case 'InvoicePaid':
      case 'INVOICE_PAID':
      case 'InvoicePartiallyPaid':
      case 'INVOICE_PARTIALLY_PAID': {
        const invLoc = data.altId || locationId;
        const invoiceId = data._id || data.invoiceId;
        const sub = invLoc ? await Subscription.findOne({ locationId: invLoc }) : null;
        const isPartial = /partial/i.test(type);
        await SubscriptionTransaction.findOneAndUpdate(
          { invoiceId },
          {
            locationId: invLoc, companyId: sub?.companyId || companyId || null, appId,
            event: isPartial ? 'invoice_partially_paid' : 'invoice_paid',
            invoiceId, invoiceNumber: data.invoiceNumber || null,
            amountPaid: data.amountPaid ?? data.total ?? 0, amountDue: data.amountDue ?? 0,
            currency: data.currency || 'USD', invoiceStatus: data.status || (isPartial ? 'partially_paid' : 'paid'),
            liveMode: data.liveMode !== false, invoiceDate: data.issueDate ? new Date(data.issueDate) : new Date(),
            planId: sub?.planId || null, planName: sub?.planName || null, priceUsd: sub?.priceUsd || 0,
            payerEmail: data.contactDetails?.email || null, payerName: data.contactDetails?.name || null,
            webhookType: type, rawData: data
          },
          { upsert: true, new: true }
        );
        logger.info('💰 Invoice recorded', { invoiceId, locationId: invLoc });
        break;
      }

      // Recurring payment status changes from GHL's dunning system. newStatus ∈ COMPLETE | FAILED.
      // FAILED → mark the subscription past_due (blocks the app via the entitlement gate) so a lapsed
      // payer hits the enrol screen; COMPLETE → restore access. Payload mirrors the platform's dunning
      // shape: { appId, locationId, companyId, userId, previousStatus, newStatus }.
      case 'APP_PAYMENT_STATUS': {
        const newStatus = String(data.newStatus || '').toUpperCase();
        const previousStatus = data.previousStatus || null;
        const reason = data.reason || data.failureReason || null;
        const target = newStatus === 'FAILED' ? 'past_due' : newStatus === 'COMPLETE' ? 'active' : null;
        if (target && (locationId || companyId)) {
          await subscriptionService.setStatus({ locationId, companyId }, target, data);
          await recordSubscriptionTx({
            event: target === 'past_due' ? 'cancellation' : 'reactivation',
            locationId, companyId, appId, webhookType: type, rawData: data
          });
          logger.info('💳 Payment status changed', { locationId, companyId, previousStatus, newStatus, subStatus: target, reason });
        } else {
          logger.warn('APP_PAYMENT_STATUS with unmapped newStatus', { newStatus, locationId, companyId });
        }
        break;
      }

      default:
        logger.info('ℹ️ Unhandled lifecycle webhook', { type });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Lifecycle webhook error', { message: err.message, type });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════════════════
 * InboundMessage webhook — POST /api/webhooks/inbound
 *
 * The heart of ticket creation. GHL fires this whenever a contact sends a message. We map the
 * payload into the ticket engine, which runs the filter → dedup → create/append pipeline using
 * the workspace's settings. We ALWAYS 200 quickly (GHL retries non-2xx) and do the work inline
 * because it's cheap (pure DB + one optional auto-reply send).
 *
 * Payload (per GHL docs): { type:'InboundMessage', locationId, contactId, conversationId,
 *   messageType, direction:'inbound', body, dateAdded, messageId, userId?, subject?, ... }
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Is our app currently installed on this location? GHL sends account-level events (messages, user
 * changes) to every app's webhook regardless of install state, so we gate on an ACTIVE Installation
 * to avoid processing events for locations that have uninstalled us. Cheap indexed lookup.
 */
async function isLocationActive(locationId) {
  const inst = await Installation.findOne({ locationId, status: 'active' }).select('_id').lean();
  return !!inst;
}

/**
 * Process an InboundMessage payload → ticket. Shared by the dedicated /inbound route AND the
 * unified /helmdesk dispatcher (GHL delivers all events to one URL). Returns a result object.
 */
async function processInbound(data) {
  if (data.direction && data.direction !== 'inbound') return { ignored: 'not_inbound_direction' };
  const locationId = data.locationId;
  if (!locationId || !database.isConnected()) return { persisted: false };

  const workspace = await Workspace.findOne({ locationId });
  if (!workspace) {
    logger.info('Inbound for unconfigured workspace — ignored', { locationId });
    return { ignored: 'no_workspace' };
  }

  // Normalize channel from messageType (string), falling back to numeric messageTypeId.
  // ACTIVITY/system/internal types → null so they never become tickets.
  const channel = normalizeChannel(data.messageTypeString || data.messageType, data.messageTypeId);

  // Real automation detection: source ∈ {workflow, campaign, bulk_actions} OR a TYPE_CAMPAIGN_* type.
  const isAutomated = isAutomatedMessage(data);

  // Resolve contact display info (cached on the ticket for list rendering).
  let contactName = data.fullName || null;
  let contactEmail = data.email || null;
  if (!contactName && data.contactId) {
    const c = await ghlService.getContact(locationId, data.contactId);
    contactName = c.name;
    contactEmail = c.email;
  }

  const result = await ticketService.handleInbound(workspace, {
    contactId: data.contactId,
    conversationId: data.conversationId,
    channel,
    conversationProviderId: data.conversationProviderId || null,
    body: data.body || '',
    subject: data.subject || null,
    isAutomated,
    contactName,
    contactEmail,
    ghlMessageId: data.messageId || null,
    at: data.dateAdded ? new Date(data.dateAdded) : new Date()
  });
  return { ...result, ticket: result.ticket?.ref };
}

router.post('/inbound', async (req, res) => {
  const data = req.body || {};
  try {
    if (data.type && data.type !== 'InboundMessage') return res.status(200).json({ success: true, ignored: 'not_inbound' });
    const result = await processInbound(data);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error('Inbound webhook error', { message: err.message });
    return res.status(200).json({ success: false, error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════════════════
 * OutboundMessage webhook — POST /api/webhooks/outbound
 *
 * Fires when a message is SENT to a contact. Two cases, and dedup is the whole game:
 *   - Sent BY HelmDesk (agent replied in our app): we already recorded it, so we SKIP — matched
 *     by the ghlMessageId we stored on our reply Comment.
 *   - Sent OUTSIDE HelmDesk (native GHL inbox / workflow): record it on the contact's open ticket,
 *     stamp first-response, and stop the SLA clock — so the ticket reflects reality.
 * Always 200 (GHL retries non-2xx).
 * ════════════════════════════════════════════════════════════════════════════ */
/** Process an OutboundMessage payload. Shared by /outbound route + /helmdesk dispatcher. */
async function processOutbound(data) {
  if (data.direction && data.direction !== 'outbound') return { ignored: 'not_outbound_direction' };
  const locationId = data.locationId;
  if (!locationId || !database.isConnected()) return { persisted: false };

  const workspace = await Workspace.findOne({ locationId });
  if (!workspace) return { ignored: 'no_workspace' };

  const result = await ticketService.handleOutbound(workspace, {
    contactId: data.contactId,
    conversationId: data.conversationId,
    channel: normalizeChannel(data.messageTypeString || data.messageType, data.messageTypeId),
    body: data.body || '',
    ghlMessageId: data.messageId || null,
    userId: data.userId || null,
    at: data.dateAdded ? new Date(data.dateAdded) : new Date()
  });
  return { ...result, ticket: result.ticket?.ref };
}

router.post('/outbound', async (req, res) => {
  const data = req.body || {};
  try {
    if (data.type && data.type !== 'OutboundMessage') return res.status(200).json({ success: true, ignored: 'not_outbound' });
    const result = await processOutbound(data);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error('Outbound webhook error', { message: err.message });
    return res.status(200).json({ success: false, error: err.message });
  }
});

// Numeric messageTypeId → canonical channel (authoritative fallback when the string is missing).
// Campaign/custom variants collapse to their base channel; ACTIVITY ids return null (handled below).
const ID_TO_CHANNEL = {
  1: 'Call', 24: 'Call', 13: 'Call', 8: 'Call', 34: 'Call', 10: 'Call', // calls/voicemail variants
  2: 'SMS', 7: 'SMS', 4: 'SMS', 6: 'SMS', 14: 'SMS', 35: 'SMS', 45: 'SMS', // SMS + campaign/group/review SMS
  20: 'SMS', 22: 'SMS', // custom SMS / custom-provider SMS
  3: 'Email', 9: 'Email', 21: 'Email', 23: 'Email', 40: 'Email', // email + campaign/custom/external
  5: 'WebChat',
  11: 'FB', 12: 'FB', 32: 'FB', 60: 'FB', 61: 'FB',
  15: 'GMB', 16: 'GMB',
  18: 'IG', 33: 'IG',
  19: 'WhatsApp',
  29: 'Live_Chat', 30: 'Live_Chat',
  41: 'TikTok', 42: 'TikTok',
  43: 'RCS'
};

/**
 * Map a GHL message to our canonical channel string. Reads the messageTypeString first, falling
 * back to the numeric messageTypeId (always present). Handles the full real-world enum:
 *   - TYPE_CAMPAIGN_* / TYPE_CUSTOM_* / TYPE_CUSTOM_PROVIDER_* → base channel
 *   - TYPE_ACTIVITY_* and other system/internal types → null (never become tickets)
 * Targets are valid send-types so the stored channel can be replied on directly.
 */
function normalizeChannel(raw, messageTypeId) {
  let v = raw ? String(raw).toUpperCase().replace(/^TYPE_/, '') : '';

  // System/activity/internal pseudo-messages are not support messages.
  if (v.startsWith('ACTIVITY') || v.startsWith('INTERNAL') || v === 'REVIEW' || v === 'FORM_SUBMISSION') return null;

  // Custom conversation providers get their OWN channel value (CustomSMS / CustomEmail) so the UI
  // can label them "Custom Provider SMS/Email" and the send path knows to use type:Custom + the
  // providerId. (Ids 22/23; strings TYPE_CUSTOM_PROVIDER_SMS/_EMAIL.)
  if (v === 'CUSTOM_PROVIDER_SMS' || Number(messageTypeId) === 22) return 'CustomSMS';
  if (v === 'CUSTOM_PROVIDER_EMAIL' || Number(messageTypeId) === 23) return 'CustomEmail';

  // Collapse remaining campaign/custom prefixes to the base channel (a campaign email is still Email).
  v = v.replace(/^CAMPAIGN_/, '').replace(/^CUSTOM_/, '').replace(/^GROUP_/, '');

  const map = {
    SMS: 'SMS', RCS: 'RCS', EMAIL: 'Email', WHATSAPP: 'WhatsApp',
    FB: 'FB', FACEBOOK: 'FB', IG: 'IG', INSTAGRAM: 'IG',
    LIVE_CHAT: 'Live_Chat', WEBCHAT: 'WebChat', GMB: 'GMB', CUSTOM: 'Custom',
    CALL: 'Call', IVR_CALL: 'Call', VOICEMAIL: 'Call', MANUAL_CALL: 'Call', MANUAL_SMS: 'SMS',
    TIKTOK: 'TikTok'
  };
  if (map[v]) return map[v];

  // Fallback: numeric id. ACTIVITY ids (25,26,27,28,31,38,44,51) are intentionally absent → null.
  return (messageTypeId != null && ID_TO_CHANNEL[Number(messageTypeId)]) || null;
}

/**
 * Detect a marketing/automation-originated message. Real signals (per GHL's MessageSource enum +
 * the campaign messageTypes): source ∈ {workflow, campaign, bulk_actions}, OR a TYPE_CAMPAIGN_* type.
 * Used by the "Ignore marketing & automation replies" filter.
 */
function isAutomatedMessage(data) {
  const automatedSources = ['workflow', 'campaign', 'bulk_actions'];
  if (automatedSources.includes(String(data.source || '').toLowerCase())) return true;
  if (/^TYPE_CAMPAIGN_/.test(String(data.messageTypeString || '').toUpperCase())) return true;
  return false;
}

module.exports = router;
