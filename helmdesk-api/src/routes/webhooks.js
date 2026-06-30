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

  if (!type) {
    return res.status(400).json({ success: false, error: 'Missing required field: type' });
  }
  if (!database.isConnected()) {
    return res.status(200).json({ success: true, persisted: false });
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
          { appId, companyId, locationId, userId: data.userId, companyName: data.companyName, status: 'active', installedAt: new Date(), rawWebhookData: data },
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
        await Installation.findOneAndUpdate(
          locationId ? { appId, locationId } : { appId, companyId },
          { status: 'uninstalled', uninstalledAt: new Date() }
        );
        await subscriptionService.setStatus({ locationId, companyId }, 'canceled', data);
        await OAuthToken.deleteMany(locationId ? { locationId } : { companyId });
        await recordSubscriptionTx({ event: 'cancellation', locationId, companyId, appId, webhookType: type, rawData: data });
        logger.info('🗑️ Uninstalled — subscription canceled', { locationId, companyId });
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
router.post('/inbound', async (req, res) => {
  const data = req.body || {};
  // Acknowledge immediately-ish; we still await so errors are logged, but always 200 on handled.
  try {
    if (data.type && data.type !== 'InboundMessage') {
      return res.status(200).json({ success: true, ignored: 'not_inbound' });
    }
    if (data.direction && data.direction !== 'inbound') {
      return res.status(200).json({ success: true, ignored: 'not_inbound_direction' });
    }
    const locationId = data.locationId;
    if (!locationId || !database.isConnected()) {
      return res.status(200).json({ success: true, persisted: false });
    }

    const workspace = await Workspace.findOne({ locationId });
    if (!workspace) {
      logger.info('Inbound for unconfigured workspace — ignored', { locationId });
      return res.status(200).json({ success: true, ignored: 'no_workspace' });
    }

    // Normalize channel from GHL's messageType (e.g. "TYPE_SMS" / "SMS" → "SMS").
    const channel = normalizeChannel(data.messageType || data.messageTypeString);

    // Automation detection — IMPORTANT: the InboundMessage webhook payload (per GHL docs) carries
    // NO workflow/campaign/automation attribution field. So we cannot reliably tell that a given
    // inbound is a reply to a marketing blast from the payload alone. The workspace's
    // `ignoreAutomatedReplies` setting therefore relies primarily on:
    //   (1) the agency designating which channels are "support" (the main noise filter), and
    //   (2) the dedup gate collapsing ongoing threads into one ticket.
    // We still read any future/optional markers GHL may add, so the flag is forward-compatible,
    // but today this resolves false for standard inbound. (Agents can dismiss/merge edge cases.)
    const isAutomated = Boolean(data.isFromWorkflow || data.automated || data.source === 'workflow');

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
      // Email carries a real subject line — prefer it over deriving one from the body.
      subject: data.subject || null,
      isAutomated,
      contactName,
      contactEmail,
      ghlMessageId: data.messageId || null,
      at: data.dateAdded ? new Date(data.dateAdded) : new Date()
    });

    return res.status(200).json({ success: true, ...result, ticket: result.ticket?.ref });
  } catch (err) {
    logger.error('Inbound webhook error', { message: err.message });
    // Still 200 so GHL doesn't hammer retries for a transient app error; we've logged it.
    return res.status(200).json({ success: false, error: err.message });
  }
});

/**
 * Map GHL messageType variants to our canonical channel strings.
 * Targets are valid values of the official message-type enum so the channel we store can be
 * replied on directly (see ticketService.mapChannelToSendType). WebChat and Live_Chat are kept
 * distinct because the enum treats them as separate channels.
 */
function normalizeChannel(raw) {
  if (!raw) return null;
  const v = String(raw).toUpperCase().replace(/^TYPE_/, '');
  const map = {
    SMS: 'SMS',
    RCS: 'RCS',
    EMAIL: 'Email',
    WHATSAPP: 'WhatsApp',
    FB: 'FB',
    FACEBOOK: 'FB',
    IG: 'IG',
    INSTAGRAM: 'IG',
    LIVE_CHAT: 'Live_Chat',
    WEBCHAT: 'WebChat',
    GMB: 'GMB',
    CUSTOM: 'Custom',
    CALL: 'Call',
    IVR_CALL: 'Call',
    VOICEMAIL: 'Call'
  };
  return map[v] || null;
}

module.exports = router;
